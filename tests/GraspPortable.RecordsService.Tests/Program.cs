using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.Records;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Markdown;

try
{
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces/RS-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
var assertions = 0;
string Id() => Guid.NewGuid().ToString("N");
void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); assertions++; Console.WriteLine("PASS " + message); }
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
        var result = await service.ChangeFieldAsync(rowId, Field(kind).Id, new(Id(), knowledge.Current.Revision, raw, TypedValue: value));
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
Console.WriteLine($"PASS {assertions} Records service assertions. Workspace: {root}");
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
