using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Notifications;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Backups;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

static string? Argument(string name) { var args = Environment.GetCommandLineArgs(); var at = Array.IndexOf(args, name); return at >= 0 && at + 1 < args.Length ? args[at + 1] : null; }
var workspacePath = Path.GetFullPath(Argument("--workspace") ?? throw new ArgumentException("--workspace is required"));
var credential = await Console.In.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(15));
if (credential is null || credential.Length < 32) throw new ArgumentException("Startup credential required on stdin.");
var credentialBytes = Encoding.UTF8.GetBytes("Bearer " + credential);
string? migratedFrom = null;
if(Directory.Exists(workspacePath) && LegacyWorkspaceMigration.IsLegacy(workspacePath))
{
    migratedFrom = workspacePath;
    workspacePath = LegacyWorkspaceMigration.MigrateToNewFolder(workspacePath).Path;
}
if(File.Exists(Path.Combine(workspacePath,".grasp/migration/intent.json")) && !File.Exists(Path.Combine(workspacePath,".grasp/migration/completed.json")))
    throw new IOException("這是尚未完成遷移的資料夾，請先處理遷移診斷："+workspacePath);
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.ConfigureKestrel(options => { options.Listen(IPAddress.Loopback, 0); options.Limits.MaxRequestBodySize = 16 * 1024 * 1024; });
builder.Services.AddSingleton(new MarkdownWorkspaceRepository(workspacePath));
builder.Services.AddSingleton<IWorkspaceRepository>(sp => sp.GetRequiredService<MarkdownWorkspaceRepository>());
builder.Services.AddSingleton<KnowledgeService>();
builder.Services.AddSingleton<WorkspaceRecords>();
builder.Services.AddSingleton(sp=>new WorkspaceRecordImport(workspacePath,sp.GetRequiredService<MarkdownWorkspaceRepository>(),sp.GetRequiredService<KnowledgeService>()));
builder.Services.AddSingleton<RevisionHub>();
builder.Services.AddSingleton(sp => new WorkspaceFileExplorer(workspacePath, sp.GetRequiredService<MarkdownWorkspaceRepository>().LoadSourceFiles));
builder.Services.AddSingleton(sp => new WorkspaceContentResolver(workspacePath, () => WorkspaceContentResolver.DescribeSources(
    sp.GetRequiredService<MarkdownWorkspaceRepository>().LoadSourceFiles(),sp.GetRequiredService<KnowledgeService>().Current.Languages)));
builder.Services.AddSingleton(sp => new WorkspaceFileActions(workspacePath, sp.GetRequiredService<MarkdownWorkspaceRepository>(), sp.GetRequiredService<KnowledgeService>()));
builder.Services.AddSingleton(sp => new WorkspaceGrouping(workspacePath, sp.GetRequiredService<MarkdownWorkspaceRepository>(), sp.GetRequiredService<KnowledgeService>()));
builder.Services.AddSingleton(sp => new WorkspaceCoordinator(sp.GetRequiredService<MarkdownWorkspaceRepository>(), sp.GetRequiredService<KnowledgeService>(), sp.GetRequiredService<RevisionHub>(), workspacePath, sp.GetRequiredService<WorkspaceFileActions>(),sp.GetRequiredService<WorkspaceGrouping>()));
builder.Services.AddHostedService(sp => sp.GetRequiredService<WorkspaceCoordinator>());
builder.Services.AddSingleton(sp => new WorkspaceBackupManager(workspacePath, sp.GetRequiredService<WorkspaceCoordinator>(), sp.GetRequiredService<KnowledgeService>()));
builder.Services.AddHostedService(sp => sp.GetRequiredService<WorkspaceBackupManager>());
var app = builder.Build();
var knowledge = app.Services.GetRequiredService<KnowledgeService>();
var hub = app.Services.GetRequiredService<RevisionHub>();
var markdown = app.Services.GetRequiredService<MarkdownWorkspaceRepository>();
var coordinator = app.Services.GetRequiredService<WorkspaceCoordinator>();
var explorer = app.Services.GetRequiredService<WorkspaceFileExplorer>();
var content = app.Services.GetRequiredService<WorkspaceContentResolver>();
var fileActions = app.Services.GetRequiredService<WorkspaceFileActions>();
var grouping = app.Services.GetRequiredService<WorkspaceGrouping>();
var records = app.Services.GetRequiredService<WorkspaceRecords>();
var recordImport=app.Services.GetRequiredService<WorkspaceRecordImport>();
var backups = app.Services.GetRequiredService<WorkspaceBackupManager>();
coordinator.PhysicalFilesChanged += backups.MarkChanged;
knowledge.Changed += hub.Publish;
fileActions.RecoverPending();
grouping.RecoverPending();
await coordinator.ReconcileAsync();
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
app.Use(async (context, next) =>
{
    var supplied = Encoding.UTF8.GetBytes(context.Request.Headers.Authorization.ToString());
    if (!CryptographicOperations.FixedTimeEquals(supplied, credentialBytes)) { context.Response.StatusCode = 401; return; }
    // The API is for the native .NET client, not browser-origin requests.
    if (context.Request.Headers.ContainsKey("Origin")) { context.Response.StatusCode = 403; return; }
    try { await next(); }
    catch (KeyNotFoundException error) { context.Response.StatusCode = 404; await context.Response.WriteAsJsonAsync(new ApiError(error.Message)); }
    catch (ArgumentException error) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new ApiError(error.Message)); }
    catch (IOException error) { context.Response.StatusCode = 409; await context.Response.WriteAsJsonAsync(new ApiError(error.Message)); }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (Exception error)
    {
        Console.Error.WriteLine(error);
        if (!context.Response.HasStarted) { context.Response.StatusCode = 500; await context.Response.WriteAsJsonAsync(new ApiError("操作失敗；尚未確認儲存，請保留草稿並查詢操作狀態。")); }
    }
});
DiagnosticDto Diag(GraspPortable.Core.ValueEngine.ParseDiagnostic d) => new(d.Code, d.Message, d.Span.Start, d.Span.Length);
OperationResult Result(Receipt receipt) => new(receipt.OperationId, receipt.Status, receipt.Revision, receipt.NoteId, receipt.Message, receipt.Diagnostics?.Select(Diag).ToArray(), receipt.AffectedNoteIds);
DefinitionDto Definition(KnowledgeDefinition d) => new(d.Id, d.NoteId, d.Name, d.Value, d.Status, d.IsLiteral, d.Span.Start, d.Span.Length, d.NameSpan.Start, d.NameSpan.Length, d.LastGoodValue,
    d.FieldOrigin?.RecordId,d.FieldOrigin?.FieldId,d.IsLiteral || d.FieldOrigin is not null && knowledge.Current.Notes[d.NoteId].Syntax.Definitions
        .Single(x=>x.Name==d.Name).Parts.All(p=>p.Kind==GraspPortable.Core.ValueEngine.PartKind.Literal));
ReferenceDto Reference(string noteId, GraspPortable.Core.ValueEngine.ParsedReference r) => new(noteId, r.Name, r.Kind.ToString(), r.CachedValue, r.Span.Start, r.Span.Length, r.ValueSpan.Start, r.ValueSpan.Length,
    knowledge.Current.Definitions.Values.FirstOrDefault(d=>d.Name==r.Name)?.NoteId);
ImpactDto Impact(Impact impact) => new(impact.Revision, impact.NoteIds, impact.Definitions, impact.References, impact.HasDirtyDraft, impact.Message);
app.MapGet("/api/workspace", () => { var s = knowledge.Current; return new WorkspaceInfo(s.WorkspaceId, workspacePath, s.Revision, s.PolicyRevision, s.Languages, MigratedFrom: migratedFrom); });
app.MapGet("/api/workspace/sources", () => coordinator.Status);
app.MapGet("/api/records",()=>records.ListCollections());
app.MapGet("/api/records/tags",(string? search,int? offset,int? limit,HttpContext context)=>
    records.SearchTags(search,offset??0,limit??50,context.RequestAborted));
app.MapPost("/api/record-import/preview",async(RecordImportPreviewRequest request,HttpContext context)=>
    await coordinator.MutateAsync(()=>Task.FromResult(recordImport.Preview(request)),context.RequestAborted));
app.MapPost("/api/record-import/apply",async(RecordImportApplyRequest request,HttpContext context)=>
    await coordinator.MutateAsync(()=>recordImport.ApplyAsync(request,context.RequestAborted),context.RequestAborted));
app.MapGet("/api/records/{id}",(string id)=>records.Read(id));
app.MapPost("/api/records",async(CreateCollectionRequest request,HttpContext context)=>
    await coordinator.MutateAsync(()=>records.CreateAsync(request,context.RequestAborted),context.RequestAborted));
app.MapPost("/api/records/{id}/rows",async(string id,AddRecordRequest request,HttpContext context)=>
    await coordinator.MutateAsync(()=>records.AddRecordAsync(id,request,context.RequestAborted),context.RequestAborted));
app.MapPost("/api/records/{id}/fields",async(string id,UpsertRecordFieldRequest request,HttpContext context)=>
    await coordinator.MutateAsync(()=>records.UpsertFieldAsync(id,request,context.RequestAborted),context.RequestAborted));
app.MapPost("/api/records/{id}/rows/{recordId}",async(string id,string recordId,RenameRecordRequest request,HttpContext context)=>
    await coordinator.MutateAsync(()=>records.RenameRecordAsync(id,recordId,request,context.RequestAborted),context.RequestAborted));
app.MapPost("/api/records/rows/{recordId}/fields/{fieldId}",async(string recordId,string fieldId,RecordFieldChangeRequest request,HttpContext context)=>
    await coordinator.MutateAsync(()=>records.ChangeFieldAsync(recordId,fieldId,request,context.RequestAborted),context.RequestAborted));
app.MapPost("/api/records/rows/{recordId}/fields/{fieldId}/conversion-preview",async(string recordId,string fieldId,PreviewRecordFieldConversionRequest request,HttpContext context)=>
    await coordinator.MutateAsync(()=>Task.FromResult(records.PreviewFieldConversion(recordId,fieldId,request)),context.RequestAborted));
app.MapPost("/api/records/{id}/views",async(string id,SaveRecordViewRequest request,HttpContext context)=>
    await coordinator.MutateAsync(()=>records.SaveViewAsync(id,request,context.RequestAborted),context.RequestAborted));
app.MapPost("/api/content/link", (ContentResolveRequest request) => content.ResolveLink(request));
app.MapPost("/api/content/image", (ContentResolveRequest request) => content.ReadImage(request));
app.MapGet("/api/files", (string? parent, int? offset, int? limit, string? search, HttpContext context) => explorer.Read(parent, offset ?? 0, limit ?? 100, search, context.RequestAborted));
app.MapGet("/api/grouping/sources",()=> {
    var s=knowledge.Current;
    return markdown.LoadSourceFiles().Where(f=>f.Exists).OrderBy(f=>f.RelativePath).Select(f=>new GroupingSourceDto(f.RelativePath,f.IsGrouped,
        f.NoteIds.Where(s.Notes.ContainsKey).Select(id=>new NoteSummary(id,s.Notes[id].Title,s.Notes[id].Revision,knowledge.GetDraft(id)is not null)).ToArray())).ToArray();
});
app.MapPost("/api/grouping/preview",async(GroupingPreviewRequest request,HttpContext context)=>await coordinator.MutateAsync(()=>Task.FromResult(grouping.Preview(request)),context.RequestAborted));
app.MapPost("/api/grouping/apply",async(GroupingApplyRequest request,HttpContext context)=>{
    var result=await coordinator.MutateAsync(()=>Task.FromResult(grouping.Apply(request)),context.RequestAborted);
    backups.MarkChanged(); await coordinator.ReconcileAsync();
    hub.Publish(new(knowledge.Current.Revision,[],knowledge.Current.PolicyRevision));
    return result with{Revision=knowledge.Current.Revision};
});
app.MapPost("/api/files/preview", async (FileActionPreviewRequest request, HttpContext context) => await coordinator.MutateAsync(() => Task.FromResult(fileActions.Preview(request)), context.RequestAborted));
app.MapPost("/api/files/apply", async (FileActionApplyRequest request, HttpContext context) => {
    var result = await coordinator.MutateAsync(() => Task.FromResult(fileActions.Apply(request)), context.RequestAborted);
    backups.MarkChanged();
    await coordinator.ReconcileAsync();
    hub.Publish(new(knowledge.Current.Revision, [], knowledge.Current.PolicyRevision));
    return result with { Revision = knowledge.Current.Revision };
});
app.MapGet("/api/notes", (string? search) => knowledge.Current.Notes.Values.Where(n => string.IsNullOrWhiteSpace(search) || n.Title.Contains(search, StringComparison.OrdinalIgnoreCase)).OrderBy(n => n.Title).Select(n => new NoteSummary(n.Id, n.Title, n.Revision, knowledge.GetDraft(n.Id) is not null)).ToArray());
app.MapGet("/api/notes/{id}", (string id) =>
{
    var s = knowledge.Current; var note = s.Notes[id]; var draft = knowledge.GetDraft(id);
    var file=markdown.LoadSourceFiles().FirstOrDefault(f=>f.NoteIds.Contains(id));
    var syntax = note.IsSourceStale ? GraspPortable.Core.Records.RecordNoteSyntax.Parse(note.CurrentSource,note.CurrentRecords,s.Languages) : note.Syntax;
    return new NoteDto(id, note.Title, note.CurrentSource, note.Revision, s.Revision, draft is null ? null : new(draft.SessionId, draft.Revision, draft.BaseNoteRevision, draft.Source, draft.Title, draft.BaseSourceHash),
        s.Definitions.Values.Where(d => d.NoteId == id).Select(d => note.IsSourceStale ? Definition(d) with { Start=0, Length=0, NameStart=0, NameLength=0 } : Definition(d)).ToArray(),
        note.IsSourceStale ? [] : syntax.References.Select(r => Reference(id, r)).ToArray(), note.Diagnostics.Select(Diag).ToArray(),
        (syntax.Regions ?? []).Select(r => new RegionDto(r.Span.Start, r.Span.Length, r.IsComplete)).ToArray(),
        note.CurrentSourceHash, note.SavedSource?.Status ?? "accepted", file?.RelativePath,
        file?.IsGrouped==true?file.NoteIds.Where(s.Notes.ContainsKey).Select(n=>new NoteSummary(n,s.Notes[n].Title,s.Notes[n].Revision,knowledge.GetDraft(n)is not null)).ToArray():null);
});
app.MapPost("/api/notes", async (CreateNoteRequest request, HttpContext context) => Result(await coordinator.MutateAsync(async () => {
    using var location = markdown.BeginNewNoteLocation(request.OperationId, request.ParentPath);
    return await knowledge.CreateNoteAsync(request.OperationId, request.Title, request.Source, context.RequestAborted);
}, context.RequestAborted)));
app.MapPut("/api/notes/{id}/draft", async (string id, SaveDraftRequest request) => {
    var result = await knowledge.SaveDraftAsync(new(id, request.SessionId, request.DraftRevision, request.BaseNoteRevision, request.Title, request.Source, request.BaseSourceHash));
    if(result.Status == "draft") backups.MarkChanged();
    return Result(result);
});
app.MapPost("/api/notes/{id}/commit", async (string id, CommitNoteRequest request, HttpContext context) => Result(await coordinator.MutateAsync(() => knowledge.CommitNoteAsync(new(request.OperationId, id, request.SessionId, request.DraftRevision, request.ExpectedNoteRevision, request.ExpectedKnowledgeRevision, request.ConfirmRename), context.RequestAborted), context.RequestAborted)));
app.MapGet("/api/definitions", () => knowledge.Current.Definitions.Values.OrderBy(d => d.Name).Select(Definition).ToArray());
app.MapGet("/api/definitions/{id}/impact", (string id) => Impact(knowledge.LiteralImpact(id)));
app.MapGet("/api/definitions/{id}/references", (string id) => { var s = knowledge.Current; var name = s.Definitions[id].Name; return s.Notes.Values.SelectMany(n => n.Syntax.References.Where(r => r.Name == name).Select(r => Reference(n.Id, r))).ToArray(); });
app.MapPost("/api/definitions/{id}/literal", async (string id, LiteralChangeRequest request, HttpContext context) => Result(await coordinator.MutateAsync(() => knowledge.ChangeLiteralAsync(request.OperationId, id, request.ExpectedKnowledgeRevision, request.Value, context.RequestAborted), context.RequestAborted)));
app.MapPost("/api/policy/preview", (PolicyRequest request) => Impact(knowledge.PolicyImpact(request.EnabledFenceLanguages)));
app.MapPost("/api/policy", async (PolicyRequest request, HttpContext context) => Result(await coordinator.MutateAsync(() => knowledge.ChangePolicyAsync(request.OperationId, request.ExpectedKnowledgeRevision, request.EnabledFenceLanguages, context.RequestAborted), context.RequestAborted)));
app.MapGet("/api/receipts/{id}", (string id) => knowledge.GetReceipt(id) is { } receipt ? Result(receipt) : fileActions.ReadReceipt(id) ?? grouping.ReadReceipt(id) ?? new OperationResult(id, "unknown", knowledge.Current.Revision));
app.MapGet("/api/backups", async () => await backups.ReadStatusAsync());
app.MapPost("/api/backups/capture", async (CheckpointRequest request, HttpContext context) => await backups.CaptureAsync(request.OperationId, request.OnlyIfChanged, context.RequestAborted));
app.MapPost("/api/backups/settings", async (BackupSettingsRequest request) => await backups.UpdateSettingsAsync(request));
app.MapPost("/api/backups/restore", async (RestoreBackupRequest request) => await backups.RestoreAsync(request));
app.MapGet("/api/events", async (HttpContext context) =>
{
    context.Response.ContentType = "text/event-stream"; context.Response.Headers.CacheControl = "no-store";
    var subscription = hub.Subscribe();
    try
    {
        async Task Send(ChangeNotice notice) { await context.Response.WriteAsync($"data: {JsonSerializer.Serialize(new RevisionEvent(notice.Revision, notice.NoteIds, notice.PolicyRevision), json)}\n\n", context.RequestAborted); await context.Response.Body.FlushAsync(context.RequestAborted); }
        var s = knowledge.Current; await Send(new(s.Revision, [], s.PolicyRevision));
        await foreach (var notice in subscription.Reader.ReadAllAsync(context.RequestAborted)) await Send(notice);
    }
    finally { hub.Unsubscribe(subscription.Id); }
});
app.MapPost("/api/shutdown", async () => { await backups.CaptureAsync(Guid.NewGuid().ToString("N"), true); await knowledge.DrainAsync(); app.Lifetime.StopApplication(); return Results.Ok(); });
await app.StartAsync();
var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
Console.WriteLine(JsonSerializer.Serialize(new { port = new Uri(address).Port, workspaceId = knowledge.Current.WorkspaceId, protocolVersion = Protocol.Version }));
Console.Out.Flush();
if (int.TryParse(Argument("--parent-pid"), out var parentId))
{
    _ = Task.Run(async () => { try { using var parent = Process.GetProcessById(parentId); await parent.WaitForExitAsync(); } catch (ArgumentException) { } finally { await backups.CaptureAsync(Guid.NewGuid().ToString("N"), true); await knowledge.DrainAsync(); app.Lifetime.StopApplication(); } });
}
await app.WaitForShutdownAsync();
