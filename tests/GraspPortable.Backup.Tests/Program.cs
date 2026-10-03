using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Backups;
using GraspPortable.Host.Workspace.FileOperations;

var repositoryRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
var testRoot = Path.Combine(repositoryRoot, "workspaces", "backup-" + Guid.NewGuid().ToString("N"));
var workspace = Path.Combine(testRoot, "Source");
var count = 0;
void Check(bool pass, string label) { if (!pass) throw new Exception(label); Console.WriteLine("PASS: " + label); count++; }
void Refuses(Action action, string label)
{ try { action(); } catch (Exception error) when (error is IOException or InvalidDataException) { Check(true, label); return; } throw new Exception("Unexpected success: " + label); }
string Op() => Guid.NewGuid().ToString("N");
using var repository = new MarkdownWorkspaceRepository(workspace);
using var service = new KnowledgeService(repository);
var created = await service.CreateNoteAsync(Op(), "中文", "@code{ @Fruit = {apple} }\r\n正文");
Check(created.Status == "committed", "seed source and finalized journal");
var note = service.Current.Notes[created.NoteId!];
var definitionId = service.Current.Definitions.Values.Single().Id;
var draft = new Draft(note.Id, "session", 5, note.Revision, note.Title, note.Source + "\r\n草稿", note.CurrentSourceHash);
await service.SaveDraftAsync(draft);
Directory.CreateDirectory(Path.Combine(workspace, "images", "empty"));
Directory.CreateDirectory(Path.Combine(workspace, ".obsidian"));
File.WriteAllBytes(Path.Combine(workspace, "images", "image.png"), [137, 80, 78, 71, 0, 255]);
File.WriteAllText(Path.Combine(workspace, ".obsidian", "appearance.json"), "{\"theme\":\"dark\"}");
File.WriteAllText(Path.Combine(workspace, ".grasp", "grouping.json"), "{\"groups\":[]}");
File.WriteAllText(Path.Combine(workspace, ".grasp", "settings.json"), "{\"backupRetention\":3}");
File.WriteAllText(Path.Combine(workspace, "user.lock"), "user attachment");
var backups = new WorkspaceBackups(workspace);
var first = backups.Capture();
Check(first.Status == "published", "full checkpoint publishes: " + string.Join("; ", first.Problems.Select(p => p.Message)));
var firstVerification = backups.Verify(first.GenerationPath!);
Check(firstVerification.Valid, "published generation verifies: " + string.Join("; ", firstVerification.Problems.Select(p => p.Message)));
var firstContent = Path.Combine(first.GenerationPath!, "content");
Check(!Directory.Exists(Path.Combine(firstContent, ".grasp", "backups")) && !File.Exists(Path.Combine(firstContent, ".grasp.lock")), "backup excludes recursive backups and runtime lock");
Check(!File.Exists(Path.Combine(firstContent, "workspace.grasp.db-wal")) && !File.Exists(Path.Combine(firstContent, "workspace.grasp.db-shm")), "SQLite backup is self-contained without WAL/SHM");
var restoredPath = Path.Combine(testRoot, "Restored");
var restored = backups.Restore(first.GenerationPath!, restoredPath);
Check(restored.Path == restoredPath && restored.Problems.Length == 0, "restore publishes a new verified folder");
Check(File.Exists(Path.Combine(restoredPath, ".grasp.lock")) && new FileInfo(Path.Combine(restoredPath, ".grasp.lock")).Length == 0,
    "restore creates a fresh empty runtime lock after payload verification");
Check(!LegacyWorkspaceMigration.IsLegacy(restoredPath), "fresh restored workspace passes startup schema probe before repository creation");
Check(File.ReadAllBytes(Path.Combine(restoredPath, "images", "image.png")).SequenceEqual(new byte[] { 137, 80, 78, 71, 0, 255 }), "image attachment bytes restored");
Check(Directory.Exists(Path.Combine(restoredPath, "images", "empty")) && File.ReadAllText(Path.Combine(restoredPath, "user.lock")) == "user attachment", "empty directory and non-runtime lock-named attachment retained");
Check(File.ReadAllText(Path.Combine(restoredPath, ".grasp", "grouping.json")) == "{\"groups\":[]}"
    && File.ReadAllText(Path.Combine(restoredPath, ".grasp", "settings.json")) == "{\"backupRetention\":3}"
    && File.ReadAllText(Path.Combine(restoredPath, ".obsidian", "appearance.json")) == "{\"theme\":\"dark\"}", "grouping, settings and user metadata restored");
using (var reopened = new MarkdownWorkspaceRepository(restoredPath))
{
    Check(!reopened.IsWriteBlocked && reopened.Load().Notes[note.Id].Source == note.Source && reopened.Load().Definitions.ContainsKey(definitionId), "restored workspace reopens with canonical IDs and source");
    Check(reopened.LoadDrafts().Single() == draft, "draft raw text and source base restored");
    Check(reopened.FindReceipt(created.OperationId)?.Fingerprint == created.Fingerprint, "committed receipt restored without replay");
}
Refuses(() => backups.Restore(first.GenerationPath!, restoredPath), "existing destination is never overwritten");

var sourceFile = repository.LoadSourceFiles().Single();
var sourcePath = Path.Combine(workspace, sourceFile.RelativePath);
var originalSourceBytes = File.ReadAllBytes(sourcePath);
backups.CheckpointForTest = stage => { if (stage == "after-files-copied") File.AppendAllText(sourcePath, "external edit"); };
var concurrent = backups.Capture();
Check(concurrent.Status == "rejected" && backups.Verify(first.GenerationPath!).Valid, "external change rejects capture and preserves previous complete generation");
Check(File.ReadAllText(sourcePath).EndsWith("external edit"), "rejected capture does not overwrite external text");
backups.CheckpointForTest = null;
Check(backups.Capture().Status == "rejected", "stable but unobserved physical source rejects coherent checkpoint claim");
File.WriteAllBytes(sourcePath, originalSourceBytes);
backups.CheckpointForTest = stage => { if (stage == "after-files-copied") File.WriteAllText(Path.Combine(workspace, "new-external.md"), "new external file"); };
Check(backups.Capture().Status == "rejected", "inventory catches newly added external path during capture");
backups.CheckpointForTest = null;
File.Delete(Path.Combine(workspace, "new-external.md"));

var laterDraft = draft with { Revision = 6, Source = draft.Source + " later" };
backups.CheckpointForTest = stage => { if (stage == "after-database-snapshot") repository.SaveDraft(laterDraft); };
var withConcurrentDraft = backups.Capture();
Check(withConcurrentDraft.Status == "published", "draft write after SQLite snapshot permits coherent earlier checkpoint");
backups.CheckpointForTest = null;
var draftRestore = backups.Restore(withConcurrentDraft.GenerationPath!, Path.Combine(testRoot, "DraftSnapshot"));
using (var reopened = new MarkdownWorkspaceRepository(draftRestore.Path))
    Check(reopened.LoadDrafts().Single() == draft && repository.LoadDrafts().Single() == laterDraft, "snapshot draft is consistent while newer live draft remains untouched");

// Corrupt a generation copy through its content; the last other complete backup remains intact.
File.AppendAllText(Path.Combine(withConcurrentDraft.GenerationPath!, "content", sourceFile.RelativePath), "corruption");
Check(!backups.Verify(withConcurrentDraft.GenerationPath!).Valid, "corrupt generation checksum is rejected");
var refusedDestination = Path.Combine(testRoot, "CorruptRestore");
Refuses(() => backups.Restore(withConcurrentDraft.GenerationPath!, refusedDestination), "corrupt generation cannot restore");
Check(!Directory.Exists(refusedDestination), "failed verification creates no destination");

// An unfinished parser source is valid backup data once saved/observed, distinct
// from its last accepted AST; an incomplete recovery journal is not.
var invalidDraft = laterDraft with { Revision = 7, Source = note.Source + "\n@code{ @Broken = {" };
await service.SaveDraftAsync(invalidDraft);
var invalidSaved = await service.CommitNoteAsync(new(Op(), note.Id, invalidDraft.SessionId, invalidDraft.Revision, note.Revision, service.Current.Revision));
Check(invalidSaved.Status == "source-saved", "seed observed invalid source with last accepted semantics");
var invalidBackup = backups.Capture();
Check(invalidBackup.Status == "published", "observed invalid raw is included in coherent checkpoint");
var invalidRestored = backups.Restore(invalidBackup.GenerationPath!, Path.Combine(testRoot, "InvalidRawRestored"));
Check(invalidRestored.Problems.Any(p => p.Code == "source-stale"), "restore explicitly reports raw requiring reconciliation");
using (var reopened = new MarkdownWorkspaceRepository(invalidRestored.Path))
{
    var loaded = reopened.Load();
    Check(loaded.Notes[note.Id].CurrentSource == invalidDraft.Source && loaded.Notes[note.Id].Source == note.Source
        && loaded.Definitions[definitionId].Status == "Stale", "invalid raw and last accepted AST/definition remain separate after reopen");
}
var ops = new RecoverableFileOperations(workspace);
var pendingId = Guid.NewGuid();
ops.Prepare(pendingId, [new("pending.bin", null, [1, 2, 3])]);
var pendingCapture = backups.Capture();
Check(pendingCapture.Status == "rejected" && backups.Verify(invalidBackup.GenerationPath!).Valid, "pending recovery journal rejects publication without damaging last complete backup");
ops.Apply(pendingId); ops.MarkSemanticFinalized(pendingId, "test standalone file receipt");

var next = backups.Capture(retention: 2);
Check(next.Status == "published", "checkpoint works again after pending file operation finalizes");
Check(backups.ListVerified().Count == 2, "retention keeps configured number of verified generations");
Check(Directory.Exists(withConcurrentDraft.GenerationPath!), "retention does not delete corrupt generation as if it were owned complete history");

// Traversal remains rejected even if an attacker recomputes the unkeyed manifest
// checksum: integrity checks are not an authorization boundary for relative paths.
var manifestPath = Path.Combine(next.GenerationPath!, "manifest.json");
var manifestBytes = File.ReadAllBytes(manifestPath);
var originalMarker = File.ReadAllBytes(Path.Combine(next.GenerationPath!, "published.json"));
var malicious = Encoding.UTF8.GetString(manifestBytes).Replace("pending.bin", "../escape.bin", StringComparison.Ordinal);
File.WriteAllText(manifestPath, malicious, new UTF8Encoding(false));
File.WriteAllText(Path.Combine(next.GenerationPath!, "published.json"), JsonSerializer.Serialize(new { Format = 1, ManifestSha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(malicious))) }));
Check(!backups.Verify(next.GenerationPath!).Valid, "traversal path rejected independently of checksum");
File.WriteAllBytes(manifestPath, manifestBytes); File.WriteAllBytes(Path.Combine(next.GenerationPath!, "published.json"), originalMarker);
Check(backups.Verify(next.GenerationPath!).Valid, "bounded corruption fixture restored correctly");

var restoreOperation = Op();
var retryDestination = Path.Combine(testRoot, "RetryRestore");
var firstRestore = backups.Restore(next.GenerationPath!, retryDestination, operationId: restoreOperation);
var retryRestore = backups.Restore(next.GenerationPath!, retryDestination, operationId: restoreOperation);
Check(JsonSerializer.Serialize(firstRestore) == JsonSerializer.Serialize(retryRestore), "same restore operation returns original durable success result");
File.AppendAllText(Path.Combine(retryDestination, sourceFile.RelativePath), " user edit after restore");
var editedHash = SHA256.HashData(File.ReadAllBytes(Path.Combine(retryDestination, sourceFile.RelativePath)));
_ = backups.Restore(next.GenerationPath!, retryDestination, operationId: restoreOperation);
Check(editedHash.SequenceEqual(SHA256.HashData(File.ReadAllBytes(Path.Combine(retryDestination, sourceFile.RelativePath)))), "restore retry acknowledges completion without overwriting later edits");
Refuses(() => backups.Restore(invalidBackup.GenerationPath!, retryDestination, operationId: restoreOperation), "same operation with a different generation is rejected");
Refuses(() => backups.Restore(next.GenerationPath!, retryDestination, operationId: Op()), "different operation cannot reuse an existing target");
File.AppendAllText(manifestPath, " ");
Refuses(() => backups.Restore(next.GenerationPath!, retryDestination, operationId: restoreOperation), "same generation path with a different manifest payload is rejected");
File.WriteAllBytes(manifestPath, manifestBytes);
Console.WriteLine($"PASS: {count} backup assertions. Workspace: {testRoot}");
