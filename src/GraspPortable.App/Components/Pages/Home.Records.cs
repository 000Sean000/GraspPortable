namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private bool _recordsVisible;
    private async Task ShowRecordsAsync()=>await GuardAsync(async()=>{
        if(await SaveCurrentAsync())_recordsVisible=true;
    });
    private async Task OpenRecordSourceAsync(string noteId)=>await GuardAsync(async()=>{
        await SelectNoteAsync(noteId);
        if(_note?.Id==noteId)_recordsVisible=false;
    });
}
