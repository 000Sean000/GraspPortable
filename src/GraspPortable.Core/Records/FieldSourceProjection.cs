using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Records;

/// <summary>Compiles only original field Markdown into existing engine parts; evaluated values are never parsed again.</summary>
public static class FieldSourceProjection
{
    public static RecordFieldProjection Project(RecordDescriptor record, FieldSchema schema, RecordFieldSource field,
        IReadOnlyList<string> enabledFenceLanguages)
    {
        if (field.RecordId != record.Id || field.FieldId != schema.Id || !RecordText.Key(record.Key) || !RecordText.Key(schema.Key))
            throw new ArgumentException("Field projection requires matching source identities and valid ASCII keys.");
        var parsed = GraspParser.Parse(field.RawSource, enabledFenceLanguages);
        var diagnostics = parsed.Diagnostics.Select(d => new RecordDiagnostic(d.Code, d.Message, field.MapToSource(d.Span))).ToList();
        var parts = new List<BindingPart>();
        if (!field.IsNull)
        {
            var at = 0;
            foreach (var reference in parsed.References.OrderBy(r => r.Span.Start))
            {
                if (reference.Span.Start < at || reference.Span.End > field.RawSource.Length)
                { diagnostics.Add(new("reference-overlap", "Original field references do not have disjoint source ranges.", field.BodySpan)); break; }
                AddLiteral(at, reference.Span.Start);
                parts.Add(new(PartKind.Identifier, reference.Name, field.MapToSource(reference.NameSpan)));
                at = reference.Span.End;
            }
            AddLiteral(at, field.RawSource.Length);
        }
        return new(record.Key + "." + schema.Key, record.Id, schema.Id, field.IsNull, parts, parsed, diagnostics);
        void AddLiteral(int start, int end)
        {
            if (end > start) parts.Add(new(PartKind.Literal, field.RawSource[start..end], field.MapToSource(SourceSpan.Between(start, end))));
        }
    }
}
