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
void CollectCommands(Action enqueue)
{
    var previous = SynchronizationContext.Current; var context = new QueuedRecordsContext();
    SynchronizationContext.SetSynchronizationContext(context);
    try { enqueue(); } finally { SynchronizationContext.SetSynchronizationContext(previous); }
    context.Drain();
}
(RecordsPanel Panel, BackendSession Backend) Setup()
{ var backend = new BackendSession(); var panel = new RecordsPanel(); panel.Prepare(backend); return (panel, backend); }
RecordFieldConversionPreview Conversion(PreviewRecordFieldConversionRequest request) => new(request.ExpectedKnowledgeRevision,
    true,"##### Converted\n\nbody","Heading",[new(0,8,0,14,1,5,0)],[],"preview-token",true);

await Run("Records module shares one import and waits for the last cell cleanup", async () =>
{
    var js = new DeferredRecordsJs(); var owner = new RecordsModuleOwner(js);
    var first = owner.Acquire(); var second = owner.Acquire();
    var parentLoad = owner.GetAsync(); var firstLoad = first.GetAsync(); var secondLoad = second.GetAsync();
    Check(js.Imports == 1 && ReferenceEquals(parentLoad, firstLoad) && ReferenceEquals(firstLoad, secondLoad), "all consumers share the same import task");
    js.Imported.SetResult(js.Module);
    Check(ReferenceEquals(await firstLoad, await secondLoad), "cells receive the same module");
    await first.DisposeAsync(); await first.DisposeAsync();
    Check(js.Module.Disposals == 0, "one cell cannot dispose the shared module");
    await owner.DisposeAsync();
    Check(js.Module.Disposals == 0 && ReferenceEquals(await second.GetAsync(), js.Module), "parent departure retains remaining cell cleanup access");
    await second.DisposeAsync(); await owner.DisposeAsync(); await second.DisposeAsync();
    Check(js.Module.Disposals == 1, "last release disposes once despite repeated releases");
});
await Run("Records parent departure does not await cells or lose an in-flight import", async () =>
{
    var js = new DeferredRecordsJs(); var owner = new RecordsModuleOwner(js); var cell = owner.Acquire();
    var loading = cell.GetAsync();
    var departing = owner.DisposeAsync();
    Check(departing.IsCompletedSuccessfully && !loading.IsCompleted, "parent must not wait for child lifecycle or import");
    await departing;
    var rejected = false; try { owner.Acquire(); } catch (ObjectDisposedException) { rejected = true; }
    Check(rejected, "closed parent prohibits new leases");
    rejected = false; try { _ = owner.GetAsync(); } catch (ObjectDisposedException) { rejected = true; }
    Check(rejected && ReferenceEquals(loading, cell.GetAsync()), "parent reads reject while a live cell can finish loading");
    var releasing = cell.DisposeAsync().AsTask();
    Check(!releasing.IsCompleted && js.Module.Disposals == 0, "last cell release owns the unfinished import");
    js.Imported.SetResult(js.Module); await releasing; await owner.DisposeAsync(); await cell.DisposeAsync();
    Check(js.Imports == 1 && js.Module.Disposals == 1, "late module is released exactly once");
});
await Run("Records owner releases an in-flight parent import without any cells", async () =>
{
    var js = new DeferredRecordsJs(); var owner = new RecordsModuleOwner(js);
    var loading = owner.GetAsync(); var departing = owner.DisposeAsync().AsTask();
    Check(!departing.IsCompleted, "owner must retain and await its own unfinished import");
    js.Imported.SetResult(js.Module); await loading; await departing; await owner.DisposeAsync();
    Check(js.Imports == 1 && js.Module.Disposals == 1, "parent-only late module is released once");
});
await Run("Records unused leases remain lazy and cannot read after release", async () =>
{
    var js = new DeferredRecordsJs(); var owner = new RecordsModuleOwner(js); var cell = owner.Acquire();
    await cell.DisposeAsync();
    var rejected = false; try { _ = cell.GetAsync(); } catch (ObjectDisposedException) { rejected = true; }
    await owner.DisposeAsync();
    Check(rejected && js.Imports == 0 && js.Module.Disposals == 0, "unused panel/leases import nothing and released cells stay closed");
});
await Run("Records failed import stays shared and cleanup has no reference to dispose", async () =>
{
    var js = new DeferredRecordsJs(); var owner = new RecordsModuleOwner(js); var cell = owner.Acquire();
    var loading = owner.GetAsync(); js.Imported.SetException(new IOException("import unavailable"));
    var failed = false; try { await loading; } catch (IOException) { failed = true; }
    Check(failed && ReferenceEquals(loading, cell.GetAsync()) && js.Imports == 1, "fault is cached until the panel is rebuilt");
    await owner.DisposeAsync(); await cell.DisposeAsync(); await owner.DisposeAsync();
    Check(js.Module.Disposals == 0, "faulted import cannot manufacture a module to dispose");
});
await Run("Records sibling cells batch 250 renders and 250 cleanups into one IPC each", async () =>
{
    var js = new DeferredRecordsJs(); js.Imported.SetResult(js.Module); var owner = new RecordsModuleOwner(js);
    var cells = Enumerable.Range(0, 250).Select(_ => owner.Acquire()).ToArray();
    Task[] rendering = [], cleaning = [];
    CollectCommands(() => rendering = cells.Select((cell, index) => cell.RenderAsync(default, "readable links", "origin", new { }, index + 1, [], [])).ToArray());
    await Task.WhenAll(rendering);
    Check(js.Imports == 1 && js.Module.Batches is [{ Length: 250 } first] && first.All(item => item.GetProperty("operation").GetString() == "render")
        && first.Select(item => item.GetProperty("generation").GetInt64()).SequenceEqual(Enumerable.Range(1, 250).Select(i => (long)i)),
        "one array argument retains all cell receivers/generations in one render IPC");
    CollectCommands(() => cleaning = cells.Select(cell => cell.DisposeMarkdownAsync(default)).ToArray());
    await Task.WhenAll(cleaning);
    Check(js.Module.Batches.Count == 2 && js.Module.Batches[1].Length == 250
        && js.Module.Batches[1].All(item => item.GetProperty("operation").GetString() == "dispose"), "cleanup is also one batch IPC");
    foreach (var cell in cells) await cell.DisposeAsync(); await owner.DisposeAsync();
    Check(js.Module.Disposals == 1, "batch completion still releases module exactly once");
});
await Run("Records pending newer generation and disposal supersede only their own cell", async () =>
{
    var js = new DeferredRecordsJs(); js.Imported.SetResult(js.Module); var owner = new RecordsModuleOwner(js);
    var retired = owner.Acquire(); var current = owner.Acquire(); Task first = null!, next = null!, cleanup = null!, sibling = null!;
    CollectCommands(() => {
        first = retired.RenderAsync(default, "old", "origin", new { }, 1, [], []);
        next = retired.RenderAsync(default, "new", "origin", new { }, 2, [], []);
        cleanup = retired.DisposeMarkdownAsync(default);
        sibling = current.RenderAsync(default, "sibling", "origin", new { }, 3, [], []);
    });
    await Task.WhenAll(first, next, cleanup, sibling);
    Check(js.Module.Batches is [{ Length: 2 } batch] && batch.Count(item => item.GetProperty("operation").GetString() == "dispose") == 1
        && batch.Single(item => item.GetProperty("operation").GetString() == "render").GetProperty("generation").GetInt64() == 3,
        "retired renders do not bind and sibling render remains present");
    var rejected = false;
    try { _ = retired.RenderAsync(default, "late", "origin", new { }, 4, [], []); } catch (ObjectDisposedException) { rejected = true; }
    Check(rejected, "cleanup prevents later enqueue from resurrecting the element");
    await retired.DisposeAsync(); await current.DisposeMarkdownAsync(default); await current.DisposeAsync(); await owner.DisposeAsync();
});
await Run("Records in-flight render finishes before cleanup and the last lease release", async () =>
{
    var js = new DeferredRecordsJs(); js.Imported.SetResult(js.Module); var reply = Gate<bool[]>();
    js.Module.BatchReply = count => js.Module.Batches.Count == 1 ? reply.Task : Task.FromResult(Enumerable.Repeat(true, count).ToArray());
    var owner = new RecordsModuleOwner(js); var cell = owner.Acquire(); Task rendering = null!;
    CollectCommands(() => rendering = cell.RenderAsync(default, "render", "origin", new { }, 1, [], []));
    var cleanup = cell.DisposeMarkdownAsync(default); var releasing = cell.DisposeAsync().AsTask();
    await owner.DisposeAsync();
    Check(js.Module.Batches.Count == 1 && !cleanup.IsCompleted && !releasing.IsCompleted && js.Module.Disposals == 0,
        "queued cleanup retains module until already-sent render returns");
    reply.SetResult([true]); await rendering; await cleanup; await releasing;
    Check(js.Module.Batches.Count == 2 && js.Module.Batches[1].Single().GetProperty("operation").GetString() == "dispose"
        && js.Module.Disposals == 1, "cleanup follows render on the same single pump before final release");
});
await Run("Records per-cell batch failure does not fail sibling completion or lifetime cleanup", async () =>
{
    var js = new DeferredRecordsJs(); js.Imported.SetResult(js.Module); var owner = new RecordsModuleOwner(js);
    js.Module.BatchReply = count => Task.FromResult(Enumerable.Range(0, count).Select(index => index != 0).ToArray());
    var failed = owner.Acquire(); var good = owner.Acquire(); Task bad = null!, okay = null!;
    CollectCommands(() => { bad = failed.RenderAsync(default, "bad", "origin", new { }, 1, [], []); okay = good.RenderAsync(default, "good", "origin", new { }, 2, [], []); });
    var rejected = false; try { await bad; } catch (Microsoft.JSInterop.JSException) { rejected = true; }
    await okay; Check(rejected && okay.IsCompletedSuccessfully, "failure is reported only to its own cell");
    await owner.DisposeAsync(); await failed.DisposeAsync(); await good.DisposeAsync();
    Check(js.Module.Disposals == 1, "faulted cell completion cannot leak the last lease");
});
if (args.Contains("module-owner", StringComparer.Ordinal))
{ Console.WriteLine($"Records module owner: {passed} fixtures passed."); return 0; }

await Run("field conversion writes only after explicit approval and sends original source",async()=>
{
    var (panel,backend)=Setup();backend.ConversionPreview=r=>Task.FromResult(Conversion(r));
    panel.EditConversionForTest("# Title\n\noriginal body");await panel.SaveForTest();
    Check(panel.HasConversionForTest && backend.PreviewReads==1 && backend.Writes.Count==0 && !panel.HasPendingForTest,"read-only preview cannot create a pending write");
    await panel.SaveForTest();Check(backend.Writes.Count==0,"plain submit cannot bypass visible conversion approval");
    await panel.ConfirmConversionForTest();
    Check(backend.LastRequest is RecordFieldChangeRequest {RawSource:"# Title\n\noriginal body",ConversionToken:"preview-token"}
        && backend.Writes.Count==1,"approved request preserves original source, not converted preview");await panel.DisposeAsync();
});
await Run("field conversion becomes invalid after edits, null, revision or workspace changes",async()=>
{
    foreach(var change in new[]{"raw","null","revision","workspace","return"})
    {
        var (panel,backend)=Setup();backend.ConversionPreview=r=>Task.FromResult(Conversion(r));
        await panel.SaveForTest();
        if(change=="raw")panel.EditConversionForTest("new input");
        else if(change=="null")panel.EditConversionForTest(isNull:true);
        else if(change=="revision")await panel.Notify(12);
        else if(change=="workspace")await panel.Notify(12,"other-workspace");
        else panel.ReturnFromConversionForTest();
        await panel.ConfirmConversionForTest();
        Check(!panel.HasConversionForTest && backend.Writes.Count==0 && !panel.HasPendingForTest,"old preview cannot authorize a write after "+change);
        Check(panel.Raw==(change=="raw"?"new input":"unsaved input"),"invalidated preview preserves input");await panel.DisposeAsync();
    }
});
await Run("late field conversion preview is dropped and unavailable preview never creates unknown write",async()=>
{
    var (panel,backend)=Setup();var response=Gate<RecordFieldConversionPreview>();backend.ConversionPreview=_=>response.Task;
    var saving=panel.SaveForTest();panel.EditConversionForTest("new while awaiting preview");
    response.SetResult(Conversion(new(10,"old")));await saving;
    Check(!panel.HasConversionForTest && backend.Writes.Count==0 && panel.Raw=="new while awaiting preview","late preview must not replace newer editor state");
    backend.ConversionPreview=r=>Task.FromResult(Conversion(r) with{CanApply=false});await panel.SaveForTest();
    Check(!panel.HasPendingForTest && !panel.UnknownOutcome && backend.Writes.Count==0,"rejected read-only preview cannot become unknown write");
    backend.ConversionPreview=_=>Task.FromException<RecordFieldConversionPreview>(new IOException("preview read unavailable"));await panel.SaveForTest();
    Check(!panel.HasPendingForTest && !panel.UnknownOutcome,"failed preview is safely retryable as a read");await panel.DisposeAsync();
});
await Run("field conversion unknown and rename retries retain same approved payload",async()=>
{
    foreach(var status in new[]{"unknown","confirmation-required"})
    {
        var (panel,backend)=Setup();backend.ConversionPreview=r=>Task.FromResult(Conversion(r));
        backend.Command=()=>Task.FromResult(new OperationResult("op",backend.Writes.Count==1?status:"committed",11,"note"));
        await panel.SaveForTest();await panel.ConfirmConversionForTest();
        Check(panel.HasPendingForTest && backend.PreviewReads==1 && backend.Writes.Count==1,"first command preserves approved request for "+status);
        if(status=="unknown")await panel.SaveForTest();else await panel.ConfirmRenameForTest();
        var first=(RecordFieldChangeRequest)backend.Writes[0];var retried=(RecordFieldChangeRequest)backend.Writes[1];
        Check(first.OperationId==retried.OperationId && first.RawSource==retried.RawSource && first.ConversionToken==retried.ConversionToken
            && backend.PreviewReads==1 && retried.ConfirmRename==(status=="confirmation-required"),"retry cannot rotate operation, raw source or conversion approval");await panel.DisposeAsync();
    }
});

await Run("Records end forwards the queued DOM token and rejects missing token", async () =>
{
    var (panel, _) = Setup();
    var guarded = await panel.EndGuardForTest(true);
    using var json = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(guarded[2]));
    Check(guarded[1] is true && json.RootElement.GetProperty("attribute").GetString() == "data-records-paint-token"
        && !string.IsNullOrEmpty(json.RootElement.GetProperty("token").GetString())
        && !string.IsNullOrEmpty(json.RootElement.GetProperty("rootId").GetString()), "queued state must reach both final rAF callbacks");
    var unqueued = await panel.EndGuardForTest(false);
    Check(unqueued[1] is false && unqueued[2] is null, "missing token cannot be accepted by the shared probe");
    await panel.DisposeAsync();
});
await Run("Records query phases accompany one successful guarded end IPC", async () =>
{
    var (panel, _) = Setup(); await panel.ExplicitRefresh(); await panel.FinishQueryForTest();
    var end = panel.EndCallsForTest.Single();
    using var phases = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(end[3]));
    var properties = phases.RootElement.EnumerateObject().ToArray();
    Check(end[1] is true && end[2] is not null && properties.Select(p => p.Name).SequenceEqual(new[] {
        "listHttpMs", "collectionHttpMs", "applyToChildrenReadyMs" }) && properties.All(p => p.Value.TryGetDouble(out var ms) && double.IsFinite(ms) && ms >= 0),
        "successful query sends exactly three nonnegative numeric durations, with no additional IPC/content");
    await panel.DisposeAsync();
});
await Run("Records query phases are absent for failed ready barrier, changed token and failed HTTP", async () =>
{
    foreach (var failure in new[] { "children", "token", "http" })
    {
        var (panel, backend) = Setup();
        if (failure == "http") backend.Read = _ => Task.FromException<CollectionDto>(new IOException("detail unavailable"));
        await panel.ExplicitRefresh();
        if (failure == "token") panel.InvalidateQueryPaintForTest();
        if (failure != "http") await panel.FinishQueryForTest(failure != "children");
        Check(panel.EndCallsForTest is [{ } end] && end[1] is false && end[2] is null && end[3] is null,
            "rejected query cannot attach successful diagnostics after " + failure);
        await panel.DisposeAsync();
    }
});
await Run("Records superseded query cannot inherit the newest query phases", async () =>
{
    var (panel, backend) = Setup(); var old = Gate<CollectionDto>();
    backend.Read = _ => backend.Reads == 1 ? old.Task : Task.FromResult(BackendSession.Data(12));
    var first = panel.ExplicitRefresh(); await panel.ExplicitRefresh();
    old.SetResult(BackendSession.Data(11)); await first; await panel.FinishQueryForTest();
    var ends = panel.EndCallsForTest;
    Check(ends.Length == 2 && ends.Count(e => e[1] is true && e[3] is not null) == 1
        && ends.Count(e => e[1] is false && e[3] is null) == 1 && panel.Applied == 12,
        "only the still-current successful load gets phases");
    await panel.DisposeAsync();
});
if (args.Contains("performance-guard", StringComparer.Ordinal))
{ Console.WriteLine($"Records UI performance: {passed} fixtures passed."); return 0; }

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
await Run("field save sends empty identity for creation and stable identity for update", async () =>
{
    foreach (var existing in new[] { false, true })
    {
        var (panel, backend) = Setup(); panel.OpenFieldForTest(existing); await panel.SaveForTest();
        Check(backend.LastRequest is UpsertRecordFieldRequest request
            && request.Field.Id == (existing ? "field" : "") && !string.IsNullOrEmpty(request.OperationId),
            "actual Save command must let Host derive new identity while retaining existing field ID");
        await panel.DisposeAsync();
    }
});
await Run("tag search encodes text, pages totals and opens fresh record identity", async () =>
{
    var (panel, backend) = Setup(); var recordId = Guid.NewGuid().ToString("N");
    var hit = new RecordTagMatchDto("collection", "Other table", "note", recordId, "Other.Record", "Target", "tagfield", "Tags", ["中文 & tag"], true);
    backend.TagRead = (url, _) => Task.FromResult(new RecordTagSearchDto(11, url.Contains("offset=50") ? 50 : 0, 50, 51, 2,
        url.Contains("offset=50") ? [hit] : Enumerable.Range(0, 50).Select(index => hit with { FieldId = "field" + index }).ToArray()));
    await panel.OpenTagsForTest(); await panel.SearchTagsForTest("中文 & tag");
    Check(backend.TagUrls.Last().Contains("search=" + Uri.EscapeDataString("中文 & tag")) && panel.TagsForTest?.Total == 51
        && panel.TagsForTest.UnavailableCollections == 2 && panel.TagsForTest.Items[0].HasDraft, "encoded query retains total/exclusion/draft metadata");
    await panel.NextTagsForTest(); Check(panel.TagsForTest?.Offset == 50 && panel.TagsForTest.Items.Length == 1, "second page is not silently capped at 50");
    backend.Read = _ => Task.FromResult(BackendSession.Data(11) with {
        Rows = [new(recordId, "Fresh.Key", "Fresh title", [])], RelationChoices = [new(recordId, "Fresh.Key", "Fresh title", "collection")] });
    await panel.OpenTagForTest(hit);
    Check(panel.CardIdForTest == recordId && backend.Reads == 1, "tag result navigates through fresh record ID lookup"); await panel.DisposeAsync();
});
await Run("tag query ignores superseded and closed late responses", async () =>
{
    var (panel, backend) = Setup(); var old = Gate<RecordTagSearchDto>();
    backend.TagRead = (_, _) => backend.TagUrls.Count == 1 ? old.Task : Task.FromResult(new RecordTagSearchDto(11, 0, 50, 7, 0, []));
    var initial = panel.OpenTagsForTest(); await panel.SearchTagsForTest("new");
    old.SetResult(new(11, 0, 50, 99, 0, [])); await initial;
    Check(panel.TagsForTest?.Total == 7, "late obsolete search cannot replace newest result");
    var late = Gate<RecordTagSearchDto>(); backend.TagRead = (_, _) => late.Task;
    var pending = panel.SearchTagsForTest("closing"); panel.CloseTagsForTest(); late.SetResult(new(11, 0, 50, 88, 0, [])); await pending;
    Check(!panel.HasDialog && panel.TagsForTest is null, "closed search cannot be resurrected by late response"); await panel.DisposeAsync();
});
await Run("SSE restarts in-flight tag query and workspace switch rejects old results", async () =>
{
    var (panel, backend) = Setup(); var old = Gate<RecordTagSearchDto>();
    backend.TagRead = (_, _) => backend.TagUrls.Count == 1 ? old.Task : Task.FromResult(new RecordTagSearchDto(12, 0, 50, 12, 0, []));
    var initial = panel.OpenTagsForTest(); backend.Revision = 12; await panel.Notify(12);
    old.SetResult(new(11, 0, 50, 11, 0, [])); await initial;
    Check(panel.TagsForTest?.Revision == 12 && backend.TagUrls.Count == 2, "SSE replaces initial query even before any results exist");
    await panel.Notify(12); Check(backend.TagUrls.Count == 2, "same revision echo does not query tags again");
    var late = Gate<RecordTagSearchDto>(); backend.TagRead = (_, _) => late.Task;
    var pending = panel.SearchTagsForTest("old workspace"); backend.Revision = 2; await panel.Notify(2, "other");
    late.SetResult(new(12, 0, 50, 90, 0, [])); await pending;
    Check(panel.TagsForTest is null && backend.TagUrls.Count == 3, "old workspace reply is dropped without querying new workspace under old dialog"); await panel.DisposeAsync();
});
await Run("tag search cannot replace a dirty editor", async () =>
{
    var (panel, backend) = Setup(); await panel.OpenTagsForTest(false);
    Check(backend.TagUrls.Count == 0 && panel.HasDialog && panel.Raw == "unsaved input" && panel.EditRevision == 10,
        "search entry keeps dirty input and baseline untouched"); await panel.DisposeAsync();
});
Console.WriteLine($"Records UI: {passed} fixtures passed.");
return 0;
}
catch (Exception error) { Console.Error.WriteLine(error); return 1; }
