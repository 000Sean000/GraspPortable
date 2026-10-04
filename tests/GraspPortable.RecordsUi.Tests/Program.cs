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
await Run("exact numeric display bounds expansion without rounding", () =>
{
    (string Coefficient, int Scale, string Display)[] cases = [
        ("425", 1, "42.5"), ("0", 0, "0"), ("-000", 9000, "0"), ("1200", 3, "1.2"),
        ("-425", 1, "-42.5"), ("1", 4, "0.0001"), ("+00120", -2, "12000"),
        ("9007199254740993", 0, "9007199254740993"), ("1234567890123456789", 9, "1234567890.123456789"),
        ("1", -63, "1" + new string('0', 63)), ("1", -64, "1e64"), ("123", 10000, "1.23e-9998"),
        ("1", int.MinValue, "1e2147483648"), ("1", int.MaxValue, "1e-2147483647")
    ];
    foreach (var item in cases) Check(RecordsPanel.FormatNumber(item.Coefficient, item.Scale) == item.Display, $"number {item.Coefficient}/{item.Scale}");
    var significant = new string('7', 80);
    Check(RecordsPanel.FormatNumber(significant, 0) == "7." + significant[1..] + "e79", "scientific keeps all significant digits");
    return Task.CompletedTask;
});
await Run("table card and editor share display but preserve raw and managed references", async () =>
{
    var (panel, _) = Setup();
    var cell = new RecordCellDto("field", "425e-1", "425e-1", false, "Valid", true,
        new("Number", false, Coefficient: "425", Scale: 1), []);
    var value = panel.NumberPresentation(cell);
    Check(value.Input == "42.5" && value.Preview == "42.5" && value.Raw == "425e-1" && !value.Managed && !value.SourceMode,
        "direct numeric display cannot mutate raw or use scientific input");
    var reference = cell with { RawSource = "[425e-1](:ref:Price)", References = [new("note", "Price", "Inline", "425e-1", 0, 22, 1, 6)] };
    var linked = panel.NumberPresentation(reference);
    Check(linked.Managed && linked.SourceMode && linked.Raw == reference.RawSource, "numeric reference remains managed and source-editable");
    Check(panel.NumberPresentation(cell with { Regions = [new(0, 7, true)] }).Managed, "definition region must not be flattened");
    await panel.DisposeAsync();
});
await Run("numeric display and canonical forms remain searchable and filterable", async () =>
{
    var (panel, _) = Setup();
    panel.NumberPresentation(new("field", "425e-1", "425e-1", false, "Valid", true,
        new("Number", false, Coefficient: "425", Scale: 1), []));
    foreach (var text in new[] { "42.5", "425e-1" })
    {
        Check(panel.MatchingRows(text) == 1, "general search must accept " + text);
        Check(panel.MatchingRows(text, "equals") == 1, "text equality must accept " + text);
        Check(panel.MatchingRows(text, "contains") == 1, "text containment must accept " + text);
    }
    Check(panel.MatchingRows("42", "equals") == 0 && panel.MatchingRows("42", "contains") == 1,
        "equality remains textual equality, not substring matching");
    Check(panel.Raw == "425e-1", "search/filter cannot rewrite canonical source");
    await panel.DisposeAsync();
});
Console.WriteLine($"Records UI: {passed} fixtures passed.");
return 0;
}
catch (Exception error) { Console.Error.WriteLine(error); return 1; }
