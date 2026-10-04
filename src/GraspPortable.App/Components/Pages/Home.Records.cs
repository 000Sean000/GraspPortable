using GraspPortable.App.Records;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private bool _recordsVisible;
    private string _recordsInitialCollectionId = "";
    private async Task ShowRecordsAsync()=>await GuardAsync(async()=>{
        if(await SaveCurrentAsync())_recordsVisible=true;
    });
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
