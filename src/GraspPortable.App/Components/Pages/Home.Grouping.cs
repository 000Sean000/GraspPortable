using GraspPortable.App.Workspace.Files;
using GraspPortable.Contracts;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private GroupingSourceDto[] _groupingSources=[];
    private readonly HashSet<string> _groupingSelected=new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string,string> _splitTargets=new(StringComparer.Ordinal);
    private string _groupingAction="merge", _groupingDestination="", _groupingPreservation="", _groupingSearch="";
    private GroupingPreview? _groupingPreview;
    private int _groupingVisible=50;
    private IEnumerable<GroupingSourceDto> FilteredGroupingSources => _groupingSources.Where(s=>
        s.RelativePath.Contains(_groupingSearch,StringComparison.OrdinalIgnoreCase));

    private async Task ShowGroupingAsync(ExplorerAction action)
    {
        if(!await SaveCurrentAsync()) return;
        _groupingSources=await Backend.GetAsync<GroupingSourceDto[]>("api/grouping/sources");
        var source=_groupingSources.SingleOrDefault(s=>s.RelativePath.Equals(action.Target.RelativePath,StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("來源已變動，請重新整理檔案。");
        _groupingAction=action.Action=="group-merge"?"merge":"split";
        if(_groupingAction=="split"&&!source.IsGrouped) { _notice="這個實體檔案只有一篇筆記，尚未合併，不需要拆分。"; return; }
        _groupingSelected.Clear(); _groupingSelected.Add(source.RelativePath); _splitTargets.Clear();
        _groupingSearch=""; _groupingVisible=50; _groupingPreview=null;
        var parent=Path.GetDirectoryName(source.RelativePath.Replace('/',Path.DirectorySeparatorChar))?.Replace('\\','/')??"";
        var stem=Path.GetFileNameWithoutExtension(source.RelativePath);
        string At(string name)=>parent.Length==0?name:parent+"/"+name;
        _groupingDestination=At(stem+"-合併.md"); _groupingPreservation=At(stem+"-分組保留.json");
        foreach(var member in source.Members)
        {
            var invalid=Path.GetInvalidFileNameChars();
            var name=new string(member.Title.Select(c=>invalid.Contains(c)?'_':c).ToArray()).Trim().TrimEnd('.');
            if(string.IsNullOrWhiteSpace(name)) name="筆記";
            _splitTargets[member.Id]=At(name+"-"+member.Id[..8]+".md");
        }
        _dialog="grouping";
    }
    private void ToggleGroupingSource(string path,bool selected)
    {
        if(selected)_groupingSelected.Add(path); else _groupingSelected.Remove(path);
        _groupingPreview=null;
    }
    private async Task PreviewGroupingAsync()=>await ModalActionAsync(async()=>{
        _groupingPreview=await Backend.SendAsync<GroupingPreview>(HttpMethod.Post,"api/grouping/preview",
            new GroupingPreviewRequest(_groupingAction,_groupingSelected.Order(StringComparer.Ordinal).ToArray(),
                _groupingAction=="merge"?_groupingDestination.Trim():null,
                _groupingAction=="split"?_splitTargets.Select(x=>new GroupingSplitTarget(x.Key,x.Value.Trim())).ToArray():null,
                _groupingPreservation.Trim()));
    });
    private async Task ApplyGroupingAsync()=>await ModalActionAsync(async()=>{
        if(_groupingPreview is not {CanApply:true})return;
        var command=new GroupingApplyRequest(Guid.NewGuid().ToString("N"),_groupingPreview.PreviewId);
        var result=await Backend.CommandAsync("api/grouping/apply",command,command.OperationId);
        if(result.Status is not ("files-written" or "committed")) throw new InvalidOperationException(result.Message??"分組操作尚未完成。");
        _dialog=null; _filesRefresh++;
        await RefreshAfterSharedAsync(); await RefreshSourceStatusAsync();
        _notice="檔案分組已完成；筆記身分保留，原版本可從恢復日誌取回。";
    });
}
