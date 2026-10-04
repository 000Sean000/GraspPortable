using GraspPortable.Core.Knowledge;
using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;

try
{
var passed = 0; var failed = 0;
string Id() => Guid.NewGuid().ToString("N");
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected [{expected}], got [{actual}]"); }
void True(bool value, string message = "Assertion failed") { if (!value) throw new InvalidOperationException(message); }
async Task Check(string name, Func<Task> action)
{
    if (args.Length > 0 && !name.Contains(args[0], StringComparison.OrdinalIgnoreCase)) return;
    try { await action(); passed++; Console.WriteLine("PASS " + name); }
    catch (Exception error) { failed++; Console.Error.WriteLine("FAIL " + name + ": " + error); }
}
async Task<string> Create(KnowledgeService service, string source)
{
    var result = await service.CreateNoteAsync(Id(), "Note", source); Equal("committed", result.Status); return result.NoteId!;
}
KnowledgeDefinition Definition(KnowledgeService service, string name) => service.Current.Definitions.Values.Single(d => d.Name == name);
async Task Observe(KnowledgeService service, RecordFixture record, string? source = null, RecordsDocumentDescriptor? metadata = null)
{
    var result = await service.ObserveExternalAsync(Id(), [new(record.NoteId, "Record", source ?? record.Source,
        service.Current.Notes.GetValueOrDefault(record.NoteId)?.CurrentSourceHash, Records: metadata ?? record.Descriptor)]);
    Equal("source-observed", result.Status);
}

await Check("generated properties share the ordinary binding namespace and preserve canonical field ID", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    var record = new RecordFixture("plain field"); await Observe(service, record);
    var generated = Definition(service, "Hero.Description");
    Equal("plain field", generated.Value); True(!generated.IsLiteral, "field origin remains distinct from a syntax literal");
    Equal(new FieldDefinitionOrigin(record.Record.Id, record.Field.Id), generated.FieldOrigin);
    Equal(RecordNoteSyntax.DefinitionId(generated.FieldOrigin!), generated.Id);
    var duplicate = await service.CreateNoteAsync(Id(), "Collision", "@code{ @Hero.Description = {duplicate} }");
    Equal("invalid", duplicate.Status); Equal(1, service.Current.Notes.Count);
    Equal("plain field", Definition(service, "Hero.Description").Value);
    await Create(service, "@code{ @hero.Description = {case-sensitive} }");
    Equal("case-sensitive", Definition(service, "hero.Description").Value);
});

await Check("field references participate in cross-note transitive dependency updates", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    await Create(service, "@code{ @Fruit = {apple} }");
    var record = new RecordFixture("prefix [old](:ref:Fruit)"); await Observe(service, record);
    await Create(service, "@code{ @Summary = Hero.Description + {!} }");
    var reader = await Create(service, "[old](:ref:Summary)");
    Equal("prefix apple", Definition(service, "Hero.Description").Value);
    Equal("prefix apple!", service.Current.Notes[reader].Syntax.References.Single().CachedValue);
    var changed = await service.ChangeLiteralAsync(Id(), Definition(service, "Fruit").Id, service.Current.Revision, "pear");
    Equal("committed", changed.Status); Equal("prefix pear", Definition(service, "Hero.Description").Value);
    Equal("prefix pear!", service.Current.Notes[reader].Syntax.References.Single().CachedValue);
});

await Check("handwritten field definitions participate but computed Grasp-looking values never create definitions", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    var record = new RecordFixture("@code{ @Inside = {seed} }\n[old](:ref:Inside)"); await Observe(service, record);
    Equal("seed", Definition(service, "Inside").Value);
    True(Definition(service, "Hero.Description").Value!.EndsWith("\nseed", StringComparison.Ordinal));
    const string computed = "@code{ @Injected = {not parsed} }\n[cache](:ref:NeverAnEdge)";
    Equal("committed", (await service.ChangeLiteralAsync(Id(), Definition(service, "Inside").Id, service.Current.Revision, computed)).Status);
    True(Definition(service, "Hero.Description").Value!.EndsWith(computed, StringComparison.Ordinal));
    True(!service.Current.Definitions.Values.Any(d => d.Name is "Injected" or "NeverAnEdge"));
    Equal("Valid", Definition(service, "Hero.Description").Status);
});

await Check("generated missing and cyclic dependencies retain explicit diagnostics", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    var missing = new RecordFixture("[retained](:ref:Missing)"); await Observe(service, missing);
    Equal("Missing", Definition(service, "Hero.Description").Status);
    True(service.Current.Notes[missing.NoteId].Diagnostics.Any(d => d.Code == "Missing"));
    Equal("committed", (await service.ChangeRecordFieldAsync(Id(), missing.Record.Id, missing.Field.Id, service.Current.Revision,
        new("[retained](:ref:Hero.Description)"))).Status);
    Equal("Cycle", Definition(service, "Hero.Description").Status);
    Equal("retained", service.Current.Notes[missing.NoteId].Syntax.References.Single().CachedValue);
});

await Check("nested multiline cache updates preserve UTF16 mappings and field indentation", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    await Create(service, "@code{ @Fruit = {old} }");
    var record = new RecordFixture("😀前段\r\n[old](:ref:Fruit)\r\n尾段", nested: true); await Observe(service, record);
    const string value = "中😀文\r\n\r\n第二段";
    Equal("committed", (await service.ChangeLiteralAsync(Id(), Definition(service, "Fruit").Id, service.Current.Revision, value)).Status);
    var note = service.Current.Notes[record.NoteId]; var parsed = VerticalRecordCodec.Parse(note.Source, record.Descriptor);
    True(parsed.CanRewrite); var field = parsed.Fields.Single();
    Equal("😀前段\r\n[" + ReferenceCodec.Encode(value) + "](:ref:Fruit)\r\n尾段", field.RawSource);
    True(note.Source.StartsWith("## Preserve before\r\n", StringComparison.Ordinal) && note.Source.EndsWith("\r\nPreserve after", StringComparison.Ordinal));
    True(field.SourceMap.All(m => note.Source.Substring(m.SourceSpan.Start, m.SourceSpan.Length) == field.RawSource.Substring(m.ValueSpan.Start, m.ValueSpan.Length)));
    var name = note.Syntax.References.Single().NameSpan; Equal("Fruit", note.Source.Substring(name.Start, name.Length));
    Equal("😀前段\r\n" + value + "\r\n尾段", Definition(service, "Hero.Description").Value);
});

await Check("metadata key rename preserves generated identity and patches names throughout dependencies", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    var record = new RecordFixture("first"); await Observe(service, record);
    var definitionId = Definition(service, "Hero.Description").Id;
    var ordinary = await Create(service, "@code{ @Alias = Hero.Description + {!} }\n[old](:ref:Hero.Description)");
    var nested = new RecordFixture("[old](:ref:Hero.Description)", nested: true, key: "Other"); await Observe(service, nested);
    var descriptor = record.Descriptor with { Records = [record.Record with { Key = "Person" }], Fields = [record.Field with { Key = "Biography" }] };
    await Observe(service, record, service.Current.Notes[record.NoteId].CurrentSource, descriptor);
    Equal(definitionId, Definition(service, "Person.Biography").Id);
    True(!service.Current.Definitions.Values.Any(d => d.Name == "Hero.Description"));
    True(service.Current.Notes[ordinary].Source.Contains("Alias = Person.Biography", StringComparison.Ordinal));
    Equal("Person.Biography", service.Current.Notes[ordinary].Syntax.References.Single().Name);
    Equal("Person.Biography", service.Current.Notes[nested.NoteId].Syntax.References.Single().Name);
    Equal("first!", Definition(service, "Alias").Value);
    Equal("first", Definition(service, "Other.Description").Value);
});

await Check("invalid external field retains raw source and last-good while unrelated definitions still update", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    var record = new RecordFixture("accepted"); await Observe(service, record);
    var id = Definition(service, "Hero.Description").Id;
    var invalid = record.Carrier("@code{ @Broken = {"); await Observe(service, record, invalid);
    var note = service.Current.Notes[record.NoteId]; Equal(invalid, note.CurrentSource); Equal(record.Source, note.Source); True(note.IsSourceStale);
    var generated = service.Current.Definitions[id]; Equal("Stale", generated.Status); Equal("accepted", generated.LastGoodValue);
    await Create(service, "@code{ @Unrelated = {healthy} }");
    Equal("healthy", Definition(service, "Unrelated").Value); Equal(invalid, service.Current.Notes[record.NoteId].CurrentSource);
});

await Check("dedicated and shared field writes preserve raw Markdown instead of serializing a literal", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    var record = new RecordFixture("original", nested: true); await Observe(service, record);
    var definitionId = Definition(service, "Hero.Description").Id;
    const string edited = "new {braces}\r\n\r\n## Markdown";
    var operation = Id(); var revision = service.Current.Revision;
    var result = await service.ChangeRecordFieldAsync(operation, record.Record.Id, record.Field.Id, revision, new(edited));
    Equal("committed", result.Status); Equal(definitionId, Definition(service, "Hero.Description").Id);
    Equal(edited, VerticalRecordCodec.Parse(service.Current.Notes[record.NoteId].Source, record.Descriptor).Fields.Single().RawSource);
    Equal(edited, Definition(service, "Hero.Description").Value);
    var afterRevision = service.Current.Revision;
    Equal(result, await service.ChangeRecordFieldAsync(operation, record.Record.Id, record.Field.Id, revision, new(edited)));
    Equal(afterRevision, service.Current.Revision);
    Equal("rejected", (await service.ChangeRecordFieldAsync(operation, record.Record.Id, record.Field.Id, revision, new("different payload"))).Status);
    Equal("conflict", (await service.ChangeRecordFieldAsync(Id(), record.Record.Id, record.Field.Id, revision, new("stale"))).Status);
    Equal("committed", (await service.ChangeLiteralAsync(Id(), definitionId, service.Current.Revision, "shared plain {value}")).Status);
    Equal("shared plain {value}", VerticalRecordCodec.Parse(service.Current.Notes[record.NoteId].Source, record.Descriptor).Fields.Single().RawSource);
    var owner = service.Current.Notes[record.NoteId];
    var draft = new Draft(owner.Id, "editing-session", 1, owner.Revision, owner.Title, owner.CurrentSource + "\r\ndraft", owner.CurrentSourceHash);
    Equal("draft", (await service.SaveDraftAsync(draft)).Status);
    Equal("conflict", (await service.ChangeRecordFieldAsync(Id(), record.Record.Id, record.Field.Id, service.Current.Revision, new("must not overwrite"))).Status);
    Equal(draft, service.GetDraft(owner.Id)); Equal(owner.CurrentSource, service.Current.Notes[owner.Id].CurrentSource);
});

await Check("external reference cache edit writes through to a plain generated field carrier", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    var record = new RecordFixture("plain"); await Observe(service, record);
    var readerId = await Create(service, "[plain](:ref:Hero.Description)");
    var reader = service.Current.Notes[readerId];
    var result = await service.ObserveExternalAsync(Id(), [new(readerId, reader.Title, "[shared edit](:ref:Hero.Description)", reader.CurrentSourceHash)]);
    Equal("source-observed", result.Status);
    Equal("shared edit", Definition(service, "Hero.Description").Value);
    Equal("shared edit", VerticalRecordCodec.Parse(service.Current.Notes[record.NoteId].Source, record.Descriptor).Fields.Single().RawSource);
    var referenceField = new RecordFixture("[old](:ref:Hero.Description)", key: "Computed"); await Observe(service, referenceField);
    var generated = Definition(service, "Computed.Description");
    Equal("rejected", (await service.ChangeLiteralAsync(Id(), generated.Id, service.Current.Revision, "cannot flatten composition")).Status);
});

await Check("typed diagnostics preserve invalid source while valid computed scalar follows dependencies", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    await Create(service, "@code{ @NumberText = {42} }");
    var record = new RecordFixture("[old](:ref:NumberText)", kind: RecordFieldKind.Number); await Observe(service, record);
    Equal("42", Definition(service, "Hero.Description").Value);
    True(!service.Current.Notes[record.NoteId].Diagnostics.Any(d => d.Code == "number-format"));
    Equal("committed", (await service.ChangeLiteralAsync(Id(), Definition(service, "NumberText").Id, service.Current.Revision, "not a number")).Status);
    var note = service.Current.Notes[record.NoteId];
    True(note.Diagnostics.Any(d => d.Code == "number-format"));
    Equal("not a number", Definition(service, "Hero.Description").Value);
    True(VerticalRecordCodec.Parse(note.Source, record.Descriptor).Fields.Single().RawSource.Contains("not a number", StringComparison.Ordinal));
});

await Check("external shared reference edit inside nested field uses decoded field source as its comparison base", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    await Create(service, "@code{ @Fruit = {old} }");
    var record = new RecordFixture("[old](:ref:Fruit)", nested: true); await Observe(service, record);
    await Observe(service, record, record.Carrier("[new shared value](:ref:Fruit)"));
    Equal("[new shared value](:ref:Fruit)", VerticalRecordCodec.Parse(service.Current.Notes[record.NoteId].CurrentSource, record.Descriptor).Fields.Single().RawSource);
    Equal("new shared value", Definition(service, "Fruit").Value);
    Equal("new shared value", Definition(service, "Hero.Description").Value);
    const string multiline = "中😀文\r\n\r\n第二段";
    await Observe(service, record, record.Carrier("[" + ReferenceCodec.Encode(multiline) + "](:ref:Fruit)"));
    Equal(multiline, Definition(service, "Fruit").Value);
    Equal(multiline, Definition(service, "Hero.Description").Value);
    var mixed = record.Carrier("[different](:ref:Fruit)") + " plus an unrelated outer edit";
    await Observe(service, record, mixed);
    Equal(multiline, Definition(service, "Fruit").Value);
    Equal(mixed, service.Current.Notes[record.NoteId].CurrentSource);
    True(service.Current.Notes[record.NoteId].IsSourceStale, "mixed field-value and outer-source changes require review without losing raw bytes");
});

await Check("review: duplicate record identity across distinct notes cannot enter accepted semantics", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    var first = new RecordFixture("first", key: "First"); await Observe(service, first);
    var second = new RecordFixture("second", key: "Second");
    var duplicate = second.Descriptor with { Records = [second.Record with { Id = first.Record.Id }] };
    await Observe(service, second, metadata: duplicate);
    True(service.Current.Notes[second.NoteId].IsSourceStale, "duplicate RecordId must preserve second raw source as conflict, not accept two owners");
    Equal("first", Definition(service, "First.Description").Value);
    Equal(second.Source, service.Current.Notes[second.NoteId].CurrentSource);
    var sharedField = second.Descriptor with { Fields = [first.Field], Records = [second.Record with { Fields = [second.Locator with { FieldId = first.Field.Id }] }] };
    await Observe(service, second, metadata: sharedField);
    True(!service.Current.Notes[second.NoteId].IsSourceStale, "a shared schema FieldId across distinct records remains valid");
    Equal("second", Definition(service, "Second.Description").Value);
});

await Check("review: field editor must preserve handwritten rename identity or refuse the ambiguous write", async () =>
{
    using var memory = new MemoryRepository(); using var service = new KnowledgeService(memory);
    var record = new RecordFixture("@code{ @Original = {stable value} }"); await Observe(service, record);
    var originalId = Definition(service, "Original").Id;
    var reader = await Create(service, "[old](:ref:Original)");
    await Create(service, "@code{ @Alias = Original + {!} }");
    var nested = new RecordFixture("[old](:ref:Original)", nested: true, key: "Other"); await Observe(service, nested);
    var readerNote = service.Current.Notes[reader];
    var draft = new Draft(reader, "reader-session", 1, readerNote.Revision, readerNote.Title, readerNote.Source + "\nuser draft", readerNote.CurrentSourceHash);
    Equal("draft", (await service.SaveDraftAsync(draft)).Status);
    var source = service.Current.Notes[record.NoteId].Source;
    var operation = Id(); var revision = service.Current.Revision; var edit = new FieldSourceEdit("@code{ @Renamed = {stable value} }");
    var confirmation = await service.ChangeRecordFieldAsync(operation, record.Record.Id, record.Field.Id, revision, edit);
    Equal("confirmation-required", confirmation.Status);
    True(confirmation.AffectedNoteIds!.Contains(reader) && confirmation.AffectedNoteIds.Contains(nested.NoteId));
    Equal(originalId, Definition(service, "Original").Id); Equal(source, service.Current.Notes[record.NoteId].Source);
    var changed = await service.ChangeRecordFieldAsync(operation, record.Record.Id, record.Field.Id, revision, edit, confirmRename: true);
    Equal("committed", changed.Status); Equal(originalId, Definition(service, "Renamed").Id);
    Equal("Renamed", service.Current.Notes[reader].Syntax.References.Single().Name);
    Equal("Renamed", service.Current.Notes[nested.NoteId].Syntax.References.Single().Name);
    Equal("stable value!", Definition(service, "Alias").Value);
    Equal(draft, service.GetDraft(reader));
    Equal("conflict", (await service.CommitNoteAsync(new(Id(), reader, draft.SessionId, draft.Revision, draft.BaseNoteRevision, service.Current.Revision))).Status);
    Equal(changed, await service.ChangeRecordFieldAsync(operation, record.Record.Id, record.Field.Id, revision, edit));
});

Console.WriteLine($"{passed} Records Knowledge groups passed, {failed} failed.");
return failed == 0 ? 0 : 1;
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}

sealed class RecordFixture
{
    public string NoteId { get; } = Guid.NewGuid().ToString("N");
    public FieldSchema Field { get; }
    public FieldLocator Locator { get; }
    public RecordDescriptor Record { get; }
    public RecordsDocumentDescriptor Descriptor { get; }
    public string Source { get; }
    private readonly string newline;
    public RecordFixture(string raw, bool nested = false, string key = "Hero", RecordFieldKind kind = RecordFieldKind.Markdown)
    {
        Field = new(Guid.NewGuid().ToString("N"), "Description", "Description", kind);
        Locator = new(Field.Id, Guid.NewGuid().ToString("N"), nested ? FieldLayout.NestedList : FieldLayout.Headings, nested ? 6 : 0);
        Record = new(Guid.NewGuid().ToString("N"), key, key, [Locator]); Descriptor = new([Record], [Field]);
        newline = nested ? "\r\n" : "\n"; Source = Carrier(raw);
    }
    public string Carrier(string raw)
    {
        var encoded = VerticalRecordCodec.SerializeCarrier(Locator, new(raw), newline);
        if (!encoded.Success) throw new InvalidOperationException(string.Join("; ", encoded.Diagnostics.Select(d => d.Message)));
        return "## Preserve before" + newline + encoded.Source + newline + "Preserve after";
    }
}

sealed class MemoryRepository : IWorkspaceRepository
{
    public bool UsesSavedSourceAuthority => true;
    private Snapshot snapshot = new(Guid.NewGuid().ToString("N"), 0, 0, ["", "grasp"], new Dictionary<string, Note>(), new Dictionary<string, KnowledgeDefinition>());
    private readonly Dictionary<string, Receipt> receipts = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Draft> drafts = new(StringComparer.Ordinal);
    public Snapshot Load() => snapshot;
    public IReadOnlyList<Draft> LoadDrafts() => drafts.Values.ToArray();
    public Receipt? FindReceipt(string id) => receipts.GetValueOrDefault(id);
    public void SaveDraft(Draft draft) => drafts[draft.NoteId] = draft;
    public void Commit(Snapshot previous, Snapshot next, Receipt receipt, string? consumedDraftNoteId)
    {
        if (snapshot.Revision != previous.Revision) throw new InvalidOperationException("Stale fixture repository write");
        snapshot = next; receipts.Add(receipt.OperationId, receipt); if (consumedDraftNoteId is not null) drafts.Remove(consumedDraftNoteId);
    }
    public void Dispose() { }
}
