using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Knowledge;

/// <summary>Host-resolved carrier presentation updates sharing the main document transaction.</summary>
public sealed record RecordDocumentSourceUpdate(string NoteId, string ExpectedSourceHash, string Source);

public sealed partial class KnowledgeService
{
    /// <summary>
    /// Atomic semantic command for a complete record document. The trusted Host may supply the
    /// SHA256 identity of its immutable high-level request before resolving source/IDs. That identity
    /// must include command kind and all target IDs and must never be supplied directly by UI clients.
    /// Repository metadata leases are consumed only by the corresponding successful commit.
    /// </summary>
    public async Task<Receipt> ChangeRecordDocumentAsync(string operationId, string noteId, long expectedRevision,
        string title, string source, RecordsDocumentDescriptor descriptor, bool confirmRename = false,
        CancellationToken token = default, bool create = false, string? requestFingerprint = null,
        IReadOnlyList<RecordDocumentSourceUpdate>? sourceUpdates = null)
    {
        var hash = requestFingerprint ?? (sourceUpdates is null
            ? Fingerprint(new { kind = "record-document", noteId, expectedRevision, title, source, descriptor, create })
            : Fingerprint(new { kind = "record-document", noteId, expectedRevision, title, source, descriptor, create, sourceUpdates }));
        if (Retry(operationId, hash) is { } retry) return retry;
        var basis = Current;
        if (basis.Revision != expectedRevision) return Reject(operationId, hash, "conflict", "資料表基底已更新，請重新讀取。", noteId);
        basis.Notes.TryGetValue(noteId, out var old);
        if (!Guid.TryParseExact(noteId, "N", out var id) || id == Guid.Empty || create == (old is not null))
            return Reject(operationId, hash, "rejected", "建立／編輯的筆記身分不符合目前狀態。", noteId);
        if (old?.IsSourceStale == true || GetDraft(noteId) is not null)
            return Reject(operationId, hash, "conflict", "資料表來源有草稿或未接受內容，請先處理來源。", noteId);
        var syntax = RecordNoteSyntax.Parse(source, descriptor, basis.Languages, token);
        if (!syntax.IsValid) return Reject(operationId, hash, "invalid", "資料表正文或 schema 無法安全解析，未寫入。", noteId, syntax.Diagnostics.ToArray());
        var renames = old is null ? new Dictionary<string, string>(StringComparer.Ordinal) : DetectRenames(old.Syntax, syntax);
        if (renames is null) return Reject(operationId, hash, "invalid", "手寫定義改名不明，請分次修改。", noteId);
        var notes = basis.Notes.ToDictionary(p => p.Key, p => p.Value);
        notes[noteId] = new(noteId, NormalizeTitle(title), source, old?.Revision ?? 0, syntax, [], Records: descriptor);
        var sourceGuards = new Dictionary<string, string>(StringComparer.Ordinal);
        var draftGuards = new Dictionary<string, Draft?>(StringComparer.Ordinal) { [noteId] = null };
        if(old is not null) sourceGuards[noteId] = old.CurrentSourceHash;
        foreach(var update in sourceUpdates ?? [])
        {
            if(update.NoteId == noteId || sourceGuards.ContainsKey(update.NoteId)
                || !basis.Notes.TryGetValue(update.NoteId,out var related))
                return Reject(operationId,hash,"invalid","附帶來源必須是唯一且存在的其他筆記。",noteId);
            if(related.CurrentSourceHash != update.ExpectedSourceHash || related.IsSourceStale || GetDraft(related.Id) is not null)
                return Reject(operationId,hash,"conflict","關聯／選項來源有較新版本、草稿或未接受原文，整批未寫入。",related.Id);
            var nextSyntax = RecordNoteSyntax.Parse(update.Source,related.Records,basis.Languages,token);
            if(!nextSyntax.IsValid) return Reject(operationId,hash,"invalid","附帶來源改写產生無效語法，整批未寫入。",related.Id,nextSyntax.Diagnostics.ToArray());
            // Side updates are carrier label/path maintenance, never a second rename command.
            if(!related.Syntax.Definitions.Select(d => (d.Name,d.FieldOrigin)).OrderBy(d=>d.Name,StringComparer.Ordinal)
                .SequenceEqual(nextSyntax.Definitions.Select(d => (d.Name,d.FieldOrigin)).OrderBy(d=>d.Name,StringComparer.Ordinal)))
                return Reject(operationId,hash,"invalid","附帶來源不可新增、移除或改名定義，請使用來源編輯流程。",related.Id);
            notes[related.Id] = related with { Source=update.Source,Syntax=nextSyntax,SavedSource=null };
            sourceGuards[related.Id] = update.ExpectedSourceHash;
            draftGuards[related.Id] = null;
        }
        if (renames.Count > 0)
        {
            var existingNames = basis.Definitions.Values.Where(d => d.NoteId != noteId).Select(d => d.Name).ToHashSet(StringComparer.Ordinal);
            if (renames.Values.Any(existingNames.Contains)) return Reject(operationId, hash, "invalid", "改名會造成重名；未寫入。", noteId);
            var affected = notes.Values.Where(n => n.Syntax.References.Any(r => renames.ContainsKey(r.Name))
                || n.Syntax.Definitions.Any(d => d.Parts.Any(p => p.Kind == PartKind.Identifier && renames.ContainsKey(p.Text))))
                .Select(n => n.Id).Append(noteId).Distinct().ToArray();
            if (!confirmRename) return new(operationId, hash, "confirmation-required", basis.Revision, noteId,
                "改名會保留身分並更新相依及引用。", AffectedNoteIds: affected);
            RewriteRenames(notes, renames, basis.Languages, token);
        }
        var prepared = await PrepareAsync(basis, notes, basis.Languages, basis.PolicyRevision, renames, token);
        if (prepared.Error is { } error) return Reject(operationId, hash, "invalid", error, noteId);
        // A view-only metadata transaction must still invalidate this note's UI/base revision.
        var next = prepared.State!;
        var changed = next.Notes.ToDictionary(p => p.Key, p => p.Value);
        changed[noteId] = changed[noteId] with { Revision = next.Revision };
        return await PublishAsync(basis, next with { Notes = changed }, operationId, hash, noteId, null, token,
            rejectDirtyNote: noteId, draftGuards: draftGuards, sourceHashGuards: sourceGuards);
    }
}
