using System.Text.Json.Nodes;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Notifications;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Backups;

try
{
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces", "BackupManagerTests-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
var passed = 0; var failed = 0;
string Op() => Guid.NewGuid().ToString("N");
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected {expected}; got {actual}"); }
void True(bool value, string message = "Assertion failed") { if (!value) throw new InvalidOperationException(message); }
async Task Check(string name, Func<Task> test)
{
    try { await test(); passed++; Console.WriteLine("PASS " + name); }
    catch (Exception error) { failed++; Console.Error.WriteLine("FAIL " + name + ": " + error); }
}
Rig New(string name) => new(Path.Combine(root, name));

await Check("settings version and payload receipts survive manager restart", async () =>
{
    using var rig = New("settings"); using var manager = rig.Manager();
    var request = new BackupSettingsRequest(Op(), 0, 1, 2);
    Equal("updated", (await manager.UpdateSettingsAsync(request)).Status);
    Equal(1L, (await manager.ReadStatusAsync()).Options.Version);
    Equal("updated", (await manager.UpdateSettingsAsync(request)).Status);
    Equal("operation-conflict", (await manager.UpdateSettingsAsync(request with { RetainedCopies = 3 })).Status);
    Equal("version-conflict", (await manager.UpdateSettingsAsync(new(Op(), 0, 5, 3))).Status);
    Equal("invalid", (await manager.UpdateSettingsAsync(new(Op(), 1, 0, 3))).Status);
    using var restarted = rig.Manager();
    Equal("updated", (await restarted.UpdateSettingsAsync(request)).Status);
    Equal(new BackupOptionsDto(1, 1, 2), (await restarted.ReadStatusAsync()).Options);
});

await Check("only changed captures; event dirtiness, durable retry and retention", async () =>
{
    using var rig = New("changed"); using var manager = rig.Manager();
    Equal(false, (await manager.ReadStatusAsync()).HasPendingChanges);
    Equal("unchanged", (await manager.CaptureAsync(Op(), true)).Status);
    await rig.Create("One", "@code{ @Fruit = {apple} }");
    Equal(true, (await manager.ReadStatusAsync()).HasPendingChanges);
    var id = Op(); var first = await manager.CaptureAsync(id, true);
    Equal("published", first.Status); True(Directory.Exists(first.Path));
    Equal(false, (await manager.ReadStatusAsync()).HasPendingChanges);
    Equal(first.Path, (await manager.CaptureAsync(id, true)).Path);
    Equal("operation-conflict", (await manager.CaptureAsync(id, false)).Status);
    Equal("unchanged", (await manager.CaptureAsync(Op(), true)).Status);
    Equal(1, (await manager.ReadStatusAsync()).Generations.Length);
    Equal("updated", (await manager.UpdateSettingsAsync(new(Op(), 0, 1, 1))).Status);
    Equal(true, (await manager.ReadStatusAsync()).HasPendingChanges);
    manager.MarkChanged(); Equal("published", (await manager.CaptureAsync(Op(), true)).Status);
    Equal(false, (await manager.ReadStatusAsync()).HasPendingChanges);
    Equal(1, (await manager.ReadStatusAsync()).Generations.Length);
    using var restarted = rig.Manager();
    Equal(first.Path, (await restarted.CaptureAsync(id, true)).Path);
    Equal("unchanged", (await restarted.CaptureAsync(Op(), true)).Status);
});

await Check("failed capture retains the last generation and pending draft changes", async () =>
{
    using var rig = New("pending-failure"); using var manager = rig.Manager();
    var note = await rig.Create("Card", "committed");
    var first = await manager.CaptureAsync(Op(), true); Equal("published", first.Status);
    Equal(false, (await manager.ReadStatusAsync()).HasPendingChanges);
    var current = rig.Knowledge.Current.Notes[note];
    var draft = await rig.Knowledge.SaveDraftAsync(new(note, "session", 1, current.Revision, current.Title,
        "unfinished @code{", current.CurrentSourceHash));
    Equal("draft", draft.Status);
    manager.MarkChanged(); // Same accepted-draft notification as the Host HTTP route.
    var pending = await manager.ReadStatusAsync();
    Equal("ready", pending.Status); Equal(true, pending.HasPendingChanges);
    Equal(first.Path, pending.Generations.Single().Path);
    using (var captureLock = new FileStream(Path.Combine(rig.Path, ".grasp", "backups", ".capture.lock"),
        FileMode.Open, FileAccess.ReadWrite, FileShare.None))
    {
        Equal("rejected", (await manager.CaptureAsync(Op(), true)).Status);
        var failedStatus = await manager.ReadStatusAsync();
        Equal("failed", failedStatus.Status); Equal(true, failedStatus.HasPendingChanges);
        Equal(first.Path, failedStatus.Generations.Single().Path); True(Directory.Exists(first.Path));
    }
    Equal("published", (await manager.CaptureAsync(Op(), true)).Status);
    Equal(false, (await manager.ReadStatusAsync()).HasPendingChanges);
});

await Check("restore retries do not overwrite later target edits; reject foreign generations", async () =>
{
    using var rig = New("restore"); using var manager = rig.Manager();
    await rig.Create("Card", "original");
    var capture = await manager.CaptureAsync(Op()); Equal("published", capture.Status);
    var destination = Path.Combine(root, "restored"); var request = new RestoreBackupRequest(Op(), capture.Path!, destination);
    Equal("restored", (await manager.RestoreAsync(request)).Status);
    var note = Directory.GetFiles(destination, "*.md").Single(); File.WriteAllText(note, "later edit");
    Equal("restored", (await manager.RestoreAsync(request)).Status); Equal("later edit", File.ReadAllText(note));
    using var restarted = rig.Manager();
    Equal("restored", (await restarted.RestoreAsync(request)).Status);
    Equal("rejected", (await manager.RestoreAsync(new(Op(), destination, Path.Combine(root, "foreign")))).Status);
    Equal("rejected", (await manager.RestoreAsync(new(Op(), capture.Path!, destination))).Status);
});

await Check("capture publication before receipt is recovered without another generation", async () =>
{
    using var rig = New("capture-crash");
    string generation; string id = Op();
    using (var manager = rig.Manager())
    {
        await rig.Create("Card", "checkpoint");
        var result = await manager.CaptureAsync(id); Equal("published", result.Status); generation = result.Path!;
    }
    // Restore the exact pending manager record captured just before publication.
    var saved = Path.Combine(generation, "content", ".grasp", "backup-manager", "state.json");
    File.Copy(saved, Path.Combine(rig.Path, ".grasp", "backup-manager", "state.json"), true);
    using var restarted = rig.Manager();
    Equal(generation, (await restarted.CaptureAsync(id)).Path);
    Equal(1, (await restarted.ReadStatusAsync()).Generations.Length);
});

await Check("initial status verifies existing generations; running status never waits for coordinator", async () =>
{
    using var rig = New("status");
    using (var first = rig.Manager())
    { await rig.Create("Card", "status"); Equal("published", (await first.CaptureAsync(Op())).Status); }
    using var manager = rig.Manager();
    Equal(1, (await manager.ReadStatusAsync()).Generations.Length);
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var blocked = rig.Coordinator.MutateAsync(async () => { entered.SetResult(); await release.Task; return true; });
    await entered.Task;
    try
    {
        var capture = manager.CaptureAsync(Op());
        Equal("running", (await manager.ReadStatusAsync().WaitAsync(TimeSpan.FromSeconds(2))).Status);
        release.SetResult(); await blocked;
        Equal("published", (await capture).Status);
    }
    finally { release.TrySetResult(); await blocked; }
});

await Check("restore publication before manager receipt uses primitive durable receipt", async () =>
{
    using var rig = New("restore-crash");
    string generation; string id = Op(); var destination = Path.Combine(root, "restored-crash");
    using (var manager = rig.Manager())
    {
        await rig.Create("Card", "checkpoint"); generation = (await manager.CaptureAsync(Op())).Path!;
        Equal("restored", (await manager.RestoreAsync(new(id, generation, destination))).Status);
    }
    var statePath = Path.Combine(rig.Path, ".grasp", "backup-manager", "state.json");
    var state = JsonNode.Parse(File.ReadAllText(statePath))!; state["Operations"]![id]!["Result"] = null;
    File.WriteAllText(statePath, state.ToJsonString());
    File.WriteAllText(Directory.GetFiles(destination, "*.md").Single(), "later");
    using var restarted = rig.Manager();
    Equal("restored", (await restarted.RestoreAsync(new(id, generation, destination))).Status);
    Equal("later", File.ReadAllText(Directory.GetFiles(destination, "*.md").Single()));
});

await Check("startup draft marks dirty and malformed settings are never overwritten", async () =>
{
    using var rig = New("draft"); var note = await rig.Create("Card", "committed");
    using (var manager = rig.Manager()) Equal("published", (await manager.CaptureAsync(Op())).Status);
    var current = rig.Knowledge.Current.Notes[note];
    await rig.Knowledge.SaveDraftAsync(new(note, "session", 1, current.Revision, current.Title, "unfinished @code{", current.CurrentSourceHash));
    using (var restarted = rig.Manager())
    {
        Equal(true, (await restarted.ReadStatusAsync()).HasPendingChanges);
        Equal("published", (await restarted.CaptureAsync(Op(), true)).Status);
        Equal(false, (await restarted.ReadStatusAsync()).HasPendingChanges);
    }
    var path = Path.Combine(rig.Path, ".grasp", "backup-manager", "state.json"); File.WriteAllText(path, "broken");
    using var broken = rig.Manager(); Equal("rejected", (await broken.CaptureAsync(Op())).Status);
    Equal("broken", File.ReadAllText(path)); Equal("failed", (await broken.ReadStatusAsync()).Status);
});

await Check("shutdown capture observes an external edit before any watcher signal", async () =>
{
    using var rig = New("shutdown-observe"); using var manager = rig.Manager();
    var note = await rig.Create("Card", "before");
    Equal("published", (await manager.CaptureAsync(Op(), true)).Status);
    // The coordinator's watcher is deliberately not started: this models a delayed/missed event.
    var relative = rig.Repository.LoadSourceFiles().Single(s => s.NoteId == note).RelativePath;
    var physical = Path.Combine(rig.Path, relative);
    File.WriteAllText(physical, File.ReadAllText(physical).Replace("before", "after"));
    var capture = await manager.CaptureAsync(Op(), true);
    Equal("published", capture.Status);
    Equal("after", rig.Knowledge.Current.Notes[note].CurrentSource);
    True(File.ReadAllText(Path.Combine(capture.Path!, "content", relative)).Contains("after"));
});

await Check("settings-only change produces a checkpoint with recoverable new options", async () =>
{
    using var rig = New("settings-checkpoint");
    using (var manager = rig.Manager())
    {
        await rig.Create("Card", "unchanged note");
        Equal("published", (await manager.CaptureAsync(Op(), true)).Status);
        Equal("updated", (await manager.UpdateSettingsAsync(new(Op(), 0, 17, 2))).Status);
        Equal(true, (await manager.ReadStatusAsync()).HasPendingChanges);
    }
    // Even an abrupt stop after saving options must retain the need for a checkpoint.
    using var restarted = rig.Manager();
    Equal(true, (await restarted.ReadStatusAsync()).HasPendingChanges);
    var capture = await restarted.CaptureAsync(Op(), true); Equal("published", capture.Status);
    Equal(false, (await restarted.ReadStatusAsync()).HasPendingChanges);
    var destination = Path.Combine(root, "settings-restored");
    Equal("restored", (await restarted.RestoreAsync(new(Op(), capture.Path!, destination))).Status);
    var restored = JsonNode.Parse(File.ReadAllText(Path.Combine(destination, ".grasp", "backup-manager", "state.json")))!;
    Equal(1L, restored["Options"]!["Version"]!.GetValue<long>());
    Equal(17, restored["Options"]!["IntervalMinutes"]!.GetValue<int>());
    Equal(2, restored["Options"]!["RetainedCopies"]!.GetValue<int>());
});

Console.WriteLine($"{passed} passed, {failed} failed; evidence: {root}");
return failed == 0 ? 0 : 1;
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}

sealed class Rig : IDisposable
{
    public string Path { get; }
    public MarkdownWorkspaceRepository Repository { get; }
    public KnowledgeService Knowledge { get; }
    public WorkspaceCoordinator Coordinator { get; }
    public Rig(string path)
    {
        Path = path; Directory.CreateDirectory(path); Repository = new(path); Knowledge = new(Repository);
        Coordinator = new(Repository, Knowledge, new RevisionHub(), path);
    }
    public WorkspaceBackupManager Manager() => new(Path, Coordinator, Knowledge);
    public async Task<string> Create(string title, string source)
    {
        var result = await Coordinator.MutateAsync(() => Knowledge.CreateNoteAsync(Guid.NewGuid().ToString("N"), title, source));
        if (result.Status != "committed") throw new InvalidOperationException(result.Status + ": " + result.Message);
        return result.NoteId!;
    }
    public void Dispose() { Coordinator.Dispose(); Knowledge.Dispose(); Repository.Dispose(); }
}
