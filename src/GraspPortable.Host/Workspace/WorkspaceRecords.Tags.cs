using GraspPortable.Contracts;
using GraspPortable.Core.Records;

namespace GraspPortable.Host.Workspace;

public sealed partial class WorkspaceRecords
{
    /// <summary>Search accepted, computed Tag fields without parsing evaluated Grasp syntax.</summary>
    public RecordTagSearchDto SearchTags(string? search, int offset = 0, int limit = 50, CancellationToken token = default)
    {
        var basis = knowledge.Current;
        var query = (search ?? "").Trim();
        offset = Math.Max(0, offset); limit = Math.Clamp(limit, 1, 100);
        var matches = new List<RecordTagMatchDto>(); var unavailable = 0; var total = 0;
        var definitions = basis.Definitions.Values.Where(d => d.FieldOrigin is not null)
            .ToDictionary(d => (d.NoteId, d.FieldOrigin!.RecordId, d.FieldOrigin.FieldId));
        foreach (var owner in Owners(basis).OrderBy(o => o.Metadata.Title, StringComparer.Ordinal).ThenBy(o => o.Note.Id, StringComparer.Ordinal))
        {
            token.ThrowIfCancellationRequested();
            var schemas = owner.Note.CurrentRecords!.Fields.Where(f => f.Kind == RecordFieldKind.Tag).ToArray();
            if (schemas.Length == 0) continue;
            if (owner.Note.IsSourceStale) { unavailable++; continue; }
            var source = VerticalRecordCodec.Parse(owner.Note.CurrentSource, owner.Note.CurrentRecords);
            if (!source.CanRewrite) { unavailable++; continue; }
            var fields = source.Fields.ToDictionary(f => (f.RecordId, f.FieldId));
            var draft = knowledge.GetDraft(owner.Note.Id) is not null;
            foreach (var record in owner.Note.CurrentRecords.Records.OrderBy(r => r.Key, StringComparer.Ordinal).ThenBy(r => r.Id, StringComparer.Ordinal))
            foreach (var schema in schemas)
            {
                token.ThrowIfCancellationRequested();
                if (!fields.TryGetValue((record.Id, schema.Id), out var field) || field.IsNull
                    || !definitions.TryGetValue((owner.Note.Id, record.Id, schema.Id), out var definition)
                    || definition.Status != "Valid" || definition.Value is null) continue;
                var parsed = RecordValueCodec.Parse(schema, false, definition.Value);
                if (!parsed.IsValid || parsed.Value is not TagRecordValue value) continue;
                var tags = value.Tags.Where(t => t.Contains(query, StringComparison.OrdinalIgnoreCase)).ToArray();
                if (tags.Length == 0) continue;
                if (total >= offset && matches.Count < limit)
                    matches.Add(new(owner.Metadata.CollectionId, owner.Metadata.Title, owner.Note.Id, record.Id,
                        record.Key, record.DisplayName, schema.Id, schema.DisplayName, tags, draft));
                total++;
            }
        }
        return new(basis.Revision, offset, limit, total, unavailable, matches.ToArray());
    }
}
