using System.Text;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Notifications;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Backups;
using GraspPortable.Host.Workspace.Markdown;

try
{
var passed = 0; var failed = 0;
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces", "GroupingServiceTests-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
string Op() => Guid.NewGuid().ToString("N");
void True(bool ok, string message = "Assertion failed") { if (!ok) throw new InvalidOperationException(message); }
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected [{expected}] actual [{actual}]"); }
async Task Check(string name, Func<Task> test) { try { await test(); passed++; } catch (Exception error) { failed++; Console.Error.WriteLine("FAIL " + name + ": " + error); } }
async Task<Fixture> Open(string name, string a = "Alpha\r\n\r\nexact tail", string b = "Beta\n")
{
    var path = Path.Combine(root, name); Directory.CreateDirectory(path);
    File.WriteAllText(Path.Combine(path, "A.md"), a, new UTF8Encoding(false)); File.WriteAllText(Path.Combine(path, "B.md"), b, new UTF8Encoding(false));
    var repository = new MarkdownWorkspaceRepository(path); var knowledge = new KnowledgeService(repository);
    var coordinator = new WorkspaceCoordinator(repository, knowledge, new RevisionHub(), path); await coordinator.ReconcileAsync();
    return new(path, repository, knowledge, coordinator, new(path, repository, knowledge));
}
GroupingPreview Merge(Fixture f) => f.Grouping.Preview(new("merge", ["A.md", "B.md"], "Together.md", PreservationPath: "preserved.json"));
void Ready(GroupingPreview preview) => True(preview.CanApply, string.Join("; ", preview.Warnings));

await Check("merge and split preserve identities exact bodies YAML and incoming/outgoing links", async () =>
{
    using var f = await Open("roundtrip", "---\r\n# original comment\r\ncustom: \"中文😀\"\r\n---\r\n@code{ @Fruit = {apple} }\r\n\r\n[A to B](B.md)", "## Inner heading\nBeta\n\nlast");
    File.WriteAllText(Path.Combine(f.Path, "Reader.md"), "[[A]] / [B](B.md)"); await f.Coordinator.ReconcileAsync();
    var ids = f.Repository.LoadSourceFiles().ToDictionary(s => s.RelativePath, s => s.NoteId);
    var definition = f.Knowledge.Current.Definitions.Values.Single().Id;
    var preview = Merge(f); Ready(preview); var op = Op();
    Equal("files-written", f.Grouping.Apply(new(op, preview.PreviewId)).Status); Equal("files-written", f.Grouping.Apply(new(op, preview.PreviewId)).Status);
    await f.Coordinator.ReconcileAsync();
    True(!File.Exists(Path.Combine(f.Path, "A.md"))); True(!File.Exists(Path.Combine(f.Path, "B.md")));
    var together = File.ReadAllText(Path.Combine(f.Path, "Together.md"));
    var envelope = MarkdownEnvelopeCodec.Read(together); Equal(2, envelope.Metadata!.Notes.Count);
    True(together.Contains("中文😀") || together.Contains("\\U0001F600"), "unknown YAML should survive");
    Equal(definition, f.Knowledge.Current.Definitions.Values.Single().Id);
    True(File.ReadAllText(Path.Combine(f.Path, "Reader.md")).Contains("Together"));
    True(GroupingMetadataCodec.ReadPresentationAnchors(together).Count == 2);
    var contentSources = WorkspaceContentResolver.DescribeSources(f.Repository.LoadSourceFiles(), f.Knowledge.Current.Languages);
    var resolver = new WorkspaceContentResolver(f.Path, () => contentSources);
    var bSource = contentSources.Single(s => s.NoteId == ids["B.md"]);
    True(bSource.IsGroupMember && bSource.PresentationAnchor is not null && bSource.HeadingAnchors!.Contains("Inner heading"));
    Equal(ids["B.md"], resolver.ResolveLink(new(ids["Reader.md"], "Together.md#" + Uri.EscapeDataString(bSource.PresentationAnchor!))).NoteId);
    Equal(ids["B.md"], resolver.ResolveLink(new(ids["Reader.md"], "Together.md#Inner%20heading")).NoteId);
    Equal(ids["A.md"], resolver.ResolveLink(new(ids["Reader.md"], "Together.md")).NoteId);
    var capture = new WorkspaceBackups(f.Path).Capture();
    Equal("published", capture.Status);
    var nl = envelope.NewLine;
    File.WriteAllText(Path.Combine(f.Path, "Together.md"), together.Insert(3 + nl.Length, "sharedGroup: keep-this" + nl) + nl + "Independent group paragraph" + nl, new UTF8Encoding(false));
    await f.Coordinator.ReconcileAsync();
    var split = f.Grouping.Preview(new("split", ["Together.md"], SplitTargets: [new(ids["A.md"], "A2.md"), new(ids["B.md"], "B2.md")], PreservationPath: "preserved.json"));
    Ready(split); f.Grouping.Apply(new(Op(), split.PreviewId)); await f.Coordinator.ReconcileAsync();
    var a = File.ReadAllText(Path.Combine(f.Path, "A2.md")); var b = File.ReadAllText(Path.Combine(f.Path, "B2.md"));
    Equal(ids["A.md"], MarkdownEnvelopeCodec.Read(a).Metadata!.Notes.Single().Id);
    Equal(ids["B.md"], MarkdownEnvelopeCodec.Read(b).Metadata!.Notes.Single().Id);
    Equal("## Inner heading\nBeta\n\nlast", MarkdownEnvelopeCodec.Read(b).Body);
    True(a.Contains("custom:")); True(a.Contains("B2.md")); True(!a.Contains("presentationAnchor"));
    True(File.Exists(Path.Combine(f.Path, "preserved.json"))); Equal(0, f.Coordinator.Status.Issues.Length);
    var preserved = File.ReadAllText(Path.Combine(f.Path, "preserved.json"));
    True(preserved.Contains("keep-this") && preserved.Contains("Independent group paragraph"));
    var splitSources = WorkspaceContentResolver.DescribeSources(f.Repository.LoadSourceFiles(), f.Knowledge.Current.Languages);
    True(splitSources.All(s => !s.IsGroupMember));
    Equal(ids["B.md"], new WorkspaceContentResolver(f.Path, () => splitSources).ResolveLink(new(ids["Reader.md"], "B2.md")).NoteId);
});

await Check("draft and changed incoming source block apply without writing", async () =>
{
    using var f = await Open("guards"); File.WriteAllText(Path.Combine(f.Path, "Reader.md"), "[[A]]"); await f.Coordinator.ReconcileAsync();
    var preview = Merge(f); Ready(preview);
    File.AppendAllText(Path.Combine(f.Path, "Reader.md"), " external");
    try { f.Grouping.Apply(new(Op(), preview.PreviewId)); throw new Exception("guard accepted changed source"); } catch (IOException) { }
    True(File.Exists(Path.Combine(f.Path, "A.md"))); True(!f.Grouping.HasPendingOperations);
    await f.Coordinator.ReconcileAsync();
    var reader = f.Knowledge.Current.Notes.Values.Single(n => n.Title == "Reader");
    await f.Knowledge.SaveDraftAsync(new(reader.Id, "session", 1, reader.Revision, reader.Title, reader.CurrentSource + " dirty", reader.CurrentSourceHash));
    True(!Merge(f).CanApply);
});

await Check("new incoming inventory after preview blocks apply", async () =>
{
    using var f = await Open("inventory"); var preview = Merge(f); Ready(preview);
    File.WriteAllText(Path.Combine(f.Path, "New.md"), "[[A]]");
    try { f.Grouping.Apply(new(Op(), preview.PreviewId)); throw new Exception("new incoming ignored"); } catch (IOException) { }
    True(File.Exists(Path.Combine(f.Path, "A.md")));
});

await Check("partial writes recover same operation and receipt does not overwrite late edit", async () =>
{
    using var f = await Open("recovery"); var preview = Merge(f); Ready(preview); var op = Op(); var mutations = 0;
    f.Grouping.FileCheckpointForTest = checkpoint => { if (checkpoint.Stage == "before-mutation" && ++mutations == 2) throw new IOException("injected power loss"); };
    try { f.Grouping.Apply(new(op, preview.PreviewId)); } catch (IOException) { }
    True(f.Grouping.HasPendingOperations);
    var recovery = new WorkspaceGrouping(f.Path, f.Repository, f.Knowledge);
    var results = recovery.RecoverPending(); Equal("files-written", results.Single().Status); True(!recovery.HasPendingOperations);
    await f.Coordinator.ReconcileAsync();
    File.AppendAllText(Path.Combine(f.Path, "Together.md"), "\nlate external edit"); var late = File.ReadAllBytes(Path.Combine(f.Path, "Together.md"));
    Equal("files-written", recovery.Apply(new(op, preview.PreviewId)).Status);
    True(late.AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(f.Path, "Together.md"))));
});

await Check("unknown third party version during recovery remains intact and pending", async () =>
{
    using var f = await Open("conflict"); var preview = Merge(f); Ready(preview); var op = Op();
    f.Grouping.CheckpointForTest = phase => { if (phase == "intent-durable") throw new IOException("interrupt"); };
    try { f.Grouping.Apply(new(op, preview.PreviewId)); } catch (IOException) { }
    File.AppendAllText(Path.Combine(f.Path, "A.md"), " externally changed");
    var recovery = new WorkspaceGrouping(f.Path, f.Repository, f.Knowledge);
    Equal("conflict", recovery.RecoverPending().Single().Status); True(recovery.HasPendingOperations);
    True(File.ReadAllText(Path.Combine(f.Path, "A.md")).EndsWith(" externally changed")); True(!File.Exists(Path.Combine(f.Path, "Together.md")));
});

await Check("receipt durable interruption and reuse payload mismatch", async () =>
{
    using var f = await Open("receipt"); var preview = Merge(f); Ready(preview); var op = Op();
    f.Grouping.CheckpointForTest = phase => { if (phase == "receipt-durable") throw new IOException("reply lost"); };
    try { f.Grouping.Apply(new(op, preview.PreviewId)); } catch (IOException) { }
    var recovery = new WorkspaceGrouping(f.Path, f.Repository, f.Knowledge);
    recovery.RecoverPending(); Equal("files-written", recovery.Apply(new(op, preview.PreviewId)).Status);
    try { recovery.Apply(new(op, Op())); throw new Exception("operation payload mismatch accepted"); } catch (InvalidOperationException) { }
});
Console.WriteLine($"Grouping service: {passed} passed, {failed} failed"); return failed == 0 ? 0 : 1;
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}

sealed record Fixture(string Path, MarkdownWorkspaceRepository Repository, KnowledgeService Knowledge, WorkspaceCoordinator Coordinator, WorkspaceGrouping Grouping) : IDisposable
{ public void Dispose() { Coordinator.Dispose(); Knowledge.Dispose(); } }
