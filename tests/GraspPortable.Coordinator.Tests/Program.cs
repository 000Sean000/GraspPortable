using System.Diagnostics;
using System.Text;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Notifications;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Markdown;

var passed = 0;
var failed = 0;
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces", "CoordinatorTests-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
string Workspace(string name) { var path = Path.Combine(root, name); Directory.CreateDirectory(path); return path; }
string Op() => Guid.NewGuid().ToString("N");
void True(bool condition, string message = "Assertion failed") { if (!condition) throw new InvalidOperationException(message); }
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected [{expected}], actual [{actual}]."); }
async Task Check(string name, Func<Task> action)
{
    if (args.Length > 0 && !name.Contains(args[0], StringComparison.OrdinalIgnoreCase)) return;
    try { await action(); passed++; }
    catch (Exception exception) { failed++; Console.Error.WriteLine($"FAIL {name}: {exception}"); }
}
async Task<string> Create(WorkspaceCoordinator coordinator, KnowledgeService knowledge, string title, string text)
{
    var result = await coordinator.MutateAsync(() => knowledge.CreateNoteAsync(Op(), title, text));
    Equal("committed", result.Status); return result.NoteId!;
}
string FileFor(string path, MarkdownWorkspaceRepository repository, string id) => Path.Combine(path, repository.LoadSourceFiles().Single(f => f.NoteId == id).RelativePath);
void SetBody(string path, string body)
{
    var text = File.ReadAllText(path); var envelope = MarkdownEnvelopeCodec.Read(text);
    File.WriteAllText(path, text[..envelope.BodyStart] + body, new UTF8Encoding(false));
}
string? Value(KnowledgeService knowledge, string name) => knowledge.Current.Definitions.Values.Single(d => d.Name == name).Value;
async Task Until(Func<bool> predicate)
{
    var watch = Stopwatch.StartNew();
    while (!predicate())
    {
        if (watch.Elapsed > TimeSpan.FromSeconds(5)) throw new TimeoutException("Watcher did not reconcile within the bounded test window.");
        await Task.Delay(50);
    }
}

await Check("initial plain sources are indexed without byte rewriting; shared external update writes carriers", async () =>
{
    var path = Workspace("plain-and-shared");
    var plain = Path.Combine(path, "來源.md");
    var original = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes("---\r\n# comment\r\ntag: 保留\r\n---\r\n@code{ @Fruit = {apple} }\r\n")).ToArray();
    File.WriteAllBytes(plain, original);
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    using var coordinator = new WorkspaceCoordinator(repository, knowledge, new RevisionHub(), path);
    await coordinator.ReconcileAsync();
    Equal(1, knowledge.Current.Notes.Count); True(original.AsSpan().SequenceEqual(File.ReadAllBytes(plain)));
    var carrier = await Create(coordinator, knowledge, "Carrier", "[apple](:ref:Fruit)");
    var carrierFile = FileFor(path, repository, carrier);
    File.WriteAllText(plain, Encoding.UTF8.GetString(original).TrimStart('\uFEFF').Replace("{apple}", "{pear}"), new UTF8Encoding(true));
    await coordinator.ReconcileAsync();
    Equal("pear", Value(knowledge, "Fruit")); True(File.ReadAllText(carrierFile).Contains("[pear](:ref:Fruit)"));
    Equal(0, coordinator.Status.Issues.Length);
    SetBody(carrierFile, "[banana](:ref:Fruit)"); await coordinator.ReconcileAsync();
    Equal("banana", Value(knowledge, "Fruit")); True(File.ReadAllText(plain).Contains("{banana}"));
});

await Check("invalid metadata becomes unavailable without overwriting and exact-byte repair recovers", async () =>
{
    var path = Workspace("metadata"); var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    using var coordinator = new WorkspaceCoordinator(repository, knowledge, new RevisionHub(), path);
    var owner = await Create(coordinator, knowledge, "Owner", "@code{ @Fruit = {apple} }");
    var file = FileFor(path, repository, owner); var original = File.ReadAllBytes(file);
    File.WriteAllText(file, Encoding.UTF8.GetString(original).Replace("schema: 1", "schema: 900"));
    var invalid = File.ReadAllBytes(file); await coordinator.ReconcileAsync();
    Equal("unavailable", knowledge.Current.Notes[owner].SavedSource!.Status);
    True(knowledge.Current.Definitions.Values.Single().Status != "Valid");
    True(invalid.AsSpan().SequenceEqual(File.ReadAllBytes(file)));
    True(coordinator.Status.Issues.Any(i => i.Code == "metadata-schema"));
    var revision = knowledge.Current.Revision; await coordinator.ReconcileAsync(); Equal(revision, knowledge.Current.Revision);
    File.WriteAllBytes(file, original); await coordinator.ReconcileAsync();
    True(!knowledge.Current.Notes[owner].IsSourceStale, "repair to the exact previous bytes must clear unavailable state");
    Equal("Valid", knowledge.Current.Definitions.Values.Single().Status);
    True(original.AsSpan().SequenceEqual(File.ReadAllBytes(file))); Equal(0, coordinator.Status.Issues.Length);
});

await Check("clean deletion and changed dependent in one scan cannot starve each other", async () =>
{
    var path = Workspace("delete-order"); var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    using var coordinator = new WorkspaceCoordinator(repository, knowledge, new RevisionHub(), path);
    var owner = await Create(coordinator, knowledge, "Owner", "@code{ @Fruit = {apple} }");
    var dependent = await Create(coordinator, knowledge, "Dependent", "@code{ @Summary = Fruit + {!} }\n[apple](:ref:Fruit)");
    File.Delete(FileFor(path, repository, owner));
    SetBody(FileFor(path, repository, dependent), "ordinary new text\n@code{ @Summary = Fruit + {!} }\n[apple](:ref:Fruit)");
    await coordinator.ReconcileAsync();
    True(!knowledge.Current.Notes.ContainsKey(owner), "clean deletion was starved by changed dependent read guards");
    True(knowledge.Current.Notes[dependent].CurrentSource.StartsWith("ordinary new text"));
    True(knowledge.Current.Definitions.Values.Single(d => d.Name == "Summary").Status != "Valid");
    Equal(0, coordinator.Status.Issues.Length);
});

await Check("dirty deletion preserves draft and never recreates file", async () =>
{
    var path = Workspace("dirty-delete"); var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    using var coordinator = new WorkspaceCoordinator(repository, knowledge, new RevisionHub(), path);
    var owner = await Create(coordinator, knowledge, "Owner", "@code{ @Fruit = {apple} }");
    var note = knowledge.Current.Notes[owner]; var file = FileFor(path, repository, owner);
    await knowledge.SaveDraftAsync(new(owner, "session", 1, note.Revision, note.Title, "recoverable local draft", note.CurrentSourceHash));
    File.Delete(file); await coordinator.ReconcileAsync();
    Equal("missing", knowledge.Current.Notes[owner].SavedSource!.Status); True(knowledge.GetDraft(owner) is not null); True(!File.Exists(file));
    await Create(coordinator, knowledge, "Unrelated", "body"); True(!File.Exists(file));
});

await Check("unavailable mixed with changed dependent is reconciled as one source batch", async () =>
{
    var path = Workspace("unavailable-order"); var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    using var coordinator = new WorkspaceCoordinator(repository, knowledge, new RevisionHub(), path);
    var owner = await Create(coordinator, knowledge, "Owner", "@code{ @Fruit = {apple} }");
    var dependent = await Create(coordinator, knowledge, "Dependent", "@code{ @Summary = Fruit + {!} }");
    var ownerFile = FileFor(path, repository, owner);
    File.WriteAllText(ownerFile, File.ReadAllText(ownerFile).Replace("schema: 1", "schema: 900"));
    SetBody(FileFor(path, repository, dependent), "new text\n@code{ @Summary = Fruit + {!} }");
    var untouched = File.ReadAllBytes(ownerFile);
    await coordinator.ReconcileAsync();
    Equal("unavailable", knowledge.Current.Notes[owner].SavedSource?.Status);
    True(knowledge.Current.Notes[dependent].CurrentSource.StartsWith("new text"));
    True(knowledge.Current.Definitions.Values.Single(d => d.Name == "Summary").Status != "Valid");
    True(untouched.AsSpan().SequenceEqual(File.ReadAllBytes(ownerFile)));
    True(!coordinator.Status.Issues.Any(i => i.Code == "reconcile-pending"));
});

await Check("create subfolder and actual explorer paging/search share internal exclusions", async () =>
{
    var path = Workspace("explorer"); var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    using var coordinator = new WorkspaceCoordinator(repository, knowledge, new RevisionHub(), path);
    var operation = Op();
    var created = await coordinator.MutateAsync(async () =>
    {
        using var location = repository.BeginNewNoteLocation(operation, "世界觀/角色");
        return await knowledge.CreateNoteAsync(operation, "Triensa", "角色內容");
    });
    Equal("committed", created.Status);
    foreach (var name in new[] { "A.md", "B.md", "C.md" }) File.WriteAllText(Path.Combine(path, name), "plain");
    File.WriteAllBytes(Path.Combine(path, "image.png"), [1, 2, 3]);
    foreach (var name in new[] { ".grasp", ".git", "artifacts" })
    { Directory.CreateDirectory(Path.Combine(path, name)); File.WriteAllText(Path.Combine(path, name, "hidden.md"), "must not be indexed"); }
    await coordinator.ReconcileAsync();
    Equal(4, knowledge.Current.Notes.Count);
    var explorer = new WorkspaceFileExplorer(path, repository.LoadSourceFiles);
    var first = explorer.Read("", offset: 0, limit: 2);
    var second = explorer.Read("", offset: 2, limit: 2);
    Equal(5, first.Total); Equal(first.Total, second.Total); Equal(2, first.Entries.Length);
    True(!first.Entries.Select(e => e.RelativePath).Intersect(second.Entries.Select(e => e.RelativePath)).Any());
    True(first.Entries[0].IsDirectory); Equal("世界觀", first.Entries[0].RelativePath);
    var search = explorer.Read("", search: "Triensa"); Equal(1, search.Total);
    Equal("世界觀/角色/Triensa.md", search.Entries.Single().RelativePath); Equal(created.NoteId, search.Entries.Single().NoteId);
    var hidden = explorer.Read("", search: "hidden"); Equal(0, hidden.Total);
});

await Check("real watcher updates and its own derived write reaches a stable revision", async () =>
{
    var path = Workspace("watcher"); var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    var hub = new RevisionHub(); knowledge.Changed += hub.Publish;
    using var coordinator = new WorkspaceCoordinator(repository, knowledge, hub, path);
    var owner = await Create(coordinator, knowledge, "Owner", "@code{ @Fruit = {apple} }");
    var carrier = await Create(coordinator, knowledge, "Carrier", "[apple](:ref:Fruit)");
    await coordinator.StartAsync(CancellationToken.None);
    try
    {
        // BackgroundService starts ExecuteAsync on the pool in .NET 10.
        await Task.Delay(150);
        SetBody(FileFor(path, repository, owner), "@code{ @Fruit = {pear} }");
        await Until(() => Value(knowledge, "Fruit") == "pear");
        var carrierPath = FileFor(path, repository, carrier);
        True(File.ReadAllText(carrierPath).Contains("[pear](:ref:Fruit)"));
        var revision = knowledge.Current.Revision; var bytes = File.ReadAllBytes(carrierPath);
        await Task.Delay(650);
        Equal(revision, knowledge.Current.Revision); True(bytes.AsSpan().SequenceEqual(File.ReadAllBytes(carrierPath)));
        Equal(0, coordinator.Status.Issues.Length);
    }
    finally { using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5)); await coordinator.StopAsync(timeout.Token); }
});

Console.WriteLine($"Coordinator integration: {passed} passed, {failed} failed. Evidence: {root}");
return failed == 0 ? 0 : 1;
