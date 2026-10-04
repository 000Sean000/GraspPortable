using System.Security.Cryptography;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Markdown;
using Microsoft.Data.Sqlite;

try
{
var repositoryRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
var root = Path.Combine(repositoryRoot, "workspaces", "migration-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var count = 0;
void Check(bool pass, string label) { if (!pass) throw new Exception(label); Console.WriteLine("PASS: " + label); count++; }
void Refuses(Action action, string label)
{
    try { action(); } catch (IOException) { Check(true, label); return; }
    throw new Exception("Unexpected success: " + label);
}
string Op() => Guid.NewGuid().ToString("N");
Dictionary<string, string> Hashes(string path) => Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories)
    .ToDictionary(p => Path.GetRelativePath(path, p), p => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))));
bool EqualHashes(Dictionary<string, string> a, Dictionary<string, string> b) => a.Count == b.Count && a.All(p => b.GetValueOrDefault(p.Key) == p.Value);

var legacy = Path.Combine(root, "Legacy");
Snapshot original;
Draft draft;
using (var repository = new SqliteWorkspaceRepository(legacy))
using (var service = new KnowledgeService(repository))
{
    var created = await service.CreateNoteAsync(Op(), "定義", "中文\r\n@code{\r\n @Fruit = {apple}\r\n @Label = {A } + Fruit\r\n}");
    Check(created.Status == "committed", "seed legacy definitions");
    var referenced = await service.CreateNoteAsync(Op(), "引用", "[old](:ref:Fruit)\n\n[[@Label|old]]");
    Check(referenced.Status == "committed", "seed legacy references");
    await service.ChangePolicyAsync(Op(), service.Current.Revision, ["", "grasp", "custom"]);
    original = service.Current;
    var note = original.Notes[created.NoteId!];
    draft = new(note.Id, "legacy-session", 7, note.Revision, note.Title, note.Source + "\r\n@code{ @Unfinished = {");
    repository.SaveDraft(draft);
    var reference = original.Notes[referenced.NoteId!];
    repository.SaveDraft(new(reference.Id, "stale-session", 2, reference.Revision - 1, reference.Title, "stale raw", null));
    Refuses(() => LegacyWorkspaceMigration.MigrateToNewFolder(legacy), "busy legacy writer safely blocks migration");
}
Directory.CreateDirectory(Path.Combine(legacy, "attachments", "empty"));
Directory.CreateDirectory(Path.Combine(legacy, ".obsidian"));
File.WriteAllBytes(Path.Combine(legacy, "attachments", "樣本.bin"), [0, 255, 12, 0, 77]);
File.WriteAllText(Path.Combine(legacy, ".obsidian", "appearance.json"), "{\"theme\":\"dark\"}");
File.WriteAllText(Path.Combine(legacy, "extra.md"), "# User file\r\nUnmanaged content\r\n");
var before = Hashes(legacy);
Check(LegacyWorkspaceMigration.IsLegacy(legacy), "read-only schema 1 detection");
Check(EqualHashes(before, Hashes(legacy)), "schema detection leaves every source byte unchanged");
// Existing unrelated sibling is not overwritten.
Directory.CreateDirectory(legacy + "-Markdown");
File.WriteAllText(Path.Combine(legacy + "-Markdown", "keep.txt"), "untouched");
var result = LegacyWorkspaceMigration.MigrateToNewFolder(legacy);
Check(result.Path == legacy + "-Markdown-2" && result.NoteCount == 2 && result.DraftCount == 2, "unique sibling and exact counts");
Check(EqualHashes(before, Hashes(legacy)), "migration leaves database, source files and attachments byte-exact");
Check(File.ReadAllText(Path.Combine(legacy + "-Markdown", "keep.txt")) == "untouched", "unrelated existing target preserved");
Check(Directory.Exists(Path.Combine(result.Path, "attachments", "empty")), "empty attachment directories retained");
Check(File.ReadAllBytes(Path.Combine(result.Path, "attachments", "樣本.bin")).SequenceEqual(new byte[] { 0, 255, 12, 0, 77 }), "binary attachment bytes retained");
Check(File.ReadAllText(Path.Combine(result.Path, ".obsidian", "appearance.json")) == "{\"theme\":\"dark\"}", "user application settings retained");
Check(File.ReadAllText(Path.Combine(result.Path, "extra.md")) == "# User file\r\nUnmanaged content\r\n", "unmanaged Markdown retained byte-exact");
Check(!LegacyWorkspaceMigration.IsLegacy(result.Path), "schema 2 destination is not classified legacy");
var retried = LegacyWorkspaceMigration.MigrateToNewFolder(legacy);
Check(retried == result, "completed migration retry reuses verified destination");
Check(Directory.GetDirectories(root).Length == 3, "retry creates no duplicate migration folder");
using (var repository = new MarkdownWorkspaceRepository(result.Path))
{
    Check(!repository.IsWriteBlocked, "new workspace reopens with finalized file journal");
    var loaded = repository.Load();
    Check(loaded.WorkspaceId != original.WorkspaceId && loaded.Revision == original.Revision, "new workspace identity with coordinated source revision");
    Check(loaded.PolicyRevision == original.PolicyRevision && loaded.Languages.SequenceEqual(original.Languages), "parsing policy and languages retained");
    Check(loaded.Notes.Keys.Order().SequenceEqual(original.Notes.Keys.Order()) && loaded.Definitions.Keys.Order().SequenceEqual(original.Definitions.Keys.Order()), "canonical note and definition IDs retained");
    Check(loaded.Notes.Values.All(n => n.Source == original.Notes[n.Id].Source && n.Revision == original.Notes[n.Id].Revision), "note source and source revisions retained");
    var restored = repository.LoadDrafts().Single(d => d.NoteId == draft.NoteId);
    Check(restored == draft with { BaseSourceHash = original.Notes[draft.NoteId].CurrentSourceHash }, "raw incomplete draft, revision and matching source hash restored");
    Check(repository.LoadDrafts().Single(d => d.NoteId != draft.NoteId).BaseSourceHash is null, "stale draft base is not falsely rebased");
    foreach (var file in repository.LoadSourceFiles())
    {
        var envelope = MarkdownEnvelopeCodec.Read(File.ReadAllText(Path.Combine(result.Path, file.RelativePath)));
        Check(envelope.Body == original.Notes[file.NoteId].CurrentSource && envelope.Metadata!.Notes.Single().Id == file.NoteId, "generated Markdown body and identity verify");
    }
}
File.AppendAllText(Path.Combine(result.Path, "extra.md"), "later edit");
Refuses(() => LegacyWorkspaceMigration.MigrateToNewFolder(legacy), "changed completed target blocks duplicate copy or overwrite");
Check(File.ReadAllText(Path.Combine(result.Path, "extra.md")).EndsWith("later edit"), "later target edit retained");

var unknown = Path.Combine(root, "Unknown");
using (var repository = new SqliteWorkspaceRepository(unknown)) { }
using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(unknown, "workspace.grasp.db"), Pooling = false }.ToString()))
{
    db.Open(); using var command = db.CreateCommand(); command.CommandText = "UPDATE meta SET value='99' WHERE key='schema'"; command.ExecuteNonQuery();
}
var unknownBefore = Hashes(unknown);
Check(!LegacyWorkspaceMigration.IsLegacy(unknown), "unknown schema is not legacy");
Refuses(() => LegacyWorkspaceMigration.MigrateToNewFolder(unknown), "unknown schema safely rejected");
Check(EqualHashes(unknownBefore, Hashes(unknown)) && !Directory.Exists(unknown + "-Markdown"), "unknown schema leaves original and sibling space unchanged");

var unsupported = Path.Combine(root, "InvalidYaml");
using (var repository = new SqliteWorkspaceRepository(unsupported))
using (var service = new KnowledgeService(repository))
{ await service.CreateNoteAsync(Op(), "invalid metadata", "---\ngrasp: invalid\n---\nbody"); }
var unsupportedBefore = Hashes(unsupported);
Refuses(() => LegacyWorkspaceMigration.MigrateToNewFolder(unsupported), "unsupported managed YAML stops migration");
Check(EqualHashes(unsupportedBefore, Hashes(unsupported)), "failed migration leaves source exact");
Check(File.Exists(Path.Combine(unsupported + "-Markdown", ".grasp", "migration", "intent.json"))
    && File.Exists(Path.Combine(unsupported + "-Markdown", ".grasp", "migration", "failed.json"))
    && !File.Exists(Path.Combine(unsupported + "-Markdown", ".grasp", "migration", "completed.json")), "failed destination retains explicit incomplete evidence");
Refuses(() => LegacyWorkspaceMigration.MigrateToNewFolder(unsupported), "incomplete migration retry refuses silent duplicate");
Check(!Directory.Exists(unsupported + "-Markdown-2"), "failed retry does not create another partial workspace");

var walSource = Path.Combine(root, "WalSource");
using (var repository = new SqliteWorkspaceRepository(walSource))
using (var service = new KnowledgeService(repository))
{ await service.CreateNoteAsync(Op(), "WAL", "@code{ @Value = {durable} }"); }
// Capture a real DB/WAL pair, then restore that pair after normal SQLite shutdown
// to model a crashed process with committed, uncheckpointed frames.
byte[] capturedDatabase, capturedWal;
using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(walSource, "workspace.grasp.db"), Pooling = false }.ToString()))
{
    db.Open(); using var command = db.CreateCommand();
    command.CommandText = "PRAGMA wal_autocheckpoint=0; UPDATE meta SET value='[\"\",\"grasp\",\"wal-policy\"]' WHERE key='languages'";
    command.ExecuteNonQuery();
    Check(new FileInfo(Path.Combine(walSource, "workspace.grasp.db-wal")).Length > 0, "fixture has committed WAL frames");
    byte[] Capture(string name)
    { using var input = new FileStream(Path.Combine(walSource, name), FileMode.Open, FileAccess.Read, FileShare.ReadWrite); using var output = new MemoryStream(); input.CopyTo(output); return output.ToArray(); }
    capturedDatabase = Capture("workspace.grasp.db"); capturedWal = Capture("workspace.grasp.db-wal");
}
File.WriteAllBytes(Path.Combine(walSource, "workspace.grasp.db"), capturedDatabase);
File.WriteAllBytes(Path.Combine(walSource, "workspace.grasp.db-wal"), capturedWal);
var walBefore = Hashes(walSource);
var migratedWal = LegacyWorkspaceMigration.MigrateToNewFolder(walSource);
Check(EqualHashes(walBefore, Hashes(walSource)), "migration preserves source DB/WAL bytes without adding SHM");
using (var targetRepository = new MarkdownWorkspaceRepository(migratedWal.Path))
    Check(targetRepository.Load().Languages.Contains("wal-policy"), "shadow includes latest committed WAL content");

var collisionSource = Path.Combine(root, "Collision");
string collisionNoteId;
using (var repository = new SqliteWorkspaceRepository(collisionSource))
using (var service = new KnowledgeService(repository))
{ collisionNoteId = (await service.CreateNoteAsync(Op(), "same", "original note")).NoteId!; }
var collisionFile = "same.md";
File.WriteAllText(Path.Combine(collisionSource, collisionFile), "attachment with colliding filename");
var collisionBefore = Hashes(collisionSource);
var filenameResolved = LegacyWorkspaceMigration.MigrateToNewFolder(collisionSource);
Check(EqualHashes(collisionBefore, Hashes(collisionSource)), "collision leaves original bytes unchanged");
Check(File.ReadAllText(Path.Combine(filenameResolved.Path, collisionFile)) == "attachment with colliding filename", "user filename collision preserves attachment");
using (var repository = new MarkdownWorkspaceRepository(filenameResolved.Path))
    Check(repository.LoadSourceFiles().Single().RelativePath != collisionFile && repository.LoadSourceFiles().Single().NoteId == collisionNoteId, "repository selects distinct managed filename with same canonical identity");

var identityCollision = Path.Combine(root, "IdentityCollision");
using (var repository = new SqliteWorkspaceRepository(identityCollision))
using (var service = new KnowledgeService(repository))
{
    var id = (await service.CreateNoteAsync(Op(), "owned", "body")).NoteId!;
    var encoded = MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read("another body"), new(1, Op(), [new(id, "copied", new Dictionary<string, string>())]));
    File.WriteAllText(Path.Combine(identityCollision, "existing.md"), encoded.Source);
}
var identityBefore = Hashes(identityCollision);
Refuses(() => LegacyWorkspaceMigration.MigrateToNewFolder(identityCollision), "existing managed Markdown identities require collision review");
Check(EqualHashes(identityBefore, Hashes(identityCollision)) && !File.Exists(Path.Combine(identityCollision + "-Markdown", ".grasp/migration/completed.json")), "ambiguous identity migration leaves source intact and target incomplete");
Console.WriteLine($"PASS: {count} migration assertions. Workspace: {root}");
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
