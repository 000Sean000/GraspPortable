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
        public Func<Task<OperationResult>>? Command;
        public Func<CancellationToken, Task<CollectionDto>>? Read;
        public async Task<T> GetAsync<T>(string url, CancellationToken cancellationToken = default)
        {
            object result;
            if (url == "api/records") result = new[] { new CollectionSummaryDto("collection", "note", "Table", 1, 1, Revision, false, "accepted") };
            else { Reads++; result = Read is null ? Data(Revision) : await Read(cancellationToken); }
            return (T)result;
        }
        public Task<OperationResult> CommandAsync(string url, object request, string operationId) =>
            Command?.Invoke() ?? Task.FromResult(new OperationResult(operationId, "committed", 11, "note"));
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
        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);
        public ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            object? result = identifier == "import" ? this : identifier == "begin" ? ++next : default(T);
            return ValueTask.FromResult((T)result!);
        }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
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
