using GraspPortable.Contracts;
using Microsoft.JSInterop;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private BackupStatusDto? _backups;
    private int _backupInterval=5, _backupRetention=3;
    private string _restoreGeneration="", _restoreDestination="";
    private string? _backupMessage;
    private bool _restoreComplete;
    private string BackupStatusText => _backups switch
    {
        { Status: "running" } => "正在處理備份或還原…",
        { Status: "failed" } => "最近一次備份或還原未完成；先前的完整備份仍保留。",
        { HasPendingChanges: true } => "有變更尚未備份；將依排程建立完整版本，也可立即備份。",
        { Generations.Length: 0 } => "尚無完整備份。",
        _ => "目前沒有待備份的變更。"
    };
    private Task RefreshBackupStatusAsync() => ModalActionAsync(ReadBackupStatusAsync);

    private async Task ShowBackupsAsync() => await GuardAsync(async () => {
        if(_switching)return;
        _switching=true; StateHasChanged();
        try
        {
            if(editor is not null)await editor.InvokeVoidAsync("freeze",true);
            if(!await SaveCurrentAsync()) return;
            _dialog="backups"; _backupMessage=null; _restoreComplete=false; _busy=true; StateHasChanged();
            await ReadBackupStatusAsync();
            _backupInterval=_backups!.Options.IntervalMinutes; _backupRetention=_backups.Options.RetainedCopies;
            _restoreDestination=Backend.WorkspacePath+"-Restored-"+DateTime.Now.ToString("yyyyMMdd-HHmmss");
        }
        finally { _busy=false; _switching=false; if(editor is not null)await editor.InvokeVoidAsync("freeze",false); StateHasChanged(); }
    });

    private async Task ReadBackupStatusAsync()
    {
        _backups=await Backend.GetAsync<BackupStatusDto>("api/backups");
        if(!_backups.Generations.Any(g=>g.Path==_restoreGeneration)) _restoreGeneration=_backups.Generations.FirstOrDefault()?.Path??"";
    }

    private async Task CaptureBackupAsync() => await ModalActionAsync(async () => {
        var result=await Backend.SendAsync<BackupResultDto>(HttpMethod.Post,"api/backups/capture",new CheckpointRequest(Guid.NewGuid().ToString("N")));
        _backupMessage=result.Path is not null?"已建立完整備份："+result.Path:"備份狀態："+result.Status;
        if(result.Issues.Length>0) _backupMessage+="\n"+string.Join("\n",result.Issues.Select(i=>i.Path+" "+i.Message));
        if(result.Status=="published" && result.Path is not null) _restoreGeneration=result.Path;
        _restoreComplete=false;
        await ReadBackupStatusAsync();
    });

    private async Task SaveBackupSettingsAsync() => await ModalActionAsync(async () => {
        if(_backups is null) return;
        var result=await Backend.SendAsync<BackupResultDto>(HttpMethod.Post,"api/backups/settings",
            new BackupSettingsRequest(Guid.NewGuid().ToString("N"),_backups.Options.Version,_backupInterval,_backupRetention));
        _backupMessage=result.Issues.Length==0?"備份設定已保存。":string.Join("\n",result.Issues.Select(i=>i.Message));
        await ReadBackupStatusAsync();
    });

    private async Task RestoreBackupAsync() => await ModalActionAsync(async () => {
        if(_restoreGeneration.Length==0||string.IsNullOrWhiteSpace(_restoreDestination))return;
        var result=await Backend.SendAsync<BackupResultDto>(HttpMethod.Post,"api/backups/restore",
            new RestoreBackupRequest(Guid.NewGuid().ToString("N"),_restoreGeneration,_restoreDestination.Trim()));
        if(result.Path is null || result.Status!="restored") throw new InvalidOperationException(string.Join("\n",result.Issues.Select(i=>i.Message)));
        _backupMessage="已還原至新工作區："+result.Path+"。可使用「開啟還原的工作區」檢查。";
        _restoreDestination=result.Path;
        _restoreComplete=true;
        if(result.Issues.Length>0)_backupMessage+="\n"+string.Join("\n",result.Issues.Select(i=>i.Message));
    });

    private async Task OpenRestoredWorkspaceAsync()
    {
        _workspacePath=_restoreDestination;
        await ChangeWorkspaceAsync();
    }
}
