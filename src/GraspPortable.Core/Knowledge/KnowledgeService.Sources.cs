using GraspPortable.Core.ValueEngine;
using GraspPortable.Core.Records;

namespace GraspPortable.Core.Knowledge;

public sealed partial class KnowledgeService
{
    public Task<Receipt> MarkSourceUnavailableAsync(string operationId,
        IReadOnlyDictionary<string, string> reasons, CancellationToken token = default)
        => ObserveExternalAsync(operationId, [], token, unavailableReasons: reasons);

    private async Task<Receipt> SaveUnacceptedDraftAsync(Snapshot basis, Draft draft, string operationId, string fingerprint,
        string message, ParseDiagnostic[] diagnostics, CancellationToken token)
    {
        var notes = basis.Notes.ToDictionary(p => p.Key, p => p.Value);
        notes[draft.NoteId] = notes[draft.NoteId] with { Title = NormalizeTitle(draft.Title),
            SavedSource = new(draft.Source, "invalid", diagnostics.Length == 0 ? [new("source-unaccepted", message, new(0, 0))] : diagnostics, notes[draft.NoteId].CurrentRecords) };
        var prepared = await PrepareAsync(basis, notes, basis.Languages, basis.PolicyRevision, null, token);
        if(prepared.Error is { } error) return Reject(operationId, fingerprint, "invalid", error, draft.NoteId);
        return await PublishAsync(basis, prepared.State!, operationId, fingerprint, draft.NoteId, draft, token, successStatus: "source-saved");
    }

    public Task<Receipt> ObserveDeletedAsync(string operationId, IReadOnlyDictionary<string, string> expectedSourceHashes,
        CancellationToken token = default)
        => ObserveExternalAsync(operationId, [], token, expectedSourceHashes);

    /// <summary>
    /// Accepts an observed batch after the Host has retained its exact file bytes.
    /// The adapter still has to guard physical hashes and journal derived writes.
    /// Invalid/competing raw text is saved separately from the last accepted AST.
    /// </summary>
    public async Task<Receipt> ObserveExternalAsync(string operationId, IReadOnlyList<ExternalNoteChange> changes,
        CancellationToken token = default, IReadOnlyDictionary<string, string>? deletedExpectedHashes = null,
        IReadOnlyDictionary<string, string>? unavailableReasons = null)
    {
        if(changes.Any(c => !Guid.TryParse(c.NoteId, out var id) || id == Guid.Empty))
            return Reject(operationId, "", "rejected", "來源筆記身分必須是有效 UUID。");
        changes = changes.Select(c => c with { NoteId = Guid.Parse(c.NoteId).ToString("N") }).ToArray();
        var hash = Fingerprint(new { kind = "observe-source", changes, deletedExpectedHashes, unavailableReasons });
        if (Retry(operationId, hash) is { } retry) return retry;
        var basis = Current;
        if(changes.Count == 0 && (deletedExpectedHashes?.Count ?? 0) == 0 && (unavailableReasons?.Count ?? 0) == 0 || changes.Select(c => c.NoteId).Distinct(StringComparer.Ordinal).Count() != changes.Count
            || changes.Any(c => deletedExpectedHashes?.ContainsKey(c.NoteId) == true))
            return Reject(operationId, hash, "rejected", "來源觀測必須有唯一筆記身分。");
        var notes = basis.Notes.ToDictionary(p => p.Key, p => p.Value);
        var guards = new Dictionary<string, Draft?>(StringComparer.Ordinal);
        foreach(var (id, reason) in unavailableReasons ?? new Dictionary<string,string>())
            if(notes.TryGetValue(id, out var unavailable)) notes[id] = unavailable with {
                SavedSource = new(unavailable.CurrentSource, "unavailable", [new("source-unavailable", reason, new(0,0))], unavailable.CurrentRecords) };
        foreach(var (id, expected) in deletedExpectedHashes ?? new Dictionary<string,string>())
        {
            if(!notes.TryGetValue(id, out var missing) || missing.CurrentSourceHash != expected)
                return Reject(operationId, hash, "conflict", "刪除觀測的來源基底已變，請重新觀測。", id);
            guards[id] = GetDraft(id);
            if(guards[id] is null) notes.Remove(id);
            else notes[id] = missing with { SavedSource = new(missing.CurrentSource, "missing",
                [new("source-deleted-with-draft", "檔案已在外部刪除，保留最後原文及 App 草稿等待處理。", new(0,0))], missing.CurrentRecords) };
        }
        var retainedAfterDeletions = notes.ToDictionary(p => p.Key, p => p.Value);
        var identities = new Dictionary<string, string>(StringComparer.Ordinal);
        var renames = new Dictionary<string, string>(StringComparer.Ordinal);
        var proposals = new Dictionary<string, List<(string NoteId, ExternalReferenceValueProposal Proposal)>>(StringComparer.Ordinal);
        foreach(var change in changes)
        {
            token.ThrowIfCancellationRequested();
            var existing = basis.Notes.GetValueOrDefault(change.NoteId);
            if(existing is null ? change.ExpectedSourceHash is not null : change.ExpectedSourceHash != existing.CurrentSourceHash)
                return Reject(operationId, hash, "conflict", "原文基底已更新，請重新觀測。", change.NoteId);
            guards[change.NoteId] = GetDraft(change.NoteId);
            var old = existing ?? new Note(change.NoteId, NormalizeTitle(change.Title), "", 0, GraspParser.Parse("", basis.Languages), []);
            var parsed = RecordNoteSyntax.Parse(change.Source, change.Records, basis.Languages, token);
            var localRenames = new Dictionary<string, string>(StringComparer.Ordinal);
            notes[change.NoteId] = old with { Title = NormalizeTitle(change.Title), Source = change.Source, Syntax = parsed, SavedSource = null, Records = change.Records };
            if(guards[change.NoteId] is not null)
            { Retain(change, old, "conflict", [new("source-draft-conflict", "外部原文與 App 草稿並存；請核對後合併。", new(0, 0))]); continue; }
            if(!parsed.IsValid)
            { Retain(change, old, "invalid", parsed.Diagnostics.ToArray()); continue; }
            if(existing is not null)
            {
                var detected = DetectRenames(old.Syntax, parsed);
                if(detected is null)
                { Retain(change, old, "conflict", [new("source-identity", "無法可靠對應改名身分，保留來源等待核對。", new(0, 0))]); continue; }
                localRenames = detected;
                var edits = RecordReferenceEdits.Classify(old, change.Source, change.Records, basis.Languages, token);
                // A document without previous carriers cannot contain a shared
                // edit of one. Newly inserted references are ordinary source.
                if(old.Syntax.References.Count > 0 && edits.Status is ExternalReferenceEditStatus.NeedsReview or ExternalReferenceEditStatus.Ambiguous)
                {
                    Retain(change, old, "conflict", edits.Diagnostics.Select(d => new ParseDiagnostic(d.Code, d.Message, d.ObservedSpan ?? new(0, 0))).ToArray());
                    continue;
                }
                foreach(var proposal in edits.Proposals)
                {
                    if(!proposals.TryGetValue(proposal.TargetName, out var list)) proposals[proposal.TargetName] = list = [];
                    list.Add((change.NoteId, proposal));
                }
            }
            foreach(var identity in change.DefinitionIds ?? new Dictionary<string, string>())
            {
                // Metadata may still contain the old key after a raw rename.
                var name = localRenames.GetValueOrDefault(identity.Key, identity.Key);
                if(!parsed.Definitions.Any(d => d.Name == name)) continue;
                if(!Guid.TryParse(identity.Value, out var canonical) || canonical == Guid.Empty
                    || identities.TryGetValue(name, out var prior) && prior != canonical.ToString("N"))
                { Retain(change, old, "conflict", [new("source-identity", "定義 metadata 的身分無效或互相矛盾。", new(0, 0))]); break; }
                identities[name] = canonical.ToString("N");
            }
            if(!notes[change.NoteId].IsSourceStale)
                foreach(var rename in localRenames) renames[rename.Key] = rename.Value;
        }

        // Shared intents from the same scan must agree before any source literal
        // is rewritten. Current cache text is never the comparison baseline.
        var sharedConflict = false;
        string? sharedFailureReason = null;
        var sharedTargets = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach(var (name, intents) in proposals)
        {
            var definition = basis.Definitions.Values.FirstOrDefault(d => d.Name == name);
            var owner = definition is null ? null : basis.Notes[definition.NoteId];
            if(owner is not null) guards.TryAdd(owner.Id, GetDraft(owner.Id));
            var conflict = definition is null || !SharedWritable(basis,definition) || owner!.IsSourceStale || guards[owner.Id] is not null
                || changes.Any(c => c.NoteId == owner!.Id && c.Source != owner.CurrentSource)
                || intents.Any(i => notes[i.NoteId].IsSourceStale)
                || intents.Select(i => i.Proposal.ProposedValue).Distinct(StringComparer.Ordinal).Count() != 1
                || intents.Any(i => i.Proposal.ChangedOccurrences.Any(o => o.AcceptedCachedValue != definition!.Value));
            if(!conflict)
            {
                // Validate the actual source codec/identity change before accepting
                // any shared intent. A refusal retains the observed raw reference.
                try { _ = ReplaceSharedSource(owner!,definition!,intents[0].Proposal.ProposedValue,basis.Languages); }
                catch(InvalidOperationException sharedError) { conflict=true; sharedFailureReason=sharedError.Message; }
            }
            sharedConflict |= conflict;
            if(!conflict) sharedTargets[name] = owner!.Id;
        }
        if(sharedConflict)
        {
            // The observed batch is one shared intent group. Validate every
            // target before changing any owner; otherwise carrier order would
            // decide whether a conflicting note silently updates half its values.
            foreach(var id in proposals.Values.SelectMany(p => p).Select(p => p.NoteId).Distinct(StringComparer.Ordinal))
            {
                var change = changes.Single(c => c.NoteId == id);
                Retain(change, basis.Notes[id], "conflict", [new("shared-source-conflict", "共享修改的來源、版本或其他提案不一致，已保留外部原文；本批共享意圖未部分套用。" + sharedFailureReason, new(0, 0))]);
            }
        }
        else foreach(var (name, intents) in proposals)
        {
            var target = notes[sharedTargets[name]];
            var definition=basis.Definitions.Values.Single(d=>d.Name==name);
            var source = ReplaceSharedSource(target,definition,intents[0].Proposal.ProposedValue,basis.Languages);
            notes[target.Id] = target with { Source = source, Syntax = RecordNoteSyntax.Parse(source, target.Records, basis.Languages), SavedSource = null };
        }

        // Isolate name collisions to their new/edited owners. An invalid note
        // retains its reserved old names, so a rollback can reveal another
        // collision; repeat only while an accepted candidate was removed.
        var observedById = changes.ToDictionary(c => c.NoteId, StringComparer.Ordinal);
        bool isolated;
        do
        {
            isolated = false;
            var collisions = notes.Values.SelectMany(n => n.Syntax.Definitions.Select(d => (Note: n, Definition: d)))
                .GroupBy(p => p.Definition.Name, StringComparer.Ordinal).Where(g => g.Count() > 1).ToArray();
            foreach(var collision in collisions)
            {
                var reservedOwner = basis.Definitions.Values.FirstOrDefault(d => d.Name == collision.Key)?.NoteId;
                foreach(var member in collision)
                {
                    if(member.Note.Id == reservedOwner || notes[member.Note.Id].IsSourceStale || !observedById.TryGetValue(member.Note.Id, out var change)) continue;
                    var old = basis.Notes.GetValueOrDefault(member.Note.Id) ?? new Note(change.NoteId, change.Title, "", 0, GraspParser.Parse("", basis.Languages), []);
                    Retain(change, old, "invalid", [new("duplicate-source-name", $"{collision.Key} 與既有定義重名，保留來源等待核對。", new(0, 0))]);
                    isolated = true;
                }
            }
        } while(isolated);

        // A previously valid candidate may have become conflicting when shared
        // intents were checked. Only accepted source can authorize a rename.
        renames.Clear();
        foreach(var change in changes.Where(c => !notes[c.NoteId].IsSourceStale))
            if(basis.Notes.TryGetValue(change.NoteId, out var prior))
                foreach(var rename in DetectRenames(prior.Syntax, notes[change.NoteId].Syntax) ?? []) renames[rename.Key] = rename.Value;
        var acceptedNames = notes.Values.Where(n => !n.IsSourceStale).SelectMany(n => n.Syntax.Definitions).Select(d => d.Name).ToHashSet(StringComparer.Ordinal);
        foreach(var name in identities.Keys.Where(name => !acceptedNames.Contains(name)).ToArray()) identities.Remove(name);

        foreach(var note in notes.Values.ToArray())
        {
            if(note.IsSourceStale || renames.Count == 0) continue;
            var patches = note.Syntax.References.Where(r => renames.ContainsKey(r.Name)).Select(r => new SourcePatch(r.NameSpan, renames[r.Name]))
                .Concat(note.Syntax.Definitions.SelectMany(d => d.Parts).Where(p => p.Kind == PartKind.Identifier && renames.ContainsKey(p.Text)).Select(p => new SourcePatch(p.Span, renames[p.Text]))).ToArray();
            if(patches.Length == 0) continue;
            guards.TryAdd(note.Id, GetDraft(note.Id));
            var source = RecordNoteSyntax.ApplyPatches(note.Source, note.Records, patches);
            notes[note.Id] = note with { Source = source, Syntax = RecordNoteSyntax.Parse(source, note.Records, basis.Languages) };
        }
        var prepared = await PrepareAsync(basis, notes, basis.Languages, basis.PolicyRevision, renames, token, identities);
        if(prepared.Error is { } error)
        {
            // An invalid semantic batch must not erase the bytes just observed.
            // Revert only accepted projections, retain every raw changed source.
            notes = retainedAfterDeletions.ToDictionary(p => p.Key, p => p.Value);
            foreach(var change in changes)
            {
                var old = basis.Notes.GetValueOrDefault(change.NoteId) ?? new Note(change.NoteId, change.Title, "", 0, GraspParser.Parse("", basis.Languages), []);
                Retain(change, old, "invalid", [new("source-semantic", error, new(0, 0))]);
            }
            prepared = await PrepareAsync(basis, notes, basis.Languages, basis.PolicyRevision, null, token);
        }
        if(prepared.Error is { } retainedError) return Reject(operationId, hash, "invalid", retainedError);
        return await PublishAsync(basis, prepared.State!, operationId, hash, changes.Count == 1 ? changes[0].NoteId : null,
            null, token, draftGuards: guards, successStatus: "source-observed");

        void Retain(ExternalNoteChange change, Note prior, string status, ParseDiagnostic[] diagnostics)
        { notes[change.NoteId] = prior with { Title = NormalizeTitle(change.Title), SavedSource = new(change.Source, status, diagnostics, change.Records) }; }
    }
}
