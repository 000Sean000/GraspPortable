using Microsoft.JSInterop;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private IJSObjectReference? _performance;
    private string? _performancePath;
    private readonly HashSet<string> _performanceSeenNotes=[];
    private sealed record NotePaintState(string Workspace,string? Note,long Generation,long Content,long Revision,string Mode,bool Records);
    private NotePaintState? _notePaintState;
    private long _notePaintVersion;
    private string NotePaintToken
    {
        get
        {
            var current=new NotePaintState(Backend.WorkspacePath,_note?.Id,_contextGeneration,_contentVersion,_noteRevision,_mode,_recordsVisible);
            if(current!=_notePaintState){_notePaintState=current;_notePaintVersion++;}
            return _notePaintVersion.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
    }
    private async Task StartPerformanceAsync()
    {
        if(Environment.GetEnvironmentVariable("GRASP_MEASURE_UI")!="1")return;
        try
        {
        _performance=await JS.InvokeAsync<IJSObjectReference>("import","./performance-probe.js");
        await _performance.InvokeVoidAsync("start");
        _performancePath=Path.Combine(Backend.WorkspacePath,".grasp","measurements","ui-"+DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+".json");
        if(_note is not null)_performanceSeenNotes.Add(_note.Id);
        }
        catch(Exception) {_performance=null;} // Optional measurement must not alter editing or saving.
    }
    private async Task<int> BeginPerformanceAsync(string kind)
    {
        try {return _performance is null?0:await _performance.InvokeAsync<int>("begin",kind);}
        catch(Exception) {return 0;}
    }
    private async Task EndPerformanceAsync(int span,bool accepted=true)
    {
        if(span==0||_performance is null)return;
        try
        {
            StateHasChanged();
            await _performance.InvokeVoidAsync("end",span,accepted&&!_recordsVisible,
                new {rootId="note-performance-root",attribute="data-home-paint-token",token=NotePaintToken});
        }
        catch(Exception) { }
    }
    private async Task SavePerformanceAsync()
    {
        if(_performance is null||_performancePath is null)return;
        try
        {
            var report=await _performance.InvokeAsync<string>("report",true);
            await Task.Run(async()=>{Directory.CreateDirectory(Path.GetDirectoryName(_performancePath)!);await File.WriteAllTextAsync(_performancePath,report);});
        }
        catch(Exception error) {System.Diagnostics.Debug.WriteLine("UI measurement report failed: "+error.Message);}
    }
}
