using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Knowledge;

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
        CancellationToken token = default, bool create = false, string? requestFingerprint = null)
    {
        var hash = requestFingerprint ?? Fingerprint(new { kind = "record-document", noteId, expectedRevision, title, source, descriptor, create });
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
        return await PublishAsync(basis, next with { Notes = changed }, operationId, hash, noteId, null, token, rejectDirtyNote: noteId);
    }
}
