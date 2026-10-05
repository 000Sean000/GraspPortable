namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private bool _hasNewNoteForm;
    private string? _newNoteWorkspace;
    private Task ShowCreate() => ShowCreateAt("");
    private async Task ShowCreateAt(string parent) => await ModalActionAsync(async () =>
    {
        // Resolve departure before asking for a title: a conflict/rename dialog
        // must not replace a new-note form the user has already filled in.
        if(!await SaveCurrentAsync())return;
        if(!_hasNewNoteForm) {_newParent=parent; _newTitle=""; _hasNewNoteForm=true;}
        _dialog="create"; _focusNewTitle=true;
    });
    private void ClearCreateForm() => _hasNewNoteForm=false;
    private void EnterCreateWorkspace(string path)
    {
        if(string.Equals(_newNoteWorkspace,path,StringComparison.OrdinalIgnoreCase))return;
        ClearCreateForm(); _newNoteWorkspace=path;
    }
}
