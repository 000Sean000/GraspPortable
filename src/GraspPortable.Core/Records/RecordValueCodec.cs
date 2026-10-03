using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Records;

/// <summary>Typed projection of already computed Markdown. Never invokes Grasp parsing or rewrites invalid input.</summary>
public static class RecordValueCodec
{
    public const int MaximumNumberCharacters = 8192;
    public const int MaximumNumberDigits = 4096;
    public const int MaximumNumberScale = 10000;
    private static readonly Regex Number = new(@"\A(?<sign>[+-]?)(?<integer>[0-9]+)(?:\.(?<fraction>[0-9]+))?(?:[eE](?<exponent>[+-]?[0-9]+))?\z", RegexOptions.CultureInvariant);
    private static readonly Regex Carrier = new(@"\A(?:- )?\[(?:\\.|[^\]\\])*\]\((?:\\.|[^)\\])*\) <!-- grasp:(option|record) ([0-9a-f]{32}) -->\z", RegexOptions.CultureInvariant);

    public static RecordValueResult Parse(FieldSchema field, bool isNull, string computedMarkdown, RecordValueLookup? lookup = null)
    {
        ArgumentNullException.ThrowIfNull(field); ArgumentNullException.ThrowIfNull(computedMarkdown);
        RecordValueResult Error(string code, string message) => new(null, [new(code, message, new(0, computedMarkdown.Length))]);
        if (isNull) return computedMarkdown.Length == 0 ? new(new NullRecordValue(), []) : Error("null-content", "Null cannot also contain a value.");
        if (field.Kind == RecordFieldKind.Markdown) return new(new MarkdownRecordValue(computedMarkdown), []);
        var value = computedMarkdown.Trim();
        switch (field.Kind)
        {
            case RecordFieldKind.Number:
                if (computedMarkdown.Length > MaximumNumberCharacters) return Error("number-limit", "Number exceeds the supported input length; raw source is retained.");
                var match = Number.Match(value);
                if (!match.Success) return Error("number-format", "Use an invariant integer/decimal with an optional base-10 exponent.");
                var fraction = match.Groups["fraction"].Value;
                var digits = match.Groups["integer"].Value + fraction;
                var exponentText = match.Groups["exponent"].Value;
                if (digits.Length > MaximumNumberDigits || exponentText.Length > 0
                    && (!int.TryParse(exponentText, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out _) || exponentText.Length > 7))
                    return Error("number-limit", "Exact number exceeds the supported precision or exponent guard.");
                var exponent = exponentText.Length == 0 ? 0 : int.Parse(exponentText, CultureInfo.InvariantCulture);
                var scale = (long)fraction.Length - exponent;
                if (Math.Abs((long)exponent) > MaximumNumberScale || Math.Abs(scale) > MaximumNumberScale)
                    return Error("number-limit", "Exact number exponent/scale is outside the supported bound; it was not rounded.");
                var coefficient = BigInteger.Parse(digits, CultureInfo.InvariantCulture);
                if (match.Groups["sign"].Value == "-") coefficient = -coefficient;
                if (coefficient.IsZero) scale = 0;
                else while (scale > 0 && coefficient % 10 == 0) { coefficient /= 10; scale--; }
                return new(new NumberRecordValue(coefficient, (int)scale), []);
            case RecordFieldKind.Boolean:
                return value switch { "true" => new(new BooleanRecordValue(true), []), "false" => new(new BooleanRecordValue(false), []), _ => Error("boolean-format", "Boolean must be true or false; empty text is not null.") };
            case RecordFieldKind.Date:
                return DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
                    ? new(new DateRecordValue(date), []) : Error("date-format", "Date must be a valid date-only yyyy-MM-dd value.");
            case RecordFieldKind.Tag:
                var tags = new List<string>();
                foreach (var line in RecordText.Lines(value))
                {
                    if (!line.Text.StartsWith("- ", StringComparison.Ordinal) || line.Text.Length == 2)
                        return Error("tag-format", "Each nonempty tag uses its own '- tag' line.");
                    tags.Add(line.Text[2..]);
                }
                if (tags.Count != tags.Distinct(StringComparer.Ordinal).Count()) return Error("duplicate-tag", "Repeated tags require explicit correction; source was not normalized.");
                return new(new TagRecordValue(tags), []);
            case RecordFieldKind.SingleSelect:
            case RecordFieldKind.MultiSelect:
            case RecordFieldKind.SingleRelation:
            case RecordFieldKind.MultiRelation:
                var relation = field.Kind is RecordFieldKind.SingleRelation or RecordFieldKind.MultiRelation;
                var single = field.Kind is RecordFieldKind.SingleSelect or RecordFieldKind.SingleRelation;
                var ids = new List<string>();
                foreach (var line in RecordText.Lines(value))
                {
                    var carrier = Carrier.Match(line.Text);
                    if (!carrier.Success || carrier.Groups[1].Value != (relation ? "record" : "option") || !RecordText.Id(carrier.Groups[2].Value))
                        return Error("identity-carrier", "Expected a readable Markdown link with its explicit stable option/record ID carrier.");
                    ids.Add(carrier.Groups[2].Value);
                }
                if (single && ids.Count != 1) return Error("value-cardinality", "Single value requires exactly one carrier; use null explicitly for absence.");
                if (ids.Count != ids.Distinct(StringComparer.Ordinal).Count()) return Error("duplicate-value", "Repeated identities require explicit correction.");
                var diagnostics = new List<RecordDiagnostic>();
                if (relation)
                {
                    if (lookup?.ExistingRecordIds is { } existing)
                        foreach (var id in ids.Where(id => !existing.Contains(id))) diagnostics.Add(new("missing-relation", "Related record is missing: " + id, new(0, computedMarkdown.Length)));
                    return new(new RelationRecordValue(ids), diagnostics);
                }
                var options = field.Options ?? [];
                if (options.Any(o => !RecordText.Id(o.Id)) || options.Select(o => o.Id).Distinct(StringComparer.Ordinal).Count() != options.Count)
                    return Error("option-schema", "Option IDs must be valid and unique within the field.");
                foreach (var id in ids.Where(id => !options.Any(o => o.Id == id))) diagnostics.Add(new("missing-option", "Option is absent from this field schema: " + id, new(0, computedMarkdown.Length)));
                return new(new SelectRecordValue(ids), diagnostics);
            default: return Error("field-type", "Unsupported field type; original source remains authoritative.");
        }
    }

    /// <summary>Carrier helper for a caller that has already resolved the readable navigation target.</summary>
    public static string IdentityCarrier(string displayName, string linkTarget, string id, bool relation, bool listItem = true)
    {
        if (!RecordText.Id(id) || displayName.Contains('\r') || displayName.Contains('\n') || linkTarget.Contains('\r') || linkTarget.Contains('\n'))
            throw new ArgumentException("Identity carriers require a valid UUID and single-line label/link target.");
        static string Escape(string text, string characters) => string.Concat(text.Select(c => characters.Contains(c) ? "\\" + c : c.ToString()));
        return (listItem ? "- " : "") + "[" + Escape(displayName, "\\[]") + "](" + Escape(linkTarget, "\\()") + ") <!-- grasp:"
            + (relation ? "record" : "option") + " " + id + " -->";
    }
}
