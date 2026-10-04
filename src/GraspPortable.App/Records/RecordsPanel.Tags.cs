using GraspPortable.Contracts;

namespace GraspPortable.App.Records;

public partial class RecordsPanel
{
    private string _tagSearch = "", _tagSubmitted = "";
    private RecordTagSearchDto? _tagResults;
    private string? _tagError;
    private bool _tagLoading;
    private long _tagEpoch, _tagRequestedRevision = -1;
    private CancellationTokenSource? _tagLoad;
    private const int TagPageSize = 50;
    private bool TagContextCurrent => !_disposed && _dialog == "tags" && _dialogWorkspace == WorkspaceKey;
    private long TagMinimumRevision => Math.Max(Revision, _data?.Revision ?? 0);

    private async Task ShowTagsAsync()
    {
        if (_disposed) return;
        if (_busy || _unknownOutcome || DialogChanged)
        { _dialogWarning = "請先保存或取消目前輸入，再開啟跨表標籤搜尋。這份輸入仍保留。"; return; }
        StartDialog("tags"); SnapshotDialog();
        _tagSearch = _tagSubmitted = ""; _tagResults = null; _tagError = null;
        await QueryTagsAsync("", 0);
    }

    private Task SubmitTagsAsync()
    {
        if (!TagContextCurrent) return Task.CompletedTask;
        _tagSubmitted = _tagSearch.Trim();
        _tagResults = null;
        return QueryTagsAsync(_tagSubmitted, 0);
    }

    private Task PageTagsAsync(int direction)
    {
        if (!TagContextCurrent || _tagLoading || _tagResults is not { } page) return Task.CompletedTask;
        var offset = Math.Max(0, page.Offset + direction * TagPageSize);
        return offset >= page.Total ? Task.CompletedTask : QueryTagsAsync(_tagSubmitted, offset);
    }

    private async Task QueryTagsAsync(string search, int offset)
    {
        if (!TagContextCurrent) return;
        if (!Backend.Connected) { _tagError = "後端尚未連線，無法搜尋標籤。"; return; }
        CancelTagQuery();
        _tagLoad = new(); var token = _tagLoad.Token; var epoch = _tagEpoch; var workspace = WorkspaceKey;
        _tagRequestedRevision = TagMinimumRevision;
        _tagLoading = true; _tagError = null;
        bool Current() => TagContextCurrent && workspace == WorkspaceKey && epoch == _tagEpoch && !token.IsCancellationRequested;
        try
        {
            var page = await Backend.GetAsync<RecordTagSearchDto>(
                $"api/records/tags?search={Uri.EscapeDataString(search)}&offset={offset}&limit={TagPageSize}", token);
            if (!Current()) return;
            if (page.Revision < TagMinimumRevision)
            { _tagResults = null; _tagError = "資料已更新，這份結果已過期；請重新搜尋。"; return; }
            if (offset > 0 && page.Items.Length == 0)
            { await QueryTagsAsync(search, 0); return; }
            _tagResults = page;
        }
        catch (OperationCanceledException) { if (Current()) { _tagError = "搜尋已取消，請重試。"; _tagResults = null; } }
        catch (Exception error) { if (Current()) { _tagError = error.Message; _tagResults = null; } }
        finally { if (epoch == _tagEpoch) _tagLoading = false; }
    }

    private Task RefreshTagRevisionAsync()
    {
        if (!TagContextCurrent || TagMinimumRevision <= Math.Max(_tagRequestedRevision, _tagResults?.Revision ?? -1)) return Task.CompletedTask;
        // Changes may move/delete matches. Start from page one, not an obsolete offset.
        return QueryTagsAsync(_tagSubmitted, 0);
    }

    private async Task OpenTagResultAsync(RecordTagMatchDto item)
    {
        if (!TagContextCurrent || _tagLoading || _tagResults is not { } page) return;
        if (page.Revision < TagMinimumRevision || !page.Items.Any(match => match.RecordId == item.RecordId && match.FieldId == item.FieldId))
        { _tagError = "這筆結果已變更，請重新搜尋後再開啟。"; return; }
        // Resolve identity afresh; neither the displayed title nor a stale path is a navigation target.
        await OpenRecordByIdAsync(item.RecordId);
    }

    private void CancelTagQuery()
    {
        _tagEpoch++; _tagLoad?.Cancel(); _tagLoad?.Dispose(); _tagLoad = null; _tagLoading = false;
    }
}
