using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;
using GraspPortable.Host.Workspace.Markdown;
using YamlDotNet.RepresentationModel;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace GraspPortable.Host.Workspace;

/// <summary>One-note collections initially; caller holds the coordinator mutation gate for commands.</summary>
public sealed partial class WorkspaceRecords(MarkdownWorkspaceRepository repository, KnowledgeService knowledge)
{
    private sealed record Owner(Note Note, RecordsMetadata Metadata);
    private sealed record CarrierPlan(IReadOnlyDictionary<string, string> Sources, IReadOnlyList<MarkdownScanIssue> Issues);
    private static readonly ISerializer ViewSerializer = new SerializerBuilder().WithNamingConvention(CamelCaseNamingConvention.Instance).Build();

    public CollectionSummaryDto[] ListCollections() => Owners().Select(o => new CollectionSummaryDto(o.Metadata.CollectionId, o.Note.Id,
        o.Metadata.Title, o.Note.CurrentRecords!.Records.Count, o.Note.CurrentRecords.Fields.Count, knowledge.Current.Revision,
        knowledge.GetDraft(o.Note.Id) is not null, o.Note.SavedSource?.Status ?? "accepted")).ToArray();

    public CollectionDto Read(string collectionId)
    {
        var owner = Find(collectionId); var note = owner.Note; var descriptor = note.CurrentRecords!; var basis = knowledge.Current;
        var fields = VerticalRecordCodec.Parse(note.CurrentSource, descriptor);
        var definitionsByName = basis.Definitions.Values.ToDictionary(d => d.Name, StringComparer.Ordinal);
        var choices = Owners().SelectMany(o => o.Note.CurrentRecords!.Records.Select(r => new RecordChoiceDto(r.Id, r.Key, r.DisplayName, o.Metadata.CollectionId))).ToArray();
        var recordIds = choices.Select(r => r.Id).ToHashSet(StringComparer.Ordinal);
        var diagnostics = fields.Diagnostics.Select(Diagnostic).Concat(note.Diagnostics.Select(d => new DiagnosticDto(d.Code, d.Message, d.Span.Start, d.Span.Length))).ToList();
        var views = ReadViews(owner.Metadata.ViewsYaml, descriptor, diagnostics);
        var rows = descriptor.Records.Select(record => new RecordRowDto(record.Id, record.Key, record.DisplayName, descriptor.Fields.Select(schema =>
        {
            var field = fields.Fields.SingleOrDefault(f => f.RecordId == record.Id && f.FieldId == schema.Id);
            var definition = basis.Definitions.Values.SingleOrDefault(d => d.NoteId == note.Id && d.FieldOrigin == new FieldDefinitionOrigin(record.Id, schema.Id));
            var status = note.IsSourceStale ? "Stale" : definition?.Status ?? "Missing";
            var typed = field is not null && status == "Valid" ? RecordValueCodec.Parse(schema, field.IsNull, definition?.Value ?? "", new(recordIds)) : null;
            if (typed is { IsValid: false }) status = "Invalid";
            var writable = field is not null && !note.IsSourceStale && knowledge.GetDraft(note.Id) is null
                && definition is not null && note.Syntax.Definitions.Single(d => d.Name == definition.Name).Parts.All(p => p.Kind == PartKind.Literal);
            // Render metadata is derived only from accepted ORIGINAL field source. Its ranges
            // are local to RawSource, including nested-list carriers' removed indentation.
            var original = field is { IsNull: false } && !note.IsSourceStale
                ? GraspParser.Parse(field.RawSource, basis.Languages) : null;
            var references = original?.References.Select(r => new ReferenceDto(note.Id, r.Name, r.Kind.ToString(),
                r.CachedValue, r.Span.Start, r.Span.Length, r.ValueSpan.Start, r.ValueSpan.Length,
                definitionsByName.GetValueOrDefault(r.Name)?.NoteId)).ToArray() ?? [];
            var regions = original?.Regions?.Select(r => new RegionDto(r.Span.Start, r.Span.Length, r.IsComplete)).ToArray() ?? [];
            return new RecordCellDto(schema.Id, field?.RawSource ?? "", definition?.Value, field?.IsNull ?? true, status, writable,
                typed?.Value is { } value ? Typed(value) : null, typed?.Diagnostics.Select(Diagnostic).ToArray() ?? [], references, regions);
        }).ToArray())).ToArray();
        return new(owner.Metadata.CollectionId, note.Id, owner.Metadata.Title, basis.Revision, note.Revision,
            note.SavedSource?.Status ?? "accepted", knowledge.GetDraft(note.Id) is not null, descriptor.Fields.Select(SchemaDto).ToArray(), rows, choices, views, diagnostics.ToArray());
    }

    public Task<OperationResult> CreateAsync(CreateCollectionRequest request, CancellationToken token = default)
        => Execute("create-collection", "", "", "", request, request.OperationId, async hash =>
        {
            var noteId = StableId(request.OperationId, "collection");
            var supplied = request.Fields ?? [new("", "Description", "說明", "Markdown")];
            var schema = supplied.Select((field, index) => Schema(field, request.OperationId, "field-" + index)).ToArray();
            var record = NewRecord(request.OperationId, request.RecordKey, request.RecordTitle, schema);
            var descriptor = new RecordsDocumentDescriptor([record], schema);
            var metadata = new RecordsMetadata(noteId, request.Title, descriptor);
            Validate(metadata);
            var source = "## " + Heading(request.Title) + "\n\n" + RecordBody(record, schema);
            using var location = repository.BeginNewNoteLocation(request.OperationId, request.ParentPath);
            return await Commit(request.OperationId, hash, request.ExpectedKnowledgeRevision, noteId, request.Title, source, metadata, false, token, create: true);
        });

    public Task<OperationResult> AddRecordAsync(string collectionId, AddRecordRequest request, CancellationToken token = default)
        => Execute("add-record", collectionId, "", "", request, request.OperationId, async hash =>
        {
            var owner = Find(collectionId); var descriptor = owner.Note.CurrentRecords!;
            var record = NewRecord(request.OperationId, request.Key, request.DisplayName, descriptor.Fields);
            var metadata = owner.Metadata with { Descriptor = descriptor with { Records = descriptor.Records.Append(record).ToArray() } };
            var source = owner.Note.CurrentSource + "\n\n" + RecordBody(record, descriptor.Fields);
            return await Commit(request.OperationId, hash, request.ExpectedKnowledgeRevision, owner.Note.Id, owner.Note.Title, source, metadata, false, token);
        });

    public Task<OperationResult> UpsertFieldAsync(string collectionId, UpsertRecordFieldRequest request, CancellationToken token = default)
        => Execute("upsert-field", collectionId, "", request.Field.Id, request with { ConfirmRename = false }, request.OperationId, async hash =>
        {
            var owner = Find(collectionId); var descriptor = owner.Note.CurrentRecords!;
            var field = Schema(request.Field, request.OperationId, "field");
            var old = descriptor.Fields.SingleOrDefault(f => f.Id == field.Id);
            if (!string.IsNullOrEmpty(request.Field.Id) && old is null) throw new ArgumentException("指定欄位不存在；新增欄位請使用空 ID。");
            var source = owner.Note.CurrentSource; var records = descriptor.Records.ToArray();
            if (old is null)
            {
                var parsed = VerticalRecordCodec.Parse(source, descriptor);
                if (!parsed.CanRewrite) throw new InvalidOperationException("來源欄位邊界不明，無法新增。");
                var patches = new List<SourcePatch>();
                records = records.Select(record =>
                {
                    var locator = new FieldLocator(field.Id, StableId(request.OperationId, "locator-" + record.Id));
                    var existing = parsed.Fields.Where(f => f.RecordId == record.Id).ToArray();
                    var text = "\n\n" + (existing.Length == 0 ? "### " + Heading(record.DisplayName) + "\n" : "") + FieldBody(locator, field);
                    var at = existing.Length == 0 ? source.Length : existing.Max(f => f.CarrierSpan.End);
                    patches.Add(new(new(at, 0), text));
                    return record with { Fields = record.Fields.Append(locator).ToArray() };
                }).ToArray();
                // Empty-record insertions can share the final offset; combine deterministically.
                source = ReferenceCodec.ApplyPatches(source, patches.GroupBy(p => p.Span.Start).Select(g => new SourcePatch(new(g.Key, 0), string.Concat(g.Select(p => p.Text)))).ToArray());
            }
            var fields = old is null ? descriptor.Fields.Append(field).ToArray() : descriptor.Fields.Select(f => f.Id == field.Id ? field : f).ToArray();
            var metadata = owner.Metadata with { Descriptor = new(records, fields) };
            return await Commit(request.OperationId, hash, request.ExpectedKnowledgeRevision, owner.Note.Id, owner.Note.Title, source, metadata, request.ConfirmRename, token);
        });

    public Task<OperationResult> RenameRecordAsync(string collectionId, string recordId, RenameRecordRequest request, CancellationToken token = default)
        => Execute("rename-record", collectionId, recordId, "", request with { ConfirmRename = false }, request.OperationId, async hash =>
        {
            var owner = Find(collectionId); var descriptor = owner.Note.CurrentRecords!;
            if (!descriptor.Records.Any(r => r.Id == recordId)) throw new KeyNotFoundException("Record 不存在。");
            var metadata = owner.Metadata with { Descriptor = descriptor with { Records = descriptor.Records.Select(r => r.Id == recordId
                ? r with { Key = request.Key, DisplayName = request.DisplayName } : r).ToArray() } };
            return await Commit(request.OperationId, hash, request.ExpectedKnowledgeRevision, owner.Note.Id, owner.Note.Title, owner.Note.CurrentSource,
                metadata, request.ConfirmRename, token);
        });

    public Task<OperationResult> ChangeFieldAsync(string recordId, string fieldId, RecordFieldChangeRequest request, CancellationToken token = default)
        => Execute("change-record-field", "", recordId, fieldId, request with { ConfirmRename = false }, request.OperationId, async hash =>
        {
            var owner = Owners().SingleOrDefault(o => o.Note.CurrentRecords!.Records.Any(r => r.Id == recordId))
                ?? throw new KeyNotFoundException("Record 不存在。");
            var schema = owner.Note.CurrentRecords!.Fields.SingleOrDefault(f => f.Id == fieldId) ?? throw new KeyNotFoundException("欄位不存在。");
            var edit = request.TypedValue is null ? new FieldSourceEdit(request.RawSource, request.IsNull) : TypedEdit(owner, schema, request.TypedValue);
            return await knowledge.ChangeRecordFieldAsync(request.OperationId, recordId, fieldId, request.ExpectedKnowledgeRevision,
                edit, token, request.ConfirmRename, requestFingerprint: hash);
        });

    public Task<OperationResult> SaveViewAsync(string collectionId, SaveRecordViewRequest request, CancellationToken token = default)
        => Execute("save-view", collectionId, "", "", request, request.OperationId, async hash =>
        {
            var owner = Find(collectionId); var view = request.View with { Id = string.IsNullOrEmpty(request.View.Id) ? StableId(request.OperationId, "view") : CanonicalId(request.View.Id) };
            ValidateView(view, owner.Note.CurrentRecords!);
            var sequence = ViewsNode(owner.Metadata.ViewsYaml);
            var existing = sequence.Children.OfType<YamlMappingNode>().SingleOrDefault(n => Scalar(n, "id") == view.Id);
            var current = Yaml(ViewSerializer.Serialize(view)) as YamlMappingNode ?? throw new InvalidOperationException("View serialization failed.");
            if (existing is null) sequence.Add(current);
            else foreach (var pair in current.Children) existing.Children[pair.Key] = pair.Value;
            var metadata = owner.Metadata with { ViewsYaml = YamlText(sequence) };
            return await Commit(request.OperationId, hash, request.ExpectedKnowledgeRevision, owner.Note.Id, owner.Note.Title, owner.Note.CurrentSource, metadata, false, token);
        });

    private async Task<Receipt> Commit(string operation, string hash, long expectedRevision, string noteId, string title, string source,
        RecordsMetadata metadata, bool confirmRename, CancellationToken token, bool create = false)
    {
        Validate(metadata);
        var basis = knowledge.Current;
        var repairs = PrepareCarrierRepairs(basis, noteId, source, metadata.Descriptor);
        if (repairs.Issues.Count > 0) throw new IOException(string.Join("；", repairs.Issues.Select(i => i.Message)));
        source = repairs.Sources.GetValueOrDefault(noteId, source);
        var sideSources = repairs.Sources.Where(p => p.Key != noteId).Select(p =>
            new RecordDocumentSourceUpdate(p.Key, basis.Notes[p.Key].CurrentSourceHash, p.Value)).ToArray();
        using var lease = repository.BeginRecordsMetadata(operation, noteId, metadata);
        return await knowledge.ChangeRecordDocumentAsync(operation, noteId, expectedRevision, title, source, metadata.Descriptor,
            confirmRename, token, create, hash, sourceUpdates: sideSources);
    }

    /// <summary>
    /// Call after successful source reconciliation/registry refresh, while the coordinator gate is held.
    /// No gate re-entry. Only changed explicit carriers commit; the resulting watcher echo is a no-op.
    /// </summary>
    public async Task<IReadOnlyList<MarkdownScanIssue>> RefreshCarriersAsync(CancellationToken token = default)
    {
        var basis = knowledge.Current; var plan = PrepareCarrierRepairs(basis);
        var issues = plan.Issues.ToList();
        if (plan.Sources.Count == 0) return issues;
        var changes = plan.Sources.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => new RecordDocumentSourceUpdate(p.Key, basis.Notes[p.Key].CurrentSourceHash, p.Value)).ToArray();
        var primary = changes[0]; var note = basis.Notes[primary.NoteId];
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new {
            kind = "record-carrier-refresh", revision = basis.Revision, changes }))));
        var result = await knowledge.ChangeRecordDocumentAsync(Guid.NewGuid().ToString("N"), note.Id, basis.Revision,
            note.Title, primary.Source, note.CurrentRecords!, token: token, requestFingerprint: fingerprint, sourceUpdates: changes.Skip(1).ToArray());
        if (result.Status != "committed") issues.Add(new("", "record-carrier-pending", result.Message ?? "Carrier 尚未同步。", note.Id));
        return issues;
    }

    private CarrierPlan PrepareCarrierRepairs(Snapshot basis, string? mainNoteId = null, string? mainSource = null, RecordsDocumentDescriptor? mainDescriptor = null)
    {
        var paths = repository.LoadSourceFiles().Where(f => f.Exists).SelectMany(f => f.NoteIds.Select(id => (Id: id, f.RelativePath)))
            .ToDictionary(p => p.Id, p => p.RelativePath, StringComparer.Ordinal);
        var candidates = basis.Notes.Values.Where(n => n.CurrentRecords is not null && paths.ContainsKey(n.Id))
            .ToDictionary(n => n.Id, n => (Source: n.CurrentSource, Descriptor: n.CurrentRecords!), StringComparer.Ordinal);
        if (mainNoteId is not null && mainSource is not null && mainDescriptor is not null) candidates[mainNoteId] = (mainSource, mainDescriptor);
        var targets = candidates.Where(p => paths.ContainsKey(p.Key)).SelectMany(p => p.Value.Descriptor.Records.Select(r =>
            new RecordCarrierTarget(r.Id, r.DisplayName, paths[p.Key]))).GroupBy(t => t.Id, StringComparer.Ordinal)
            .Where(g => g.Count() == 1).ToDictionary(g => g.Key, g => g.Single(), StringComparer.Ordinal);
        // A user metadata command repairs only presentations it changes. Periodic reconciliation
        // may inspect all explicit carriers; an unrelated bad source cannot block a schema command.
        HashSet<string>? renamedRecords = null; var renamedOptions = false;
        if (mainNoteId is not null)
        {
            var prior = basis.Notes.GetValueOrDefault(mainNoteId)?.CurrentRecords;
            renamedRecords = (mainDescriptor?.Records ?? []).Where(r => prior?.Records.Any(old => old.Id == r.Id && old.DisplayName != r.DisplayName) == true)
                .Select(r => r.Id).ToHashSet(StringComparer.Ordinal);
            renamedOptions = (mainDescriptor?.Fields ?? []).Any(f => (f.Options ?? []).Any(option =>
                prior?.Fields.SingleOrDefault(old => old.Id == f.Id)?.Options?.Any(old => old.Id == option.Id && old.DisplayName == option.DisplayName) != true));
        }
        var sources = new Dictionary<string, string>(StringComparer.Ordinal); var issues = new List<MarkdownScanIssue>();
        foreach (var (id, candidate) in candidates)
        {
            var values = basis.Definitions.Values.Where(d => d.NoteId == id && d.FieldOrigin is not null)
                .ToDictionary(d => (d.FieldOrigin!.RecordId, d.FieldOrigin.FieldId), d => d.Value);
            RecordCarrierRewrite repaired;
            try { repaired = RecordCarrierRefresh.Rewrite(candidate.Source, candidate.Descriptor, paths.GetValueOrDefault(id, ""), targets, values,
                refreshOptions: mainNoteId is null || id == mainNoteId && renamedOptions, recordTargets: renamedRecords); }
            catch (ArgumentException error) { issues.Add(new(paths.GetValueOrDefault(id, ""), "record-carrier-invalid", error.Message, id)); continue; }
            issues.AddRange(repaired.Problems.Select(p => new MarkdownScanIssue(paths.GetValueOrDefault(id, ""), p.Code, p.Message, id)));
            if (repaired.Source == candidate.Source) continue;
            if (basis.Notes.TryGetValue(id, out var old) && (old.IsSourceStale || knowledge.GetDraft(id) is not null))
            {
                issues.Add(new(paths.GetValueOrDefault(id, ""), "record-carrier-draft", "來源有草稿或未接受內容，保留原文；選項文字／關聯連結等待來源核對後同步。", id));
                continue;
            }
            sources[id] = repaired.Source;
        }
        return new(sources, issues);
    }
    private async Task<OperationResult> Execute(string kind, string collectionId, string recordId, string fieldId, object request, string operation,
        Func<string, Task<Receipt>> action)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { kind, collectionId, recordId, fieldId, request }))));
        if (knowledge.GetReceipt(operation) is { } previous) return previous.Fingerprint == hash ? Result(previous)
            : new(operation, "rejected", knowledge.Current.Revision, Message: "Operation ID 已被不同內容使用。");
        try { _ = CanonicalId(operation); return Result(await action(hash)); }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or KeyNotFoundException or YamlDotNet.Core.YamlException)
        { return new(operation, "invalid", knowledge.Current.Revision, Message: error.Message); }
        catch (IOException error) { return new(operation, "conflict", knowledge.Current.Revision, Message: error.Message); }
    }
    private Owner Find(string collectionId)
    {
        var found = Owners().Where(o => o.Metadata.CollectionId == collectionId).ToArray();
        if (found.Length != 1) throw new InvalidOperationException("Collection 不存在或分散於多個來源，請先核對 metadata。");
        return found[0];
    }
    private Owner[] Owners(Snapshot? snapshot = null)
    {
        var notes = (snapshot ?? knowledge.Current).Notes;
        return repository.LoadSourceFiles().Where(f => f.Exists).SelectMany(f => MarkdownEnvelopeCodec.Read(f.Text).Metadata?.Notes ?? [])
            .Where(n => n.Records is not null && notes.TryGetValue(n.Id, out var note) && note.CurrentRecords is not null)
            .Select(n => new Owner(notes[n.Id], n.Records!)).ToArray();
    }
    private static FieldSchema Schema(RecordFieldSchemaDto field, string operation, string label)
    {
        if (!Enum.TryParse<RecordFieldKind>(field.Kind, false, out var kind) || !Enum.IsDefined(kind) || kind.ToString() != field.Kind)
            throw new ArgumentException("不支援的欄位型別：" + field.Kind);
        return new(string.IsNullOrEmpty(field.Id) ? StableId(operation, label) : CanonicalId(field.Id), field.Key, field.DisplayName, kind,
            field.Options?.Select((option, i) => new FieldOption(string.IsNullOrEmpty(option.Id) ? StableId(operation, label + "-option-" + i) : CanonicalId(option.Id), option.DisplayName)).ToArray());
    }
    private static RecordDescriptor NewRecord(string operation, string key, string name, IReadOnlyList<FieldSchema> fields)
        => new(StableId(operation, "record"), key, name, fields.Select(f => new FieldLocator(f.Id, StableId(operation, "locator-" + f.Id))).ToArray());
    private static string RecordBody(RecordDescriptor record, IReadOnlyList<FieldSchema> schema)
        => "### " + Heading(record.DisplayName) + "\n\n" + string.Join("\n\n", record.Fields.Select(f => FieldBody(f, schema.Single(s => s.Id == f.FieldId)))) + "\n";
    private static string FieldBody(FieldLocator locator, FieldSchema field)
        => "#### " + Heading(field.DisplayName) + "\n" + VerticalRecordCodec.SerializeCarrier(locator, new("", true)).Source;
    private static string Heading(string value) => value.Replace('\r', ' ').Replace('\n', ' ');
    private static string StableId(string operation, string label) => new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalId(operation) + "\0" + label)).AsSpan(0, 16)).ToString("N");
    private static string CanonicalId(string value) => Guid.TryParse(value, out var id) && id != Guid.Empty ? id.ToString("N") : throw new ArgumentException("身分或 Operation ID 必須是有效 UUID。");
    private static void Validate(RecordsMetadata metadata)
    {
        var result = RecordsMetadataCodec.Read(RecordsMetadataCodec.Write(metadata));
        if (!result.Success) throw new ArgumentException(string.Join("; ", result.Issues.Select(i => i.Message)));
    }
    private static RecordFieldSchemaDto SchemaDto(FieldSchema f) => new(f.Id, f.Key, f.DisplayName, f.Kind.ToString(), f.Options?.Select(o => new RecordOptionDto(o.Id, o.DisplayName)).ToArray());
    private static DiagnosticDto Diagnostic(RecordDiagnostic d) => new(d.Code, d.Message, d.Span.Start, d.Span.Length);
    private static OperationResult Result(Receipt r) => new(r.OperationId, r.Status, r.Revision, r.NoteId, r.Message,
        r.Diagnostics?.Select(d => new DiagnosticDto(d.Code, d.Message, d.Span.Start, d.Span.Length)).ToArray(), r.AffectedNoteIds);
    private static RecordTypedValueDto Typed(RecordValue value) => value switch {
        NullRecordValue => new("Null", true), MarkdownRecordValue v => new("Markdown", false, Text: v.Markdown),
        NumberRecordValue v => new("Number", false, Coefficient: v.Coefficient.ToString(CultureInfo.InvariantCulture), Scale: v.Scale),
        BooleanRecordValue v => new("Boolean", false, Boolean: v.Value), DateRecordValue v => new("Date", false, Date: v.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        SelectRecordValue v => new("Select", false, Ids: v.OptionIds.ToArray()), TagRecordValue v => new("Tag", false, Tags: v.Tags.ToArray()),
        RelationRecordValue v => new("Relation", false, Ids: v.RecordIds.ToArray()), _ => throw new InvalidOperationException("Unknown typed value.") };

    private FieldSourceEdit TypedEdit(Owner owner, FieldSchema schema, RecordTypedValueDto value)
    {
        if (value.IsNull)
        {
            if (value.Kind != "Null") throw new ArgumentException("Null payload 必須明確標記 Kind=Null。");
            return new("", true);
        }
        string source;
        switch (schema.Kind)
        {
            case RecordFieldKind.Markdown when value.Kind == "Markdown": source = value.Text ?? ""; break;
            case RecordFieldKind.Number when value.Kind == "Number":
                if (value.Coefficient is null || value.Coefficient.Length > RecordValueCodec.MaximumNumberDigits + 1
                    || !System.Text.RegularExpressions.Regex.IsMatch(value.Coefficient, @"\A-?[0-9]+\z")
                    || value.Scale is null || Math.Abs((long)value.Scale.Value) > RecordValueCodec.MaximumNumberScale)
                    throw new ArgumentException("數字需為有界精確 coefficient / scale。");
                source = value.Coefficient + (value.Scale == 0 ? "" : "e" + (-(long)value.Scale.Value).ToString(CultureInfo.InvariantCulture)); break;
            case RecordFieldKind.Boolean when value.Kind == "Boolean" && value.Boolean.HasValue: source = value.Boolean.Value ? "true" : "false"; break;
            case RecordFieldKind.Date when value.Kind == "Date" && value.Date is not null: source = value.Date; break;
            case RecordFieldKind.Tag when value.Kind == "Tag" && value.Tags is not null:
                if (value.Tags.Any(t => t.Contains('\r') || t.Contains('\n'))) throw new ArgumentException("Tag 不可含換行。");
                source = string.Join("\n", value.Tags.Select(t => "- " + t)); break;
            case RecordFieldKind.SingleSelect or RecordFieldKind.MultiSelect when value.Kind == "Select" && value.Ids is not null:
                source = string.Join("\n", value.Ids.Select(id => {
                    var option = (schema.Options ?? []).SingleOrDefault(o => o.Id == id) ?? throw new ArgumentException("選項 ID 不存在。");
                    return RecordValueCodec.IdentityCarrier(option.DisplayName, "#" + Uri.EscapeDataString(option.DisplayName), option.Id, false, schema.Kind == RecordFieldKind.MultiSelect);
                })); break;
            case RecordFieldKind.SingleRelation or RecordFieldKind.MultiRelation when value.Kind == "Relation" && value.Ids is not null:
                var owners = Owners(); var registry = repository.LoadSourceFiles(); var ownPath = registry.Single(f => f.NoteIds.Contains(owner.Note.Id)).RelativePath;
                source = string.Join("\n", value.Ids.Select(id => {
                    var target = owners.SingleOrDefault(o => o.Note.CurrentRecords!.Records.Any(r => r.Id == id)) ?? throw new ArgumentException("關聯 Record ID 不存在。");
                    var record = target.Note.CurrentRecords!.Records.Single(r => r.Id == id);
                    var targetPath = registry.Single(f => f.NoteIds.Contains(target.Note.Id)).RelativePath;
                    var link = RecordCarrierRefresh.RelativeLink(ownPath, targetPath);
                    return RecordValueCodec.IdentityCarrier(record.DisplayName, link, record.Id, true, schema.Kind == RecordFieldKind.MultiRelation);
                })); break;
            default: throw new ArgumentException("Typed payload 不符合欄位 schema。");
        }
        var validation = RecordValueCodec.Parse(schema, false, source, new(Owners().SelectMany(o => o.Note.CurrentRecords!.Records.Select(r => r.Id)).ToHashSet(StringComparer.Ordinal)));
        if (!validation.IsValid) throw new ArgumentException(string.Join("; ", validation.Diagnostics.Select(d => d.Message)));
        return new(source);
    }
    private static string? Scalar(YamlMappingNode n, string key) => (n.Children.FirstOrDefault(p => p.Key is YamlScalarNode k && k.Value == key).Value as YamlScalarNode)?.Value;
    private static YamlNode Yaml(string text) { var stream = new YamlStream(); stream.Load(new StringReader(text)); return stream.Documents.Single().RootNode; }
    private static string YamlText(YamlNode node) { using var writer = new StringWriter(CultureInfo.InvariantCulture); new YamlStream(new YamlDocument(node)).Save(writer, false); return writer.ToString(); }
    private static YamlSequenceNode ViewsNode(string? source) => source is null ? new() : Yaml(source) as YamlSequenceNode
        ?? throw new InvalidOperationException("既有 view 使用尚未支援的格式，已保留，不能自動覆寫。");
    private static RecordViewDto[] ReadViews(string? source, RecordsDocumentDescriptor descriptor, List<DiagnosticDto> diagnostics)
    {
        try
        {
            static YamlMappingNode Map(YamlNode node) => node as YamlMappingNode ?? throw new InvalidOperationException("View entries must be mappings.");
            static YamlNode[] Sequence(YamlMappingNode map, string key)
            {
                var value = map.Children.FirstOrDefault(p => p.Key is YamlScalarNode k && k.Value == key).Value;
                return value is YamlSequenceNode seq ? seq.Children.ToArray() : value is null or YamlScalarNode { Value: null or "" } ? []
                    : throw new InvalidOperationException(key + " must be a sequence.");
            }
            static int Number(YamlMappingNode map, string key, int fallback) => Scalar(map, key) is not { } text ? fallback
                : int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : throw new InvalidOperationException(key + " must be an integer.");
            var views = ViewsNode(source).Children.Select(node => {
                var map = Map(node);
                var result = new RecordViewDto(CanonicalId(Scalar(map, "id") ?? ""), Scalar(map, "name") ?? "View",
                    Sequence(map, "columnOrder").Select(n => (n as YamlScalarNode)?.Value ?? throw new InvalidOperationException("Column IDs must be scalars.")).ToArray(),
                    Number(map, "frozenRows", 1), Number(map, "frozenColumns", 1), Scalar(map, "search") ?? "",
                    Sequence(map, "sort").Select(n => { var sort = Map(n); return new RecordSortDto(Scalar(sort, "fieldId") ?? "", Scalar(sort, "descending") == "true"); }).ToArray(),
                    Sequence(map, "filters").Select(n => { var filter = Map(n); return new RecordFilterDto(Scalar(filter, "fieldId") ?? "", Scalar(filter, "operator") ?? "", Scalar(filter, "value") ?? ""); }).ToArray());
                ValidateView(result, descriptor); return result;
            }).ToArray();
            if (views.Select(v => v.Id).Distinct(StringComparer.Ordinal).Count() != views.Length) throw new InvalidOperationException("View IDs are duplicated.");
            return views;
        }
        catch (Exception error) when (error is InvalidOperationException or ArgumentException or YamlDotNet.Core.YamlException)
        { diagnostics.Add(new("view-metadata", "View metadata 保留待核對：" + error.Message)); return []; }
    }
    private static void ValidateView(RecordViewDto view, RecordsDocumentDescriptor descriptor)
    {
        var fields = descriptor.Fields.Select(f => f.Id).ToHashSet(StringComparer.Ordinal);
        if (view.FrozenRows < 0 || view.FrozenRows > 100 || view.FrozenColumns < 0 || view.FrozenColumns > descriptor.Fields.Count
            || view.ColumnOrder.Distinct(StringComparer.Ordinal).Count() != view.ColumnOrder.Length || view.ColumnOrder.Any(id => !fields.Contains(id))
            || (view.Sort ?? []).Any(s => !fields.Contains(s.FieldId)) || (view.Filters ?? []).Any(f => !fields.Contains(f.FieldId)
                || f.Operator is not ("contains" or "equals" or "is-null" or "not-null")))
            throw new ArgumentException("View 的欄位 ID、凍結數量或篩選條件不合法。");
    }
}
