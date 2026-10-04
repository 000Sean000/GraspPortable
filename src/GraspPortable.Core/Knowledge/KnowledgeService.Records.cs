using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Knowledge;

public sealed partial class KnowledgeService
{
    public async Task<Receipt> ChangeRecordFieldAsync(string operationId,string recordId,string fieldId,long expectedRevision,
        FieldSourceEdit edit,CancellationToken token=default,bool confirmRename=false,string? requestFingerprint=null)
    {
        var hash=requestFingerprint??Fingerprint(new { kind="record-field",recordId,fieldId,expectedRevision,edit });
        if(Retry(operationId,hash) is { } retry) return retry;
        var basis=Current;
        if(basis.Revision!=expectedRevision) return Reject(operationId,hash,"conflict","欄位基底已更新，請重新讀取。");
        var owners=basis.Notes.Values.Where(n=>n.Records?.Records.Any(r=>r.Id==recordId)==true).ToArray();
        if(owners.Length!=1) return Reject(operationId,hash,"rejected","Record 身分不存在或不唯一。");
        var note=owners[0];
        if(note.IsSourceStale || GetDraft(note.Id) is not null) return Reject(operationId,hash,"conflict","來源有草稿或尚未接受的原文，請先處理来源。",note.Id);
        var parsed=VerticalRecordCodec.Parse(note.Source,note.Records!);
        var changed=VerticalRecordCodec.PrepareFieldEdit(note.Source,parsed,recordId,fieldId,edit);
        if(!changed.Success) return Reject(operationId,hash,"invalid","欄位邊界無法安全改寫，原文保留。",note.Id,
            changed.Diagnostics.Select(d=>new ParseDiagnostic(d.Code,d.Message,d.Span)).ToArray());
        var source=ReferenceCodec.ApplyPatches(note.Source,[changed.Patch!]);
        var syntax=RecordNoteSyntax.Parse(source,note.Records,basis.Languages,token);
        if(!syntax.IsValid) return Reject(operationId,hash,"invalid","欄位包含未完成語法，請在來源草稿中繼續編輯。",note.Id,syntax.Diagnostics.ToArray());
        var renames=DetectRenames(note.Syntax,syntax);
        if(renames is null) return Reject(operationId,hash,"invalid","無法唯一識別欄位內改名，請分次改名並保持 expression 不變。",note.Id);
        var notes=basis.Notes.ToDictionary(p=>p.Key,p=>p.Value);
        notes[note.Id]=note with { Source=source,Syntax=syntax };
        if(renames.Count>0)
        {
            var existingNames=basis.Definitions.Values.Where(d=>d.NoteId!=note.Id).Select(d=>d.Name).ToHashSet(StringComparer.Ordinal);
            if(renames.Values.Any(existingNames.Contains)) return Reject(operationId,hash,"invalid","改名會造成同 namespace 重名；未套用。",note.Id);
            var affected=notes.Values.Where(n=>n.Syntax.References.Any(r=>renames.ContainsKey(r.Name))
                || n.Syntax.Definitions.Any(d=>d.Parts.Any(p=>p.Kind==PartKind.Identifier && renames.ContainsKey(p.Text))))
                .Select(n=>n.Id).Append(note.Id).Distinct().ToArray();
            if(!confirmRename) return new(operationId,hash,"confirmation-required",basis.Revision,note.Id,
                "改名將保留 ID，並更新相依與引用。",AffectedNoteIds:affected);
            // Only committed sources are rewritten. Existing dependent drafts retain
            // their original bytes and will require a new base revision before save.
            RewriteRenames(notes,renames,basis.Languages,token);
        }
        var prepared=await PrepareAsync(basis,notes,basis.Languages,basis.PolicyRevision,renames,token);
        if(prepared.Error is { } error) return Reject(operationId,hash,"invalid",error,note.Id);
        return await PublishAsync(basis,prepared.State!,operationId,hash,note.Id,null,token,rejectDirtyNote:note.Id);
    }

    private static bool SharedWritable(Snapshot basis,KnowledgeDefinition definition)
    {
        if(definition.FieldOrigin is null) return definition.IsLiteral;
        return basis.Notes[definition.NoteId].Syntax.Definitions.Single(d=>d.Name==definition.Name)
            .Parts.All(p=>p.Kind==PartKind.Literal);
    }

    private static string ReplaceSharedSource(Note note,KnowledgeDefinition definition,string value,IReadOnlyList<string> languages)
    {
        if(definition.FieldOrigin is { } origin)
        {
            if(note.Records is null) throw new InvalidOperationException("Field definition lost its source descriptor.");
            var field=VerticalRecordCodec.PrepareFieldEdit(note.Source,VerticalRecordCodec.Parse(note.Source,note.Records),origin.RecordId,origin.FieldId,new(value));
            if(!field.Success) throw new InvalidOperationException("Shared field cannot be rewritten safely.");
            var source=ReferenceCodec.ApplyPatches(note.Source,[field.Patch!]);
            var syntax=RecordNoteSyntax.Parse(source,note.Records,languages);
            if(!syntax.IsValid) throw new InvalidOperationException("欄位包含未完成語法，請前往來源草稿繼續編輯。");
            var renames=DetectRenames(note.Syntax,syntax);
            // The generic shared-text command has no rename-confirmation transport.
            // Use the existing field/source command to confirm and preserve identities.
            if(renames is null || renames.Count>0)
                throw new InvalidOperationException("欄位內定義改名需要身分確認；請前往來源或欄位編輯器完成改名，共享值尚未修改。");
            return source;
        }
        var literal=note.Syntax.Definitions.Single(d=>d.Name==definition.Name);
        return RecordNoteSyntax.ApplyPatches(note.Source,note.Records,[new(literal.ExpressionSpan,LiteralCodec.Serialize(value))]);
    }
}
