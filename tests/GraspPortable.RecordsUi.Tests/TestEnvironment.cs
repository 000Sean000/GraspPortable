using GraspPortable.Contracts;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

// Compile the real panel control flow with a deterministic transport, without MAUI or a browser.
namespace GraspPortable.App.Backend
{
    public sealed class BackendSession
    {
        public bool Connected => true;
        public WorkspaceInfo? Workspace => null;
        public string WorkspacePath => "unused";
        public long Revision = 11;
        public int Reads;
        public object? LastRequest;
        public int PreviewReads;
        public List<object> Writes { get; } = [];
        public Func<PreviewRecordFieldConversionRequest,Task<RecordFieldConversionPreview>>? ConversionPreview;
        public List<string> TagUrls { get; } = [];
        public Func<string, CancellationToken, Task<RecordTagSearchDto>>? TagRead;
        public Func<Task<OperationResult>>? Command;
        public Func<CancellationToken, Task<CollectionDto>>? Read;
        public async Task<T> GetAsync<T>(string url, CancellationToken cancellationToken = default)
        {
            object result;
            if (url.StartsWith("api/records/tags?", StringComparison.Ordinal))
            { TagUrls.Add(url); result = await TagRead!(url, cancellationToken); }
            else if (url == "api/records") result = new[] { new CollectionSummaryDto("collection", "note", "Table", 1, 1, Revision, false, "accepted") };
            else { Reads++; result = Read is null ? Data(Revision) : await Read(cancellationToken); }
            return (T)result;
        }
        public Task<OperationResult> CommandAsync(string url, object request, string operationId)
        {
            LastRequest = request;
            Writes.Add(request);
            return Command?.Invoke() ?? Task.FromResult(new OperationResult(operationId, "committed", 11, "note"));
        }
        public async Task<T> SendAsync<T>(HttpMethod method,string url,object? body,CancellationToken token=default)
        {
            if(method!=HttpMethod.Post || !url.EndsWith("/conversion-preview") || body is not PreviewRecordFieldConversionRequest request)
                throw new InvalidOperationException("Unexpected preview transport");
            PreviewReads++;
            object preview=ConversionPreview is null
                ? new RecordFieldConversionPreview(request.ExpectedKnowledgeRevision,false,request.RawSource,"Heading",[],[],null,true)
                : await ConversionPreview(request);
            return (T)preview;
        }
        public static CollectionDto Data(long revision) => new("collection", "note", "Table", revision, revision, "accepted", false,
            [new("field", "Text", "Text", "Markdown")],
            [new("row", "Row", "Row", [new("field", "saved", "saved", false, "Valid", true, null, [])])], [], [], []);
    }
}
namespace GraspPortable.App.Records
{
    public partial class RecordsPanel : ComponentBase
    {
        public void Prepare(Backend.BackendSession backend)
        {
            Backend = backend; JS = new FakeJs();
            WorkspaceKey = _workspace = "workspace"; Revision = _observedRevision = 10;
            _data = global::GraspPortable.App.Backend.BackendSession.Data(10); _selected = _data.Id; _view = DefaultView(_data);
            ShowCell(_data.Rows[0], _data.Fields[0]); _raw = "unsaved input";
        }
        public Task SaveForTest() => SaveAsync();
        public Task ConfirmConversionForTest() => ConfirmFieldConversionAsync();
        public Task ConfirmRenameForTest() => SaveAsync(true);
        public bool HasConversionForTest => HasConversionPreview;
        public bool HasPendingForTest => _pending is not null;
        public void EditConversionForTest(string? source=null,bool? isNull=null)
        { if(source is not null)_raw=source;if(isNull is not null)_null=isNull.Value;InvalidateFieldConversion(); }
        public void ReturnFromConversionForTest()=>ReturnFromFieldConversion();
        public void OpenFieldForTest(bool existing) => ShowField(existing ? _data!.Fields[0] : null);
        public async Task Notify(long revision, string? workspace = null)
        { Revision = revision; if (workspace is not null) WorkspaceKey = workspace; await OnParametersSetAsync(); }
        public Task ExplicitRefresh() => RefreshAsync();
        public long Applied => _data?.Revision ?? -1;
        public long Epoch => _loadEpoch;
        public string Raw => _raw;
        public long EditRevision => _editRevision;
        public bool HasDialog => _dialog is not null;
        public bool UnknownOutcome => _unknownOutcome;
        public bool CommitQueued => _recordsPerformanceSpans.Values.Any(span => span.MinimumRevision is not null);
        public async Task<object?[]> EndGuardForTest(bool queued)
        {
            var id = await BeginRecordPerformanceAsync("guard-fixture");
            if (queued) QueueRecordPerformance(id, _loadEpoch);
            await EndRecordPerformanceAsync(id, true);
            return ((FakeJs)JS).LastEnd!;
        }
        public Task OpenTagsForTest(bool discard = true) { if (discard) CloseDialog(true); return ShowTagsAsync(); }
        public Task SearchTagsForTest(string text) { _tagSearch = text; return SubmitTagsAsync(); }
        public Task NextTagsForTest() => PageTagsAsync(1);
        public RecordTagSearchDto? TagsForTest => _tagResults;
        public Task OpenTagForTest(RecordTagMatchDto item) => OpenTagResultAsync(item);
        public void CloseTagsForTest() => CloseDialog();
        public string? CardIdForTest => _dialog == "card" ? _card?.Id : null;
        public int MatchingRows(string text, string? filterOperator = null)
        {
            _search = filterOperator is null ? text : "";
            _view = DefaultView(_data!) with { Filters = filterOperator is null ? [] : [new("field", filterOperator, text)] };
            return FilteredRows().Length;
        }
        public (string Input, string Preview, string Raw, bool Managed, bool SourceMode) NumberPresentation(RecordCellDto cell)
        {
            var field = new RecordFieldSchemaDto("field", "Number", "Number", "Number");
            var row = new RecordRowDto("row", "Row", "Row", [cell]);
            _data = _data! with { Fields = [field], Rows = [row] };
            ShowCell(row, field);
            return (_number, Preview(cell), _raw, RenderManagedCell(field, cell), _sourceMode);
        }
    }
    internal sealed class FakeJs : IJSRuntime, IJSObjectReference
    {
        private int next;
        public object?[]? LastEnd;
        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);
        public ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            if (identifier == "end") LastEnd = args;
            object? result = identifier == "import" ? this : identifier == "begin" ? ++next : default(T);
            return ValueTask.FromResult((T)result!);
        }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
    internal sealed class DeferredRecordsJs : IJSRuntime
    {
        public int Imports { get; private set; }
        public TaskCompletionSource<IJSObjectReference> Imported { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public CountingRecordsModule Module { get; } = new();
        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);
        public ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            if (identifier != "import" || args is not ["./Records/RecordsPanel.razor.js"])
                throw new InvalidOperationException("Unexpected Records module import");
            Imports++;
            return new(Complete<T>());
        }
        private async Task<T> Complete<T>() => (T)(object)await Imported.Task;
    }
    internal sealed class CountingRecordsModule : IJSObjectReference
    {
        public int Disposals { get; private set; }
        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => ValueTask.FromResult(default(T)!);
        public ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken cancellationToken, object?[]? args) => InvokeAsync<T>(identifier, args);
        public ValueTask DisposeAsync() { Disposals++; return ValueTask.CompletedTask; }
    }
}
namespace Microsoft.Maui.ApplicationModel
{
    public sealed class Launcher
    { public static Launcher Default { get; } = new(); public Task OpenAsync(Uri uri) => Task.CompletedTask; }
}
namespace GraspPortable.App.PlatformServices
{
    public static class WorkspaceFileLauncher
    { public static Task OpenAttachmentAsync(string workspace, string path) => Task.CompletedTask; }
}
