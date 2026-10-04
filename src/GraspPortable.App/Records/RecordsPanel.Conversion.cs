using GraspPortable.Contracts;

namespace GraspPortable.App.Records;

public partial class RecordsPanel
{
    private RecordFieldConversionPreview? _fieldConversion;
    private FieldConversionInput? _fieldConversionInput;
    private bool _conversionConfirmed;
    private sealed record FieldConversionInput(string Workspace,string? Collection,string? Record,string? Field,
        long DialogGeneration,long BasisRevision,long ObservedRevision,string Raw,bool IsNull,string Kind,bool SourceMode);
    private FieldConversionInput CurrentConversionInput() => new(WorkspaceKey,_data?.Id,_row?.Id,_field?.Id,
        _recordNavigationGeneration,_editRevision,Math.Max(_observedRevision,_data?.Revision??-1),_raw,_null,_kind,_sourceMode);
    private bool HasConversionPreview => _dialog=="cell" && _pending is null && !_conversionConfirmed
        && _fieldConversion is { RequiresConfirmation:true,CanApply:true }
        && _fieldConversionInput==CurrentConversionInput();
    private void InvalidateFieldConversion()
    {
        // An accepted/unknown command retains its immutable original payload.
        if(_pending is not null)return;
        _fieldConversion=null;_fieldConversionInput=null;_conversionConfirmed=false;
    }
    private void InvalidateChangedFieldConversion()
    {
        if(_fieldConversionInput is not null && _fieldConversionInput!=CurrentConversionInput())InvalidateFieldConversion();
    }
    private async Task<bool> PrepareFieldConversionAsync()
    {
        if(_dialog!="cell" || _kind!="Markdown")return true;
        if(SourceBlocked)throw new InvalidOperationException("來源存在草稿或未接受的變更，請先處理原文。");
        var input=CurrentConversionInput();
        if(_fieldConversionInput==input && _fieldConversion is { CanApply:true } cached)
            return !cached.RequiresConfirmation || _conversionConfirmed;
        InvalidateFieldConversion();
        var preview=await Backend.SendAsync<RecordFieldConversionPreview>(HttpMethod.Post,
            $"api/records/rows/{input.Record}/fields/{input.Field}/conversion-preview",
            new PreviewRecordFieldConversionRequest(input.BasisRevision,input.Raw,input.IsNull));
        if(_disposed || _dialog!="cell" || _dialogWorkspace!=WorkspaceKey || input!=CurrentConversionInput())
        { _dialogWarning="原文、空值或資料版本已變動；這次預覽已失效，請重新保存以取得新預覽。"; return false; }
        if(!preview.CanApply || preview.BasisRevision!=input.BasisRevision
            || preview.RequiresConfirmation&&string.IsNullOrEmpty(preview.PreviewToken))
        {
            _dialogWarning="尚不能套用這份轉換，原始輸入保持不變。";
            if(preview.Diagnostics.Length>0)_error=string.Join('\n',preview.Diagnostics.Select(d=>d.Message));
            _conflict=preview.BasisRevision!=input.BasisRevision;
            return false;
        }
        _fieldConversion=preview;_fieldConversionInput=input;
        return !preview.RequiresConfirmation;
    }
    private async Task ConfirmFieldConversionAsync()
    {
        if(_busy || _unknownOutcome || _pending is not null)return;
        if(!HasConversionPreview)
        { InvalidateFieldConversion();_dialogWarning="這份轉換預覽已失效，請重新保存取得新預覽。";return; }
        _conversionConfirmed=true;
        await SaveAsync();
    }
    private void ReturnFromFieldConversion()
    {
        if(_busy || _pending is not null)return;
        InvalidateFieldConversion();_dialogWarning=null;_focusFirst=true;
    }
    private string? ConfirmedConversionToken => _conversionConfirmed && _fieldConversionInput==CurrentConversionInput()
        ? _fieldConversion?.PreviewToken : null;
    private string OriginalConversionHeading(RecordFieldHeadingMapDto mapping)
    {
        var source=_fieldConversionInput?.Raw??"";
        return mapping.OriginalStart>=0 && mapping.OriginalLength>=0 && mapping.OriginalStart<=source.Length-mapping.OriginalLength
            ? source.Substring(mapping.OriginalStart,mapping.OriginalLength).TrimEnd('\r','\n') : $"H{mapping.OriginalLevel}";
    }
}
