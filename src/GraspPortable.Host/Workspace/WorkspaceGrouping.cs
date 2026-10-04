using System.Text;
using System.Text.Json;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace.FileOperations;
using GraspPortable.Host.Workspace.Markdown;

namespace GraspPortable.Host.Workspace;

/// <summary>Runs in the coordinator lane. A durable file receipt precedes reconciliation;
/// interrupted multi-file writes must recover before ordinary external observation.</summary>
public sealed class WorkspaceGrouping
{
    private const string Store = ".grasp/grouping";
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase) { ".grasp", ".git", ".obsidian", "artifacts" };
    private readonly WorkspaceFilePaths paths;
    private readonly MarkdownWorkspaceRepository repository;
    private readonly KnowledgeService knowledge;
    private readonly RecoverableFileOperations files;
    public Action<string>? CheckpointForTest { get; set; }
    public Action<FileOperationCheckpoint>? FileCheckpointForTest { get; set; }
    public WorkspaceGrouping(string root, MarkdownWorkspaceRepository repository, KnowledgeService knowledge)
    { paths = new(root); this.repository = repository; this.knowledge = knowledge; files = new(root); }
    public bool HasPendingOperations => IntentPaths().Any(p => !File.Exists(paths.Resolve(ReceiptPath(Path.GetFileNameWithoutExtension(p)))));

    public GroupingPreview Preview(GroupingPreviewRequest request)
    {
        var id = Guid.NewGuid().ToString("N"); var basis = knowledge.Current;
        try
        {
            if (HasPendingOperations || repository.IsWriteBlocked) throw new IOException("尚有待恢復操作，請先完成恢復。");
            if (request.Action is not ("merge" or "split")) throw new ArgumentException("僅支援 merge／split。");
            var sources = request.SourcePaths.Select(UserPath).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            if (request.Action == "merge" ? sources.Length < 2 : sources.Length != 1) throw new ArgumentException("合併至少兩個檔案；拆分需一個群組檔案。");
            var registry = repository.LoadSourceFiles().Where(f => f.Exists).ToArray();
            var inventory = Inventory();
            var registered = registry.ToDictionary(f => f.RelativePath, StringComparer.OrdinalIgnoreCase);
            foreach (var path in inventory.Where(IsMarkdown))
                if (!registered.ContainsKey(path)) throw new IOException("Markdown 尚未成功觀測，請先處理：" + path);
            var guards = registry.Select(f => new Guard(f.RelativePath, f.ByteHash)).ToArray();
            foreach (var guard in guards) RequireHash(guard.Path, guard.Hash);
            var selected = sources.Select(p => registered.GetValueOrDefault(p) ?? throw new IOException("來源不是已觀測的筆記：" + p)).ToArray();
            if (request.Action == "split" && !selected[0].IsGrouped) throw new IOException("此檔案不是可拆分的群組。");
            var members = ReadMembers(registry);
            var movedIds = selected.SelectMany(f => f.NoteIds).ToHashSet(StringComparer.Ordinal);
            if (members.Any(m => movedIds.Contains(m.Id) && m.File.IsGrouped && m.Anchor is null))
                throw new IOException("群組 member 缺少可靠 presentation anchor，請先修復 metadata 與標題再操作。");
            CheckNotes(movedIds);
            var destinations = new Dictionary<string, string>(StringComparer.Ordinal);
            if (request.Action == "merge")
            {
                var target = MarkdownPath(request.DestinationPath ?? ""); EnsureNew(target);
                foreach (var noteId in movedIds) destinations.Add(noteId, target);
            }
            else
            {
                foreach (var target in request.SplitTargets ?? [])
                {
                    if (!movedIds.Contains(target.NoteId) || !destinations.TryAdd(target.NoteId, MarkdownPath(target.RelativePath)))
                        throw new ArgumentException("拆分目的地必須恰好包含每個 member 一次。");
                }
                if (destinations.Count != movedIds.Count || destinations.Values.Distinct(StringComparer.OrdinalIgnoreCase).Count() != movedIds.Count)
                    throw new ArgumentException("拆分目的地缺失或重複。");
                foreach (var target in destinations.Values) EnsureNew(target);
            }
            var anchors = new Dictionary<string, string?>(StringComparer.Ordinal);
            var usedAnchors = members.Where(m => movedIds.Contains(m.Id)).SelectMany(m => GroupingLinks.FindHeadingAnchors(m.Body, basis.Languages)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var member in members)
            {
                string? anchor = member.Anchor;
                if (movedIds.Contains(member.Id))
                {
                    anchor = request.Action == "split" ? null : FriendlyAnchor(member.Title);
                    if (anchor is not null && !usedAnchors.Add(anchor))
                    {
                        anchor += " - " + member.Id[..8];
                        if (!usedAnchors.Add(anchor)) throw new IOException("無法建立唯一群組標題，請調整筆記標題。");
                    }
                }
                anchors[member.Id] = anchor;
            }
            var linkNotes = members.Select(m => new GroupingLinkNote(m.Id, m.File.RelativePath,
                destinations.GetValueOrDefault(m.Id) ?? m.File.RelativePath, m.Body, m.Start, m.Anchor, anchors[m.Id])).ToArray();
            var links = GroupingLinks.Plan(linkNotes, registry.Select(f => new GroupingLinkFile(f.RelativePath, f.Text)).ToArray(), inventory, basis.Languages);
            if (!links.CanApply) throw new IOException(string.Join("；", links.Issues.Select(i => i.SourcePath + ": " + i.Message)));
            var affected = movedIds.Concat(links.Patches.Select(p => p.OriginNoteId).OfType<string>()).Distinct().ToArray();
            CheckNotes(affected);
            var warnings = new List<string>(); var changes = new List<FileActionChange>(); var mutations = new List<FileMutation>();
            var preservation = new List<GroupingMetadataPreservation>(); var unassigned = new List<GroupingUnassignedText>();
            var metadataSources = selected.Select(f => new GroupingMetadataSource(WithIdentity(f), f.RelativePath, f.DocumentId, f.NoteIds)).ToArray();
            var newline = MarkdownEnvelopeCodec.Read(selected[0].Text).NewLine;
            string MemberBody(Member member) => Patch(member.Body, links.Patches.Where(p => p.OriginNoteId == member.Id), member.Start);
            void TakeMetadata(GroupingMetadataResult metadata)
            {
                if (!metadata.Success) throw new IOException(string.Join("；", metadata.Issues.Select(i => i.Message)));
                preservation.AddRange(metadata.Preservation); unassigned.AddRange(metadata.Unassigned);
            }
            if (request.Action == "merge")
            {
                var metadata = GroupingMetadataCodec.GetMergeMetadata(metadataSources, Guid.NewGuid().ToString("N"), newline); TakeMetadata(metadata);
                var ordered = selected.SelectMany(f => f.NoteIds).Select(noteId => members.Single(m => m.Id == noteId)).ToArray();
                var body = GroupedNoteCodec.Serialize(ordered.Select(m => new GroupedNoteInput(m.Id, anchors[m.Id]!, MemberBody(m))).ToArray(), newline);
                if (!body.Success) throw new IOException(string.Join("；", body.Issues.Select(i => i.Message)));
                var front = GroupingMetadataCodec.WritePresentationAnchors(metadata.FrontMatter, anchors);
                mutations.Add(new(destinations[ordered[0].Id], null, Utf8(front + body.Source)));
                foreach (var source in sources) changes.Add(new(source, destinations[ordered[0].Id], "merge"));
            }
            else
            {
                foreach (var member in members.Where(m => movedIds.Contains(m.Id)))
                {
                    var metadata = GroupingMetadataCodec.GetSplitMetadata(metadataSources[0].Source, member.Id, Guid.NewGuid().ToString("N"), selected[0].RelativePath, newline);
                    TakeMetadata(metadata);
                    var front = GroupingMetadataCodec.WritePresentationAnchors(metadata.FrontMatter, anchors);
                    mutations.Add(new(destinations[member.Id], null, Utf8(front + MemberBody(member))));
                    changes.Add(new(member.File.RelativePath, destinations[member.Id], "split"));
                }
            }
            foreach (var source in selected) mutations.Add(new(source.RelativePath, source.ByteHash, null));
            foreach (var file in registry.Where(f => !sources.Contains(f.RelativePath, StringComparer.OrdinalIgnoreCase)))
            {
                var patches = links.Patches.Where(p => p.SourcePath.Equals(file.RelativePath, StringComparison.OrdinalIgnoreCase)).ToArray();
                if (patches.Length == 0) continue;
                // An unassigned link in a stationary group still changes a physical source; protect every member's draft.
                CheckNotes(file.NoteIds); affected = affected.Concat(file.NoteIds).Distinct().ToArray();
                mutations.Add(new(file.RelativePath, file.ByteHash, Encode(Patch(file.Text, patches, 0), file)));
                changes.Add(new(file.RelativePath, file.RelativePath, "update-links"));
            }
            var preserved = preservation.Distinct().ToArray(); var extra = unassigned.Distinct().ToArray();
            if (preserved.Length > 0 || extra.Any(u => !string.IsNullOrWhiteSpace(u.Text)))
            {
                var target = UserPath(request.PreservationPath ?? throw new IOException("此操作包含未歸屬正文／共用 YAML，請指定 preservation path。"));
                if (!Path.GetExtension(target).Equals(".json", StringComparison.OrdinalIgnoreCase)) throw new IOException("保留檔需使用 .json，避免保存片段被再次解析為筆記。");
                EnsureNew(target);
                if (mutations.Any(m => m.RelativePath.Equals(target, StringComparison.OrdinalIgnoreCase))) throw new IOException("保存位置不能與操作目的地重複。");
                var json = JsonSerializer.Serialize(new { format = 1, metadata = preserved, unassigned = extra }, new JsonSerializerOptions { WriteIndented = true });
                mutations.Add(new(target, null, Utf8(json))); changes.Add(new("", target, "preserve-unassigned"));
                warnings.Add("未歸屬正文與共用 YAML 已列入獨立保存檔（JSON 字串可完整還原）：" + target);
            }
            warnings.Add("群組 YAML 會正規化；原始檔案 bytes（含註解與排版）保留於操作日誌。正文內容逐字保留，僅更新預覽中的檔案連結。");
            var dto = members.Where(m => movedIds.Contains(m.Id)).Select(m => new GroupingMemberDto(m.Id, m.Title, m.File.RelativePath, destinations[m.Id], anchors[m.Id])).ToArray();
            var plan = new Plan(1, id, basis.WorkspaceId, basis.Revision, inventory, guards, affected, mutations.ToArray(), dto, changes.ToArray(), warnings.ToArray());
            WriteImmutable(PreviewPath(id), JsonSerializer.SerializeToUtf8Bytes(plan));
            return new(id, basis.Revision, dto, plan.Changes, plan.Warnings, true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException)
        { return new(id, basis.Revision, [], [], [error.Message], false); }
    }

    public OperationResult Apply(GroupingApplyRequest request)
    {
        var operation = Id(request.OperationId); var preview = Id(request.PreviewId);
        if (Receipt(operation) is { } done)
        { if (done.PreviewId != preview) throw new InvalidOperationException("操作 ID 已用於其他預覽。"); Finalize(done); return done.Result; }
        Intent intent;
        if (File.Exists(paths.Resolve(IntentPath(operation))))
        { intent = Read<Intent>(IntentPath(operation)); if (intent.Plan.PreviewId != preview) throw new InvalidOperationException("操作 ID 已用於其他預覽。"); }
        else
        {
            if (HasPendingOperations || repository.IsWriteBlocked) throw new IOException("尚有待恢復操作。");
            var plan = Read<Plan>(PreviewPath(preview)); Validate(plan);
            if (plan.Revision != knowledge.Current.Revision) throw new IOException("預覽後資料已變更，請重新預覽。");
            CheckNotes(plan.NoteIds); GuardFiles(plan, false);
            intent = new(1, operation, plan); WriteImmutable(IntentPath(operation), JsonSerializer.SerializeToUtf8Bytes(intent));
            CheckpointForTest?.Invoke("intent-durable");
        }
        return Execute(intent);
    }
    public OperationResult? ReadReceipt(string operationId) => Receipt(Id(operationId))?.Result;
    public OperationResult[] RecoverPending()
    {
        var results = new List<OperationResult>();
        foreach (var path in IntentPaths())
        {
            var intent = Read<Intent>(path);
            try { if (Receipt(intent.OperationId) is { } done) { Finalize(done); continue; } results.Add(Execute(intent)); }
            catch (Exception error) when (error is IOException or InvalidOperationException or ArgumentException)
            { results.Add(new(intent.OperationId, "conflict", knowledge.Current.Revision, Message: "群組操作待恢復，未知版本與原始日誌均保留。" + error.Message)); }
        }
        return results.ToArray();
    }
    private OperationResult Execute(Intent intent)
    {
        if (intent.Format != 1 || Id(intent.OperationId) != intent.OperationId) throw new InvalidDataException("無效群組操作。");
        var plan = intent.Plan; Validate(plan); CheckNotes(plan.NoteIds); GuardFiles(plan, true);
        if (repository.IsWriteBlocked) throw new IOException("來源恢復尚未完成。");
        var op = Guid.ParseExact(intent.OperationId, "N");
        var prepared = files.Prepare(op, plan.Mutations);
        if (prepared.Conflicts.Count > 0) throw new IOException("檔案版本衝突，未覆蓋未知版本。");
        files.CheckpointForTest = checkpoint =>
        {
            if (checkpoint.Stage == "before-mutation") { CheckNotes(plan.NoteIds); GuardFiles(plan, true); }
            FileCheckpointForTest?.Invoke(checkpoint);
        };
        var report = files.Apply(op);
        if (!report.FilesWritten || report.Conflicts.Count > 0) throw new IOException("群組寫入未完成，請恢復操作。");
        CheckpointForTest?.Invoke("files-written");
        var result = new OperationResult(intent.OperationId, "files-written", plan.Revision, Message: "合併／拆分已保存，正在重新觀測。", AffectedNoteIds: plan.NoteIds);
        var receipt = new GroupingReceipt(1, intent.OperationId, plan.PreviewId, report.PayloadSha256, result);
        WriteImmutable(ReceiptPath(intent.OperationId), JsonSerializer.SerializeToUtf8Bytes(receipt));
        CheckpointForTest?.Invoke("receipt-durable"); Finalize(receipt); return result;
    }
    private void Finalize(GroupingReceipt receipt)
    {
        if (receipt.Format != 1 || receipt.Result.OperationId != receipt.OperationId) throw new InvalidDataException("無效群組回條。");
        files.AcknowledgeDurableReceipt(Guid.ParseExact(receipt.OperationId, "N"), receipt.PayloadHash, "grouping:" + receipt.OperationId + ":" + receipt.PreviewId);
    }
    private void Validate(Plan plan)
    {
        if (plan.Format != 1 || Id(plan.PreviewId) != plan.PreviewId || plan.WorkspaceId != knowledge.Current.WorkspaceId) throw new InvalidDataException("預覽不屬於目前工作區。");
        if (plan.Mutations.Select(m => UserPath(m.RelativePath)).Distinct(StringComparer.OrdinalIgnoreCase).Count() != plan.Mutations.Length) throw new InvalidDataException("操作路徑重複。");
        foreach (var guard in plan.Guards) _ = UserPath(guard.Path);
    }
    private void GuardFiles(Plan plan, bool allowApplied)
    {
        var mutations = plan.Mutations.ToDictionary(m => m.RelativePath, StringComparer.OrdinalIgnoreCase);
        var current = Inventory().ToHashSet(StringComparer.OrdinalIgnoreCase);
        var original = plan.Inventory.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var path in current.Union(original, StringComparer.OrdinalIgnoreCase))
            if (current.Contains(path) != original.Contains(path) && !(allowApplied && mutations.ContainsKey(path))) throw new IOException("檔案清單已變更，請重新預覽：" + path);
        foreach (var guard in plan.Guards)
        {
            if (allowApplied && mutations.ContainsKey(guard.Path)) continue;
            RequireHash(guard.Path, guard.Hash);
        }
        foreach (var mutation in plan.Mutations)
        {
            EnsureParent(mutation.RelativePath);
            var full = paths.Resolve(mutation.RelativePath);
            var hash = File.Exists(full) ? RecoverableFileOperations.Sha256(File.ReadAllBytes(full)) : null;
            var after = mutation.NextContent is null ? null : RecoverableFileOperations.Sha256(mutation.NextContent);
            if (Directory.Exists(full) || (hash != mutation.ExpectedSha256 && !(allowApplied && hash == after))) throw new IOException("操作檔案版本衝突：" + mutation.RelativePath);
        }
    }
    private List<Member> ReadMembers(IEnumerable<MarkdownFileState> registry)
    {
        var result = new List<Member>();
        foreach (var file in registry)
        {
            var envelope = MarkdownEnvelopeCodec.Read(file.Text);
            if (!envelope.CanRewrite) throw new IOException("無法安全讀取來源 metadata：" + file.RelativePath);
            if (file.IsGrouped)
            {
                var parsed = GroupedNoteCodec.Parse(envelope.Body, file.NoteIds);
                if (!parsed.CanRewrite) throw new IOException("群組框架不完整：" + file.RelativePath);
                var anchors = GroupingMetadataCodec.ReadPresentationAnchors(file.Text);
                foreach (var member in parsed.Members)
                    result.Add(new(member.NoteId, knowledge.Current.Notes[member.NoteId].Title, file, member.Body, envelope.BodyStart + member.BodyRange.Start, anchors.GetValueOrDefault(member.NoteId)));
            }
            else
                result.Add(new(file.NoteId, knowledge.Current.Notes[file.NoteId].Title, file, envelope.Body, envelope.BodyStart, null));
        }
        return result;
    }
    private string WithIdentity(MarkdownFileState file)
    {
        var envelope = MarkdownEnvelopeCodec.Read(file.Text);
        if (envelope.Metadata is not null) return file.Text;
        var note = knowledge.Current.Notes[file.NoteId];
        var bindings = knowledge.Current.Definitions.Values.Where(d => d.NoteId == file.NoteId && d.FieldOrigin is null).ToDictionary(d => d.Name, d => d.Id, StringComparer.Ordinal);
        var written = MarkdownEnvelopeCodec.Write(envelope, new(1, file.DocumentId, [new(note.Id, note.Title, bindings)]));
        if (!written.Success) throw new IOException("無法保存原有身分：" + file.RelativePath);
        return written.Source;
    }
    private void CheckNotes(IEnumerable<string> ids)
    {
        foreach (var id in ids)
        {
            if (knowledge.GetDraft(id) is not null) throw new IOException("受影響筆記有未提交草稿，請先處理。");
            if (!knowledge.Current.Notes.TryGetValue(id, out var note) || note.SavedSource is { Status: "missing" or "unavailable" }) throw new IOException("受影響來源缺失或無法讀取。");
        }
    }
    private string[] Inventory()
    {
        var files = new List<string>(); var pending = new Stack<(string Path, int Depth)>(); pending.Push((paths.Root, 0)); var count = 0;
        while (pending.TryPop(out var item))
        {
            if (item.Depth > 64) throw new IOException("目錄深度超過群組操作上限。");
            foreach (var child in Directory.EnumerateFileSystemEntries(item.Path))
            {
                if (++count > 20_000) throw new IOException("檔案清單超過群組操作上限。");
                var name = Path.GetFileName(child);
                if (Reserved.Contains(name) || name == ".grasp.lock" || name.StartsWith("workspace.grasp.db", StringComparison.OrdinalIgnoreCase)) continue;
                var attributes = File.GetAttributes(child);
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("操作範圍包含 reparse point，未跟隨。");
                if ((attributes & FileAttributes.Directory) != 0) pending.Push((child, item.Depth + 1));
                else files.Add(UserPath(Path.GetRelativePath(paths.Root, child).Replace('\\', '/')));
            }
        }
        return files.Order(StringComparer.Ordinal).ToArray();
    }
    private static string Patch(string source, IEnumerable<GroupingLinkPatch> patches, int offset)
    {
        var previous = source.Length;
        foreach (var patch in patches.OrderByDescending(p => p.Start))
        {
            var start = patch.Start - offset;
            if (start < 0 || start + patch.Length > previous || source.Substring(start, patch.Length) != patch.Before) throw new IOException("連結位置無法安全對應正文。");
            source = source[..start] + patch.After + source[(start + patch.Length)..]; previous = start;
        }
        return source;
    }
    private static string FriendlyAnchor(string title)
    {
        var plain = new string(title.Where(c => char.IsLetterOrDigit(c) || c == ' ' || c == '-').ToArray()).Trim();
        if (plain.Length == 0) plain = "Note";
        if (plain.Length > 80) plain = plain[..80].Trim();
        return plain;
    }
    private string UserPath(string value)
    {
        var path = paths.NormalizeUserPath(value);
        if (path.Split('/').Any(Reserved.Contains) || Path.GetFileName(path) == ".grasp.lock" || Path.GetFileName(path).StartsWith("workspace.grasp.db", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("不可使用內部資料路徑。");
        return path;
    }
    private string MarkdownPath(string value) { var path = UserPath(value); if (!IsMarkdown(path)) throw new ArgumentException("筆記目的地需 .md 副檔名。"); return path; }
    private static bool IsMarkdown(string path) => Path.GetExtension(path).Equals(".md", StringComparison.OrdinalIgnoreCase);
    private void EnsureNew(string path) { if (File.Exists(paths.Resolve(path)) || Directory.Exists(paths.Resolve(path))) throw new IOException("目的地已存在，未覆蓋：" + path); EnsureParent(path); }
    private void EnsureParent(string path) { var parent = Path.GetDirectoryName(paths.Resolve(path))!; WorkspaceFilePaths.EnsureNoReparse(parent); if (!Directory.Exists(parent)) throw new IOException("目的父資料夾不存在。"); }
    private void RequireHash(string path, string hash) { var full = paths.Resolve(UserPath(path)); if (!File.Exists(full) || RecoverableFileOperations.Sha256(File.ReadAllBytes(full)) != hash) throw new IOException("來源版本已變更：" + path); }
    private static byte[] Utf8(string text) => new UTF8Encoding(false, true).GetBytes(text);
    private static byte[] Encode(string source, MarkdownFileState file)
    {
        Encoding encoding = file.EncodingName switch { "utf-8" => new UTF8Encoding(file.HasBom, true), "utf-16LE" when file.HasBom => new UnicodeEncoding(false, true, true), "utf-16BE" when file.HasBom => new UnicodeEncoding(true, true, true), _ => throw new InvalidDataException("來源編碼無法安全寫回。") };
        return [.. encoding.GetPreamble(), .. encoding.GetBytes(source)];
    }
    private IEnumerable<string> IntentPaths() { var folder = paths.Resolve(Store + "/intents"); return Directory.Exists(folder) ? Directory.EnumerateFiles(folder, "*.json").Order(StringComparer.Ordinal).Select(p => Path.GetRelativePath(paths.Root, p).Replace('\\', '/')).ToArray() : []; }
    private GroupingReceipt? Receipt(string id) => File.Exists(paths.Resolve(ReceiptPath(id))) ? Read<GroupingReceipt>(ReceiptPath(id)) : null;
    private T Read<T>(string path) => JsonSerializer.Deserialize<T>(File.ReadAllBytes(paths.Resolve(path))) ?? throw new InvalidDataException("缺少持久操作資料。");
    private void WriteImmutable(string relative, byte[] bytes)
    {
        var full = paths.Resolve(relative);
        if (File.Exists(full)) { if (!File.ReadAllBytes(full).AsSpan().SequenceEqual(bytes)) throw new InvalidDataException("持久操作內容不一致。"); return; }
        paths.EnsureDirectory(Path.GetDirectoryName(relative.Replace('/', Path.DirectorySeparatorChar))!);
        var temp = paths.Resolve(relative + ".tmp-" + Guid.NewGuid().ToString("N"));
        using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { stream.Write(bytes); stream.Flush(true); }
        File.Move(temp, full);
    }
    private static string Id(string value) => Guid.TryParse(value, out var id) && id != Guid.Empty ? id.ToString("N") : throw new ArgumentException("需要非空 UUID。");
    private static string PreviewPath(string id) => Store + "/previews/" + id + ".json";
    private static string IntentPath(string id) => Store + "/intents/" + id + ".json";
    private static string ReceiptPath(string id) => Store + "/receipts/" + id + ".json";
    private sealed record Member(string Id, string Title, MarkdownFileState File, string Body, int Start, string? Anchor);
    private sealed record Guard(string Path, string Hash);
    private sealed record Plan(int Format, string PreviewId, string WorkspaceId, long Revision, string[] Inventory, Guard[] Guards, string[] NoteIds, FileMutation[] Mutations, GroupingMemberDto[] Members, FileActionChange[] Changes, string[] Warnings);
    private sealed record Intent(int Format, string OperationId, Plan Plan);
    private sealed record GroupingReceipt(int Format, string OperationId, string PreviewId, string PayloadHash, OperationResult Result);
}
