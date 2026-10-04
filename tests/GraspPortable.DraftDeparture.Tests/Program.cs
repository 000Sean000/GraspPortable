using GraspPortable.App.Authoring.Editing;

try
{
    var checks=0;
    void Check(bool condition,string label) { checks++; if(!condition)throw new InvalidOperationException(label); }
    void Throws(Action action,string label) { try {action();}catch(InvalidOperationException){checks++;return;}throw new InvalidOperationException(label); }
    var draft=new DurableDraftSnapshot("note","session",7,3,"raw-base","本地標題","中文草稿\r\n@code{ @New = {value} }");
    var guard=new DraftDepartureGuard();
    Check(!guard.CanLeave(draft,false),"memory-only text is not durable");
    guard.Acknowledge(draft);
    Check(guard.CanLeave(draft,false),"exact server acknowledgement permits departure");
    Check(!guard.CanLeave(draft,true),"IME remains unsafe even when prior text matched");
    foreach(var newer in new[] {draft with{NoteId="other"},draft with{SessionId="other"},draft with{Revision=8},
        draft with{BaseNoteRevision=4},draft with{BaseSourceHash="new-base"},draft with{Title="新標題"},draft with{Source=draft.Source+"新內容"}})
        Check(!guard.CanLeave(newer,false),"a different identity/version/base/title/source is not acknowledged");

    guard.Defer(draft.NoteId,draft.SessionId);
    Check(guard.IsDeferred("note","session")&&!guard.IsDeferred("note","other"),"rename deferral belongs to one editing session");
    var saveResponse=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var next=draft with{Revision=8,Source=draft.Source+"\nnext"};
    async Task SaveCaptured(DurableDraftSnapshot captured) {await saveResponse.Task;guard.Acknowledge(captured);}
    var saving=SaveCaptured(next);
    var stillNewer=next with{Source=next.Source+" typed during save"};
    Check(!guard.CanLeave(next,false),"pending draft PUT cannot authorize leaving");
    saveResponse.SetResult();await saving;
    Check(!guard.CanLeave(stillNewer,false),"late acknowledgement cannot cover typing during its request");
    Check(guard.CanLeave(next,false)&&guard.IsDeferred("note","session"),"new confirmed draft can leave without silently submitting rename");
    guard.RequestSubmission("note","session");
    Check(!guard.IsDeferred("note","session"),"explicit submission re-enables semantic confirmation");

    guard.BeginOperation("op-1");
    Check(!guard.CanLeave(next,false),"unknown commit blocks even an acknowledged draft");
    guard.Acknowledge(stillNewer);
    Check(!guard.CanLeave(stillNewer,false),"a newer draft acknowledgement cannot resolve a pending semantic write");
    Throws(()=>guard.BeginOperation("op-2"),"must retry original operation identity");
    Throws(()=>guard.CompleteOperation("op-2","committed"),"unrelated response must not unblock departure");
    foreach(var status in new[]{"unknown","pending","unexpected"})
        Check(!guard.CompleteOperation("op-1",status)&&guard.PendingOperationId=="op-1"&&!guard.CanLeave(stillNewer,false),"nondefinitive response retains exact pending operation: "+status);
    guard.BeginOperation("op-1");
    Check(guard.PendingOperationId=="op-1","same-operation retry retains identity");
    guard.CompleteOperation("op-1","committed");
    Check(guard.CanLeave(stillNewer,false),"only a known response releases pending write guard");
    guard.ForgetAcknowledgement("note");
    Check(!guard.CanLeave(stillNewer,false),"consumed draft cannot continue serving as durability evidence");
    var reopened=new DraftDepartureGuard();reopened.Acknowledge(stillNewer);
    Check(reopened.CanLeave(stillNewer,false),"reloaded exact durable draft is recoverable without changing its base");
    Check(!reopened.IsDeferred("note","session"),"in-memory defer choice is not invented after restart");
    foreach(var status in new[]{"source-saved","confirmation-required","conflict","rejected","invalid","draft"})
    {
        reopened.BeginOperation("op-2");
        Check(reopened.CompleteOperation("op-2",status)&&reopened.PendingOperationId is null,"definitive response releases unknown operation guard: "+status);
    }
    reopened.EnterWorkspace("original");reopened.Acknowledge(stillNewer);reopened.Defer("note","session");
    reopened.EnterWorkspace("restored");
    Check(!reopened.CanLeave(stillNewer,false)&&!reopened.IsDeferred("note","session"),"restored workspace with identical note/session IDs cannot inherit acknowledgements or defer choices");
    reopened.Acknowledge(stillNewer);reopened.BeginOperation("restore-op");
    Throws(()=>reopened.EnterWorkspace("other"),"workspace switch cannot erase an unknown operation");
    Check(reopened.PendingOperationId=="restore-op","failed workspace switch preserves the pending operation identity");

    // Exercise the same writer acquisition used by Home: Keep is queued while
    // a blur commit owns the semaphore, not rejected from its temporary ID.
    foreach(var outcome in new[]{"confirmation-required","conflict","unknown","transport-failure"})
    {
        using var writer=new SemaphoreSlim(1,1);
        var queuedGuard=new DraftDepartureGuard();queuedGuard.Acknowledge(draft);
        var response=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task BlurCommitAsync()
        {
            await writer.WaitAsync();
            try
            {
                queuedGuard.BeginOperation("blur-op");
                await response.Task;
                if(outcome!="transport-failure")queuedGuard.CompleteOperation("blur-op",outcome);
                else throw new HttpRequestException("Controlled lost response");
            }
            catch(HttpRequestException) { /* Home's error boundary retains the exact request. */ }
            finally {queuedGuard.EndOperationAttempt();writer.Release();}
        }
        var blur=BlurCommitAsync();
        Check(queuedGuard.IsAttemptActive&&!queuedGuard.HasUnresolvedOperation,"active transport is not an unresolved-results banner");
        queuedGuard.Defer(draft.NoteId,draft.SessionId);
        async Task<bool> KeepAfterCurrentWriteAsync()
        {
            var resolved=await queuedGuard.AcquireWriterAsync(writer);
            try {return resolved&&queuedGuard.IsDeferred(draft.NoteId,draft.SessionId)&&queuedGuard.CanLeave(draft,false);}
            finally {writer.Release();}
        }
        var keeping=KeepAfterCurrentWriteAsync();
        Check(!keeping.IsCompleted,"Keep waits for the actual active blur writer: "+outcome);
        response.SetResult();await blur;
        var departed=await keeping;
        var terminal=outcome is "confirmation-required" or "conflict";
        Check(departed==terminal,"queued Keep uses settled outcome and acknowledged snapshot: "+outcome);
        Check(queuedGuard.HasUnresolvedOperation==!terminal,"only unknown/failed transport offers exact-operation retry: "+outcome);
        Check(writer.CurrentCount==1,"every queued path releases the writer: "+outcome);
        if(!departed)Check(queuedGuard.PendingOperationId=="blur-op","unknown outcome preserves the original operation identity");
    }
    // A conflict response resolves the commit attempt, not the stale draft's
    // original base. Deferral retains that base and does not accept external text.
    var conflictGuard=new DraftDepartureGuard();conflictGuard.Acknowledge(draft);
    conflictGuard.BeginOperation("conflicting-commit");
    Check(conflictGuard.CompleteOperation("conflicting-commit","conflict"),"a known conflict settles the attempted commit");
    conflictGuard.Defer(draft.NoteId,draft.SessionId);
    Check(conflictGuard.CanLeave(draft,false),"explicit conflict deferral permits the exact durable local version to leave");
    Check(!conflictGuard.CanLeave(draft,true),"conflict deferral never bypasses active IME");
    var externalBase=draft with {BaseNoteRevision=75,BaseSourceHash="external-source"};
    Check(!conflictGuard.CanLeave(externalBase,false),"deferral cannot silently accept a newer external base");
    var rightPane=draft with {Revision=8,Title="合併草稿標題",Source=draft.Source+"\n尚未確認的右側內容"};
    Check(!conflictGuard.CanLeave(rightPane,false),"right-pane work must receive its own durable acknowledgement");
    conflictGuard.Acknowledge(rightPane);
    Check(conflictGuard.CanLeave(rightPane,false)&&rightPane.BaseNoteRevision==draft.BaseNoteRevision&&rightPane.BaseSourceHash==draft.BaseSourceHash,
        "right-pane draft can be saved while retaining the original conflict base");
    var afterDeferral=rightPane with {Revision=9,Source=rightPane.Source+"\n稍後又新增"};
    Check(!conflictGuard.CanLeave(afterDeferral,false),"new local edits after Later cannot reuse an older acknowledgement");
    conflictGuard.Acknowledge(afterDeferral);
    Check(conflictGuard.CanLeave(afterDeferral,false)&&conflictGuard.IsDeferred("note","session"),"freshly saved edits can leave without auto-merging");
    conflictGuard.RequestSubmission("note","session");
    Check(!conflictGuard.IsDeferred("note","session"),"explicit Save after conflict deferral retries semantic conflict handling");
    Console.WriteLine($"Draft departure: {checks} bounded assertions passed.");
    return 0;
}
catch(Exception error) { return GraspPortable.TestSupport.ConsoleTestFailure.Report(error); }
