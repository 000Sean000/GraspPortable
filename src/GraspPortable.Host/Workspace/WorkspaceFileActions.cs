using System.Text;
using System.Text.Json;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace.FileOperations;
using GraspPortable.Host.Workspace.Markdown;

namespace GraspPortable.Host.Workspace;

/// <summary>
/// Filesystem-only receipts: the coordinator reconciles successful writes afterwards.
/// All entry points must share the coordinator mutation lane. Pending operations must
/// recover before observing partial moves as normal external changes. No multi-file ACID.
/// </summary>
public sealed class WorkspaceFileActions
{
    private const string Store = ".grasp/file-actions";
    private const string FolderMarker = ".grasp-folder-origin";
    private static readonly JsonSerializerOptions Json = new();
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
        { ".grasp", ".git", ".obsidian", "artifacts" };
    private readonly WorkspaceFilePaths paths;
    private readonly MarkdownWorkspaceRepository repository;
    private readonly KnowledgeService knowledge;
    private readonly RecoverableFileOperations files;
    public Action<string>? CheckpointForTest { get; set; }
    public Action<FileOperationCheckpoint>? FileCheckpointForTest { get; set; }

    public WorkspaceFileActions(string root, MarkdownWorkspaceRepository repository, KnowledgeService knowledge)
    { paths = new(root); this.repository = repository; this.knowledge = knowledge; files = new(root); }

    public bool HasPendingOperations => IntentPaths().Any(p => !File.Exists(paths.Resolve(ReceiptPath(Path.GetFileNameWithoutExtension(p)))));

    public FileActionPreview Preview(FileActionPreviewRequest request)
    {
        var id = Guid.NewGuid().ToString("N"); var basis = knowledge.Current;
        try
        {
            if (repository.IsWriteBlocked || HasPendingOperations) throw new IOException("尚有待恢復的檔案操作，請先處理再預覽。");
            if (request.Action is not ("rename" or "move" or "new-folder")) throw new ArgumentException("不支援的檔案操作。");
            var target = UserPath(request.DestinationPath);
            EnsureAbsent(target); EnsureParent(target);
            var source = request.Action == "new-folder" ? "" : UserPath(request.SourcePath);
            var sourceDirectory = source.Length > 0 && Directory.Exists(paths.Resolve(source));
            if (source.Length > 0 && !sourceDirectory && !File.Exists(paths.Resolve(source))) throw new IOException("來源已不存在，請重新整理。");
            if (source.Length > 0 && (target.Equals(source, StringComparison.OrdinalIgnoreCase)
                || target.StartsWith(source + "/", StringComparison.OrdinalIgnoreCase))) throw new IOException("目的地不可是來源本身或其子目錄；只改大小寫暫不支援。");
            var inventory = source.Length == 0 ? [] : Inventory(source);
            var registry = repository.LoadSourceFiles();
            var movedFiles = inventory.Where(i => !i.Directory).ToArray();
            var notes = registry.Where(f => Under(f.RelativePath, source) && source.Length > 0).ToArray();
            CheckNotes(notes.SelectMany(n => n.NoteIds));
            foreach (var file in notes) if (!file.Exists) throw new IOException("來源包含缺失筆記，不能搬移：" + file.RelativePath);
            var mutations = new List<FileMutation>(); var changes = new List<FileActionChange>();
            var warnings = new List<string>();
            var links = source.Length == 0 ? new FileLinkPlan(new Dictionary<string, string>(), [])
                : FileLinks.Plan(paths.Root, registry, source, target, sourceDirectory, basis.Languages);
            if (links.Warnings.Length > 0) return new(id, basis.Revision, [], links.Warnings, false);
            var patchOwners = registry.Where(f => links.Rewrites.ContainsKey(f.RelativePath)).ToArray();
            CheckNotes(patchOwners.SelectMany(f => f.NoteIds));
            foreach (var item in movedFiles)
            {
                var next = sourceDirectory ? target + item.Path[source.Length..] : target;
                UserPath(next);
                var bytes = File.ReadAllBytes(paths.Resolve(item.Path));
                if (RecoverableFileOperations.Sha256(bytes) != item.Hash) throw new IOException("來源在預覽期間改變，請重試。");
                if (Path.GetExtension(item.Path).Equals(".md", StringComparison.OrdinalIgnoreCase))
                {
                    if (!Path.GetExtension(next).Equals(".md", StringComparison.OrdinalIgnoreCase))
                        throw new IOException("筆記搬移須保留 .md 副檔名，避免從筆記來源消失。");
                    var file = registry.SingleOrDefault(f => f.Exists && f.RelativePath.Equals(item.Path, StringComparison.OrdinalIgnoreCase))
                        ?? throw new IOException("Markdown 尚未成功觀測，不能安全保存身分：" + item.Path);
                    if (file.ByteHash != item.Hash) throw new IOException("來源版本已更新，請先重新觀測：" + item.Path);
                    var changedText = links.Rewrites.GetValueOrDefault(file.RelativePath) ?? file.Text;
                    var envelope = MarkdownEnvelopeCodec.Read(changedText);
                    if (!envelope.CanRewrite) throw new IOException("無法安全保存 YAML 身分：" + item.Path);
                    if (envelope.Metadata is null)
                    {
                        var note = basis.Notes[file.NoteId];
                        var definitions = basis.Definitions.Values.Where(d => d.NoteId == note.Id).ToDictionary(d => d.Name, d => d.Id, StringComparer.Ordinal);
                        var result = MarkdownEnvelopeCodec.Write(envelope, new(1, file.DocumentId, [new(note.Id, note.Title, definitions)]));
                        if (!result.Success) throw new IOException("無法保存 Markdown 身分：" + item.Path);
                        bytes = Encode(result.Source, file);
                        warnings.Add("搬移時補入必要 YAML IDs，僅更新已預覽的連結位置：" + item.Path);
                    }
                    else if (changedText != file.Text) bytes = Encode(changedText, file);
                }
                mutations.Add(new(item.Path, item.Hash, null));
                mutations.Add(new(next, null, bytes));
                changes.Add(new(item.Path, next, request.Action));
                if (links.Rewrites.ContainsKey(item.Path)) changes.Add(new(item.Path, next, "update-links"));
            }
            foreach (var owner in patchOwners.Where(f => !movedFiles.Any(m => m.Path.Equals(f.RelativePath, StringComparison.OrdinalIgnoreCase))))
            {
                mutations.Add(new(owner.RelativePath, owner.ByteHash, Encode(links.Rewrites[owner.RelativePath], owner)));
                changes.Add(new(owner.RelativePath, owner.RelativePath, "update-links"));
            }
            var createDirectories = sourceDirectory
                ? inventory.Where(i => i.Directory).Select(i => target + i.Path[source.Length..]).ToArray()
                : request.Action == "new-folder" ? [target] : [];
            if (sourceDirectory || request.Action == "new-folder") changes.Insert(0, new(source, target, "create-directory"));
            var guards = registry.Where(f => f.Exists).Select(f => new FileGuard(f.RelativePath, f.ByteHash)).ToArray();
            var plan = new ActionPlan(1, id, basis.WorkspaceId, basis.Revision, request.Action, source, target,
                sourceDirectory, inventory, createDirectories, notes.Concat(patchOwners).SelectMany(n => n.NoteIds).Distinct().ToArray(),
                guards, mutations.ToArray(), changes.ToArray(), warnings.ToArray());
            WriteImmutable(PreviewPath(id), JsonSerializer.SerializeToUtf8Bytes(plan, Json));
            return new(id, basis.Revision, plan.Changes, plan.Warnings, true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException)
        { return new(id, basis.Revision, [], [error.Message], false); }
    }

    public OperationResult Apply(FileActionApplyRequest request)
    {
        var operationId = Id(request.OperationId); var previewId = Id(request.PreviewId);
        if (ReadReceiptRecord(operationId) is { } done)
        {
            if (done.PreviewId != previewId) throw new InvalidOperationException("相同操作 ID 不可套用不同預覽。");
            FinalizeReceipt(done); return done.Result;
        }
        var intentPath = IntentPath(operationId);
        ActionIntent intent;
        if (File.Exists(paths.Resolve(intentPath)))
        {
            intent = Read<ActionIntent>(intentPath);
            if (intent.Plan.PreviewId != previewId) throw new InvalidOperationException("相同操作 ID 不可套用不同預覽。");
        }
        else
        {
            if (HasPendingOperations || repository.IsWriteBlocked) throw new IOException("尚有待恢復操作，未套用新的檔案變更。");
            var plan = Read<ActionPlan>(PreviewPath(previewId));
            ValidatePlan(plan);
            if (plan.Revision != knowledge.Current.Revision) throw new IOException("預覽後資料已變更，請重新預覽。");
            CheckNotes(plan.NoteIds); EnsureAbsent(plan.Target); EnsureParent(plan.Target);
            if (plan.Source.Length > 0 && !Inventory(plan.Source).SequenceEqual(plan.Inventory)) throw new IOException("來源目錄或檔案版本已變更，請重新預覽。");
            foreach (var guard in plan.Guards)
            {
                var file = paths.Resolve(UserPath(guard.Path));
                if (!File.Exists(file) || RecoverableFileOperations.Sha256(File.ReadAllBytes(file)) != guard.Hash)
                    throw new IOException("連結／來源檢查的基底已變更，請重新預覽：" + guard.Path);
            }
            intent = new(1, operationId, plan);
            WriteImmutable(intentPath, JsonSerializer.SerializeToUtf8Bytes(intent, Json));
            CheckpointForTest?.Invoke("intent-durable");
        }
        return Execute(intent);
    }

    public OperationResult? ReadReceipt(string operationId) => ReadReceiptRecord(Id(operationId))?.Result;

    public OperationResult[] RecoverPending()
    {
        var results = new List<OperationResult>();
        foreach (var path in IntentPaths())
        {
            var intent = Read<ActionIntent>(path);
            try
            {
                if (ReadReceiptRecord(intent.OperationId) is { } done) { FinalizeReceipt(done); continue; }
                results.Add(Execute(intent));
            }
            catch (Exception error) when (error is IOException or InvalidOperationException or ArgumentException)
            { results.Add(new(intent.OperationId, "conflict", knowledge.Current.Revision, Message: "檔案操作待恢復；原版本保留於日誌。" + error.Message)); }
        }
        return results.ToArray();
    }

    private OperationResult Execute(ActionIntent intent)
    {
        if (intent.Format != 1 || Id(intent.OperationId) != intent.OperationId) throw new InvalidDataException("無效檔案操作記錄。");
        var plan = intent.Plan; ValidatePlan(plan); CheckNotes(plan.NoteIds);
        if (repository.IsWriteBlocked) throw new IOException("來源恢復尚未完成，未繼續檔案操作。");
        var operationGuid = Guid.ParseExact(intent.OperationId, "N");
        FileOperationReport? report = null;
        if (plan.Mutations.Length > 0)
        {
            report = files.Prepare(operationGuid, plan.Mutations);
            if (report.Phase == FileOperationPhase.Conflict) throw FileConflict(report);
        }
        if (plan.CreateDirectories.Length > 0) EnsureOwnedDestination(intent);
        if (plan.Mutations.Length > 0)
        {
            files.CheckpointForTest = checkpoint =>
            {
                if (checkpoint.Stage == "before-mutation") CheckNotes(plan.NoteIds);
                FileCheckpointForTest?.Invoke(checkpoint);
            };
            report = files.Apply(operationGuid);
            if (!report.FilesWritten || report.Conflicts.Count != 0) throw FileConflict(report);
        }
        CheckpointForTest?.Invoke("files-written");
        if (plan.SourceDirectory)
        {
            foreach (var directory in plan.Inventory.Where(i => i.Directory).OrderByDescending(i => i.Path.Length))
            {
                var full = paths.Resolve(UserPath(directory.Path));
                if (!Directory.Exists(full)) continue;
                if (Directory.EnumerateFileSystemEntries(full).Any()) throw new IOException("来源中出现了新的内容，保留该目录，待恢复：" + directory.Path);
                Directory.Delete(full, recursive: false);
            }
        }
        var result = new OperationResult(intent.OperationId, "files-written", plan.Revision,
            Message: "檔案操作已保存；正在重新觀測筆記與引用。", AffectedNoteIds: plan.NoteIds);
        var receipt = new ActionReceipt(1, intent.OperationId, plan.PreviewId, report?.PayloadSha256,
            plan.CreateDirectories.Length > 0 ? plan.Target : null, result);
        WriteImmutable(ReceiptPath(intent.OperationId), JsonSerializer.SerializeToUtf8Bytes(receipt, Json));
        CheckpointForTest?.Invoke("receipt-durable");
        FinalizeReceipt(receipt);
        return result;
    }

    private void EnsureOwnedDestination(ActionIntent intent)
    {
        var target = paths.Resolve(UserPath(intent.Plan.Target));
        var marker = Encoding.UTF8.GetBytes(intent.OperationId + "\n" + intent.Plan.PreviewId);
        if (Directory.Exists(target))
        {
            var proof = paths.Resolve(intent.Plan.Target + "/" + FolderMarker);
            if (!File.Exists(proof) || !File.ReadAllBytes(proof).AsSpan().SequenceEqual(marker)) throw new IOException("目的資料夾已由其他操作建立，未覆蓋。");
            return;
        }
        if (File.Exists(target)) throw new IOException("目的路徑已被檔案占用，未覆蓋。");
        var staging = Store + "/staging/" + intent.OperationId;
        var prepared = Store + "/directory-prepared/" + intent.OperationId + ".json";
        if (File.Exists(paths.Resolve(prepared)) && !Directory.Exists(paths.Resolve(staging)))
            throw new IOException("曾建立的目的資料夾已被外部移除，未自動重建。");
        paths.EnsureDirectory(staging);
        WriteImmutable(staging + "/" + FolderMarker, marker);
        foreach (var folder in intent.Plan.CreateDirectories)
        {
            var suffix = folder[intent.Plan.Target.Length..];
            paths.EnsureDirectory(staging + suffix);
        }
        WriteImmutable(prepared, marker);
        EnsureParent(intent.Plan.Target);
        Directory.Move(paths.Resolve(staging), target);
        CheckpointForTest?.Invoke("directory-created");
    }

    private void FinalizeReceipt(ActionReceipt receipt)
    {
        if (receipt.Format != 1 || receipt.Result.OperationId != receipt.OperationId) throw new InvalidDataException("無效檔案操作回條。");
        if (receipt.PayloadHash is not null)
            files.AcknowledgeDurableReceipt(Guid.ParseExact(receipt.OperationId, "N"), receipt.PayloadHash, "file-action:" + receipt.OperationId + ":" + receipt.PreviewId);
        if (receipt.DirectoryTarget is { } directory)
        {
            var marker = paths.Resolve(UserPath(directory) + "/" + FolderMarker);
            var expected = Encoding.UTF8.GetBytes(receipt.OperationId + "\n" + receipt.PreviewId);
            if (File.Exists(marker) && File.ReadAllBytes(marker).AsSpan().SequenceEqual(expected)) File.Delete(marker);
        }
    }

    private void ValidatePlan(ActionPlan plan)
    {
        if (plan.Format != 1 || Id(plan.PreviewId) != plan.PreviewId || plan.WorkspaceId != knowledge.Current.WorkspaceId)
            throw new InvalidDataException("預覽不屬於目前工作區或版本不相容。");
        _ = UserPath(plan.Target);
        if (plan.Source.Length > 0) _ = UserPath(plan.Source);
        foreach (var change in plan.Mutations) _ = UserPath(change.RelativePath);
        foreach (var directory in plan.CreateDirectories)
            if (!Under(UserPath(directory), plan.Target)) throw new InvalidDataException("目的資料夾超出預覽範圍。");
    }
    private void CheckNotes(IEnumerable<string> ids)
    {
        foreach (var id in ids)
        {
            if (knowledge.GetDraft(id) is not null) throw new IOException("來源有未提交草稿，請先處理再搬移。");
            if (!knowledge.Current.Notes.TryGetValue(id, out var note) || note.SavedSource is { Status: "missing" or "unavailable" })
                throw new IOException("來源缺失或無法讀取，未搬移。");
        }
    }
    private FileInventory[] Inventory(string source)
    {
        var entries = new List<FileInventory>(); var pending = new Stack<string>(); pending.Push(source);
        while (pending.TryPop(out var relative))
        {
            var full = paths.Resolve(UserPath(relative));
            var attributes = File.GetAttributes(full);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("不搬移 symbolic link 或 reparse point。");
            if ((attributes & FileAttributes.Directory) != 0)
            {
                entries.Add(new(relative, true, null));
                foreach (var child in Directory.EnumerateFileSystemEntries(full))
                    pending.Push(Path.GetRelativePath(paths.Root, child).Replace('\\', '/'));
            }
            else entries.Add(new(relative, false, RecoverableFileOperations.Sha256(File.ReadAllBytes(full))));
        }
        return entries.OrderBy(i => i.Path, StringComparer.Ordinal).ToArray();
    }
    private string UserPath(string relative)
    {
        var normalized = paths.NormalizeUserPath(relative);
        if (normalized.Split('/').Any(Reserved.Contains) || Path.GetFileName(normalized) == ".grasp.lock"
            || Path.GetFileName(normalized).StartsWith("workspace.grasp.db", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("此路徑屬於內部資料，不提供檔案操作。");
        return normalized;
    }
    private void EnsureAbsent(string path)
    { var full = paths.Resolve(path); if (File.Exists(full) || Directory.Exists(full)) throw new IOException("目的路徑已存在，不會覆蓋：" + path); }
    private void EnsureParent(string path)
    {
        var parent = Path.GetDirectoryName(paths.Resolve(path))!;
        WorkspaceFilePaths.EnsureNoReparse(parent);
        if (!Directory.Exists(parent)) throw new IOException("目的父資料夾不存在，請先建立。");
    }
    private static bool Under(string path, string prefix) => path.Equals(prefix, StringComparison.OrdinalIgnoreCase) || path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase);
    private static byte[] Encode(string source, MarkdownFileState file)
    {
        Encoding encoding = file.EncodingName switch
        {
            "utf-8" => new UTF8Encoding(file.HasBom, true),
            "utf-16LE" when file.HasBom => new UnicodeEncoding(false, true, true),
            "utf-16BE" when file.HasBom => new UnicodeEncoding(true, true, true),
            _ => throw new InvalidDataException("來源編碼無法安全寫回。")
        };
        return [.. encoding.GetPreamble(), .. encoding.GetBytes(source)];
    }
    private IEnumerable<string> IntentPaths()
    {
        var folder = paths.Resolve(Store + "/intents");
        return Directory.Exists(folder) ? Directory.EnumerateFiles(folder, "*.json").Order(StringComparer.Ordinal)
            .Select(p => Path.GetRelativePath(paths.Root, p).Replace('\\', '/')).ToArray() : [];
    }
    private ActionReceipt? ReadReceiptRecord(string id) => File.Exists(paths.Resolve(ReceiptPath(id))) ? Read<ActionReceipt>(ReceiptPath(id)) : null;
    private T Read<T>(string path) => JsonSerializer.Deserialize<T>(File.ReadAllBytes(paths.Resolve(path)), Json) ?? throw new InvalidDataException("缺少持久操作資料。");
    private void WriteImmutable(string relative, byte[] bytes)
    {
        var full = paths.Resolve(relative);
        if (File.Exists(full))
        {
            if (!File.ReadAllBytes(full).AsSpan().SequenceEqual(bytes)) throw new InvalidDataException("持久操作內容不一致。");
            return;
        }
        paths.EnsureDirectory(Path.GetDirectoryName(relative.Replace('/', Path.DirectorySeparatorChar))!);
        var temporary = paths.Resolve(relative + ".tmp-" + Guid.NewGuid().ToString("N"));
        using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        { stream.Write(bytes); stream.Flush(true); }
        File.Move(temporary, full);
    }
    private static string Id(string id) => Guid.TryParse(id, out var parsed) && parsed != Guid.Empty ? parsed.ToString("N") : throw new ArgumentException("操作／預覽 ID 必須是非空 UUID。");
    private static string PreviewPath(string id) => Store + "/previews/" + id + ".json";
    private static string IntentPath(string id) => Store + "/intents/" + id + ".json";
    private static string ReceiptPath(string id) => Store + "/receipts/" + id + ".json";
    private static IOException FileConflict(FileOperationReport report) => new("檔案版本衝突，未覆蓋未知版本：" + string.Join("；", report.Conflicts.Select(c => c.RelativePath + " " + c.Reason)));
    private sealed record FileInventory(string Path, bool Directory, string? Hash);
    private sealed record FileGuard(string Path, string Hash);
    private sealed record ActionPlan(int Format, string PreviewId, string WorkspaceId, long Revision, string Action,
        string Source, string Target, bool SourceDirectory, FileInventory[] Inventory, string[] CreateDirectories,
        string[] NoteIds, FileGuard[] Guards, FileMutation[] Mutations, FileActionChange[] Changes, string[] Warnings);
    private sealed record ActionIntent(int Format, string OperationId, ActionPlan Plan);
    private sealed record ActionReceipt(int Format, string OperationId, string PreviewId, string? PayloadHash,
        string? DirectoryTarget, OperationResult Result);
}
