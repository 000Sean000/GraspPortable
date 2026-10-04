namespace GraspPortable.App.Authoring.Editing;

internal sealed record DurableDraftSnapshot(string NoteId, string SessionId, long Revision, long BaseNoteRevision,
    string? BaseSourceHash, string Title, string Source);

/// <summary>Tracks acknowledged draft bytes separately from semantic submission.</summary>
internal sealed class DraftDepartureGuard
{
    private readonly Dictionary<string, DurableDraftSnapshot> acknowledged = new(StringComparer.Ordinal);
    private readonly HashSet<(string NoteId, string SessionId)> deferred = [];
    private string? workspace;
    public string? PendingOperationId { get; private set; }
    public bool IsAttemptActive { get; private set; }
    public bool HasUnresolvedOperation => PendingOperationId is not null && !IsAttemptActive;
    /// <summary>Wait for the active save before inspecting its outcome. Caller must release writer even when false.</summary>
    public async Task<bool> AcquireWriterAsync(SemaphoreSlim writer)
    {
        await writer.WaitAsync();
        return PendingOperationId is null;
    }
    public void EnterWorkspace(string path)
    {
        if(string.Equals(workspace,path,StringComparison.OrdinalIgnoreCase))return;
        if(PendingOperationId is not null)throw new InvalidOperationException("Cannot leave the workspace of an unresolved operation.");
        acknowledged.Clear(); deferred.Clear(); workspace=path;
    }
    public void Acknowledge(DurableDraftSnapshot snapshot) => acknowledged[snapshot.NoteId] = snapshot;
    public void ForgetAcknowledgement(string noteId) => acknowledged.Remove(noteId);
    public bool IsDeferred(string noteId, string sessionId) => deferred.Contains((noteId, sessionId));
    public void Defer(string noteId, string sessionId) => deferred.Add((noteId, sessionId));
    public void RequestSubmission(string noteId, string sessionId) => deferred.Remove((noteId, sessionId));
    public bool MatchesAcknowledgement(DurableDraftSnapshot current) => acknowledged.GetValueOrDefault(current.NoteId) == current;
    public bool CanLeave(DurableDraftSnapshot current, bool composing) => !composing && PendingOperationId is null && MatchesAcknowledgement(current);
    public void BeginOperation(string id)
    {
        if(PendingOperationId is not null && PendingOperationId != id)
            throw new InvalidOperationException("Previous note operation still has an unknown outcome.");
        PendingOperationId = id;
        IsAttemptActive = true;
    }
    public void EndOperationAttempt() => IsAttemptActive = false;
    public bool CompleteOperation(string id,string status)
    {
        if(PendingOperationId != id) throw new InvalidOperationException("A different operation cannot resolve the pending note write.");
        IsAttemptActive = false;
        // Receipt lookup can return an ordinary HTTP-success DTO with status
        // unknown. Only explicit terminal/confirmation outcomes release it.
        if(status is not ("committed" or "source-saved" or "confirmation-required" or "conflict" or "rejected" or "invalid" or "draft"))return false;
        PendingOperationId = null;
        return true;
    }
}
