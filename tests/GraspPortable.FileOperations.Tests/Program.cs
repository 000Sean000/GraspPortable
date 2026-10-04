using System.Text;
using System.Diagnostics;
using GraspPortable.Host.Workspace.FileOperations;

try
{
var checks = 0;
var tempRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "grasp-file-ops-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(tempRoot);
try
{
    BasicAndRestart();
    InterruptedRecovery();
    DurableReceiptAcknowledgement();
    ConflictsAndRaces();
    SafePathsAndIntegrity();
    BatchScaling();
    Console.WriteLine($"File operation checks passed: {checks}");
}
finally
{
    var full = Path.GetFullPath(tempRoot);
    if (full != tempRoot || !Path.GetFileName(full).StartsWith("grasp-file-ops-", StringComparison.Ordinal)
        || Path.GetDirectoryName(full) != Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())))
        throw new InvalidOperationException("Refusing to clean an unexpected test directory.");
    Directory.Delete(full, recursive: true);
}

void Check(bool value, string message) { checks++; if (!value) throw new Exception(message); }
void Throws<T>(Action action, string message) where T : Exception
{ checks++; try { action(); } catch (T) { return; } throw new Exception(message); }
byte[] Bytes(string value) => Encoding.UTF8.GetBytes(value);
string Hash(string value) => RecoverableFileOperations.Sha256(Bytes(value));
string Workspace(string name) { var path = Path.Combine(tempRoot, name); Directory.CreateDirectory(path); return path; }
void Write(string root, string name, string value) => File.WriteAllBytes(Path.Combine(root, name), Bytes(value));
string Read(string root, string name) => Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(root, name)));
string OperationPath(string root, Guid id) => Path.Combine(root, ".grasp", "operations", id.ToString("N"));

void BasicAndRestart()
{
    var root = Workspace("basic"); var store = new RecoverableFileOperations(root); var id = Guid.NewGuid();
    Write(root, "a.md", "原文\r\n"); Write(root, "b.md", "remove");
    var expected = new byte[] { 0xef, 0xbb, 0xbf, 0xe7, 0x94, 0xb2, 13, 10, 0, 255 };
    var capturedExpected = expected.ToArray();
    var changes = new[] { new FileMutation("a.md", Hash("原文\r\n"), expected),
        new FileMutation("b.md", Hash("remove"), null), new FileMutation("folder/c.md", null, []), new FileMutation("absent.md", null, null) };
    var prepared = store.Prepare(id, changes);
    Check(prepared.Phase == FileOperationPhase.Prepared && prepared.Conflicts.Count == 0 && !prepared.FilesWritten, "prepare only persists intent, absent delete is not a partial write");
    Check(Read(root, "a.md") == "原文\r\n" && File.Exists(Path.Combine(root, "b.md")), "prepare changes no user files");
    expected[0] = 0; // Caller mutation cannot change a published payload.
    var done = store.Apply(id);
    Check(done.Phase == FileOperationPhase.FilesWritten && done.SemanticReceipt is null, "file completion remains separate from semantics");
    Check(File.ReadAllBytes(Path.Combine(root, "a.md")).AsSpan().SequenceEqual(capturedExpected), "exact captured bytes including BOM, CRLF, null and non-UTF8 byte survive");
    Check(!File.Exists(Path.Combine(root, "b.md")) && File.ReadAllBytes(Path.Combine(root, "folder/c.md")).Length == 0, "create/delete/empty differ");
    Check(store.Apply(id).Phase == FileOperationPhase.FilesWritten, "apply retry is idempotent");
    var restarted = new RecoverableFileOperations(root);
    Check(restarted.Recover().Single().Phase == FileOperationPhase.FilesWritten, "restart reads manifest and desired files");
    Check(restarted.MarkSemanticFinalized(id, "revision:4").Phase == FileOperationPhase.SemanticFinalized, "explicit semantic finalization");
    Check(restarted.MarkSemanticFinalized(id, "revision:4").SemanticReceipt == "revision:4", "same finalization is idempotent");
    Throws<InvalidOperationException>(() => restarted.MarkSemanticFinalized(id, "revision:5"), "different final receipt must fail");
    Write(root, "a.md", "later ordinary edit");
    Check(restarted.Recover().Single().Phase == FileOperationPhase.SemanticFinalized && Read(root, "a.md") == "later ordinary edit", "historical finalized operation never replays over later edits");
    Throws<InvalidOperationException>(() => restarted.Prepare(id, [new("a.md", null, Bytes("different"))]), "operation reuse cannot replace payload");
    var manifestBytes = File.ReadAllBytes(Path.Combine(OperationPath(root, id), "manifest.json"));
    restarted.Inspect(id);
    Check(manifestBytes.AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(OperationPath(root, id), "manifest.json"))), "manifest remains immutable");
}

void InterruptedRecovery()
{
    var root = Workspace("interrupted"); Write(root, "a.md", "A0"); Write(root, "b.md", "B0");
    var id = Guid.NewGuid(); var store = new RecoverableFileOperations(root);
    var changes = new[] { new FileMutation("a.md", Hash("A0"), Bytes("A1")), new FileMutation("b.md", Hash("B0"), Bytes("B1")) };
    store.Prepare(id, changes);
    store.CheckpointForTest = point => { if (point.Stage == "after-mutation" && point.RelativePath == "a.md") throw new OperationCanceledException("simulated process interruption"); };
    Throws<OperationCanceledException>(() => store.Apply(id), "interrupt after first atomic replacement");
    Check(Read(root, "a.md") == "A1" && Read(root, "b.md") == "B0", "cross-file progress is visible, not falsely atomic");
    store = new(root);
    Check(store.Inspect(id).Phase == FileOperationPhase.PartiallyWritten, "partial state recovered without progress marker");
    Check(store.Prepare(id, changes).PayloadSha256 == store.Inspect(id).PayloadSha256, "same prepare retry uses immutable intent");
    Check(store.Recover().Single().Phase == FileOperationPhase.FilesWritten && Read(root, "b.md") == "B1", "resume skips desired and writes remaining expected");
    Write(root, "a.md", "A0");
    Check(store.Apply(id).Phase == FileOperationPhase.Conflict && Read(root, "a.md") == "A0", "external restoration after files-written is not permission to replay");

    var guardedRoot = Workspace("interrupted-external"); Write(guardedRoot, "a.md", "A0"); Write(guardedRoot, "b.md", "B0");
    var guarded = new RecoverableFileOperations(guardedRoot); var guardedId = Guid.NewGuid(); guarded.Prepare(guardedId, changes);
    guarded.CheckpointForTest = point => { if (point.Stage == "after-mutation") throw new OperationCanceledException(); };
    Throws<OperationCanceledException>(() => guarded.Apply(guardedId), "stop before recording per-file success");
    Write(guardedRoot, "a.md", "A0");
    Check(new RecoverableFileOperations(guardedRoot).Recover().Single().Phase == FileOperationPhase.Conflict
        && Read(guardedRoot, "a.md") == "A0" && Read(guardedRoot, "b.md") == "B0", "displaced evidence detects external old-hash restoration after an interrupted write");
}

void ConflictsAndRaces()
{
    var root = Workspace("conflicts"); Write(root, "a.md", "A0"); Write(root, "b.md", "B0");
    var store = new RecoverableFileOperations(root); var wrong = Guid.NewGuid();
    var rejected = store.Prepare(wrong, [new("a.md", Hash("wrong"), Bytes("A1")), new("b.md", Hash("B0"), Bytes("B1"))]);
    Check(rejected.Phase == FileOperationPhase.Conflict && rejected.Conflicts.Any(c => c.PreservedRelativePath is not null), "prepare conflict preserves observed bytes");
    Check(store.Apply(wrong).Phase == FileOperationPhase.Conflict && Read(root, "b.md") == "B0", "whole operation preflight prevents partial writes on known conflict");
    Throws<InvalidOperationException>(() => store.AcknowledgeDurableReceipt(wrong, rejected.PayloadSha256, "not-actually-committed"), "prepare conflict cannot be acknowledged");

    var external = Guid.NewGuid(); store.Prepare(external, [new("a.md", Hash("A0"), Bytes("A1")), new("b.md", Hash("B0"), Bytes("B1"))]);
    Write(root, "b.md", "external");
    var conflict = store.Apply(external);
    Check(conflict.Phase == FileOperationPhase.Conflict && Read(root, "a.md") == "A0" && Read(root, "b.md") == "external", "third-party preflight conflict does not overwrite either file");
    Check(conflict.Conflicts.Any(c => c.ObservedSha256 == Hash("external") && c.PreservedRelativePath is not null), "third-party version stored for later reconciliation");
    Write(root, "b.md", "B0");
    Check(new RecoverableFileOperations(root).Apply(external).Phase == FileOperationPhase.Conflict, "recorded conflict is not silently cleared by later changes");

    var raceRoot = Workspace("race"); Write(raceRoot, "a.md", "A0"); Write(raceRoot, "b.md", "B0");
    var racer = new RecoverableFileOperations(raceRoot); var race = Guid.NewGuid();
    racer.Prepare(race, [new("a.md", Hash("A0"), Bytes("A1")), new("b.md", Hash("B0"), Bytes("B1"))]);
    racer.CheckpointForTest = p => { if (p.Stage == "before-mutation" && p.RelativePath == "a.md") Write(raceRoot, "a.md", "raced version"); };
    var raced = racer.Apply(race);
    Check(raced.Phase == FileOperationPhase.Conflict && Read(raceRoot, "b.md") == "B0", "race stops subsequent writes");
    var displaced = raced.Conflicts.First(c => c.ObservedSha256 == Hash("raced version") && c.PreservedRelativePath?.Contains("displaced/") == true);
    Check(Read(raceRoot, displaced.PreservedRelativePath!) == "raced version", "File.Replace retains the actual raced bytes, not just old prepared bytes");
    Check(new RecoverableFileOperations(raceRoot).Recover().Single().Phase == FileOperationPhase.Conflict, "restart sees displaced-version conflict");
    Throws<InvalidOperationException>(() => racer.AcknowledgeDurableReceipt(race, raced.PayloadSha256, "not-actually-committed"), "replace race cannot be acknowledged");

    var deleteRoot = Workspace("delete-race"); Write(deleteRoot, "a.md", "A0"); var deleting = new RecoverableFileOperations(deleteRoot); var delete = Guid.NewGuid();
    deleting.Prepare(delete, [new("a.md", Hash("A0"), null)]);
    deleting.CheckpointForTest = p => { if (p.Stage == "before-mutation") Write(deleteRoot, "a.md", "keep deletion race"); };
    var deleted = deleting.Apply(delete);
    Check(deleted.Phase == FileOperationPhase.Conflict && deleted.Conflicts.Any(c => c.ObservedSha256 == Hash("keep deletion race")), "delete race preserves displaced version");

    var createRoot = Workspace("create-race"); var creating = new RecoverableFileOperations(createRoot); var create = Guid.NewGuid();
    creating.Prepare(create, [new("a.md", null, Bytes("ours"))]);
    creating.CheckpointForTest = p => { if (p.Stage == "before-mutation") Write(createRoot, "a.md", "theirs"); };
    Check(creating.Apply(create).Phase == FileOperationPhase.Conflict && Read(createRoot, "a.md") == "theirs", "create race never overwrites existing target");
}

void DurableReceiptAcknowledgement()
{
    var root = Workspace("durable-receipt"); Write(root, "a.md", "before");
    var store = new RecoverableFileOperations(root); var id = Guid.NewGuid();
    var prepared = store.Prepare(id, [new("a.md", Hash("before"), Bytes("committed output"))]);
    Throws<InvalidOperationException>(() => store.AcknowledgeDurableReceipt(id, prepared.PayloadSha256, "premature"), "prepare alone is not durable file completion");
    Check(store.Apply(id).Phase == FileOperationPhase.FilesWritten, "file outputs completed before fake database commit");
    // Stand-in for an already durable database receipt: the product caller must
    // read the actual repository receipt, not infer success from current files.
    var receiptPath = Path.Combine(root, "fake-db-receipt.txt");
    using (var receipt = new FileStream(receiptPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
    { receipt.Write(Bytes("db-revision:9")); receipt.Flush(true); }
    store = new(root); // Crash/restart before any semantic-finalized marker.
    Write(root, "a.md", "later third-party edit");
    var observed = store.Inspect(id);
    Check(observed.Phase == FileOperationPhase.Conflict && observed.Conflicts.Count > 0
        && observed.Conflicts.All(c => c.ObservedAfterFilesWritten), "late observation is retained with post-write provenance");
    Throws<InvalidOperationException>(() => store.MarkSemanticFinalized(id, "db-revision:9"), "ordinary finalization still refuses unresolved current conflicts");
    Throws<InvalidOperationException>(() => store.AcknowledgeDurableReceipt(id, Hash("wrong payload"), "db-revision:9"), "acknowledgement requires matching payload");
    var acknowledged = store.AcknowledgeDurableReceipt(id, prepared.PayloadSha256, File.ReadAllText(receiptPath));
    Check(acknowledged.Phase == FileOperationPhase.SemanticFinalized && acknowledged.FilesWritten
        && acknowledged.SemanticReceipt == "db-revision:9", "verified durable receipt finalizes the historical operation");
    Check(acknowledged.Conflicts.Any(c => c.ObservedSha256 == Hash("later third-party edit") && c.PreservedRelativePath is not null), "historical late conflict evidence is retained");
    Check(Read(root, "a.md") == "later third-party edit", "acknowledgement does not modify current source");
    Check(new RecoverableFileOperations(root).Recover().Single().Phase == FileOperationPhase.SemanticFinalized
        && Read(root, "a.md") == "later third-party edit", "restart never replays a receipt-acknowledged operation");
    Check(store.AcknowledgeDurableReceipt(id, prepared.PayloadSha256, "db-revision:9").Phase == FileOperationPhase.SemanticFinalized, "acknowledgement retry is idempotent");
    Throws<InvalidOperationException>(() => store.AcknowledgeDurableReceipt(id, prepared.PayloadSha256, "db-revision:10"), "different durable receipt cannot replace the original");
}

void SafePathsAndIntegrity()
{
    var root = Workspace("paths"); var store = new RecoverableFileOperations(root);
    foreach (var path in new[] { "../outside.md", "folder/../../outside.md", ".grasp/config.json", "folder/../a.md", "C:\\outside.md", "a.md:stream", "CON.md", "trailing. ", "folder//a.md" })
        Throws<ArgumentException>(() => store.Prepare(Guid.NewGuid(), [new(path, null, Bytes("x"))]), "unsafe path must fail: " + path);
    Throws<ArgumentException>(() => store.Prepare(Guid.NewGuid(), [new("A.md", null, []), new("a.md", null, [])]), "case alias targets fail");
    Throws<ArgumentException>(() => store.Prepare(Guid.NewGuid(), [new("folder", null, []), new("folder/a.md", null, [])]), "overlapping file/directory targets fail");
    Throws<ArgumentException>(() => store.Prepare(Guid.Empty, [new("a.md", null, [])]), "empty UUID fails");
    var outside = Workspace("outside"); var link = Path.Combine(root, "linked");
    try
    {
        try { Directory.CreateSymbolicLink(link, outside); }
        catch (IOException e) when (OperatingSystem.IsWindows() && (e.HResult & 0xffff) == 1314)
        {
            // A junction exercises the same reparse rejection without requiring
            // developer mode or altering system permissions for this test.
            var start = new ProcessStartInfo("cmd.exe") { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var argument in new[] { "/d", "/c", "mklink", "/J", link, outside }) start.ArgumentList.Add(argument);
            using var process = Process.Start(start)!;
            var output = process.StandardOutput.ReadToEnd(); var error = process.StandardError.ReadToEnd(); process.WaitForExit();
            if (process.ExitCode != 0) throw new IOException("Could not create bounded reparse fixture: " + output + error);
        }
        Throws<IOException>(() => store.Prepare(Guid.NewGuid(), [new("linked/a.md", null, Bytes("x"))]), "symlink target must fail");
        Check(!File.Exists(Path.Combine(outside, "a.md")), "symlink target receives no writes");
    }
    finally { if (Directory.Exists(link)) Directory.Delete(link); } // Link itself, never its target.
    var corrupt = Guid.NewGuid(); store.Prepare(corrupt, [new("a.md", null, Bytes("payload"))]);
    var blob = Path.Combine(OperationPath(root, corrupt), "blobs", Hash("payload") + ".bin");
    File.WriteAllText(blob, "tampered");
    Throws<InvalidDataException>(() => new RecoverableFileOperations(root).Apply(corrupt), "tampered recovery content fails before writing");
    Check(!File.Exists(Path.Combine(root, "a.md")), "corruption never reaches user file");
}

void BatchScaling()
{
    const int count = 100;
    var root = Workspace("batch"); var store = new RecoverableFileOperations(root); var id = Guid.NewGuid();
    var changes = Enumerable.Range(0, count).Select(i => new FileMutation($"note-{i:000}.md", Hash("before"), Bytes("after"))).ToArray();
    foreach (var change in changes) Write(root, change.RelativePath, "before");
    var timer = Stopwatch.StartNew(); store.Prepare(id, changes); var prepareMs = timer.Elapsed.TotalMilliseconds;
    timer.Restart(); var status = store.Apply(id); var applyMs = timer.Elapsed.TotalMilliseconds;
    Check(status.Phase == FileOperationPhase.FilesWritten && status.Files.Count == count, "100-file bounded batch completes");
    Check(changes.All(c => Read(root, c.RelativePath) == "after"), "100-file batch has exact intended outputs");
    Console.WriteLine($"File batch ({count} files): prepare={prepareMs:F1} ms, apply={applyMs:F1} ms; local observation, not a hardware guarantee.");
}
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
