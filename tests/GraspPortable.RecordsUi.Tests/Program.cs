using GraspPortable.App.Backend;
using GraspPortable.App.Records;
using GraspPortable.Contracts;

try
{
Environment.SetEnvironmentVariable("GRASP_MEASURE_UI", "1");
var passed = 0;
void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
async Task Run(string name, Func<Task> test) { await test().WaitAsync(TimeSpan.FromSeconds(5)); passed++; Console.WriteLine("PASS " + name); }
TaskCompletionSource<T> Gate<T>() => new(TaskCreationOptions.RunContinuationsAsynchronously);
(RecordsPanel Panel, BackendSession Backend) Setup()
{ var backend = new BackendSession(); var panel = new RecordsPanel(); panel.Prepare(backend); return (panel, backend); }

await Run("same revision during command and read-back retains commit epoch", async () =>
{
    var (panel, backend) = Setup();
    var response = Gate<OperationResult>(); var readEntered = Gate<bool>(); var read = Gate<CollectionDto>();
    backend.Command = () => response.Task;
    backend.Read = async token => { readEntered.TrySetResult(true); return await read.Task.WaitAsync(token); };
    var save = panel.SaveForTest();
    await panel.Notify(11); Check(backend.Reads == 0, "SSE before command must be deferred");
    response.SetResult(new("op", "committed", 11, "note"));
    await readEntered.Task;
    var epoch = panel.Epoch;
    await panel.Notify(11); Check(panel.Epoch == epoch, "echo cannot cancel read-back");
    read.SetResult(BackendSession.Data(11)); await save;
    Check(backend.Reads == 1 && panel.CommitQueued && panel.Applied == 11, "one read and valid commit span");
    await panel.Notify(11); await panel.Notify(10);
    Check(backend.Reads == 1 && panel.Epoch == epoch, "applied/older echo must not invalidate queued paint");
    await panel.DisposeAsync();
});
await Run("highest deferred revision is fetched after save", async () =>
{
    var (panel, backend) = Setup(); var entered = Gate<bool>(); var first = Gate<CollectionDto>();
    backend.Read = async token => { if (backend.Reads == 1) { entered.SetResult(true); return await first.Task.WaitAsync(token); } return BackendSession.Data(13); };
    var save = panel.SaveForTest(); await entered.Task;
    await panel.Notify(12); await panel.Notify(13); await panel.Notify(12);
    Check(backend.Reads == 1, "new notifications must coalesce during save");
    first.SetResult(BackendSession.Data(11)); await save;
    Check(backend.Reads == 2 && panel.Applied == 13, "highest update cannot be lost");
    var epoch = panel.Epoch; await panel.Notify(13);
    Check(panel.Epoch == epoch, "final revision echo must not reread"); await panel.DisposeAsync();
});
await Run("read-back already includes higher notification", async () =>
{
    var (panel, backend) = Setup(); var response = Gate<OperationResult>(); backend.Command = () => response.Task;
    var save = panel.SaveForTest(); await panel.Notify(14); backend.Revision = 14;
    response.SetResult(new("op", "committed", 11, "note")); await save;
    Check(backend.Reads == 1 && panel.Applied == 14 && panel.CommitQueued, "already applied highest revision needs no second read"); await panel.DisposeAsync();
});
await Run("conflict refresh preserves input and baseline", async () =>
{
    var (panel, backend) = Setup(); var response = Gate<OperationResult>(); backend.Command = () => response.Task;
    var save = panel.SaveForTest(); await panel.Notify(12); backend.Revision = 12;
    response.SetResult(new("op", "conflict", 12, "note")); await save;
    Check(panel.Applied == 12 && backend.Reads == 1 && panel.HasDialog && panel.Raw == "unsaved input" && panel.EditRevision == 10 && !panel.CommitQueued,
        "conflict must retain editor and old baseline"); await panel.DisposeAsync();
});
await Run("failed read-back cannot queue commit; deferred read repairs projection", async () =>
{
    var (panel, backend) = Setup(); var response = Gate<OperationResult>(); backend.Command = () => response.Task;
    backend.Read = _ => backend.Reads == 1 ? Task.FromException<CollectionDto>(new IOException("read failed")) : Task.FromResult(BackendSession.Data(11));
    var save = panel.SaveForTest(); await panel.Notify(11); response.SetResult(new("op", "committed", 11, "note")); await save;
    Check(backend.Reads == 2 && panel.Applied == 11 && !panel.CommitQueued, "repair query cannot inherit failed commit span"); await panel.DisposeAsync();
});
await Run("workspace switch rejects old response and clears old deferred revision", async () =>
{
    var (panel, backend) = Setup(); var response = Gate<OperationResult>(); backend.Command = () => response.Task;
    var save = panel.SaveForTest(); await panel.Notify(20); backend.Revision = 2;
    await panel.Notify(2, "other-workspace"); response.SetResult(new("op", "committed", 11, "note")); await save;
    Check(panel.Applied == 2 && backend.Reads == 1 && !panel.CommitQueued && panel.Raw == "unsaved input", "old workspace save must not refresh or overwrite new workspace");
    await panel.DisposeAsync();
});
await Run("unknown outcome retains operation input while newest projection is read", async () =>
{
    var (panel, backend) = Setup(); var response = Gate<OperationResult>(); backend.Command = () => response.Task;
    var save = panel.SaveForTest(); await panel.Notify(12); backend.Revision = 12;
    response.SetException(new IOException("response lost")); await save;
    Check(panel.UnknownOutcome && panel.HasDialog && panel.Raw == "unsaved input" && panel.EditRevision == 10 && panel.Applied == 12 && !panel.CommitQueued,
        "unknown outcome must remain protected after notification refresh"); await panel.DisposeAsync();
});
await Run("explicit query supersession still rejects the old commit span", async () =>
{
    var (panel, backend) = Setup(); var entered = Gate<bool>(); var first = Gate<CollectionDto>();
    backend.Read = async token => { if (backend.Reads == 1) { entered.SetResult(true); return await first.Task.WaitAsync(token); } return BackendSession.Data(12); };
    var save = panel.SaveForTest(); await entered.Task;
    await panel.ExplicitRefresh(); await save;
    Check(panel.Applied == 12 && backend.Reads == 2 && !panel.CommitQueued, "an independent query cannot inherit the superseded save span");
    await panel.DisposeAsync();
});
Console.WriteLine($"Records UI revision control: {passed} fixtures passed.");
return 0;
}
catch (Exception error) { Console.Error.WriteLine(error); return 1; }
