using GraspPortable.Contracts;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.JSInterop;

namespace GraspPortable.App.Workspace.Files;

public partial class WorkspaceFileTree
{
    [Parameter, EditorRequired] public Func<string, int, string?, CancellationToken, Task<WorkspaceFilePage>> LoadPage { get; set; } = default!;
    [Parameter] public string? SelectedNoteId { get; set; }
    [Parameter] public string? SelectedPath { get; set; }
    [Parameter] public string WorkspaceKey { get; set; } = "";
    [Parameter] public long RefreshVersion { get; set; }
    [Parameter] public EventCallback<WorkspaceFileEntry> OnOpen { get; set; }
    [Parameter] public EventCallback<ExplorerAction> OnAction { get; set; }

    private static readonly WorkspaceFileEntry RootEntry = new("", "工作區", true, HasChildren: true);
    private readonly Dictionary<string, DirectoryPage> _pages = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _expanded = new(StringComparer.OrdinalIgnoreCase);
    private DirectoryPage _searchResults = new();
    private string _searchText = "", _loadedWorkspace = "";
    private string? _interopError;
    private string? _selectedPath, _pendingSelectedPath, _scrollSelectedPath;
    private long _selectionVersion, _activeRevealVersion = -1, _activeRevealEpoch = -1;
    private bool _initialized, _disposed, _rootCollapsed, _searchPending, _positionMenu;
    private long _loadedVersion, _epoch, _searchEpoch;
    private CancellationTokenSource? _searchCancellation;
    private ElementReference _root, _menu;
    private IJSObjectReference? _module;
    private DotNetObjectReference<WorkspaceFileTree>? _receiver;
    private WorkspaceFileEntry? _menuTarget;
    private double _menuX, _menuY;
    private bool IsSearching => !string.IsNullOrWhiteSpace(_searchText);

    protected override async Task OnParametersSetAsync()
    {
        var workspaceChanged = !_initialized || _loadedWorkspace != WorkspaceKey;
        var selectedPath = string.IsNullOrWhiteSpace(SelectedPath) ? null : SelectedPath.Replace('\\', '/');
        if (workspaceChanged || !StringComparer.OrdinalIgnoreCase.Equals(_selectedPath, selectedPath))
        {
            _selectedPath = selectedPath; _pendingSelectedPath = selectedPath; _scrollSelectedPath = null;
            _selectionVersion++;
        }
        if (workspaceChanged)
        {
            _initialized = true; _loadedWorkspace = WorkspaceKey; _loadedVersion = RefreshVersion;
            _epoch++; CancelRequests();
            foreach (var page in _pages.Values) page.Cancellation?.Dispose();
            _pages.Clear(); _expanded.Clear();
            _searchText = ""; _searchResults = new(); _searchPending = false; _rootCollapsed = false; _menuTarget = null;
            await LoadDirectoryAsync("", false);
        }
        else if (_loadedVersion != RefreshVersion)
        {
            _loadedVersion = RefreshVersion;
            await RefreshAsync();
        }
        await RevealSelectedAsync();
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        try
        {
            if (firstRender)
            {
                _module = await JS.InvokeAsync<IJSObjectReference>("import", "./Workspace/Files/WorkspaceFileTree.razor.js");
                _receiver = DotNetObjectReference.Create(this);
                await _module.InvokeVoidAsync("attach", _root, _receiver);
            }
            if (_positionMenu && _menuTarget is not null && _module is not null)
            {
                _positionMenu = false;
                await _module.InvokeVoidAsync("showMenu", _root, _menu, _menuX, _menuY);
            }
            if (_scrollSelectedPath is { } path && !IsSearching && _module is not null)
            {
                _scrollSelectedPath = null;
                await _module.InvokeVoidAsync("revealPath", _root, path);
            }
        }
        catch (JSException error)
        {
            _interopError = "檔案選單鍵盤支援載入失敗：" + error.Message;
            _positionMenu = false;
            if (firstRender) StateHasChanged();
        }
    }

    private bool IsSelected(WorkspaceFileEntry entry) => entry.NoteId is not null && entry.NoteId == SelectedNoteId;
    private static string Indent(int depth) => $"padding-left:{8 + Math.Max(0, depth - 1) * 15}px";
    private DirectoryPage Page(string parent)
    {
        if (!_pages.TryGetValue(parent, out var page)) _pages[parent] = page = new();
        return page;
    }
    private IEnumerable<TreeRow> VisibleRows(string parent, int depth)
    {
        var page = Page(parent);
        foreach (var entry in page.Entries)
        {
            yield return new(entry, parent, depth, null);
            if (entry.IsDirectory && _expanded.Contains(entry.RelativePath))
                foreach (var child in VisibleRows(entry.RelativePath, depth + 1)) yield return child;
        }
        yield return new(null, parent, depth, page);
    }
    private async Task LoadDirectoryAsync(string parent, bool append, int retainCount = 0)
    {
        if (_disposed) return;
        var page = Page(parent);
        if (append && page.Loading) return;
        page.Cancellation?.Cancel(); page.Cancellation?.Dispose(); page.Cancellation = new();
        var token = page.Cancellation.Token; var epoch = _epoch;
        var request = ++page.Request;
        var offset = append ? page.NextOffset : 0;
        page.Loading = true; page.Error = null; StateHasChanged();
        try
        {
            var entries = append ? new List<WorkspaceFileEntry>(page.Entries) : [];
            do
            {
                var result = await LoadPage(parent, offset, null, token);
                if (_disposed || epoch != _epoch || request != page.Request || token.IsCancellationRequested) return;
                ValidatePage(result, offset);
                entries.AddRange(result.Entries);
                offset = result.Offset + result.Entries.Length;
                page.Entries = entries.DistinctBy(e => e.RelativePath, StringComparer.OrdinalIgnoreCase).ToList();
                page.NextOffset = offset; page.Total = result.Total;
                if (append || entries.Count >= retainCount || offset >= result.Total) break;
            } while (true);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception error)
        {
            if (epoch == _epoch && request == page.Request && !_disposed) page.Error = error.Message;
        }
        finally
        {
            if (epoch == _epoch && request == page.Request && !_disposed) { page.Loading = false; StateHasChanged(); }
        }
    }
    private static void ValidatePage(WorkspaceFilePage page, int offset)
    {
        if (page.Offset != offset || page.Total < 0 || (page.Entries.Length == 0 && page.Total > offset))
            throw new InvalidOperationException("檔案清單已變更或分頁無法繼續，請重新整理。");
    }
    private async Task RefreshAsync()
    {
        if (_disposed) return;
        _epoch++; CancelRequests();
        var epoch = _epoch;
        await CloseMenuAsync();
        if (IsSearching) { await SearchAgainAsync(); return; }
        await LoadDirectoryAsync("", false, Page("").Entries.Count);
        // Refresh only branches already visible / expanded, retaining the pages the user loaded.
        foreach (var path in _expanded.OrderBy(p => p.Count(c => c is '/' or '\\')).ToArray())
        {
            if (_disposed || epoch != _epoch) return;
            var ancestor = ParentPath(path);
            var visible = !_rootCollapsed;
            while (ancestor.Length > 0) { visible &= _expanded.Contains(ancestor); ancestor = ParentPath(ancestor); }
            if (!visible) continue;
            if (!_pages.Values.Any(p => p.Entries.Any(e => e.IsDirectory && e.RelativePath == path))) continue;
            await LoadDirectoryAsync(path, false, Page(path).Entries.Count);
        }
    }
    private async Task ToggleAsync(WorkspaceFileEntry entry)
    {
        if (entry.RelativePath.Length == 0) { _rootCollapsed = !_rootCollapsed; if (_rootCollapsed) CancelSelectedReveal(); return; }
        if (!_expanded.Add(entry.RelativePath)) { _expanded.Remove(entry.RelativePath); CancelSelectedReveal(); return; }
        var page = Page(entry.RelativePath);
        if (page.Total < 0 || page.Error is not null) await LoadDirectoryAsync(entry.RelativePath, false);
    }
    private async Task ActivateAsync(WorkspaceFileEntry entry)
    {
        if (entry.IsDirectory) await ToggleAsync(entry);
        else await OnOpen.InvokeAsync(entry);
    }
    private async Task OpenSearchEntryAsync(WorkspaceFileEntry entry)
    {
        if (!entry.IsDirectory) { await OnOpen.InvokeAsync(entry); return; }
        // Search results retain a full relative path; opening a folder reveals its real ancestors.
        _searchCancellation?.Cancel(); _searchEpoch++; _searchPending = false; _searchText = ""; _rootCollapsed = false;
        var epoch = _epoch;
        await RevealPathAsync(entry.RelativePath, true, () => !_disposed && epoch == _epoch && !IsSearching);
        await RevealSelectedAsync();
        StateHasChanged();
    }
    private async Task RevealSelectedAsync()
    {
        if (_disposed || IsSearching || _pendingSelectedPath is not { } selected) return;
        var version = _selectionVersion; var epoch = _epoch;
        if (_activeRevealVersion == version && _activeRevealEpoch == epoch) return;
        _activeRevealVersion = version; _activeRevealEpoch = epoch;
        bool Current() => !_disposed && !IsSearching && epoch == _epoch && version == _selectionVersion;
        try
        {
            var found = await RevealPathAsync(selected, false, Current);
            if (!Current()) return;
            // A missing path is a bounded attempt, not a reason to retry on every revision.
            _pendingSelectedPath = null;
            if (found) { _scrollSelectedPath = selected; StateHasChanged(); }
        }
        finally
        {
            if (_activeRevealVersion == version && _activeRevealEpoch == epoch) _activeRevealVersion = -1;
        }
    }
    private async Task<bool> RevealPathAsync(string target, bool expandTarget, Func<bool> current)
    {
        var path = "";
        foreach (var part in target.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (!current()) return false;
            var wanted = path.Length == 0 ? part : path + "/" + part;
            var page = Page(path);
            bool ContainsWanted() => page.Entries.Any(e => StringComparer.OrdinalIgnoreCase.Equals(e.RelativePath, wanted));
            // Newly created files can be absent from an already loaded directory snapshot.
            if (!ContainsWanted()) await LoadDirectoryAsync(path, false, page.Entries.Count);
            if (!current()) return false;
            while (!ContainsWanted() && page.NextOffset < page.Total && page.Error is null)
            {
                var previousOffset = page.NextOffset;
                await LoadDirectoryAsync(path, true);
                if (!current() || page.NextOffset <= previousOffset) return false;
            }
            if (page.Error is not null || !ContainsWanted()) return false;
            var entry = page.Entries.First(e => StringComparer.OrdinalIgnoreCase.Equals(e.RelativePath, wanted));
            var isTarget = StringComparer.OrdinalIgnoreCase.Equals(wanted, target.Replace('\\', '/'));
            if (!entry.IsDirectory && !isTarget) return false;
            _rootCollapsed = false;
            if (entry.IsDirectory && (!isTarget || expandTarget)) _expanded.Add(entry.RelativePath);
            path = wanted;
            if (isTarget && expandTarget && entry.IsDirectory && Page(path).Total < 0)
                await LoadDirectoryAsync(path, false);
        }
        return current();
    }
    private void CancelSelectedReveal()
    {
        _pendingSelectedPath = null; _scrollSelectedPath = null; _selectionVersion++;
    }
    private async Task SearchChangedAsync(ChangeEventArgs args)
    {
        _searchText = args.Value?.ToString() ?? "";
        await CloseMenuAsync();
        _searchCancellation?.Cancel(); _searchCancellation?.Dispose(); _searchCancellation = new();
        var token = _searchCancellation.Token; var epoch = ++_searchEpoch;
        _searchResults = new(); _searchPending = IsSearching;
        if (!IsSearching) { await RefreshAsync(); await RevealSelectedAsync(); return; }
        try
        {
            await Task.Delay(300, token);
            if (!token.IsCancellationRequested && epoch == _searchEpoch) await FetchSearchAsync(false, epoch, token);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
    }
    private async Task SearchAgainAsync()
    {
        _searchCancellation?.Cancel(); _searchCancellation?.Dispose(); _searchCancellation = new();
        var epoch = ++_searchEpoch;
        _searchResults = new(); _searchPending = true;
        await FetchSearchAsync(false, epoch, _searchCancellation.Token);
    }
    private async Task LoadMoreSearchAsync()
    {
        if (_searchPending || _searchCancellation is null) return;
        await FetchSearchAsync(true, _searchEpoch, _searchCancellation.Token);
    }
    private async Task FetchSearchAsync(bool append, long epoch, CancellationToken token)
    {
        var search = _searchText.Trim(); var workspaceEpoch = _epoch;
        var offset = append ? _searchResults.NextOffset : 0;
        _searchPending = true; _searchResults.Error = null;
        try
        {
            var result = await LoadPage("", offset, search, token);
            if (_disposed || epoch != _searchEpoch || workspaceEpoch != _epoch || token.IsCancellationRequested) return;
            ValidatePage(result, offset);
            _searchResults.Entries = (append ? _searchResults.Entries.Concat(result.Entries) : result.Entries).DistinctBy(e => e.RelativePath, StringComparer.OrdinalIgnoreCase).ToList();
            _searchResults.Total = result.Total; _searchResults.NextOffset = result.Offset + result.Entries.Length;
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception error)
        {
            if (epoch == _searchEpoch && workspaceEpoch == _epoch && !_disposed) _searchResults.Error = error.Message;
        }
        finally
        {
            if (epoch == _searchEpoch && workspaceEpoch == _epoch && !_disposed) { _searchPending = false; StateHasChanged(); }
        }
    }
    private void OpenContext(WorkspaceFileEntry entry, MouseEventArgs args)
    { _menuTarget = entry; _menuX = args.ClientX; _menuY = args.ClientY; _positionMenu = true; }
    [JSInvokable] public Task OpenKeyboardMenu(string path, double x, double y) => InvokeAsync(() =>
    {
        var entry = FindEntry(path);
        if (entry is null) return;
        _menuTarget = entry; _menuX = x; _menuY = y; _positionMenu = true; StateHasChanged();
    });
    [JSInvokable] public Task CloseMenuFromKeyboard() => InvokeAsync(CloseMenuAsync);
    [JSInvokable] public Task TreeArrow(string path, string direction) => InvokeAsync(async () =>
    {
        var entry = FindEntry(path);
        if (entry is null || IsSearching) return;
        if (path.Length == 0) { _rootCollapsed = direction == "ArrowLeft"; if (_rootCollapsed) CancelSelectedReveal(); }
        else if (direction == "ArrowRight" && entry.IsDirectory && !_expanded.Contains(path)) await ToggleAsync(entry);
        else if (direction == "ArrowLeft" && entry.IsDirectory && _expanded.Contains(path)) { _expanded.Remove(path); CancelSelectedReveal(); }
        else if (direction == "ArrowLeft" && _module is not null) await _module.InvokeVoidAsync("focusPath", _root, ParentPath(path));
        StateHasChanged();
    });
    private WorkspaceFileEntry? FindEntry(string path) => path.Length == 0 ? RootEntry :
        (IsSearching ? _searchResults.Entries : _pages.Values.SelectMany(p => p.Entries)).FirstOrDefault(e => e.RelativePath == path);
    private async Task CloseMenuAsync()
    {
        var wasOpen = _menuTarget is not null; _menuTarget = null; _positionMenu = false;
        if (wasOpen && _module is not null) await _module.InvokeVoidAsync("hideMenu", _root);
        if (!_disposed) StateHasChanged();
    }
    private async Task MenuActionAsync(string action)
    {
        if (_menuTarget is not { } target) return;
        await CloseMenuAsync();
        if (action == "open")
        {
            if (target.IsDirectory)
            {
                if (IsSearching) await OpenSearchEntryAsync(target);
                else if (target.RelativePath.Length == 0) _rootCollapsed = false;
                else if (!_expanded.Contains(target.RelativePath)) await ToggleAsync(target);
            }
            else await OnOpen.InvokeAsync(target);
            return;
        }
        await EmitAsync(action, target);
    }
    private Task EmitAsync(string action, WorkspaceFileEntry target)
    {
        if (action is "new-note" or "new-folder" && !target.IsDirectory)
        {
            var parent = ParentPath(target.RelativePath);
            target = parent.Length == 0 ? RootEntry : new(parent, parent.Split('/').Last(), true);
        }
        return OnAction.InvokeAsync(new ExplorerAction(action, target));
    }
    private static string ParentPath(string path)
    { path = path.Replace('\\', '/'); var at = path.LastIndexOf('/'); return at < 0 ? "" : path[..at]; }
    private void CancelRequests()
    {
        _searchEpoch++; _searchCancellation?.Cancel();
        foreach (var page in _pages.Values) { page.Cancellation?.Cancel(); page.Loading = false; }
    }
    public async ValueTask DisposeAsync()
    {
        _disposed = true; _epoch++; CancelRequests(); _searchCancellation?.Dispose();
        foreach (var page in _pages.Values) page.Cancellation?.Dispose();
        if (_module is not null)
        {
            try { await _module.InvokeVoidAsync("detach", _root); await _module.DisposeAsync(); }
            catch (JSDisconnectedException) { }
        }
        _receiver?.Dispose();
    }
    private sealed class DirectoryPage
    {
        public List<WorkspaceFileEntry> Entries { get; set; } = [];
        public int Total { get; set; } = -1;
        public int NextOffset { get; set; }
        public bool Loading { get; set; }
        public string? Error { get; set; }
        public long Request { get; set; }
        public CancellationTokenSource? Cancellation { get; set; }
    }
    private record TreeRow(WorkspaceFileEntry? Entry, string Parent, int Depth, DirectoryPage? Page);
}
