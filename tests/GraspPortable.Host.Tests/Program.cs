using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using GraspPortable.Contracts;

try
{
var root = new DirectoryInfo(AppContext.BaseDirectory);
while (root is not null && !File.Exists(Path.Combine(root.FullName, "GraspPortable.slnx"))) root = root.Parent;
if (root is null) throw new InvalidOperationException("Run from the built repository test project.");
var configuration = new DirectoryInfo(AppContext.BaseDirectory).Parent!.Name;
var hostDll = Path.Combine(root.FullName, "src", "GraspPortable.Host", "bin", configuration, "net10.0", "GraspPortable.Host.dll");
if (!File.Exists(hostDll)) throw new FileNotFoundException("Build the matching Host configuration first.", hostDll);
var workspace = Path.Combine(root.FullName, "workspaces", "http-" + Guid.NewGuid().ToString("N"));
var passed = 0;
void Check(bool condition, string label) { if (!condition) throw new InvalidOperationException("FAIL: " + label); passed++; Console.WriteLine("PASS: " + label); }
string Op() => Guid.NewGuid().ToString("N");

string workspaceId;
string noteId;
string previousCredential;
long committedRevision;
CommitNoteRequest commitRequest;
const string committedSource = "前文\n@code{ @Greeting = {你好 HTTP} }\n後文";
const string unfinishedSource = "前文\n@code{ @Greeting = {未完成";
const string newerDraftSource = unfinishedSource+"\n尚未保存的下一段";

await using (var host = await HostProcess.StartAsync(hostDll, workspace))
{
    previousCredential = host.Credential;
    Check(host.Handshake.Port is > 0 and <= 65535, "stdout handshake supplies loopback port");
    Check(host.Handshake.ProtocolVersion == Protocol.Version, "stdout handshake protocol matches client");
    using (var guest = new HttpClient { BaseAddress = host.Client.BaseAddress })
    {
        using var missing = await guest.GetAsync("/api/workspace");
        Check(missing.StatusCode == HttpStatusCode.Unauthorized, "missing credential returns 401");
        guest.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "wrong");
        using var wrong = await guest.GetAsync("/api/workspace");
        Check(wrong.StatusCode == HttpStatusCode.Unauthorized, "wrong credential returns 401");
    }
    using (var browser = new HttpRequestMessage(HttpMethod.Get, "/api/workspace"))
    {
        browser.Headers.Add("Origin", "https://example.invalid");
        using var blocked = await host.Client.SendAsync(browser);
        Check(blocked.StatusCode == HttpStatusCode.Forbidden, "browser Origin is rejected despite credential");
    }
    var initial = await host.GetAsync<WorkspaceInfo>("/api/workspace");
    workspaceId = initial.WorkspaceId;
    Check(initial.WorkspaceId == host.Handshake.WorkspaceId && initial.ProtocolVersion == Protocol.Version, "HTTP workspace identity matches startup handshake");
    Check(initial.Path == workspace && initial.Revision == 0, "isolated test workspace starts at revision zero");

    await using (var events = await EventStream.OpenAsync(host.Client))
    {
        var first = await events.ReadAsync();
        Check(first.Revision == initial.Revision, "SSE subscription starts with current revision");
        var created = await host.PostAsync<OperationResult>("/api/notes", new CreateNoteRequest(Op(), "HTTP 測試", "起始文字"));
        Check(created.Status == "committed" && created.NoteId is not null, "HTTP CreateNote commits real note");
        noteId = created.NoteId!;
        var createdNotice = await events.ReadAsync();
        Check(createdNotice.Revision == created.Revision && createdNotice.NoteIds.Contains(noteId), "SSE delivers created note revision and affected ID");
        var notes = await host.GetAsync<NoteSummary[]>("/api/notes?search=" + Uri.EscapeDataString("HTTP"));
        Check(notes.Length == 1 && notes[0].Id == noteId, "HTTP title search locates created note");
        var note = await host.GetAsync<NoteDto>("/api/notes/" + noteId);
        Check(note.Source == "起始文字" && note.Draft is null, "HTTP ReadNote returns committed source");
        var draft = await host.PutAsync<OperationResult>("/api/notes/" + noteId + "/draft", new SaveDraftRequest("http-session", 1, note.Revision, note.Title, committedSource));
        Check(draft.Status == "draft" && draft.Revision == note.KnowledgeRevision, "HTTP SaveDraft persists without knowledge commit");
        var withDraft = await host.GetAsync<NoteDto>("/api/notes/" + noteId);
        Check(withDraft.Source == "起始文字" && withDraft.Draft?.Source == committedSource, "read model separates draft and committed source");
        commitRequest = new(Op(), "http-session", 1, note.Revision, note.KnowledgeRevision);
        var committed = await host.PostAsync<OperationResult>("/api/notes/" + noteId + "/commit", commitRequest);
        committedRevision = committed.Revision;
        Check(committed.Status == "committed" && committed.Revision > created.Revision, "HTTP CommitNote publishes new revision");
        var notice = await events.ReadAsync();
        Check(notice.Revision == committed.Revision && notice.NoteIds.Contains(noteId), "SSE commit notification follows successful commit");
        var updated = await host.GetAsync<NoteDto>("/api/notes/" + noteId);
        Check(updated.Source == committedSource && updated.Draft is null && updated.Definitions.Single().Value == "你好 HTTP", "HTTP commit preserves Unicode source and exposes result");
        var receipt = await host.GetAsync<OperationResult>("/api/receipts/" + commitRequest.OperationId);
        Check(receipt.Status == "committed" && receipt.Revision == committed.Revision, "HTTP receipt resolves operation outcome");
        var retried = await host.PostAsync<OperationResult>("/api/notes/" + noteId + "/commit", commitRequest);
        Check(retried.Status == "committed" && retried.Revision == committed.Revision, "HTTP same-operation retry returns durable receipt");
        var mismatch = await host.PostAsync<OperationResult>("/api/notes/" + noteId + "/commit", commitRequest with { DraftRevision = 99 });
        Check(mismatch.Status == "rejected" && (await host.GetAsync<WorkspaceInfo>("/api/workspace")).Revision == committed.Revision, "HTTP operation payload mismatch rejects without revision change");
    }

    // Disconnect before another commit, then reconnect: the current snapshot revision repairs the gap.
    var missed = await host.PostAsync<OperationResult>("/api/notes", new CreateNoteRequest(Op(), "SSE gap", "gap"));
    Check(missed.Status == "committed", "commit succeeds while SSE client is disconnected");
    committedRevision = missed.Revision;
    await using (var reconnected = await EventStream.OpenAsync(host.Client))
    {
        Check((await reconnected.ReadAsync()).Revision == committedRevision, "SSE reconnect supplies latest revision after notification gap");
    }
    var beforeClose = await host.GetAsync<NoteDto>("/api/notes/" + noteId);
    var saved = await host.PutAsync<OperationResult>("/api/notes/" + noteId + "/draft", new SaveDraftRequest("http-session", 2, beforeClose.Revision, beforeClose.Title, unfinishedSource));
    Check(saved.Status == "draft", "unfinished source is durably saved before process restart");
    var invalid = await host.PostAsync<OperationResult>("/api/notes/" + noteId + "/commit", new CommitNoteRequest(Op(), "http-session", 2, beforeClose.Revision, committedRevision));
    Check(invalid.Status == "source-saved" && invalid.Revision > committedRevision, "incomplete source is saved to Markdown without accepting partial semantics");
    committedRevision=invalid.Revision;
    var rawSaved=await host.GetAsync<NoteDto>("/api/notes/"+noteId);
    Check(rawSaved.Source==unfinishedSource && rawSaved.SourceStatus=="invalid" && rawSaved.Draft is null
        && File.ReadAllText(Path.Combine(workspace,rawSaved.RelativePath!)).EndsWith(unfinishedSource), "wire source and physical Markdown agree on incomplete raw text");
    await host.PutAsync<OperationResult>("/api/notes/"+noteId+"/draft",new SaveDraftRequest("http-session",3,rawSaved.Revision,rawSaved.Title,newerDraftSource,rawSaved.SourceHash));
    await host.ShutdownAsync();
    Check(host.ExitCode == 0, "shutdown endpoint exits first Host cleanly");
}

await using (var restarted = await HostProcess.StartAsync(hostDll, workspace))
{
    var current = await restarted.GetAsync<WorkspaceInfo>("/api/workspace");
    Check(current.WorkspaceId == workspaceId && current.Revision == committedRevision, "fresh Host process reopens same DB identity and revision");
    using (var oldSession = new HttpClient { BaseAddress = restarted.Client.BaseAddress })
    {
        oldSession.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", previousCredential);
        using var denied = await oldSession.GetAsync("/api/workspace");
        Check(denied.StatusCode == HttpStatusCode.Unauthorized, "restart rotates startup credential");
    }
    var restored = await restarted.GetAsync<NoteDto>("/api/notes/" + noteId);
    Check(restored.Source == unfinishedSource && restored.SourceStatus=="invalid" && restored.Definitions.Single().Status=="Stale"
        && restored.Definitions.Single().LastGoodValue=="你好 HTTP", "restart restores saved raw and explicitly stale last accepted value");
    Check(restored.Draft is { Revision: 3, SessionId: "http-session" } && restored.Draft.Source == newerDraftSource, "restart restores separate newer draft with its session and revision");
    var receipt = await restarted.GetAsync<OperationResult>("/api/receipts/" + commitRequest.OperationId);
    Check(receipt.Status == "committed", "operation receipt survives Host restart");
    var retry = await restarted.PostAsync<OperationResult>("/api/notes/" + noteId + "/commit", commitRequest);
    Check(retry.Status == "committed" && retry.Revision == receipt.Revision, "post-restart retry returns earlier receipt without changing recovered draft");
    Check((await restarted.GetAsync<NoteDto>("/api/notes/" + noteId)).Draft?.Revision == 3, "old operation retry preserves newer recovered draft");
    await using (var events = await EventStream.OpenAsync(restarted.Client))
    {
        Check((await events.ReadAsync()).Revision == committedRevision, "restarted SSE stream reports persisted current revision");
    }
    var backupStatus = await restarted.GetAsync<BackupStatusDto>("/api/backups");
    Check(backupStatus.Generations.Length > 0, "normal shutdown published a verified checkpoint");
    var settings = await restarted.PostAsync<BackupResultDto>("/api/backups/settings", new BackupSettingsRequest(Op(), backupStatus.Options.Version, 7, 3));
    Check(settings.Status == "updated", "HTTP backup settings accept the expected version");
    var checkpoint = new CheckpointRequest(Op());
    var captured = await restarted.PostAsync<BackupResultDto>("/api/backups/capture", checkpoint);
    Check(captured.Status == "published" && captured.Path is not null, "HTTP checkpoint publishes source plus newer draft");
    var capturedAgain = await restarted.PostAsync<BackupResultDto>("/api/backups/capture", checkpoint);
    Check(capturedAgain.Path == captured.Path && capturedAgain.Status == "published", "HTTP checkpoint retry returns the same generation");
    var restoreRequest = new RestoreBackupRequest(Op(), captured.Path!, workspace + "-restored");
    var recovered = await restarted.PostAsync<BackupResultDto>("/api/backups/restore", restoreRequest);
    Check(recovered.Status == "restored" && recovered.Path == restoreRequest.DestinationPath, "HTTP restore creates a new workspace");
    var recoveredAgain = await restarted.PostAsync<BackupResultDto>("/api/backups/restore", restoreRequest);
    Check(recoveredAgain.Path == recovered.Path && recoveredAgain.Status == "restored", "HTTP restore retry preserves its destination");
    await using (var copy = await HostProcess.StartAsync(hostDll, recovered.Path!))
    {
        var copiedNote = await copy.GetAsync<NoteDto>("/api/notes/" + noteId);
        Check(copiedNote.Source == unfinishedSource && copiedNote.Draft?.Source == newerDraftSource
            && copiedNote.Definitions.Single().LastGoodValue == "你好 HTTP", "restored Host preserves invalid raw, newer draft and last-good identity");
        Check((await copy.GetAsync<BackupStatusDto>("/api/backups")).Options.IntervalMinutes == 7, "restored Host preserves backup settings");
        await copy.ShutdownAsync();
    }
    var recordsBasis=await restarted.GetAsync<WorkspaceInfo>("/api/workspace");
    var createTable=new CreateCollectionRequest(Op(),recordsBasis.Revision,"HTTP資料表","Characters.First","第一筆");
    var tableCreated=await restarted.PostAsync<OperationResult>("/api/records",createTable);
    Check(tableCreated.Status=="committed","HTTP creates Markdown-authoritative collection");
    var table=(await restarted.GetAsync<CollectionSummaryDto[]>("/api/records")).Single();
    var tableRead=await restarted.GetAsync<CollectionDto>("/api/records/"+table.Id);
    Check(tableRead.Rows.Single().Key=="Characters.First" && tableRead.Fields.Single().Kind=="Markdown","wire schema and qualified record key round-trip");
    var row=tableRead.Rows.Single();var field=tableRead.Fields.Single();
    var edit=new RecordFieldChangeRequest(Op(),tableRead.Revision,"第一段\n\n第二段");
    var edited=await restarted.PostAsync<OperationResult>($"/api/records/rows/{row.Id}/fields/{field.Id}",edit);
    Check(edited.Status=="committed","HTTP field edit commits real Markdown paragraphs");
    var tableAgain=await restarted.GetAsync<CollectionDto>("/api/records/"+table.Id);
    Check(tableAgain.Rows.Single().Cells.Single().ComputedMarkdown==edit.RawSource,"wire field raw and computed multi-paragraph text agree");
    var generated=(await restarted.GetAsync<DefinitionDto[]>("/api/definitions")).Single(d=>d.RecordId==row.Id);
    Check(generated.FieldId==field.Id&&generated.CanEditShared,"generated definition exposes its writable field source");
    var rename=new RenameRecordRequest(Op(),tableAgain.Revision,"Characters.Renamed","已改名");
    var confirm=await restarted.PostAsync<OperationResult>($"/api/records/{table.Id}/rows/{row.Id}",rename);
    Check(confirm.Status=="confirmation-required","record key rename requests impact confirmation");
    var renamed=await restarted.PostAsync<OperationResult>($"/api/records/{table.Id}/rows/{row.Id}",rename with{ConfirmRename=true});
    var generatedAgain=(await restarted.GetAsync<DefinitionDto[]>("/api/definitions")).Single(d=>d.RecordId==row.Id);
    Check(renamed.Status=="committed"&&generatedAgain.Id==generated.Id&&generatedAgain.Name=="Characters.Renamed.Description","HTTP confirmed key rename retains property identity");
    var view=new SaveRecordViewRequest(Op(),renamed.Revision,new("","固定視窗",[field.Id],2,1));
    var viewSaved=await restarted.PostAsync<OperationResult>($"/api/records/{table.Id}/views",view);
    Check(viewSaved.Status=="committed"&&(await restarted.GetAsync<CollectionDto>("/api/records/"+table.Id)).Views.Any(v=>v.Name=="固定視窗"&&v.FrozenRows==2),"view settings persist through metadata command");
    var tableRetry=await restarted.PostAsync<OperationResult>("/api/records",createTable);
    Check(tableRetry.Revision==tableCreated.Revision,"collection create retry returns original durable result");
    var mergeA=await restarted.PostAsync<OperationResult>("/api/notes",new CreateNoteRequest(Op(),"Group A","## Inside A\n\nbody A"));
    var mergeB=await restarted.PostAsync<OperationResult>("/api/notes",new CreateNoteRequest(Op(),"Group B","## Inside B\n\nbody B"));
    var noteA=await restarted.GetAsync<NoteDto>("/api/notes/"+mergeA.NoteId);
    var noteB=await restarted.GetAsync<NoteDto>("/api/notes/"+mergeB.NoteId);
    var groupingSources=await restarted.GetAsync<GroupingSourceDto[]>("/api/grouping/sources");
    Check(groupingSources.Any(s=>s.Members.Any(n=>n.Id==noteA.Id)),"HTTP grouping sources expose physical paths and members");
    var groupPreview=await restarted.PostAsync<GroupingPreview>("/api/grouping/preview",new GroupingPreviewRequest("merge",[noteA.RelativePath!,noteB.RelativePath!],"HTTP Group.md",PreservationPath:"HTTP-preserved.json"));
    Check(groupPreview.CanApply,"HTTP grouping preview validates the full plan: "+string.Join(";",groupPreview.Warnings));
    var groupApply=new GroupingApplyRequest(Op(),groupPreview.PreviewId);
    var groupResult=await restarted.PostAsync<OperationResult>("/api/grouping/apply",groupApply);
    var groupedNote=await restarted.GetAsync<NoteDto>("/api/notes/"+noteB.Id);
    Check(groupResult.Status=="files-written"&&groupedNote.FileMembers?.Length==2&&groupedNote.RelativePath=="HTTP Group.md","HTTP grouping reconciles one physical file with two canonical notes");
    var destination=groupPreview.Members.Single(m=>m.NoteId==noteB.Id);
    var navigated=await restarted.PostAsync<ContentLinkDto>("/api/content/link",new ContentResolveRequest(noteA.Id,"./HTTP Group.md#"+destination.Anchor));
    Check(navigated.NoteId==noteB.Id&&navigated.Anchor is null,"HTTP grouped presentation link opens the correct member");
    var groupedReceipt=await restarted.GetAsync<OperationResult>("/api/receipts/"+groupApply.OperationId);
    Check(groupedReceipt.Status=="files-written","grouping receipt resolves after request completion");
    await restarted.ShutdownAsync();
    Check(restarted.ExitCode == 0, "restarted Host shuts down normally and releases workspace");
}
Console.WriteLine($"PASS: {passed} HTTP/process assertions. Workspace: {workspace}");
}
catch (Exception error)
{
    Console.Error.WriteLine(error);
    Environment.ExitCode = 1;
}

sealed record Handshake(int Port, string WorkspaceId, int ProtocolVersion);

sealed class HostProcess : IAsyncDisposable
{
    private readonly Process process;
    private readonly Task<string> stderr;
    private bool stopped;
    public string Credential { get; }
    public Handshake Handshake { get; }
    public HttpClient Client { get; }
    public int ExitCode => process.ExitCode;
    private HostProcess(Process process, Task<string> stderr, string credential, Handshake handshake)
    {
        this.process = process; this.stderr = stderr; Credential = credential; Handshake = handshake;
        Client = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{handshake.Port}"), Timeout = TimeSpan.FromSeconds(15) };
        Client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", credential);
    }
    public static async Task<HostProcess> StartAsync(string dll, string workspace)
    {
        var credential = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var start = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = Path.GetDirectoryName(dll)! };
        start.ArgumentList.Add(dll); start.ArgumentList.Add("--workspace"); start.ArgumentList.Add(workspace);
        var process = Process.Start(start) ?? throw new InvalidOperationException("Cannot launch Host.");
        var stderr = process.StandardError.ReadToEndAsync();
        try
        {
            await process.StandardInput.WriteLineAsync(credential); await process.StandardInput.FlushAsync(); process.StandardInput.Close();
            var line = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20));
            if (line is null) throw new InvalidOperationException("Host exited before startup handshake: " + await stderr);
            var handshake = JsonSerializer.Deserialize<Handshake>(line, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? throw new InvalidOperationException("Empty startup handshake.");
            return new(process, stderr, credential, handshake);
        }
        catch (Exception error)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            var diagnostic = await stderr.WaitAsync(TimeSpan.FromSeconds(5));
            process.Dispose();
            throw new InvalidOperationException("Host startup failed for " + workspace + ": " + diagnostic, error);
        }
    }
    public async Task<T> GetAsync<T>(string path)
    {
        using var response = await Client.GetAsync(path); response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>() ?? throw new InvalidOperationException("Empty JSON response: " + path);
    }
    public async Task<T> PostAsync<T>(string path, object payload)
    {
        using var response = await Client.PostAsJsonAsync(path, payload); response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>() ?? throw new InvalidOperationException("Empty JSON response: " + path);
    }
    public async Task<T> PutAsync<T>(string path, object payload)
    {
        using var response = await Client.PutAsJsonAsync(path, payload); response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>() ?? throw new InvalidOperationException("Empty JSON response: " + path);
    }
    public async Task ShutdownAsync()
    {
        using var response = await Client.PostAsync("/api/shutdown", null); response.EnsureSuccessStatusCode();
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15)); stopped = true;
        if (process.ExitCode != 0) throw new InvalidOperationException("Host shutdown failed: " + await stderr);
    }
    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        if (!stopped && !process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
        process.Dispose();
    }
}

sealed class EventStream : IAsyncDisposable
{
    private readonly HttpResponseMessage response;
    private readonly StreamReader reader;
    private EventStream(HttpResponseMessage response, Stream stream) { this.response = response; reader = new(stream); }
    public static async Task<EventStream> OpenAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/events", HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentType?.MediaType != "text/event-stream") throw new InvalidOperationException("Incorrect SSE content type.");
        return new(response, await response.Content.ReadAsStreamAsync());
    }
    public async Task<RevisionEvent> ReadAsync()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (await reader.ReadLineAsync(timeout.Token) is { } line)
            if (line.StartsWith("data: ", StringComparison.Ordinal))
                return JsonSerializer.Deserialize<RevisionEvent>(line[6..], new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? throw new InvalidOperationException("Empty SSE data.");
        throw new InvalidOperationException("SSE stream ended before expected revision.");
    }
    public ValueTask DisposeAsync() { reader.Dispose(); response.Dispose(); return ValueTask.CompletedTask; }
}
