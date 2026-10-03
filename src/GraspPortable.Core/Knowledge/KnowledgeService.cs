using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Knowledge;

/// <summary>Owns committed identity and consistency. Prepare runs outside the single writer.</summary>
public sealed class KnowledgeService(IWorkspaceRepository repository) : IDisposable
{
    private Snapshot state = repository.Load();
    private readonly ConcurrentDictionary<string, Draft> drafts = new(repository.LoadDrafts().Select(d => new KeyValuePair<string, Draft>(d.NoteId, d)));
    private readonly SemaphoreSlim writer = new(1);
    private readonly SemaphoreSlim workers = new(2);
    public Snapshot Current => Volatile.Read(ref state);
    public event Action<ChangeNotice>? Changed;
    public Draft? GetDraft(string noteId) => drafts.GetValueOrDefault(noteId);
    public Receipt? GetReceipt(string id) => repository.FindReceipt(id);
    public async Task DrainAsync() { await writer.WaitAsync(); writer.Release(); }

    private static string Fingerprint(object value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));
    private Receipt? Retry(string id, string fingerprint)
    {
        var found = repository.FindReceipt(id);
        return found is null ? null : found.Fingerprint == fingerprint ? found
            : new(id, fingerprint, "rejected", Current.Revision, Message: "Operation ID 已被不同內容使用。");
    }
    private Receipt Reject(string id, string hash, string status, string message, string? noteId = null, ParseDiagnostic[]? diagnostics = null)
        => new(id, hash, status, Current.Revision, noteId, message, diagnostics);

    public async Task<Receipt> SaveDraftAsync(Draft draft)
    {
        await writer.WaitAsync();
        try
        {
            if (!Current.Notes.ContainsKey(draft.NoteId)) return Reject("", "", "rejected", "找不到筆記。", draft.NoteId);
            if (drafts.TryGetValue(draft.NoteId, out var old))
            {
                if (old.SessionId != draft.SessionId) return Reject("", "", "conflict", "已有可恢復草稿，請先重新讀取。", draft.NoteId);
                if (old.Revision > draft.Revision) return Reject("", "", "conflict", "過期草稿未套用。", draft.NoteId);
                if (old.Revision == draft.Revision && old != draft) return Reject("", "", "conflict", "相同草稿版本包含不同內容。", draft.NoteId);
            }
            repository.SaveDraft(draft);
            drafts[draft.NoteId] = draft;
            return new("", "", "draft", Current.Revision, draft.NoteId, "草稿已儲存。");
        }
        finally { writer.Release(); }
    }

    public async Task<Receipt> CreateNoteAsync(string operationId, string title, string source, CancellationToken token = default)
    {
        var hash = Fingerprint(new { kind = "create", title, source });
        if (Retry(operationId, hash) is { } retry) return retry;
        var basis = Current;
        var id = Guid.NewGuid().ToString("N");
        var syntax = GraspParser.Parse(source, basis.Languages);
        if (!syntax.IsValid) return Reject(operationId, hash, "invalid", "請先建立空白筆記，再以草稿編輯未完成語法。", diagnostics: syntax.Diagnostics.ToArray());
        var notes = basis.Notes.ToDictionary(p => p.Key, p => p.Value);
        notes[id] = new(id, NormalizeTitle(title), source, 0, syntax, []);
        var prepared = await PrepareAsync(basis, notes, basis.Languages, basis.PolicyRevision, null, token);
        if (prepared.Error is { } error) return Reject(operationId, hash, "invalid", error);
        return await PublishAsync(basis, prepared.State!, operationId, hash, id, null, token);
    }

    public async Task<Receipt> CommitNoteAsync(CommitIntent intent, CancellationToken token = default)
    {
        // Confirmation changes authorization, not the payload identity of an already prepared intent.
        var hash = Fingerprint(intent with { ConfirmRename = false });
        if (Retry(intent.OperationId, hash) is { } retry) return retry;
        var basis = Current;
        if (!basis.Notes.TryGetValue(intent.NoteId, out var old) || !drafts.TryGetValue(intent.NoteId, out var draft))
            return Reject(intent.OperationId, hash, "rejected", "找不到筆記或草稿。", intent.NoteId);
        if (draft.SessionId != intent.SessionId || draft.Revision != intent.DraftRevision || draft.BaseNoteRevision != old.Revision
            || old.Revision != intent.ExpectedNoteRevision || basis.Revision != intent.ExpectedKnowledgeRevision)
            return Reject(intent.OperationId, hash, "conflict", "基底已更新；草稿保留，請重新讀取後核對。", intent.NoteId);
        var syntax = GraspParser.Parse(draft.Source, basis.Languages);
        if (!syntax.IsValid) return Reject(intent.OperationId, hash, "invalid", "草稿已存；語法尚未完成，未更新共享值。", intent.NoteId, syntax.Diagnostics.ToArray());
        var renames = DetectRenames(old.Syntax, syntax);
        if (renames is null) return Reject(intent.OperationId, hash, "invalid", "無法唯一識別此次改名，請分次改名並保持 expression 不變。", intent.NoteId);
        var notes = basis.Notes.ToDictionary(p => p.Key, p => p.Value);
        notes[intent.NoteId] = old with { Title = NormalizeTitle(draft.Title), Source = draft.Source, Syntax = syntax };
        if (renames.Count > 0)
        {
            var existingNames = basis.Definitions.Values.Where(d => d.NoteId != intent.NoteId).Select(d => d.Name).ToHashSet(StringComparer.Ordinal);
            if (renames.Values.Any(existingNames.Contains)) return Reject(intent.OperationId, hash, "invalid", "改名會造成同 namespace 重名；未套用。", intent.NoteId);
            var affected = notes.Values.Where(n => n.Syntax.References.Any(r => renames.ContainsKey(r.Name)) || n.Syntax.Definitions.Any(d => d.Parts.Any(p => p.Kind == PartKind.Identifier && renames.ContainsKey(p.Text)))).Select(n => n.Id).Append(intent.NoteId).Distinct().ToArray();
            if (!intent.ConfirmRename) return new(intent.OperationId, hash, "confirmation-required", basis.Revision, intent.NoteId, "改名將保留 ID，並更新相依與引用。", AffectedNoteIds: affected);
            foreach (var n in notes.Values.ToArray())
            {
                var patches = n.Syntax.References.Where(r => renames.ContainsKey(r.Name)).Select(r => new SourcePatch(r.NameSpan, renames[r.Name]))
                    .Concat(n.Syntax.Definitions.SelectMany(d => d.Parts).Where(p => p.Kind == PartKind.Identifier && renames.ContainsKey(p.Text)).Select(p => new SourcePatch(p.Span, renames[p.Text]))).ToArray();
                if (patches.Length == 0) continue;
                var source = ReferenceCodec.ApplyPatches(n.Source, patches);
                notes[n.Id] = n with { Source = source, Syntax = GraspParser.Parse(source, basis.Languages) };
            }
        }
        var prepared = await PrepareAsync(basis, notes, basis.Languages, basis.PolicyRevision, renames, token);
        if (prepared.Error is { } error) return Reject(intent.OperationId, hash, "invalid", error, intent.NoteId);
        return await PublishAsync(basis, prepared.State!, intent.OperationId, hash, intent.NoteId, draft, token);
    }

    private static Dictionary<string, string>? DetectRenames(ParseResult before, ParseResult after)
    {
        var removed = before.Definitions.Where(d => !after.Definitions.Any(n => n.Name == d.Name)).ToArray();
        var added = after.Definitions.Where(d => !before.Definitions.Any(n => n.Name == d.Name)).ToArray();
        if (removed.Length == 0 || added.Length == 0) return new(StringComparer.Ordinal);
        if (removed.Length != 1 || added.Length != 1 || before.Definitions.Count != after.Definitions.Count) return null;
        var a = removed[0]; var b = added[0];
        if (!a.Parts.Select(p => (p.Kind, p.Text)).SequenceEqual(b.Parts.Select(p => (p.Kind, p.Text)))) return null;
        return new(StringComparer.Ordinal) { [a.Name] = b.Name };
    }

    public Impact LiteralImpact(string id)
    {
        var basis = Current;
        if (!basis.Definitions.TryGetValue(id, out var definition)) throw new KeyNotFoundException("找不到定義。");
        var names = new HashSet<string>(StringComparer.Ordinal) { definition.Name };
        var dependents = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var d in basis.Notes.Values.SelectMany(n => n.Syntax.Definitions))
            foreach (var p in d.Parts.Where(p => p.Kind == PartKind.Identifier))
            { if (!dependents.TryGetValue(p.Text, out var list)) dependents[p.Text] = list = []; list.Add(d.Name); }
        var queue = new Queue<string>(names);
        while (queue.TryDequeue(out var name)) if (dependents.TryGetValue(name, out var list)) foreach (var dependent in list) if (names.Add(dependent)) queue.Enqueue(dependent);
        var noteIds = basis.Notes.Values.Where(n => n.Syntax.Definitions.Any(d => names.Contains(d.Name)) || n.Syntax.References.Any(r => names.Contains(r.Name))).Select(n => n.Id).ToArray();
        return new(basis.Revision, noteIds, names.Count, basis.Notes.Values.Sum(n => n.Syntax.References.Count(r => names.Contains(r.Name))), drafts.ContainsKey(definition.NoteId));
    }

    public async Task<Receipt> ChangeLiteralAsync(string operationId, string id, long expectedRevision, string value, CancellationToken token = default)
    {
        var hash = Fingerprint(new { kind = "literal", id, expectedRevision, value });
        if (Retry(operationId, hash) is { } retry) return retry;
        var basis = Current;
        if (basis.Revision != expectedRevision) return Reject(operationId, hash, "conflict", "影響範圍已更新，請重新檢視。 ");
        if (!basis.Definitions.TryGetValue(id, out var definition)) return Reject(operationId, hash, "rejected", "定義不存在。");
        if (!definition.IsLiteral) return Reject(operationId, hash, "rejected", "Composition 請前往來源編輯，不可攤平。", definition.NoteId);
        if (drafts.ContainsKey(definition.NoteId)) return Reject(operationId, hash, "conflict", "來源已有草稿，請前往來源編輯。", definition.NoteId);
        var note = basis.Notes[definition.NoteId];
        var syntax = note.Syntax.Definitions.Single(d => d.Name == definition.Name);
        var source = ReferenceCodec.ApplyPatches(note.Source, [new(syntax.ExpressionSpan, LiteralCodec.Serialize(value))]);
        var notes = basis.Notes.ToDictionary(p => p.Key, p => p.Value);
        notes[note.Id] = note with { Source = source, Syntax = GraspParser.Parse(source, basis.Languages) };
        var prepared = await PrepareAsync(basis, notes, basis.Languages, basis.PolicyRevision, null, token);
        if (prepared.Error is { } error) return Reject(operationId, hash, "invalid", error, note.Id);
        return await PublishAsync(basis, prepared.State!, operationId, hash, note.Id, null, token, rejectDirtyNote: note.Id);
    }

    public Impact PolicyImpact(string[] languages)
    {
        var basis = Current;
        var policy = NormalizeLanguages(languages);
        var changed = basis.Notes.Values.Where(n => !SameSyntax(n.Syntax, GraspParser.Parse(n.Source, policy))).ToArray();
        return new(basis.Revision, changed.Select(n => n.Id).ToArray(), changed.Sum(n => n.Syntax.Definitions.Count), changed.Sum(n => n.Syntax.References.Count), changed.Any(n => drafts.ContainsKey(n.Id)), "設定會改變定義及引用的辨識範圍，將一起重新解析並提交。");
    }
    public async Task<Receipt> ChangePolicyAsync(string operationId, long expectedRevision, string[] languages, CancellationToken token = default)
    {
        var policy = NormalizeLanguages(languages);
        var hash = Fingerprint(new { kind = "policy", expectedRevision, policy });
        if (Retry(operationId, hash) is { } retry) return retry;
        var basis = Current;
        if (basis.Revision != expectedRevision) return Reject(operationId, hash, "conflict", "設定基底已更新，請重新檢視影響。");
        var notes = basis.Notes.ToDictionary(p => p.Key, p => p.Value with { Syntax = GraspParser.Parse(p.Value.Source, policy) });
        var prepared = await PrepareAsync(basis, notes, policy, basis.PolicyRevision + 1, null, token);
        if (prepared.Error is { } error) return Reject(operationId, hash, "invalid", error);
        return await PublishAsync(basis, prepared.State!, operationId, hash, null, null, token);
    }
    private static string[] NormalizeLanguages(string[] languages) => languages.Select(x => x.Trim().ToLowerInvariant()).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
    private static bool SameSyntax(ParseResult a, ParseResult b) => a.IsValid == b.IsValid && a.Definitions.Select(d => d.Name).SequenceEqual(b.Definitions.Select(d => d.Name)) && a.References.Select(r => (r.Name, r.Span)).SequenceEqual(b.References.Select(r => (r.Name, r.Span)));
    private static string NormalizeTitle(string title) => string.IsNullOrWhiteSpace(title) ? "未命名筆記" : title.Trim();

    private async Task<(Snapshot? State, string? Error)> PrepareAsync(Snapshot basis, Dictionary<string, Note> notes, string[] languages, long policyRevision, Dictionary<string, string>? renames, CancellationToken token)
    {
        await workers.WaitAsync(token);
        try { return await Task.Run(() => Prepare(basis, notes, languages, policyRevision, renames, token), token); }
        finally { workers.Release(); }
    }
    private static (Snapshot? State, string? Error) Prepare(Snapshot basis, Dictionary<string, Note> notes, string[] languages, long policyRevision, Dictionary<string, string>? renames, CancellationToken token)
    {
        if (notes.Values.Any(n => !n.Syntax.IsValid)) return (null, "解析未完成，保留原設定與原 committed state。");
        var definitions = notes.Values.SelectMany(n => n.Syntax.Definitions).ToArray();
        if (definitions.GroupBy(d => d.Name, StringComparer.Ordinal).Any(g => g.Count() > 1)) return (null, "同一 workspace／namespace 的 identifier 不可重複。 ");
        var affected = AffectedNames(basis, definitions);
        var previousValues = basis.Definitions.Values.ToDictionary(d => d.Name,
            d => new EvaluatedValue(d.Value, Enum.Parse<EvaluationStatus>(d.Status)), StringComparer.Ordinal);
        var evaluated = DependencyEvaluator.Evaluate(definitions, token, previousValues: previousValues, affectedNames: affected);
        if (evaluated.Values.Values.Any(v => v.Status == EvaluationStatus.ResourceLimit))
            return (null, "展開值超過目前資源上限；草稿保留，未提交共享變更。");
        var revision = basis.Revision + 1;
        var oldByName = basis.Definitions.Values.ToDictionary(d => d.Name, StringComparer.Ordinal);
        if (renames is not null) foreach (var pair in renames) if (oldByName.Remove(pair.Key, out var old)) oldByName[pair.Value] = old;
        var nextDefinitions = new Dictionary<string, KnowledgeDefinition>();
        foreach (var entry in notes.Values.ToArray())
        {
            token.ThrowIfCancellationRequested();
            var patches = entry.Syntax.References.Where(r => evaluated.Values.TryGetValue(r.Name, out var value) && value.Status == EvaluationStatus.Valid && value.Value != r.CachedValue)
                .Select(r => new SourcePatch(r.ValueSpan, ReferenceCodec.Encode(evaluated.Values[r.Name].Value!))).ToArray();
            var source = patches.Length == 0 ? entry.Source : ReferenceCodec.ApplyPatches(entry.Source, patches);
            var parsed = source == entry.Source ? entry.Syntax : GraspParser.Parse(source, languages);
            if (!parsed.IsValid) return (null, "內部 codec 產生無效語法；提交已中止。 ");
            var diagnostics = new List<ParseDiagnostic>();
            foreach (var d in parsed.Definitions)
            {
                var result = evaluated.Values[d.Name];
                oldByName.TryGetValue(d.Name, out var old);
                var id = old?.Id ?? Guid.NewGuid().ToString("N");
                nextDefinitions[id] = new(id, entry.Id, d.Name, result.Value, result.Status.ToString(), d.Parts.Count == 1 && d.Parts[0].Kind == PartKind.Literal,
                    d.Span, d.NameSpan, result.Status == EvaluationStatus.Valid ? result.Value : old?.LastGoodValue,
                    result.Status == EvaluationStatus.Valid ? old is not null && old.Status == "Valid" && old.Value == result.Value ? old.LastGoodRevision : revision : old?.LastGoodRevision);
                if (result.Status != EvaluationStatus.Valid) diagnostics.Add(new(result.Status.ToString(), $"{d.Name}：{result.Status}；尚未產生新的有效值。", d.NameSpan));
            }
            foreach (var reference in parsed.References)
                if (!evaluated.Values.TryGetValue(reference.Name, out var value) || value.Status != EvaluationStatus.Valid)
                    diagnostics.Add(new(value?.Status.ToString() ?? "Missing", $"{reference.Name}：目前無有效值，引用保留先前文字。", reference.NameSpan));
            var changed = !basis.Notes.TryGetValue(entry.Id, out var prior) || prior.Source != source || prior.Title != entry.Title || !prior.Diagnostics.SequenceEqual(diagnostics);
            notes[entry.Id] = entry with { Source = source, Syntax = parsed, Diagnostics = diagnostics.ToArray(), Revision = changed ? revision : prior!.Revision };
        }
        return (new(basis.WorkspaceId, revision, policyRevision, languages, notes, nextDefinitions), null);
    }

    private static HashSet<string> AffectedNames(Snapshot basis, Definition[] definitions)
    {
        var previous = basis.Notes.Values.SelectMany(n => n.Syntax.Definitions).ToDictionary(d => d.Name, StringComparer.Ordinal);
        var current = definitions.ToDictionary(d => d.Name, StringComparer.Ordinal);
        var affected = new HashSet<string>(previous.Keys.Where(name => !current.ContainsKey(name)), StringComparer.Ordinal);
        var reverse = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var definition in definitions)
        {
            if (!previous.TryGetValue(definition.Name, out var old) || !old.Parts.Select(p => (p.Kind, p.Text)).SequenceEqual(definition.Parts.Select(p => (p.Kind, p.Text))))
                affected.Add(definition.Name);
            foreach (var part in definition.Parts.Where(p => p.Kind == PartKind.Identifier))
            {
                if (!reverse.TryGetValue(part.Text, out var dependents)) reverse[part.Text] = dependents = [];
                dependents.Add(definition.Name);
            }
        }
        var pending = new Queue<string>(affected);
        while (pending.TryDequeue(out var name))
            if (reverse.TryGetValue(name, out var dependents)) foreach (var dependent in dependents) if (affected.Add(dependent)) pending.Enqueue(dependent);
        return affected;
    }

    private async Task<Receipt> PublishAsync(Snapshot basis, Snapshot next, string operationId, string hash, string? noteId, Draft? consumedDraft, CancellationToken token, string? rejectDirtyNote = null)
    {
        await writer.WaitAsync(token);
        Receipt receipt;
        try
        {
            if (Retry(operationId, hash) is { } retry) return retry;
            if (Current.Revision != basis.Revision) return Reject(operationId, hash, "conflict", "其他變更已提交；此草稿保留，請重試。", noteId);
            if (consumedDraft is not null && (!drafts.TryGetValue(consumedDraft.NoteId, out var latest) || latest != consumedDraft))
                return Reject(operationId, hash, "conflict", "較新草稿已抵達；未提交舊結果。", noteId);
            if (rejectDirtyNote is not null && drafts.ContainsKey(rejectDirtyNote)) return Reject(operationId, hash, "conflict", "來源已有草稿，請前往來源。", noteId);
            token.ThrowIfCancellationRequested();
            var affected = next.Notes.Values.Where(n => !basis.Notes.TryGetValue(n.Id, out var old) || n.Revision != old.Revision).Select(n => n.Id).ToArray();
            receipt = new(operationId, hash, "committed", next.Revision, noteId, "已儲存並更新共享值。", AffectedNoteIds: affected);
            // No cancellation once the transaction begins. Receipt and all caches are durable together.
            repository.Commit(basis, next, receipt, consumedDraft?.NoteId);
            Volatile.Write(ref state, next);
            if (consumedDraft is not null) drafts.TryRemove(consumedDraft.NoteId, out _);
        }
        finally { writer.Release(); }
        Changed?.Invoke(new(next.Revision, receipt.AffectedNoteIds ?? [], next.PolicyRevision));
        return receipt;
    }
    public void Dispose() { repository.Dispose(); writer.Dispose(); workers.Dispose(); }
}
