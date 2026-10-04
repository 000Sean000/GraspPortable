using System.Threading.Channels;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Notifications;

namespace GraspPortable.Host.Workspace;

/// <summary>Serializes source reconciliation with API mutations. Draft saves keep their own Core guard.</summary>
public sealed class WorkspaceCoordinator(MarkdownWorkspaceRepository repository, KnowledgeService knowledge,
    RevisionHub revisions, string root, WorkspaceFileActions? fileActions = null, WorkspaceGrouping? grouping = null) : BackgroundService
{
    private readonly SemaphoreSlim mutations = new(1, 1);
    private readonly Channel<bool> signals = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropOldest });
    private WorkspaceSourceStatus status = new(false, [], null);
    public WorkspaceSourceStatus Status => Volatile.Read(ref status);
    public event Action? PhysicalFilesChanged;

    public async Task<T> MutateAsync<T>(Func<Task<T>> action, CancellationToken token = default)
    {
        await mutations.WaitAsync(token);
        try {
            await ReconcileInsideAsync(token);
            if(HasPendingFiles) throw new IOException("有尚未完成的檔案操作，保留草稿並重開工作區以恢復。");
            return await action();
        }
        finally { mutations.Release(); }
    }

    public async Task ReconcileAsync(CancellationToken token = default)
    {
        await mutations.WaitAsync(token);
        try { await ReconcileInsideAsync(token); }
        finally { mutations.Release(); }
    }

    private async Task ReconcileInsideAsync(CancellationToken token)
    {
        var issues = new List<MarkdownScanIssue>(repository.PendingRecoveryIssues);
        try
        {
            if(HasPendingFiles)
                issues.Add(new("", "file-operation-pending", "檔案操作尚有恢復作業，暫停來源回寫；草稿仍可保存。"));
            else if(!repository.IsWriteBlocked)
            {
                var scan = repository.Scan(knowledge.Current);
                issues.AddRange(scan.Issues);
                var unavailable = scan.Issues.Where(i => i.NoteId is not null && knowledge.Current.Notes.ContainsKey(i.NoteId))
                    .GroupBy(i => i.NoteId!, StringComparer.Ordinal)
                    .ToDictionary(g => g.Key, g => string.Join("；", g.Select(i => i.Message)), StringComparer.Ordinal);
                foreach(var pair in unavailable.ToArray())
                    if(knowledge.Current.Notes[pair.Key].SavedSource is { Status: "unavailable" } old && old.Diagnostics.Any(d => d.Message == pair.Value))
                        unavailable.Remove(pair.Key);
                if(scan.Changes.Count > 0 || scan.MissingNoteIds.Count > 0 || unavailable.Count > 0)
                {
                    var op = Guid.NewGuid().ToString("N");
                    using var captured = repository.BeginObservation(op, scan.States);
                    var expected = scan.MissingNoteIds.Where(knowledge.Current.Notes.ContainsKey)
                        .ToDictionary(id => id, id => knowledge.Current.Notes[id].CurrentSourceHash);
                    var result = await knowledge.ObserveExternalAsync(op, scan.Changes, token, expected, unavailable);
                    if(result.Status != "source-observed") issues.Add(new("", result.Status, result.Message ?? "來源尚未接受，稍後重新觀測。"));
                }
                else if(scan.States.Count > 0) repository.RefreshSourceRegistry(knowledge.Current,scan.States);
            }
        }
        catch(Exception error) when(error is IOException or UnauthorizedAccessException or InvalidOperationException)
        { issues.Add(new("", "reconcile-pending", error.Message)); }
        Volatile.Write(ref status, new(repository.IsWriteBlocked || HasPendingFiles,
            issues.Select(i => new WorkspaceSourceIssue(i.RelativePath, i.Code, i.Message, i.NoteId)).Distinct().ToArray(), DateTimeOffset.UtcNow));
    }

    private bool HasPendingFiles => fileActions?.HasPendingOperations == true || grouping?.HasPendingOperations == true;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var watcher = new FileSystemWatcher(root) { IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size };
        void Changed(object sender, FileSystemEventArgs args)
        {
            var relative = Path.GetRelativePath(root, args.FullPath).Replace('\\', '/');
            if(relative.StartsWith(".grasp/", StringComparison.OrdinalIgnoreCase) || relative == ".grasp.lock"
                || relative.StartsWith("workspace.grasp.db", StringComparison.OrdinalIgnoreCase)
                || relative.StartsWith(".git/", StringComparison.OrdinalIgnoreCase)) return;
            PhysicalFilesChanged?.Invoke();
            signals.Writer.TryWrite(true);
        }
        watcher.Changed += Changed; watcher.Created += Changed; watcher.Deleted += Changed;
        watcher.Renamed += (sender, args) => Changed(sender, args);
        watcher.Error += (_, _) => signals.Writer.TryWrite(true);
        watcher.EnableRaisingEvents = true;
        // Periodic reconciliation covers missed events and notification overflow.
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        var periodic = Task.Run(async () => {
            try { while(await timer.WaitForNextTickAsync(stoppingToken)) signals.Writer.TryWrite(false); }
            catch(OperationCanceledException) when(stoppingToken.IsCancellationRequested) { }
        }, stoppingToken);
        try
        {
            await foreach(var physicalChange in signals.Reader.ReadAllAsync(stoppingToken))
            {
                await Task.Delay(180, stoppingToken);
                while(signals.Reader.TryRead(out _)) { }
                var previous = knowledge.Current.Revision;
                var oldIssues = Status.Issues;
                await ReconcileAsync(stoppingToken);
                if(physicalChange || previous != knowledge.Current.Revision || !oldIssues.SequenceEqual(Status.Issues))
                    revisions.Publish(new(knowledge.Current.Revision, [], knowledge.Current.PolicyRevision));
            }
        }
        catch(OperationCanceledException) when(stoppingToken.IsCancellationRequested) { }
        finally { await periodic; }
    }

    public override void Dispose() { base.Dispose(); mutations.Dispose(); }
}
