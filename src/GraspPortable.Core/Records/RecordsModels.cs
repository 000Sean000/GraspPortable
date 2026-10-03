using System.Numerics;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Records;

public enum RecordFieldKind { Markdown, Number, Boolean, Date, SingleSelect, MultiSelect, Tag, SingleRelation, MultiRelation }
public enum FieldLayout { Headings, NestedList }
public sealed record FieldOption(string Id, string DisplayName);
public sealed record FieldSchema(string Id, string Key, string DisplayName, RecordFieldKind Kind, IReadOnlyList<FieldOption>? Options = null);
public sealed record FieldLocator(string FieldId, string LocatorId, FieldLayout Layout = FieldLayout.Headings, int Indent = 0);
public sealed record RecordDescriptor(string Id, string Key, string DisplayName, IReadOnlyList<FieldLocator> Fields);
public sealed record RecordsDocumentDescriptor(IReadOnlyList<RecordDescriptor> Records, IReadOnlyList<FieldSchema> Fields);
public sealed record RecordDiagnostic(string Code, string Message, SourceSpan Span);
/// <summary>Equal-length UTF-16 slices: decoded field text to its exact physical source, excluding container indentation.</summary>
public sealed record SourceMapSegment(SourceSpan ValueSpan, SourceSpan SourceSpan);
public sealed record RecordFieldSource(string RecordId, string FieldId, string LocatorId, string RawSource, bool IsNull,
    SourceSpan CarrierSpan, SourceSpan BodySpan, IReadOnlyList<SourceMapSegment> SourceMap)
{
    /// <summary>Bounding physical span; multiline ranges can include intervening container indentation.</summary>
    public SourceSpan MapToSource(SourceSpan span)
    {
        if (span.Start < 0 || span.Length < 0 || span.End > RawSource.Length) throw new ArgumentOutOfRangeException(nameof(span));
        int Position(int at, bool end)
        {
            var segment = SourceMap.FirstOrDefault(m => end ? at > m.ValueSpan.Start && at <= m.ValueSpan.End : at >= m.ValueSpan.Start && at < m.ValueSpan.End);
            if (segment is not null) return segment.SourceSpan.Start + at - segment.ValueSpan.Start;
            return at == RawSource.Length && SourceMap.Count > 0 ? SourceMap[^1].SourceSpan.End : BodySpan.Start;
        }
        var start = Position(span.Start, false);
        return span.Length == 0 ? new(start, 0) : SourceSpan.Between(start, Position(span.End, true));
    }
}
public sealed record RecordsParseResult(string Source, RecordsDocumentDescriptor Descriptor,
    IReadOnlyList<RecordFieldSource> Fields, IReadOnlyList<RecordDiagnostic> Diagnostics)
{ public bool CanRewrite => Diagnostics.Count == 0; }
public sealed record FieldSourceEdit(string Source, bool IsNull = false);
public sealed record FieldEditResult(SourcePatch? Patch, IReadOnlyList<RecordDiagnostic> Diagnostics)
{ public bool Success => Patch is not null && Diagnostics.Count == 0; }
public sealed record FieldCarrierResult(string? Source, IReadOnlyList<RecordDiagnostic> Diagnostics)
{ public bool Success => Source is not null && Diagnostics.Count == 0; }

public abstract record RecordValue;
public sealed record NullRecordValue : RecordValue;
public sealed record MarkdownRecordValue(string Markdown) : RecordValue;
/// <summary>Exact coefficient * 10^-scale. Never stores a rounded binary floating-point or decimal approximation.</summary>
public sealed record NumberRecordValue(BigInteger Coefficient, int Scale) : RecordValue;
public sealed record BooleanRecordValue(bool Value) : RecordValue;
public sealed record DateRecordValue(DateOnly Value) : RecordValue;
public sealed record SelectRecordValue(IReadOnlyList<string> OptionIds) : RecordValue;
public sealed record TagRecordValue(IReadOnlyList<string> Tags) : RecordValue;
public sealed record RelationRecordValue(IReadOnlyList<string> RecordIds) : RecordValue;
public sealed record RecordValueLookup(IReadOnlySet<string>? ExistingRecordIds = null);
/// <summary>Diagnostics refer to the provided computed Markdown, not a different original source snapshot.</summary>
public sealed record RecordValueResult(RecordValue? Value, IReadOnlyList<RecordDiagnostic> Diagnostics)
{ public bool IsValid => Diagnostics.Count == 0; }
public sealed record RecordFieldProjection(string PublicName, string RecordId, string FieldId, bool IsNull,
    IReadOnlyList<BindingPart> Parts, ParseResult OriginalSyntax, IReadOnlyList<RecordDiagnostic> Diagnostics);
public sealed record HeadingMap(SourceSpan OriginalSpan, SourceSpan ConvertedSpan, int OriginalLevel, int? ConvertedLevel, int ListDepth);
public sealed record HeadingConversionPreview(string OriginalSource, string ConvertedSource, FieldLayout Layout,
    IReadOnlyList<HeadingMap> Mapping, IReadOnlyList<RecordDiagnostic> Diagnostics)
{ public bool CanApply => Diagnostics.Count == 0; }
