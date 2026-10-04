using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Knowledge;

public enum ExternalReferenceEditStatus { NoIntent, Proposed, NeedsReview, Ambiguous }
public sealed record ExternalReferenceEditDiagnostic(string Code, string Message,
    SourceSpan? AcceptedSpan = null, SourceSpan? ObservedSpan = null);
public sealed record ExternalReferenceOccurrenceEdit(int OccurrenceIndex, ReferenceKind Kind,
    SourceSpan AcceptedCarrierSpan, SourceSpan AcceptedValueSpan,
    SourceSpan ObservedCarrierSpan, SourceSpan ObservedValueSpan, string AcceptedCachedValue);
public sealed record ExternalReferenceValueProposal(string TargetName, string ProposedValue,
    IReadOnlyList<ExternalReferenceOccurrenceEdit> ChangedOccurrences);

/// <summary>
/// Spans belong exclusively to the exact source strings retained here. Proposed
/// means a uniquely classified intent, not permission to apply it: the caller
/// must still check canonical identity, literal ownership, current source hashes,
/// drafts, policy revision and knowledge versions before any shared write.
/// </summary>
public sealed record ExternalReferenceEditAnalysis(ExternalReferenceEditStatus Status,
    string AcceptedSource, string ObservedSource, IReadOnlyList<string> EnabledFenceLanguages,
    IReadOnlyList<ExternalReferenceValueProposal> Proposals,
    IReadOnlyList<ExternalReferenceEditDiagnostic> Diagnostics);

public static class ExternalReferenceEdits
{
    /// <summary>
    /// Uses the common accepted file source as the only value-edit baseline.
    /// Current evaluated values deliberately are not an input: an unchanged old
    /// cache must never be interpreted as a request to revert a newer definition.
    /// Both sources are parsed with one policy snapshot and the existing codecs.
    /// </summary>
    public static ExternalReferenceEditAnalysis Classify(string acceptedSource, string observedSource,
        IReadOnlyList<string> enabledFenceLanguages, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(acceptedSource);
        ArgumentNullException.ThrowIfNull(observedSource);
        ArgumentNullException.ThrowIfNull(enabledFenceLanguages);
        var policy = Array.AsReadOnly(enabledFenceLanguages.ToArray());
        var accepted = GraspParser.Parse(acceptedSource, policy, cancellationToken);
        var observed = GraspParser.Parse(observedSource, policy, cancellationToken);
        var diagnostics = new List<ExternalReferenceEditDiagnostic>();
        diagnostics.AddRange(accepted.Diagnostics.Select(d => new ExternalReferenceEditDiagnostic(d.Code, d.Message, AcceptedSpan: d.Span)));
        diagnostics.AddRange(observed.Diagnostics.Select(d => new ExternalReferenceEditDiagnostic(d.Code, d.Message, ObservedSpan: d.Span)));
        if (diagnostics.Count != 0) return Result(ExternalReferenceEditStatus.Ambiguous);

        var before = accepted.References.OrderBy(r => r.Span.Start).ToArray();
        var after = observed.References.OrderBy(r => r.Span.Start).ToArray();
        if (before.Length != after.Length)
        {
            if (OnlyAddedOrRemovedUnchangedReferences(before, after, cancellationToken))
                return Result(ExternalReferenceEditStatus.NoIntent);
            diagnostics.Add(new("external-reference-topology", "引用新增或移除時，既有 occurrence 無法唯一配對或顯示值也已改動；保留原文等待核對。",
                new(0, acceptedSource.Length), new(0, observedSource.Length)));
            return Result(ExternalReferenceEditStatus.Ambiguous);
        }
        for (var i = 0; i < before.Length; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (before[i].Kind != after[i].Kind || !string.Equals(before[i].Name, after[i].Name, StringComparison.Ordinal))
                diagnostics.Add(new("external-reference-identity", "引用 target、形式或 occurrence 順序改變，不能只靠同名配對。", before[i].Span, after[i].Span));
        }
        if (diagnostics.Count != 0) return Result(ExternalReferenceEditStatus.Ambiguous);

        var changed = Enumerable.Range(0, before.Length)
            .Where(i => !string.Equals(before[i].CachedValue, after[i].CachedValue, StringComparison.Ordinal)).ToArray();
        if (changed.Length == 0) return Result(ExternalReferenceEditStatus.NoIntent);

        var proposals = new List<ExternalReferenceValueProposal>();
        foreach (var group in changed.GroupBy(i => after[i].Name, StringComparer.Ordinal))
        {
            var indices = group.ToArray();
            var proposedValue = after[indices[0]].CachedValue;
            if (indices.Any(i => !string.Equals(after[i].CachedValue, proposedValue, StringComparison.Ordinal)))
            {
                foreach (var index in indices)
                    diagnostics.Add(new("external-reference-values-disagree", "同一 target 的多處外部修改提出不同值，需要使用者處理。", before[index].ValueSpan, after[index].ValueSpan));
                continue;
            }
            proposals.Add(new(group.Key, proposedValue, indices.Select(i => new ExternalReferenceOccurrenceEdit(i,
                before[i].Kind, before[i].Span, before[i].ValueSpan, after[i].Span, after[i].ValueSpan, before[i].CachedValue)).ToArray()));
        }
        if (diagnostics.Count != 0) return Result(ExternalReferenceEditStatus.Ambiguous);

        // Compare each intervening source segment, rather than inserting a
        // sentinel that could itself appear in user content. Value spans may
        // contain real newlines and escape spellings; everything else is exact.
        var acceptedAt = 0;
        var observedAt = 0;
        for (var i = 0; i < before.Length; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!acceptedSource.AsSpan(acceptedAt, before[i].ValueSpan.Start - acceptedAt)
                .SequenceEqual(observedSource.AsSpan(observedAt, after[i].ValueSpan.Start - observedAt)))
                return MixedSource();
            acceptedAt = before[i].ValueSpan.End;
            observedAt = after[i].ValueSpan.End;
        }
        if (!acceptedSource.AsSpan(acceptedAt).SequenceEqual(observedSource.AsSpan(observedAt))) return MixedSource();
        return Result(ExternalReferenceEditStatus.Proposed, proposals);

        ExternalReferenceEditAnalysis MixedSource()
        {
            diagnostics.Add(new("external-reference-mixed-source", "引用值與其他原文或定義同時改動；需要進一步身分、來源及版本核對，不能自動推斷共享修改。",
                new(0, acceptedSource.Length), new(0, observedSource.Length)));
            return Result(ExternalReferenceEditStatus.NeedsReview);
        }
        ExternalReferenceEditAnalysis Result(ExternalReferenceEditStatus status, IReadOnlyList<ExternalReferenceValueProposal>? values = null)
            => new(status, acceptedSource, observedSource, policy, values ?? [], diagnostics.ToArray());
    }

    private static bool OnlyAddedOrRemovedUnchangedReferences(ParsedReference[] before, ParsedReference[] after, CancellationToken token)
    {
        var shorter = before.Length < after.Length ? before : after;
        var longer = before.Length < after.Length ? after : before;
        // Earliest and latest monotone embeddings must coincide. This permits
        // ordinary insertion/removal without guessing which duplicate survived,
        // and stays linear rather than introducing a general-purpose diff.
        var earliest = new int[shorter.Length];
        var at = 0;
        bool SameIdentity(ParsedReference a, ParsedReference b) => a.Kind == b.Kind && a.Name == b.Name;
        for (var i = 0; i < shorter.Length; i++)
        {
            token.ThrowIfCancellationRequested();
            while (at < longer.Length && !SameIdentity(shorter[i], longer[at])) { token.ThrowIfCancellationRequested(); at++; }
            if (at == longer.Length) return false;
            earliest[i] = at++;
        }
        at = longer.Length - 1;
        for (var i = shorter.Length - 1; i >= 0; i--)
        {
            token.ThrowIfCancellationRequested();
            while (at >= 0 && !SameIdentity(shorter[i], longer[at])) { token.ThrowIfCancellationRequested(); at--; }
            if (at != earliest[i] || shorter[i].CachedValue != longer[at].CachedValue) return false;
            at--;
        }
        // Unmatched carriers are new/removed source, never shared value intents.
        // Empty sequences also mean there is no retained value to reinterpret.
        return true;
    }
}
