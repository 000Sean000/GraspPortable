using System.Net.Http;
using GraspPortable.Contracts;
using Microsoft.JSInterop;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    [JSInvokable]
    public async Task<string?> OnResolveImage(string originNoteId, string target, bool isWiki = false)
    {
        var generation = _contextGeneration;
        var current = _note?.Id;
        if (current is null || !Backend.Connected || string.IsNullOrWhiteSpace(originNoteId)) return null;
        try
        {
            // BackendSession owns the loopback credential; JavaScript receives only image data.
            var result = await Backend.SendAsync<ContentImageDto>(HttpMethod.Post, "api/content/image",
                new ContentResolveRequest(originNoteId, target, isWiki));
            return generation == _contextGeneration && current == _note?.Id && result.Status == "resolved" ? result.DataUrl : null;
        }
        catch (Exception error) when (error is HttpRequestException or InvalidOperationException or OperationCanceledException)
        {
            return null; // The requesting image retains a visible failure placeholder.
        }
    }

    [JSInvokable]
    public Task OnLocalLink(string originNoteId, string target, bool isWiki = false) => InvokeAsync(() => GuardAsync(async () =>
    {
        if (_note is null || _switching || string.IsNullOrWhiteSpace(originNoteId)) return;
        var current = _note.Id;
        var generation = _contextGeneration;
        var result = await Backend.SendAsync<ContentLinkDto>(HttpMethod.Post, "api/content/link",
            new ContentResolveRequest(originNoteId, target, isWiki));
        if (generation != _contextGeneration || current != _note?.Id) return;
        if (result.Status != "resolved")
        {
            _notice = result.Message ?? "找不到連結，或存在多個同名目標。";
            StateHasChanged(); return;
        }
        if (result.NoteId is { } destination)
        {
            await OpenNoteLinkAsync(destination, result.Anchor);
        }
        else if (result.RelativePath is { } path)
        {
            // The existing launcher allows passive attachment types, never arbitrary executables.
            await PlatformServices.WorkspaceFileLauncher.OpenAttachmentAsync(Backend.WorkspacePath, path);
        }
        else _notice = result.Message ?? "這個連結目前無法開啟。";
        StateHasChanged();
    }));

    private async Task OpenNoteLinkAsync(string destination, string? anchor)
    {
        await SelectNoteAsync(destination);
        if (_note?.Id != destination) return; // Saving / draft conflict may stop navigation.
        _recordsVisible = false;
        if (string.IsNullOrEmpty(anchor)) return;
        if (anchor.TrimStart('#').StartsWith('^'))
            _notice = "已開啟筆記；目前尚未支援 block anchor 定位。";
        else if (editor is not null)
        {
            await ChangeModeAsync("reading");
            if (_mode == "reading" && !await editor.InvokeAsync<bool>("scrollToContentAnchor", anchor))
                _notice = "已開啟筆記，但找不到指定標題：" + anchor;
        }
    }
}
