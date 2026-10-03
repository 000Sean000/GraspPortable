using GraspPortable.App.Backend;
using GraspPortable.App.PlatformServices;
using Microsoft.Extensions.Logging;
using Microsoft.Maui.LifecycleEvents;

namespace GraspPortable.App;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder.UseMauiApp<App>().ConfigureFonts(fonts => fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular"));
        builder.Services.AddMauiBlazorWebView();
        builder.Services.AddSingleton<BackendSession>();
        builder.Services.AddSingleton<WorkspaceFolderPicker>();
        builder.ConfigureLifecycleEvents(events => events.AddWindows(windows => windows.OnWindowCreated(window =>
        {
            window.AppWindow.Closing += async (_, args) =>
            {
                var backend = IPlatformApplication.Current!.Services.GetRequiredService<BackendSession>();
                if(backend.AllowNativeClose) return;
                args.Cancel = true;
                if(backend.Closing) return;
                backend.Closing = true;
                try
                {
                    if(backend.BeforeClose is not null && !await backend.BeforeClose()) return;
                    await backend.StopAsync();
                    backend.AllowNativeClose = true;
                    window.Close();
                }
                finally { backend.Closing = false; }
            };
        })));
#if DEBUG
        builder.Services.AddBlazorWebViewDeveloperTools();
        builder.Logging.AddDebug();
#endif
        return builder.Build();
    }
}
