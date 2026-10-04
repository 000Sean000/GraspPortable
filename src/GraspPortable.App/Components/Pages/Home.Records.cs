using GraspPortable.App.Records;
using Microsoft.JSInterop;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private bool _recordsVisible;
    private string _recordsInitialCollectionId = "";
    private string _recordsInitialRecordId = "";
    private async Task ShowRecordsAsync()=>await GuardAsync(async()=>{
        if(await SaveCurrentAsync()){_recordsInitialRecordId="";_recordsVisible=true;}
    });
    [JSInvokable]
    public Task OnRecordLink(string recordId) => InvokeAsync(() => GuardAsync(async () =>
    {
        if (_switching || !Backend.Connected || !Guid.TryParseExact(recordId, "N", out _)) return;
        var generation = _contextGeneration;
        var workspace = Backend.Workspace?.WorkspaceId;
        _switching = true;
        try
        {
            if (editor is not null) await editor.InvokeVoidAsync("freeze", true);
            if (!await SaveCurrentAsync() || generation != _contextGeneration || workspace != Backend.Workspace?.WorkspaceId) return;
            _recordsInitialRecordId = recordId;
            _recordsVisible = true;
        }
        finally
        {
            _switching = false;
            if (editor is not null) await editor.InvokeVoidAsync("freeze", false);
            StateHasChanged();
        }
    }));
    private void RecordRequestHandled(string recordId)
    {
        if (_recordsInitialRecordId == recordId) _recordsInitialRecordId = "";
    }
    private void RememberRecordCollection(string collectionId) => _recordsInitialCollectionId = collectionId;
    private async Task OpenRecordSourceAsync(string noteId)=>await GuardAsync(async()=>{
        await SelectNoteAsync(noteId);
        if(_note?.Id==noteId)_recordsVisible=false;
    });
    private async Task NavigateRecordContentAsync(RecordsContentNavigation navigation) => await GuardAsync(async () =>
    {
        if (navigation.DefinitionName is { } name) await NavigateToDefinitionAsync(name);
        else if (navigation.NoteId is { } id) await OpenNoteLinkAsync(id, navigation.Anchor);
    });
}
