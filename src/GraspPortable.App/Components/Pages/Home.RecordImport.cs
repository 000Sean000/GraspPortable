using GraspPortable.App.Workspace.Files;
using GraspPortable.Contracts;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private string _importSourceId="",_importSourcePath="",_importTitle="",_importKey="Imported";
    private int _importTable=1;
    private RecordImportPreview? _importPreview;
    private RecordImportFieldMapping[] _importMappings=[];
    private async Task ShowRecordImportAsync(ExplorerAction action)
    {
        if(action.Target.NoteId is null||!await SaveCurrentAsync())return;
        _importSourceId=action.Target.NoteId;_importSourcePath=action.Target.RelativePath;
        _importTitle=Path.GetFileNameWithoutExtension(action.Target.Name)+" 資料表";
        _importKey="Imported";_importTable=1;_importPreview=null;_importMappings=[];
        _dialog="record-import";
    }
    private async Task PreviewRecordImportAsync()=>await ModalActionAsync(async()=>{
        _importPreview=await Backend.SendAsync<RecordImportPreview>(HttpMethod.Post,"api/record-import/preview",
            new RecordImportPreviewRequest(_importSourceId,_importTable-1,_importTitle,_importKey,_importMappings.Length==0?null:_importMappings));
        if(_importPreview.Columns.Length>0)_importMappings=_importPreview.Columns.Select(c=>new RecordImportFieldMapping(c.ColumnIndex,c.Key,c.DisplayName,c.Kind)).ToArray();
    });
    private void ImportMappingChanged(int index,string? key=null,string? label=null)
    {
        var before=_importMappings[index];_importMappings[index]=before with{Key=key??before.Key,DisplayName=label??before.DisplayName};_importPreview=null;
    }
    private async Task ApplyRecordImportAsync()=>await ModalActionAsync(async()=>{
        if(_importPreview is not {CanApply:true})return;
        var command=new RecordImportApplyRequest(Guid.NewGuid().ToString("N"),_importPreview.PreviewId);
        var result=await Backend.CommandAsync("api/record-import/apply",command,command.OperationId);
        if(result.Status!="committed")throw new InvalidOperationException(result.Message??"轉換尚未完成，原筆記保留。");
        _dialog=null;_filesRefresh++;await RefreshAfterSharedAsync();_recordsVisible=true;
        _notice="已建立新的縱向 Markdown 資料表；原筆記保留，可供核對與恢復。";
    });
}
