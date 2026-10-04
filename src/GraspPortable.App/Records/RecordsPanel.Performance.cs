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
    private readonly Dictionary<int, RecordsPerformanceSpan> _recordsPerformanceSpans = [];
    private sealed record RecordsPerformanceSpan(string Workspace, long RenderSequence = long.MaxValue, long? LoadEpoch = null, long? MinimumRevision = null);

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
        _recordsPerformanceSpans[id] = span with { RenderSequence = _recordsRenderSequence + 1, LoadEpoch = loadEpoch, MinimumRevision = minimumRevision };
    }
    private async Task EndRecordPerformanceAsync(int id, bool accepted)
    {
        if (id == 0 || _recordsPerformance is null) return;
        _recordsPerformanceSpans.Remove(id);
        try { await _recordsPerformance.InvokeVoidAsync("end", id, accepted); }
        catch (Exception) { }
    }
    private async Task FinishRenderedRecordPerformanceAsync(long renderedSequence)
    {
        if (!_measureRecords || _recordsPerformanceSpans.Count == 0) return;
        foreach (var (id, span) in _recordsPerformanceSpans.ToArray())
        {
            if (span.Workspace != WorkspaceKey || span.LoadEpoch is { } epoch && epoch != _loadEpoch)
            { await EndRecordPerformanceAsync(id, false); continue; }
            if (span.RenderSequence > renderedSequence) continue;
            if (span.MinimumRevision is { } revision && (_data is null || _data.Revision < revision))
            { await EndRecordPerformanceAsync(id, false); continue; }
            // The shared probe waits two rAF callbacks after Blazor's applied render.
            await EndRecordPerformanceAsync(id, true);
        }
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
