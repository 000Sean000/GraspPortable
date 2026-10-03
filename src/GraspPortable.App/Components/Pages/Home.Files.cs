using GraspPortable.App.Workspace.Files;
using GraspPortable.Contracts;
using Microsoft.AspNetCore.Components;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private long _filesRefresh;
    private string _newParent="", _fileDestination="";
    private ExplorerAction? _fileAction;
    private FileActionPreview? _filePreview;
    private WorkspaceSourceStatus? _sourceStatus;
    private ElementReference _fileDestinationInput;
    private bool _focusFileDestination;

    private static string SavedStatus(NoteDto note) => note.SourceStatus switch {
        "accepted" => "原文已保存 · revision "+note.KnowledgeRevision,
        "missing" => "檔案已刪除 · 保留最後原文與草稿",
        "unavailable" => "檔案身分或格式待處理 · 顯示最後可讀原文",
        "conflict" => "外部原文已保留 · 需要合併",
        _ => "原文已保存 · 尚未接受語意更新"
    };

    private Task<WorkspaceFilePage> ReadFilesAsync(string parent, int offset, string? search, CancellationToken token) =>
        Backend.GetAsync<WorkspaceFilePage>("api/files?parent="+Uri.EscapeDataString(parent)+"&offset="+offset
            +(search is null ? "" : "&search="+Uri.EscapeDataString(search)), token);

    private async Task RefreshSourceStatusAsync()
    {
        if(Backend.Connected) _sourceStatus=await Backend.GetAsync<WorkspaceSourceStatus>("api/workspace/sources");
    }

    private async Task OpenFileAsync(WorkspaceFileEntry entry) => await GuardAsync(async () => {
        if(entry.NoteId is not null) await SelectNoteAsync(entry.NoteId);
        else if(Path.GetExtension(entry.Name).Equals(".md",StringComparison.OrdinalIgnoreCase))
        {
            await RefreshSourceStatusAsync();
            _notice="這篇 Markdown 尚未完成來源核對，請查看來源問題或在檔案總管開啟。";
        }
        else await PlatformServices.WorkspaceFileLauncher.OpenAttachmentAsync(Backend.WorkspacePath,entry.RelativePath);
    });

    private async Task HandleExplorerActionAsync(ExplorerAction action) => await GuardAsync(async () => {
        switch(action.Action)
        {
            case "new-note": ShowCreateAt(action.Target.RelativePath); return;
            case "copy-relative-path":
                await Microsoft.Maui.ApplicationModel.DataTransfer.Clipboard.Default.SetTextAsync(action.Target.RelativePath);
                _notice="已複製相對路徑。"; return;
            case "reveal": PlatformServices.WorkspaceFileLauncher.Reveal(Backend.WorkspacePath,action.Target.RelativePath); return;
        }
        if(!await SaveCurrentAsync()) return;
        _fileAction=action; _filePreview=null;
        _fileDestination=action.Action switch { "new-folder" => "新資料夾", "rename" => action.Target.Name, _ => action.Target.RelativePath };
        _focusFileDestination=true;
        _dialog="file-action";
    });

    private async Task PreviewFileActionAsync() => await ModalActionAsync(async () => {
        if(_fileAction is null) return;
        _filePreview=await Backend.SendAsync<FileActionPreview>(HttpMethod.Post,"api/files/preview",
            new FileActionPreviewRequest(_fileAction.Action,_fileAction.Target.RelativePath,FileDestination()));
    });

    private string FileDestination()
    {
        if(_fileAction is null) return "";
        var input=_fileDestination.Trim();
        if(_fileAction.Action=="move") return input;
        if(input.Contains('/')||input.Contains('\\')) throw new InvalidOperationException("名稱中請不要輸入資料夾分隔符號；搬移可使用相對路徑。");
        var parent=_fileAction.Action=="new-folder"?_fileAction.Target.RelativePath
            : Path.GetDirectoryName(_fileAction.Target.RelativePath.Replace('/',Path.DirectorySeparatorChar))?.Replace('\\','/')??"";
        return parent.Length==0?input:parent+"/"+input;
    }

    private async Task ApplyFileActionAsync() => await ModalActionAsync(async () => {
        if(_filePreview is not { CanApply:true }) return;
        var command=new FileActionApplyRequest(Guid.NewGuid().ToString("N"),_filePreview.PreviewId);
        var result=await Backend.CommandAsync("api/files/apply",command,command.OperationId);
        if(result.Status is not ("files-written" or "committed")) throw new InvalidOperationException(result.Message??"檔案操作尚未完成。");
        _dialog=null; _filesRefresh++;
        await RefreshAfterSharedAsync(); await RefreshSourceStatusAsync();
        _notice="檔案操作已完成，目錄已更新。";
    });
}
