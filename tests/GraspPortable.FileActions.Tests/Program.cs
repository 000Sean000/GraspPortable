using System.Text;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.ValueEngine;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Markdown;

var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces/FileActionsTests-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
var passed = 0; var failed = 0;
string Op() => Guid.NewGuid().ToString("N");
string Workspace(string name) { var path = Path.Combine(root, name); Directory.CreateDirectory(path); return path; }
void True(bool value, string message = "Assertion failed") { if (!value) throw new InvalidOperationException(message); }
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected {expected}, actual {actual}"); }
void Throws(Action action) { try { action(); } catch (Exception e) when (e is IOException or InvalidOperationException) { return; } throw new InvalidOperationException("Expected safe refusal."); }
async Task Check(string name, Func<Task> action)
{ try { await action(); passed++; } catch (Exception e) { failed++; Console.Error.WriteLine($"FAIL {name}: {e}"); } }
async Task Observe(MarkdownWorkspaceRepository repository, KnowledgeService knowledge)
{
    var scan = repository.Scan(knowledge.Current);
    True(scan.Issues.Count == 0, string.Join("; ", scan.Issues.Select(i => i.Message)));
    if (scan.Changes.Count > 0)
    {
        var op = Op(); using var lease = repository.BeginObservation(op, scan.States.Where(s => s.Exists).ToArray());
        Equal("source-observed", (await knowledge.ObserveExternalAsync(op, scan.Changes)).Status);
    }
    if (scan.MissingNoteIds.Count > 0)
    {
        var op = Op(); using var lease = repository.BeginObservation(op, scan.States.Where(s => !s.Exists).ToArray());
        Equal("source-observed", (await knowledge.ObserveDeletedAsync(op, scan.MissingNoteIds.ToDictionary(id => id, id => knowledge.Current.Notes[id].CurrentSourceHash))).Status);
    }
}
FileActionPreview Accept(WorkspaceFileActions actions, string action, string source, string target)
{ var result = actions.Preview(new(action, source, target)); True(result.CanApply, string.Join("; ", result.Warnings)); return result; }

await Check("plain Markdown rename embeds canonical IDs, preserves body and unknown YAML", async () =>
{
    var path = Workspace("plain");
    var raw = "---\ncustom: keep-me\n---\n正文\n@code{ @Fruit = {apple} }\n";
    File.WriteAllText(Path.Combine(path, "old.md"), raw, new UTF8Encoding(false));
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    await Observe(repository, knowledge);
    var noteId = knowledge.Current.Notes.Values.Single().Id; var definitionId = knowledge.Current.Definitions.Values.Single().Id;
    var actions = new WorkspaceFileActions(path, repository, knowledge);
    var preview = Accept(actions, "rename", "old.md", "new.md");
    var result = actions.Apply(new(Op(), preview.PreviewId)); Equal("files-written", result.Status);
    True(!File.Exists(Path.Combine(path, "old.md")));
    var text = File.ReadAllText(Path.Combine(path, "new.md")); var envelope = MarkdownEnvelopeCodec.Read(text);
    Equal(MarkdownEnvelopeCodec.Read(raw).Body, envelope.Body); True(text.Contains("custom: keep-me"));
    Equal(noteId, envelope.Metadata!.Notes.Single().Id); Equal(definitionId, envelope.Metadata.Notes.Single().Bindings["Fruit"]);
    await Observe(repository, knowledge);
    Equal(noteId, knowledge.Current.Notes.Values.Single().Id); Equal(definitionId, knowledge.Current.Definitions.Values.Single().Id);
    True(!actions.HasPendingOperations);
});

await Check("folder move preserves attachments, empty children and IDs", async () =>
{
    var path = Workspace("folder"); Directory.CreateDirectory(Path.Combine(path, "before/empty"));
    File.WriteAllText(Path.Combine(path, "before/a.md"), "@code{ @A = {one} }");
    File.WriteAllBytes(Path.Combine(path, "before/attachment.bin"), [0, 1, 2, 255]);
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
    var noteId = knowledge.Current.Notes.Values.Single().Id;
    var actions = new WorkspaceFileActions(path, repository, knowledge); var preview = Accept(actions, "move", "before", "after");
    actions.Apply(new(Op(), preview.PreviewId));
    True(!Directory.Exists(Path.Combine(path, "before"))); True(Directory.Exists(Path.Combine(path, "after/empty")));
    True(File.ReadAllBytes(Path.Combine(path, "after/attachment.bin")).SequenceEqual(new byte[] { 0, 1, 2, 255 }));
    await Observe(repository, knowledge); Equal(noteId, knowledge.Current.Notes.Values.Single().Id);
});

await Check("new directory receipt survives restart and does not re-create removed destination", () =>
{
    var path = Workspace("newfolder"); string operation = Op(), previewId;
    {
        var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
        var actions = new WorkspaceFileActions(path, repository, knowledge); previewId = Accept(actions, "new-folder", "", "new").PreviewId;
        actions.Apply(new(operation, previewId)); True(Directory.Exists(Path.Combine(path, "new")));
        True(!File.Exists(Path.Combine(path, "new/.grasp-folder-origin")));
        Directory.Delete(Path.Combine(path, "new"));
    }
    {
        var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
        var actions = new WorkspaceFileActions(path, repository, knowledge);
        Equal("files-written", actions.Apply(new(operation, previewId)).Status); True(!Directory.Exists(Path.Combine(path, "new")));
        True(actions.ReadReceipt(operation) is not null); Throws(() => actions.Apply(new(operation, Op())));
    }
    return Task.CompletedTask;
});

await Check("directory-created crash is recoverable using ownership proof", () =>
{
    var path = Workspace("newfolder-crash"); string operation = Op();
    {
        var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
        var actions = new WorkspaceFileActions(path, repository, knowledge); var preview = Accept(actions, "new-folder", "", "new");
        actions.CheckpointForTest = stage => { if (stage == "directory-created") throw new IOException("crash"); };
        Throws(() => actions.Apply(new(operation, preview.PreviewId))); True(actions.HasPendingOperations);
    }
    {
        var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
        var actions = new WorkspaceFileActions(path, repository, knowledge); Equal("files-written", actions.RecoverPending().Single().Status);
        True(Directory.Exists(Path.Combine(path, "new"))); True(!actions.HasPendingOperations);
    }
    return Task.CompletedTask;
});

await Check("external target after durable intent is not adopted as owned folder", () =>
{
    var path = Workspace("competing-folder");
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    var actions = new WorkspaceFileActions(path, repository, knowledge); var preview = Accept(actions, "new-folder", "", "new");
    actions.CheckpointForTest = stage => { if (stage == "intent-durable") throw new IOException("crash"); };
    Throws(() => actions.Apply(new(Op(), preview.PreviewId)));
    Directory.CreateDirectory(Path.Combine(path, "new")); File.WriteAllText(Path.Combine(path, "new/external.txt"), "other editor");
    var recovered = new WorkspaceFileActions(path, repository, knowledge);
    Equal("conflict", recovered.RecoverPending().Single().Status); Equal("other editor", File.ReadAllText(Path.Combine(path, "new/external.txt")));
    return Task.CompletedTask;
});

await Check("externally removed destination after create crash is not recreated", () =>
{
    var path = Workspace("removed-folder");
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
    var actions = new WorkspaceFileActions(path, repository, knowledge); var preview = Accept(actions, "new-folder", "", "new");
    actions.CheckpointForTest = stage => { if (stage == "directory-created") throw new IOException("crash"); };
    Throws(() => actions.Apply(new(Op(), preview.PreviewId)));
    File.Delete(Path.Combine(path, "new/.grasp-folder-origin")); Directory.Delete(Path.Combine(path, "new"));
    var recovered = new WorkspaceFileActions(path, repository, knowledge);
    Equal("conflict", recovered.RecoverPending().Single().Status); True(!Directory.Exists(Path.Combine(path, "new")));
    return Task.CompletedTask;
});

await Check("partial folder move resumes after restart", async () =>
{
    var path = Workspace("partial"); Directory.CreateDirectory(Path.Combine(path, "before"));
    File.WriteAllText(Path.Combine(path, "before/a.md"), "A"); File.WriteAllText(Path.Combine(path, "before/b.md"), "B");
    string noteId;
    {
        var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
        noteId = knowledge.Current.Notes.Values.First(n => n.Source == "A").Id;
        var actions = new WorkspaceFileActions(path, repository, knowledge); var preview = Accept(actions, "move", "before", "after");
        actions.FileCheckpointForTest = checkpoint => { if (checkpoint.Stage == "after-mutation") throw new IOException("crash"); };
        Throws(() => actions.Apply(new(Op(), preview.PreviewId))); True(actions.HasPendingOperations);
    }
    {
        var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
        var actions = new WorkspaceFileActions(path, repository, knowledge); Equal("files-written", actions.RecoverPending().Single().Status);
        await Observe(repository, knowledge); Equal(noteId, knowledge.Current.Notes.Values.First(n => n.Source == "A").Id);
        True(!Directory.Exists(Path.Combine(path, "before")));
    }
});

await Check("receipt crash followed by external edit never replays old output", async () =>
{
    var path = Workspace("receipt-gap"); File.WriteAllText(Path.Combine(path, "a.md"), "before");
    {
        var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
        var actions = new WorkspaceFileActions(path, repository, knowledge); var preview = Accept(actions, "move", "a.md", "b.md");
        actions.CheckpointForTest = stage => { if (stage == "receipt-durable") throw new IOException("crash"); };
        Throws(() => actions.Apply(new(Op(), preview.PreviewId)));
    }
    File.AppendAllText(Path.Combine(path, "b.md"), "\nexternal"); var expected = File.ReadAllBytes(Path.Combine(path, "b.md"));
    {
        var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository);
        var actions = new WorkspaceFileActions(path, repository, knowledge); actions.RecoverPending();
        True(File.ReadAllBytes(Path.Combine(path, "b.md")).SequenceEqual(expected)); True(!File.Exists(Path.Combine(path, "a.md")));
    }
});

await Check("hash / revision / destination guards and protected paths", async () =>
{
    var path = Workspace("guards"); File.WriteAllText(Path.Combine(path, "a.md"), "original");
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
    var actions = new WorkspaceFileActions(path, repository, knowledge);
    var preview = Accept(actions, "move", "a.md", "b.md"); File.AppendAllText(Path.Combine(path, "a.md"), " external");
    Throws(() => actions.Apply(new(Op(), preview.PreviewId))); True(!File.Exists(Path.Combine(path, "b.md"))); True(!actions.HasPendingOperations);
    await Observe(repository, knowledge); preview = Accept(actions, "move", "a.md", "b.md");
    File.WriteAllText(Path.Combine(path, "b.md"), "other"); Throws(() => actions.Apply(new(Op(), preview.PreviewId))); Equal("other", File.ReadAllText(Path.Combine(path, "b.md")));
    True(!actions.Preview(new("move", "a.md", "../escape.md")).CanApply);
    True(!actions.Preview(new("new-folder", "", ".git/unsafe")).CanApply);
    True(!actions.Preview(new("new-folder", "", "folder/.grasp/unsafe")).CanApply);
});

await Check("dirty draft blocks mutation and ambiguous wiki links block preview", async () =>
{
    var path = Workspace("links"); File.WriteAllText(Path.Combine(path, "a.md"), "original");
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
    var actions = new WorkspaceFileActions(path, repository, knowledge); var note = knowledge.Current.Notes.Values.Single();
    await knowledge.SaveDraftAsync(new(note.Id, Op(), 1, note.Revision, note.Title, "dirty", note.CurrentSourceHash));
    True(!actions.Preview(new("move", "a.md", "b.md")).CanApply);
    var path2 = Workspace("links-incoming"); File.WriteAllText(Path.Combine(path2, "a.md"), "original");
    Directory.CreateDirectory(Path.Combine(path2, "other")); File.WriteAllText(Path.Combine(path2, "other/a.md"), "second a");
    File.WriteAllText(Path.Combine(path2, "ref.md"), "[read](a.md)\n![[a]]");
    var repository2 = new MarkdownWorkspaceRepository(path2); using var knowledge2 = new KnowledgeService(repository2); await Observe(repository2, knowledge2);
    var actions2 = new WorkspaceFileActions(path2, repository2, knowledge2);
    var preview = actions2.Preview(new("rename", "a.md", "b.md")); True(!preview.CanApply); True(preview.Warnings.Any(w => w.Contains("ref.md")));
});

await Check("incoming links update exact spans while code / literal / cached values remain opaque", async () =>
{
    var path = Workspace("incoming-link-patches"); File.WriteAllText(Path.Combine(path, "a.md"), "Target");
    var opaque = "```md\n[demo](a.md)\n```\n`[code](a.md)`\n@code{ @Example = {[literal](a.md)} }\n"
        + ReferenceCodec.Serialize(ReferenceKind.Wiki, "Example", "[literal](a.md)") + "\n";
    var text = "[read](a.md#Part \"title\")\n[[a#Part|Alias]]\n[x][target]\n[target]: <a.md#anchor>\n" + opaque + "[outside](https://example.com/a.md)\n";
    File.WriteAllText(Path.Combine(path, "ref.md"), text);
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
    var actions = new WorkspaceFileActions(path, repository, knowledge); var preview = Accept(actions, "rename", "a.md", "b.md");
    True(preview.Changes.Any(c => c.Path == "ref.md" && c.Kind == "update-links"));
    actions.Apply(new(Op(), preview.PreviewId)); var changed = File.ReadAllText(Path.Combine(path, "ref.md"));
    True(changed.Contains("[read](b.md#Part \"title\")")); True(changed.Contains("[[b#Part|Alias]]")); True(changed.Contains("[target]: <b.md#anchor>"));
    True(changed.Contains(opaque)); True(changed.Contains("https://example.com/a.md"));
});

await Check("moving source and target together preserves internal relative links and repairs outward links", async () =>
{
    var path = Workspace("move-linked-folder"); Directory.CreateDirectory(Path.Combine(path, "from")); Directory.CreateDirectory(Path.Combine(path, "nested"));
    File.WriteAllText(Path.Combine(path, "outside.md"), "Outside");
    File.WriteAllText(Path.Combine(path, "from/a.md"), "[local](b.md#x) ![asset](picture.png) [out](../outside.md) [[from/b#x|Label]]");
    File.WriteAllText(Path.Combine(path, "from/b.md"), "B"); File.WriteAllBytes(Path.Combine(path, "from/picture.png"), [1, 2, 3]);
    File.WriteAllText(Path.Combine(path, "incoming.md"), "![see](from/picture.png) [[from/a|A]]");
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
    var actions = new WorkspaceFileActions(path, repository, knowledge); var preview = Accept(actions, "move", "from", "nested/to");
    actions.Apply(new(Op(), preview.PreviewId)); var moved = MarkdownEnvelopeCodec.Read(File.ReadAllText(Path.Combine(path, "nested/to/a.md"))).Body;
    True(moved.Contains("[local](b.md#x)")); True(moved.Contains("![asset](picture.png)")); True(moved.Contains("[out](../../outside.md)")); True(moved.Contains("[[nested/to/b#x|Label]]"));
    Equal("![see](nested/to/picture.png) [[nested/to/a|A]]", File.ReadAllText(Path.Combine(path, "incoming.md")));
});

await Check("link patch owner draft blocks preview; angle / balanced / encoded paths round trip", async () =>
{
    var path = Workspace("link-guards"); File.WriteAllText(Path.Combine(path, "a (one).md"), "Target");
    File.WriteAllText(Path.Combine(path, "links.md"), "[angle](<a (one).md#H>) [balanced](a%20(one).md)\n");
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
    var actions = new WorkspaceFileActions(path, repository, knowledge);
    var preview = Accept(actions, "rename", "a (one).md", "b (two).md");
    actions.Apply(new(Op(), preview.PreviewId));
    var written = File.ReadAllText(Path.Combine(path, "links.md"));
    True(written.Contains("[angle](<b %28two%29.md#H>)")); True(written.Contains("[balanced](b%20%28two%29.md)"));
    await Observe(repository, knowledge);
    var back = Accept(actions, "rename", "b (two).md", "a (one).md"); actions.Apply(new(Op(), back.PreviewId));
    await Observe(repository, knowledge);
    True(File.ReadAllText(Path.Combine(path, "links.md")).Contains("a%20%28one%29.md"));
    preview = Accept(actions, "rename", "a (one).md", "b (two).md");
    var owner = repository.LoadSourceFiles().Single(f => f.RelativePath == "links.md"); var note = knowledge.Current.Notes[owner.NoteId];
    await knowledge.SaveDraftAsync(new(note.Id, Op(), 1, note.Revision, note.Title, "dirty", note.CurrentSourceHash));
    Throws(() => actions.Apply(new(Op(), preview.PreviewId))); True(!File.Exists(Path.Combine(path, "b (two).md")));
    True(!actions.Preview(new("rename", "a (one).md", "b (two).md")).CanApply);
});

await Check("incomplete links / unsupported HTML and Markdown extension changes refuse safely", async () =>
{
    var path = Workspace("unsupported-links"); File.WriteAllText(Path.Combine(path, "a.md"), "A");
    File.WriteAllText(Path.Combine(path, "ref.md"), "[incomplete](a.md");
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
    var actions = new WorkspaceFileActions(path, repository, knowledge);
    True(!actions.Preview(new("rename", "a.md", "b.md")).CanApply);
    File.WriteAllText(Path.Combine(path, "ref.md"), "<img src=\"a.md\">\n"); await Observe(repository, knowledge);
    True(!actions.Preview(new("rename", "a.md", "b.md")).CanApply);
    True(!actions.Preview(new("rename", "a.md", "a.txt")).CanApply);
});

await Check("UTF16 source keeps encoding and exact body", async () =>
{
    var path = Workspace("utf16"); const string body = "中文\r\n\r\n@code{ @A = {value} }\r\n";
    File.WriteAllText(Path.Combine(path, "a.md"), body, new UnicodeEncoding(false, true));
    var repository = new MarkdownWorkspaceRepository(path); using var knowledge = new KnowledgeService(repository); await Observe(repository, knowledge);
    var actions = new WorkspaceFileActions(path, repository, knowledge); var preview = Accept(actions, "move", "a.md", "b.md");
    actions.Apply(new(Op(), preview.PreviewId)); var bytes = File.ReadAllBytes(Path.Combine(path, "b.md"));
    True(bytes.AsSpan().StartsWith(new byte[] { 0xff, 0xfe })); Equal(body, MarkdownEnvelopeCodec.Read(File.ReadAllText(Path.Combine(path, "b.md"))).Body);
});

Console.WriteLine($"File actions: {passed} passed, {failed} failed.");
Environment.ExitCode = failed == 0 ? 0 : 1;
