namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private bool _recordsVisible;
    private string _recordsInitialCollectionId = "";
    private async Task ShowRecordsAsync()=>await GuardAsync(async()=>{
        if(await SaveCurrentAsync()){_recordsInitialCollectionId="";_recordsVisible=true;}
    });
    private async Task OpenRecordSourceAsync(string noteId)=>await GuardAsync(async()=>{
        await SelectNoteAsync(noteId);
        if(_note?.Id==noteId)_recordsVisible=false;
    });
}
