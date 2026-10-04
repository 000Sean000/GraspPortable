using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;
using GraspPortable.Host.Workspace.FileOperations;
using GraspPortable.Host.Workspace.Markdown;

namespace GraspPortable.Host.Workspace;

/// <summary>Coordinator-lane commands. Imports are additive; immutable previews archive the
/// complete original source, field mappings and explicit conversions before semantic creation.</summary>
public sealed class WorkspaceRecordImport
{
    private const string Store = ".grasp/record-import/previews";
    private static readonly Regex Identifier = new(@"\A[A-Za-z_][A-Za-z0-9_]*\z", RegexOptions.CultureInvariant);
    private static readonly Regex Qualified = new(@"\A[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\z", RegexOptions.CultureInvariant);
    private readonly WorkspaceFilePaths paths;
    private readonly MarkdownWorkspaceRepository repository;
    private readonly KnowledgeService knowledge;
    public WorkspaceRecordImport(string root, MarkdownWorkspaceRepository repository, KnowledgeService knowledge)
    { paths = new(root); this.repository = repository; this.knowledge = knowledge; }

    public RecordImportPreview Preview(RecordImportPreviewRequest request)
    {
        var id = Guid.NewGuid().ToString("N"); var basis = knowledge.Current;
        var sourceRevision = 0L; var count = 0; var title = request.Title.Trim();
        try
        {
            if (repository.IsWriteBlocked) throw new IOException("工作區尚有待恢復寫入。");
            var sourceId = Id(request.SourceNoteId);
            var (note, file) = Source(sourceId); sourceRevision = note.Revision;
            RequireSourceBytes(file);
            if (title.Length == 0) title = note.Title + " 匯入資料表";
            if (title.IndexOfAny(['\r', '\n']) >= 0) throw new ArgumentException("資料表標題不能包含換行。");
            if (!Qualified.IsMatch(request.RecordKeyPrefix)) throw new ArgumentException("Record key prefix 需使用區分大小寫的 ASCII identifier，可用句點分段。");
            var tables = MarkdownTableImport.Read(note.CurrentSource); count = tables.Tables.Count;
            if (tables.Diagnostics.Count > 0) throw new IOException(string.Join("；", tables.Diagnostics.Select(d => d.Message)));
            if (request.TableIndex < 0 || request.TableIndex >= count) throw new ArgumentException("找不到指定 Markdown table（index 從 0 起算）。");
            var table = tables.Tables[request.TableIndex];
            if (!table.CanImport) throw new ArgumentException(string.Join("；", table.Diagnostics.Select(d => d.Message)));
            var mappings = Columns(table.Headers, request.FieldMappings);
            var rows = new List<PreparedRow>(); var maps = new List<RecordImportHeadingMap>(); var warnings = new List<string>(); var breaks = 0;
            for (var row = 0; row < table.Rows.Count; row++)
            {
                var cells = new List<PreparedCell>();
                for (var column = 0; column < table.Headers.Count; column++)
                {
                    var cell = table.Rows[row][column]; breaks += cell.ConvertedBreaks;
                    var converted = HeadingConversion.Preview(cell.Markdown);
                    if (!converted.CanApply) throw new ArgumentException($"第 {row + 1} 列、第 {column + 1} 欄標題轉換需人工確認：" + string.Join("；", converted.Diagnostics.Select(d => d.Message)));
                    maps.AddRange(converted.Mapping.Select(m => new RecordImportHeadingMap(row, column, m.OriginalSpan.Start, m.OriginalSpan.Length,
                        m.ConvertedSpan.Start, m.ConvertedSpan.Length, m.OriginalLevel, m.ConvertedLevel, m.ListDepth)));
                    cells.Add(new(cell.Source, cell.Markdown, converted.ConvertedSource, converted.Layout, converted.Mapping.ToArray(), cell.Span.Start, cell.Span.Length));
                }
                rows.Add(new(request.RecordKeyPrefix + (row + 1), DisplayName(table.Rows[row][0].Markdown, row), cells.ToArray()));
            }
            if (breaks > 0) warnings.Add($"將 {breaks} 個 HTML <br> 轉為真正換行（程式碼內的 <br> 保留）；原始 table 完整保留於來源筆記。");
            if (maps.Count > 0) warnings.Add($"將 {maps.Count} 個欄位內容標題移至 H5/H6；超過層級時轉為巢狀清單。原文與逐項 mapping 已保存於預覽。");
            warnings.Add("建立同資料夾的新資料表筆記；不刪除或取代來源。欄位保留 Markdown，空格只修剪 table 邊界，空 cell 為空字串而非 null。");
            warnings.Add("Wiki links 保留原文；不自動匯入連結目標或將其宣稱為已存在的 Records 關聯。");
            var plan = new ImportPlan(1, id, basis.WorkspaceId, basis.Revision, sourceId, note.Revision, note.CurrentSourceHash,
                file.RelativePath, file.ByteHash, file.Text, note.CurrentSource, request.TableIndex, table.Span.Start, table.Span.Length,
                title, request.RecordKeyPrefix, mappings, rows.ToArray(), warnings.ToArray());
            var document = Build(plan, id);
            ValidateDocument(document);
            WritePreview(plan);
            return new(id, sourceId, basis.Revision, note.Revision, request.TableIndex, count, title, request.RecordKeyPrefix,
                mappings, rows.Count, rows.Take(5).Select(r => r.Cells.Select(c => c.ConvertedSource).ToArray()).ToArray(), maps.ToArray(), warnings.ToArray(), true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or KeyNotFoundException)
        { return new(id, request.SourceNoteId, basis.Revision, sourceRevision, request.TableIndex, count, title, request.RecordKeyPrefix, [], 0, [], [], [error.Message], false); }
    }

    public async Task<OperationResult> ApplyAsync(RecordImportApplyRequest request, CancellationToken token = default)
    {
        var operation = request.OperationId;
        try
        {
            operation = Id(operation); var preview = Id(request.PreviewId);
            var hash = Hash(JsonSerializer.Serialize(new { kind = "markdown-table-import", preview }));
            if (knowledge.GetReceipt(operation) is { } previous)
                return previous.Fingerprint == hash ? Result(previous) : new(operation, "rejected", knowledge.Current.Revision, Message: "Operation ID 已用於不同內容。");
            var plan = ReadPreview(preview);
            if (plan.Format != 1 || plan.PreviewId != preview || plan.WorkspaceId != knowledge.Current.WorkspaceId) throw new InvalidDataException("預覽不屬於目前工作區。");
            if (repository.IsWriteBlocked) throw new IOException("工作區尚有待恢復寫入。");
            var (note, file) = Source(plan.SourceNoteId);
            if (knowledge.Current.Revision != plan.Revision || note.Revision != plan.SourceRevision || note.CurrentSourceHash != plan.SourceHash
                || file.RelativePath != plan.SourcePath || file.ByteHash != plan.SourceByteHash || file.Text != plan.OriginalFileSource)
                throw new IOException("預覽後來源或工作區已變更，請重新預覽。");
            RequireSourceBytes(file);
            var document = Build(plan, operation); ValidateDocument(document);
            var parent = Path.GetDirectoryName(file.RelativePath)?.Replace('\\', '/') ?? "";
            using var location = repository.BeginNewNoteLocation(operation, parent);
            using var metadata = repository.BeginRecordsMetadata(operation, document.NoteId, document.Metadata);
            return Result(await knowledge.ChangeRecordDocumentAsync(operation, document.NoteId, plan.Revision, plan.Title, document.Source,
                document.Metadata.Descriptor, token: token, create: true, requestFingerprint: hash));
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or KeyNotFoundException or JsonException)
        { return new(operation, "invalid", knowledge.Current.Revision, Message: error.Message); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { return new(operation, "conflict", knowledge.Current.Revision, Message: error.Message); }
    }

    private (Note, MarkdownFileState) Source(string noteId)
    {
        if (!knowledge.Current.Notes.TryGetValue(noteId, out var note)) throw new KeyNotFoundException("來源筆記不存在。");
        if (knowledge.GetDraft(noteId) is not null) throw new IOException("來源有未提交草稿，請先保存或處理草稿。");
        if (note.SavedSource is { Status: "missing" or "unavailable" }) throw new IOException("來源缺失或 metadata 尚未可用。");
        var matches = repository.LoadSourceFiles().Where(f => f.Exists && f.NoteIds.Contains(noteId)).ToArray();
        if (matches.Length != 1 || matches[0].IsGrouped || matches[0].NoteIds.Count != 1)
            throw new IOException("首輪轉換僅支援一個實體檔案對應一篇筆記；群組請先拆分。");
        var envelope = MarkdownEnvelopeCodec.Read(matches[0].Text);
        if (!envelope.CanRewrite || envelope.Body != note.CurrentSource) throw new IOException("來源原文與已觀測版本不一致。");
        return (note, matches[0]);
    }
    private void RequireSourceBytes(MarkdownFileState file)
    {
        var path = paths.Resolve(paths.NormalizeUserPath(file.RelativePath));
        if (!File.Exists(path) || RecoverableFileOperations.Sha256(File.ReadAllBytes(path)) != file.ByteHash)
            throw new IOException("來源檔案已由外部修改，請重新觀測後再預覽。");
    }
    private void ValidateDocument(PreparedDocument document)
    {
        var metadata = RecordsMetadataCodec.Read(RecordsMetadataCodec.Write(document.Metadata));
        if (!metadata.Success) throw new ArgumentException(string.Join("；", metadata.Issues.Select(i => i.Message)));
        var syntax = RecordNoteSyntax.Parse(document.Source, document.Metadata.Descriptor, knowledge.Current.Languages);
        if (!syntax.IsValid) throw new ArgumentException(string.Join("；", syntax.Diagnostics.Select(d => d.Message)));
        var names = syntax.Definitions.Select(d => d.Name).ToHashSet(StringComparer.Ordinal);
        if (names.Count != syntax.Definitions.Count || knowledge.Current.Definitions.Values.Any(d => names.Contains(d.Name)))
            throw new ArgumentException("匯入後的定義名稱會重複；請更改 record key prefix／field keys，或先處理欄位內手寫定義。");
        // Import must not fill existing missing references and rewrite the supposedly preserved source.
        if (knowledge.Current.Notes.Values.Any(n => n.Syntax.References.Any(r => names.Contains(r.Name))
            || n.Syntax.Definitions.Any(d => d.Parts.Any(p => p.Kind == PartKind.Identifier && names.Contains(p.Text)))))
            throw new ArgumentException("新定義名稱已被既有筆記引用；請換用未被引用的 prefix，避免轉換同時回寫原文。");
    }
    private static RecordImportColumn[] Columns(IReadOnlyList<string> headers, RecordImportFieldMapping[]? requested)
    {
        var result = new List<RecordImportColumn>(); var keys = new HashSet<string>(StringComparer.Ordinal);
        if (requested is not null && (requested.Length != headers.Count || requested.Select(m => m.ColumnIndex).Distinct().Count() != headers.Count
            || requested.Any(m => m.ColumnIndex < 0 || m.ColumnIndex >= headers.Count))) throw new ArgumentException("欄位 mapping 需完整包含每個 column 一次。");
        for (var index = 0; index < headers.Count; index++)
        {
            var mapping = requested?.Single(m => m.ColumnIndex == index);
            var key = mapping?.Key ?? (Identifier.IsMatch(headers[index]) ? headers[index] : "Field" + (index + 1));
            if (mapping is null) while (keys.Contains(key)) key += "_" + (index + 1);
            if (!Identifier.IsMatch(key) || !keys.Add(key)) throw new ArgumentException("欄位 key 需為唯一、區分大小寫的 ASCII identifier。");
            var display = mapping?.DisplayName ?? headers[index];
            if (string.IsNullOrWhiteSpace(display)) display = "欄位 " + (index + 1);
            if (display.IndexOfAny(['\r', '\n']) >= 0) throw new ArgumentException("欄位顯示名稱不可包含換行。");
            if (mapping is not null && mapping.Kind != "Markdown") throw new ArgumentException("首輪匯入保留所有欄位為 Markdown；匯入後可在欄位設定調整型別。");
            result.Add(new(index, headers[index], key, display, "Markdown"));
        }
        return result.ToArray();
    }
    private static PreparedDocument Build(ImportPlan plan, string operation)
    {
        var noteId = StableId(operation, "collection");
        var fields = plan.Columns.Select(c => new FieldSchema(StableId(operation, "field-" + c.ColumnIndex), c.Key, c.DisplayName, RecordFieldKind.Markdown)).ToArray();
        var records = new List<RecordDescriptor>(); var body = new StringBuilder("## " + plan.Title + "\n\n");
        for (var index = 0; index < plan.Rows.Length; index++)
        {
            var row = plan.Rows[index]; var recordId = StableId(operation, "record-" + index);
            var locators = fields.Select(f => new FieldLocator(f.Id, StableId(operation, "locator-" + index + "-" + f.Id))).ToArray();
            records.Add(new(recordId, row.Key, row.DisplayName, locators));
            body.Append("### ").Append(row.DisplayName).Append("\n\n");
            for (var column = 0; column < fields.Length; column++)
            {
                var carrier = VerticalRecordCodec.SerializeCarrier(locators[column], new(row.Cells[column].ConvertedSource));
                if (!carrier.Success) throw new ArgumentException(string.Join("；", carrier.Diagnostics.Select(d => d.Message)));
                body.Append("#### ").Append(fields[column].DisplayName).Append('\n').Append(carrier.Source).Append("\n\n");
            }
        }
        return new(noteId, body.ToString(), new(noteId, plan.Title, new(records, fields)));
    }
    private static string DisplayName(string cell, int index)
    {
        var name = Regex.Replace(cell, @"\s+", " ").Trim();
        if (name.StartsWith("[[", StringComparison.Ordinal) && name.EndsWith("]]", StringComparison.Ordinal))
        { name = name[2..^2]; var alias = name.LastIndexOf('|'); if (alias >= 0) name = name[(alias + 1)..]; }
        if (name.Length == 0) name = "Record " + (index + 1);
        return name.Length > 120 ? name[..120] : name;
    }
    private ImportPlan ReadPreview(string id) => JsonSerializer.Deserialize<ImportPlan>(File.ReadAllBytes(paths.Resolve(Store + "/" + id + ".json"))) ?? throw new InvalidDataException("缺少預覽資料。");
    private void WritePreview(ImportPlan plan)
    {
        paths.EnsureDirectory(Store); var destination = Store + "/" + plan.PreviewId + ".json";
        var temporary = destination + ".writing-" + Guid.NewGuid().ToString("N");
        using (var file = new FileStream(paths.Resolve(temporary), FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        { file.Write(JsonSerializer.SerializeToUtf8Bytes(plan)); file.Flush(true); }
        File.Move(paths.Resolve(temporary), paths.Resolve(destination));
    }
    private static string Id(string value) => Guid.TryParse(value, out var id) && id != Guid.Empty ? id.ToString("N") : throw new ArgumentException("需要非空 UUID。");
    private static string StableId(string operation, string label) => new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(Id(operation) + "\0table-import\0" + label)).AsSpan(0, 16)).ToString("N");
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static OperationResult Result(Receipt receipt) => new(receipt.OperationId, receipt.Status, receipt.Revision, receipt.NoteId, receipt.Message,
        receipt.Diagnostics?.Select(d => new DiagnosticDto(d.Code, d.Message, d.Span.Start, d.Span.Length)).ToArray(), receipt.AffectedNoteIds);
    private sealed record PreparedCell(string OriginalSource, string BeforeHeadingConversion, string ConvertedSource, FieldLayout ConvertedLayout,
        HeadingMap[] HeadingMapping, int OriginalStart, int OriginalLength);
    private sealed record PreparedRow(string Key, string DisplayName, PreparedCell[] Cells);
    private sealed record PreparedDocument(string NoteId, string Source, RecordsMetadata Metadata);
    private sealed record ImportPlan(int Format, string PreviewId, string WorkspaceId, long Revision, string SourceNoteId, long SourceRevision,
        string SourceHash, string SourcePath, string SourceByteHash, string OriginalFileSource, string OriginalBody, int TableIndex, int TableStart,
        int TableLength, string Title, string RecordKeyPrefix, RecordImportColumn[] Columns, PreparedRow[] Rows, string[] Warnings);
}
