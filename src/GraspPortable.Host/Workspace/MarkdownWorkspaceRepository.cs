using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.ValueEngine;
using GraspPortable.Host.Workspace.FileOperations;
using GraspPortable.Host.Workspace.Markdown;

namespace GraspPortable.Host.Workspace;

/// <summary>
/// Markdown source authority with a SQLite semantic/draft index. The durable
/// semantic intent precedes file operations; the SQLite receipt precedes the
/// file journal's finalization marker. These are restartable steps, not ACID
/// across arbitrary external editors and multiple files.
/// </summary>
public sealed class MarkdownWorkspaceRepository : IWorkspaceRepository
{
    private const string IntentDirectory = ".grasp/semantic-operations";
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };
    private readonly SqliteWorkspaceRepository database;
    private readonly WorkspaceFilePaths paths;
    private readonly RecoverableFileOperations files;
    private readonly object gate = new();
    private readonly ConcurrentDictionary<string, MarkdownFileState[]> observations = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, string> creationLocations = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (string DocumentId, string NoteId)> provisional = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<MarkdownScanIssue> recoveryIssues = [];
    private readonly HashSet<string> protectedNoteIds = new(StringComparer.Ordinal);
    private bool blocked;
    public bool UsesSavedSourceAuthority => true;
    private sealed record SemanticIntent(int FormatVersion, Guid FileOperationId, long PreviousRevision,
        Snapshot Next, Receipt Receipt, string? ConsumedDraftNoteId, MarkdownFileState[] Sources, FileMutation[] Mutations);
    private sealed record Candidate(MarkdownFileState File, MarkdownEnvelope Envelope, string Title);
    public bool IsWriteBlocked { get { lock (gate) return blocked; } }
    public IReadOnlyList<MarkdownScanIssue> PendingRecoveryIssues { get { lock (gate) return recoveryIssues.ToArray(); } }
    public Action? AfterFilesWrittenForTest { get; set; }
    public Action? AfterDatabaseCommitForTest { get; set; }
    public Action<FileOperationCheckpoint>? FileCheckpointForTest { get => files.CheckpointForTest; set => files.CheckpointForTest = value; }

    public MarkdownWorkspaceRepository(string path)
    {
        paths = new(path);
        database = new(path, markdownSources: true);
        files = new(path);
        try { RecoverPending(); }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or JsonException or ArgumentException)
        {
            blocked = true;
            recoveryIssues.Add(new(IntentDirectory, "recovery-blocked", exception.Message));
        }
    }
    public Snapshot Load() => database.Load();
    public IReadOnlyList<Draft> LoadDrafts() => database.LoadDrafts();
    public void SaveDraft(Draft draft) => database.SaveDraft(draft);
    public Receipt? FindReceipt(string operationId) => database.FindReceipt(operationId);
    public IReadOnlyList<MarkdownFileState> LoadSourceFiles() => database.LoadSourceFiles();

    /// <summary>Only this operation may consume these captured observations.</summary>
    public IDisposable BeginObservation(string operationId, IReadOnlyList<MarkdownFileState> states)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operationId);
        var captured = states.ToArray();
        if (captured.Select(s => s.NoteId).Distinct(StringComparer.Ordinal).Count() != captured.Length)
            throw new ArgumentException("An observation contains duplicate note identities.", nameof(states));
        foreach (var state in captured) _ = paths.NormalizeUserPath(state.RelativePath);
        if (!observations.TryAdd(operationId, captured)) throw new InvalidOperationException("The operation already has an observation lease.");
        return new Lease(() => ((ICollection<KeyValuePair<string, MarkdownFileState[]>>)observations).Remove(new(operationId, captured)));
    }

    public IDisposable BeginNewNoteLocation(string operationId, string? parentPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operationId);
        var parent = string.IsNullOrEmpty(parentPath) ? "" : parentPath.Replace('\\', '/').TrimEnd('/');
        if (parent.Length != 0)
        {
            _ = paths.NormalizeUserPath(parent + "/location-probe.md");
            if (File.Exists(paths.Resolve(parent))) throw new ArgumentException("The requested parent is a file.", nameof(parentPath));
        }
        if (!creationLocations.TryAdd(operationId, parent)) throw new InvalidOperationException("The operation already has a creation location.");
        return new Lease(() => ((ICollection<KeyValuePair<string, string>>)creationLocations).Remove(new(operationId, parent)));
    }

    public MarkdownScanBatch Scan(Snapshot current)
    {
        lock (gate)
        {
            var registry = database.LoadSourceFiles();
            var byPath = registry.ToDictionary(s => s.RelativePath, StringComparer.OrdinalIgnoreCase);
            var byId = registry.ToDictionary(s => s.NoteId, StringComparer.Ordinal);
            var issues = new List<MarkdownScanIssue>();
            var candidates = new List<Candidate>();
            var physicalPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var relative in EnumerateMarkdown(issues))
            {
                physicalPaths.Add(relative);
                byPath.TryGetValue(relative, out var registered);
                byte[]? observedBytes = null;
                try
                {
                    var bytes = observedBytes = ReadBytes(relative) ?? throw new IOException("Source disappeared during the scan.");
                    var decoded = Decode(bytes);
                    var envelope = MarkdownEnvelopeCodec.Read(decoded.Text);
                    if (!envelope.CanRewrite)
                    {
                        var preserved = PreserveConflict(bytes);
                        issues.AddRange(envelope.Issues.Select(i => new MarkdownScanIssue(relative, i.Code, i.Message, registered?.NoteId,
                            RecoverableFileOperations.Sha256(bytes), preserved)));
                        continue;
                    }
                    if (envelope.Metadata is { Notes.Count: not 1 })
                    {
                        issues.Add(new(relative, "multiple-members", "This stage opens one note per file; all bytes were preserved.", registered?.NoteId));
                        continue;
                    }
                    var metadata = envelope.Metadata;
                    string documentId, noteId;
                    if (metadata is not null) { documentId = metadata.DocumentId; noteId = metadata.Notes[0].Id; }
                    else if (registered is not null)
                    {
                        if (registered.IsManaged)
                        {
                            var preserved = PreserveConflict(bytes);
                            issues.Add(new(relative, "identity-removed", "Managed identity metadata was removed; source is preserved pending reconciliation.", registered.NoteId,
                                RecoverableFileOperations.Sha256(bytes), preserved));
                            continue;
                        }
                        documentId = registered.DocumentId; noteId = registered.NoteId;
                    }
                    else
                    {
                        if (!provisional.TryGetValue(relative, out var ids)) provisional[relative] = ids = (Guid.NewGuid().ToString("N"), Guid.NewGuid().ToString("N"));
                        (documentId, noteId) = ids;
                    }
                    if (registered is not null && (registered.NoteId != noteId || registered.DocumentId != documentId))
                    {
                        var preserved = PreserveConflict(bytes);
                        issues.Add(new(relative, "identity-changed", "Existing path now carries different canonical identities; no automatic replacement was made.", registered.NoteId,
                            RecoverableFileOperations.Sha256(bytes), preserved));
                        continue;
                    }
                    var file = new MarkdownFileState(documentId, noteId, relative, decoded.Text, RecoverableFileOperations.Sha256(bytes), decoded.EncodingName, decoded.HasBom, metadata is not null);
                    candidates.Add(new(file, envelope, metadata?.Notes[0].Title ?? Path.GetFileNameWithoutExtension(relative)));
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or DecoderFallbackException or ArgumentException)
                {
                    var preserved = observedBytes is null ? null : PreserveConflict(observedBytes);
                    issues.Add(new(relative, "source-read", exception.Message, registered?.NoteId,
                        observedBytes is null ? null : RecoverableFileOperations.Sha256(observedBytes), preserved));
                }
            }
            var duplicatePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            void Duplicates(IEnumerable<IGrouping<string, Candidate>> groups, string kind)
            {
                foreach (var group in groups.Where(g => g.Count() > 1))
                    foreach (var item in group)
                    {
                        duplicatePaths.Add(item.File.RelativePath);
                        issues.Add(new(item.File.RelativePath, "duplicate-identity", $"Duplicate {kind} identity; all files are preserved.", item.File.NoteId,
                            item.File.ByteHash, PreserveConflict(Encode(item.File.Text, item.File.EncodingName, item.File.HasBom))));
                    }
            }
            Duplicates(candidates.GroupBy(c => c.File.NoteId, StringComparer.Ordinal), "note");
            Duplicates(candidates.GroupBy(c => c.File.DocumentId, StringComparer.Ordinal), "document");
            Duplicates(candidates.SelectMany(c => (c.Envelope.Metadata?.Notes[0].Bindings.Values ?? []).Select(id => (Id: id, Candidate: c)))
                .GroupBy(p => p.Id, p => p.Candidate, StringComparer.Ordinal), "binding");
            var states = new List<MarkdownFileState>();
            var changes = new List<ExternalNoteChange>();
            foreach (var candidate in candidates.Where(c => !duplicatePaths.Contains(c.File.RelativePath)))
            {
                var file = candidate.File;
                byId.TryGetValue(file.NoteId, out var old);
                current.Notes.TryGetValue(file.NoteId, out var note);
                if (old == file && note is not null && note.SavedSource?.Status != "unavailable") continue;
                states.Add(file);
                changes.Add(new(file.NoteId, candidate.Title, candidate.Envelope.Body, note?.CurrentSourceHash, candidate.Envelope.Metadata?.Notes[0].Bindings));
            }
            var seenIds = candidates.Select(c => c.File.NoteId).ToHashSet(StringComparer.Ordinal);
            var missing = new List<string>();
            foreach (var old in registry.Where(s => !seenIds.Contains(s.NoteId) && !physicalPaths.Contains(s.RelativePath) && current.Notes.ContainsKey(s.NoteId)))
            {
                try
                {
                    // A skipped reparse point or transient enumeration failure is not deletion.
                    if (File.Exists(paths.Resolve(old.RelativePath))) continue;
                    if (!old.Exists && current.Notes[old.NoteId].SavedSource?.Status == "missing") continue;
                    states.Add(old with { Exists = false }); missing.Add(old.NoteId);
                }
                catch (Exception exception) when (exception is IOException or ArgumentException or UnauthorizedAccessException)
                { issues.Add(new(old.RelativePath, "source-missing-uncertain", exception.Message, old.NoteId)); }
            }
            protectedNoteIds.Clear();
            protectedNoteIds.UnionWith(issues.Where(i => i.NoteId is not null).Select(i => i.NoteId!));
            return new(states.ToArray(), changes.ToArray(), issues.ToArray(), missing.ToArray());
        }
    }

    public void Commit(Snapshot previous, Snapshot next, Receipt receipt, string? consumedDraftNoteId)
    {
        lock (gate)
        {
            if (blocked) throw new IOException("Markdown mutations are blocked until pending recovery is resolved. Drafts remain available.");
            if (database.FindReceipt(receipt.OperationId) is { } found)
            {
                if (found.Fingerprint != receipt.Fingerprint) throw new InvalidOperationException("Operation ID has a different payload.");
                throw new InvalidOperationException("Operation already committed; reload the semantic snapshot before retrying.");
            }
            var registry = database.LoadSourceFiles().ToDictionary(f => f.NoteId, StringComparer.Ordinal);
            var observed = observations.TryGetValue(receipt.OperationId, out var captured) ? captured : [];
            var observedById = observed.ToDictionary(f => f.NoteId, StringComparer.Ordinal);
            // Captured observations have their own guards, even if a deletion
            // removes the note from Next or no file write is required.
            foreach (var state in observed) VerifyCurrent(state);
            foreach (var state in observed) registry[state.NoteId] = state;
            VerifySemanticReads(previous, next, registry);
            var states = new List<MarkdownFileState>();
            var mutations = new List<FileMutation>();
            foreach (var note in next.Notes.Values)
            {
                registry.TryGetValue(note.Id, out var file);
                if (file is { Exists: false })
                {
                    if (note.SavedSource?.Status != "missing") throw new IOException("A missing file requires explicit restore; an ordinary commit cannot recreate it.");
                    states.Add(file); continue;
                }
                previous.Notes.TryGetValue(note.Id, out var oldNote);
                var observedHere = observedById.ContainsKey(note.Id);
                var ownChange = !observedHere && (oldNote is null || oldNote.CurrentSource != note.CurrentSource || oldNote.Title != note.Title);
                var envelope = MarkdownEnvelopeCodec.Read(file?.Text ?? "");
                var bindings = next.Definitions.Values.Where(d => d.NoteId == note.Id).ToDictionary(d => d.Name, d => d.Id, StringComparer.Ordinal);
                var documentId = file?.DocumentId ?? Guid.NewGuid().ToString("N");
                var metadata = new MarkdownIdentityMetadata(1, documentId, [new(note.Id, note.Title, bindings)]);
                var sameBody = file is not null && envelope.Body == note.CurrentSource;
                var needsMetadata = file is null || file.IsManaged && !MetadataMatches(envelope.Metadata, metadata) || ownChange;
                // Incomplete externally saved source stays exact, including its
                // previous metadata. Reading ordinary files alone never adds IDs.
                if (file is not null && sameBody && (!needsMetadata || note.IsSourceStale && observedHere)) { states.Add(file); continue; }
                if (protectedNoteIds.Contains(note.Id)) throw new IOException("This source has an unresolved identity or metadata conflict; no file was overwritten.");
                if (!envelope.CanRewrite) throw new IOException($"Cannot rewrite metadata for {file?.RelativePath}: {string.Join("; ", envelope.Issues.Select(i => i.Code))}");
                if (file is not null) VerifyCurrent(file);
                var textWithBody = file is null ? note.CurrentSource : file.Text[..envelope.BodyStart] + note.CurrentSource;
                var output = MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read(textWithBody), metadata);
                if (!output.Success) throw new IOException("Could not serialize Markdown identity metadata: " + string.Join("; ", output.Issues.Select(i => i.Code)));
                var relative = file?.RelativePath ?? NewNotePath(note, creationLocations.GetValueOrDefault(receipt.OperationId, ""));
                var encoding = file?.EncodingName ?? "utf-8";
                var bom = file?.HasBom ?? false;
                var bytes = Encode(output.Source, encoding, bom);
                var desired = RecoverableFileOperations.Sha256(bytes);
                if (file is null || desired != file.ByteHash) mutations.Add(new(relative, file?.ByteHash, bytes));
                states.Add(new(documentId, note.Id, relative, output.Source, desired, encoding, bom, true));
            }
            if (states.Select(s => s.RelativePath).Distinct(StringComparer.OrdinalIgnoreCase).Count() != states.Count
                || states.Select(s => s.DocumentId).Distinct(StringComparer.Ordinal).Count() != states.Count)
                throw new IOException("Source identities or output paths collide.");
            if (mutations.Count == 0)
            {
                database.CommitSources(previous, next, receipt, consumedDraftNoteId, states);
                return;
            }
            var id = FileOperationId(receipt.OperationId);
            var intent = new SemanticIntent(1, id, previous.Revision, next, receipt, consumedDraftNoteId, states.ToArray(), mutations.ToArray());
            var accepted = false;
            try
            {
                StoreImmutable(IntentPath(id), JsonSerializer.SerializeToUtf8Bytes(intent, Json));
                accepted = true;
                var prepared = files.Prepare(id, intent.Mutations);
                if (prepared.Phase == FileOperationPhase.Conflict) throw Conflict(prepared);
                var applied = files.Apply(id);
                if (!applied.FilesWritten || applied.Conflicts.Count != 0) throw Conflict(applied);
                AfterFilesWrittenForTest?.Invoke();
                database.CommitSources(previous, next, receipt, consumedDraftNoteId, intent.Sources);
                AfterDatabaseCommitForTest?.Invoke();
                files.MarkSemanticFinalized(id, ReceiptToken(receipt));
            }
            catch (Exception exception)
            {
                if (accepted)
                {
                    blocked = true;
                    recoveryIssues.Add(new(IntentPath(id), "operation-pending", exception.Message));
                }
                throw;
            }
        }
    }

    private void RecoverPending()
    {
        paths.EnsureDirectory(IntentDirectory);
        var intents = Directory.EnumerateFiles(paths.Resolve(IntentDirectory), "*.json", SearchOption.TopDirectoryOnly)
            .Select(path => { WorkspaceFilePaths.EnsureNoReparse(path); return JsonSerializer.Deserialize<SemanticIntent>(File.ReadAllBytes(path), Json) ?? throw new InvalidDataException("Empty semantic intent."); })
            .OrderBy(intent => intent.Next.Revision).ToArray();
        foreach (var intent in intents)
        {
            if (intent.FormatVersion != 1 || intent.FileOperationId != FileOperationId(intent.Receipt.OperationId)
                || intent.Next.Revision != intent.Receipt.Revision || intent.Next.Revision <= intent.PreviousRevision)
                throw new InvalidDataException("Invalid semantic recovery intent.");
            var current = database.Load();
            if (current.WorkspaceId != intent.Next.WorkspaceId) throw new InvalidDataException("Semantic intent belongs to a different workspace.");
            if (database.FindReceipt(intent.Receipt.OperationId) is { } receipt)
            {
                if (receipt.Fingerprint != intent.Receipt.Fingerprint || receipt.Revision != intent.Receipt.Revision)
                    throw new InvalidDataException("Durable receipt disagrees with its semantic intent.");
                // Do not Inspect or Recover before this acknowledgement: an
                // external editor may legitimately have changed finalized bytes.
                var manifestPath = paths.Resolve($".grasp/operations/{intent.FileOperationId:N}/manifest.json");
                var manifest = JsonSerializer.Deserialize<FileOperationManifest>(File.ReadAllBytes(manifestPath), Json)
                    ?? throw new InvalidDataException("Missing file manifest for committed semantic intent.");
                files.AcknowledgeDurableReceipt(intent.FileOperationId, manifest.PayloadSha256, ReceiptToken(receipt));
                continue;
            }
            if (current.Revision != intent.PreviousRevision) throw new InvalidDataException("Pending semantic intent has a different revision base.");
            var prepared = files.Prepare(intent.FileOperationId, intent.Mutations);
            if (prepared.Phase == FileOperationPhase.Conflict) throw Conflict(prepared);
            var applied = files.Apply(intent.FileOperationId);
            if (!applied.FilesWritten || applied.Conflicts.Count != 0) throw Conflict(applied);
            database.CommitSources(current, intent.Next, intent.Receipt, intent.ConsumedDraftNoteId, intent.Sources);
            files.MarkSemanticFinalized(intent.FileOperationId, ReceiptToken(intent.Receipt));
        }
    }

    private IEnumerable<string> EnumerateMarkdown(List<MarkdownScanIssue> issues)
    {
        var directories = new Stack<string>(); directories.Push(paths.Root);
        while (directories.TryPop(out var directory))
        {
            string[] entries;
            try { WorkspaceFilePaths.EnsureNoReparse(directory); entries = Directory.GetFileSystemEntries(directory); }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            { issues.Add(new(Path.GetRelativePath(paths.Root, directory), "enumeration", exception.Message)); continue; }
            foreach (var entry in entries.Order(StringComparer.Ordinal))
            {
                var relative = Path.GetRelativePath(paths.Root, entry).Replace('\\', '/');
                FileAttributes attributes;
                try { attributes = File.GetAttributes(entry); }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                { issues.Add(new(relative, "enumeration", exception.Message)); continue; }
                if ((attributes & FileAttributes.ReparsePoint) != 0) { issues.Add(new(relative, "reparse-skipped", "Reparse points are not followed.")); continue; }
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    if (new[] { ".grasp", ".git", ".obsidian", "artifacts" }.Contains(Path.GetFileName(entry), StringComparer.OrdinalIgnoreCase)) continue;
                    directories.Push(entry);
                }
                else if (Path.GetExtension(entry).Equals(".md", StringComparison.OrdinalIgnoreCase))
                {
                    string normalized;
                    try { normalized = paths.NormalizeUserPath(relative); }
                    catch (ArgumentException exception) { issues.Add(new(relative, "path", exception.Message)); continue; }
                    yield return normalized;
                }
            }
        }
    }

    private static bool MetadataMatches(MarkdownIdentityMetadata? actual, MarkdownIdentityMetadata expected)
    {
        if (actual is null || actual.DocumentId != expected.DocumentId || actual.Notes.Count != 1) return false;
        var a = actual.Notes[0]; var b = expected.Notes[0];
        return a.Id == b.Id && a.Title == b.Title && a.Bindings.Count == b.Bindings.Count
            && a.Bindings.All(pair => b.Bindings.TryGetValue(pair.Key, out var id) && id == pair.Value);
    }
    private void VerifySemanticReads(Snapshot previous, Snapshot next, IReadOnlyDictionary<string, MarkdownFileState> registry)
    {
        var changed = next.Notes.Values.Where(n => !previous.Notes.TryGetValue(n.Id, out var old) || old.Revision != n.Revision).ToArray();
        var requested = new Queue<string>(changed.Where(n => !n.IsSourceStale).SelectMany(n =>
            n.Syntax.Definitions.Select(d => d.Name).Concat(n.Syntax.References.Select(r => r.Name))));
        var definitions = next.Notes.Values.SelectMany(n => n.Syntax.Definitions.Select(d => (Note: n, Definition: d)))
            .ToDictionary(p => p.Definition.Name, StringComparer.Ordinal);
        var names = new HashSet<string>(StringComparer.Ordinal);
        var owners = new HashSet<string>(StringComparer.Ordinal);
        while (requested.TryDequeue(out var name))
        {
            if (!names.Add(name) || !definitions.TryGetValue(name, out var value) || value.Note.IsSourceStale) continue;
            if (owners.Add(value.Note.Id) && registry.TryGetValue(value.Note.Id, out var file)) VerifyCurrent(file);
            foreach (var part in value.Definition.Parts.Where(p => p.Kind == PartKind.Identifier)) requested.Enqueue(part.Text);
        }
    }
    private void VerifyCurrent(MarkdownFileState file)
    {
        var bytes = ReadBytes(file.RelativePath);
        var hash = bytes is null ? null : RecoverableFileOperations.Sha256(bytes);
        if (hash != (file.Exists ? file.ByteHash : null)) throw new IOException($"External source changed after observation: {file.RelativePath}");
    }
    private byte[]? ReadBytes(string relative)
    {
        var path = paths.Resolve(relative);
        try { return File.ReadAllBytes(path); }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }
    private string PreserveConflict(byte[] bytes)
    {
        var relative = ".grasp/source-conflicts/" + RecoverableFileOperations.Sha256(bytes) + ".bin";
        StoreImmutable(relative, bytes); return relative;
    }
    private void StoreImmutable(string relative, byte[] bytes)
    {
        paths.EnsureDirectory(Path.GetDirectoryName(relative.Replace('/', Path.DirectorySeparatorChar))!);
        var target = paths.Resolve(relative);
        if (File.Exists(target))
        {
            if (!File.ReadAllBytes(target).AsSpan().SequenceEqual(bytes)) throw new InvalidDataException("Existing durable intent has different content.");
            return;
        }
        var temporary = paths.Resolve(relative + "." + Guid.NewGuid().ToString("N") + ".tmp");
        using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        { stream.Write(bytes); stream.Flush(true); }
        File.Move(temporary, target);
    }
    private string NewNotePath(Note note, string parent)
    {
        var title = string.Concat(note.Title.EnumerateRunes().Take(48).Select(r => r.ToString()));
        title = new string(title.Select(c => c < 32 || "<>:\"/\\|?*".Contains(c) ? '_' : c).ToArray()).Trim().TrimEnd('.');
        if (title.Length == 0) title = "Note";
        var stem = title.Split('.')[0].ToUpperInvariant();
        if (stem is "CON" or "PRN" or "AUX" or "NUL" || stem.Length == 4
            && (stem.StartsWith("COM", StringComparison.Ordinal) || stem.StartsWith("LPT", StringComparison.Ordinal)) && stem[3] is >= '1' and <= '9') title = "_" + title;
        var prefix = parent.Length == 0 ? "" : parent + "/";
        var candidate = paths.NormalizeUserPath(prefix + title + ".md");
        if (!File.Exists(paths.Resolve(candidate)) && !Directory.Exists(paths.Resolve(candidate))) return candidate;
        var suffix = FileOperationId(note.Id).ToString("N")[..8];
        for (var number = 0; number < 100; number++)
        {
            candidate = paths.NormalizeUserPath(prefix + title + "--" + suffix + (number == 0 ? "" : "-" + number) + ".md");
            if (!File.Exists(paths.Resolve(candidate)) && !Directory.Exists(paths.Resolve(candidate))) return candidate;
        }
        throw new IOException("No unused destination name could be selected.");
    }
    private static Guid FileOperationId(string operationId) => Guid.TryParse(operationId, out var id) && id != Guid.Empty
        ? id : new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(operationId)).AsSpan(0, 16));
    private static string IntentPath(Guid id) => $"{IntentDirectory}/{id:N}.json";
    private static string ReceiptToken(Receipt receipt) => JsonSerializer.Serialize(receipt, Json);
    private static IOException Conflict(FileOperationReport report) => new("File operation requires recovery: " + string.Join("; ", report.Conflicts.Select(c => c.RelativePath + ": " + c.Reason)));
    private sealed class Lease(Action release) : IDisposable
    {
        private Action? action = release;
        public void Dispose() => Interlocked.Exchange(ref action, null)?.Invoke();
    }
    private static (string Text, string EncodingName, bool HasBom) Decode(byte[] bytes)
    {
        if (bytes.AsSpan().StartsWith(new byte[] { 0xff, 0xfe, 0, 0 }) || bytes.AsSpan().StartsWith(new byte[] { 0, 0, 0xfe, 0xff }))
            throw new InvalidDataException("UTF-32 Markdown is not supported; source was preserved.");
        Encoding encoding; int skip; string name;
        if (bytes.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf })) { encoding = new UTF8Encoding(false, true); skip = 3; name = "utf-8"; }
        else if (bytes.AsSpan().StartsWith(new byte[] { 0xff, 0xfe })) { encoding = new UnicodeEncoding(false, false, true); skip = 2; name = "utf-16LE"; }
        else if (bytes.AsSpan().StartsWith(new byte[] { 0xfe, 0xff })) { encoding = new UnicodeEncoding(true, false, true); skip = 2; name = "utf-16BE"; }
        else { encoding = new UTF8Encoding(false, true); skip = 0; name = "utf-8"; }
        var text = encoding.GetString(bytes, skip, bytes.Length - skip);
        if (text.Contains('\0')) throw new InvalidDataException("NUL-containing or unknown-encoding Markdown is not rewritten.");
        return (text, name, skip != 0);
    }
    private static byte[] Encode(string text, string name, bool bom)
    {
        Encoding encoding = name switch
        {
            "utf-8" => new UTF8Encoding(bom, true),
            "utf-16LE" when bom => new UnicodeEncoding(false, true, true),
            "utf-16BE" when bom => new UnicodeEncoding(true, true, true),
            _ => throw new InvalidDataException("Unsupported source encoding; no conversion was attempted.")
        };
        return [.. encoding.GetPreamble(), .. encoding.GetBytes(text)];
    }
    public void Dispose() => database.Dispose();
}
