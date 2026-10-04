using Microsoft.JSInterop;

namespace GraspPortable.App.Records;

public partial class RecordsPanel
{
    // Share Home's active probe; this component never starts, resets, or writes its report.
    private readonly bool _measureRecords = Environment.GetEnvironmentVariable("GRASP_MEASURE_UI") == "1";
    private IJSObjectReference? _recordsPerformance;
    private Task<IJSObjectReference>? _recordsPerformanceImport;
    private bool _recordsPerformanceReleased;
    private long _recordsRenderSequence;
    private long _recordsAppliedLoadEpoch;
    private readonly string _recordsPaintRoot = "records-paint-" + Guid.NewGuid().ToString("N");
    private long _recordsPaintVersion;
    private string? _recordsWaitingPaintToken;
    private Task<bool>? _recordsPaintReady;
    private RecordsPaintState? _recordsPaintState;
    private sealed record RecordsPaintState(string Workspace, long Epoch, string? Collection, long? Revision,
        object? View, int Page, string Search, string? Dialog, string? Card, string? Row, string? Field);
    private string RecordsPaintToken
    {
        get
        {
            var state = new RecordsPaintState(WorkspaceKey, _loadEpoch, _data?.Id, _data?.Revision,
                _view, _page, _search, _dialog, _card?.Id, _row?.Id, _field?.Id);
            if (_recordsPaintState != state) { _recordsPaintState = state; _recordsPaintVersion++; }
            return _recordsPaintVersion.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
    }
    private readonly Dictionary<int, RecordsPerformanceSpan> _recordsPerformanceSpans = [];
    private sealed record RecordsPerformanceSpan(string Workspace, long RenderSequence = long.MaxValue, long? LoadEpoch = null,
        long? MinimumRevision = null, string? PaintToken = null, bool WaitingForChildren = false);

    private async Task<int> BeginRecordPerformanceAsync(string kind)
    {
        if (!_measureRecords || _disposed) return 0;
        try
        {
            var workspace = WorkspaceKey;
            _recordsPerformanceImport ??= JS.InvokeAsync<IJSObjectReference>("import", "./performance-probe.js").AsTask();
            _recordsPerformance ??= await _recordsPerformanceImport;
            if (_disposed || workspace != WorkspaceKey) return 0;
            var id = await _recordsPerformance.InvokeAsync<int>("begin", kind);
            if (_disposed || workspace != WorkspaceKey)
            {
                if (id != 0) await _recordsPerformance.InvokeVoidAsync("end", id, false);
                return 0;
            }
            if (id != 0) _recordsPerformanceSpans[id] = new(workspace);
            return id;
        }
        catch (Exception) { return 0; } // Optional instrumentation cannot change product behavior.
    }
    private void QueueRecordPerformance(int id, long? loadEpoch = null, long? minimumRevision = null)
    {
        if (id == 0 || !_recordsPerformanceSpans.TryGetValue(id, out var span)) return;
        // A currently-awaiting OnAfterRender must not finish a span for a later state change.
        _recordsPerformanceSpans[id] = span with { RenderSequence = _recordsRenderSequence + 1, LoadEpoch = loadEpoch,
            MinimumRevision = minimumRevision, PaintToken = RecordsPaintToken };
    }
    private async Task EndRecordPerformanceAsync(int id, bool accepted)
    {
        if (id == 0 || _recordsPerformance is null) return;
        _recordsPerformanceSpans.Remove(id, out var span);
        accepted = accepted && span?.PaintToken is not null;
        object? guard = accepted ? new { rootId = _recordsPaintRoot, attribute = "data-records-paint-token", token = span!.PaintToken } : null;
        try { await _recordsPerformance.InvokeVoidAsync("end", id, accepted, guard); }
        catch (Exception) { }
    }
    private async Task FinishRenderedRecordPerformanceAsync(long renderedSequence)
    {
        if (!_measureRecords || _recordsPerformanceSpans.Count == 0) return;
        foreach (var (id, span) in _recordsPerformanceSpans.ToArray())
        {
            if (span.WaitingForChildren) continue;
            if (span.Workspace != WorkspaceKey || span.LoadEpoch is { } epoch && epoch != _loadEpoch)
            { await EndRecordPerformanceAsync(id, false); continue; }
            if (span.RenderSequence > renderedSequence) continue;
            if (span.MinimumRevision is { } revision && (_data is null || _data.Revision < revision))
            { await EndRecordPerformanceAsync(id, false); continue; }
            if (span.PaintToken is null || span.PaintToken != RecordsPaintToken || _module is null)
            { await EndRecordPerformanceAsync(id, false); continue; }
            _recordsPerformanceSpans[id] = span with { WaitingForChildren = true };
            if (_recordsWaitingPaintToken != span.PaintToken)
            {
                _recordsWaitingPaintToken = span.PaintToken;
                _recordsPaintReady = WaitForRecordChildrenAsync(span.PaintToken);
            }
            var ready = await _recordsPaintReady!;
            if (!_recordsPerformanceSpans.ContainsKey(id)) continue;
            // Child HTML and event bindings must be applied for the same still-current state.
            // Images remain lazy: this measures the readable DOM, not all attachment downloads.
            ready = ready && !_disposed && span.Workspace == WorkspaceKey && span.PaintToken == RecordsPaintToken
                && (span.LoadEpoch is null || span.LoadEpoch == _loadEpoch)
                && (span.MinimumRevision is null || _data is not null && _data.Revision >= span.MinimumRevision);
            await EndRecordPerformanceAsync(id, ready);
        }
    }
    private async Task<bool> WaitForRecordChildrenAsync(string token)
    {
        try { return _module is not null && await _module.InvokeAsync<bool>("waitForRecordsPaint", _recordsPaintRoot, token, 2000); }
        catch (Exception) { return false; }
    }
    private async Task DisposeRecordPerformanceAsync()
    {
        if (!_measureRecords) return;
        foreach (var id in _recordsPerformanceSpans.Keys.ToArray()) await EndRecordPerformanceAsync(id, false);
        // Import may still be in flight when Blazor removes the panel. Await that same task
        // so its eventual JS object reference also has an owner that releases it.
        if (_recordsPerformanceImport is not null)
        {
            try
            {
                var module = await _recordsPerformanceImport;
                if (!_recordsPerformanceReleased) { _recordsPerformanceReleased = true; await module.DisposeAsync(); }
            }
            catch (Exception) { }
        }
    }
}
