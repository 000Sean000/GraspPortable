using System.Security.Cryptography;
using System.Text.Json;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace.FileOperations;

namespace GraspPortable.Host.Workspace.Backups;

/// <summary>Serializes backup work before entering the coordinator gate; callers must not hold that gate.</summary>
public sealed class WorkspaceBackupManager : BackgroundService
{
    private readonly string root, store, statePath;
    private readonly WorkspaceCoordinator coordinator;
    private readonly KnowledgeService knowledge;
    private readonly WorkspaceBackups backups;
    private readonly SemaphoreSlim work = new(1, 1);
    private readonly Task initialized;
    private ManagerState state;
    private string? stateError;
    private BackupStatusDto status = new(new(0), [], "idle", []);
    private long changes, capturedChanges;
    private DateTimeOffset lastAttempt = DateTimeOffset.UtcNow;

    public WorkspaceBackupManager(string root, WorkspaceCoordinator coordinator, KnowledgeService knowledge)
    {
        this.root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        this.coordinator = coordinator; this.knowledge = knowledge;
        backups = new(this.root);
        store = Path.Combine(this.root, ".grasp", "backup-manager");
        statePath = Path.Combine(store, "state.json");
        state = new(1, new(0), -1, new(StringComparer.Ordinal));
        try
        {
            WorkspaceFilePaths.EnsureNoReparse(statePath);
            if (File.Exists(statePath)) state = ReadState(statePath);
        }
        catch (Exception error) when (Expected(error)) { stateError = error.Message; }
        status = new(state.Options, [], stateError is null ? "idle" : "failed",
            stateError is null ? [] : [new("manager-state", statePath, stateError)]);
        knowledge.Changed += KnowledgeChanged;
        initialized = Task.Run(InitializeAsync);
    }

    public void MarkChanged() => Interlocked.Increment(ref changes);
    private void KnowledgeChanged(ChangeNotice notice) => MarkChanged();
    public async Task<BackupStatusDto> ReadStatusAsync()
    {
        await initialized;
        // "ready" describes the last publication, not whether it covers changes
        // accepted since then. Sample the same counters used by scheduled capture.
        return Volatile.Read(ref status) with
        { HasPendingChanges = Interlocked.Read(ref changes) != Interlocked.Read(ref capturedChanges) };
    }

    private Task InitializeAsync()
    {
        try
        {
            RefreshGenerations();
            if ((knowledge.Current.Notes.Count > 0 || state.CapturedRevision >= 0) && knowledge.Current.Revision > state.CapturedRevision
                || state.Options.Version > state.CapturedOptionsVersion
                || knowledge.Current.Notes.Keys.Any(id => knowledge.GetDraft(id) is not null)
                || status.Generations.Length == 0 && knowledge.Current.Notes.Count > 0) MarkChanged();
        }
        catch (Exception error) when (Expected(error)) { SetStatus("failed", [new("list", root, error.Message)]); }
        return Task.CompletedTask;
    }

    public async Task<BackupResultDto> CaptureAsync(string opId, bool onlyIfChanged = false, CancellationToken ct = default)
    {
        await initialized; await work.WaitAsync(ct);
        try
        {
            var id = OperationId(opId); var fingerprint = Fingerprint(new { Kind = "capture", onlyIfChanged });
            if (Previous(id, fingerprint) is { } previous) return previous;
            RequireState();
            if (state.CapturingOperationId is { } pendingId && pendingId != id
                && state.Operations.TryGetValue(pendingId, out var pending) && pending.Result is null)
                _ = await Task.Run(() => RecoverCapture(pendingId, pending.Fingerprint), ct);
            // A generation includes its pending operation record. This bridges publication
            // and manager-receipt persistence without publishing the checkpoint a second time.
            if (state.Operations.ContainsKey(id) && await Task.Run(() => RecoverCapture(id, fingerprint), ct) is { } recovered) return recovered;
            Begin(id, fingerprint); SetStatus("running", []); lastAttempt = DateTimeOffset.UtcNow;
            BackupResultDto? publishedResult = null;
            try
            {
                var outcome = await coordinator.MutateAsync(async () =>
                {
                    if (coordinator.Status.WritesBlocked) throw new IOException("Workspace recovery is pending; previous checkpoints are preserved.");
                    var observedChanges = Interlocked.Read(ref changes);
                    var revision = knowledge.Current.Revision;
                    // Reconciliation precedes this comparison, including on shutdown:
                    // a just-edited source may not have delivered its watcher event yet.
                    if (onlyIfChanged && observedChanges == Interlocked.Read(ref capturedChanges))
                        return (result: new BackupCaptureResult("unchanged", null, []), observedChanges, revision);
                    Begin(id, fingerprint, revision);
                    var result = await Task.Run(() => backups.Capture(state.Options.RetainedCopies, ct), ct);
                    return (result, observedChanges, revision);
                }, ct);
                var result = new BackupResultDto(id, outcome.result.Status, outcome.result.GenerationPath, Map(outcome.result.Problems));
                if (result.Status == "published")
                {
                    publishedResult = result;
                    state = state with { CapturedRevision = outcome.revision, CapturedOptionsVersion = state.Options.Version };
                    Interlocked.Exchange(ref capturedChanges, outcome.observedChanges);
                }
                var completed = Complete(id, fingerprint, result);
                if (result.Status != "unchanged") await Task.Run(RefreshGenerations, CancellationToken.None);
                SetStatus(result.Status switch { "published" => "ready", "unchanged" => status.Generations.Length > 0 ? "ready" : "idle", _ => "failed" }, result.Issues);
                return completed;
            }
            catch (Exception error) when (Expected(error) || error is OperationCanceledException)
            {
                SetStatus("failed", [new("capture", root, error.Message)]);
                // Never replace a known successful publication with a failed receipt.
                // A still-pending receipt is recovered from that verified generation.
                if (publishedResult is not null) return publishedResult with { Issues = [.. publishedResult.Issues, .. status.Issues] };
                return Complete(id, fingerprint, new(id, error is OperationCanceledException ? "cancelled" : "rejected", null, status.Issues));
            }
        }
        catch (Exception error) when (Expected(error)) { return Failure(opId, "capture", error); }
        finally { work.Release(); }
    }

    public async Task<BackupResultDto> UpdateSettingsAsync(BackupSettingsRequest request, CancellationToken ct = default)
    {
        await initialized; await work.WaitAsync(ct);
        try
        {
            var id = OperationId(request.OperationId);
            var fingerprint = Fingerprint(new { Kind = "settings", request.ExpectedVersion, request.IntervalMinutes, request.RetainedCopies });
            if (Previous(id, fingerprint) is { } previous) return previous;
            RequireState();
            if (request.ExpectedVersion != state.Options.Version)
                return Complete(id, fingerprint, new(id, "version-conflict", null, [new("settings-version", "", "Backup settings changed; reload before editing.")]));
            if (request.IntervalMinutes is < 1 or > 1440 || request.RetainedCopies is < 1 or > 30)
                return Complete(id, fingerprint, new(id, "invalid", null, [new("settings-range", "", "Interval must be 1–1440 minutes; retained copies must be 1–30.")]));
            var next = state with { Options = new(state.Options.Version + 1, request.IntervalMinutes, request.RetainedCopies) };
            var result = new BackupResultDto(id, "updated", null, []);
            Persist(next with { Operations = WithReceipt(next, id, new(fingerprint, result)) });
            MarkChanged();
            SetStatus(status.Status, status.Issues);
            return result;
        }
        catch (Exception error) when (Expected(error)) { return Failure(request.OperationId, "settings", error); }
        finally { work.Release(); }
    }

    public async Task<BackupResultDto> RestoreAsync(RestoreBackupRequest request, CancellationToken ct = default)
    {
        await initialized; await work.WaitAsync(ct);
        try
        {
            var id = OperationId(request.OperationId);
            var generation = Path.TrimEndingDirectorySeparator(Path.GetFullPath(request.GenerationPath));
            var destination = Path.TrimEndingDirectorySeparator(Path.GetFullPath(request.DestinationPath));
            var fingerprint = Fingerprint(new { Kind = "restore", Generation = generation.ToUpperInvariant(), Destination = destination.ToUpperInvariant() });
            if (Previous(id, fingerprint) is { } previous) return previous;
            RequireState();
            var backupRoot = Path.Combine(root, ".grasp", "backups");
            if (!string.Equals(Path.GetDirectoryName(generation), backupRoot, StringComparison.OrdinalIgnoreCase)
                || !Path.GetFileName(generation).StartsWith("generation-", StringComparison.Ordinal))
                throw new IOException("Restore requires a published generation in this workspace.");
            // For an interrupted operation the primitive can validate its destination receipt,
            // even after retention removed the original generation.
            if (!state.Operations.ContainsKey(id) && !(await Task.Run(() => backups.Verify(generation), ct)).Valid)
                throw new IOException("Backup generation failed verification.");
            Begin(id, fingerprint); SetStatus("running", []);
            BackupResultDto? restoredResult = null;
            try
            {
                var restored = await Task.Run(() => backups.Restore(generation, destination, ct, id), ct);
                restoredResult = new(id, "restored", restored.Path, Map(restored.Problems));
                var result = Complete(id, fingerprint, restoredResult);
                SetStatus("ready", result.Issues); return result;
            }
            catch (Exception error) when (Expected(error) || error is OperationCanceledException)
            {
                SetStatus("failed", [new("restore", destination, error.Message)]);
                if (restoredResult is not null) return restoredResult with { Issues = [.. restoredResult.Issues, .. status.Issues] };
                return Complete(id, fingerprint, new(id, error is OperationCanceledException ? "cancelled" : "rejected", null, status.Issues));
            }
        }
        catch (Exception error) when (Expected(error)) { return Failure(request.OperationId, "restore", error); }
        finally { work.Release(); }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await initialized;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
                if (Interlocked.Read(ref changes) != Interlocked.Read(ref capturedChanges)
                    && DateTimeOffset.UtcNow - lastAttempt >= TimeSpan.FromMinutes(Volatile.Read(ref status).Options.IntervalMinutes))
                    await CaptureAsync(Guid.NewGuid().ToString("N"), true, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    private BackupResultDto? RecoverCapture(string id, string fingerprint)
    {
        foreach (var generation in backups.ListVerified())
        {
            var capturedStatePath = Path.Combine(generation.Path, "content", ".grasp", "backup-manager", "state.json");
            if (!File.Exists(capturedStatePath)) continue;
            var captured = ReadState(capturedStatePath);
            if (captured.CapturingOperationId == id && captured.Operations.TryGetValue(id, out var operation) && operation.Fingerprint == fingerprint && operation.Result is null)
            {
                state = state with { CapturedRevision = Math.Max(state.CapturedRevision, operation.CaptureRevision ?? -1),
                    CapturedOptionsVersion = Math.Max(state.CapturedOptionsVersion, captured.Options.Version) };
                var result = Complete(id, fingerprint, new(id, "published", generation.Path, []));
                RefreshGenerations(); SetStatus("ready", []); return result;
            }
        }
        return null;
    }
    private void RefreshGenerations()
    {
        var generations = backups.ListVerified().Select(g => new BackupGenerationDto(g.Path, g.CreatedAt, g.FileCount)).ToArray();
        var previous = Volatile.Read(ref status);
        Volatile.Write(ref status, previous with { Generations = generations, Status = stateError is not null ? "failed" : previous.Status == "idle" && generations.Length > 0 ? "ready" : previous.Status });
    }
    private void SetStatus(string value, BackupIssueDto[] issues) => Volatile.Write(ref status, new(state.Options, status.Generations, value, issues));
    private BackupResultDto Failure(string id, string code, Exception error)
    { var issues = new[] { new BackupIssueDto(code, root, error.Message) }; SetStatus("failed", issues); return new(id, "rejected", null, issues); }
    private void RequireState() { if (stateError is not null) throw new InvalidDataException("Backup manager metadata must be recovered before writing: " + stateError); }
    private BackupResultDto? Previous(string id, string fingerprint)
    {
        if (!state.Operations.TryGetValue(id, out var previous)) return null;
        if (previous.Fingerprint != fingerprint) return new(id, "operation-conflict", null, [new("operation-id", "", "Operation ID was already used for another request.")]);
        return previous.Result;
    }
    private void Begin(string id, string fingerprint, long? captureRevision = null) => Persist(state with
    { Operations = WithReceipt(state, id, new(fingerprint, null, captureRevision)), CapturingOperationId = captureRevision.HasValue ? id : state.CapturingOperationId });
    private BackupResultDto Complete(string id, string fingerprint, BackupResultDto result)
    { Persist(state with { Operations = WithReceipt(state, id, new(fingerprint, result)), CapturingOperationId = state.CapturingOperationId == id ? null : state.CapturingOperationId }); return result; }
    private static Dictionary<string, OperationRecord> WithReceipt(ManagerState basis, string id, OperationRecord receipt)
    { var operations = new Dictionary<string, OperationRecord>(basis.Operations, StringComparer.Ordinal) { [id] = receipt }; return operations; }
    private void Persist(ManagerState next)
    {
        WorkspaceFilePaths.EnsureNoReparse(store); Directory.CreateDirectory(store); WorkspaceFilePaths.EnsureNoReparse(statePath);
        var temporary = Path.Combine(store, Guid.NewGuid().ToString("N") + ".tmp");
        using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        { JsonSerializer.Serialize(file, next); file.Flush(true); }
        File.Move(temporary, statePath, true); state = next;
    }
    private static ManagerState ReadState(string path)
    {
        WorkspaceFilePaths.EnsureNoReparse(path);
        var result = JsonSerializer.Deserialize<ManagerState>(File.ReadAllBytes(path)) ?? throw new InvalidDataException("Empty backup manager state.");
        if (result.Format != 1 || result.Options is null || result.Options.Version < 0
            || result.Options.IntervalMinutes is < 1 or > 1440 || result.Options.RetainedCopies is < 1 or > 30 || result.Operations is null
            || result.Operations.Any(p => !Guid.TryParseExact(p.Key, "N", out var id) || id == Guid.Empty || p.Value is null || string.IsNullOrEmpty(p.Value.Fingerprint)))
            throw new InvalidDataException("Invalid backup manager state; preserving its original bytes.");
        return result;
    }
    private static string OperationId(string value) => Guid.TryParse(value, out var id) && id != Guid.Empty ? id.ToString("N") : throw new ArgumentException("Operation ID must be a nonempty UUID.");
    private static string Fingerprint<T>(T value) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static BackupIssueDto[] Map(BackupProblem[] problems) => problems.Select(p => new BackupIssueDto(p.Code, p.Path, p.Message)).ToArray();
    private static bool Expected(Exception error) => error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException or InvalidOperationException;
    public override void Dispose() { knowledge.Changed -= KnowledgeChanged; base.Dispose(); }
    private sealed record OperationRecord(string Fingerprint, BackupResultDto? Result, long? CaptureRevision = null);
    private sealed record ManagerState(int Format, BackupOptionsDto Options, long CapturedRevision, Dictionary<string, OperationRecord> Operations,
        string? CapturingOperationId = null, long CapturedOptionsVersion = 0);
}
