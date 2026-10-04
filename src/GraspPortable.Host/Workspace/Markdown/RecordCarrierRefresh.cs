using System.Text.RegularExpressions;
using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Host.Workspace.Markdown;

internal sealed record RecordCarrierTarget(string Id, string DisplayName, string RelativePath);
internal sealed record RecordCarrierProblem(string Code, string Message);
internal sealed record RecordCarrierRewrite(string Source, IReadOnlyList<RecordCarrierProblem> Problems);

/// <summary>Only explicit, codec-validated identity carriers in located typed fields are eligible.</summary>
internal static class RecordCarrierRefresh
{
    private static readonly Regex Carrier = new(@"(?m)^(?:- )?\[(?<label>(?:\\.|[^\]\\\r\n])*)\]\((?<target>(?:\\.|[^)\\\r\n])*)\) <!-- grasp:(?<kind>option|record) (?<id>[0-9a-f]{32}) -->(?=\r?$)", RegexOptions.CultureInvariant);

    public static RecordCarrierRewrite Rewrite(string source, RecordsDocumentDescriptor descriptor, string originPath,
        IReadOnlyDictionary<string, RecordCarrierTarget> targets, IReadOnlyDictionary<(string RecordId, string FieldId), string?> computed,
        bool refreshOptions = true, IReadOnlySet<string>? recordTargets = null)
    {
        var relevant = descriptor.Fields.Where(f => refreshOptions && f.Kind is RecordFieldKind.SingleSelect or RecordFieldKind.MultiSelect
            || recordTargets?.Count != 0 && f.Kind is RecordFieldKind.SingleRelation or RecordFieldKind.MultiRelation).ToDictionary(f => f.Id);
        if (relevant.Count == 0) return new(source, []);
        var parsed = VerticalRecordCodec.Parse(source, descriptor);
        if (!parsed.CanRewrite) return new(source, [new("record-carrier-source", "欄位原文邊界不明，保留原文，尚未同步 carrier 顯示文字／連結。")]);
        var patches = new List<SourcePatch>(); var problems = new List<RecordCarrierProblem>();
        var known = new RecordValueLookup(targets.Keys.ToHashSet(StringComparer.Ordinal));
        foreach (var field in parsed.Fields.Where(f => !f.IsNull && relevant.ContainsKey(f.FieldId)))
        {
            var schema = relevant[field.FieldId];
            var rawValue = RecordValueCodec.Parse(schema, false, field.RawSource, known);
            if (!rawValue.IsValid)
            {
                // Computed values are inspected only to report a stale presentation, never used as replacement source.
                if (computed.TryGetValue((field.RecordId, field.FieldId), out var value) && value is not null
                    && RecordValueCodec.Parse(schema, false, value, known).IsValid
                    && RewriteValue(value, schema, originPath, targets, refreshOptions, recordTargets) != value)
                    problems.Add(new("record-carrier-indirect", "欄位值由其他來源計算，無法把展開值攤平；請到原始來源同步選項／關聯文字。"));
                continue;
            }
            var updated = RewriteValue(field.RawSource, schema, originPath, targets, refreshOptions, recordTargets);
            if (updated == field.RawSource) continue;
            var edit = VerticalRecordCodec.PrepareFieldEdit(source, parsed, field.RecordId, field.FieldId, new(updated));
            if (!edit.Success) { problems.Add(new("record-carrier-source", "Carrier 範圍無法安全回寫，原文保留。")); continue; }
            patches.Add(edit.Patch!);
        }
        return new(ReferenceCodec.ApplyPatches(source, patches), problems);
    }

    private static string RewriteValue(string raw, FieldSchema schema, string originPath, IReadOnlyDictionary<string, RecordCarrierTarget> targets,
        bool refreshOptions, IReadOnlySet<string>? recordTargets)
    {
        var patches = new List<SourcePatch>();
        foreach (Match match in Carrier.Matches(raw))
        {
            var id = match.Groups["id"].Value; var relation = match.Groups["kind"].Value == "record";
            if (relation ? recordTargets is not null && !recordTargets.Contains(id) : !refreshOptions) continue;
            string label, path;
            if (relation)
            {
                if (!targets.TryGetValue(id, out var target)) continue;
                label = target.DisplayName; path = RelativeLink(originPath, target.RelativePath);
            }
            else
            {
                var option = (schema.Options ?? []).SingleOrDefault(o => o.Id == id);
                if (option is null) continue;
                label = option.DisplayName; path = "#" + Uri.EscapeDataString(label);
            }
            var normalized = Carrier.Match(RecordValueCodec.IdentityCarrier(label, path, id, relation, false));
            foreach (var key in new[] { "label", "target" })
                if (match.Groups[key].Value != normalized.Groups[key].Value)
                    patches.Add(new(new(match.Groups[key].Index, match.Groups[key].Length), normalized.Groups[key].Value));
        }
        return ReferenceCodec.ApplyPatches(raw, patches);
    }
    internal static string RelativeLink(string originPath, string targetPath)
    {
        var relative = Path.GetRelativePath(Path.GetDirectoryName(originPath) is { Length: > 0 } directory ? directory : ".", targetPath).Replace('\\', '/');
        return string.Join('/', relative.Split('/').Select(part => part is "." or ".." ? part : Uri.EscapeDataString(part)));
    }
}
