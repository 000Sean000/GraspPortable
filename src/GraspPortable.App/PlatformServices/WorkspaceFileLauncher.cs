using System.Diagnostics;

namespace GraspPortable.App.PlatformServices;

public static class WorkspaceFileLauncher
{
    private static string Resolve(string root, string relative)
    {
        var fullRoot=Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        var full=Path.GetFullPath(Path.Combine(fullRoot,relative.Replace('/',Path.DirectorySeparatorChar)));
        if(full!=fullRoot && !full.StartsWith(fullRoot+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("路徑超出工作區。");
        for(var path=full;path is not null;path=Path.GetDirectoryName(path))
            if(File.Exists(path)||Directory.Exists(path))
                if((File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0) throw new IOException("不開啟重新導向至其他位置的連結。");
        return full;
    }

    public static void Reveal(string root, string relative)
    {
        var full=Resolve(root,relative);
        if(!File.Exists(full)&&!Directory.Exists(full)) throw new FileNotFoundException("檔案或資料夾不存在。",full);
        var start=new ProcessStartInfo("explorer.exe") { UseShellExecute=false };
        if(File.Exists(full)) start.ArgumentList.Add("/select,");
        start.ArgumentList.Add(full);
        Process.Start(start)?.Dispose();
    }

    public static async Task OpenAttachmentAsync(string root, string relative)
    {
        var full=Resolve(root,relative);
        var extension=Path.GetExtension(full);
        if(!new[]{".png",".jpg",".jpeg",".webp",".gif",".bmp",".pdf",".txt",".mp3",".mp4",".wav"}.Contains(extension,StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException("此檔案類型請從右鍵選單開啟所在位置，再選擇適合的程式。");
        await Microsoft.Maui.ApplicationModel.Launcher.Default.OpenAsync(new Microsoft.Maui.ApplicationModel.OpenFileRequest {
            File=new Microsoft.Maui.Storage.ReadOnlyFile(full)
        });
    }
}
