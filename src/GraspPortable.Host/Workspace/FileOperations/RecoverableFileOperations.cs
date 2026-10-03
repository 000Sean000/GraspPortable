using System.Security.Cryptography;
using System.Text.Json;

namespace GraspPortable.Host.Workspace.FileOperations;

/// <summary>
/// Restartable, byte-exact file writes. A durable immutable manifest precedes
/// mutations; every displaced version is retained. Per-file moves/replacements
/// are atomic on the supported local filesystem, not compare-and-swap and not a
/// multi-file transaction. Semantic finalization is an explicit caller step.
/// Flush(true) protects file contents; arbitrary filesystem/power-loss directory
/// metadata durability and hostile namespace substitution are not guaranteed.
/// </summary>
public sealed class RecoverableFileOperations
{
    private const string Operations = ".grasp/operations";
    private readonly WorkspaceFilePaths paths;
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    public Action<FileOperationCheckpoint>? CheckpointForTest { get; set; }

    public RecoverableFileOperations(string workspaceRoot) => paths = new(workspaceRoot);
    public static string Sha256(ReadOnlySpan<byte> content) => Convert.ToHexStringLower(SHA256.HashData(content));

    /// <summary>Same UUID/payload is idempotent; a different payload is rejected.</summary>
    public FileOperationReport Prepare(Guid operationId, IReadOnlyList<FileMutation> mutations)
    {
        ValidateId(operationId);
        ArgumentNullException.ThrowIfNull(mutations);
        // Snapshot caller buffers before hashing or publishing an accepted intent.
        var requests = mutations.Select(m => new FileMutation(paths.NormalizeUserPath(m.RelativePath),
            NormalizeHash(m.ExpectedSha256), m.NextContent?.ToArray())).OrderBy(m => m.RelativePath, StringComparer.Ordinal).ToArray();
        var targets = requests.Select(m => m.RelativePath).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (requests.Length == 0 || targets.Count != requests.Length)
            throw new ArgumentException("An operation needs unique, nonempty file paths.", nameof(mutations));
        // A file cannot also be another target's parent directory.
        foreach (var request in requests)
            for (var slash = request.RelativePath.LastIndexOf('/'); slash >= 0; slash = request.RelativePath.LastIndexOf('/', slash - 1))
                if (targets.Contains(request.RelativePath[..slash]))
                    throw new ArgumentException("File targets overlap with a target directory.", nameof(mutations));
        var payload = PayloadHash(requests.Select(m => new PreparedFileChange(m.RelativePath, m.ExpectedSha256, null,
            m.NextContent is null ? null : Sha256(m.NextContent))).ToArray());
        using var writer = Lock();
        if (File.Exists(paths.Resolve(Operation(operationId) + "/manifest.json")))
        {
            var previous = Load(operationId);
            if (previous.PayloadSha256 != payload) throw new InvalidOperationException("Operation UUID already belongs to a different payload.");
            return InspectCore(previous);
        }

        var captures = requests.Select(m => (Request: m, Before: ReadUserFile(m.RelativePath))).ToArray();
        var files = captures.Select(c => new PreparedFileChange(c.Request.RelativePath, c.Request.ExpectedSha256,
            c.Before is null ? null : Sha256(c.Before), c.Request.NextContent is null ? null : Sha256(c.Request.NextContent))).ToArray();
        var manifest = new FileOperationManifest(1, operationId, payload, DateTimeOffset.UtcNow, files);
        foreach (var capture in captures)
        {
            if (capture.Before is not null) StoreBlob(operationId, capture.Before);
            if (capture.Request.NextContent is not null) StoreBlob(operationId, capture.Request.NextContent);
        }
        WriteImmutable(Operation(operationId) + "/manifest.json", JsonSerializer.SerializeToUtf8Bytes(manifest, Json));
        return InspectCore(manifest);
    }

    /// <summary>Inspection retains newly observed conflict bytes; it never mutates user files.</summary>
    public FileOperationReport Inspect(Guid operationId)
    { using var writer = Lock(); return InspectCore(Load(operationId)); }

    public FileOperationReport Apply(Guid operationId)
    { using var writer = Lock(); return ApplyCore(Load(operationId)); }

    /// <summary>Only published manifests are accepted operations. Unpublished staging is never applied.</summary>
    public IReadOnlyList<FileOperationReport> Recover()
    {
        using var writer = Lock();
        var results = new List<FileOperationReport>();
        foreach (var folder in Directory.EnumerateDirectories(paths.Resolve(Operations)).Order(StringComparer.Ordinal))
        {
            WorkspaceFilePaths.EnsureNoReparse(folder);
            if (Guid.TryParseExact(Path.GetFileName(folder), "N", out var id) && File.Exists(paths.Resolve(Operation(id) + "/manifest.json")))
                results.Add(ApplyCore(Load(id)));
        }
        return results;
    }

    /// <summary>
    /// Caller supplies an already durable semantic receipt. This marker is not a
    /// transaction with SQLite; restart integration must consult the real receipt.
    /// </summary>
    public FileOperationReport MarkSemanticFinalized(Guid operationId, string receipt)
    {
        if (string.IsNullOrWhiteSpace(receipt)) throw new ArgumentException("A durable semantic receipt is required.", nameof(receipt));
        using var writer = Lock();
        var manifest = Load(operationId);
        var status = InspectCore(manifest);
        if (status.Phase == FileOperationPhase.SemanticFinalized)
        {
            if (status.SemanticReceipt != receipt) throw new InvalidOperationException("Semantic receipt already differs.");
            return status;
        }
        if (status.Phase != FileOperationPhase.FilesWritten) throw new InvalidOperationException("All expected file writes must finish without conflict first.");
        WriteImmutable(Operation(operationId) + "/semantic-finalized.json", JsonSerializer.SerializeToUtf8Bytes(new CompletionMarker(manifest.PayloadSha256, receipt), Json));
        return InspectCore(manifest);
    }

    /// <summary>
    /// Closes the crash gap after the database committed but before its local
    /// finalization marker was written. The caller MUST first read and validate
    /// the real durable successful database receipt for this operation/payload;
    /// this filesystem primitive cannot authenticate that external assertion.
    /// Requires a matching durable files-written marker and no earlier mutation
    /// conflicts. Later file edits are preserved and reconciled separately, never
    /// replayed or rolled back. This acknowledgement is not atomic with SQLite.
    /// </summary>
    public FileOperationReport AcknowledgeDurableReceipt(Guid operationId, string expectedPayloadSha256, string receipt)
    {
        if (string.IsNullOrWhiteSpace(receipt)) throw new ArgumentException("A verified durable semantic receipt is required.", nameof(receipt));
        using var writer = Lock();
        var manifest = Load(operationId);
        if (NormalizeHash(expectedPayloadSha256) != manifest.PayloadSha256)
            throw new InvalidOperationException("Durable receipt payload does not match the file operation.");
        if (Marker(Operation(operationId) + "/files-written.json", manifest.PayloadSha256) is null)
            throw new InvalidOperationException("A durable files-written marker is required before acknowledgement.");
        var status = InspectCore(manifest);
        if (status.Conflicts.Any(c => !c.ObservedAfterFilesWritten))
            throw new InvalidOperationException("Preparation or mutation conflicts cannot be acknowledged as successful.");
        if (status.SemanticReceipt is not null && status.SemanticReceipt != receipt)
            throw new InvalidOperationException("Semantic receipt already differs.");
        WriteImmutable(Operation(operationId) + "/semantic-finalized.json", JsonSerializer.SerializeToUtf8Bytes(new CompletionMarker(manifest.PayloadSha256, receipt), Json));
        return InspectCore(manifest);
    }

    private FileOperationReport ApplyCore(FileOperationManifest manifest)
    {
        var status = InspectCore(manifest);
        if (status.Phase is FileOperationPhase.SemanticFinalized or FileOperationPhase.FilesWritten) return status;
        if (status.Conflicts.Count != 0) { PreserveUnexpected(manifest); return InspectCore(manifest); }
        for (var index = 0; index < manifest.Files.Count; index++)
        {
            var entry = manifest.Files[index];
            var before = ReadUserFile(entry.RelativePath);
            var currentHash = before is null ? null : Sha256(before);
            if (currentHash == entry.DesiredSha256) continue;
            if (currentHash != entry.ExpectedSha256)
            { RecordConflict(manifest.OperationId, entry.RelativePath, "File changed after prepare.", before); return InspectCore(manifest); }

            var attempt = new MutationAttempt(index, Guid.NewGuid());
            var prefix = Operation(manifest.OperationId);
            var backup = prefix + "/displaced/" + attempt.AttemptId.ToString("N") + ".bin";
            var staging = prefix + "/staging/" + attempt.AttemptId.ToString("N") + ".tmp";
            paths.EnsureDirectory(prefix + "/displaced");
            if (entry.DesiredSha256 is not null) WriteImmutable(staging, ReadBlob(manifest.OperationId, entry.DesiredSha256));
            WriteImmutable(prefix + "/attempts/" + attempt.AttemptId.ToString("N") + ".json", JsonSerializer.SerializeToUtf8Bytes(attempt, Json));
            var parent = Path.GetDirectoryName(entry.RelativePath.Replace('/', Path.DirectorySeparatorChar));
            if (!string.IsNullOrEmpty(parent)) paths.EnsureDirectory(parent);
            CheckpointForTest?.Invoke(new(manifest.OperationId, entry.RelativePath, "before-mutation"));
            // Re-resolve immediately before I/O, while preserving a displaced
            // version if another editor changed bytes after our hash check.
            try
            {
                var target = paths.Resolve(entry.RelativePath);
                if (entry.DesiredSha256 is null) File.Move(target, paths.Resolve(backup));
                else if (entry.ExpectedSha256 is null) File.Move(paths.Resolve(staging), target);
                else File.Replace(paths.Resolve(staging), target, paths.Resolve(backup));
            }
            catch (IOException)
            {
                var actual = ReadUserFile(entry.RelativePath);
                var actualHash = actual is null ? null : Sha256(actual);
                if (actualHash == entry.DesiredSha256) continue;
                if (actualHash == entry.ExpectedSha256) throw; // I/O failure, still resumable.
                RecordConflict(manifest.OperationId, entry.RelativePath, "Competing file change prevented mutation.", actual);
                return InspectCore(manifest);
            }
            CheckpointForTest?.Invoke(new(manifest.OperationId, entry.RelativePath, "after-mutation"));
            if (File.Exists(paths.Resolve(backup)))
            {
                var displaced = ReadBytes(backup);
                if (Sha256(displaced) != entry.ExpectedSha256)
                {
                    RecordConflict(manifest.OperationId, entry.RelativePath, "Competing version was displaced during mutation.", displaced);
                    return InspectCore(manifest);
                }
            }
            var after = ReadUserFile(entry.RelativePath);
            if ((after is null ? null : Sha256(after)) != entry.DesiredSha256)
            {
                RecordConflict(manifest.OperationId, entry.RelativePath, "File changed immediately after mutation.", after);
                return InspectCore(manifest);
            }
        }
        status = InspectCore(manifest);
        if (status.Conflicts.Count == 0 && status.Files.All(f => f.State == FileVersionState.Desired))
            WriteImmutable(Operation(manifest.OperationId) + "/files-written.json", JsonSerializer.SerializeToUtf8Bytes(new CompletionMarker(manifest.PayloadSha256), Json));
        return InspectCore(manifest);
    }

    private FileOperationReport InspectCore(FileOperationManifest manifest)
    {
        var conflicts = new List<FileConflict>();
        var progress = new List<FileProgress>();
        var prefix = Operation(manifest.OperationId);
        var written = Marker(prefix + "/files-written.json", manifest.PayloadSha256);
        var finalized = Marker(prefix + "/semantic-finalized.json", manifest.PayloadSha256);
        if (finalized is not null && (written is null || string.IsNullOrWhiteSpace(finalized.Receipt))) throw new InvalidDataException("Invalid finalization marker.");
        foreach (var file in manifest.Files)
        {
            if (file.BeforeSha256 is not null) _ = ReadBlob(manifest.OperationId, file.BeforeSha256);
            if (file.DesiredSha256 is not null) _ = ReadBlob(manifest.OperationId, file.DesiredSha256);
            if (file.BeforeSha256 != file.ExpectedSha256)
                conflicts.Add(new(file.RelativePath, "Expected hash did not match during prepare.", file.BeforeSha256,
                    file.BeforeSha256 is null ? null : Blob(manifest.OperationId, file.BeforeSha256)));
            var bytes = ReadUserFile(file.RelativePath);
            var hash = bytes is null ? null : Sha256(bytes);
            var state = hash == file.DesiredSha256 ? FileVersionState.Desired : hash == file.ExpectedSha256 ? FileVersionState.Expected : FileVersionState.Unexpected;
            progress.Add(new(file.RelativePath, hash, state));
            if (finalized is null && (state == FileVersionState.Unexpected || written is not null && state != FileVersionState.Desired))
                // Retain the bytes from this exact read, rather than hoping an
                // external editor has not changed them before a second capture.
                RecordConflict(manifest.OperationId, file.RelativePath, written is null
                    ? "Current file is neither expected nor desired."
                    : "File changed after all writes completed; stale output will not be reapplied.", bytes, afterFilesWritten: written is not null);
        }
        foreach (var attemptPath in Files(prefix + "/attempts", "*.json"))
        {
            var attempt = ReadJson<MutationAttempt>(attemptPath);
            if (attempt.Index < 0 || attempt.Index >= manifest.Files.Count || attempt.AttemptId == Guid.Empty)
                throw new InvalidDataException("Invalid mutation attempt.");
            var backup = prefix + "/displaced/" + attempt.AttemptId.ToString("N") + ".bin";
            var file = manifest.Files[attempt.Index];
            var backupExists = File.Exists(paths.Resolve(backup));
            var staging = prefix + "/staging/" + attempt.AttemptId.ToString("N") + ".tmp";
            var mutationObserved = backupExists || file.ExpectedSha256 is null && !File.Exists(paths.Resolve(staging));
            if (finalized is null && mutationObserved && progress[attempt.Index].State != FileVersionState.Desired)
                conflicts.Add(new(file.RelativePath, "An already mutated path changed again; even a return to the old hash is not permission to replay.", progress[attempt.Index].CurrentSha256, null,
                    ObservedAfterFilesWritten: written is not null));
            if (backupExists)
            {
                var hash = Sha256(ReadBytes(backup));
                if (hash != file.ExpectedSha256)
                    conflicts.Add(new(file.RelativePath, "A competing version was displaced and preserved; no automatic overwrite or rollback follows.", hash, backup));
            }
        }
        foreach (var conflictPath in Files(prefix + "/conflicts", "*.json")) conflicts.Add(ReadJson<FileConflict>(conflictPath));
        var allDesired = progress.All(f => f.State == FileVersionState.Desired);
        // A finalized receipt is historical: later legitimate edits are handled
        // by workspace reconciliation, never by replaying this older operation.
        var blocked = conflicts.Any(c => finalized is null || !c.ObservedAfterFilesWritten);
        var filesWritten = written is not null && (allDesired || finalized is not null) && !blocked;
        var phase = blocked ? FileOperationPhase.Conflict : filesWritten
            ? finalized is null ? FileOperationPhase.FilesWritten : FileOperationPhase.SemanticFinalized
            : progress.Where((f, i) => f.State == FileVersionState.Desired && manifest.Files[i].ExpectedSha256 != manifest.Files[i].DesiredSha256).Any()
                ? FileOperationPhase.PartiallyWritten : FileOperationPhase.Prepared;
        return new(manifest.OperationId, manifest.PayloadSha256, phase, filesWritten, finalized?.Receipt, progress, conflicts);
    }

    private void PreserveUnexpected(FileOperationManifest manifest)
    {
        var afterFilesWritten = Marker(Operation(manifest.OperationId) + "/files-written.json", manifest.PayloadSha256) is not null;
        foreach (var file in manifest.Files)
        {
            var bytes = ReadUserFile(file.RelativePath); var hash = bytes is null ? null : Sha256(bytes);
            if (hash != file.ExpectedSha256 && hash != file.DesiredSha256)
                RecordConflict(manifest.OperationId, file.RelativePath, "Unexpected external version retained for reconciliation.", bytes, afterFilesWritten);
        }
    }

    private void RecordConflict(Guid id, string file, string reason, byte[]? observed, bool afterFilesWritten = false)
    {
        var hash = observed is null ? null : Sha256(observed);
        if (observed is not null) StoreBlob(id, observed);
        var conflict = new FileConflict(file, reason, hash, hash is null ? null : Blob(id, hash), afterFilesWritten);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(conflict, Json);
        WriteImmutable(Operation(id) + "/conflicts/" + Sha256(bytes) + ".json", bytes);
    }

    private FileOperationManifest Load(Guid id)
    {
        ValidateId(id);
        var manifest = ReadJson<FileOperationManifest>(Operation(id) + "/manifest.json");
        if (manifest.FormatVersion != 1 || manifest.OperationId != id || manifest.Files.Count == 0)
            throw new InvalidDataException("Unsupported or invalid operation manifest.");
        foreach (var entry in manifest.Files)
        {
            if (entry.RelativePath != paths.NormalizeUserPath(entry.RelativePath)) throw new InvalidDataException("Noncanonical manifest path.");
            if (entry.ExpectedSha256 != NormalizeHash(entry.ExpectedSha256) || entry.BeforeSha256 != NormalizeHash(entry.BeforeSha256)
                || entry.DesiredSha256 != NormalizeHash(entry.DesiredSha256)) throw new InvalidDataException("Noncanonical manifest hash.");
        }
        if (manifest.Files.Select(f => f.RelativePath).Distinct(StringComparer.OrdinalIgnoreCase).Count() != manifest.Files.Count
            || PayloadHash(manifest.Files) != manifest.PayloadSha256) throw new InvalidDataException("Operation manifest integrity failed.");
        return manifest;
    }

    private FileStream Lock()
    {
        paths.EnsureDirectory(Operations);
        return new FileStream(paths.Resolve(Operations + "/.writer.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }
    private static void ValidateId(Guid id) { if (id == Guid.Empty) throw new ArgumentException("A nonempty operation UUID is required.", nameof(id)); }
    private static string Operation(Guid id) => Operations + "/" + id.ToString("N");
    private static string Blob(Guid id, string hash) => Operation(id) + "/blobs/" + hash + ".bin";
    private static string? NormalizeHash(string? hash)
    {
        if (hash is null) return null;
        if (hash.Length != 64 || hash.Any(c => !Uri.IsHexDigit(c))) throw new ArgumentException("Expected SHA-256 must have 64 hexadecimal characters.", nameof(hash));
        return hash.ToLowerInvariant();
    }
    private static string PayloadHash(IReadOnlyList<PreparedFileChange> files) => Sha256(JsonSerializer.SerializeToUtf8Bytes(
        files.Select(f => new { f.RelativePath, f.ExpectedSha256, f.DesiredSha256 }).OrderBy(f => f.RelativePath, StringComparer.Ordinal)));
    private byte[]? ReadUserFile(string relative)
    {
        var full = paths.Resolve(relative);
        try { using var stream = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.Read); using var bytes = new MemoryStream(); stream.CopyTo(bytes); return bytes.ToArray(); }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }
    private byte[] ReadBytes(string relative) => ReadUserFile(relative) ?? throw new FileNotFoundException("Missing recovery material.", relative);
    private T ReadJson<T>(string relative) => JsonSerializer.Deserialize<T>(ReadBytes(relative), Json) ?? throw new InvalidDataException("Empty recovery record.");
    private CompletionMarker? Marker(string relative, string payload)
    {
        if (!File.Exists(paths.Resolve(relative))) return null;
        var marker = ReadJson<CompletionMarker>(relative);
        if (marker.PayloadSha256 != payload) throw new InvalidDataException("Completion marker does not match its operation.");
        return marker;
    }
    private IEnumerable<string> Files(string relative, string pattern)
    {
        var full = paths.Resolve(relative);
        return Directory.Exists(full) ? Directory.EnumerateFiles(full, pattern).Order(StringComparer.Ordinal).Select(p => Path.GetRelativePath(paths.Root, p).Replace('\\', '/')).ToArray() : [];
    }
    private byte[] ReadBlob(Guid id, string hash)
    {
        var bytes = ReadBytes(Blob(id, hash));
        if (Sha256(bytes) != hash) throw new InvalidDataException("Recovery blob integrity failed.");
        return bytes;
    }
    private void StoreBlob(Guid id, byte[] bytes) => WriteImmutable(Blob(id, Sha256(bytes)), bytes);
    private void WriteImmutable(string relative, byte[] bytes)
    {
        var target = paths.Resolve(relative);
        if (File.Exists(target))
        {
            if (!ReadBytes(relative).AsSpan().SequenceEqual(bytes)) throw new InvalidDataException("Immutable recovery record already has different bytes.");
            return;
        }
        var parent = Path.GetDirectoryName(relative.Replace('/', Path.DirectorySeparatorChar))!;
        paths.EnsureDirectory(parent);
        var temporary = relative + ".writing-" + Guid.NewGuid().ToString("N");
        using (var stream = new FileStream(paths.Resolve(temporary), FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        { stream.Write(bytes); stream.Flush(flushToDisk: true); }
        File.Move(paths.Resolve(temporary), paths.Resolve(relative));
    }
}
