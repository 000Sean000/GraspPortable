using System.Globalization;
using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;
using GraspPortable.App.Backend;
using GraspPortable.Contracts;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace GraspPortable.App.Records;

public partial class RecordsPanel : IAsyncDisposable
{
    [Inject] private BackendSession Backend { get; set; } = default!;
    [Inject] private IJSRuntime JS { get; set; } = default!;
    private IJSObjectReference? _module;
    private DotNetObjectReference<RecordsPanel>? _receiver;
    private readonly string _modalId = "records-modal-" + Guid.NewGuid().ToString("N");
    [Parameter] public CollectionDto? Collection { get; set; }
    [Parameter] public string InitialCollectionId { get; set; } = "";
    [Parameter] public string InitialRecordId { get; set; } = "";
    [Parameter] public EventCallback<string> InitialRecordHandled { get; set; }
    [Parameter] public string WorkspaceKey { get; set; } = "";
    [Parameter] public long Revision { get; set; }
    [Parameter] public EventCallback<string> OnOpenSource { get; set; }
    [Parameter] public EventCallback<RecordsContentNavigation> OnNavigate { get; set; }
    [Parameter] public EventCallback<string> SelectedCollectionChanged { get; set; }
    private CollectionSummaryDto[] _collections = [];
    private CollectionDto? _data;
    private RecordViewDto? _view;
    private string _selected = "", _workspace = "", _search = "";
    private string _appliedInitialCollectionId = "";
    private string? _reportedCollectionId;
    private string _appliedInitialRecordId = "", _relationSearch = "";
    private long _recordNavigationGeneration;
    private long _observedRevision = -1, _deferredRevision = -1, _loadEpoch;
    private CancellationTokenSource? _load;
    private bool _busy, _loading, _disposed;
    private string? _error, _notice, _dialog, _dialogWarning;
    private string _dialogWorkspace = "", _initialDialog = "";
    private long _editRevision;
    private int _page;
    private const int PageSize = 50;
    private RecordRowDto? _row, _card;
    private RecordFieldSchemaDto? _field;
    private RecordCellDto? _cell;
    private string _key = "", _label = "", _kind = "Markdown", _raw = "", _number = "", _date = "", _tags = "";
    private bool _null, _boolean, _sourceMode, _confirmDiscard, _needsConfirmation, _conflict, _unknownOutcome;
    private readonly HashSet<string> _selectedIds = new(StringComparer.Ordinal);
    private List<OptionEdit> _options = [];
    private List<ColumnEdit> _columns = [];
    private List<SortEdit> _sorts = [];
    private List<FilterEdit> _filters = [];
    private string _viewId = "", _viewName = "", _viewSearch = "";
    private int _frozenRows, _frozenColumns;
    private PendingWrite? _pending;
    private ElementReference _firstInput;
    private bool _focusFirst;
    private static readonly (string Kind, string Name)[] Kinds = [
        ("Markdown", "文字 / Markdown"), ("Number", "精確數字"), ("Boolean", "布林"), ("Date", "日期"),
        ("SingleSelect", "單選"), ("MultiSelect", "多選"), ("Tag", "標籤"), ("SingleRelation", "單筆關聯"), ("MultiRelation", "多筆關聯")];
    private sealed class OptionEdit { public string Id { get; set; } = Guid.NewGuid().ToString("N"); public string Label { get; set; } = ""; }
    private sealed class ColumnEdit { public string Id { get; set; } = ""; public string Label { get; set; } = ""; public bool Visible { get; set; } }
    private sealed class SortEdit { public string FieldId { get; set; } = ""; public bool Descending { get; set; } }
    private sealed class FilterEdit { public string FieldId { get; set; } = ""; public string Operator { get; set; } = "contains"; public string Value { get; set; } = ""; }
    private sealed record PendingWrite(string Url, string OperationId, object Request, object ConfirmedRequest);

    protected override async Task OnParametersSetAsync()
    {
        var changed = _workspace != WorkspaceKey;
        if (changed)
        {
            CancelTagQuery(); _tagResults = null;
            _workspace = WorkspaceKey; _selected = ""; _data = null; _view = null; _collections = []; _page = 0; _search = "";
            _observedRevision = -1; _deferredRevision = -1;
            _appliedInitialCollectionId = "";
            _reportedCollectionId = null;
            _appliedInitialRecordId = ""; _recordNavigationGeneration++;
            if (_dialog is not null) _dialogWarning = "工作區已切換；這份輸入仍保留，請先複製或取消，不能送到另一個工作區。";
        }
        var collectionChanged = Collection is not null && Collection.Id != _selected;
        if (collectionChanged) _selected = Collection!.Id;
        var recordRequest = InitialRecordId.Length > 0 && InitialRecordId != _appliedInitialRecordId ? InitialRecordId : null;
        _appliedInitialRecordId = InitialRecordId;
        var requestWorkspace = WorkspaceKey;
        var requested = InitialCollectionId != _appliedInitialCollectionId;
        if (requested)
        {
            _appliedInitialCollectionId = InitialCollectionId;
            if (InitialCollectionId.Length > 0) { _selected = InitialCollectionId; _view = null; _page = 0; _search = ""; }
        }
        var revisionChanged = Revision > _observedRevision;
        _observedRevision = Math.Max(_observedRevision, Revision);
        InvalidateChangedFieldConversion();
        if (changed || requested || collectionChanged) await RefreshAsync();
        else if (_busy && _dialogWorkspace == WorkspaceKey)
        {
            // An SSE echo must not cancel the explicit read-back owned by SaveAsync.
            // Retain newer notifications even if they arrive before the command response.
            if (Revision > (_data?.Revision ?? -1)) _deferredRevision = Math.Max(_deferredRevision, Revision);
        }
        else if (_data is null || revisionChanged && Revision > _data.Revision) await RefreshAsync();
        if (recordRequest is not null && !_disposed && requestWorkspace == WorkspaceKey && InitialRecordId == recordRequest)
        {
            try { await OpenRecordByIdAsync(recordRequest); }
            finally
            {
                if (!_disposed && requestWorkspace == WorkspaceKey && InitialRecordId == recordRequest)
                    await InitialRecordHandled.InvokeAsync(recordRequest);
            }
        }
        await RefreshTagRevisionAsync();
    }
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (_disposed) return;
        var renderedSequence = ++_recordsRenderSequence;
        _module ??= await JS.InvokeAsync<IJSObjectReference>("import", "./Records/RecordsPanel.razor.js");
        if (_disposed) return;
        _receiver ??= DotNetObjectReference.Create(this);
        await _module.InvokeVoidAsync("syncModal", _modalId, _receiver);
        if (_focusFirst)
        {
            _focusFirst = false;
            try { await _firstInput.FocusAsync(); } catch (InvalidOperationException) { }
        }
        await FinishRenderedRecordPerformanceAsync(renderedSequence);
    }
    private async Task RefreshAsync()
    {
        if (!Backend.Connected || _disposed) return;
        _load?.Cancel(); _load?.Dispose(); _load = new();
        var token = _load.Token; var epoch = ++_loadEpoch; var workspace = WorkspaceKey;
        var performance = 0; var performanceQueued = false;
        _loading = true;
        try
        {
            performance = await BeginRecordPerformanceAsync("recordsQueryToPaintOpportunity");
            var list = await Backend.GetAsync<CollectionSummaryDto[]>("api/records", token);
            var id = list.Any(c => c.Id == _selected) ? _selected : list.FirstOrDefault()?.Id ?? "";
            var data = id.Length == 0 ? null : await Backend.GetAsync<CollectionDto>("api/records/" + id, token);
            if (epoch != _loadEpoch || token.IsCancellationRequested || _disposed || workspace != WorkspaceKey) return;
            var previousId = _data?.Id; _collections = list; _selected = id; _data = data;
            if (data is not null && (_view is null || previousId != data.Id))
            { _view = data.Views.FirstOrDefault() ?? DefaultView(data); _search = _view.Search; _page = 0; }
            else if (data is not null && string.IsNullOrEmpty(_view?.Id)) _view = DefaultView(data);
            if (_dialog == "card" && _card is not null)
            {
                _card = data?.Rows.FirstOrDefault(r => r.Id == _card.Id);
                if (_card is null) { _dialog = null; _notice = "這筆紀錄已不在目前資料表中。"; }
            }
            if (_dialog is not null and not "card" and not "tags" && data?.Revision != _editRevision)
                _dialogWarning = "資料已有更新；表格已刷新，但這份輸入與原始版本保持不變。保存時會檢查衝突。";
            ClampPage();
            _recordsAppliedLoadEpoch = epoch;
            QueueRecordPerformance(performance, epoch); performanceQueued = true;
            await ReportSelectedCollectionAsync(id);
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { if (epoch == _loadEpoch) _error = error.Message; }
        finally
        {
            if (epoch == _loadEpoch) _loading = false;
            if (!performanceQueued) await EndRecordPerformanceAsync(performance, false);
        }
    }
    private async Task ChooseCollectionAsync(ChangeEventArgs args)
    {
        var performance = await BeginRecordPerformanceAsync("recordsCollectionSwitchToPaintOpportunity");
        var selected = args.Value?.ToString() ?? "";
        _selected = selected; _view = null; _page = 0;
        var expectedEpoch = _loadEpoch + 1;
        await RefreshAsync();
        if (_loadEpoch == expectedEpoch && _recordsAppliedLoadEpoch == expectedEpoch && _data?.Id == selected) QueueRecordPerformance(performance, expectedEpoch);
        else await EndRecordPerformanceAsync(performance, false);
    }
    private async Task ChooseView(ChangeEventArgs args)
    {
        var performance = await BeginRecordPerformanceAsync("recordsViewSwitchToPaintOpportunity");
        _view = _data?.Views.FirstOrDefault(v => v.Id == args.Value?.ToString()) ?? (_data is null ? null : DefaultView(_data));
        _search = _view?.Search ?? ""; _page = 0;
        QueueRecordPerformance(performance, _loadEpoch);
    }
    private static RecordViewDto DefaultView(CollectionDto data) => new("", "全部資料", data.Fields.Select(f => f.Id).ToArray(), 0, 0);
    private RecordFieldSchemaDto[] VisibleFields => _data is null ? [] : (_view?.ColumnOrder ?? _data.Fields.Select(f => f.Id).ToArray())
        .Select(id => _data.Fields.FirstOrDefault(f => f.Id == id)).OfType<RecordFieldSchemaDto>().ToArray();
    private int FrozenRows => Math.Clamp(_view?.FrozenRows ?? 0, 0, 10);
    private int FrozenColumns => Math.Clamp(_view?.FrozenColumns ?? 0, 0, VisibleFields.Length);
    private RecordRowDto[] FilteredRows()
    {
        if (_data is null) return [];
        IEnumerable<RecordRowDto> rows = _data.Rows;
        if (!string.IsNullOrWhiteSpace(_search)) rows = rows.Where(r => (r.Key + " " + r.DisplayName + " " + string.Join(" ", r.Cells.Select(SearchableCellText))).Contains(_search, StringComparison.OrdinalIgnoreCase));
        foreach (var filter in _view?.Filters ?? []) rows = rows.Where(row => Matches(row.Cells.FirstOrDefault(c => c.FieldId == filter.FieldId), filter));
        IOrderedEnumerable<RecordRowDto>? sorted = null;
        foreach (var sort in _view?.Sort ?? [])
        {
            Func<RecordRowDto, RecordCellDto?> selector = row => row.Cells.FirstOrDefault(c => c.FieldId == sort.FieldId);
            sorted = sorted is null ? sort.Descending ? rows.OrderByDescending(selector, CellComparer.Instance) : rows.OrderBy(selector, CellComparer.Instance)
                : sort.Descending ? sorted.ThenByDescending(selector, CellComparer.Instance) : sorted.ThenBy(selector, CellComparer.Instance);
        }
        return (sorted ?? rows).ToArray();
    }
    private RecordRowDto[] DisplayRows()
    {
        var rows = FilteredRows(); var frozen = Math.Min(FrozenRows, rows.Length); var size = PageSize - frozen;
        return rows.Take(frozen).Concat(rows.Skip(frozen + _page * size).Take(size)).ToArray();
    }
    private int PageCount { get { var count = FilteredRows().Length; var frozen = Math.Min(FrozenRows, count); return Math.Max(1, (int)Math.Ceiling((count - frozen) / (double)(PageSize - frozen))); } }
    private void ClampPage() => _page = Math.Clamp(_page, 0, PageCount - 1);
    private static bool Matches(RecordCellDto? cell, RecordFilterDto filter) => filter.Operator switch {
        "is-null" => cell?.IsNull != false, "not-null" => cell?.IsNull == false,
        "equals" => cell is not null && !cell.IsNull && (CellText(cell).Equals(filter.Value, StringComparison.OrdinalIgnoreCase)
            || NumericDisplay(cell)?.Equals(filter.Value, StringComparison.OrdinalIgnoreCase) == true),
        "contains" => cell is not null && !cell.IsNull && SearchableCellText(cell).Contains(filter.Value, StringComparison.OrdinalIgnoreCase), _ => false };
    private static string CellText(RecordCellDto cell) => cell.IsNull ? "" : cell.ComputedMarkdown ?? cell.RawSource;
    private static string? NumericDisplay(RecordCellDto cell) => !cell.IsNull
        && cell.TypedValue is { Kind: "Number", Coefficient: { } coefficient, Scale: { } scale } ? FormatNumber(coefficient, scale) : null;
    private static string SearchableCellText(RecordCellDto cell)
    {
        var canonical = CellText(cell);
        return NumericDisplay(cell) is { } display && display != canonical ? canonical + " " + display : canonical;
    }
    private string Preview(RecordCellDto? cell)
    {
        if (cell is null || cell.IsNull) return "∅ 空值";
        var field = _data?.Fields.FirstOrDefault(f => f.Id == cell.FieldId);
        var value = cell.TypedValue switch {
            { Kind: "Number", Coefficient: { } coefficient, Scale: { } scale } => FormatNumber(coefficient, scale),
            { Kind: "Select", Ids: { } ids } => string.Join(", ", ids.Select(id => field?.Options?.FirstOrDefault(o => o.Id == id)?.DisplayName ?? id)),
            { Kind: "Relation", Ids: { } ids } => string.Join(", ", ids.Select(id => _data?.RelationChoices.FirstOrDefault(r => r.Id == id)?.DisplayName ?? id)),
            { Kind: "Tag", Tags: { } tags } => string.Join(" · ", tags),
            { Kind: "Boolean", Boolean: { } boolean } => boolean ? "true" : "false",
            { Kind: "Date", Date: { } date } => date,
            _ => CellText(cell) };
        return value.Length == 0 ? "空字串" : value;
    }
    private static string KindName(string kind) => Kinds.FirstOrDefault(k => k.Kind == kind).Name ?? kind;
    private string FieldName(string id) => _data?.Fields.FirstOrDefault(f => f.Id == id)?.DisplayName ?? id;
    private bool SourceBlocked => _data is { HasDraft: true } || _data is { SourceStatus: not "accepted" };
    private bool InputsLocked => _busy || _unknownOutcome || _needsConfirmation || HasConversionPreview || _dialogWorkspace != WorkspaceKey;
    private string ColumnStyle(int index) => index < FrozenColumns ? $"position:sticky;left:{220 + index * 220}px;z-index:3;background:#fafbf6;" : "";
    private string RowStyle(int index) => index < FrozenRows ? $"position:sticky;top:{44 + index * 58}px;z-index:4;background:#f2f5ed;" : "";

    private void StartDialog(string kind)
    {
        CancelTagQuery();
        _recordNavigationGeneration++;
        _dialog = kind; _dialogWorkspace = WorkspaceKey; _editRevision = _data?.Revision ?? Math.Max(Revision, Backend.Workspace?.Revision ?? 0);
        _error = null; _dialogWarning = null; _confirmDiscard = false; _needsConfirmation = false; _conflict = false; _unknownOutcome = false; _pending = null;
        InvalidateFieldConversion();
        _pendingLink = null;
        _focusFirst = kind is not "card"; _initialDialog = "";
    }
    private void SnapshotDialog() => _initialDialog = DialogSnapshot();
    private string DialogSnapshot() => JsonSerializer.Serialize(new { _key, _label, _kind, _raw, _number, _date, _tags, _null, _boolean, _sourceMode, ids = _selectedIds.ToArray(), _options, _columns, _sorts, _filters, _viewName, _viewSearch, _frozenRows, _frozenColumns });
    private bool DialogChanged => _dialog is not null && _dialog != "card" && _initialDialog != DialogSnapshot();
    private void CloseDialog(bool discard = false)
    {
        if (_busy) return;
        if (_unknownOutcome) { _dialogWarning = "操作結果尚未確認，請先重試同一操作；輸入保持鎖定。"; return; }
        if (!discard && DialogChanged) { _confirmDiscard = true; return; }
        CancelTagQuery();
        _dialog = null; _pending = null; _card = null; _confirmDiscard = false; _pendingLink = null;
        InvalidateFieldConversion();
    }
    private void ShowCreate()
    { StartDialog("create"); _label = "新資料表"; _key = "Record1"; SnapshotDialog(); }
    private void ShowRow(RecordRowDto? row = null)
    {
        if (row is not null)
        {
            row = _data?.Rows.FirstOrDefault(r => r.Id == row.Id);
            if (row is null) { _notice = "這筆紀錄已不存在，請重新讀取資料表。"; return; }
        }
        StartDialog("row"); _row = row; _key = row?.Key ?? UniqueKey("Record", _data?.Rows.Select(r => r.Key) ?? []); _label = row?.DisplayName ?? "新紀錄"; SnapshotDialog();
    }
    private void ShowField(RecordFieldSchemaDto? field = null)
    {
        StartDialog("field"); _field = field; _key = field?.Key ?? UniqueKey("Field", _data?.Fields.Select(f => f.Key) ?? []);
        _label = field?.DisplayName ?? "新欄位"; _kind = field?.Kind ?? "Markdown";
        _options = (field?.Options ?? []).Select(o => new OptionEdit { Id = o.Id, Label = o.DisplayName }).ToList(); SnapshotDialog();
    }
    private void ShowCard(RecordRowDto row) { StartDialog("card"); _card = row; }
    private void ShowCell(RecordRowDto row, RecordFieldSchemaDto field)
    {
        var latestRow = _data?.Rows.FirstOrDefault(r => r.Id == row.Id);
        var latestField = _data?.Fields.FirstOrDefault(f => f.Id == field.Id);
        if (latestRow is null || latestField is null) { _notice = "這筆紀錄或欄位已不存在，請重新讀取資料表。"; return; }
        row = latestRow; field = latestField;
        StartDialog("cell"); _row = row; _field = field; _cell = row.Cells.FirstOrDefault(c => c.FieldId == field.Id);
        _kind = field.Kind; _raw = _cell?.RawSource ?? ""; _null = _cell?.IsNull ?? true;
        _boolean = _cell?.TypedValue?.Boolean ?? false; _date = _cell?.TypedValue?.Date ?? "";
        _number = _cell?.TypedValue is { Kind: "Number", Coefficient: { } coefficient, Scale: { } scale } ? FormatNumber(coefficient, scale) : _raw;
        _tags = string.Join('\n', _cell?.TypedValue?.Tags ?? []);
        _selectedIds.Clear(); foreach (var id in _cell?.TypedValue?.Ids ?? []) _selectedIds.Add(id);
        _sourceMode = field.Kind == "Markdown" || _cell?.TypedValue is null && !_null || _raw.Contains(":ref:", StringComparison.Ordinal) || _raw.Contains("[[@", StringComparison.Ordinal) || _raw.Contains("@code{", StringComparison.Ordinal);
        _focusFirst = !_null && (_sourceMode || _kind is "Markdown" or "Number" or "Boolean" or "Date" or "Tag");
        _relationSearch = "";
        if (_kind is "SingleRelation" or "MultiRelation" && !_sourceMode) _focusFirst = true;
        SnapshotDialog();
    }
    private void ShowView(bool create)
    {
        StartDialog("view"); var view = create || _view is null ? DefaultView(_data!) with { Name = "新視圖" } : _view;
        _viewId = create || string.IsNullOrEmpty(view.Id) ? Guid.NewGuid().ToString("N") : view.Id; _viewName = view.Name;
        _viewSearch = _search; _frozenRows = view.FrozenRows; _frozenColumns = view.FrozenColumns;
        _columns = view.ColumnOrder.Concat(_data!.Fields.Select(f => f.Id)).Distinct().Where(id => _data.Fields.Any(f => f.Id == id))
            .Select(id => new ColumnEdit { Id = id, Label = FieldName(id), Visible = view.ColumnOrder.Contains(id) }).ToList();
        _sorts = (view.Sort ?? []).Select(s => new SortEdit { FieldId = s.FieldId, Descending = s.Descending }).ToList();
        _filters = (view.Filters ?? []).Select(f => new FilterEdit { FieldId = f.FieldId, Operator = f.Operator, Value = f.Value }).ToList(); SnapshotDialog();
    }
    private void MoveColumn(int index, int direction)
    { var next = index + direction; if (next < 0 || next >= _columns.Count) return; (_columns[index], _columns[next]) = (_columns[next], _columns[index]); }
    private void ToggleId(string id, bool selected, bool single)
    { if (single) _selectedIds.Clear(); if (selected) _selectedIds.Add(id); else _selectedIds.Remove(id); }
    private static string UniqueKey(string prefix, IEnumerable<string> names)
    { var existing = names.ToHashSet(StringComparer.Ordinal); var number = 1; while (existing.Contains(prefix + number)) number++; return prefix + number; }

    private async Task SaveAsync(bool confirm = false)
    {
        if (_busy || _dialogWorkspace != WorkspaceKey) return;
        var performance = 0; var performanceQueued = false;
        var saveWorkspace = WorkspaceKey;
        _busy = true; _error = null;
        try
        {
            if (_pending is null)
            {
                if(!await PrepareFieldConversionAsync())return;
                _pending = BuildWrite();
            }
            if (_pending is null) return;
            var write = _pending;
            var expectedCollectionId = _data?.Id;
            performance = await BeginRecordPerformanceAsync("recordsCommitToPaintOpportunity");
            var result = await Backend.CommandAsync(write.Url, confirm ? write.ConfirmedRequest : write.Request, write.OperationId);
            _unknownOutcome = false;
            if (_disposed || _dialogWorkspace != WorkspaceKey) return;
            if (result.Status == "committed")
            {
                var viewId = _dialog == "view" ? _viewId : null;
                var created = _dialog == "create";
                _dialog = null; _pending = null; _notice = "已保存。";
                var expectedRefreshEpoch = _loadEpoch + 1;
                await RefreshAsync();
                if (created)
                {
                    expectedCollectionId = null;
                    if (_loadEpoch == expectedRefreshEpoch && _recordsAppliedLoadEpoch == expectedRefreshEpoch
                        && _collections.FirstOrDefault(c => c.NoteId == result.NoteId) is { } newCollection)
                    {
                        expectedCollectionId = newCollection.Id;
                        _selected = newCollection.Id; _view = null;
                        expectedRefreshEpoch = _loadEpoch + 1;
                        await RefreshAsync();
                    }
                }
                if (viewId is not null && _data?.Views.FirstOrDefault(v => v.Id == viewId) is { } saved) { _view = saved; _search = saved.Search; _page = 0; }
                if (_loadEpoch == expectedRefreshEpoch && _recordsAppliedLoadEpoch == expectedRefreshEpoch
                    && expectedCollectionId is not null && _data is { } applied && applied.Id == expectedCollectionId && applied.Revision >= result.Revision)
                {
                    QueueRecordPerformance(performance, expectedRefreshEpoch, result.Revision); performanceQueued = true;
                }
            }
            else if (result.Status == "confirmation-required")
            { _needsConfirmation = true; _dialogWarning = result.Message ?? "改名會更新相依引用。確認後以相同操作 ID 套用。"; }
            else if(result.Status is "unknown" or "pending")
            { _unknownOutcome=true;_dialogWarning="操作結果尚未確認，請重試同一操作；原輸入、轉換確認和操作 ID 保持不變。"; }
            else
            {
                _needsConfirmation = false; _conflict = result.Status is "conflict" or "source-changed" or "stale";
                _dialogWarning = (result.Message ?? "保存未完成。") + " 這份輸入已保留，尚未覆蓋來源。";
                if (result.Diagnostics?.Length > 0) _error = string.Join('\n', result.Diagnostics.Select(d => d.Message));
                _pending = null;
                InvalidateFieldConversion();
                if (_conflict) await RefreshAsync();
            }
        }
        catch (Exception error)
        {
            _error = error.Message;
            if (_pending is not null) { _unknownOutcome = true; _dialogWarning = "尚未確認後端是否完成。請重試同一操作；原輸入和操作 ID 保持不變。"; }
        }
        finally
        {
            _busy = false;
            // A true later update still needs a read. It deliberately invalidates any
            // older paint span; never attach that span to an unrelated later query.
            var deferred = _deferredRevision;
            _deferredRevision = -1;
            if (!_disposed && saveWorkspace == WorkspaceKey && deferred > (_data?.Revision ?? -1))
                await RefreshAsync();
            if (!performanceQueued) await EndRecordPerformanceAsync(performance, false);
        }
    }
    private PendingWrite? BuildWrite()
    {
        if (_dialog is null) return null;
        if (_dialog != "create" && SourceBlocked) throw new InvalidOperationException("來源存在草稿或未接受的變更。請保留輸入，先從原文處理來源問題。");
        var id = Guid.NewGuid().ToString("N"); var collectionId = _data?.Id;
        if (_dialog == "create")
        { var request = new CreateCollectionRequest(id, _editRevision, _label, _key); return new("api/records", id, request, request); }
        if (_dialog == "row")
        {
            if (_row is null) { var request = new AddRecordRequest(id, _editRevision, _key, _label); return new($"api/records/{collectionId}/rows", id, request, request); }
            var rename = new RenameRecordRequest(id, _editRevision, _key, _label); return new($"api/records/{collectionId}/rows/{_row.Id}", id, rename, rename with { ConfirmRename = true });
        }
        if (_dialog == "field")
        {
            var field = new RecordFieldSchemaDto(_field?.Id ?? "", _key, _label, _kind,
                _kind is "SingleSelect" or "MultiSelect" ? _options.Select(o => new RecordOptionDto(o.Id, o.Label)).ToArray() : []);
            var request = new UpsertRecordFieldRequest(id, _editRevision, field); return new($"api/records/{collectionId}/fields", id, request, request with { ConfirmRename = true });
        }
        if (_dialog == "cell")
        {
            var typed = _sourceMode || _kind == "Markdown" ? null : TypedInput();
            var request = new RecordFieldChangeRequest(id, _editRevision, typed is null && !_null ? _raw : "", _null, TypedValue: typed, ConversionToken:ConfirmedConversionToken);
            return new($"api/records/rows/{_row!.Id}/fields/{_field!.Id}", id, request, request with { ConfirmRename = true });
        }
        if (_dialog == "view")
        {
            var view = new RecordViewDto(_viewId, _viewName, _columns.Where(c => c.Visible).Select(c => c.Id).ToArray(),
                Math.Clamp(_frozenRows, 0, 10), Math.Clamp(_frozenColumns, 0, _columns.Count(c => c.Visible)), _viewSearch,
                _sorts.Select(s => new RecordSortDto(s.FieldId, s.Descending)).ToArray(), _filters.Select(f => new RecordFilterDto(f.FieldId, f.Operator, f.Value)).ToArray());
            var request = new SaveRecordViewRequest(id, _editRevision, view); return new($"api/records/{collectionId}/views", id, request, request);
        }
        return null;
    }
    private RecordTypedValueDto TypedInput()
    {
        if (_null) return new("Null", true);
        if (_kind == "Number")
        {
            var match = Regex.Match(_number.Trim(), @"\A(?<sign>[+-]?)(?<integer>[0-9]+)(?:\.(?<fraction>[0-9]+))?(?:[eE](?<exponent>[+-]?[0-9]+))?\z");
            if (!match.Success || _number.Length > 4096) throw new InvalidOperationException("數字請使用十進位或科學記號，不會自動四捨五入。");
            var exponent = match.Groups["exponent"].Success ? int.Parse(match.Groups["exponent"].Value, CultureInfo.InvariantCulture) : 0;
            var coefficient = match.Groups["sign"].Value + match.Groups["integer"].Value + match.Groups["fraction"].Value;
            return new("Number", false, Coefficient: coefficient, Scale: checked(match.Groups["fraction"].Length - exponent));
        }
        return _kind switch {
            "Boolean" => new("Boolean", false, Boolean: _boolean), "Date" => new("Date", false, Date: _date),
            "SingleSelect" or "MultiSelect" => new("Select", false, Ids: _selectedIds.ToArray()),
            "SingleRelation" or "MultiRelation" => new("Relation", false, Ids: _selectedIds.ToArray()),
            "Tag" => new("Tag", false, Tags: _tags.Replace("\r\n", "\n").Split('\n', StringSplitOptions.RemoveEmptyEntries)),
            _ => throw new InvalidOperationException("此欄位請使用原文編輯。") };
    }
    private async Task ReviewLatestAsync()
    {
        await RefreshAsync();
        _dialogWarning = "已重新讀取目前資料；你的輸入與原始版本仍保留。核對右側最新內容後，才能選擇以新版本保存。";
        _conflict = true;
    }
    private void AcceptLatestBase()
    {
        if (_data is null || SourceBlocked || _unknownOutcome) return;
        _editRevision = _data.Revision; _pending = null; _conflict = false; _needsConfirmation = false;
        InvalidateFieldConversion();
        _dialogWarning = "已明確選擇保留這份輸入，以下次保存取代目前值；保存時仍會檢查新衝突。";
    }
    private string LatestCellText => _data?.Rows.FirstOrDefault(r => r.Id == _row?.Id)?.Cells.FirstOrDefault(c => c.FieldId == _field?.Id) is { } cell ? cell.IsNull ? "∅ 空值" : cell.RawSource : "目前找不到這筆欄位";
    private string LatestMetadataText => JsonSerializer.Serialize<object?>(_dialog switch {
        "row" => _data?.Rows.FirstOrDefault(r => r.Id == _row?.Id),
        "field" => _data?.Fields.FirstOrDefault(f => f.Id == _field?.Id),
        "view" => _data?.Views.FirstOrDefault(v => v.Id == _viewId),
        _ => _data }, new JsonSerializerOptions { WriteIndented = true });
    private static bool HasCellProblem(RecordCellDto? cell) => cell is not null && (!string.Equals(cell.Status, "Valid", StringComparison.OrdinalIgnoreCase) || cell.Diagnostics.Length > 0);
    private static bool RenderManagedCell(RecordFieldSchemaDto field, RecordCellDto? cell) => cell is { IsNull: false }
        && !(field.Kind == "Number" && cell.TypedValue is { Kind: "Number", Coefficient: not null, Scale: not null }
            && cell.References is not { Length: > 0 } && cell.Regions is not { Length: > 0 });
    private Task OpenSourceAsync() => _data is null ? Task.CompletedTask : OnOpenSource.InvokeAsync(_data.NoteId);
    private async Task NavigateContentAsync(RecordsContentNavigation navigation)
    {
        if (_busy || _unknownOutcome) { _dialogWarning = "請先確認目前保存操作的結果，再開啟連結。"; return; }
        try
        {
            if (navigation.RecordId is { } recordId) { await OpenRecordByIdAsync(recordId); return; }
            if (navigation.NoteId is not null || navigation.DefinitionName is not null)
            {
                if (DialogChanged) { _dialogWarning = "這份輸入尚未保存。請先保存或取消編輯，再點選連結；輸入保持不變。"; return; }
                if (OnNavigate.HasDelegate)
                {
                    CloseDialog(true); await OnNavigate.InvokeAsync(navigation); return;
                }
                if (navigation.DefinitionName is not null) { _notice = "定義導航尚未連接。"; return; }
            }
            if (navigation.Url is { } url && Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
                await Microsoft.Maui.ApplicationModel.Launcher.Default.OpenAsync(uri);
            else if (navigation.RelativePath is { } path && navigation.NoteId is null)
                await PlatformServices.WorkspaceFileLauncher.OpenAttachmentAsync(Backend.WorkspacePath, path);
            else if (navigation.NoteId is { } id)
            {
                if (DialogChanged) { _dialogWarning = "這份輸入尚未保存。請先保存或取消編輯，再點選連結；輸入保持不變。"; return; }
                if (!string.IsNullOrEmpty(navigation.Anchor))
                {
                    _dialogWarning = "連結指定標題「" + navigation.Anchor + "」。目前資料表可開啟目標筆記，尚未自動定位標題；請使用下方按鈕開啟。";
                    _pendingLink = id; return;
                }
                CloseDialog(true); await OnOpenSource.InvokeAsync(id);
            }
        }
        catch (Exception error) { _dialogWarning = error.Message; }
    }
    private string? _pendingLink;
    private async Task OpenPendingLinkAsync()
    {
        if (_pendingLink is not { } id || DialogChanged || _busy || _unknownOutcome) return;
        _pendingLink = null; CloseDialog(true); await OnOpenSource.InvokeAsync(id);
    }
    [JSInvokable] public Task CloseRecordsModal() => InvokeAsync(() => { CloseDialog(); StateHasChanged(); });
    public async ValueTask DisposeAsync()
    {
        CancelTagQuery();
        _disposed = true; _loadEpoch++; _load?.Cancel(); _load?.Dispose();
        await DisposeRecordPerformanceAsync();
        if (_module is not null)
        {
            try { await _module.InvokeVoidAsync("releaseModal", _modalId); await _module.DisposeAsync(); }
            catch (JSDisconnectedException) { }
        }
        _receiver?.Dispose();
    }

    private sealed class CellComparer : IComparer<RecordCellDto?>
    {
        public static readonly CellComparer Instance = new();
        public int Compare(RecordCellDto? left, RecordCellDto? right)
        {
            if (left?.IsNull != false) return right?.IsNull != false ? 0 : -1;
            if (right?.IsNull != false) return 1;
            if (left.TypedValue is { Kind: "Number", Coefficient: { } lc, Scale: { } ls } && right.TypedValue is { Kind: "Number", Coefficient: { } rc, Scale: { } rs }
                && BigInteger.TryParse(lc, out var l) && BigInteger.TryParse(rc, out var r))
            {
                // Comparison uses exponent magnitude first; no float conversion or giant exponent allocation.
                if (l.Sign != r.Sign) return l.Sign.CompareTo(r.Sign); if (l.IsZero) return r.IsZero ? 0 : -r.Sign;
                var ld = BigInteger.Abs(l).ToString(CultureInfo.InvariantCulture); var rd = BigInteger.Abs(r).ToString(CultureInfo.InvariantCulture);
                var magnitude = ((long)ld.Length - ls).CompareTo((long)rd.Length - rs);
                return l.Sign * (magnitude != 0 ? magnitude : string.CompareOrdinal(ld.PadRight(Math.Max(ld.Length, rd.Length), '0'), rd.PadRight(Math.Max(ld.Length, rd.Length), '0')));
            }
            return StringComparer.OrdinalIgnoreCase.Compare(CellText(left), CellText(right));
        }
    }
}
