using System.Text;
using System.Text.Json;
using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Knowledge;

/// <summary>Classifies original field sources against their accepted identity-matched source, never against evaluated values.</summary>
internal static class RecordReferenceEdits
{
    public static ExternalReferenceEditAnalysis Classify(Note accepted, string observedSource, RecordsDocumentDescriptor? observedRecords,
        IReadOnlyList<string> languages, CancellationToken token = default)
    {
        if (accepted.Records is null && observedRecords is null)
            return ExternalReferenceEdits.Classify(accepted.Source, observedSource, languages, token);
        var diagnostics = new List<ExternalReferenceEditDiagnostic>();
        ExternalReferenceEditAnalysis Result(ExternalReferenceEditStatus status, IReadOnlyList<ExternalReferenceValueProposal>? proposals = null)
            => new(status, accepted.Source, observedSource, languages.ToArray(), proposals ?? [], diagnostics.ToArray());
        ExternalReferenceEditAnalysis Review(string code, string message)
        {
            diagnostics.Add(new(code, message, new(0, accepted.Source.Length), new(0, observedSource.Length)));
            return Result(ExternalReferenceEditStatus.NeedsReview);
        }
        if (accepted.Records is null || observedRecords is null)
            return Review("external-field-topology", "欄位承載結構新增或移除，不能推斷為單純共享值修改。");
        var before = VerticalRecordCodec.Parse(accepted.Source, accepted.Records);
        var after = VerticalRecordCodec.Parse(observedSource, observedRecords);
        if (!before.CanRewrite || !after.CanRewrite)
            return Review("external-field-framing", "欄位邊界無法唯一解析，保留原文等待核對。");
        var oldFields = before.Fields.OrderBy(f => f.CarrierSpan.Start).ToArray();
        var newFields = after.Fields.OrderBy(f => f.CarrierSpan.Start).ToArray();
        if (!oldFields.Select(f => (f.RecordId, f.FieldId)).SequenceEqual(newFields.Select(f => (f.RecordId, f.FieldId))))
            return Review("external-field-topology", "欄位新增、移除或順序改變，不能單靠文字配對共享修改。");

        var proposals = new List<ExternalReferenceValueProposal>();
        var analyses = new List<ExternalReferenceEditStatus>();
        void Add(ExternalReferenceEditAnalysis analysis, Func<SourceSpan, SourceSpan> mapBefore, Func<SourceSpan, SourceSpan> mapAfter)
        {
            analyses.Add(analysis.Status);
            diagnostics.AddRange(analysis.Diagnostics.Select(d => d with {
                AcceptedSpan = d.AcceptedSpan is { } a ? mapBefore(a) : null,
                ObservedSpan = d.ObservedSpan is { } b ? mapAfter(b) : null }));
            proposals.AddRange(analysis.Proposals.Select(p => p with { ChangedOccurrences = p.ChangedOccurrences.Select(o => o with {
                AcceptedCarrierSpan = mapBefore(o.AcceptedCarrierSpan), AcceptedValueSpan = mapBefore(o.AcceptedValueSpan),
                ObservedCarrierSpan = mapAfter(o.ObservedCarrierSpan), ObservedValueSpan = mapAfter(o.ObservedValueSpan) }).ToArray() }));
        }
        // A fixed whitespace mask keeps outer parsing independent of field length.
        // Source maps restore physical UTF-16 positions after the masking step.
        var oldOuter = MaskFields(accepted.Source, oldFields);
        var newOuter = MaskFields(observedSource, newFields);
        var outerAnalysis = ExternalReferenceEdits.Classify(oldOuter.Text, newOuter.Text, languages, token);
        if (outerAnalysis.Proposals.SelectMany(p => p.ChangedOccurrences).Any(o => oldOuter.CrossesMask(o.AcceptedCarrierSpan) || newOuter.CrossesMask(o.ObservedCarrierSpan)))
            return Review("external-reference-field-overlap", "外層引用橫跨欄位承載結構，無法安全推斷共享修改。");
        Add(outerAnalysis, oldOuter.Map, newOuter.Map);
        for (var i = 0; i < oldFields.Length; i++)
        {
            token.ThrowIfCancellationRequested();
            var a = oldFields[i]; var b = newFields[i];
            Add(ExternalReferenceEdits.Classify(a.RawSource, b.RawSource, languages, token), a.MapToSource, b.MapToSource);
        }
        if (analyses.Contains(ExternalReferenceEditStatus.Ambiguous)) return Result(ExternalReferenceEditStatus.Ambiguous);
        if (analyses.Contains(ExternalReferenceEditStatus.NeedsReview)) return Result(ExternalReferenceEditStatus.NeedsReview);
        if (proposals.Count == 0) return Result(ExternalReferenceEditStatus.NoIntent);
        if (JsonSerializer.Serialize(accepted.Records) != JsonSerializer.Serialize(observedRecords))
            return Review("external-field-mixed-metadata", "引用值與欄位 metadata 同時改動，保留原文等待核對。");

        var merged = new List<ExternalReferenceValueProposal>();
        foreach (var group in proposals.GroupBy(p => p.TargetName, StringComparer.Ordinal))
        {
            if (group.Select(p => p.ProposedValue).Distinct(StringComparer.Ordinal).Count() != 1)
            {
                diagnostics.Add(new("external-reference-values-disagree", "不同欄位或外層引用對同一 target 提出不同值，需要使用者處理。"));
                return Result(ExternalReferenceEditStatus.Ambiguous);
            }
            merged.Add(new(group.Key, group.First().ProposedValue, group.SelectMany(p => p.ChangedOccurrences).ToArray()));
        }
        var occurrences = merged.SelectMany(p => p.ChangedOccurrences).OrderBy(o => o.AcceptedValueSpan.Start).ToArray();
        var acceptedAt = 0; var observedAt = 0;
        foreach (var occurrence in occurrences)
        {
            token.ThrowIfCancellationRequested();
            if (occurrence.AcceptedValueSpan.Start < acceptedAt || occurrence.ObservedValueSpan.Start < observedAt
                || !accepted.Source.AsSpan(acceptedAt, occurrence.AcceptedValueSpan.Start - acceptedAt)
                    .SequenceEqual(observedSource.AsSpan(observedAt, occurrence.ObservedValueSpan.Start - observedAt)))
                return Review("external-reference-mixed-source", "引用值以外的欄位或外層原文也已改動，不能自動推斷共享修改。");
            acceptedAt = occurrence.AcceptedValueSpan.End; observedAt = occurrence.ObservedValueSpan.End;
        }
        if (!accepted.Source.AsSpan(acceptedAt).SequenceEqual(observedSource.AsSpan(observedAt)))
            return Review("external-reference-mixed-source", "引用值以外的欄位或外層原文也已改動，不能自動推斷共享修改。");
        var indices = occurrences.Select((occurrence, index) => (occurrence, index)).ToDictionary(p => p.occurrence, p => p.index);
        return Result(ExternalReferenceEditStatus.Proposed, merged.Select(p => p with {
            ChangedOccurrences = p.ChangedOccurrences.Select(o => o with { OccurrenceIndex = indices[o] }).ToArray() }).ToArray());
    }

    private static MaskedSource MaskFields(string source, IReadOnlyList<RecordFieldSource> fields)
    {
        var text = new StringBuilder(); var mapping = new List<MaskSegment>(); var at = 0;
        foreach (var field in fields)
        {
            CopyTo(field.CarrierSpan.Start);
            // Masked carrier is one blank line. Mapping its diagnostics to the
            // carrier start/end is descriptive only; valid outer references never
            // contain the field's original Grasp syntax.
            mapping.Add(new(new(text.Length, 1), field.CarrierSpan)); text.Append('\n');
            at = field.CarrierSpan.End;
        }
        CopyTo(source.Length);
        return new(text.ToString(), source.Length, mapping);
        void CopyTo(int end)
        {
            if (end == at) return;
            mapping.Add(new(new(text.Length, end - at), SourceSpan.Between(at, end)));
            text.Append(source, at, end - at); at = end;
        }
    }
    private sealed record MaskSegment(SourceSpan ValueSpan, SourceSpan SourceSpan);
    private sealed record MaskedSource(string Text, int SourceLength, IReadOnlyList<MaskSegment> Segments)
    {
        public bool CrossesMask(SourceSpan span) => Segments.Any(s => s.ValueSpan.Length != s.SourceSpan.Length
            && span.Start < s.ValueSpan.End && span.End > s.ValueSpan.Start);
        public SourceSpan Map(SourceSpan span)
        {
            int Position(int at, bool end)
            {
                var segment = Segments.FirstOrDefault(s => end ? at > s.ValueSpan.Start && at <= s.ValueSpan.End : at >= s.ValueSpan.Start && at < s.ValueSpan.End);
                if (segment is null) return at == Text.Length ? SourceLength : 0;
                if (segment.ValueSpan.Length != segment.SourceSpan.Length) return end ? segment.SourceSpan.End : segment.SourceSpan.Start;
                return segment.SourceSpan.Start + at - segment.ValueSpan.Start;
            }
            var start = Position(span.Start, false);
            return span.Length == 0 ? new(start, 0) : SourceSpan.Between(start, Position(span.End, true));
        }
    }
}
