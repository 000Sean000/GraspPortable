using GraspPortable.Core.Knowledge;
using GraspPortable.Core.Records;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Markdown;
using YamlDotNet.RepresentationModel;

try
{
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces/RW-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
var count = 0;
string Id() => Guid.NewGuid().ToString("N");
void Check(bool test, string message) { if (!test) throw new InvalidOperationException(message); count++; Console.WriteLine("PASS " + message); }
async Task Observe(MarkdownWorkspaceRepository repository, KnowledgeService knowledge)
{
    var scan = repository.Scan(knowledge.Current);
    Check(scan.Issues.Count == 0, "valid Records envelope scan: " + string.Join("; ", scan.Issues.Select(i => i.Message)));
    if (scan.Changes.Count > 0)
    {
        var operation = Id(); using var lease = repository.BeginObservation(operation, scan.States);
        var result = await knowledge.ObserveExternalAsync(operation, scan.Changes);
        Check(result.Status == "source-observed", "Records semantic observation accepted: " + result.Message);
    }
    else if (scan.States.Count > 0) repository.RefreshSourceRegistry(knowledge.Current, scan.States);
}
var noteId = Id(); var fieldId = Id(); var recordId = Id(); var locatorId = Id(); var collectionId = Id(); var documentId = Id();
var schema = new FieldSchema(fieldId, "Description", "長文說明", RecordFieldKind.Markdown);
var locator = new FieldLocator(fieldId, locatorId);
var descriptor = new RecordsDocumentDescriptor([new(recordId, "Hero", "角色", [locator])], [schema]);
const string value = "首段😀\r\n\r\n### 內文標題\r\n```json\r\n{\"preserved\":true}\r\n```\r\n尾段";
var body = "## 角色集\r\n### 角色\r\n#### 長文說明\r\n" + VerticalRecordCodec.SerializeCarrier(locator, new(value), "\r\n").Source + "\r\n";
var records = new RecordsMetadata(collectionId, "人物集", descriptor, "- name: All\n  frozenColumns: 2\n  futureView: preserved\n");
var metadata = new MarkdownIdentityMetadata(1, documentId, [new(noteId, "角色", new Dictionary<string, string>(), records)]);
var source = MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read(body), metadata);
Check(source.Success && source.Source.Contains("version: 1"), "versioned Records YAML emitted");
Check(source.Source.IndexOf("首段", StringComparison.Ordinal) == source.Source.LastIndexOf("首段", StringComparison.Ordinal), "long field exists once in Markdown, never duplicated in YAML");
var raw = source.Source.Replace("records:\r\n", "records:\r\n      futureCollection: keep\r\n", StringComparison.Ordinal)
    .Replace("displayName: 長文說明", "displayName: 長文說明\r\n        futureField: keep", StringComparison.Ordinal);
var file = Path.Combine(root, "record.md"); File.WriteAllText(file, raw);
using (var repository = new MarkdownWorkspaceRepository(root))
using (var knowledge = new KnowledgeService(repository))
{
    await Observe(repository, knowledge);
    Check(RecordsMetadataCodec.SameDescriptor(descriptor, knowledge.Current.Notes[noteId].Records), "descriptor reaches Knowledge from authoritative source");
    var generated = knowledge.Current.Definitions.Values.Single();
    Check(generated.Name == "Hero.Description" && generated.Value == value && generated.FieldOrigin is not null, "generated property uses exact multiline field source");
    Check(MarkdownEnvelopeCodec.Read(File.ReadAllText(file)).Metadata!.Notes.Single().Bindings.Count == 0, "generated field identity is absent from handwritten bindings");
    Check((await knowledge.ChangeRecordFieldAsync(Id(), recordId, fieldId, knowledge.Current.Revision, new("changed\r\n\r\nfield"))).Status == "committed", "field edit commits through real Markdown repository");
    var updated = File.ReadAllText(file); var envelope = MarkdownEnvelopeCodec.Read(updated);
    Check(VerticalRecordCodec.Parse(envelope.Body, descriptor).Fields.Single().RawSource == "changed\r\n\r\nfield", "field edit writes only real field body");
    Check(envelope.Metadata!.Notes.Single().Records!.CollectionId == collectionId && updated.Contains("futureCollection: keep") && updated.Contains("futureView: preserved"), "collection and unknown metadata survive source write");
    Check(envelope.Metadata.Notes.Single().Bindings.Count == 0 && repository.Scan(knowledge.Current).Changes.Count == 0, "writeback settles without generated binding or descriptor observation loop");
    var idBefore = generated.Id;
    File.WriteAllText(file, updated.Replace("key: Hero", "key: Renamed", StringComparison.Ordinal));
    await Observe(repository, knowledge);
    Check(knowledge.Current.Definitions.Values.Single().Id == idBefore && knowledge.Current.Definitions.Values.Single().Name == "Renamed.Description", "external record key rename preserves canonical generated identity");
}
using (var repository = new MarkdownWorkspaceRepository(root))
using (var knowledge = new KnowledgeService(repository))
{
    Check(knowledge.Current.Notes[noteId].Records!.Records.Single().Id == recordId && knowledge.Current.Definitions.Values.Single().Value == "changed\r\n\r\nfield", "repository reopen preserves descriptor, canonical IDs and field value");
    Check(repository.Scan(knowledge.Current).Changes.Count == 0, "reopen has no spurious descriptor mismatch");
    var created = await knowledge.CreateNoteAsync(Id(), "Other", "ordinary"); var otherId = created.NoteId!;
    var physical = repository.LoadSourceFiles(); var otherFile = Path.Combine(root, physical.Single(f => f.NoteId == otherId).RelativePath);
    var merge = GroupingMetadataCodec.GetMergeMetadata(physical.Select(f => new GroupingMetadataSource(f.Text, f.RelativePath, f.DocumentId, f.NoteIds)).ToArray(), Id());
    Check(merge.Success, "group metadata merge accepts Records descriptors");
    var groupedBody = GroupedNoteCodec.Serialize(physical.Select(f => new GroupedNoteInput(f.NoteId, knowledge.Current.Notes[f.NoteId].Title, knowledge.Current.Notes[f.NoteId].CurrentSource)).ToArray());
    var groupedFile = Path.Combine(root, "group.md"); File.WriteAllText(groupedFile, merge.FrontMatter + groupedBody.Source);
    File.Delete(file); File.Delete(otherFile); await Observe(repository, knowledge);
    Check(repository.LoadSourceFiles().Count == 1 && knowledge.Current.Notes[noteId].Records!.Records.Single().Id == recordId, "physical group move retains Records owner and canonical ID");
    Check((await knowledge.ChangeRecordFieldAsync(Id(), recordId, fieldId, knowledge.Current.Revision, new("grouped field"))).Status == "committed", "grouped field can be edited safely");
    var groupedText = File.ReadAllText(groupedFile);
    Check(groupedText.Contains("futureCollection: keep") && knowledge.Current.Notes[otherId].Source == "ordinary", "grouped write preserves unknown Records metadata and sibling body");
    var split = GroupingMetadataCodec.GetSplitMetadata(groupedText, noteId, Id(), "group.md");
    Check(split.Success && MarkdownEnvelopeCodec.Read(split.FrontMatter).Metadata!.Notes.Single().Records!.CollectionId == collectionId
        && split.FrontMatter.Contains("futureCollection: keep"), "split metadata carries Records descriptor and unknown keys with its member");
    var bad = groupedText.Replace("kind: Markdown", "kind: FutureUnsupported", StringComparison.Ordinal); File.WriteAllText(groupedFile, bad);
    var scan = repository.Scan(knowledge.Current);
    Check(scan.Changes.Count == 0 && scan.Issues.Any(i => i.Code == "records-metadata"), "invalid Records metadata emits diagnostics without partial definitions");
    Check((await knowledge.CreateNoteAsync(Id(), "Unrelated", "safe")).Status == "committed" && File.ReadAllText(groupedFile) == bad, "unrelated commit cannot overwrite invalid observed Records YAML with last-good descriptor");
}

// Bounded metadata validation and typed carrier round-trip, independent of field body values.
var typedFields = Enum.GetValues<RecordFieldKind>().Select(kind => new FieldSchema(Id(), kind.ToString(), kind.ToString(), kind,
    kind is RecordFieldKind.SingleSelect or RecordFieldKind.MultiSelect ? [new(Id(), "選項")] : null)).ToArray();
var typed = new RecordsMetadata(Id(), "Typed", new([new(Id(), "Typed", "型別", typedFields.Select(f => new FieldLocator(f.Id, Id(), FieldLayout.NestedList, 3)).ToArray())], typedFields));
var typedYaml = RecordsMetadataCodec.Write(typed);
var readTyped = RecordsMetadataCodec.Read(typedYaml);
Check(readTyped.Success && RecordsMetadataCodec.SameDescriptor(typed.Descriptor, readTyped.Metadata!.Descriptor), "all field kinds, option IDs and explicit nested locators round-trip without values");
var invalidDescriptor = descriptor with { Fields = [schema, schema with { Id = Id() }] };
Check(!RecordsMetadataCodec.Read(RecordsMetadataCodec.Write(records with { Descriptor = invalidDescriptor })).Success, "duplicate field keys are diagnosed");
var dangling = descriptor with { Records = [descriptor.Records[0] with { Fields = [locator with { FieldId = Id() }] }] };
Check(!RecordsMetadataCodec.Read(RecordsMetadataCodec.Write(records with { Descriptor = dangling })).Success, "unknown field locator is diagnosed");
var numberKind = RecordsMetadataCodec.Write(records); ((YamlMappingNode)((YamlSequenceNode)numberKind.Children[new YamlScalarNode("schema")]).Children[0]).Children[new YamlScalarNode("kind")] = new YamlScalarNode("0");
Check(!RecordsMetadataCodec.Read(numberKind).Success, "numeric enum spellings cannot silently change schema meaning");
Check(!MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read("body"), metadata with { Notes = [metadata.Notes[0] with { Records = records with { ViewsYaml = "bad: [" } }] }).Success, "invalid supplied view YAML refuses rewrite");
var oldYaml = RecordsMetadataCodec.Write(typed);
YamlMappingNode Entry(YamlMappingNode map, string list, int index = 0) => (YamlMappingNode)((YamlSequenceNode)map.Children[new YamlScalarNode(list)]).Children[index];
Entry(oldYaml, "schema").Add("futureField", "keep-field");
Entry(oldYaml, "items").Add("futureRecord", "keep-record");
Entry(Entry(oldYaml, "items"), "fields").Add("futureLocator", "keep-locator");
var selectIndex = Array.FindIndex(typedFields, f => f.Kind == RecordFieldKind.SingleSelect);
Entry(Entry(oldYaml, "schema", selectIndex), "options").Add("futureOption", "keep-option");
var renamedTyped = typed with { Descriptor = typed.Descriptor with {
    Fields = typed.Descriptor.Fields.Select((field, i) => i == 0 ? field with { Key = "RenamedField" } : field).ToArray(),
    Records = [typed.Descriptor.Records[0] with { Key = "RenamedTyped" }] } };
var updatedYaml = RecordsMetadataCodec.Write(renamedTyped, oldYaml);
Check(Entry(updatedYaml, "schema").Children.ContainsKey(new YamlScalarNode("futureField"))
    && Entry(updatedYaml, "items").Children.ContainsKey(new YamlScalarNode("futureRecord"))
    && Entry(Entry(updatedYaml, "items"), "fields").Children.ContainsKey(new YamlScalarNode("futureLocator"))
    && Entry(Entry(updatedYaml, "schema", selectIndex), "options").Children.ContainsKey(new YamlScalarNode("futureOption")),
    "unknown nested schema, record, locator and option metadata follow stable IDs on rename");
Console.WriteLine($"PASS: {count} Records workspace assertions. Workspace: {root}");
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
