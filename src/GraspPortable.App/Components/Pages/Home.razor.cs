using System.Net.Http;
using System.Text.RegularExpressions;
using GraspPortable.Contracts;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.JSInterop;

namespace GraspPortable.App.Components.Pages;

public partial class Home
{
    private IJSObjectReference? editor;
    private DotNetObjectReference<Home>? receiver;
    private readonly SemaphoreSlim writes = new(1,1);
    private readonly SemaphoreSlim patches = new(1,1);
    private CancellationTokenSource? debounce, searchCancellation;
    private NoteSummary[] _notes = [];
    private NoteSummary[] _affectedDraftNotes = [];
    private ElementReference _newTitleInput;
    private bool _focusNewTitle;
    private DefinitionDto[] _definitions = [];
    private ReferenceDto[] _references = [];
    private DiagnosticDto[] _diagnostics = [];
    private NoteDto? _note, _conflictNote;
    private DefinitionDto? _selectedDefinition;
    private ImpactDto? _impact;
    private string _title="", _source="", _savedSource="", _savedTitle="", _sessionId=Guid.NewGuid().ToString("N");
    private string _search="", _newTitle="", _workspacePath="", _literalValue="", _languageText="grasp", _mergeSource="", _mergeTitle="", _insertName="";
    private string _mode="live", _saveStatus="正在準備工作區…";
    private string? _baseSourceHash;
    private string? _dialog, _error, _notice, _commitNotice;
    private long _draftRevision, _editorRevision, _contentVersion, _noteRevision, _knowledgeRevision, _contextGeneration;
    private bool _forceDraftSave, _hasDraft;
    private string _confirmationNoteId="", _confirmationSource="";
    private long _confirmationVersion, _confirmationGeneration;
    private bool _showInspector=true, _parseUnlabelled=true, _saving, _switching, _busy, _disposed;
    private CommitNoteRequest? _confirmationRequest;
    private OperationResult? _confirmationResult;
    private bool IsDirty => _note is not null && (_source != _note.Source || _title != _note.Title || _hasDraft);
    private string WorkspaceName => Path.GetFileName(Path.TrimEndingDirectorySeparator(Backend.WorkspacePath));

    protected override void OnInitialized()
    {
        Backend.Changed += BackendChanged;
        Backend.RevisionReceived += RevisionReceived;
        Backend.BeforeClose = BeforeCloseAsync;
    }
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if(_focusFileDestination && _dialog=="file-action")
        {
            _focusFileDestination=false;
            await _fileDestinationInput.FocusAsync();
        }
        if(_focusNewTitle && _dialog=="create")
        {
            _focusNewTitle=false;
            await _newTitleInput.FocusAsync();
        }
        if(!firstRender) return;
        receiver=DotNetObjectReference.Create(this);
        editor=await JS.InvokeAsync<IJSObjectReference>("import","./editor.js");
        await editor!.InvokeVoidAsync("mount","note-editor",receiver);
        await GuardAsync(async () => { await Backend.OpenAsync(Backend.WorkspacePath); await LoadWorkspaceAsync(); });
        if(Backend.Connected)await StartPerformanceAsync();
        if(!Backend.Connected) { _workspacePath=Backend.WorkspacePath; _dialog="workspace"; StateHasChanged(); }
    }
    private void BackendChanged() { if(!_disposed) _ = InvokeAsync(StateHasChanged); }
    private void RevisionReceived(RevisionEvent change)
    {
        if(_disposed) return;
        _ = InvokeAsync(async () =>
        {
            _knowledgeRevision=Math.Max(_knowledgeRevision,change.Revision);
            _filesRefresh++;
            try
            {
                await RefreshCollectionsAsync();
                await RefreshSourceStatusAsync();
                if(_note is not null && writes.CurrentCount != 0 && !_switching)
                {
                    if(!_notes.Any(n => n.Id == _note.Id))
                    {
                        if(IsDirty) { _notice="檔案已在外部刪除；目前編輯保留在畫面，請另存內容。"; return; }
                        _note=null; _source=""; _title=""; _saveStatus="檔案已在外部刪除";
                        await editor!.InvokeVoidAsync("setDocument","","",0,Array.Empty<ReferenceDto>(),true);
                        StateHasChanged(); return;
                    }
                    var baseline=_source; var version=_contentVersion; var generation=_contextGeneration;
                    var current=await Backend.GetAsync<NoteDto>("api/notes/"+_note.Id);
                    if(current.Id != _note?.Id) return;
                    if(!IsDirty) await ApplyFreshNoteAsync(current,baseline,version,generation);
                    else if(current.Revision != _noteRevision) _notice="相依內容已有較新提交；你的草稿保持不變，提交時會檢查衝突。";
                }
            }
            catch(Exception error) { _error=error.Message; }
            StateHasChanged();
        });
    }
    private async Task LoadWorkspaceAsync()
    {
        _recordsVisible=false;_recordsInitialCollectionId="";_recordsInitialRecordId="";
        _contextGeneration++;
        searchCancellation?.Cancel();
        _search=""; _insertName=""; _selectedDefinition=null; _references=[]; _diagnostics=[];
        _knowledgeRevision=Backend.Workspace?.Revision ?? 0;
        await RefreshCollectionsAsync();
        await RefreshSourceStatusAsync();
        if(_notes.FirstOrDefault() is { } first) await LoadNoteAsync(first.Id);
        else
        {
            _note=null; _source=""; _title=""; _saveStatus="尚未建立筆記";
            if(editor is not null) await editor!.InvokeVoidAsync("setDocument","","",0,Array.Empty<ReferenceDto>(),true);
        }
        if(Backend.Workspace?.MigratedFrom is { } previous)
            _notice=$"已建立 Markdown 工作區：{Backend.WorkspacePath}。原工作區保留於 {previous}。";
    }
    private async Task RefreshCollectionsAsync()
    {
        var generation=_contextGeneration; var workspace=Backend.Workspace?.WorkspaceId; var search=_search;
        var notesTask=Backend.GetAsync<NoteSummary[]>("api/notes?search="+Uri.EscapeDataString(_search));
        var definitionsTask=Backend.GetAsync<DefinitionDto[]>("api/definitions");
        await Task.WhenAll(notesTask,definitionsTask);
        if(generation!=_contextGeneration || workspace!=Backend.Workspace?.WorkspaceId || search!=_search)return;
        _notes=await notesTask; _definitions=await definitionsTask;
        if(_selectedDefinition is not null)
        {
            _selectedDefinition=_definitions.FirstOrDefault(d=>d.Id==_selectedDefinition.Id);
            if(_selectedDefinition is not null) _references=await Backend.GetAsync<ReferenceDto[]>("api/definitions/"+_selectedDefinition.Id+"/references");
        }
    }
    private async Task SearchChanged(ChangeEventArgs args)
    {
        _search=args.Value?.ToString()??"";
        searchCancellation?.Cancel(); searchCancellation?.Dispose(); searchCancellation=new();
        var token=searchCancellation.Token;
        try
        {
            await Task.Delay(180,token);
            var results=await Backend.GetAsync<NoteSummary[]>("api/notes?search="+Uri.EscapeDataString(_search),token);
            if(!token.IsCancellationRequested) _notes=results;
        }
        catch(OperationCanceledException) { }
        catch(Exception error) { _error=error.Message; }
    }
    private async Task SelectNoteAsync(string id)
    {
        if(_switching || id==_note?.Id) return;
        var measure=await BeginPerformanceAsync(IsDirty?"noteSwitchWithSave":_performanceSeenNotes.Contains(id)?"noteSwitchWarm":"noteSwitchFirst");
        _switching=true; StateHasChanged();
        await editor!.InvokeVoidAsync("freeze",true);
        try { await GuardAsync(async () =>
        {
            if(!await SaveCurrentAsync()) return;
            await LoadNoteAsync(id);
        }); }
        finally { _switching=false; await editor!.InvokeVoidAsync("freeze",false); StateHasChanged(); await EndPerformanceAsync(measure,_note?.Id==id);if(_note?.Id==id)_performanceSeenNotes.Add(id); }
    }
    // The caller owns switching / saving. Workspace changes already hold that guard.
    private async Task LoadNoteAsync(string id)
    {
        _contextGeneration++;
        var note=await Backend.GetAsync<NoteDto>("api/notes/"+id);
        _notice=null; _commitNotice=null;
        _note=note; _title=note.Draft?.Title??note.Title; _source=note.Draft?.Source??note.Source;
        _savedSource=_source; _savedTitle=_title; _noteRevision=note.Revision; _knowledgeRevision=Math.Max(_knowledgeRevision,note.KnowledgeRevision);
        _sessionId=note.Draft?.SessionId??Guid.NewGuid().ToString("N"); _draftRevision=note.Draft?.Revision??0;
        _baseSourceHash=note.Draft?.BaseSourceHash??note.SourceHash;
        _hasDraft=note.Draft is not null; _forceDraftSave=false;
        _editorRevision=0; _contentVersion=0; _diagnostics=note.Diagnostics; _selectedDefinition=null; _references=[];
        _saveStatus=note.Draft is null ? SavedStatus(note) : "草稿已恢復 · 尚未套用";
        await editor!.InvokeVoidAsync("setDocument",note.Id,_source,0,_source==note.Source?note.References:[],_mode=="live",_source==note.Source?note.Regions:[]);
        await RenderReadingAsync();
    }
    [JSInvokable] public Task OnEditorChanged(string noteId,long revision,EditorDelta[] changes,bool composing) => InvokeAsync(() =>
    {
        if(_note?.Id != noteId || revision<=_editorRevision) return;
        foreach(var change in changes)
        {
            if(change.From<0 || change.To<change.From || change.To>_source.Length)
            { _error="編輯同步範圍失效；儲存時會從編輯器取得完整草稿。"; return; }
            _source=_source[..change.From]+change.Insert+_source[change.To..];
        }
        _editorRevision=revision; _contentVersion++; _saveStatus="未保存的草稿";
        ScheduleSave(); StateHasChanged();
    });
    [JSInvokable] public Task OnEditorDeliveryFailed(string message) => InvokeAsync(()=>{_error="編輯同步暫時失敗，內容仍保留在編輯器："+message;StateHasChanged();});
    [JSInvokable] public Task OnEditorBlurred() => SaveButtonAsync();
    [JSInvokable] public Task OnCompositionEnded() => SaveButtonAsync();
    [JSInvokable] public Task OnSaveRequested() => SaveButtonAsync();
    [JSInvokable] public Task OnReferenceClicked(string name) => InvokeAsync(()=>NavigateToDefinitionAsync(name));
    [JSInvokable] public async Task OnExternalLink(string url)
    {
        if(Uri.TryCreate(url,UriKind.Absolute,out var uri) && (uri.Scheme=="https" || uri.Scheme=="http"))
            await InvokeAsync(()=>GuardAsync(async ()=>{await Microsoft.Maui.ApplicationModel.Launcher.Default.OpenAsync(uri);}));
        else if(_note is not null) await OnLocalLink(_note.Id,url);
    }
    private void TitleChanged(ChangeEventArgs args) { _title=args.Value?.ToString()??""; _contentVersion++; _saveStatus="未保存的草稿"; ScheduleSave(); }
    private void ScheduleSave()
    {
        debounce?.Cancel(); debounce?.Dispose(); debounce=new(); var token=debounce.Token;
        _ = InvokeAsync(async () =>
        {
            try { await Task.Delay(250,token); if(!token.IsCancellationRequested) await SaveButtonAsync(); }
            catch(OperationCanceledException) { }
        });
    }
    private async Task<bool> CaptureEditorAsync()
    {
        if(editor is null || _note is null) return true;
        var snapshot=await editor.InvokeAsync<EditorSnapshot>("snapshot");
        if(snapshot.NoteId != _note.Id) return false;
        if(snapshot.Revision>=_editorRevision && snapshot.Source!=_source) { _source=snapshot.Source; _contentVersion++; }
        _editorRevision=Math.Max(_editorRevision,snapshot.Revision);
        return !snapshot.Composing;
    }
    private async Task SaveButtonAsync() => await GuardAsync(async ()=>{await SaveCurrentAsync();});
    private async Task ResubmitSourceAsync() => await ModalActionAsync(async () =>
    {
        if(_note is null || _note.SourceStatus=="accepted")return;
        // Explicit user action only. Blur/debounce must not repeatedly submit
        // unchanged, unaccepted source or reopen its confirmation dialog.
        _forceDraftSave=true;
        await SaveCurrentAsync();
    });
    private async Task<bool> SaveCurrentAsync()
    {
        if(_note is null || editor is null) return true;
        debounce?.Cancel();
        await writes.WaitAsync(); _saving=true;
        try
        {
            if(!await CaptureEditorAsync()) { _saveStatus="輸入法組字中 · 完成後保存"; return false; }
            var id=_note.Id; var version=_contentVersion; var source=_source; var title=_title;
            if(!_forceDraftSave && source==_note.Source && title==_note.Title && !_hasDraft) return true;
            if(_forceDraftSave || source!=_savedSource || title!=_savedTitle || _draftRevision==0)
            {
                _draftRevision++;
                var saved=await Backend.SendAsync<OperationResult>(HttpMethod.Put,"api/notes/"+id+"/draft",new SaveDraftRequest(_sessionId,_draftRevision,_noteRevision,title,source,_baseSourceHash));
                if(saved.Status is "conflict" or "rejected") { await ShowConflictAsync(saved.Message); return false; }
                _savedSource=source; _savedTitle=title; _forceDraftSave=false; _hasDraft=true;
            }
            _saveStatus="草稿已保存 · 計算中"; StateHasChanged();
            await Backend.RefreshWorkspaceAsync(); _knowledgeRevision=Backend.Workspace!.Revision;
            var command=new CommitNoteRequest(Guid.NewGuid().ToString("N"),_sessionId,_draftRevision,_noteRevision,_knowledgeRevision);
            var measure=await BeginPerformanceAsync("commitRequestToRenderedNote");
            var result=await Backend.CommandAsync("api/notes/"+id+"/commit",command,command.OperationId);
            if(result.Status=="confirmation-required")
            {
                _confirmationNoteId=id; _confirmationSource=source; _confirmationVersion=version; _confirmationGeneration=_contextGeneration;
                _confirmationRequest=command; _confirmationResult=result; _dialog="rename"; _saveStatus="草稿已保存 · 等待名稱變更確認"; return false;
            }
            var accepted=await HandleCommitAsync(result,id,source,version);
            await EndPerformanceAsync(measure,accepted&&result.Status=="committed");
            return accepted;
        }
        finally { _saving=false; writes.Release(); StateHasChanged(); }
    }
    private async Task<bool> HandleCommitAsync(OperationResult result,string id,string source,long version)
    {
        _diagnostics=result.Diagnostics??[];
        _knowledgeRevision=Math.Max(_knowledgeRevision,result.Revision);
        if(result.Status is "committed" or "source-saved")
        {
            if(_notice==_commitNotice)_notice=null;
            _commitNotice=null;
            var fresh=await Backend.GetAsync<NoteDto>("api/notes/"+id);
            if(_note?.Id==id) await ApplyFreshNoteAsync(fresh,source,version);
            await RefreshCollectionsAsync(); return true;
        }
        if(result.Status=="conflict") { await ShowConflictAsync(result.Message); return false; }
        if(result.Status is "draft" or "invalid")
        {
            _saveStatus="草稿已保存 · 語法尚未完成";
            if(!string.IsNullOrWhiteSpace(result.Message)) _notice=_commitNotice=result.Message;
            return true;
        }
        _saveStatus="草稿保留 · "+result.Status;
        _error=result.Message??("操作尚未確認完成："+result.Status+" · "+result.OperationId);
        return false;
    }
    private async Task ApplyFreshNoteAsync(NoteDto fresh,string expectedSource,long expectedVersion,long expectedGeneration=-1)
    {
        await patches.WaitAsync();
        try
        {
        if(_note?.Id!=fresh.Id) return;
        if(expectedGeneration>=0 && expectedGeneration!=_contextGeneration)return;
        if(fresh.Revision<_noteRevision || fresh.KnowledgeRevision<_note.KnowledgeRevision)return;
        var previousRevision=_noteRevision;
        _note=fresh; _noteRevision=fresh.Revision; _knowledgeRevision=Math.Max(_knowledgeRevision,fresh.KnowledgeRevision); _diagnostics=fresh.Diagnostics;
        _hasDraft=fresh.Draft is not null;
        if(_contentVersion==expectedVersion && _source==expectedSource)
        {
            var applied=await editor!.InvokeAsync<bool>("applyCommitted",expectedSource,fresh.Source,fresh.References,fresh.Regions);
            if(applied && _contentVersion==expectedVersion)
            {
                _source=fresh.Source; _title=fresh.Title; _savedSource=_source; _savedTitle=_title;
                _baseSourceHash=fresh.SourceHash;
                _saveStatus=SavedStatus(fresh);
                await RenderReadingAsync(); return;
            }
        }
        if(fresh.Source!=expectedSource) _noteRevision=previousRevision;
        _saveStatus="新的編輯尚未保存"; ScheduleSave();
        }
        finally { patches.Release(); }
    }
    private async Task ShowConflictAsync(string? message)
    {
        if(_note is null)return;
        _conflictNote=await Backend.GetAsync<NoteDto>("api/notes/"+_note.Id);
        _mergeTitle=_title; _mergeSource=_source; _dialog="conflict"; _notice=message; _saveStatus="草稿保留 · 需要合併";
    }
    private async Task ApplyMergeAsync() => await ModalActionAsync(async () =>
    {
        if(_conflictNote is null || _note?.Id!=_conflictNote.Id)return;
        _note=_conflictNote; _noteRevision=_conflictNote.Revision; _knowledgeRevision=_conflictNote.KnowledgeRevision;
        _baseSourceHash=_conflictNote.SourceHash;
        _title=_mergeTitle; _source=_mergeSource; _contentVersion++; _editorRevision=0; _forceDraftSave=true;
        await editor!.InvokeVoidAsync("setDocument",_note.Id,_source,0,Array.Empty<ReferenceDto>(),_mode=="live");
        _dialog=null; await SaveCurrentAsync();
    });
    private async Task ConfirmRenameAsync() => await ModalActionAsync(async () =>
    {
        if(_confirmationRequest is null || _note is null)return;
        await writes.WaitAsync();
        try
        {
            var command=_confirmationRequest with {ConfirmRename=true};
            var id=_confirmationNoteId; var source=_confirmationSource; var version=_confirmationVersion; var generation=_confirmationGeneration;
            var result=await Backend.CommandAsync("api/notes/"+id+"/commit",command,command.OperationId);
            _dialog=null;
            if(generation==_contextGeneration) await HandleCommitAsync(result,id,source,version);
        }
        finally {writes.Release();}
    });
    private async Task ChangeModeAsync(string mode) => await GuardAsync(async () =>
    {
        if(editor is null)return;
        _switching=true; StateHasChanged(); await editor!.InvokeVoidAsync("freeze",true);
        try { if(!await SaveCurrentAsync()) return;
            _mode=mode; await editor!.InvokeVoidAsync("setMode",mode=="live"); StateHasChanged(); await RenderReadingAsync(); }
        finally { _switching=false; await editor!.InvokeVoidAsync("freeze",false); }
    });
    private async Task RenderReadingAsync()
    {
        if(editor is not null && _note is not null)
            await editor!.InvokeVoidAsync("renderReading","note-reading",_source,_source==_note.Source?_note.References:[],_source==_note.Source?_note.Regions:[]);
    }
    private void ShowCreate() { _newParent=""; ShowCreateAt(""); }
    private void ShowCreateAt(string parent) {_newParent=parent;_newTitle="";_dialog="create";_focusNewTitle=true;}
    private async Task CreateNoteAsync() => await ModalActionAsync(async () =>
    {
        if(!await SaveCurrentAsync())return;
        var command=new CreateNoteRequest(Guid.NewGuid().ToString("N"),string.IsNullOrWhiteSpace(_newTitle)?"未命名筆記":_newTitle.Trim(),ParentPath:_newParent);
        var result=await Backend.CommandAsync("api/notes",command,command.OperationId);
        if(result.Status!="committed" || result.NoteId is null)throw new InvalidOperationException(result.Message??"建立筆記未完成。");
        _dialog=null; await RefreshCollectionsAsync(); await SelectNoteAsync(result.NoteId);
        _filesRefresh++;
    });
    private void OpenWorkspaceDialog() {_workspacePath=Backend.WorkspacePath;_dialog="workspace";}
    private async Task BrowseWorkspaceAsync() => await GuardAsync(async () => {var path=await FolderPicker.PickAsync();if(path is not null)_workspacePath=path;});
    private async Task ChangeWorkspaceAsync() => await ModalActionAsync(async () =>
    {
        _switching=true; StateHasChanged(); await editor!.InvokeVoidAsync("freeze",true);
        try { if(!await SaveCurrentAsync())return;
            _contextGeneration++; _note=null; await Backend.OpenAsync(_workspacePath); _dialog=null; await LoadWorkspaceAsync(); }
        finally { _switching=false; await editor!.InvokeVoidAsync("freeze",false); }
    });
    private async Task InspectDefinitionAsync(string name) => await GuardAsync(async () =>
    {
        _selectedDefinition=_definitions.FirstOrDefault(d=>d.Name==name);
        if(_selectedDefinition is null) {_notice="找不到 "+name+" 的定義。請查看診斷。";return;}
        _showInspector=true; _references=await Backend.GetAsync<ReferenceDto[]>("api/definitions/"+_selectedDefinition.Id+"/references");
    });
    private async Task NavigateToDefinitionAsync(string name) => await GuardAsync(async () =>
    {
        if (_switching) return;
        var generation = _contextGeneration;
        var definitions = await Backend.GetAsync<DefinitionDto[]>("api/definitions");
        if (generation != _contextGeneration) return;
        _selectedDefinition = definitions.FirstOrDefault(d => d.Name == name);
        if (_selectedDefinition is null) { _notice = "找不到 " + name + " 的定義。請查看診斷。"; return; }
        await LocateDefinitionAsync();
    });
    private async Task LocateDefinitionAsync() => await GuardAsync(async () =>
    {
        if(_selectedDefinition is not { } selected)return;
        await SelectNoteAsync(selected.NoteId);
        if(_note?.Id!=selected.NoteId)return;
        _recordsVisible=false;
        var current=_note.Definitions.FirstOrDefault(d=>d.Id==selected.Id);
        if(current is null){_notice="這個定義已變更，請重新選擇。";return;}
        _selectedDefinition=current;
        _references=await Backend.GetAsync<ReferenceDto[]>("api/definitions/"+current.Id+"/references");
        _mode="source"; StateHasChanged(); await editor!.InvokeVoidAsync("setMode",false);
        // Committed source ranges are not valid inside an independently edited draft.
        if(_source==_note.Source) await editor!.InvokeVoidAsync("focusAt",current.NameStart,current.NameLength);
        else {await editor!.InvokeVoidAsync("focusAt",0,0);_notice=_commitNotice="已開啟來源草稿；請在保留的原文中修改定義。";}
    });
    private async Task LocateReferenceAsync(ReferenceDto reference)
    {
        await SelectNoteAsync(reference.NoteId);
        if(_note?.Id==reference.NoteId){_mode="source";await editor!.InvokeVoidAsync("setMode",false);await editor!.InvokeVoidAsync("focusAt",reference.Start,reference.Length);}
    }
    private async Task LocateDiagnosticAsync(DiagnosticDto diagnostic)
    { _mode="source";await editor!.InvokeVoidAsync("setMode",false);await editor!.InvokeVoidAsync("focusAt",Math.Clamp(diagnostic.Start,0,_source.Length),Math.Clamp(diagnostic.Length,0,Math.Max(0,_source.Length-diagnostic.Start))); }
    private async Task ShowSharedEditAsync() => await GuardAsync(async () =>
    {
        if(!await SaveCurrentAsync() || _selectedDefinition is null)return;
        var owner=await Backend.GetAsync<NoteDto>("api/notes/"+_selectedDefinition.NoteId);
        if(owner.Draft is not null)
        {
            await LocateDefinitionAsync();
            if(_note?.Id==owner.Id)_notice=_commitNotice="來源已有未提交草稿，已開啟並保留草稿。請直接在原文修改共享定義。";
            return;
        }
        _impact=await Backend.GetAsync<ImpactDto>("api/definitions/"+_selectedDefinition.Id+"/impact");
        _affectedDraftNotes=_impact.HasDirtyDraft
            ? (await Backend.GetAsync<NoteSummary[]>("api/notes")).Where(n=>n.HasDraft && _impact.NoteIds.Contains(n.Id)).ToArray()
            : [];
        _literalValue=_selectedDefinition.Value??"";_dialog="literal";
    });
    private async Task OpenAffectedDraftAsync(string id)
    {
        _dialog=null;
        await SelectNoteAsync(id);
        if(_note?.Id!=id)return;
        _mode="source";StateHasChanged();await editor!.InvokeVoidAsync("setMode",false);
        await editor!.InvokeVoidAsync("focusAt",0,0);
        _notice=_commitNotice="已開啟未提交草稿，請先處理原文，再重試共享修改。";
    }
    private async Task ApplyLiteralAsync() => await ModalActionAsync(async () =>
    {
        if(_selectedDefinition is null || _impact is null)return;
        var command=new LiteralChangeRequest(Guid.NewGuid().ToString("N"),_impact.Revision,_literalValue);
        var result=await Backend.CommandAsync("api/definitions/"+_selectedDefinition.Id+"/literal",command,command.OperationId);
        if(result.Status!="committed")throw new InvalidOperationException(result.Message??"共享修改尚未套用。");
        _dialog=null;await RefreshAfterSharedAsync();
    });
    private async Task ShowSettings() => await GuardAsync(async () =>
    {
        if(!await SaveCurrentAsync())return;
        await Backend.RefreshWorkspaceAsync(); var languages=Backend.Workspace!.EnabledFenceLanguages;
        _parseUnlabelled=languages.Contains("");_languageText=string.Join("\n",languages.Where(x=>x.Length>0));
        _impact=null;_dialog="settings";
    });
    private string[] Languages() => (_parseUnlabelled?new[]{""}:Array.Empty<string>()).Concat(_languageText.Split(['\r','\n',','],StringSplitOptions.RemoveEmptyEntries).Select(x=>x.Trim().ToLowerInvariant()).Where(x=>x.Length>0)).Distinct().ToArray();
    private void ClearPolicyPreview() {_impact=null;}
    private async Task PreviewPolicyAsync() => await ModalActionAsync(async () =>
    {
        await Backend.RefreshWorkspaceAsync();
        _impact=await Backend.SendAsync<ImpactDto>(HttpMethod.Post,"api/policy/preview",new PolicyRequest(Guid.NewGuid().ToString("N"),Backend.Workspace!.Revision,Languages()));
    });
    private async Task ApplyPolicyAsync() => await ModalActionAsync(async () =>
    {
        if(_impact is null)return;
        var command=new PolicyRequest(Guid.NewGuid().ToString("N"),_impact.Revision,Languages());
        var result=await Backend.CommandAsync("api/policy",command,command.OperationId);
        if(result.Status!="committed")throw new InvalidOperationException(result.Message??"解析設定尚未套用。");
        _dialog=null;await RefreshAfterSharedAsync();
    });
    private async Task RefreshAfterSharedAsync()
    {
        var id=_note?.Id; var baseline=_source; var version=_contentVersion; var generation=_contextGeneration;
        await Backend.RefreshWorkspaceAsync();_knowledgeRevision=Backend.Workspace!.Revision; await RefreshCollectionsAsync();
        if(id is not null){var fresh=await Backend.GetAsync<NoteDto>("api/notes/"+id);await ApplyFreshNoteAsync(fresh,baseline,version,generation);}
    }
    private async Task InsertExampleAsync() => await GuardAsync(async () =>
    {
        if(!await CaptureEditorAsync())return;
        var occupied=new HashSet<string>(_definitions.Select(d=>d.Name),StringComparer.Ordinal);
        // Conservatively reserve draft assignment names, including incomplete / disabled examples.
        foreach(Match match in Regex.Matches(_source,@"@([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*=",RegexOptions.CultureInvariant))
            occupied.Add(match.Groups[1].Value);
        var suffix="";
        for(var n=2;new[]{"Fruit","Description","Slogan"}.Any(name=>occupied.Contains(name+suffix));n++)suffix=n.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var fruit="Fruit"+suffix; var description="Description"+suffix; var slogan="Slogan"+suffix;
        await editor!.InvokeVoidAsync("insertText","\n@code{\n    @"+fruit+" = {apple}\n    @"+description+" = {\n第一段。\n\n第二段。\n    }\n    @"+slogan+" = {An } + "+fruit+" + { a day.}\n}\n");
    });
    private async Task InsertReferenceAsync(bool wiki)
    {
        var definition=_definitions.FirstOrDefault(d=>d.Name==_insertName);if(definition is null)return;
        var value=(definition.Value??"").Replace("\\","\\\\").Replace("[","\\[").Replace("]","\\]").Replace("|","\\|");
        await editor!.InvokeVoidAsync("insertText",wiki?$"[[@{definition.Name}|{value}]]":$"[{value}](:ref:{definition.Name})");
    }
    private async Task<bool> BeforeCloseAsync()
    {
        bool safe=false;
        await InvokeAsync(async () =>
        {
            try{if(editor is not null)await editor!.InvokeVoidAsync("freeze",true); StateHasChanged(); safe=await SaveCurrentAsync();if(!safe)_error="尚有未確認的操作，請先處理提示後再關閉。";}
            catch(Exception error){_error="無法確認草稿已保存，因此保留視窗："+error.Message;}
            finally {if(!safe && editor is not null)await editor!.InvokeVoidAsync("freeze",false);}
            if(safe)await SavePerformanceAsync();
            StateHasChanged();
        });
        return safe;
    }
    private void CloseDialog(){if(!_busy)_dialog=null;}
    private async Task ModalActionAsync(Func<Task> action)
    {if(_busy)return;_busy=true;try{await GuardAsync(action);}finally{_busy=false;}}
    private async Task GuardAsync(Func<Task> action)
    {try{await action();}catch(Exception error){_error=error.Message;}if(!_disposed)StateHasChanged();}
    private string NoteTitle(string id)=>_notes.FirstOrDefault(n=>n.Id==id)?.Title??id;
    private static string Preview(string value)=>value.Length<=90?value:value[..90]+"…";
    public async ValueTask DisposeAsync()
    {
        _disposed=true;debounce?.Cancel();searchCancellation?.Cancel();
        Backend.Changed-=BackendChanged;Backend.RevisionReceived-=RevisionReceived;Backend.BeforeClose=null;
        if(editor is not null){try{await editor!.InvokeVoidAsync("dispose");await editor.DisposeAsync();}catch(JSDisconnectedException){}}
        if(_performance is not null)await _performance.DisposeAsync();
        receiver?.Dispose();debounce?.Dispose();searchCancellation?.Dispose();
    }
    public record EditorDelta(int From,int To,string Insert);
    public record EditorSnapshot(string NoteId,string Source,long Revision,bool Composing);
}
