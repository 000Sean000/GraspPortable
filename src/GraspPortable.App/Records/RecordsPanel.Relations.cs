using GraspPortable.Contracts;

namespace GraspPortable.App.Records;

public partial class RecordsPanel
{
    private long _recordNavigationLoadingGeneration;
    private RecordChoiceDto[] FilteredRelationChoices => (_data?.RelationChoices ?? [])
        .Where(choice => string.IsNullOrWhiteSpace(_relationSearch)
            || (choice.DisplayName + " " + choice.Key + " " + CollectionName(choice.CollectionId))
                .Contains(_relationSearch, StringComparison.OrdinalIgnoreCase)).ToArray();
    private string CollectionName(string id) => _collections.FirstOrDefault(collection => collection.Id == id)?.Title ?? id;
    private string SelectedRelationName(string id) => _data?.RelationChoices.FirstOrDefault(choice => choice.Id == id) is { } choice
        ? choice.DisplayName + " · " + CollectionName(choice.CollectionId) : "已不存在的紀錄（" + id[..Math.Min(id.Length, 8)] + "）";

    private async Task ReportSelectedCollectionAsync(string id)
    {
        if (!SelectedCollectionChanged.HasDelegate || _reportedCollectionId == id) return;
        _reportedCollectionId = id;
        // Consume the parent's echo without resetting its already-applied view.
        _appliedInitialCollectionId = id;
        await SelectedCollectionChanged.InvokeAsync(id);
    }

    private async Task OpenRecordByIdAsync(string requestedId)
    {
        if (_disposed) return;
        if (_busy || _unknownOutcome || DialogChanged)
        {
            _dialogWarning = "請先保存或取消目前輸入，並確認保存結果，再開啟關聯紀錄。這份輸入仍保留。";
            return;
        }
        if (!Guid.TryParseExact(requestedId, "N", out var guid) || guid == Guid.Empty)
        { _notice = "關聯紀錄的身分格式無效。"; return; }
        var id = guid.ToString("N"); var workspace = WorkspaceKey;
        var navigation = ++_recordNavigationGeneration; var epoch = _loadEpoch;
        bool Current() => !_disposed && navigation == _recordNavigationGeneration && workspace == WorkspaceKey
            && epoch == _loadEpoch && !_busy && !_unknownOutcome;
        CloseDialog(true); // Only unchanged input reaches here; do not let it acquire a new collection baseline.
        const string loadingMessage = "正在開啟關聯紀錄…";
        _recordNavigationLoadingGeneration = navigation;
        _notice = loadingMessage;
        try
        {
            if (!Backend.Connected) { _notice = "後端尚未連線，無法讀取關聯紀錄。"; return; }
            var collections = await Backend.GetAsync<CollectionSummaryDto[]>("api/records");
            if (!Current()) return;
            var basisId = collections.Any(collection => collection.Id == _selected) ? _selected : collections.FirstOrDefault()?.Id;
            if (basisId is null) { _notice = "找不到這筆關聯紀錄；工作區目前沒有資料表。"; return; }
            // Every fresh collection response carries the workspace-wide ID -> collection map.
            var basis = await Backend.GetAsync<CollectionDto>("api/records/" + basisId);
            if (!Current()) return;
            var matches = basis.RelationChoices.Where(choice => choice.Id == id).Take(2).ToArray();
            if (matches.Length != 1)
            {
                _notice = matches.Length == 0 ? "找不到這筆關聯紀錄；它可能已被刪除或移出工作區。"
                    : "這個紀錄 ID 對應多個位置，請先處理來源身分衝突。";
                return;
            }
            var target = matches[0].CollectionId == basis.Id ? basis
                : await Backend.GetAsync<CollectionDto>("api/records/" + matches[0].CollectionId);
            if (!Current()) return;
            var rows = target.Rows.Where(row => row.Id == id).Take(2).ToArray();
            if (target.Id != matches[0].CollectionId || rows.Length != 1)
            { _notice = "關聯紀錄的位置已變更，請重新點選連結；未猜測其他目標。"; return; }
            if (_data is not null && target.Revision < _data.Revision)
            { _notice = "讀取期間資料已有更新，請重新點選關聯連結。"; return; }

            var sameCollection = _data?.Id == target.Id;
            _load?.Cancel(); _load?.Dispose(); _load = null;
            _loadEpoch++; _recordsAppliedLoadEpoch = _loadEpoch; _loading = false;
            _collections = collections; _selected = target.Id; _data = target;
            if (!sameCollection || _view is null)
            { _view = target.Views.FirstOrDefault() ?? DefaultView(target); _search = _view.Search; _page = 0; }
            else if (string.IsNullOrEmpty(_view.Id)) _view = DefaultView(target);
            ClampPage(); _notice = null;
            // Opening by identity is independent of the table's filter/page and source heading text.
            ShowCard(rows[0]);
            await ReportSelectedCollectionAsync(target.Id);
        }
        catch (Exception error)
        {
            if (Current()) _notice = "無法開啟關聯紀錄：" + error.Message;
        }
        finally
        {
            if (!_disposed && navigation == _recordNavigationLoadingGeneration && workspace == WorkspaceKey && _notice == loadingMessage)
                _notice = null;
        }
    }
}
