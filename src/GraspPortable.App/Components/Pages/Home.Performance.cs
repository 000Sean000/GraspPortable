using Microsoft.JSInterop;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private IJSObjectReference? _performance;
    private string? _performancePath;
    private readonly HashSet<string> _performanceSeenNotes=[];
    private async Task StartPerformanceAsync()
    {
        if(Environment.GetEnvironmentVariable("GRASP_MEASURE_UI")!="1")return;
        _performance=await JS.InvokeAsync<IJSObjectReference>("import","./performance-probe.js");
        await _performance.InvokeVoidAsync("start");
        _performancePath=Path.Combine(Backend.WorkspacePath,".grasp","measurements","ui-"+DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+".json");
        if(_note is not null)_performanceSeenNotes.Add(_note.Id);
    }
    private async Task<int> BeginPerformanceAsync(string kind)=>_performance is null?0:await _performance.InvokeAsync<int>("begin",kind);
    private async Task EndPerformanceAsync(int span,bool accepted=true)
    {if(span!=0&&_performance is not null)await _performance.InvokeVoidAsync("end",span,accepted);}
    private async Task SavePerformanceAsync()
    {
        if(_performance is null||_performancePath is null)return;
        var report=await _performance.InvokeAsync<string>("report",true);
        await Task.Run(async()=>{Directory.CreateDirectory(Path.GetDirectoryName(_performancePath)!);await File.WriteAllTextAsync(_performancePath,report);});
    }
}
