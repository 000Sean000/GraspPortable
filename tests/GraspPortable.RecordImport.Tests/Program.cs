using System.Text;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.Records;
using GraspPortable.Host.Notifications;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Backups;
using GraspPortable.Host.Workspace.Markdown;

try
{
// Explicit opt-in, read-only inspection of at most two local inputs; never prints cell contents.
if (args is ["--inspect-summary", ..] && args.Length is >= 2 and <= 3)
{
    for (var input = 1; input < args.Length; input++)
    {
        var parsed = MarkdownTableImport.Read(File.ReadAllText(args[input]));
        Console.WriteLine($"Input {input}: tables={parsed.Tables.Count}, scanIssues={parsed.Diagnostics.Count}");
        foreach (var table in parsed.Tables)
            Console.WriteLine($"  tableIndex={table.Index}, rows={table.Rows.Count}, columns={table.Headers.Count}, issues={table.Diagnostics.Count}, htmlBreaks={table.Rows.SelectMany(r => r).Sum(c => c.ConvertedBreaks)}");
    }
    return 0;
}

var passed = 0; var failed = 0;
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces", "RecordImportTests-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
string Op() => Guid.NewGuid().ToString("N");
void True(bool ok, string message = "Assertion failed") { if (!ok) throw new InvalidOperationException(message); }
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected [{expected}] actual [{actual}]"); }
async Task Check(string name, Func<Task> test) { try { await test(); passed++; } catch (Exception error) { failed++; Console.Error.WriteLine("FAIL " + name + ": " + error); } }
async Task<Fixture> Open(string name, string source)
{
    var path = Path.Combine(root, name); Directory.CreateDirectory(Path.Combine(path, "Notes"));
    File.WriteAllText(Path.Combine(path, "Notes", "Source.md"), source, new UTF8Encoding(true));
    var repository = new MarkdownWorkspaceRepository(path); var knowledge = new KnowledgeService(repository);
    var coordinator = new WorkspaceCoordinator(repository, knowledge, new RevisionHub(), path); await coordinator.ReconcileAsync();
    return new(path, repository, knowledge, coordinator, new(path, repository, knowledge), knowledge.Current.Notes.Values.Single().Id);
}
void Ready(RecordImportPreview preview) => True(preview.CanApply, string.Join("; ", preview.Warnings));
const string Table = "# Original H1\r\n\r\n| Name | Details | Empty |\r\n| --- | :---: | ---: |\r\n| [[Missing#Heading|Alias]] | one<br>two<br/><br />![[image.png]] | |\r\n| Second | # Inner<br>###### Deep | |\r\n";

await Check("bounded codec recognizes contexts and preserves alias code escaped pipes", () =>
{
    var source = "```json\n| hidden |\n| --- |\n| no |\n```\n\n|Name|Body|\n|---|---|\n|[[Target|Alias]]|`code | text <br>` and \\| pipe<br>next|\n\n~~~\n|hidden|\n|---|\n|no|\n~~~\n\n| Other |\n| --- |\n| row |\n";
    var parsed = MarkdownTableImport.Read(source); Equal(2, parsed.Tables.Count); True(parsed.Tables.All(t => t.CanImport));
    Equal("[[Target|Alias]]", parsed.Tables[0].Rows[0][0].Markdown);
    Equal("`code | text <br>` and \\| pipe\nnext", parsed.Tables[0].Rows[0][1].Markdown);
    Equal(1, parsed.Tables[0].Rows[0][1].ConvertedBreaks);
    foreach (var table in parsed.Tables) foreach (var row in table.Rows) foreach (var cell in row)
        Equal(cell.Source, source.Substring(cell.Span.Start, cell.Span.Length));
    True(!MarkdownTableImport.Read("| a | b |\n| --- | --- |\n| one |\n").Tables.Single().CanImport);
    True(!MarkdownTableImport.Read("| a | b |\n| --- | --- |\nunseparated possible row\n").Tables.Single().CanImport);
    True(!MarkdownTableImport.Read("| a | b |\n| --- | --- |\n| [[broken | b |\n").Tables.Single().CanImport);
    Equal(0, MarkdownTableImport.Read("    | a |\n    | --- |\n    | b |\n").Tables.Count);
    return Task.CompletedTask;
});

await Check("preview import retains original bytes IDs metadata maps same parent and retry", async () =>
{
    using var f = await Open("roundtrip", Table);
    var original = File.ReadAllBytes(Path.Combine(f.Path, "Notes", "Source.md"));
    var preview = f.Import.Preview(new(f.SourceId, Title: "Imported collection")); Ready(preview);
    Equal(2, preview.RowCount); Equal(3, preview.Columns.Length); Equal(1, preview.TableCount);
    True(preview.Warnings.Any(w => w.Contains("<br>"))); True(preview.HeadingMaps.Any(m => m.ConvertedLevel is null));
    Equal("one\ntwo\n\n![[image.png]]", preview.SampleRows[0][1]);
    var op = Op(); var result = await f.Import.ApplyAsync(new(op, preview.PreviewId)); Equal("committed", result.Status);
    var repeated = await f.Import.ApplyAsync(new(op, preview.PreviewId)); Equal(result.NoteId, repeated.NoteId); Equal(result.Revision, repeated.Revision);
    var note = f.Knowledge.Current.Notes[result.NoteId!]; True(note.CurrentRecords is not null);
    Equal(2, note.CurrentRecords!.Records.Count); True(!note.CurrentSource.Split('\n').Any(l => l.StartsWith("# ")));
    var fields = VerticalRecordCodec.Parse(note.CurrentSource, note.CurrentRecords); True(fields.CanRewrite);
    Equal("", fields.Fields[2].RawSource); True(!fields.Fields[2].IsNull);
    Equal("[[Missing#Heading|Alias]]", fields.Fields[0].RawSource);
    var registry = f.Repository.LoadSourceFiles().Single(s => s.NoteId == note.Id); True(registry.RelativePath.StartsWith("Notes/"));
    Equal(2, MarkdownEnvelopeCodec.Read(registry.Text).Metadata!.Notes.Single().Records!.Descriptor.Records.Count);
    True(original.AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(f.Path, "Notes", "Source.md"))));
    var archive = Path.Combine(f.Path, ".grasp", "record-import", "previews", preview.PreviewId + ".json"); True(File.Exists(archive));
    var archiveText = File.ReadAllText(archive); True(archiveText.Contains("OriginalFileSource") && archiveText.Contains("HeadingMapping"));
    var backup = new WorkspaceBackups(f.Path).Capture(); Equal("published", backup.Status);
    True(File.Exists(Path.Combine(backup.GenerationPath!, "content", ".grasp", "record-import", "previews", preview.PreviewId + ".json")));
    Equal("rejected", (await f.Import.ApplyAsync(new(op, Op()))).Status);
    True(!f.Import.Preview(new(f.SourceId)).CanApply, "existing generated namespace collision must require another prefix");
});

await Check("source bytes changed externally and draft protect import", async () =>
{
    using var f = await Open("guards", Table); var preview = f.Import.Preview(new(f.SourceId)); Ready(preview);
    File.AppendAllText(Path.Combine(f.Path, "Notes", "Source.md"), "\r\nexternal edit");
    Equal("conflict", (await f.Import.ApplyAsync(new(Op(), preview.PreviewId))).Status); Equal(1, f.Knowledge.Current.Notes.Count);
    True(!f.Import.Preview(new(f.SourceId)).CanApply);
    await f.Coordinator.ReconcileAsync(); var note = f.Knowledge.Current.Notes[f.SourceId];
    await f.Knowledge.SaveDraftAsync(new(note.Id, "session", 1, note.Revision, note.Title, note.CurrentSource + " draft", note.CurrentSourceHash));
    True(!f.Import.Preview(new(f.SourceId)).CanApply);
});

await Check("editable mapping and table selection validate before creation", async () =>
{
    using var f = await Open("mapping", "| x | y |\n| --- | --- |\n| first | a |\n\n| 中文 | Amount |\n| --- | --- |\n| second | 001.20 |\n");
    var preview = f.Import.Preview(new(f.SourceId, 1, "Mapped", "People.Person", [new(0, "Name", "姓名"), new(1, "Value", "數值") ])); Ready(preview);
    Equal(2, preview.TableCount); Equal("second", preview.SampleRows[0][0]); Equal("Name", preview.Columns[0].Key);
    var result = await f.Import.ApplyAsync(new(Op(), preview.PreviewId)); Equal("committed", result.Status);
    True(f.Knowledge.Current.Definitions.Values.Any(d => d.Name == "People.Person1.Value" && d.Value == "001.20"));
    True(!f.Import.Preview(new(f.SourceId, 0, FieldMappings: [new(0, "Same", "a"), new(1, "Same", "b")])).CanApply);
    True(!f.Import.Preview(new(f.SourceId, 0, FieldMappings: [new(0, "X", "a", "Number"), new(1, "Y", "b")])).CanApply);
    True(!f.Import.Preview(new(f.SourceId, 99)).CanApply);
});

await Check("commit reply loss recovers via original receipt without duplicate identities", async () =>
{
    using var f = await Open("replylost", "| Name |\n| --- |\n| A |\n"); var preview = f.Import.Preview(new(f.SourceId)); Ready(preview); var op = Op();
    f.Repository.AfterDatabaseCommitForTest = () => throw new IOException("reply lost");
    Equal("conflict", (await f.Import.ApplyAsync(new(op, preview.PreviewId))).Status);
    f.Repository.AfterDatabaseCommitForTest = null;
    // A newly opened adapter recovers/acknowledges the original DB receipt before its service loads.
    f.Dispose();
    using var reopened = new MarkdownWorkspaceRepository(f.Path); using var knowledge = new KnowledgeService(reopened);
    var retried = await new WorkspaceRecordImport(f.Path, reopened, knowledge).ApplyAsync(new(op, preview.PreviewId));
    Equal("committed", retried.Status); Equal(2, knowledge.Current.Notes.Count); Equal(1, knowledge.Current.Notes.Values.Count(n => n.CurrentRecords is not null));
});

await Check("existing missing references cannot cause source rewrite during additive import", async () =>
{
    using var f = await Open("namespace", "[old](:ref:Imported1.Name)\n\n| Name |\n| --- |\n| A |\n");
    True(!f.Import.Preview(new(f.SourceId)).CanApply);
    Ready(f.Import.Preview(new(f.SourceId, RecordKeyPrefix: "Fresh")));
});

Console.WriteLine($"Record import: {passed} passed, {failed} failed"); return failed == 0 ? 0 : 1;
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}

sealed record Fixture(string Path, MarkdownWorkspaceRepository Repository, KnowledgeService Knowledge, WorkspaceCoordinator Coordinator, WorkspaceRecordImport Import, string SourceId) : IDisposable
{
    private bool disposed;
    public void Dispose() { if (disposed) return; disposed = true; Coordinator.Dispose(); Knowledge.Dispose(); Repository.Dispose(); }
}
