using System.Diagnostics;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace;
using Microsoft.Data.Sqlite;

try
{
var repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
var workspace = Path.Combine(repoRoot, "workspaces", "integration-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss"));
Directory.CreateDirectory(workspace);
var passed = 0;
void Check(bool condition, string label) { if (!condition) throw new Exception("FAIL: " + label); passed++; Console.WriteLine("PASS: " + label); }
string Op() => Guid.NewGuid().ToString("N");
var repository = new SqliteWorkspaceRepository(workspace);
var service = new KnowledgeService(repository);
async Task<Receipt> Edit(string id, string source, bool confirm = true)
{
    var note = service.Current.Notes[id]; var oldDraft = service.GetDraft(id);
    var draft = new Draft(id, oldDraft?.SessionId ?? "test", (oldDraft?.Revision ?? 0) + 1, note.Revision, note.Title, source);
    await service.SaveDraftAsync(draft);
    return await service.CommitNoteAsync(new(Op(), id, draft.SessionId, draft.Revision, note.Revision, service.Current.Revision, confirm));
}
try
{
    using var second = new SqliteWorkspaceRepository(workspace);
    throw new Exception("Workspace lock did not reject a second writer.");
}
catch (IOException) { Check(true, "second workspace writer rejected"); }
var created = await service.CreateNoteAsync(Op(), "Definitions", "@code{ @Fruit = {蘋果} @Slogan = {今天吃} + Fruit @Message = Slogan + {！} @Description = {\n第一段。\n\n第二段。\n} }");
Check(created.Status == "committed", "create definitions committed");
var definitionsId = created.NoteId!;
var references = await service.CreateNoteAsync(Op(), "References", "前文\n\n[old](:ref:Description)\n\n[[@Fruit|old]]\n\n[old](:ref:Message)\n\n後文\n```json\n@code{ @Fruit = {不得建立} }\n[old](:ref:Fruit)\n```\n");
Check(references.Status == "committed", "two reference kinds and disabled fence accepted");
var refsId = references.NoteId!;
Check(service.Current.Notes[refsId].Source.Contains("[第一段。\n\n第二段。](:ref:Description)"), "multiline reference materialized without losing paragraphs");
Check(service.Current.Notes[refsId].Source.Contains("今天吃蘋果！"), "two-level composition materialized");
var fruit = service.Current.Definitions.Values.Single(d => d.Name == "Fruit");
var literalOp = Op(); var literalRevision = service.Current.Revision;
var changed = await service.ChangeLiteralAsync(literalOp, fruit.Id, literalRevision, "梨子");
Check(changed.Status == "committed" && service.Current.Notes[refsId].Source.Contains("今天吃梨子！"), "shared literal updates transitive references");
var retried = await service.ChangeLiteralAsync(literalOp, fruit.Id, literalRevision, "梨子");
Check(retried.Revision == changed.Revision && service.Current.Revision == changed.Revision, "lost-response retry uses durable receipt exactly once");
Check((await service.ChangeLiteralAsync(literalOp, fruit.Id, literalRevision, "other")).Status == "rejected", "same operation ID different payload rejected");
Check((await service.ChangeLiteralAsync(Op(), fruit.Id, literalRevision, "stale")).Status == "conflict", "stale base rejected");

var sourceBeforeRename = service.Current.Notes[definitionsId].Source;
var rename = await Edit(definitionsId, sourceBeforeRename.Replace("@Fruit =", "@Produce ="), false);
Check(rename.Status == "confirmation-required", "raw source rename requests impact confirmation");
var draftRename = service.GetDraft(definitionsId)!;
rename = await service.CommitNoteAsync(new(rename.OperationId, definitionsId, draftRename.SessionId, draftRename.Revision, draftRename.BaseNoteRevision, service.Current.Revision, true));
Check(rename.Status == "committed" && service.Current.Definitions[fruit.Id].Name == "Produce", "raw rename preserves canonical identity");
Check(service.Current.Notes[definitionsId].Source.Contains("+ Produce") && service.Current.Notes[refsId].Source.Contains("[[@Produce|梨子]]"), "raw rename updates real dependency and reference tokens");
Check(service.Current.Notes[refsId].Source.Contains("[old](:ref:Fruit)"), "rename skips disabled fence examples");
var revisionBeforeCollision = service.Current.Revision;
var collision = await Edit(definitionsId, service.Current.Notes[definitionsId].Source.Replace("@Produce =", "@Slogan ="));
Check(collision.Status == "invalid" && service.Current.Revision == revisionBeforeCollision && service.Current.Definitions.ContainsKey(fruit.Id), "duplicate rename protects committed state and draft");
await Edit(definitionsId, service.Current.Notes[definitionsId].Source);

var invalid = await Edit(definitionsId, service.Current.Notes[definitionsId].Source + "\n@code{ @Incomplete = {");
Check(invalid.Status == "invalid" && service.GetDraft(definitionsId) is not null, "unclosed syntax remains durable draft");
Check((await service.ChangeLiteralAsync(Op(), fruit.Id, service.Current.Revision, "不得覆蓋")).Status == "conflict", "shared edit cannot overwrite owner's dirty draft");
var persistedDraft = service.GetDraft(definitionsId)!;
service.Dispose(); repository = new(workspace); service = new(repository);
Check(service.GetDraft(definitionsId)?.Source == persistedDraft.Source && service.Current.Definitions[fruit.Id].Name == "Produce", "reopen restores invalid draft and committed identity separately");
Check(service.GetReceipt(literalOp)?.Status == "committed", "receipt survives process-equivalent reopen");
await Edit(definitionsId, service.Current.Notes[definitionsId].Source);

var rollbackRevision = service.Current.Revision; var rollbackSource = service.Current.Notes[refsId].Source;
repository.BeforeCommitForTest = () => throw new IOException("Injected failure before COMMIT");
var rollbackOperation = Op();
try { await service.ChangeLiteralAsync(rollbackOperation, fruit.Id, rollbackRevision, "不應出現"); throw new Exception("Expected failure"); }
catch (IOException) { }
repository.BeforeCommitForTest = null;
Check(service.Current.Revision == rollbackRevision && repository.Load().Revision == rollbackRevision && repository.FindReceipt(rollbackOperation) is null, "SQLite failure rolls back revision, values and receipt");
Check(repository.Load().Notes[refsId].Source == rollbackSource, "reference caches remain atomic after rollback");

var resourceNote = await service.CreateNoteAsync(Op(), "Resource limit", "@code{ @Bounded = {small} }");
var resourceRevision = service.Current.Revision;
var oversized = await Edit(resourceNote.NoteId!, "@code{ @Bounded = {" + new string('x', 4_000_001) + "} }");
Check(oversized.Status == "invalid" && service.Current.Revision == resourceRevision && service.GetDraft(resourceNote.NoteId!) is not null,
    "resource limit preserves draft without publishing failed work");
await Edit(resourceNote.NoteId!, service.Current.Notes[resourceNote.NoteId!].Source);

var futurePath = Path.Combine(workspace, "future-schema"); Directory.CreateDirectory(futurePath);
var futureDb = Path.Combine(futurePath, "workspace.grasp.db");
using (var future = new SqliteConnection("Data Source=" + futureDb))
{
    future.Open(); using var command = future.CreateCommand();
    command.CommandText = "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES('schema','999');"; command.ExecuteNonQuery();
}
byte[] DatabaseHash(string path) { using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); return System.Security.Cryptography.SHA256.HashData(stream); }
var futureBefore = DatabaseHash(futureDb);
try { using var unsupported = new SqliteWorkspaceRepository(futurePath); throw new Exception("Future schema was accepted"); }
catch (InvalidOperationException) { }
Check(futureBefore.SequenceEqual(DatabaseHash(futureDb)), "unsupported schema rejected before database mutation");

var cycles = await service.CreateNoteAsync(Op(), "Diagnostics", "@code{ @Unknown = NotFound @A = B @B = A }");
Check(cycles.Status == "committed" && service.Current.Definitions.Values.Any(d => d.Status == "Cycle") && service.Current.Definitions.Values.Any(d => d.Status == "Missing"), "missing and cycle are committed diagnostic states");
var beforePolicy = service.Current.Revision;
Check((await service.ChangePolicyAsync(Op(), beforePolicy, ["", "grasp", "json"])).Status == "committed", "policy can enable previously disabled definition atomically");
var duplicatePolicyNote = await service.CreateNoteAsync(Op(), "Policy duplicate", "```demo\n@code{ @Produce = {duplicate} }\n```\n");
Check(duplicatePolicyNote.Status == "committed", "disabled policy candidate stored as raw source");
var policyRevision = service.Current.Revision;
Check((await service.ChangePolicyAsync(Op(), policyRevision, ["", "grasp", "json", "demo"])).Status == "invalid" && service.Current.Revision == policyRevision, "policy duplicate rejects entire setting and reparse");

var smallSamples = new List<double>();
for (var i = 0; i < 30; i++)
{
    var watch = Stopwatch.StartNew();
    var result = await service.ChangeLiteralAsync(Op(), fruit.Id, service.Current.Revision, "值" + i);
    watch.Stop(); Check(result.Status == "committed", $"representative edit {i + 1}"); smallSamples.Add(watch.Elapsed.TotalMilliseconds);
}
smallSamples.Sort(); var p95 = smallSamples[(int)Math.Ceiling(smallSamples.Count * .95) - 1];
Console.WriteLine($"MEASURE small edit prepare+SQLite commit p95={p95:F2}ms n=30; excludes App/UI/transport");
Check(p95 <= 800, "backend subset of small edit budget");
service.Dispose();

foreach (var count in new[] { 1000, 10000 })
{
    var path = Path.Combine(workspace, "stress-" + count);
    using var stress = new KnowledgeService(new SqliteWorkspaceRepository(path));
    var source = "@code{\n@Root = {x}\n" + string.Join("\n", Enumerable.Range(1, count).Select(i => count == 1000 ? $"@Node{i} = {(i == 1 ? "Root" : "Node" + (i - 1))}" : $"@Node{i} = Root")) + "\n}";
    var result = await stress.CreateNoteAsync(Op(), "Stress", source);
    Check(result.Status == "committed", $"stress {count} setup");
    var root = stress.Current.Definitions.Values.Single(d => d.Name == "Root");
    var watch = Stopwatch.StartNew(); result = await stress.ChangeLiteralAsync(Op(), root.Id, stress.Current.Revision, "y"); watch.Stop();
    Console.WriteLine($"MEASURE {(count == 1000 ? "deep chain" : "fan out")}={count}, prepare+SQLite commit={watch.Elapsed.TotalMilliseconds:F2}ms");
    Check(result.Status == "committed" && stress.Current.Definitions.Values.All(d => d.Value == "y"), $"stress {count} complete values");
    Check(watch.Elapsed.TotalMilliseconds <= 2000, $"stress {count} <=2s backend commit");
}
Console.WriteLine($"PASS {passed} assertions. Temporary evidence: {workspace}");
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
