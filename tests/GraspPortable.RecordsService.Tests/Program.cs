using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Markdown;

try
{
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces/RS-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
var assertions = 0;
string Id() => Guid.NewGuid().ToString("N");
void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); assertions++; Console.WriteLine("PASS " + message); }
if (args.Length == 0 || args.Contains("baseline", StringComparer.Ordinal))
{
var fields = Enum.GetValues<RecordFieldKind>().Select(kind => new RecordFieldSchemaDto("", kind.ToString(), kind.ToString(), kind.ToString(),
    kind is RecordFieldKind.SingleSelect or RecordFieldKind.MultiSelect ? [new("", "選項甲"), new("", "選項乙")] : null)).ToArray();
CreateCollectionRequest create = new(Id(), 0, "人物集", "Characters.Triensa", "特莉恩莎", fields);
string collectionId = "", noteId = "", rowId = "", secondId = ""; SaveRecordViewRequest? savedView = null;
using (var repository = new MarkdownWorkspaceRepository(root))
using (var knowledge = new KnowledgeService(repository))
{
    var service = new WorkspaceRecords(repository, knowledge);
    var created = await service.CreateAsync(create);
    Check(created.Status == "committed", "create collection, schema and first record atomically: " + created.Message);
    var collection = service.ListCollections().Single(); collectionId = collection.Id; noteId = collection.NoteId;
    var data = service.Read(collectionId); rowId = data.Rows.Single().Id;
    Check(data.Rows.Single().Key == "Characters.Triensa" && data.Fields.Length == 9 && data.Rows.Single().Cells.All(c => c.IsNull && c.TypedValue?.IsNull == true), "qualified record key and all typed null fields read correctly");
    var added = await service.AddRecordAsync(collectionId, new(Id(), knowledge.Current.Revision, "Characters.Second", "第二角色"));
    Check(added.Status == "committed", "add second record with stable field locators");
    secondId = service.Read(collectionId).Rows.Single(r => r.Id != rowId).Id;
    RecordFieldSchemaDto Field(string kind) => service.Read(collectionId).Fields.Single(f => f.Kind == kind);
    RecordCellDto Cell(string kind) => service.Read(collectionId).Rows.Single(r => r.Id == rowId).Cells.Single(c => c.FieldId == Field(kind).Id);
    async Task Edit(string kind, RecordTypedValueDto? value, string raw = "")
    {
        var conversion = kind == "Markdown" ? service.PreviewFieldConversion(rowId, Field(kind).Id, new(knowledge.Current.Revision, raw)) : null;
        var result = await service.ChangeFieldAsync(rowId, Field(kind).Id, new(Id(), knowledge.Current.Revision, raw, TypedValue: value,
            ConversionToken: conversion?.PreviewToken));
        Check(result.Status == "committed", "typed/source field command " + kind + ": " + result.Message);
    }
    await Edit("Markdown", null, "段落一😀\n\n### 正文標題\n段落二");
    await Edit("Number", new("Number", false, Coefficient: "900719925474099312345", Scale: 2));
    await Edit("Boolean", new("Boolean", false, Boolean: false));
    await Edit("Date", new("Date", false, Date: "2026-10-04"));
    await Edit("SingleSelect", new("Select", false, Ids: [Field("SingleSelect").Options![0].Id]));
    await Edit("MultiSelect", new("Select", false, Ids: Field("MultiSelect").Options!.Select(o => o.Id).ToArray()));
    await Edit("Tag", new("Tag", false, Tags: ["角色", "重要"]));
    await Edit("SingleRelation", new("Relation", false, Ids: [secondId]));
    await Edit("MultiRelation", new("Relation", false, Ids: [rowId, secondId]));
    Check(Cell("Number").TypedValue?.Coefficient == "900719925474099312345" && Cell("Number").TypedValue?.Scale == 2, "number stays exact beyond binary floating point");
    Check(Cell("Boolean").TypedValue?.Boolean == false && !Cell("Boolean").IsNull && Cell("Markdown").RawSource.Contains("\n\n"), "false and multiline values remain distinct from null");
    Check(Cell("SingleRelation").RawSource.Contains("人物集.md") || Cell("SingleRelation").RawSource.Contains("%E4%BA%BA%E7%89%A9%E9%9B%86.md"), "relation carrier uses resolved real Markdown file");
    Check(Cell("MultiRelation").TypedValue!.Ids!.SequenceEqual(new[] { rowId, secondId }), "relation stable IDs survive typed projection");
    var invalidTyped = await service.ChangeFieldAsync(rowId, Field("Number").Id, new(Id(), knowledge.Current.Revision, "", TypedValue: new("Boolean", false, Boolean: true)));
    Check(invalidTyped.Status == "invalid" && Cell("Number").TypedValue?.Coefficient == "900719925474099312345", "mismatched typed payload cannot change schema or value");
    var invalidRelation = await service.ChangeFieldAsync(rowId, Field("SingleRelation").Id, new(Id(), knowledge.Current.Revision, "", TypedValue: new("Relation", false, Ids: [Id()])));
    Check(invalidRelation.Status == "invalid", "unknown relation IDs refused before source mutation");
    await Edit("Number", new("Number", false, Coefficient: "0", Scale: 0));
    await Edit("Markdown", null, "");
    Check(Cell("Number").TypedValue?.Coefficient == "0" && !Cell("Number").IsNull && Cell("Markdown").RawSource == "" && !Cell("Markdown").IsNull, "empty text and zero remain non-null");
    await Edit("Number", new("Null", true));
    Check(Cell("Number").IsNull && Cell("Number").TypedValue?.Kind == "Null", "typed explicit null round-trips");

    var extra = await service.UpsertFieldAsync(collectionId, new(Id(), knowledge.Current.Revision, new("", "Extra", "補充", "Markdown")));
    Check(extra.Status == "committed" && service.Read(collectionId).Rows.All(r => r.Cells.Length == 10), "new field inserts an unambiguous carrier for every record");
    var badKey = await service.UpsertFieldAsync(collectionId, new(Id(), knowledge.Current.Revision, new("", "Bad.Key", "bad", "Markdown")));
    Check(badKey.Status == "invalid", "FieldKey stays single-segment while RecordKey allows namespace");
    var oldDefinitionId = knowledge.Current.Definitions.Values.Single(d => d.Name == "Characters.Triensa.Markdown").Id;
    var reader = await knowledge.CreateNoteAsync(Id(), "Reader", "[](:ref:Characters.Triensa.Markdown)");
    var notePath = Path.Combine(root, repository.LoadSourceFiles().Single(f => f.NoteIds.Contains(noteId)).RelativePath);
    var before = File.ReadAllBytes(notePath);
    var rename = new RenameRecordRequest(Id(), knowledge.Current.Revision, "Characters.Renamed", "新顯示名");
    Check((await service.RenameRecordAsync(collectionId, rowId, rename)).Status == "confirmation-required" && before.SequenceEqual(File.ReadAllBytes(notePath)), "rename preview does not write schema or body");
    var renamed = await service.RenameRecordAsync(collectionId, rowId, rename with { ConfirmRename = true });
    Check(renamed.Status == "committed" && knowledge.Current.Definitions.Values.Single(d => d.Name == "Characters.Renamed.Markdown").Id == oldDefinitionId
        && knowledge.Current.Notes[reader.NoteId!].Source.Contains("Characters.Renamed.Markdown"), "confirmed rename preserves IDs and updates references atomically");
    Check((await service.RenameRecordAsync(collectionId, rowId, rename)).Revision == renamed.Revision, "same rename operation retries after state changes without regeneration");
    var collision = await service.RenameRecordAsync(collectionId, rowId, new(Id(), knowledge.Current.Revision, "Characters.Second", "collision", true));
    Check(collision.Status == "invalid" && service.Read(collectionId).Rows.Single(r => r.Id == rowId).Key == "Characters.Renamed", "namespace collision leaves body and schema unchanged");

    var selectField = Field("SingleSelect");
    var selectRequest = new RecordFieldChangeRequest(Id(), knowledge.Current.Revision, "", TypedValue: new("Select", false, Ids: [selectField.Options![0].Id]));
    var selectReceipt = await service.ChangeFieldAsync(rowId, selectField.Id, selectRequest);
    var renamedField = selectField with { Key = "Chosen", DisplayName = "選擇", Options = selectField.Options.Select(o => o with { DisplayName = o.DisplayName + "新" }).ToArray() };
    var schemaRename = new UpsertRecordFieldRequest(Id(), knowledge.Current.Revision, renamedField);
    Check((await service.UpsertFieldAsync(collectionId, schemaRename)).Status == "confirmation-required", "schema key change previews generated property rename");
    Check((await service.UpsertFieldAsync(collectionId, schemaRename with { ConfirmRename = true })).Status == "committed", "schema key/name/options edit commits without changing field identity");
    var preservedField = service.Read(collectionId).Fields.Single(f => f.Id == selectField.Id);
    Check(preservedField.Key == "Chosen" && preservedField.Options!.Select(o => o.Id).SequenceEqual(selectField.Options.Select(o => o.Id)), "field and option stable IDs survive schema edits");
    Check((await service.ChangeFieldAsync(rowId, selectField.Id, selectRequest)).Revision == selectReceipt.Revision, "typed receipt retry ignores later option label/source changes");

    var revision = knowledge.Current.Notes[noteId].Revision;
    var visibleFields = service.Read(collectionId).Fields.Take(3).Select(f => f.Id).ToArray();
    savedView = new(Id(), knowledge.Current.Revision, new("", "工作檢視", visibleFields, 0, 2, "角色", [new(visibleFields[1], true)], [new(visibleFields[0], "not-null")]));
    var saved = await service.SaveViewAsync(collectionId, savedView);
    Check(saved.Status == "committed" && knowledge.Current.Notes[noteId].Revision > revision, "view-only transaction advances note revision and receipt");
    var view = service.Read(collectionId).Views.Single();
    Check(view.ColumnOrder.SequenceEqual(visibleFields) && view.FrozenRows == 0 && view.FrozenColumns == 2 && view.Filters![0].Operator == "not-null", "view settings and hidden column subset round-trip");
    Check((await service.SaveViewAsync(collectionId, savedView)).Revision == saved.Revision, "view operation retry returns original receipt");
    Check((await service.SaveViewAsync(collectionId, savedView with { View = view with { Name = "different" } })).Status == "rejected", "operation ID rejects changed immutable payload");
    var unsafeView = await service.SaveViewAsync(collectionId, new(Id(), knowledge.Current.Revision, view with { ColumnOrder = [Id()] }));
    Check(unsafeView.Status == "invalid", "view rejects unknown field IDs");
    Check((await service.AddRecordAsync(collectionId, new(Id(), 0, "Old", "stale"))).Status == "conflict", "stale knowledge revision blocks metadata and body mutation");
    Check((await service.CreateAsync(create)).NoteId == noteId && service.ListCollections().Length == 1, "create retry after later commands cannot duplicate collection");
    var current = knowledge.Current.Notes[noteId];
    await knowledge.SaveDraftAsync(new(noteId, "draft", 1, current.Revision, current.Title, current.CurrentSource + "\nlocal draft", current.CurrentSourceHash));
    Check((await service.AddRecordAsync(collectionId, new(Id(), knowledge.Current.Revision, "Dirty", "dirty"))).Status == "conflict", "dirty source prevents record metadata mutation");
    Check(knowledge.GetDraft(noteId)?.Source.EndsWith("local draft", StringComparison.Ordinal) == true, "dirty draft survives rejected record command");
}
using (var repository = new MarkdownWorkspaceRepository(root))
using (var knowledge = new KnowledgeService(repository))
{
    var service = new WorkspaceRecords(repository, knowledge); var data = service.Read(collectionId);
    Check(data.Rows.Length == 2 && data.Fields.Length == 10 && data.Views.Single().Name == "工作檢視" && data.HasDraft, "reopen preserves schema/records/views/draft");
    Check((await service.SaveViewAsync(collectionId, savedView!)).Status == "committed", "durable view receipt retries despite a later dirty draft");
    Check(repository.Scan(knowledge.Current).Changes.Count == 0, "saved descriptors settle without spurious external changes");
}
}
if (args.Length == 0 || args.Contains("carriers", StringComparer.Ordinal))
{
    var carrierRoot = Path.Combine(root, "carriers");
    using var repository = new MarkdownWorkspaceRepository(carrierRoot);
    using var knowledge = new KnowledgeService(repository);
    var records = new WorkspaceRecords(repository, knowledge);
    var a = await records.CreateAsync(new(Id(), knowledge.Current.Revision, "A", "Source", "來源", [new("", "Link", "關聯", "SingleRelation")]));
    var b = await records.CreateAsync(new(Id(), knowledge.Current.Revision, "B", "Target", "舊角色名", [new("", "Choice", "選項", "SingleSelect", [new("", "舊選項名")])]));
    Check(a.Status == "committed" && b.Status == "committed", "carrier fixture creates source/target collections");
    var aData = records.Read(a.NoteId!); var bData = records.Read(b.NoteId!);
    Check((await records.ChangeFieldAsync(aData.Rows[0].Id, aData.Fields[0].Id, new(Id(), knowledge.Current.Revision, "", TypedValue: new("Relation", false, Ids: [bData.Rows[0].Id])))).Status == "committed", "relation fixture stores explicit target identity");
    Check((await records.ChangeFieldAsync(bData.Rows[0].Id, bData.Fields[0].Id, new(Id(), knowledge.Current.Revision, "", TypedValue: new("Select", false, Ids: [bData.Fields[0].Options![0].Id])))).Status == "committed", "option fixture stores explicit option identity");
    var reader = await knowledge.CreateNoteAsync(Id(), "Reader", "[](:ref:Target.Choice)\n[](:ref:Source.Link)\nordinary [leave](B.md)");
    var schema = bData.Fields[0] with { Options = [bData.Fields[0].Options![0] with { DisplayName = "新選項名" }] };
    Check((await records.UpsertFieldAsync(b.NoteId!, new(Id(), knowledge.Current.Revision, schema))).Status == "committed", "option display rename commits metadata and original carrier together");
    Check(records.Read(b.NoteId!).Rows[0].Cells[0].RawSource.Contains("[新選項名]")
        && knowledge.Current.Definitions.Values.Single(d => d.Name == "Target.Choice").Value!.Contains("[新選項名]")
        && knowledge.Current.Notes[reader.NoteId!].Syntax.References.Single(r => r.Name == "Target.Choice").CachedValue.Contains("[新選項名]"), "option UI/raw/generated property/reference Reading agree after rename");
    var renameOperation = Id();
    Check((await records.RenameRecordAsync(b.NoteId!, bData.Rows[0].Id, new(renameOperation, knowledge.Current.Revision, "Target", "新角色名"))).Status == "committed", "record display rename updates another source in the same transaction");
    using (var journal = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(carrierRoot, ".grasp", "semantic-operations", renameOperation + ".json"))))
        Check(journal.RootElement.GetProperty("Mutations").GetArrayLength() == 3
            && new GraspPortable.Host.Workspace.FileOperations.RecoverableFileOperations(carrierRoot).Inspect(Guid.Parse(renameOperation)).Phase
                == GraspPortable.Host.Workspace.FileOperations.FileOperationPhase.SemanticFinalized,
            "one finalized journal contains target metadata, relation source and expanded reader updates");
    var aRaw = records.Read(a.NoteId!).Rows[0].Cells[0].RawSource;
    Check(aRaw.Contains("[新角色名]") && aRaw.Contains(bData.Rows[0].Id)
        && knowledge.Current.Notes[reader.NoteId!].Syntax.References.Single(r => r.Name == "Source.Link").CachedValue.Contains("[新角色名]"), "relation raw and expanded Reading preserve identity and new label");
    Check(knowledge.Current.Notes[reader.NoteId!].Source.Contains("ordinary [leave](B.md)"), "unmarked ordinary link remains untouched");
    var current = knowledge.Current.Notes[a.NoteId!];
    await knowledge.SaveDraftAsync(new(current.Id, "local", 1, current.Revision, current.Title, current.Source + "\nlocal", current.CurrentSourceHash));
    Check((await records.RenameRecordAsync(b.NoteId!, bData.Rows[0].Id, new(Id(), knowledge.Current.Revision, "Target", "不能覆蓋草稿"))).Status == "conflict"
        && records.Read(b.NoteId!).Rows[0].DisplayName == "新角色名" && records.Read(a.NoteId!).Rows[0].Cells[0].RawSource == aRaw,
        "dirty relation owner rejects the whole display rename without partial metadata changes");
    Check(knowledge.GetDraft(current.Id)!.Source.EndsWith("local", StringComparison.Ordinal), "carrier refresh retains the exact dirty draft");
}
if (args.Length == 0 || args.Contains("render", StringComparer.Ordinal))
{
    using var repository = new MarkdownWorkspaceRepository(Path.Combine(root, "render"));
    using var knowledge = new KnowledgeService(repository);
    var records = new WorkspaceRecords(repository, knowledge);
    const string value = "第一段😀\r\n\r\n[[Source|來源連結]] [demo](:ref:NeverParsed)";
    var owner = await knowledge.CreateNoteAsync(Id(), "Source", "@code{ @Display = " + LiteralCodec.Serialize(value) + " }");
    var created = await records.CreateAsync(new(Id(), knowledge.Current.Revision, "Render", "Render.Row", "一筆"));
    var data = records.Read(created.NoteId!); var row = data.Rows.Single(); var field = data.Fields.Single();
    var source = "😀前段\r\n#### 欄位內標題\r\n" + ReferenceCodec.Serialize(ReferenceKind.Pure, "Display", "")
        + "\r\n" + ReferenceCodec.Serialize(ReferenceKind.Wiki, "Display", "")
        + "\r\n```json\r\n[demo](:ref:Disabled)\r\n```\r\n@code{ @Local = {local} }";
    var conversion = records.PreviewFieldConversion(row.Id, field.Id, new(knowledge.Current.Revision, source));
    var changed = await records.ChangeFieldAsync(row.Id, field.Id, new(Id(), knowledge.Current.Revision, source, ConversionToken: conversion.PreviewToken));
    Check(changed.Status == "committed", "render fixture commits original Markdown source and dependencies");
    var cell = records.Read(created.NoteId!).Rows.Single().Cells.Single();
    Check(cell.References is { Length: 2 } && cell.References.All(r => r.Name == "Display" && r.OriginNoteId == owner.NoteId && r.CachedValue == value),
        "cell carries both semantic references and their true content origin");
    Check(cell.References!.All(r => cell.RawSource.Substring(r.Start, r.Length) == ReferenceCodec.Serialize(Enum.Parse<ReferenceKind>(r.Kind), r.Name, r.CachedValue)),
        "cell reference UTF-16 ranges address local raw source after carrier indentation removal");
    Check(cell.Regions is { Length: 1 } && cell.RawSource.Substring(cell.Regions[0].Start, cell.Regions[0].Length).StartsWith("@code{"),
        "original definition region retains its source boundaries for rendering");
    Check(!knowledge.Current.Definitions.Values.Any(d => d.Name is "NeverParsed" or "Disabled") && cell.References!.All(r => r.Name != "NeverParsed"),
        "disabled fences and evaluated reference-looking text do not acquire semantic metadata");
    var display = knowledge.Current.Definitions.Values.Single(d => d.Name == "Display");
    Check((await knowledge.ChangeLiteralAsync(Id(), display.Id, knowledge.Current.Revision, "更新\n\n值")).Status == "committed"
        && records.Read(created.NoteId!).Rows.Single().Cells.Single().References!.All(r => r.CachedValue == "更新\n\n值"),
        "subsequent source update refreshes cell render references without changing their targets");
}
if (args.Length == 0 || args.Contains("tags", StringComparer.Ordinal))
{
    using var repository = new MarkdownWorkspaceRepository(Path.Combine(root, "tags"));
    using var knowledge = new KnowledgeService(repository);
    var records = new WorkspaceRecords(repository, knowledge);
    var source = await knowledge.CreateNoteAsync(Id(), "TagSource", "@code{ @SharedTags = {- 角色\n- Shared} }");
    var ids = new List<string>();
    for (var i = 0; i < 2; i++)
    {
        var result = await records.CreateAsync(new(Id(), knowledge.Current.Revision, "Tag table " + i, "TagRow" + i, "Record " + i,
            [new("", "Tags", "標籤", "Tag"), new("", "Text", "文字", "Markdown")]));
        Check(result.Status == "committed", "tag search collection setup");
        ids.Add(result.NoteId!);
        var data = records.Read(result.NoteId!);
        var changed = await records.ChangeFieldAsync(data.Rows[0].Id, data.Fields[0].Id,
            new(Id(), knowledge.Current.Revision, ReferenceCodec.Serialize(ReferenceKind.Pure, "SharedTags", "")));
        Check(changed.Status == "committed", "tag values derive from computed Markdown");
    }
    var hits = records.SearchTags("shared", 0, 1);
    Check(hits.Total == 2 && hits.Items.Length == 1 && hits.Revision == knowledge.Current.Revision
        && hits.Items[0].Tags.SequenceEqual(new[] { "Shared" }), "workspace tag search finds computed values across collections with bounded payload");
    var next = records.SearchTags("shared", 1, 1);
    Check(next.Total == 2 && next.Items.Single().RecordId != hits.Items[0].RecordId, "tag pagination retains stable record identities without duplicates");
    Check(records.SearchTags("角色").Total == 2 && records.SearchTags("Record").Total == 0,
        "tag search supports Chinese but does not match unrelated record titles");
    var edited = knowledge.Current.Notes[ids[0]];
    await knowledge.SaveDraftAsync(new(edited.Id, "tags-draft", 1, edited.Revision, edited.Title, edited.CurrentSource + "\n草稿", edited.CurrentSourceHash));
    Check(records.SearchTags("shared").Items.Single(i => i.NoteId == edited.Id).HasDraft,
        "tag hits disclose durable draft while reading accepted values");
    // Dirty ownership blocks source propagation, so use the other collection to test invalid raw preservation.
    var other = records.Read(ids[1]);
    Check((await records.ChangeFieldAsync(other.Rows[0].Id, other.Fields[0].Id,
        new(Id(), knowledge.Current.Revision, "not a tag list"))).Status == "committed", "invalid tag source is retained with diagnostics");
    Check(records.SearchTags("shared").Total == 1 && records.SearchTags("not a tag").Total == 0,
        "invalid values are not searched as accepted tags");
    await knowledge.MarkSourceUnavailableAsync(Id(), new Dictionary<string, string> { [edited.Id] = "test unavailable source" });
    Check(records.SearchTags("shared") is { Total: 0, UnavailableCollections: 1 },
        "unavailable source cannot publish last-good tags as current matches");
    Check(records.SearchTags("", -1, 1000) is { Offset: 0, Limit: 100 }, "tag paging clamps untrusted bounds");
    using var canceled = new CancellationTokenSource(); canceled.Cancel();
    try { records.SearchTags("", token: canceled.Token); throw new InvalidOperationException("tag cancellation ignored"); }
    catch (OperationCanceledException) { Check(true, "tag queries honor cancellation"); }
}
if (args.Length == 0 || args.Contains("conversion", StringComparer.Ordinal))
{
    var conversionRoot = Path.Combine(root, "conversion");
    string collection, record, fieldId, notePath, originalId;
    RecordFieldChangeRequest confirmed;
    long committedRevision;
    const string original = "# [[Wiki|標題]]\r\n第一段😀\r\n\r\n第二段\r\n## 中層\r\n![圖](assets/p.png)\r\n### 深層\r\n```json\r\n# literal H1\r\n```\r\n[[Wiki|別名]]\r\n";
    using (var repository = new MarkdownWorkspaceRepository(conversionRoot))
    using (var knowledge = new KnowledgeService(repository))
    {
        var records = new WorkspaceRecords(repository, knowledge);
        var created = await records.CreateAsync(new(Id(), 0, "Conversion", "Converted.Row", "一筆"));
        collection = created.NoteId!;
        var data = records.Read(collection); record = data.Rows.Single().Id; fieldId = data.Fields.Single().Id;
        originalId = knowledge.Current.Definitions.Values.Single(d => d.Name == "Converted.Row.Description").Id;
        notePath = Path.Combine(conversionRoot, repository.LoadSourceFiles().Single(f => f.NoteIds.Contains(collection)).RelativePath);
        var before = File.ReadAllBytes(notePath); var revision = knowledge.Current.Revision;
        var preview = records.PreviewFieldConversion(record, fieldId, new(revision, original));
        Check(preview is { CanApply: true, RequiresConfirmation: true, Layout: "NestedList", PreviewToken: not null }
            && preview.Mapping.Select(m => m.ListDepth).SequenceEqual(new[] { 0, 1, 2 }), "three heading levels preview an explicit hierarchy-preserving nested conversion");
        Check(before.SequenceEqual(File.ReadAllBytes(notePath)) && knowledge.Current.Revision == revision,
            "conversion preview writes no source, metadata, history or revision");
        var protectedLiteral = "@code{ @LongValue = {\n# literal heading\n} }";
        Check(records.PreviewFieldConversion(record, fieldId, new(revision, protectedLiteral)) is { CanApply: true, RequiresConfirmation: false },
            "headings inside a Grasp literal are not mistaken for structural Markdown");
        var unsafeLiteral = records.PreviewFieldConversion(record, fieldId, new(revision, original + protectedLiteral));
        Check(!unsafeLiteral.CanApply && unsafeLiteral.Diagnostics.Any(d => d.Code == "conversion-grasp-indent"),
            "nested conversion refuses to silently change multiline literal whitespace");
        Check((await records.ChangeFieldAsync(record, fieldId, new(Id(), revision, original))).Status == "conversion-required"
            && before.SequenceEqual(File.ReadAllBytes(notePath)), "unconfirmed heading conversion does not mutate data");
        Check((await records.ChangeFieldAsync(record, fieldId, new(Id(), revision, original + "changed", ConversionToken: preview.PreviewToken))).Status == "conflict",
            "token cannot confirm different original input");
        confirmed = new(Id(), revision, original, ConversionToken: preview.PreviewToken);
        var saved = await records.ChangeFieldAsync(record, fieldId, confirmed); committedRevision = saved.Revision;
        Check(saved.Status == "committed", "confirmed conversion commits source plus descriptor and history: " + saved.Message);
        var cell = records.Read(collection).Rows.Single().Cells.Single();
        Check(cell.RawSource == preview.ConvertedSource && cell.RawSource.Contains("- [[Wiki|標題]]")
            && cell.RawSource.Contains("![圖](assets/p.png)") && cell.RawSource.Contains("# literal H1") && cell.RawSource.Contains("\r\n\r\n"),
            "paragraphs, CRLF, image, Wiki and fenced H1 survive as Markdown");
        var envelope = MarkdownEnvelopeCodec.Read(File.ReadAllText(notePath));
        var metadata = envelope.Metadata!.Notes.Single().Records!;
        Check(metadata.Descriptor.Records.Single().Fields.Single() is { Layout: FieldLayout.NestedList, Indent: 2 }
            && metadata.ConversionHistoryYaml!.Contains(Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(original))),
            "physical Markdown archives exact original bytes and updates locator layout atomically");
        Check(knowledge.Current.Definitions.Values.Single(d => d.Name == "Converted.Row.Description").Id == originalId,
            "conversion preserves generated definition identity");
        Check(!records.PreviewFieldConversion(record, fieldId, new(saved.Revision, cell.RawSource)).RequiresConfirmation,
            "already converted nested Markdown is not converted again");
        var historyBefore = metadata.ConversionHistoryYaml;
        var ordinary = await records.ChangeFieldAsync(record, fieldId, new(Id(), saved.Revision, cell.RawSource + "\r\n尾段"));
        Check(ordinary.Status == "committed" && MarkdownEnvelopeCodec.Read(File.ReadAllText(notePath)).Metadata!.Notes.Single().Records!.ConversionHistoryYaml == historyBefore,
            "ordinary later edit preserves history without appending another snapshot");
        Check((await records.ChangeFieldAsync(record, fieldId, confirmed)).Revision == committedRevision,
            "same confirmed operation retries by receipt after later edits without reconversion");
        Check((await records.ChangeFieldAsync(record, fieldId, confirmed with { OperationId = Id() })).Status == "conflict",
            "old conversion revision is refused for a new operation");
        var current = knowledge.Current.Notes[collection];
        await knowledge.SaveDraftAsync(new(collection, "conversion-draft", 1, current.Revision, current.Title, current.Source + "draft", current.CurrentSourceHash));
        Check(!records.PreviewFieldConversion(record, fieldId, new(knowledge.Current.Revision, original)).CanApply,
            "dirty source blocks conversion without replacing its draft");
    }
    using (var repository = new MarkdownWorkspaceRepository(conversionRoot))
    using (var knowledge = new KnowledgeService(repository))
    {
        var records = new WorkspaceRecords(repository, knowledge);
        Check((await records.ChangeFieldAsync(record, fieldId, confirmed)).Revision == committedRevision
            && MarkdownEnvelopeCodec.Read(File.ReadAllText(notePath)).Metadata!.Notes.Single().Records!.ConversionHistoryYaml!.Contains("originalSourceUtf8Base64"),
            "receipt and recovery history survive restart even with a later draft");
    }
    var interruptedRoot = Path.Combine(root, "conversion-interrupted");
    string interruptedNote, interruptedRecord, interruptedField;
    RecordFieldChangeRequest interruptedRequest;
    using (var repository = new MarkdownWorkspaceRepository(interruptedRoot))
    using (var knowledge = new KnowledgeService(repository))
    {
        var records = new WorkspaceRecords(repository, knowledge);
        var created = await records.CreateAsync(new(Id(), 0, "Interrupted", "Interrupted.Row", "一筆"));
        interruptedNote = created.NoteId!;
        var data = records.Read(interruptedNote); interruptedRecord = data.Rows.Single().Id; interruptedField = data.Fields.Single().Id;
        var preview = records.PreviewFieldConversion(interruptedRecord, interruptedField, new(knowledge.Current.Revision, original));
        interruptedRequest = new(Id(), knowledge.Current.Revision, original, ConversionToken: preview.PreviewToken);
        repository.AfterFilesWrittenForTest = () => throw new IOException("simulated stop between file and database commit");
        var result = await records.ChangeFieldAsync(interruptedRecord, interruptedField, interruptedRequest);
        Check(result.Status == "conflict" && repository.IsWriteBlocked, "interrupted converted write exposes pending recovery rather than false success");
    }
    using (var repository = new MarkdownWorkspaceRepository(interruptedRoot))
    using (var knowledge = new KnowledgeService(repository))
    {
        var records = new WorkspaceRecords(repository, knowledge);
        var result = await records.ChangeFieldAsync(interruptedRecord, interruptedField, interruptedRequest);
        var file = repository.LoadSourceFiles().Single(f => f.NoteIds.Contains(interruptedNote));
        var metadata = MarkdownEnvelopeCodec.Read(file.Text).Metadata!.Notes.Single().Records!;
        Check(result.Status == "committed" && metadata.Descriptor.Records.Single().Fields.Single().Layout == FieldLayout.NestedList
            && metadata.ConversionHistoryYaml!.Split("operationId:", StringSplitOptions.None).Length == 2
            && records.Read(interruptedNote).Rows.Single().Cells.Single().RawSource.Contains("- [[Wiki|標題]]"),
            "restart finalizes source, locator, one immutable history and receipt from the same journal");
    }
}
if (args.Length == 0 || args.Contains("conversion-references", StringComparer.Ordinal))
{
    var targetRoot = Path.Combine(root, "conversion-references"); string collection;
    bool ValidLocalReference(RecordCellDto cell, string expected) => cell.References is { Length: 1 }
        && cell.References[0].Name == "Short" && cell.References[0].CachedValue == expected
        && cell.RawSource.Substring(cell.References[0].Start, cell.References[0].Length) == $"[{expected}](:ref:Short)";
    using (var repository = new MarkdownWorkspaceRepository(targetRoot))
    using (var knowledge = new KnowledgeService(repository))
    {
        var records = new WorkspaceRecords(repository, knowledge);
        await knowledge.CreateNoteAsync(Id(), "Source", "@code{ @Short = {short} }");
        var created = await records.CreateAsync(new(Id(), knowledge.Current.Revision, "Nested", "Nested.Row", "一筆")); collection = created.NoteId!;
        var data = records.Read(collection); var row = data.Rows.Single(); var field = data.Fields.Single();
        const string raw = "# A\r\n## B\r\n### C\r\n😀原文\r\n[short](:ref:Short)\r\n\r\n```json\r\n[hidden](:ref:Hidden)\r\n```\r\n\r\n    [indented](:ref:Indented)\r\n";
        var preview = records.PreviewFieldConversion(row.Id, field.Id, new(knowledge.Current.Revision, raw));
        var changed = await records.ChangeFieldAsync(row.Id, field.Id, new(Id(), knowledge.Current.Revision, raw, ConversionToken: preview.PreviewToken));
        Check(changed.Status == "committed" && ValidLocalReference(records.Read(collection).Rows.Single().Cells.Single(), "short"),
            "converted nested-list reference remains semantic with exact local UTF-16 ranges; json/indented examples stay opaque");
        var notePath = Path.Combine(targetRoot, repository.LoadSourceFiles().Single(f => f.NoteIds.Contains(collection)).RelativePath);
        File.WriteAllText(notePath, File.ReadAllText(notePath).Replace("😀原文", "😀外部修改增加文字", StringComparison.Ordinal));
        var scan = repository.Scan(knowledge.Current); var operation = Id();
        using (repository.BeginObservation(operation, scan.States))
            Check(scan.Issues.Count == 0 && (await knowledge.ObserveExternalAsync(operation, scan.Changes)).Status == "source-observed",
                "external nested-list source edit is accepted by the same parser");
        Check(ValidLocalReference(records.Read(collection).Rows.Single().Cells.Single(), "short"),
            "external text before reference refreshes source ranges without losing reference identity");
        var definition = knowledge.Current.Definitions.Values.Single(d => d.Name == "Short");
        var updated = await knowledge.ChangeLiteralAsync(Id(), definition.Id, knowledge.Current.Revision, "updated");
        Check(updated.Status == "committed" && ValidLocalReference(records.Read(collection).Rows.Single().Cells.Single(), "updated"),
            "source value update patches nested-list cache through carrier source mapping");
        var longOwner = await knowledge.CreateNoteAsync(Id(), "Long source", "@code{ @Long = " + LiteralCodec.Serialize("first\r\n\r\nsecond") + " }");
        var multiRaw = "# A\r\n## B\r\n### C\r\n" + ReferenceCodec.Serialize(ReferenceKind.Pure, "Long", "first\r\n\r\nsecond")
            + "\r\n\r\n" + ReferenceCodec.Serialize(ReferenceKind.Wiki, "Long", "first\r\n\r\nsecond");
        var multiPreview = records.PreviewFieldConversion(row.Id, field.Id, new(knowledge.Current.Revision, multiRaw));
        var multiSaved = await records.ChangeFieldAsync(row.Id, field.Id, new(Id(), knowledge.Current.Revision, multiRaw, ConversionToken: multiPreview.PreviewToken));
        var multiCell = records.Read(collection).Rows.Single().Cells.Single();
        Check(multiSaved.Status == "committed" && multiCell.References is { Length: 2 }
            && multiCell.References.All(r => r.Name == "Long" && r.OriginNoteId == longOwner.NoteId && r.CachedValue == "first\r\n\r\nsecond"
                && multiCell.RawSource.Substring(r.Start, r.Length) == ReferenceCodec.Serialize(Enum.Parse<ReferenceKind>(r.Kind), "Long", r.CachedValue))
            && multiCell.ComputedMarkdown!.Split("first\r\n      \r\n      second", StringSplitOptions.None).Length == 3,
            "both multiline reference forms retain exact values, source spans and navigation metadata after nested conversion");
        // Return to the single-ref sample so the reopen assertion below remains focused.
        var singlePreview = records.PreviewFieldConversion(row.Id, field.Id, new(knowledge.Current.Revision, raw.Replace("[short]", "[updated]", StringComparison.Ordinal)));
        await records.ChangeFieldAsync(row.Id, field.Id, new(Id(), knowledge.Current.Revision, raw.Replace("[short]", "[updated]", StringComparison.Ordinal), ConversionToken: singlePreview.PreviewToken));
    }
    using (var repository = new MarkdownWorkspaceRepository(targetRoot))
    using (var knowledge = new KnowledgeService(repository))
        Check(ValidLocalReference(new WorkspaceRecords(repository, knowledge).Read(collection).Rows.Single().Cells.Single(), "updated"),
            "reopened nested field retains managed reference and opaque code contexts");
}
if (args.Length == 0 || args.Contains("parser-rebuild", StringComparer.Ordinal))
{
    var targetRoot = Path.Combine(root, "parser-rebuild"); string collection; Draft preservedDraft;
    using (var repository = new MarkdownWorkspaceRepository(targetRoot))
    using (var knowledge = new KnowledgeService(repository))
    {
        await knowledge.CreateNoteAsync(Id(), "Source", "@code{ @RebuildValue = {new} }");
        var records = new WorkspaceRecords(repository, knowledge);
        var created = await records.CreateAsync(new(Id(), knowledge.Current.Revision, "Rebuild", "Rebuild.Row", "一筆")); collection = created.NoteId!;
        var data = records.Read(collection);
        await records.ChangeFieldAsync(data.Rows[0].Id, data.Fields[0].Id,
            new(Id(), knowledge.Current.Revision, "- A\n  - B\n    - C\n      [new](:ref:RebuildValue)"));
        var other = await knowledge.CreateNoteAsync(Id(), "Unrelated draft", "accepted body");
        var draftNote = knowledge.Current.Notes[other.NoteId!];
        preservedDraft = new(draftNote.Id, "durable-rename-draft", 1, draftNote.Revision, draftNote.Title,
            "@code{ @UserUnconfirmedRename = {untouched} }", draftNote.CurrentSourceHash);
        await knowledge.SaveDraftAsync(preservedDraft);
        // Simulate an old persisted engine snapshot, not a product migration or a private workspace edit.
        var prior = knowledge.Current; var nextRevision = prior.Revision + 1;
        var note = prior.Notes[collection]; var oldSource = note.Source.Replace("[new]", "[old]", StringComparison.Ordinal);
        var field = VerticalRecordCodec.Parse(oldSource, note.Records!).Fields.Single();
        var badSyntax = note.Syntax with { References = [], Definitions = note.Syntax.Definitions.Select(d =>
            d.FieldOrigin is null ? d : d with { Parts = [new(PartKind.Literal, field.RawSource, field.BodySpan)] }).ToArray() };
        var notes = prior.Notes.ToDictionary(p => p.Key, p => p.Value);
        notes[collection] = note with { Source = oldSource, Syntax = badSyntax, Revision = nextRevision };
        var definitions = prior.Definitions.ToDictionary(p => p.Key, p => p.Value);
        foreach (var definition in definitions.Values.Where(d => d.NoteId == collection).ToArray())
            definitions[definition.Id] = definition with { Value = field.RawSource };
        repository.Commit(prior, prior with { Revision = nextRevision, Notes = notes, Definitions = definitions },
            new(Id(), "synthetic-old-parser", "committed", nextRevision, collection), null);
    }
    using (var repository = new MarkdownWorkspaceRepository(targetRoot))
    using (var knowledge = new KnowledgeService(repository))
    {
        Check(knowledge.Current.Notes[collection].Syntax.References.Count == 0 && knowledge.GetDraft(preservedDraft.NoteId) == preservedDraft,
            "synthetic old syntax and unrelated durable draft survive ordinary Host reopen");
        var impact = knowledge.PolicyImpact(knowledge.Current.Languages);
        Check(impact.NoteIds.Contains(collection), "same-allowlist impact identifies an old parser's missed nested reference");
        var result = await knowledge.ChangePolicyAsync(Id(), knowledge.Current.Revision, knowledge.Current.Languages);
        var cell = new WorkspaceRecords(repository, knowledge).Read(collection).Rows.Single().Cells.Single();
        Check(result.Status == "committed" && knowledge.Current.Notes[collection].Syntax.References.Count == 1
            && cell.References is { Length: 1 } && cell.References[0].CachedValue == "new" && !cell.RawSource.Contains("[old]"),
            "same allowlist safely rebuilds persisted syntax, dependency calculation and cached field source");
        Check(knowledge.GetDraft(preservedDraft.NoteId) == preservedDraft
            && knowledge.Current.Notes[preservedDraft.NoteId].Source == "accepted body",
            "rebuild neither consumes nor overwrites another note's durable rename draft");
    }
    using (var repository = new MarkdownWorkspaceRepository(targetRoot))
    using (var knowledge = new KnowledgeService(repository))
        Check(knowledge.GetDraft(preservedDraft.NoteId) == preservedDraft && knowledge.Current.Notes[collection].Syntax.References.Count == 1,
            "rebuilt index and untouched unrelated draft remain durable after second reopen");
}
if (args.Length == 0 || args.Contains("markdown-continuation", StringComparer.Ordinal))
{
    var targetRoot = Path.Combine(root, "markdown-continuation"); string collection, readerId;
    const string value = "**bold**\r\n\r\nsecond paragraph";
    const string updatedValue = "**new bold**\r\n\r\nnew paragraph";
    string Expected(string input) => "- A\n  - B\n    - C\n      " + input.Replace("\r\n", "\r\n      ", StringComparison.Ordinal)
        + "\n\n      " + input.Replace("\r\n", "\r\n      ", StringComparison.Ordinal);
    using (var repository = new MarkdownWorkspaceRepository(targetRoot))
    using (var knowledge = new KnowledgeService(repository))
    {
        await knowledge.CreateNoteAsync(Id(), "Paragraphs", "@code{ @Paragraphs = " + LiteralCodec.Serialize(value) + " @PlainComposition = Paragraphs + Paragraphs }");
        var records = new WorkspaceRecords(repository, knowledge);
        var created = await records.CreateAsync(new(Id(), knowledge.Current.Revision, "Projection", "Projection.Row", "一筆")); collection = created.NoteId!;
        var data = records.Read(collection);
        var raw = "# A\n## B\n### C\n" + ReferenceCodec.Serialize(ReferenceKind.Pure, "Paragraphs", value)
            + "\n\n" + ReferenceCodec.Serialize(ReferenceKind.Wiki, "Paragraphs", value);
        var preview = records.PreviewFieldConversion(data.Rows[0].Id, data.Fields[0].Id, new(knowledge.Current.Revision, raw));
        var saved = await records.ChangeFieldAsync(data.Rows[0].Id, data.Fields[0].Id, new(Id(), knowledge.Current.Revision, raw, ConversionToken: preview.PreviewToken));
        var cell = records.Read(collection).Rows[0].Cells[0];
        Check(saved.Status == "committed" && cell.ComputedMarkdown == Expected(value),
            "two multiline reference substitutions retain nested-list structure in generated Markdown");
        Check(cell.References is { Length: 2 } && cell.References.All(r => r.CachedValue == value
            && cell.RawSource.Substring(r.Start, r.Length) == ReferenceCodec.Serialize(Enum.Parse<ReferenceKind>(r.Kind), "Paragraphs", value))
            && knowledge.Current.Definitions.Values.Single(d => d.Name == "Paragraphs").Value == value
            && knowledge.Current.Definitions.Values.Single(d => d.Name == "PlainComposition").Value == value + value,
            "source values, both raw caches, UTF-16 ranges and ordinary composition remain exact");
        var reader = await knowledge.CreateNoteAsync(Id(), "Reader", "[](:ref:Projection.Row.Description)"); readerId = reader.NoteId!;
        Check(knowledge.Current.Notes[readerId].Syntax.References.Single().CachedValue == Expected(value),
            "another note receives the generated field's correctly structured Markdown cache");
        var target = knowledge.Current.Definitions.Values.Single(d => d.Name == "Paragraphs");
        await knowledge.ChangeLiteralAsync(Id(), target.Id, knowledge.Current.Revision, updatedValue);
        Check(records.Read(collection).Rows[0].Cells[0].ComputedMarkdown == Expected(updatedValue)
            && knowledge.Current.Notes[readerId].Syntax.References.Single().CachedValue == Expected(updatedValue)
            && knowledge.Current.Definitions.Values.Single(d => d.Name == "PlainComposition").Value == updatedValue + updatedValue,
            "dependency updates recompute the same property and its downstream cache without changing ordinary composition");
        // Persist the prior projection shape while keeping all reference identities/ranges intact.
        var prior = knowledge.Current; var note = prior.Notes[collection]; var revision = prior.Revision + 1;
        var oldSyntax = note.Syntax with { Definitions = note.Syntax.Definitions.Select(d => d with {
            Parts = d.Parts.Select(p => p with { ContinuationPrefix = null }).ToArray() }).ToArray() };
        var notes = prior.Notes.ToDictionary(p => p.Key, p => p.Value);
        notes[collection] = note with { Syntax = oldSyntax, Revision = revision };
        var definitions = prior.Definitions.ToDictionary(p => p.Key, p => p.Value);
        var property = definitions.Values.Single(d => d.Name == "Projection.Row.Description");
        definitions[property.Id] = property with { Value = "old unstructured projection" };
        repository.Commit(prior, prior with { Revision = revision, Notes = notes, Definitions = definitions },
            new(Id(), "synthetic-prefixless-projection", "committed", revision, collection), null);
    }
    using (var repository = new MarkdownWorkspaceRepository(targetRoot))
    using (var knowledge = new KnowledgeService(repository))
    {
        Check(knowledge.PolicyImpact(knowledge.Current.Languages).NoteIds.Contains(collection),
            "policy impact detects a changed continuation prefix even with identical reference ranges");
        var result = await knowledge.ChangePolicyAsync(Id(), knowledge.Current.Revision, knowledge.Current.Languages);
        Check(result.Status == "committed" && new WorkspaceRecords(repository, knowledge).Read(collection).Rows[0].Cells[0].ComputedMarkdown == Expected(updatedValue),
            "same-name incremental evaluation does not reuse a prefixless old projected value");
    }
    using (var repository = new MarkdownWorkspaceRepository(targetRoot))
    using (var knowledge = new KnowledgeService(repository))
        Check(new WorkspaceRecords(repository, knowledge).Read(collection).Rows[0].Cells[0].ComputedMarkdown == Expected(updatedValue)
            && knowledge.Current.Notes[readerId].Syntax.References.Single().CachedValue == Expected(updatedValue),
            "structured projection and downstream cache persist across reopening");
}
if (args.Length == 0 || args.Contains("query-read", StringComparer.Ordinal))
{
    using var repository = new MarkdownWorkspaceRepository(Path.Combine(root, "query-read"));
    string collection, origin;
    Snapshot accepted;
    using (var knowledge = new KnowledgeService(repository))
    {
        var records = new WorkspaceRecords(repository, knowledge);
        var target = await knowledge.CreateNoteAsync(Id(), "QueryTarget", "@code{ @QueryValue = {😀 [[QueryTarget|來源]]} }");
        origin = target.NoteId!;
        var created = await records.CreateAsync(new(Id(), knowledge.Current.Revision, "Query", "Query.First", "第一筆",
            [new("", "Text", "正文", "Markdown"), new("", "Empty", "空值", "Markdown")]));
        collection = created.NoteId!;
        await records.AddRecordAsync(collection, new(Id(), knowledge.Current.Revision, "Query.Second", "第二筆"));
        var data = records.Read(collection); var field = data.Fields[0];
        var raw = "😀開始\r\n" + ReferenceCodec.Serialize(ReferenceKind.Pure, "QueryValue", "") + "\r\n"
            + ReferenceCodec.Serialize(ReferenceKind.Wiki, "QueryValue", "") + "\r\n@code{ @QueryLocal = {local} }";
        Check((await records.ChangeFieldAsync(data.Rows[0].Id, field.Id, new(Id(), knowledge.Current.Revision, raw))).Status == "committed"
            && (await records.ChangeFieldAsync(data.Rows[1].Id, field.Id, new(Id(), knowledge.Current.Revision, "第二筆正文"))).Status == "committed",
            "query read fixture commits two rows with references, region, literal and null cells");
        data = records.Read(collection); var linked = data.Rows[0].Cells[0];
        Check(data.Rows.Length == 2 && data.Rows.All(r => r.Cells.Length == 2 && r.Cells[1].IsNull && r.Cells[1].TypedValue?.IsNull == true)
            && data.Rows[1].Cells[0].CanEditShared && !linked.CanEditShared,
            "indexed query keeps row/field order, typed null and literal-only edit permissions");
        Check(linked.References is { Length: 2 } && linked.References.All(r => r.OriginNoteId == origin
            && linked.RawSource.Substring(r.Start, r.Length) == ReferenceCodec.Serialize(Enum.Parse<ReferenceKind>(r.Kind), r.Name, r.CachedValue))
            && linked.Regions is { Length: 1 } && linked.RawSource.Substring(linked.Regions[0].Start, linked.Regions[0].Length).StartsWith("@code{"),
            "indexed query preserves both reference kinds, true origin and local UTF-16 region/ranges");
        Check(data.RelationChoices.Select(r => r.Id).SequenceEqual(data.Rows.Select(r => r.Id)) && data.Revision == knowledge.Current.Revision,
            "one owner projection retains complete relation choices and captured revision");
        accepted = knowledge.Current;
    }
    // Persist bounded synthetic projections to exercise lookup absence and duplicate rejection.
    void Project(Snapshot state)
    {
        var prior = repository.Load(); var revision = prior.Revision + 1;
        repository.Commit(prior, state with { Revision = revision }, new(Id(), "query-projection", "committed", revision, collection), null);
    }
    void RejectDuplicate(Snapshot state, string message)
    {
        Project(state);
        using var knowledge = new KnowledgeService(repository);
        var rejected = false;
        try { new WorkspaceRecords(repository, knowledge).Read(collection); }
        catch (InvalidOperationException) { rejected = true; }
        Check(rejected, message);
    }
    var literal = accepted.Definitions.Values.Single(d => d.Name == "Query.Second.Text");
    var definitions = accepted.Definitions.ToDictionary(p => p.Key, p => p.Value);
    definitions.Remove(literal.Id); Project(accepted with { Definitions = definitions });
    using (var knowledge = new KnowledgeService(repository))
        Check(new WorkspaceRecords(repository, knowledge).Read(collection).Rows[1].Cells[0] is { Status: "Missing", CanEditShared: false, ComputedMarkdown: null },
            "missing indexed field definition remains Missing and read-only");
    definitions = accepted.Definitions.ToDictionary(p => p.Key, p => p.Value);
    var duplicate = literal with { Id = Id(), Name = "Query.Duplicate" }; definitions.Add(duplicate.Id, duplicate);
    RejectDuplicate(accepted with { Definitions = definitions }, "duplicate requested field origins still reject instead of choosing one definition");
    Project(accepted);
    Note note;
    using (var knowledge = new KnowledgeService(repository))
    {
        note = knowledge.Current.Notes[collection];
        await knowledge.SaveDraftAsync(new(collection, "query-draft", 1, note.Revision, note.Title, note.CurrentSource + "\ndraft", note.CurrentSourceHash));
        var data = new WorkspaceRecords(repository, knowledge).Read(collection);
        Check(data.HasDraft && data.Rows.SelectMany(r => r.Cells).All(c => !c.CanEditShared) && data.Rows[0].Cells[0].References is { Length: 2 },
            "dirty query retains accepted references but disables all shared edits");
    }
    var notes = accepted.Notes.ToDictionary(p => p.Key, p => p.Value); note = notes[collection];
    notes[collection] = note with { Revision = repository.Load().Revision + 1, SavedSource = new(note.CurrentSource, "stale", [], note.CurrentRecords) };
    Project(accepted with { Notes = notes });
    using (var knowledge = new KnowledgeService(repository))
    {
        var data = new WorkspaceRecords(repository, knowledge).Read(collection);
        Check(data.HasDraft && data.SourceStatus == "stale", $"stale query reports dirty/unaccepted source ({data.HasDraft}, {data.SourceStatus})");
        Check(data.Rows.SelectMany(r => r.Cells).All(c => c.Status == "Stale"
            && !c.CanEditShared && c.References is { Length: 0 } && c.Regions is { Length: 0 }),
            "stale query remains readable without accepted semantic metadata or shared edit permissions");
    }
}
Console.WriteLine($"PASS {assertions} Records service assertions. Workspace: {root}");
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
