using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace.FileOperations;
using GraspPortable.Host.Workspace.Markdown;
using Microsoft.Data.Sqlite;

namespace GraspPortable.Host.Workspace;

public sealed record LegacyMigrationResult(string Path, int NoteCount, int DraftCount);

/// <summary>
/// Conservative schema-1 copy migration. Never opens the source database for writing.
/// A cooperative workspace lock and before/after hashes detect ordinary concurrent
/// changes; they are not protection against hostile filesystem namespace races.
/// A failed target is retained for inspection, never silently resumed or replaced.
/// </summary>
public static class LegacyWorkspaceMigration
{
    private const string Database = "workspace.grasp.db";
    private const string IntentPath = ".grasp/migration/intent.json";
    private const string CompletedPath = ".grasp/migration/completed.json";
    private sealed record FileHash(string Path, string Hash);
    private sealed record Inventory(FileHash[] Files, string[] Directories);
    private sealed record State(Snapshot Snapshot, Draft[] Drafts);
    private sealed record Intent(int Format, string SourcePath, string SourceFingerprint, string OperationId, int NoteCount, int DraftCount);
    private sealed record Completion(int Format, string OperationId, string ContentFingerprint, Inventory Files);

    /// <summary>Read-only schema detection. A busy legacy workspace is reported as an error.</summary>
    public static bool IsLegacy(string path)
    {
        var root = ExistingRoot(path);
        if (!File.Exists(System.IO.Path.Combine(root, Database))) return false;
        using var held = Lock(root);
        return ReadDatabase(root, db => Schema(db)) == "1";
    }

    public static LegacyMigrationResult MigrateToNewFolder(string sourcePath)
    {
        var source = ExistingRoot(sourcePath);
        using var held = Lock(source);
        var state = ReadDatabase(source, db => ReadState(db, "1"));
        var files = InventoryOf(source);
        var fingerprint = SourceFingerprint(source, state, files);
        var parent = Directory.GetParent(source)?.FullName ?? throw new IOException("A filesystem root cannot be migrated.");
        var prefix = System.IO.Path.GetFileName(source) + "-Markdown";

        // Only this migration's siblings are inspected; unrelated directories are untouched.
        foreach (var sibling in Directory.EnumerateDirectories(parent).Where(p =>
                     System.IO.Path.GetFileName(p).Equals(prefix, StringComparison.OrdinalIgnoreCase)
                     || System.IO.Path.GetFileName(p).StartsWith(prefix + "-", StringComparison.OrdinalIgnoreCase)))
        {
            WorkspaceFilePaths.EnsureNoReparse(sibling);
            var intentFile = System.IO.Path.Combine(sibling, IntentPath);
            WorkspaceFilePaths.EnsureNoReparse(intentFile);
            if (!File.Exists(intentFile)) continue;
            var prior = ReadJson<Intent>(intentFile);
            if (!string.Equals(prior.SourcePath, source, StringComparison.OrdinalIgnoreCase)) continue;
            if (prior.Format != 1 || prior.SourceFingerprint != fingerprint)
                throw new IOException($"An earlier migration exists, but its source snapshot differs. Review {sibling}; no new copy was created.");
            var completedFile = System.IO.Path.Combine(sibling, CompletedPath);
            WorkspaceFilePaths.EnsureNoReparse(completedFile);
            if (!File.Exists(completedFile))
                throw new IOException($"An incomplete migration is retained at {sibling}. Review it before retrying; the source is unchanged.");
            using var destinationLock = Lock(sibling);
            VerifyCompletion(sibling, prior, ReadJson<Completion>(completedFile));
            return new(sibling, prior.NoteCount, prior.DraftCount);
        }

        // The source lock serializes migrations from this workspace.
        var target = System.IO.Path.Combine(parent, prefix);
        for (var suffix = 2; Directory.Exists(target) || File.Exists(target); suffix++)
            target = System.IO.Path.Combine(parent, prefix + "-" + suffix);
        WorkspaceFilePaths.EnsureNoReparse(target);
        Directory.CreateDirectory(target);
        var intent = new Intent(1, source, fingerprint, Guid.NewGuid().ToString("N"), state.Snapshot.Notes.Count, state.Drafts.Length);
        Directory.CreateDirectory(System.IO.Path.Combine(target, ".grasp/migration"));
        WriteDurable(System.IO.Path.Combine(target, IntentPath), intent);
        try
        {
            Validate(state);
            foreach (var file in files.Files.Where(f => f.Path.EndsWith(".md", StringComparison.OrdinalIgnoreCase)))
            {
                var envelope = MarkdownEnvelopeCodec.Read(File.ReadAllText(System.IO.Path.Combine(source, file.Path), new UTF8Encoding(false, true)));
                if (!envelope.CanRewrite || envelope.Metadata is not null)
                    throw new IOException("Existing Markdown has managed identities or unsafe YAML requiring explicit collision review: " + file.Path);
            }
            var paths = new WorkspaceFilePaths(target);
            foreach (var directory in files.Directories) paths.EnsureDirectory(paths.NormalizeUserPath(directory));
            foreach (var file in files.Files)
            {
                var relative = paths.NormalizeUserPath(file.Path);
                var from = System.IO.Path.Combine(source, relative);
                WorkspaceFilePaths.EnsureNoReparse(from);
                using var input = new FileStream(from, FileMode.Open, FileAccess.Read, FileShare.Read);
                using var output = new FileStream(paths.Resolve(relative), FileMode.CreateNew, FileAccess.Write, FileShare.None);
                input.CopyTo(output); output.Flush(true);
            }
            using (var repository = new MarkdownWorkspaceRepository(target))
            {
                var empty = repository.Load();
                var next = state.Snapshot with { WorkspaceId = empty.WorkspaceId, Revision = Math.Max(1, state.Snapshot.Revision) };
                var receipt = new Receipt(intent.OperationId, fingerprint, "migrated", next.Revision);
                repository.Commit(empty, next, receipt, null);
                foreach (var draft in state.Drafts)
                {
                    var note = next.Notes[draft.NoteId];
                    // Preserve stale bases. Only a matching legacy revision can acquire a missing hash.
                    repository.SaveDraft(draft.BaseSourceHash is null && draft.BaseNoteRevision == note.Revision
                        ? draft with { BaseSourceHash = note.CurrentSourceHash } : draft);
                }
                if (repository.IsWriteBlocked) throw new IOException("Migration file journal did not finalize.");
                var actual = new State(repository.Load(), repository.LoadDrafts().OrderBy(d => d.NoteId, StringComparer.Ordinal).ToArray());
                var expectedDrafts = state.Drafts.Select(d => d.BaseSourceHash is null && d.BaseNoteRevision == next.Notes[d.NoteId].Revision
                    ? d with { BaseSourceHash = next.Notes[d.NoteId].CurrentSourceHash } : d).ToArray();
                if (ContentFingerprint(actual) != ContentFingerprint(new(next, expectedDrafts)))
                    throw new IOException("Migrated database identity, source, policy or drafts did not round-trip.");
                var managed = repository.LoadSourceFiles();
                if (managed.Count != next.Notes.Count) throw new IOException("Migrated Markdown count differs from legacy notes.");
                foreach (var file in managed)
                {
                    var note = next.Notes[file.NoteId];
                    var envelope = MarkdownEnvelopeCodec.Read(File.ReadAllText(paths.Resolve(file.RelativePath), new UTF8Encoding(false, true)));
                    var metadata = envelope.Metadata;
                    if (!envelope.CanRewrite || envelope.Body != note.CurrentSource || metadata is null || metadata.Notes.Count != 1
                        || metadata.Notes[0].Id != note.Id || metadata.Notes[0].Title != note.Title
                        || !metadata.Notes[0].Bindings.OrderBy(p => p.Key, StringComparer.Ordinal).SequenceEqual(
                            next.Definitions.Values.Where(d => d.NoteId == note.Id).ToDictionary(d => d.Name, d => d.Id).OrderBy(p => p.Key, StringComparer.Ordinal)))
                        throw new IOException("Migrated Markdown identity or body did not round-trip: " + file.RelativePath);
                }
            }
            // Reopen read-only from a shadow copy, verifying bytes after all durable writers close.
            using var verificationLock = Lock(target);
            var completedState = ReadDatabase(target, db => ReadState(db, "2"));
            var targetFiles = InventoryOf(target);
            foreach (var file in files.Files)
                if (!targetFiles.Files.Contains(file)) throw new IOException("Copied attachment differs: " + file.Path);
            if (!files.Directories.All(targetFiles.Directories.Contains)) throw new IOException("A user directory was not retained.");
            if (SourceFingerprint(source, ReadDatabase(source, db => ReadState(db, "1")), InventoryOf(source)) != fingerprint)
                throw new IOException("The source changed during migration; target retained for review.");
            var completion = new Completion(1, intent.OperationId, ContentFingerprint(completedState), targetFiles);
            WriteDurable(System.IO.Path.Combine(target, CompletedPath), completion);
            return new(target, intent.NoteCount, intent.DraftCount);
        }
        catch (Exception exception)
        {
            try { WriteDurable(System.IO.Path.Combine(target, ".grasp/migration/failed.json"), new { Message = exception.Message }); }
            catch (IOException) { /* The immutable intent still marks this target incomplete. */ }
            throw new IOException($"Migration did not complete. Original workspace is preserved; inspect {target}. {exception.Message}", exception);
        }
    }

    private static void VerifyCompletion(string root, Intent intent, Completion completion)
    {
        if (completion.Format != 1 || completion.OperationId != intent.OperationId
            || ContentFingerprint(ReadDatabase(root, db => ReadState(db, "2"))) != completion.ContentFingerprint
            || JsonSerializer.Serialize(InventoryOf(root)) != JsonSerializer.Serialize(completion.Files))
            throw new IOException($"Previously migrated workspace has changed or failed verification: {root}. Open that workspace explicitly; migration will not overwrite it or create another copy.");
    }

    private static void Validate(State state)
    {
        var snapshot = state.Snapshot;
        static bool Canonical(string id) => Guid.TryParseExact(id, "N", out var value) && value != Guid.Empty;
        if (snapshot.Revision < 0 || snapshot.PolicyRevision < 0 || snapshot.Languages is null
            || snapshot.Notes.Values.Any(n => !Canonical(n.Id) || n.Revision < 0 || n.Revision > snapshot.Revision)
            || snapshot.Definitions.Values.Any(d => !Canonical(d.Id) || !snapshot.Notes.ContainsKey(d.NoteId))
            || state.Drafts.Any(d => !snapshot.Notes.ContainsKey(d.NoteId))
            || state.Drafts.Select(d => d.NoteId).Distinct(StringComparer.Ordinal).Count() != state.Drafts.Length)
            throw new IOException("Legacy identities, revisions or draft ownership are invalid; migration requires review.");
        foreach (var note in snapshot.Notes.Values)
        {
            var envelope = MarkdownEnvelopeCodec.Read(note.CurrentSource);
            if (!envelope.CanRewrite || envelope.Body != note.CurrentSource)
                throw new IOException($"Note {note.Id} has frontmatter/BOM or invalid managed YAML that cannot preserve source ranges in this migration. Original text is retained.");
        }
    }

    private static string ExistingRoot(string path)
    {
        var root = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(path));
        WorkspaceFilePaths.EnsureNoReparse(root);
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException(root);
        return root;
    }

    private static FileStream Lock(string root)
    {
        var path = System.IO.Path.Combine(root, ".grasp.lock");
        WorkspaceFilePaths.EnsureNoReparse(path);
        // Existing legacy repositories always have this file. Missing locks are
        // rejected rather than modifying the source directory to manufacture one.
        try { return new(path, FileMode.Open, FileAccess.Read, FileShare.None); }
        catch (IOException exception) { throw new IOException($"Workspace is busy or its lock file is missing: {root}", exception); }
    }

    private static Inventory InventoryOf(string root)
    {
        var files = new List<FileHash>(); var directories = new List<string>();
        void Visit(string directory)
        {
            WorkspaceFilePaths.EnsureNoReparse(directory);
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
            {
                WorkspaceFilePaths.EnsureNoReparse(entry);
                var relative = System.IO.Path.GetRelativePath(root, entry).Replace('\\', '/');
                if (relative.Equals(".grasp", StringComparison.OrdinalIgnoreCase) || relative.Equals(".grasp.lock", StringComparison.OrdinalIgnoreCase)
                    || relative.Equals(Database, StringComparison.OrdinalIgnoreCase) || relative.Equals(Database + "-wal", StringComparison.OrdinalIgnoreCase)
                    || relative.Equals(Database + "-shm", StringComparison.OrdinalIgnoreCase) || relative.Equals(Database + "-journal", StringComparison.OrdinalIgnoreCase)) continue;
                if (Directory.Exists(entry)) { directories.Add(relative); Visit(entry); }
                else files.Add(new(relative, HashFile(entry)));
            }
        }
        Visit(root);
        return new(files.OrderBy(f => f.Path, StringComparer.Ordinal).ToArray(), directories.Order(StringComparer.Ordinal).ToArray());
    }

    private static string SourceFingerprint(string root, State state, Inventory inventory) => Hash(JsonSerializer.Serialize(new
    {
        Content = ContentFingerprint(state), Files = inventory,
        DatabaseHash = HashFile(System.IO.Path.Combine(root, Database)),
        WalHash = File.Exists(System.IO.Path.Combine(root, Database + "-wal")) ? HashFile(System.IO.Path.Combine(root, Database + "-wal")) : null
    }));

    private static string ContentFingerprint(State state) => Hash(JsonSerializer.Serialize(new
    {
        state.Snapshot.WorkspaceId, state.Snapshot.Revision, state.Snapshot.PolicyRevision, state.Snapshot.Languages,
        Notes = state.Snapshot.Notes.Values.OrderBy(n => n.Id, StringComparer.Ordinal),
        Definitions = state.Snapshot.Definitions.Values.OrderBy(d => d.Id, StringComparer.Ordinal),
        Drafts = state.Drafts.OrderBy(d => d.NoteId, StringComparer.Ordinal)
    }));
    private static string Hash(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    private static string HashFile(string path)
    { WorkspaceFilePaths.EnsureNoReparse(path); using var stream = File.OpenRead(path); return Convert.ToHexStringLower(SHA256.HashData(stream)); }

    private static T ReadDatabase<T>(string root, Func<SqliteConnection, T> read)
    {
        // Read-only SQLite may rebuild a WAL shared-memory file. Use a disposable
        // shadow, so even its housekeeping cannot change the original workspace.
        var temporaryParent = System.IO.Path.GetFullPath(System.IO.Path.GetTempPath());
        var temporary = System.IO.Path.Combine(temporaryParent, "grasp-migration-" + Guid.NewGuid().ToString("N"));
        WorkspaceFilePaths.EnsureNoReparse(temporary);
        Directory.CreateDirectory(temporary);
        try
        {
            foreach (var name in new[] { Database, Database + "-wal" })
            {
                var path = System.IO.Path.Combine(root, name); WorkspaceFilePaths.EnsureNoReparse(path);
                if (name == Database || File.Exists(path)) File.Copy(path, System.IO.Path.Combine(temporary, name), false);
            }
            var journal = System.IO.Path.Combine(root, Database + "-journal");
            WorkspaceFilePaths.EnsureNoReparse(journal);
            if (File.Exists(journal) && new FileInfo(journal).Length > 0) throw new IOException("Legacy rollback journal requires recovery before safe migration.");
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder
            { DataSource = System.IO.Path.Combine(temporary, Database), Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
            db.Open(); return read(db);
        }
        finally
        {
            if (!System.IO.Path.GetFullPath(temporary).StartsWith(System.IO.Path.TrimEndingDirectorySeparator(temporaryParent) + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new IOException("Temporary migration path escaped its parent.");
            Directory.Delete(temporary, recursive: true);
        }
    }
    private static string? Schema(SqliteConnection db)
    {
        using var command = db.CreateCommand(); command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='meta'";
        if ((long)command.ExecuteScalar()! != 1) return null;
        return Meta(db, "schema");
    }
    private static string Meta(SqliteConnection db, string key)
    {
        using var command = db.CreateCommand(); command.CommandText = "SELECT value FROM meta WHERE key=$key"; command.Parameters.AddWithValue("$key", key);
        return command.ExecuteScalar() as string ?? throw new IOException("Missing legacy metadata: " + key);
    }
    private static State ReadState(SqliteConnection db, string schema)
    {
        if (Schema(db) != schema) throw new IOException("Unsupported workspace schema; source was not modified.");
        T[] Rows<T>(string table)
        {
            using var command = db.CreateCommand(); command.CommandText = "SELECT body FROM " + table;
            using var reader = command.ExecuteReader(); var result = new List<T>();
            while (reader.Read()) result.Add(JsonSerializer.Deserialize<T>(reader.GetString(0)) ?? throw new IOException("Invalid legacy row."));
            return result.ToArray();
        }
        return new(new(Meta(db, "workspaceId"), long.Parse(Meta(db, "revision")), long.Parse(Meta(db, "policyRevision")),
            JsonSerializer.Deserialize<string[]>(Meta(db, "languages"))!, Rows<Note>("notes").ToDictionary(n => n.Id),
            Rows<KnowledgeDefinition>("definitions").ToDictionary(d => d.Id)), Rows<Draft>("drafts"));
    }
    private static T ReadJson<T>(string path) => JsonSerializer.Deserialize<T>(File.ReadAllText(path)) ?? throw new IOException("Invalid migration marker: " + path);
    private static void WriteDurable<T>(string path, T value)
    {
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        JsonSerializer.Serialize(stream, value); stream.Flush(true);
    }
}
