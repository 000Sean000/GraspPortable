using System.Text;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Backups;
using GraspPortable.Host.Workspace.Markdown;

try
{
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces/GW-" + Guid.NewGuid().ToString("N")));
var workspace = Path.Combine(root, "source");
var count = 0;
string Id() => Guid.NewGuid().ToString("N");
void Check(bool pass, string label) { if (!pass) throw new Exception(label); count++; Console.WriteLine("PASS: " + label); }
using var repository = new MarkdownWorkspaceRepository(workspace);
using var knowledge = new KnowledgeService(repository);
var a = Id(); var b = Id(); var binding = Id(); var document = Id();
var metadata = new MarkdownIdentityMetadata(1, document,
    [new(a, "定義", new Dictionary<string, string> { ["Fruit"] = binding }), new(b, "引用", new Dictionary<string, string>())], "grouped");
var group = GroupedNoteCodec.Serialize([new(a, "定義", "@code{ @Fruit = {apple} }"), new(b, "引用", "[old](:ref:Fruit)\r\n\r\n第二段 😀")], "\r\n");
var source = MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read("---\r\ncustom: untouched\r\n---\r\n前言不可丟\r\n" + group.Source + "尾文不可丟"), metadata).Source;
var file = Path.Combine(workspace, "Grouped.md"); File.WriteAllText(file, source, new UTF8Encoding(false));
async Task<MarkdownScanBatch> Observe()
{
    var scan = repository.Scan(knowledge.Current);
    Check(scan.Issues.Count == 0, "group scan has no blocking ambiguity: " + string.Join("; ", scan.Issues.Select(i => i.Message)));
    if (scan.Changes.Count > 0 || scan.MissingNoteIds.Count > 0)
    {
        var operation = Id(); using var lease = repository.BeginObservation(operation, scan.States);
        var removed = scan.MissingNoteIds.ToDictionary(id => id, id => knowledge.Current.Notes[id].CurrentSourceHash);
        Check((await knowledge.ObserveExternalAsync(operation, scan.Changes, deletedExpectedHashes: removed)).Status == "source-observed", "group source observation accepted atomically");
    }
    else if (scan.States.Count > 0) repository.RefreshSourceRegistry(knowledge.Current, scan.States);
    return scan;
}
void Replace(string noteId, string body)
{
    var text = File.ReadAllText(file); var envelope = MarkdownEnvelopeCodec.Read(text);
    var changed = GroupedNoteCodec.ReplaceMember(envelope.Body, GroupedNoteCodec.Parse(envelope.Body, metadata.Notes.Select(n => n.Id)), noteId, body);
    Check(changed.Success, "fixture changes exactly one member");
    File.WriteAllText(file, text[..envelope.BodyStart] + changed.Source, new UTF8Encoding(false));
}
var writes = 0;
repository.FileCheckpointForTest = checkpoint => { if (checkpoint.Stage == "before-mutation") writes++; };
var initial = await Observe();
Check(initial.States.Count == 1 && initial.Changes.Count == 2, "one physical observation contains two semantic members");
Check(repository.LoadSourceFiles().Count == 1 && repository.LoadSourceFiles().Single().NoteIds.SequenceEqual(new[] { a, b }), "source registry keeps one row per document and all member IDs");
Check(knowledge.Current.Notes[b].Source.StartsWith("[apple]", StringComparison.Ordinal) && knowledge.Current.Definitions[binding].Value == "apple", "both members participate in shared dependency evaluation");
Check(writes == 1, "same-document reference cache update performs one physical mutation");
Check(File.ReadAllText(file).Contains("custom: untouched\r\n", StringComparison.Ordinal)
    && File.ReadAllText(file).Contains("前言不可丟\r\n", StringComparison.Ordinal) && File.ReadAllText(file).EndsWith("尾文不可丟", StringComparison.Ordinal), "foreign metadata and unassigned body text survive semantic writeback");
Check(repository.Scan(knowledge.Current).States.Count == 0, "equivalent deserialized membership arrays do not trigger endless physical observations");
var draft = new Draft(b, "group-session", 1, knowledge.Current.Notes[b].Revision, "引用", knowledge.Current.Notes[b].Source + " dirty", knowledge.Current.Notes[b].CurrentSourceHash);
await knowledge.SaveDraftAsync(draft);
Replace(a, "@code{ @Fruit = {pear} }");
writes = 0;
var external = await Observe();
Check(external.Changes.Count == 1 && external.Changes.Single().NoteId == a, "only actually changed member is sent to semantic observation");
Check(knowledge.GetDraft(b) == draft && !knowledge.Current.Notes[b].IsSourceStale && knowledge.Current.Notes[b].Source.StartsWith("[pear]", StringComparison.Ordinal), "unchanged dirty sibling is not falsely marked external conflict and its draft is preserved");
Check(writes == 1, "derived sibling cache patch writes the grouped file once");
var actions = new WorkspaceFileActions(workspace, repository, knowledge);
Check(!actions.Preview(new("rename", "Grouped.md", "Moved.md")).CanApply, "dirty nonprimary member prevents whole-file rename");
var revision = knowledge.Current.Revision;
File.AppendAllText(file, "\r\nextra external prose");
var physical = await Observe();
Check(physical.Changes.Count == 0 && physical.States.Count == 1 && knowledge.Current.Revision == revision, "physical-only observation refreshes registry without inventing semantic revision");
Check(repository.LoadSourceFiles().Single().Text.EndsWith("extra external prose", StringComparison.Ordinal) && knowledge.GetDraft(b) == draft, "physical refresh preserves appended text and dirty draft");
try { repository.RefreshSourceRegistry(knowledge.Current with { Revision = revision - 1 }, physical.States); throw new Exception("stale snapshot unexpectedly refreshed"); }
catch (IOException) { Check(true, "registry refresh checks expected revision in SQLite transaction"); }

var backups = new WorkspaceBackups(workspace); var backup = backups.Capture();
Check(backup.Status == "published", "grouped physical source passes backup consistency: " + string.Join("; ", backup.Problems.Select(p => p.Message)));
var restored = backups.Restore(backup.GenerationPath!, Path.Combine(root, "restored"));
using (var opened = new MarkdownWorkspaceRepository(restored.Path))
{
    Check(!opened.IsWriteBlocked && opened.LoadSourceFiles().Count == 1 && opened.Load().Notes.Count == 2, "backup reopens one physical document with two semantic notes");
    Check(opened.LoadDrafts().Single() == draft && opened.Load().Definitions[binding].Value == "pear", "group backup preserves draft, definition IDs and semantic result");
    Check(File.ReadAllText(Path.Combine(restored.Path, "Grouped.md")) == File.ReadAllText(file), "backup restores exact grouped metadata, framing and unassigned text");
}
Replace(b, knowledge.Current.Notes[b].Source + " external competing text");
await Observe();
Check(knowledge.Current.Notes[b].SavedSource?.Status == "conflict" && knowledge.GetDraft(b) == draft
    && File.ReadAllText(file).Contains("external competing text", StringComparison.Ordinal), "changed dirty member retains both observed raw text and local draft");
var goodBytes = File.ReadAllBytes(file);
File.AppendAllText(file, "\n<!-- grasp:note " + Id() + " -->\nunknown\n");
var broken = repository.Scan(knowledge.Current);
Check(broken.Changes.Count == 0 && broken.Issues.Select(i => i.NoteId).Where(id => id is not null).Distinct().Count() == 2,
    "unknown grouped member marker protects every registered member without rewriting raw");
File.WriteAllBytes(file, goodBytes);

var singletonPath = Path.Combine(root, "singleton");
using var singletonRepository = new MarkdownWorkspaceRepository(singletonPath);
using var singletonKnowledge = new KnowledgeService(singletonRepository);
var one = Id(); var oneMetadata = new MarkdownIdentityMetadata(1, Id(), [new(one, "only", new Dictionary<string, string>())], "grouped");
var oneBody = GroupedNoteCodec.Serialize([new(one, "only", "exact body")]).Source;
File.WriteAllText(Path.Combine(singletonPath, "one.md"), MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read(oneBody), oneMetadata).Source);
var oneScan = singletonRepository.Scan(singletonKnowledge.Current);
using (singletonRepository.BeginObservation("one", oneScan.States)) await singletonKnowledge.ObserveExternalAsync("one", oneScan.Changes);
Check(singletonRepository.LoadSourceFiles().Single().IsGrouped && singletonKnowledge.Current.Notes[one].Source == "exact body", "single-member grouped layout remains explicitly framed");
Check(!MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read("body"), metadata with { Layout = null }).Success, "multiple metadata members require explicit grouped layout");
Console.WriteLine($"PASS: {count} grouped storage assertions. Workspace: {root}");
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
