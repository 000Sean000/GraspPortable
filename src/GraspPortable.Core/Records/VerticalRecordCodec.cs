using System.Text;
using System.Text.RegularExpressions;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Records;

/// <summary>Exact-source field carriers; headings are presentation, never implicit field delimiters.</summary>
public static class VerticalRecordCodec
{
    private static readonly Regex Marker = new(@"\A<!-- (?:(grasp:field) ([0-9a-f]{32}) (value|null)|(/grasp:field) ([0-9a-f]{32})) -->\z", RegexOptions.CultureInvariant);

    public static RecordsParseResult Parse(string exactSource, RecordsDocumentDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(exactSource); ArgumentNullException.ThrowIfNull(descriptor);
        var diagnostics = new List<RecordDiagnostic>(); var fields = new List<RecordFieldSource>();
        var locators = new Dictionary<string, (RecordDescriptor Record, FieldLocator Locator)>(StringComparer.Ordinal);
        var schemaIds = new HashSet<string>(StringComparer.Ordinal); var recordIds = new HashSet<string>(StringComparer.Ordinal);
        void Problem(string code, string message, int at = 0, int length = 0) => diagnostics.Add(new(code, message, new(at, length)));
        foreach (var field in descriptor.Fields)
            if (!RecordText.Id(field.Id) || !RecordText.FieldKey(field.Key) || !schemaIds.Add(field.Id)) Problem("field-schema", "Field schema IDs and single-segment ASCII keys must be valid and unambiguous.");
        foreach (var record in descriptor.Records)
        {
            if (!RecordText.Id(record.Id) || !RecordText.Key(record.Key) || !recordIds.Add(record.Id)) Problem("record-schema", "Record identity and ASCII key must be valid and unique.");
            var memberFields = new HashSet<string>(StringComparer.Ordinal);
            foreach (var locator in record.Fields)
            {
                if (!schemaIds.Contains(locator.FieldId) || !memberFields.Add(locator.FieldId) || !ValidLocator(locator)
                    || !locators.TryAdd(locator.LocatorId, (record, locator))) Problem("field-locator", "Field locators must uniquely identify existing fields and explicit container indentation.");
            }
        }
        if (diagnostics.Count > 0) return new(exactSource, descriptor, fields, diagnostics);
        (RecordDescriptor Record, FieldLocator Locator)? active = null;
        var carrierStart = 0; var bodyStart = 0; var isNull = false; var seen = new HashSet<string>(StringComparer.Ordinal);
        var fence = new RecordText.Fence();
        foreach (var line in RecordText.Lines(exactSource))
        {
            var prefix = active is { } owner ? new string(' ', owner.Locator.Indent) : "";
            var contextLine = prefix.Length > 0 && line.Text.StartsWith(prefix, StringComparison.Ordinal) ? line.Text[prefix.Length..] : line.Text;
            if (fence.Consume(contextLine)) continue;
            var trimmed = line.Text.TrimStart(' ');
            if (!LooksLikeMarker(trimmed)) continue;
            var marker = Marker.Match(trimmed);
            if (!marker.Success) { Problem("field-marker", "Malformed field marker; no automatic rewrite is safe.", line.Start, line.Text.Length); continue; }
            var opening = marker.Groups[1].Success;
            var id = marker.Groups[opening ? 2 : 5].Value;
            if (!locators.TryGetValue(id, out var located)) { Problem("unknown-locator", "Marker has no matching host-provided identity locator.", line.Start, line.Text.Length); continue; }
            if (line.Text.Length - trimmed.Length != located.Locator.Indent)
            { Problem("field-indentation", "Marker indentation differs from its explicit layout.", line.Start, line.Text.Length); continue; }
            if (opening)
            {
                if (active is not null || !seen.Add(id)) { Problem("field-boundary", "Nested or repeated field carrier is ambiguous.", line.Start, line.Text.Length); continue; }
                active = located; carrierStart = line.Start; bodyStart = line.End; isNull = marker.Groups[3].Value == "null";
            }
            else
            {
                if (active is not { } current || current.Locator.LocatorId != id)
                { Problem("field-boundary", "Closing marker has no matching open field.", line.Start, line.Text.Length); continue; }
                var bodyEnd = line.Start;
                if (bodyEnd > bodyStart && exactSource[bodyEnd - 1] == '\n') { bodyEnd--; if (bodyEnd > bodyStart && exactSource[bodyEnd - 1] == '\r') bodyEnd--; }
                else if (bodyEnd > bodyStart && exactSource[bodyEnd - 1] == '\r') bodyEnd--;
                var body = SourceSpan.Between(bodyStart, bodyEnd);
                var value = Decode(exactSource, body, current.Locator.Indent, diagnostics);
                if (isNull && value.Source.Length != 0) Problem("null-content", "Null carrier cannot contain a competing value.", body.Start, body.Length);
                fields.Add(new(current.Record.Id, current.Locator.FieldId, id, value.Source, isNull,
                    SourceSpan.Between(carrierStart, line.Start + line.Text.Length), body, value.Map));
                active = null;
            }
        }
        if (active is { } remaining) Problem("unclosed-field", "Field has no closing boundary: " + remaining.Locator.LocatorId, carrierStart, exactSource.Length - carrierStart);
        foreach (var id in locators.Keys.Except(fields.Select(f => f.LocatorId), StringComparer.Ordinal)) Problem("missing-field", "No complete field carrier for locator " + id);
        return new(exactSource, descriptor, fields, diagnostics);
    }

    public static FieldEditResult PrepareFieldEdit(string exactSource, RecordsParseResult parsed, string recordId, string fieldId, FieldSourceEdit edit)
    {
        if (exactSource != parsed.Source) return new(null, [new("stale-source", "Field positions belong to a different source snapshot.", new(0, 0))]);
        // Public records can be copied or fabricated: revalidate rather than trusting supplied ranges.
        var verified = Parse(exactSource, parsed.Descriptor);
        if (!verified.CanRewrite) return new(null, verified.Diagnostics);
        var field = verified.Fields.SingleOrDefault(f => f.RecordId == recordId && f.FieldId == fieldId);
        if (field is null) return new(null, [new("missing-field", "Requested field has no unique source target.", new(0, 0))]);
        var locator = parsed.Descriptor.Records.Single(r => r.Id == recordId).Fields.Single(f => f.FieldId == fieldId);
        var encoded = SerializeCarrier(locator, edit, RecordText.NewLine(exactSource));
        if (!encoded.Success) return new(null, encoded.Diagnostics);
        var patch = new SourcePatch(field.CarrierSpan, encoded.Source!);
        var next = exactSource[..patch.Span.Start] + patch.Text + exactSource[patch.Span.End..];
        var roundTrip = Parse(next, parsed.Descriptor);
        var decoded = roundTrip.Fields.SingleOrDefault(f => f.RecordId == recordId && f.FieldId == fieldId);
        if (!roundTrip.CanRewrite || decoded?.RawSource != edit.Source || decoded.IsNull != edit.IsNull)
            return new(null, [new("field-roundtrip", "Proposed edit does not preserve an unambiguous exact field value.", field.CarrierSpan)]);
        return new(patch, []);
    }

    public static FieldCarrierResult SerializeCarrier(FieldLocator locator, FieldSourceEdit edit, string newLine = "\n")
    {
        if (!ValidLocator(locator) || newLine is not ("\n" or "\r\n" or "\r")) return Failure("field-locator", "Unsupported locator or line ending.");
        if (edit.IsNull && edit.Source.Length != 0) return Failure("null-content", "Null cannot carry text.");
        var fence = new RecordText.Fence();
        foreach (var line in RecordText.Lines(edit.Source))
            if (!fence.Consume(line.Text) && LooksLikeMarker(line.Text.TrimStart(' ')))
                return Failure("marker-collision", "Value contains an unescaped field marker; preserve it and choose an unambiguous representation.");
        if (fence.IsOpen) return Failure("unclosed-fence", "Unclosed code fence would consume the field boundary; preserve draft source until its boundary is unambiguous.");
        var prefix = new string(' ', locator.Indent);
        var value = locator.Indent == 0 ? edit.Source : Indent(edit.Source, prefix);
        return new(prefix + "<!-- grasp:field " + locator.LocatorId + (edit.IsNull ? " null -->" : " value -->") + newLine
            + value + newLine + prefix + "<!-- /grasp:field " + locator.LocatorId + " -->", []);
        static FieldCarrierResult Failure(string code, string message) => new(null, [new(code, message, new(0, 0))]);
    }

    private static bool ValidLocator(FieldLocator locator) => RecordText.Id(locator.FieldId) && RecordText.Id(locator.LocatorId)
        && (locator.Layout == FieldLayout.Headings && locator.Indent == 0 || locator.Layout == FieldLayout.NestedList && locator.Indent is >= 1 and <= 64);
    private static bool LooksLikeMarker(string text) => text.StartsWith("<!-- grasp:field", StringComparison.Ordinal) || text.StartsWith("<!-- /grasp:field", StringComparison.Ordinal);
    private static string Indent(string source, string prefix)
    {
        if (source.Length == 0) return prefix;
        var result = new StringBuilder();
        foreach (var line in RecordText.Lines(source)) result.Append(prefix).Append(line.Text).Append(line.Eol);
        return result.ToString();
    }
    private static (string Source, SourceMapSegment[] Map) Decode(string source, SourceSpan body, int indent, List<RecordDiagnostic> diagnostics)
    {
        var text = source.Substring(body.Start, body.Length);
        if (indent == 0) return (text, text.Length == 0 ? [] : [new(new(0, text.Length), body)]);
        var result = new StringBuilder(); var map = new List<SourceMapSegment>(); var prefix = new string(' ', indent);
        foreach (var line in RecordText.Lines(text))
        {
            var skipped = line.Text.StartsWith(prefix, StringComparison.Ordinal) ? indent : line.Text.Length == 0 ? 0 : -1;
            if (skipped < 0) { diagnostics.Add(new("field-indentation", "Nested field content escaped its explicit indentation boundary.", new(body.Start + line.Start, line.Text.Length))); skipped = 0; }
            var content = line.Text[skipped..] + line.Eol;
            if (content.Length > 0) map.Add(new(new(result.Length, content.Length), new(body.Start + line.Start + skipped, content.Length)));
            result.Append(content);
        }
        return (result.ToString(), map.ToArray());
    }
}
