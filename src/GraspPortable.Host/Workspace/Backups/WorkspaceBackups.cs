using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace.FileOperations;
using GraspPortable.Host.Workspace.Markdown;
using Microsoft.Data.Sqlite;

namespace GraspPortable.Host.Workspace.Backups;

/// <summary>
/// Full, verified directory checkpoints. Capture callers must hold the coordinator
/// mutation gate. SQLite's online backup includes a consistent draft snapshot even
/// while SaveDraft runs; drafts accepted later belong to the next checkpoint.
/// External editors are not locked: stable inventories plus registry/source checks
/// detect observable races, not an atomic global instant or hostile namespace races.
/// </summary>
public sealed class WorkspaceBackups
{
    private const string Database = "workspace.grasp.db";
    private readonly string root;
    private readonly string store;
    public Action<string>? CheckpointForTest { get; set; }

    public WorkspaceBackups(string workspacePath)
    {
        root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(workspacePath));
        WorkspaceFilePaths.EnsureNoReparse(root);
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException(root);
        store = Inside(root, ".grasp/backups");
    }

    /// <summary>Always publishes when called successfully; the scheduler owns change detection.</summary>
    public BackupCaptureResult Capture(int retention = 3, CancellationToken cancellationToken = default)
    {
        if (retention < 1 || retention > 100) throw new ArgumentOutOfRangeException(nameof(retention));
        string? stage = null;
        string? published = null;
        try
        {
            Directory.CreateDirectory(store);
            WorkspaceFilePaths.EnsureNoReparse(store);
            using var captureLock = new FileStream(Inside(store, ".capture.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            cancellationToken.ThrowIfCancellationRequested();
            var before = Inventory(root, excludeRuntime: true, cancellationToken);
            stage = Inside(store, ".staging-" + Guid.NewGuid().ToString("N"));
            var content = Inside(stage, "content");
            Directory.CreateDirectory(content);
            BackupDatabase(Inside(root, Database), Inside(content, Database));
            CheckpointForTest?.Invoke("after-database-snapshot");
            foreach (var directory in before.Directories) Directory.CreateDirectory(Inside(content, directory));
            foreach (var entry in before.Files)
            {
                cancellationToken.ThrowIfCancellationRequested();
                Copy(Inside(root, entry.Path), Inside(content, entry.Path));
            }
            CheckpointForTest?.Invoke("after-files-copied");
            var after = Inventory(root, excludeRuntime: true, cancellationToken);
            if (!Same(before, after)) throw new InvalidDataException("Workspace paths or bytes changed during checkpoint capture.");
            var captured = Inventory(content, excludeRuntime: false, cancellationToken);
            if (!Same(before, captured with { Files = captured.Files.Where(f => f.Path != Database).ToArray() }))
                throw new InvalidDataException("Captured files differ from the stable source inventory.");
            var state = ValidateContent(content, captured);
            var manifest = new BackupManifest(1, state.WorkspaceId, DateTimeOffset.UtcNow, captured);
            Write(Inside(stage, "manifest.json"), JsonSerializer.SerializeToUtf8Bytes(manifest));
            Write(Inside(stage, "published.json"), JsonSerializer.SerializeToUtf8Bytes(new BackupPublished(1, HashFile(Inside(stage, "manifest.json")))));
            RequireVerified(stage, allowStaging: true);
            cancellationToken.ThrowIfCancellationRequested();
            CheckpointForTest?.Invoke("before-publish");
            if (!Same(after, Inventory(root, excludeRuntime: true, cancellationToken)))
                throw new InvalidDataException("Workspace changed before checkpoint publication.");
            var generation = "generation-" + manifest.CreatedAt.ToString("yyyyMMddTHHmmssfffffffZ") + "-" + Guid.NewGuid().ToString("N");
            published = Inside(store, generation);
            Directory.Move(stage, published);
            stage = null;
            var warnings = new List<BackupProblem>();
            try { Retain(state.WorkspaceId, retention, published); }
            catch (Exception error) when (Expected(error)) { warnings.Add(new("retention", store, error.Message)); }
            return new("published", published, warnings.ToArray());
        }
        catch (Exception error) when (Expected(error) || error is OperationCanceledException)
        {
            // Leave incomplete stages as evidence. They are never listed or retained
            // as successful generations, and never displace the last complete backup.
            return new(error is OperationCanceledException ? "cancelled" : "rejected", published,
                [new("capture", stage ?? root, error.Message)]);
        }
    }

    public BackupVerificationResult Verify(string generationPath)
    {
        try
        {
            var manifest = RequireVerified(Path.GetFullPath(generationPath));
            return new(true, manifest.WorkspaceId, []);
        }
        catch (Exception error) when (Expected(error)) { return new(false, null, [new("verify", generationPath, error.Message)]); }
    }

    public IReadOnlyList<BackupGeneration> ListVerified()
    {
        WorkspaceFilePaths.EnsureNoReparse(store);
        if (!Directory.Exists(store)) return [];
        var result = new List<BackupGeneration>();
        foreach (var directory in Directory.EnumerateDirectories(store, "generation-*", SearchOption.TopDirectoryOnly))
        {
            try
            {
                var manifest = RequireVerified(directory);
                result.Add(new(directory, manifest.WorkspaceId, manifest.CreatedAt, manifest.Content.Files.Length));
            }
            catch (Exception error) when (Expected(error)) { /* Corrupt/foreign entries are never eligible for deletion. */ }
        }
        return result.OrderByDescending(g => g.CreatedAt).ThenBy(g => g.Path, StringComparer.Ordinal).ToArray();
    }

    /// <summary>
    /// Restores into a previously nonexistent folder. A supplied operation UUID
    /// can acknowledge an earlier success without replaying or touching later edits.
    /// </summary>
    public BackupRestoreResult Restore(string generationPath, string newFolder, CancellationToken cancellationToken = default, string? operationId = null)
    {
        var generation = Path.TrimEndingDirectorySeparator(Path.GetFullPath(generationPath));
        var target = Path.TrimEndingDirectorySeparator(Path.GetFullPath(newFolder));
        var id = operationId is null ? Guid.NewGuid().ToString("N")
            : Guid.TryParse(operationId, out var parsed) && parsed != Guid.Empty ? parsed.ToString("N")
            : throw new ArgumentException("Restore operation ID must be a nonempty UUID.", nameof(operationId));
        WorkspaceFilePaths.EnsureNoReparse(target);
        if (File.Exists(target) || Directory.Exists(target))
        {
            if (operationId is not null && Directory.Exists(target))
            {
                var receiptPath = Inside(target, ".grasp/restore-receipt.json");
                if (File.Exists(receiptPath))
                {
                    var previous = Read<RestoreReceipt>(receiptPath);
                    if (previous.Format == 1 && previous.OperationId == id
                        && previous.SourceGeneration.Equals(generation, StringComparison.OrdinalIgnoreCase)
                        && previous.Target.Equals(target, StringComparison.OrdinalIgnoreCase)
                        && previous.Result.Path.Equals(target, StringComparison.OrdinalIgnoreCase))
                    {
                        // A retained receipt remains authoritative if its generation
                        // has since expired. If still present, reject same-path reuse
                        // for a different payload without checking or rewriting target data.
                        var sourceManifest = Inside(generation, "manifest.json");
                        if (previous.ManifestSha256.Length != 64 || previous.ManifestSha256.Any(c => !Uri.IsHexDigit(c))
                            || File.Exists(sourceManifest) && HashFile(sourceManifest) != previous.ManifestSha256)
                            throw new InvalidDataException("Restore operation was already used with a different generation payload.");
                        return previous.Result;
                    }
                }
            }
            throw new IOException("Restore requires a nonexistent destination, or the receipt for this exact completed operation.");
        }
        var manifest = RequireVerified(generation);
        var manifestHash = HashFile(Inside(generation, "manifest.json"));
        if (target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || target.Equals(root, StringComparison.OrdinalIgnoreCase)
            || target.StartsWith(generation + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new IOException("Restore destination must be outside the source workspace and backup generation.");
        var parent = Path.GetDirectoryName(target) ?? throw new IOException("Invalid restore destination.");
        if (!Directory.Exists(parent)) throw new DirectoryNotFoundException(parent);
        var staging = Inside(parent, ".grasp-restore-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            foreach (var directory in manifest.Content.Directories) Directory.CreateDirectory(Inside(staging, directory));
            foreach (var entry in manifest.Content.Files)
            {
                cancellationToken.ThrowIfCancellationRequested();
                Copy(Inside(Inside(generation, "content"), entry.Path), Inside(staging, entry.Path));
            }
            var restored = Inventory(staging, excludeRuntime: false, cancellationToken);
            if (!Same(manifest.Content, restored))
                throw new InvalidDataException("Restored bytes do not match the complete generation.");
            var state = ValidateContent(staging, restored);
            if (state.WorkspaceId != manifest.WorkspaceId) throw new InvalidDataException("Restored workspace identity differs.");
            cancellationToken.ThrowIfCancellationRequested();
            // The startup schema probe opens an existing cooperative lock read-only.
            // Runtime locks are excluded from checkpoints, so create a fresh empty
            // lock only after the restored payload has passed exact verification.
            Write(Inside(staging, ".grasp.lock"), []);
            var result = new BackupRestoreResult(target, state.Problems);
            var receipt = new RestoreReceipt(1, id, generation, target, manifestHash, result);
            var receiptDirectory = Inside(staging, ".grasp");
            Directory.CreateDirectory(receiptDirectory);
            var receiptTemporary = Inside(receiptDirectory, "restore-receipt-" + Guid.NewGuid().ToString("N") + ".tmp");
            Write(receiptTemporary, JsonSerializer.SerializeToUtf8Bytes(receipt));
            // Only this owned restore marker can replace a receipt carried by the
            // backup; all original content has already passed exact verification.
            File.Move(receiptTemporary, Inside(staging, ".grasp/restore-receipt.json"), overwrite: true);
            WorkspaceFilePaths.EnsureNoReparse(target);
            Directory.Move(staging, target);
            return result;
        }
        catch (Exception error)
        {
            throw new IOException($"Restore was not published. The destination was not overwritten; incomplete copy retained at {staging}. {error.Message}", error);
        }
    }

    private void Retain(string workspaceId, int retention, string justPublished)
    {
        var candidates = ListVerified().Where(g => g.WorkspaceId == workspaceId).ToArray();
        foreach (var obsolete in candidates.Skip(retention))
        {
            if (obsolete.Path == justPublished) continue;
            var full = Path.GetFullPath(obsolete.Path);
            if (!string.Equals(Path.GetDirectoryName(full), store, StringComparison.OrdinalIgnoreCase)
                || !Path.GetFileName(full).StartsWith("generation-", StringComparison.Ordinal))
                throw new IOException("Retention path is outside this workspace's generation store.");
            if (RequireVerified(full).WorkspaceId != workspaceId) throw new IOException("Retention ownership changed.");
            WorkspaceFilePaths.EnsureNoReparse(full);
            Directory.Delete(full, recursive: true);
        }
    }

    private static BackupManifest RequireVerified(string generation, bool allowStaging = false)
    {
        WorkspaceFilePaths.EnsureNoReparse(generation);
        if (!allowStaging && !Path.GetFileName(Path.TrimEndingDirectorySeparator(generation)).StartsWith("generation-", StringComparison.Ordinal))
            throw new InvalidDataException("Only published generation directories can be verified or restored.");
        var manifestPath = Inside(generation, "manifest.json");
        var marker = Read<BackupPublished>(Inside(generation, "published.json"));
        if (marker.Format != 1 || marker.ManifestSha256 != HashFile(manifestPath)) throw new InvalidDataException("Backup manifest checksum differs.");
        var manifest = Read<BackupManifest>(manifestPath);
        if (manifest.Format != 1 || !Guid.TryParseExact(manifest.WorkspaceId, "N", out var id) || id == Guid.Empty)
            throw new InvalidDataException("Unsupported backup schema or workspace identity.");
        ValidateManifestPaths(manifest.Content);
        var content = Inside(generation, "content");
        var inventory = Inventory(content, excludeRuntime: false, CancellationToken.None);
        if (!Same(manifest.Content, inventory))
            throw new InvalidDataException("Backup content is missing, changed, or contains unlisted paths.");
        if (ValidateContent(content, inventory).WorkspaceId != manifest.WorkspaceId) throw new InvalidDataException("Backup database belongs to another workspace.");
        return manifest;
    }

    private static void ValidateManifestPaths(BackupInventory inventory)
    {
        var paths = inventory.Files.Select(f => f.Path).Concat(inventory.Directories).ToArray();
        if (paths.Distinct(StringComparer.OrdinalIgnoreCase).Count() != paths.Length
            || inventory.Files.Count(f => f.Path == Database) != 1) throw new InvalidDataException("Duplicate backup paths or missing database.");
        foreach (var path in paths)
        {
            ValidateRelative(path);
            if (Excluded(path) && path != Database) throw new InvalidDataException("Backup contains an excluded runtime path: " + path);
        }
        if (inventory.Files.Any(f => f.Length < 0 || f.Sha256.Length != 64 || f.Sha256.Any(c => !Uri.IsHexDigit(c))))
            throw new InvalidDataException("Invalid backup file checksum.");
    }

    private static BackupInventory Inventory(string directory, bool excludeRuntime, CancellationToken token)
    {
        WorkspaceFilePaths.EnsureNoReparse(directory);
        if (!Directory.Exists(directory)) throw new DirectoryNotFoundException(directory);
        var files = new List<BackupEntry>(); var directories = new List<string>();
        void Visit(string current)
        {
            token.ThrowIfCancellationRequested();
            WorkspaceFilePaths.EnsureNoReparse(current);
            foreach (var item in Directory.EnumerateFileSystemEntries(current))
            {
                token.ThrowIfCancellationRequested();
                var relative = Path.GetRelativePath(directory, item).Replace('\\', '/');
                ValidateRelative(relative);
                // Reparse points are rejected even at excluded directory roots.
                WorkspaceFilePaths.EnsureNoReparse(item);
                if (excludeRuntime && Excluded(relative)) continue;
                if (Directory.Exists(item)) { directories.Add(relative); Visit(item); }
                else { using var stream = OpenRead(item); files.Add(new(relative, stream.Length, Convert.ToHexStringLower(SHA256.HashData(stream)))); }
            }
        }
        Visit(directory);
        return new(files.OrderBy(f => f.Path, StringComparer.Ordinal).ToArray(), directories.Order(StringComparer.Ordinal).ToArray());
    }

    private static bool Excluded(string path)
    {
        var parts = path.Split('/');
        return parts.Any(p => p.Equals(".git", StringComparison.OrdinalIgnoreCase) || p.Equals("artifacts", StringComparison.OrdinalIgnoreCase))
            || path.Equals(".grasp.lock", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith(".grasp/", StringComparison.OrdinalIgnoreCase) && parts[^1].EndsWith(".lock", StringComparison.OrdinalIgnoreCase)
            || path.Equals(Database, StringComparison.OrdinalIgnoreCase)
            || path.Equals(Database + "-wal", StringComparison.OrdinalIgnoreCase) || path.Equals(Database + "-shm", StringComparison.OrdinalIgnoreCase)
            || path.Equals(Database + "-journal", StringComparison.OrdinalIgnoreCase)
            || path.Equals(".grasp/backups", StringComparison.OrdinalIgnoreCase) || path.StartsWith(".grasp/backups/", StringComparison.OrdinalIgnoreCase);
    }

    private static void BackupDatabase(string source, string destination)
    {
        using var from = OpenDatabase(source, SqliteOpenMode.ReadOnly);
        using (var to = OpenDatabase(destination, SqliteOpenMode.ReadWriteCreate))
        {
            from.BackupDatabase(to);
            using var command = to.CreateCommand(); command.CommandText = "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;"; command.ExecuteNonQuery();
        }
        using var flush = new FileStream(destination, FileMode.Open, FileAccess.ReadWrite, FileShare.Read); flush.Flush(true);
    }

    private sealed record CheckedState(string WorkspaceId, BackupProblem[] Problems);
    private static CheckedState ValidateContent(string content, BackupInventory inventory)
    {
        using var db = OpenDatabase(Inside(content, Database), SqliteOpenMode.ReadOnly);
        using (var check = db.CreateCommand())
        {
            check.CommandText = "PRAGMA quick_check";
            if (!string.Equals(check.ExecuteScalar() as string, "ok", StringComparison.Ordinal)) throw new InvalidDataException("Backup SQLite integrity check failed.");
        }
        string Meta(string key)
        { using var command = db.CreateCommand(); command.CommandText = "SELECT value FROM meta WHERE key=$key"; command.Parameters.AddWithValue("$key", key); return command.ExecuteScalar() as string ?? throw new InvalidDataException("Missing database metadata: " + key); }
        if (Meta("schema") != "2") throw new InvalidDataException("Only Markdown schema 2 can be checkpointed.");
        var workspaceId = Meta("workspaceId");
        _ = long.Parse(Meta("revision")); _ = long.Parse(Meta("policyRevision"));
        _ = JsonSerializer.Deserialize<string[]>(Meta("languages")) ?? throw new InvalidDataException("Missing parsing policy.");
        T[] Rows<T>(string table)
        {
            using var command = db.CreateCommand(); command.CommandText = "SELECT body FROM " + table;
            using var reader = command.ExecuteReader(); var rows = new List<T>();
            while (reader.Read()) rows.Add(JsonSerializer.Deserialize<T>(reader.GetString(0)) ?? throw new InvalidDataException("Invalid database row."));
            return rows.ToArray();
        }
        var notes = Rows<Note>("notes").ToDictionary(n => n.Id, StringComparer.Ordinal);
        var sources = Rows<MarkdownFileState>("source_files");
        var definitions = Rows<KnowledgeDefinition>("definitions");
        var receipts = Rows<Receipt>("receipts").ToDictionary(r => r.OperationId, StringComparer.Ordinal);
        var drafts = Rows<Draft>("drafts");
        if (sources.Select(s => s.RelativePath).Distinct(StringComparer.OrdinalIgnoreCase).Count() != sources.Length
            || sources.Select(s => s.NoteId).Distinct(StringComparer.Ordinal).Count() != sources.Length
            || sources.Select(s => s.DocumentId).Distinct(StringComparer.Ordinal).Count() != sources.Length
            || notes.Keys.Except(sources.Select(s => s.NoteId), StringComparer.Ordinal).Any()
            || drafts.Any(d => !notes.ContainsKey(d.NoteId)) || definitions.Any(d => !notes.ContainsKey(d.NoteId)))
            throw new InvalidDataException("Snapshot contains ambiguous source identities or orphaned notes/drafts/definitions.");
        var problems = new List<BackupProblem>();
        foreach (var source in sources)
        {
            ValidateRelative(source.RelativePath);
            if (Excluded(source.RelativePath) || source.RelativePath.StartsWith(".grasp/", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Source registry uses reserved path.");
            var physical = Inside(content, source.RelativePath);
            if (!source.Exists)
            {
                if (File.Exists(physical) || Directory.Exists(physical) || notes.TryGetValue(source.NoteId, out var missing) && missing.SavedSource?.Status != "missing")
                    throw new InvalidDataException("Missing source registry does not match physical/saved source state.");
                problems.Add(new("source-missing", source.RelativePath, "Deleted source is retained in the database with its draft; reconcile after restore."));
                continue;
            }
            if (!notes.TryGetValue(source.NoteId, out var note)) throw new InvalidDataException("Registered source has no note.");
            var bytes = File.ReadAllBytes(physical);
            if (Convert.ToHexStringLower(SHA256.HashData(bytes)) != source.ByteHash || !Encode(source).AsSpan().SequenceEqual(bytes))
                throw new InvalidDataException("External file differs from the observed source registry: " + source.RelativePath);
            var envelope = MarkdownEnvelopeCodec.Read(source.Text);
            if (!envelope.CanRewrite || envelope.Body != note.CurrentSource
                || source.IsManaged && (envelope.Metadata is not { Notes.Count: 1 } metadata || metadata.DocumentId != source.DocumentId || metadata.Notes[0].Id != source.NoteId))
                throw new InvalidDataException("Markdown and the semantic saved-source base do not match: " + source.RelativePath);
            if (note.IsSourceStale) problems.Add(new("source-stale", source.RelativePath, "Saved raw text and last accepted semantics are preserved separately; reconcile after restore."));
        }
        var registered = sources.Where(s => s.Exists).Select(s => s.RelativePath).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var file in inventory.Files)
        {
            if (Path.GetFileName(file.Path) == ".grasp-folder-origin")
                throw new InvalidDataException("Directory action has not removed its pending creation marker.");
            if (file.Path.EndsWith(".md", StringComparison.OrdinalIgnoreCase)
                && !file.Path.Split('/').Any(p => p.Equals(".grasp", StringComparison.OrdinalIgnoreCase) || p.Equals(".obsidian", StringComparison.OrdinalIgnoreCase))
                && !registered.Contains(file.Path)) throw new InvalidDataException("Unobserved Markdown requires reconciliation before backup: " + file.Path);
        }
        ValidateJournals(content, workspaceId, receipts);
        return new(workspaceId, problems.ToArray());
    }

    private static void ValidateJournals(string content, string workspaceId, IReadOnlyDictionary<string, Receipt> receipts)
    {
        IEnumerable<string> JsonFiles(string relative)
        {
            var directory = Inside(content, relative);
            return Directory.Exists(directory) ? Directory.EnumerateFiles(directory, "*.json", SearchOption.TopDirectoryOnly) : [];
        }
        var operationRoot = Inside(content, ".grasp/operations");
        if (Directory.Exists(operationRoot)) foreach (var operation in Directory.EnumerateDirectories(operationRoot))
        {
            var manifest = Read<FileOperationManifest>(Inside(operation, "manifest.json"));
            if (manifest.FormatVersion != 1 || manifest.OperationId.ToString("N") != Path.GetFileName(operation)
                || manifest.Files.Count == 0) throw new InvalidDataException("Invalid recovery operation manifest.");
            foreach (var file in manifest.Files)
            {
                ValidateRelative(file.RelativePath);
                if (file.RelativePath.Split('/')[0].Equals(".grasp", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("File journal targets reserved recovery data.");
            }
            if (manifest.Files.Select(f => f.RelativePath).Distinct(StringComparer.OrdinalIgnoreCase).Count() != manifest.Files.Count)
                throw new InvalidDataException("File journal contains duplicate paths.");
            var payload = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(manifest.Files
                .Select(f => new { f.RelativePath, f.ExpectedSha256, f.DesiredSha256 }).OrderBy(f => f.RelativePath, StringComparer.Ordinal))));
            var written = Read<CompletionMarker>(Inside(operation, "files-written.json"));
            var finalized = Read<CompletionMarker>(Inside(operation, "semantic-finalized.json"));
            if (payload != manifest.PayloadSha256 || written.PayloadSha256 != payload || finalized.PayloadSha256 != payload || string.IsNullOrWhiteSpace(finalized.Receipt))
                throw new InvalidDataException("Recovery operation is pending or its markers are inconsistent.");
            foreach (var hash in manifest.Files.SelectMany(f => new[] { f.BeforeSha256, f.DesiredSha256 }).Where(h => h is not null).Distinct())
                if (HashFile(Inside(operation, "blobs/" + hash + ".bin")) != hash) throw new InvalidDataException("Recovery blob hash differs.");
        }
        foreach (var file in JsonFiles(".grasp/semantic-operations"))
        {
            using var document = JsonDocument.Parse(File.ReadAllBytes(file)); var intent = document.RootElement;
            var wanted = intent.GetProperty("Receipt").Deserialize<Receipt>() ?? throw new InvalidDataException("Invalid intent receipt.");
            if (intent.GetProperty("FormatVersion").GetInt32() != 1 || intent.GetProperty("Next").GetProperty("WorkspaceId").GetString() != workspaceId
                || intent.GetProperty("Next").GetProperty("Revision").GetInt64() != wanted.Revision
                || intent.GetProperty("PreviousRevision").GetInt64() >= wanted.Revision
                || !receipts.TryGetValue(wanted.OperationId, out var actual) || actual.Fingerprint != wanted.Fingerprint || actual.Revision != wanted.Revision)
                throw new InvalidDataException("Semantic intent is pending or its durable receipt differs.");
            var operation = intent.GetProperty("FileOperationId").GetGuid();
            var expectedOperation = Guid.TryParse(wanted.OperationId, out var parsedId) && parsedId != Guid.Empty
                ? parsedId : new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(wanted.OperationId)).AsSpan(0, 16));
            if (operation != expectedOperation) throw new InvalidDataException("Semantic intent operation identity differs from its receipt.");
            _ = Read<CompletionMarker>(Inside(content, $".grasp/operations/{operation:N}/semantic-finalized.json"));
        }
        foreach (var file in JsonFiles(".grasp/file-actions/intents"))
        {
            using var document = JsonDocument.Parse(File.ReadAllBytes(file)); var intent = document.RootElement;
            var id = intent.GetProperty("OperationId").GetString() ?? "";
            if (!Guid.TryParseExact(id, "N", out _) || intent.GetProperty("Format").GetInt32() != 1
                || intent.GetProperty("Plan").GetProperty("WorkspaceId").GetString() != workspaceId)
                throw new InvalidDataException("Invalid file action intent.");
            using var receipt = JsonDocument.Parse(File.ReadAllBytes(Inside(content, ".grasp/file-actions/receipts/" + id + ".json")));
            if (receipt.RootElement.GetProperty("OperationId").GetString() != id || receipt.RootElement.GetProperty("Format").GetInt32() != 1
                || receipt.RootElement.GetProperty("Result").GetProperty("OperationId").GetString() != id
                || receipt.RootElement.GetProperty("PreviewId").GetString() != intent.GetProperty("Plan").GetProperty("PreviewId").GetString())
                throw new InvalidDataException("File action intent has no matching durable receipt.");
            if (receipt.RootElement.GetProperty("PayloadHash").GetString() is { } payloadHash
                && Read<CompletionMarker>(Inside(content, $".grasp/operations/{id}/semantic-finalized.json")).PayloadSha256 != payloadHash)
                throw new InvalidDataException("File action receipt does not match finalized file writes.");
        }
        var migration = Inside(content, ".grasp/migration/intent.json");
        if (File.Exists(migration) && !File.Exists(Inside(content, ".grasp/migration/completed.json")))
            throw new InvalidDataException("Workspace migration is incomplete.");
    }

    private static byte[] Encode(MarkdownFileState source)
    {
        Encoding encoding = source.EncodingName switch
        {
            "utf-8" => new UTF8Encoding(source.HasBom, true),
            "utf-16LE" when source.HasBom => new UnicodeEncoding(false, true, true),
            "utf-16BE" when source.HasBom => new UnicodeEncoding(true, true, true),
            _ => throw new InvalidDataException("Unsupported source encoding.")
        };
        return [.. encoding.GetPreamble(), .. encoding.GetBytes(source.Text)];
    }
    private static SqliteConnection OpenDatabase(string path, SqliteOpenMode mode)
    {
        WorkspaceFilePaths.EnsureNoReparse(path);
        // SQLite's Windows VFS needs an extended absolute path once a generation
        // under a long workspace path exceeds the traditional MAX_PATH boundary.
        var databasePath = OperatingSystem.IsWindows() && !path.StartsWith(@"\\?\", StringComparison.Ordinal)
            ? path.StartsWith(@"\\", StringComparison.Ordinal) ? @"\\?\UNC\" + path[2..] : @"\\?\" + path
            : path;
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = mode, Pooling = false }.ToString());
        try { connection.Open(); return connection; } catch { connection.Dispose(); throw; }
    }
    private static bool Same(BackupInventory a, BackupInventory b) => a.Files.SequenceEqual(b.Files) && a.Directories.SequenceEqual(b.Directories);
    private static bool Expected(Exception error) => error is IOException or InvalidDataException or UnauthorizedAccessException or SqliteException or JsonException or ArgumentException or InvalidOperationException or FormatException or KeyNotFoundException;
    private static string Inside(string parent, string relative)
    {
        ValidateRelative(relative);
        var full = Path.GetFullPath(Path.Combine(parent, relative.Replace('/', Path.DirectorySeparatorChar)));
        var prefix = Path.TrimEndingDirectorySeparator(Path.GetFullPath(parent)) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("Path escapes backup boundary.");
        WorkspaceFilePaths.EnsureNoReparse(full); return full;
    }
    private static void ValidateRelative(string relative)
    {
        if (string.IsNullOrEmpty(relative) || Path.IsPathRooted(relative) || relative.Contains('\\')) throw new InvalidDataException("Backup path must be canonical and relative.");
        foreach (var part in relative.Split('/'))
        {
            if (part.Length == 0 || part is "." or ".." || part.EndsWith('.') || part.EndsWith(' ') || part.Any(c => c < 32 || "<>:\"|?*".Contains(c)))
                throw new InvalidDataException("Unsafe backup path.");
            var stem = part.Split('.')[0].ToUpperInvariant();
            if (stem is "CON" or "PRN" or "AUX" or "NUL" || stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) && stem[3] is >= '1' and <= '9')
                throw new InvalidDataException("Reserved backup path.");
        }
    }
    private static FileStream OpenRead(string path)
    { WorkspaceFilePaths.EnsureNoReparse(path); return new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete); }
    private static string HashFile(string path)
    { using var stream = OpenRead(path); return Convert.ToHexStringLower(SHA256.HashData(stream)); }
    private static void Copy(string from, string to)
    {
        using var input = OpenRead(from);
        using var output = new FileStream(to, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        input.CopyTo(output); output.Flush(true);
    }
    private static T Read<T>(string path)
    { using var stream = OpenRead(path); return JsonSerializer.Deserialize<T>(stream) ?? throw new InvalidDataException("Empty backup/recovery record."); }
    private static void Write(string path, byte[] bytes)
    { using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None); stream.Write(bytes); stream.Flush(true); }
}
