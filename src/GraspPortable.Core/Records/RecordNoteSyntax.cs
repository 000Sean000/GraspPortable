using System.Security.Cryptography;
using System.Text;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Records;

/// <summary>Combines original note and field syntax. Computed Markdown is never reparsed.</summary>
public static class RecordNoteSyntax
{
    public static string DefinitionId(FieldDefinitionOrigin origin) => new Guid(SHA256.HashData(
        Encoding.UTF8.GetBytes("grasp.record-field.v1\0" + origin.RecordId + "\0" + origin.FieldId)).AsSpan(0,16)).ToString("N");

    public static ParseResult Parse(string source, RecordsDocumentDescriptor? records, IReadOnlyList<string> languages,
        CancellationToken token = default)
    {
        if(records is null) return GraspParser.Parse(source,languages,token);
        var fields = VerticalRecordCodec.Parse(source,records);
        if(!fields.CanRewrite) return new([],[],fields.Diagnostics.Select(d=>new ParseDiagnostic(d.Code,d.Message,d.Span)).ToArray(),[]);
        var masked=source.ToCharArray();
        foreach(var field in fields.Fields)
            for(var at=field.CarrierSpan.Start;at<field.CarrierSpan.End;at++)
                if(masked[at] is not '\r' and not '\n') masked[at]=' ';
        var outer=GraspParser.Parse(new string(masked),languages,token);
        var definitions=outer.Definitions.ToList(); var references=outer.References.ToList();
        var diagnostics=outer.Diagnostics.ToList(); var regions=(outer.Regions??[]).ToList();
        foreach(var field in fields.Fields)
        {
            token.ThrowIfCancellationRequested();
            var record=records.Records.Single(r=>r.Id==field.RecordId);
            var schema=records.Fields.Single(f=>f.Id==field.FieldId);
            var projection=FieldSourceProjection.Project(record,schema,field,languages);
            SourceSpan Map(SourceSpan span)=>field.MapToSource(span);
            definitions.AddRange(projection.OriginalSyntax.Definitions.Select(d=>new Definition(d.Name,Map(d.NameSpan),Map(d.Span),Map(d.ExpressionSpan),
                d.Parts.Select(p=>p with { Span=Map(p.Span) }).ToArray())));
            references.AddRange(projection.OriginalSyntax.References.Select(r=>r with { NameSpan=Map(r.NameSpan), ValueSpan=Map(r.ValueSpan), Span=Map(r.Span) }));
            regions.AddRange((projection.OriginalSyntax.Regions??[]).Select(r=>r with { Span=Map(r.Span) }));
            diagnostics.AddRange(projection.Diagnostics.Select(d=>new ParseDiagnostic(d.Code,d.Message,d.Span)));
            // There is no identifier token for a generated property in the body.
            // Its identity and write target are explicit; a zero-length location is navigation only.
            definitions.Add(new(projection.PublicName,new(field.BodySpan.Start,0),field.CarrierSpan,field.BodySpan,projection.Parts,
                new(record.Id,schema.Id)));
        }
        return new(definitions,references,diagnostics,regions);
    }

    public static string ApplyPatches(string source, RecordsDocumentDescriptor? records, IReadOnlyList<SourcePatch> patches)
    {
        // Generated dependency parts and real reference tokens can name the same span.
        var unique=patches.Distinct().ToArray();
        if(records is null || unique.Length==0) return ReferenceCodec.ApplyPatches(source,unique);
        var parsed=VerticalRecordCodec.Parse(source,records);
        if(!parsed.CanRewrite) throw new InvalidOperationException("Field layout is ambiguous; source patches were not applied.");
        var outer=new List<SourcePatch>();
        var byField=new Dictionary<RecordFieldSource,List<SourcePatch>>();
        foreach(var patch in unique)
        {
            var field=parsed.Fields.SingleOrDefault(f=>patch.Span.Start>=f.BodySpan.Start && patch.Span.End<=f.BodySpan.End);
            if(field is null) { outer.Add(patch); continue; }
            int Position(int physical,bool end)
            {
                var map=field.SourceMap.FirstOrDefault(m=>end ? physical>m.SourceSpan.Start && physical<=m.SourceSpan.End
                    : physical>=m.SourceSpan.Start && physical<m.SourceSpan.End);
                if(map is not null) return map.ValueSpan.Start+physical-map.SourceSpan.Start;
                if(physical==field.BodySpan.Start && field.RawSource.Length==0) return 0;
                if(field.SourceMap.Count>0 && physical==field.SourceMap[^1].SourceSpan.End) return field.RawSource.Length;
                throw new InvalidOperationException("Patch is not on a field source boundary.");
            }
            var from=Position(patch.Span.Start,false); var to=Position(patch.Span.End,patch.Span.Length>0);
            if(!byField.TryGetValue(field,out var local)) byField[field]=local=[];
            local.Add(new(SourceSpan.Between(from,to),patch.Text));
        }
        foreach(var (field,local) in byField)
        {
            var value=ReferenceCodec.ApplyPatches(field.RawSource,local);
            var result=VerticalRecordCodec.PrepareFieldEdit(source,parsed,field.RecordId,field.FieldId,new(value,field.IsNull));
            if(!result.Success) throw new InvalidOperationException("Field source patch could not preserve its carrier.");
            outer.Add(result.Patch!);
        }
        return ReferenceCodec.ApplyPatches(source,outer);
    }
}
