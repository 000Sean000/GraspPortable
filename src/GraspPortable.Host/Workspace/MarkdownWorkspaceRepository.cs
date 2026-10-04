using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.Records;
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
    private sealed record RecordsOverride(string NoteId, RecordsMetadata Metadata);
    private readonly ConcurrentDictionary<string, RecordsOverride> recordsOverrides = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (string DocumentId, string NoteId)> provisional = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<MarkdownScanIssue> recoveryIssues = [];
    private readonly HashSet<string> protectedNoteIds = new(StringComparer.Ordinal);
    private bool blocked;
    public bool UsesSavedSourceAuthority => true;
    private sealed record SemanticIntent(int FormatVersion, Guid FileOperationId, long PreviousRevision,
        Snapshot Next, Receipt Receipt, string? ConsumedDraftNoteId, MarkdownFileState[] Sources, FileMutation[] Mutations);
    private sealed record Member(string Id, string Title, string Body, IReadOnlyDictionary<string, string>? Bindings, RecordsDocumentDescriptor? Records);
    private sealed record Candidate(MarkdownFileState File, MarkdownEnvelope Envelope, IReadOnlyList<Member> Members);
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

    /// <summary>Host metadata participates in this operation's journal/receipt; failed preparation writes nothing.</summary>
    public IDisposable BeginRecordsMetadata(string operationId, string noteId, RecordsMetadata metadata)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operationId);
        var validation = RecordsMetadataCodec.Read(RecordsMetadataCodec.Write(metadata));
        if (!validation.Success) throw new ArgumentException(string.Join("; ", validation.Issues.Select(i => i.Message)), nameof(metadata));
        var captured = new RecordsOverride(noteId, validation.Metadata!);
        if (!recordsOverrides.TryAdd(operationId, captured)) throw new InvalidOperationException("Operation already has a Records metadata lease.");
        return new Lease(() => ((ICollection<KeyValuePair<string, RecordsOverride>>)recordsOverrides).Remove(new(operationId, captured)));
    }

    /// <summary>Only this operation may consume these captured observations.</summary>
    public IDisposable BeginObservation(string operationId, IReadOnlyList<MarkdownFileState> states)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operationId);
        var captured = states.ToArray();
        ValidateRegistry(captured);
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
            var issues = new List<MarkdownScanIssue>();
            var candidates = new List<Candidate>();
            var physicalPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var relative in EnumerateMarkdown(issues))
            {
                physicalPaths.Add(relative); byPath.TryGetValue(relative, out var registered);
                byte[]? bytes = null;
                void Issue(string code, string message, IEnumerable<string>? noteIds = null)
                {
                    var ids = (noteIds ?? registered?.NoteIds ?? []).Distinct(StringComparer.Ordinal).ToArray();
                    var hash = bytes is null ? null : RecoverableFileOperations.Sha256(bytes);
                    var preserved = bytes is null ? null : PreserveConflict(bytes);
                    if (ids.Length == 0) issues.Add(new(relative, code, message, null, hash, preserved));
                    else foreach (var id in ids) issues.Add(new(relative, code, message, id, hash, preserved));
                }
                try
                {
                    bytes = ReadBytes(relative) ?? throw new IOException("Source disappeared during the scan.");
                    var decoded = Decode(bytes); var envelope = MarkdownEnvelopeCodec.Read(decoded.Text);
                    if (!envelope.CanRewrite) { foreach (var issue in envelope.Issues) Issue(issue.Code, issue.Message); continue; }
                    var metadata = envelope.Metadata;
                    if (metadata is { Notes.Count: 0 }) { Issue("metadata-members", "A stored document must contain at least one note identity."); continue; }
                    if (registered?.IsManaged == true && metadata is null) { Issue("identity-removed", "Managed identity metadata was removed; all members are preserved pending reconciliation."); continue; }
                    var documentId = metadata?.DocumentId ?? registered?.DocumentId;
                    var noteId = metadata?.Notes[0].Id ?? registered?.NoteId;
                    if (documentId is null)
                    {
                        if (!provisional.TryGetValue(relative, out var ids)) provisional[relative] = ids = (Guid.NewGuid().ToString("N"), Guid.NewGuid().ToString("N"));
                        documentId = ids.DocumentId; noteId = ids.NoteId;
                    }
                    var memberIds = metadata?.Notes.Select(n => n.Id).ToArray() ?? [noteId!];
                    if (registered is not null && registered.DocumentId != documentId)
                    { Issue("identity-changed", "Existing path carries a different document identity."); continue; }
                    var grouped = metadata?.Layout == "grouped";
                    var file = new MarkdownFileState(documentId, noteId!, relative, decoded.Text, RecoverableFileOperations.Sha256(bytes),
                        decoded.EncodingName, decoded.HasBom, metadata is not null, MemberNoteIds: grouped ? memberIds : null, IsGrouped: grouped);
                    var members = ReadMembers(file, envelope);
                    candidates.Add(new(file, envelope, members));
                }
                catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or DecoderFallbackException or ArgumentException)
                { Issue("source-read", error.Message); }
            }
            var invalid = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            void Reject(Candidate candidate, string code, string message, IEnumerable<string>? members = null)
            {
                invalid.Add(candidate.File.RelativePath);
                var ids = (members ?? candidate.File.NoteIds).Concat(byPath.GetValueOrDefault(candidate.File.RelativePath)?.NoteIds ?? []).Distinct(StringComparer.Ordinal);
                var preserved = PreserveConflict(Encode(candidate.File.Text, candidate.File.EncodingName, candidate.File.HasBom));
                foreach (var id in ids) issues.Add(new(candidate.File.RelativePath, code, message, id, candidate.File.ByteHash, preserved));
            }
            void Duplicates(IEnumerable<IGrouping<string, Candidate>> groups, string kind)
            {
                foreach (var group in groups.Where(g => g.Count() > 1))
                    foreach (var item in group) Reject(item, "duplicate-identity", $"Duplicate {kind} identity; source was preserved.");
            }
            Duplicates(candidates.SelectMany(c => c.File.NoteIds.Select(id => (Id: id, Candidate: c))).GroupBy(x => x.Id, x => x.Candidate, StringComparer.Ordinal), "note");
            Duplicates(candidates.GroupBy(c => c.File.DocumentId, StringComparer.Ordinal), "document");
            Duplicates(candidates.SelectMany(c => (c.Envelope.Metadata?.Notes.SelectMany(n => n.Bindings.Values) ?? []).Select(id => (Id: id, Candidate: c)))
                .GroupBy(x => x.Id, x => x.Candidate, StringComparer.Ordinal), "binding");
            var validOwners = candidates.Where(c => !invalid.Contains(c.File.RelativePath)).SelectMany(c => c.File.NoteIds).ToHashSet(StringComparer.Ordinal);
            foreach (var candidate in candidates.ToArray())
                if (byPath.TryGetValue(candidate.File.RelativePath, out var old) && old.NoteIds.Any(id => !candidate.File.NoteIds.Contains(id) && !validOwners.Contains(id)))
                    Reject(candidate, "member-removed", "A member disappeared from a still-existing file without another unique owner; explicit grouping/deletion review is required.", old.NoteIds);
            var states = new List<MarkdownFileState>(); var changes = new List<ExternalNoteChange>();
            var accepted = candidates.Where(c => !invalid.Contains(c.File.RelativePath)).ToArray();
            foreach (var candidate in accepted)
            {
                var file = candidate.File; var old = registry.FirstOrDefault(f => f.DocumentId == file.DocumentId);
                var changedFile = old is null || !SameFileState(old, file);
                if (changedFile) states.Add(file);
                foreach (var member in candidate.Members)
                {
                    current.Notes.TryGetValue(member.Id, out var note);
                    if (note is null || note.CurrentSource != member.Body || note.Title != member.Title || note.SavedSource?.Status == "unavailable"
                        || !RecordsMetadataCodec.SameDescriptor(note.CurrentRecords, member.Records)
                        || changedFile && !BindingIdsMatch(current, member.Id, member.Bindings))
                        changes.Add(new(member.Id, member.Title, member.Body, note?.CurrentSourceHash, member.Bindings, member.Records));
                }
            }
            var seen = accepted.SelectMany(c => c.File.NoteIds).ToHashSet(StringComparer.Ordinal);
            var missing = new List<string>();
            foreach (var old in registry.Where(s => !physicalPaths.Contains(s.RelativePath)))
            {
                var absentIds = old.NoteIds.Where(id => !seen.Contains(id) && current.Notes.ContainsKey(id)).ToArray();
                if (absentIds.Length == 0) continue;
                try
                {
                    if (File.Exists(paths.Resolve(old.RelativePath))) continue;
                    if (!old.Exists && absentIds.All(id => current.Notes[id].SavedSource?.Status == "missing")) continue;
                    states.Add(old with { Exists = false, NoteId = absentIds[0], MemberNoteIds = old.IsGrouped ? absentIds : null }); missing.AddRange(absentIds);
                }
                catch (Exception error) when (error is IOException or ArgumentException or UnauthorizedAccessException)
                { foreach (var id in absentIds) issues.Add(new(old.RelativePath, "source-missing-uncertain", error.Message, id)); }
            }
            protectedNoteIds.Clear(); protectedNoteIds.UnionWith(issues.Where(i => i.NoteId is not null).Select(i => i.NoteId!));
            return new(states, changes, issues, missing);
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
            var observed = observations.TryGetValue(receipt.OperationId, out var captured) ? captured : [];
            recordsOverrides.TryGetValue(receipt.OperationId, out var recordsOverride);
            if (recordsOverride is not null && (receipt.NoteId != recordsOverride.NoteId || !next.Notes.TryGetValue(recordsOverride.NoteId, out var target)
                || target.IsSourceStale || !RecordsMetadataCodec.SameDescriptor(target.CurrentRecords, recordsOverride.Metadata.Descriptor)))
                throw new InvalidOperationException("Records metadata lease does not match the committed operation's target and descriptor.");
            foreach (var state in observed) VerifyCurrent(state);
            var registry = MergeRegistry(database.LoadSourceFiles(), observed);
            var byNote = registry.SelectMany(f => f.NoteIds.Select(id => (Id: id, File: f))).ToDictionary(x => x.Id, x => x.File, StringComparer.Ordinal);
            VerifySemanticReads(previous, next, byNote);
            var observedDocuments = observed.Select(f => f.DocumentId).ToHashSet(StringComparer.Ordinal);
            var states = new List<MarkdownFileState>(); var mutations = new List<FileMutation>();
            foreach (var file in registry)
            {
                var members = file.NoteIds.Where(next.Notes.ContainsKey).Select(id => next.Notes[id]).ToArray();
                if (members.Length == 0) continue;
                if (!file.Exists)
                {
                    if (members.Any(n => n.SavedSource?.Status != "missing")) throw new IOException("A missing physical document requires explicit restore.");
                    states.Add(file with { NoteId = members[0].Id, MemberNoteIds = file.IsGrouped ? members.Select(n => n.Id).ToArray() : null });
                    continue;
                }
                if (members.Length != file.NoteIds.Count) throw new IOException("An existing document lost a member without an explicit physical regrouping operation.");
                PrepareDocument(file, members);
            }
            foreach (var note in next.Notes.Values.Where(n => !byNote.ContainsKey(n.Id))) PrepareDocument(null, [note]);

            void PrepareDocument(MarkdownFileState? file, IReadOnlyList<Note> members)
            {
                var observedHere = file is not null && observedDocuments.Contains(file.DocumentId);
                var ownChange = !observedHere && members.Any(note => !previous.Notes.TryGetValue(note.Id, out var old) || old.CurrentSource != note.CurrentSource || old.Title != note.Title
                    || !RecordsMetadataCodec.SameDescriptor(old.CurrentRecords, note.CurrentRecords));
                var envelope = MarkdownEnvelopeCodec.Read(file?.Text ?? "");
                var existing = file is null ? [] : ReadMembers(file, envelope);
                var metadataNotes = members.Select(note =>
                {
                    // A stale observed member retains its prior identity envelope;
                    // healthy siblings can still receive derived reference updates.
                    var old = envelope.Metadata?.Notes.SingleOrDefault(n => n.Id == note.Id);
                    if (observedHere && note.IsSourceStale && old is not null) return old;
                    var records = note.CurrentRecords is null ? null : old?.Records is { } retained
                        ? retained with { Descriptor = note.CurrentRecords } : new RecordsMetadata(note.Id, note.Title, note.CurrentRecords);
                    if (recordsOverride?.NoteId == note.Id) records = recordsOverride.Metadata;
                    return new MarkdownIdentityNote(note.Id, note.Title,
                        next.Definitions.Values.Where(d => d.NoteId == note.Id && d.FieldOrigin is null).ToDictionary(d => d.Name, d => d.Id, StringComparer.Ordinal), records);
                }).ToArray();
                var documentId = file?.DocumentId ?? Guid.NewGuid().ToString("N");
                var metadata = new MarkdownIdentityMetadata(1, documentId, metadataNotes, file?.IsGrouped == true ? "grouped" : envelope.Metadata?.Layout);
                var sameBody = file is not null && members.All(n => existing.Single(m => m.Id == n.Id).Body == n.CurrentSource);
                var needsMetadata = file is null || file.IsManaged && !MetadataMatches(envelope.Metadata, metadata) || ownChange;
                if (file is not null && sameBody && !needsMetadata) { states.Add(file); return; }
                if (members.Any(n => protectedNoteIds.Contains(n.Id))) throw new IOException("This physical document has an unresolved member identity or metadata conflict; no source was overwritten.");
                if (!envelope.CanRewrite) throw new IOException("Cannot rewrite document identity metadata.");
                if (file is not null) VerifyCurrent(file);
                var body = members[0].CurrentSource;
                if (file?.IsGrouped == true)
                {
                    body = envelope.Body;
                    foreach (var member in members.Where(n => existing.Single(m => m.Id == n.Id).Body != n.CurrentSource))
                    {
                        var updated = GroupedNoteCodec.ReplaceMember(body, GroupedNoteCodec.Parse(body, file.NoteIds), member.Id, member.CurrentSource);
                        if (!updated.Success) throw new IOException("Grouped member source could not be safely replaced: " + string.Join("; ", updated.Issues.Select(i => i.Message)));
                        body = updated.Source;
                    }
                }
                var textWithBody = file is null ? body : file.Text[..envelope.BodyStart] + body;
                var output = MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read(textWithBody), metadata);
                if (!output.Success) throw new IOException("Could not serialize document identity metadata: " + string.Join("; ", output.Issues.Select(i => i.Code)));
                var relative = file?.RelativePath ?? NewNotePath(members[0], creationLocations.GetValueOrDefault(receipt.OperationId, ""));
                var encoding = file?.EncodingName ?? "utf-8"; var bom = file?.HasBom ?? false;
                var bytes = Encode(output.Source, encoding, bom); var desired = RecoverableFileOperations.Sha256(bytes);
                if (file is null || desired != file.ByteHash) mutations.Add(new(relative, file?.ByteHash, bytes));
                states.Add(new(documentId, members[0].Id, relative, output.Source, desired, encoding, bom, true,
                    MemberNoteIds: file?.IsGrouped == true ? members.Select(n => n.Id).ToArray() : null, IsGrouped: file?.IsGrouped == true));
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
        return actual is not null && actual.DocumentId == expected.DocumentId && actual.Layout == expected.Layout
            && actual.Notes.Count == expected.Notes.Count && actual.Notes.Zip(expected.Notes).All(pair =>
                pair.First.Id == pair.Second.Id && pair.First.Title == pair.Second.Title && SameBindings(pair.First.Bindings, pair.Second.Bindings)
                && SameRecordsMetadata(pair.First.Records, pair.Second.Records));
    }
    private static bool SameRecordsMetadata(RecordsMetadata? a, RecordsMetadata? b)
        => a is null || b is null ? a is null && b is null
            : a.CollectionId == b.CollectionId && a.Title == b.Title && a.ViewsYaml == b.ViewsYaml
                && a.ConversionHistoryYaml == b.ConversionHistoryYaml
                && RecordsMetadataCodec.SameDescriptor(a.Descriptor, b.Descriptor);
    private static bool SameBindings(IReadOnlyDictionary<string, string> a, IReadOnlyDictionary<string, string> b)
        => a.Count == b.Count && a.All(pair => b.TryGetValue(pair.Key, out var id) && id == pair.Value);
    private static bool BindingIdsMatch(Snapshot snapshot, string noteId, IReadOnlyDictionary<string, string>? actual)
        => actual is null || SameBindings(actual, snapshot.Definitions.Values.Where(d => d.NoteId == noteId && d.FieldOrigin is null).ToDictionary(d => d.Name, d => d.Id, StringComparer.Ordinal));
    private static bool SameFileState(MarkdownFileState a, MarkdownFileState b)
        => a.DocumentId == b.DocumentId && a.RelativePath == b.RelativePath && a.Text == b.Text && a.ByteHash == b.ByteHash
            && a.EncodingName == b.EncodingName && a.HasBom == b.HasBom && a.IsManaged == b.IsManaged && a.Exists == b.Exists
            && a.IsGrouped == b.IsGrouped && a.NoteIds.SequenceEqual(b.NoteIds, StringComparer.Ordinal);
    private static IReadOnlyList<Member> ReadMembers(MarkdownFileState file, MarkdownEnvelope envelope)
    {
        if (!envelope.CanRewrite) throw new InvalidDataException("Document envelope cannot be safely interpreted.");
        if (file.IsGrouped)
        {
            if (envelope.Metadata is not { Layout: "grouped" } metadata || !metadata.Notes.Select(n => n.Id).SequenceEqual(file.NoteIds, StringComparer.Ordinal))
                throw new InvalidDataException("Grouped registry and metadata membership differ.");
            var grouped = GroupedNoteCodec.Parse(envelope.Body, file.NoteIds);
            if (!grouped.CanRewrite || grouped.Members.Count != file.NoteIds.Count)
                throw new InvalidDataException("Grouped framing is ambiguous: " + string.Join("; ", grouped.Issues.Where(i => !i.IsWarning).Select(i => i.Message)));
            return metadata.Notes.Select(n => new Member(n.Id, n.Title, grouped.Members.Single(m => m.NoteId == n.Id).Body, n.Bindings, n.Records?.Descriptor)).ToArray();
        }
        if (file.NoteIds.Count != 1 || envelope.Metadata is { } single && (single.Layout == "grouped" || single.Notes.Count != 1 || single.Notes[0].Id != file.NoteId))
            throw new InvalidDataException("Single-note registry and metadata membership differ.");
        return [new(file.NoteId, envelope.Metadata?.Notes[0].Title ?? Path.GetFileNameWithoutExtension(file.RelativePath), envelope.Body, envelope.Metadata?.Notes[0].Bindings, envelope.Metadata?.Notes[0].Records?.Descriptor)];
    }
    private static void ValidateRegistry(IReadOnlyList<MarkdownFileState> registry)
    {
        var ids = registry.SelectMany(f => f.NoteIds).ToArray();
        if (registry.Any(f => f.NoteIds.Count == 0 || f.NoteId != f.NoteIds[0] || !f.IsGrouped && f.NoteIds.Count != 1)
            || ids.Distinct(StringComparer.Ordinal).Count() != ids.Length
            || registry.Select(f => f.DocumentId).Distinct(StringComparer.Ordinal).Count() != registry.Count
            || registry.Select(f => f.RelativePath).Distinct(StringComparer.OrdinalIgnoreCase).Count() != registry.Count)
            throw new InvalidDataException("Physical document registry has duplicate paths/identities or invalid membership.");
    }
    private IReadOnlyList<MarkdownFileState> MergeRegistry(IReadOnlyList<MarkdownFileState> previous, IReadOnlyList<MarkdownFileState> observed)
    {
        ValidateRegistry(observed);
        var result = previous.ToDictionary(f => f.DocumentId, StringComparer.Ordinal);
        var updated = observed.Select(f => f.DocumentId).ToHashSet(StringComparer.Ordinal);
        var moved = observed.SelectMany(f => f.NoteIds.Select(id => (Id: id, f.DocumentId))).ToDictionary(p => p.Id, p => p.DocumentId, StringComparer.Ordinal);
        foreach (var old in previous.Where(f => !updated.Contains(f.DocumentId) && f.NoteIds.Any(id => moved.TryGetValue(id, out var owner) && owner != f.DocumentId)))
        {
            if (!old.NoteIds.All(moved.ContainsKey) || File.Exists(paths.Resolve(old.RelativePath)))
                throw new IOException("Prior document still owns members or physical bytes; regrouping is incomplete.");
            result.Remove(old.DocumentId);
        }
        foreach (var file in observed) result[file.DocumentId] = file;
        var merged = result.Values.ToArray(); ValidateRegistry(merged); return merged;
    }
    /// <summary>Refreshes only derived document observations whose note semantics still exactly match the expected snapshot.</summary>
    public void RefreshSourceRegistry(Snapshot expectedSnapshot, IReadOnlyList<MarkdownFileState> states)
    {
        lock (gate)
        {
            if (blocked) throw new IOException("Pending recovery blocks registry refresh.");
            foreach (var file in states)
            {
                VerifyCurrent(file);
                if (!file.Exists) throw new IOException("Deletion observations require a semantic transaction.");
                foreach (var member in ReadMembers(file, MarkdownEnvelopeCodec.Read(file.Text)))
                    if (!expectedSnapshot.Notes.TryGetValue(member.Id, out var note) || note.CurrentSource != member.Body || note.Title != member.Title
                        || !BindingIdsMatch(expectedSnapshot, member.Id, member.Bindings) || !RecordsMetadataCodec.SameDescriptor(note.CurrentRecords, member.Records))
                        throw new IOException("Source content or member identity needs semantic reconciliation.");
            }
            database.RefreshSourceRegistry(expectedSnapshot, MergeRegistry(database.LoadSourceFiles(), states));
        }
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
            if (registry.TryGetValue(value.Note.Id, out var file) && owners.Add(file.DocumentId)) VerifyCurrent(file);
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
