namespace GraspPortable.App.PlatformServices;

public sealed class WorkspaceFolderPicker
{
    public async Task<string?> PickAsync()
    {
        var window = (Microsoft.UI.Xaml.Window?)Microsoft.Maui.Controls.Application.Current?.Windows.FirstOrDefault()?.Handler?.PlatformView;
        if(window is null) return null;
        var picker = new Windows.Storage.Pickers.FolderPicker();
        picker.FileTypeFilter.Add("*");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(window));
        return (await picker.PickSingleFolderAsync())?.Path;
    }
}
