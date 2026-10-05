namespace GraspPortable.App.Components.Pages;

// Compile the actual Home create-opening methods without MAUI. The save callback
// models the existing departure guard; these tests verify its UI sequencing.
public partial class Home
{
    private string _newParent="existing-parent", _newTitle="existing-title";
    private string? _dialog;
    private bool _focusNewTitle, _busy;
    public required Func<Task<bool>> Save { get; init; }
    public (string Parent,string Title,string? Dialog,bool Focus) State => (_newParent,_newTitle,_dialog,_focusNewTitle);
    public Task OpenCreateAsync(string? parent=null) => parent is null?ShowCreate():ShowCreateAt(parent);
    public void ShowDepartureDialog(string dialog) => _dialog=dialog;
    public void EnterTitle(string title) => _newTitle=title;
    public void FinishOrCancelCreate() => ClearCreateForm();
    public void EnterWorkspace(string path) => EnterCreateWorkspace(path);
    private Task<bool> SaveCurrentAsync() => Save();
    private async Task ModalActionAsync(Func<Task> action)
    {
        if(_busy)return;
        _busy=true;
        try {await action();} finally {_busy=false;}
    }
}
