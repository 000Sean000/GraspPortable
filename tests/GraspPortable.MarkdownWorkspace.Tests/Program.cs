using System.Text;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Markdown;

var passed = 0;
var failed = 0;
var repositoryRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
var testRoot = Path.Combine(repositoryRoot, "workspaces", "MarkdownWorkspaceTests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(testRoot);
string Workspace(string label) { var path = Path.Combine(testRoot, label); Directory.CreateDirectory(path); return path; }
string Op() => Guid.NewGuid().ToString("N");
void True(bool value, string message = "Assertion failed") { if (!value) throw new InvalidOperationException(message); }
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected [{expected}], actual [{actual}]."); }
async Task Check(string name, Func<Task> action)
{
    try { await action(); passed++; }
    catch (Exception exception) { failed++; Console.Error.WriteLine($"FAIL {name}: {exception}"); }
}
async Task Throws(Func<Task> action)
{
    try { await action(); } catch (IOException) { return; }
    throw new InvalidOperationException("Expected an I/O/recovery refusal.");
}
async Task<string> Create(KnowledgeService service, string title, string body)
{
    var receipt = await service.CreateNoteAsync(Op(), title, body);
    Equal("committed", receipt.Status); return receipt.NoteId!;
}
async Task Observe(MarkdownWorkspaceRepository repository, KnowledgeService service)
{
    var batch = repository.Scan(service.Current);
    True(batch.Issues.Count == 0, string.Join("; ", batch.Issues.Select(i => i.Code + ": " + i.Message)));
    if (batch.Changes.Count > 0)
    {
        var op = Op(); using var lease = repository.BeginObservation(op, batch.States.Where(s => s.Exists).ToArray());
        Equal("source-observed", (await service.ObserveExternalAsync(op, batch.Changes)).Status);
    }
    if (batch.MissingNoteIds.Count > 0)
    {
        var op = Op(); using var lease = repository.BeginObservation(op, batch.States.Where(s => !s.Exists).ToArray());
        var expected = batch.MissingNoteIds.ToDictionary(id => id, id => service.Current.Notes[id].CurrentSourceHash);
        Equal("source-observed", (await service.ObserveDeletedAsync(op, expected)).Status);
    }
}
string FileFor(string path, MarkdownWorkspaceRepository repository, string noteId) => Path.Combine(path, repository.LoadSourceFiles().Single(f => f.NoteId == noteId).RelativePath);
void ExternalBody(string file, string body)
{
    var source = File.ReadAllText(file, Encoding.UTF8);
    var envelope = MarkdownEnvelopeCodec.Read(source);
    File.WriteAllText(file, source[..envelope.BodyStart] + body, new UTF8Encoding(false));
}
string Value(KnowledgeService service, string name) => service.Current.Definitions.Values.Single(d => d.Name == name).Value!;

await Check("App create, Markdown identity and external definition/value changes", async () =>
{
    var path = Workspace("roundtrip");
    var repository = new MarkdownWorkspaceRepository(path); using var service = new KnowledgeService(repository);
    var owner = await Create(service, "Owner", "@code{ @Fruit = {apple} }");
    var carrier = await Create(service, "Carrier", "[apple](:ref:Fruit)");
    var definitionId = service.Current.Definitions.Values.Single().Id;
    var ownerPath = FileFor(path, repository, owner);
    var carrierPath = FileFor(path, repository, carrier);
    var envelope = MarkdownEnvelopeCodec.Read(File.ReadAllText(ownerPath));
    Equal(owner, envelope.Metadata!.Notes[0].Id); Equal(definitionId, envelope.Metadata.Notes[0].Bindings["Fruit"]);
    Equal("@code{ @Fruit = {apple} }", envelope.Body);
    ExternalBody(ownerPath, "@code{ @Fruit = {pear} }");
    await Observe(repository, service);
    Equal("pear", Value(service, "Fruit")); Equal(definitionId, service.Current.Definitions.Values.Single().Id);
    True(File.ReadAllText(carrierPath).Contains("[pear](:ref:Fruit)"));
    ExternalBody(carrierPath, "[banana](:ref:Fruit)");
    await Observe(repository, service);
    Equal("banana", Value(service, "Fruit")); True(File.ReadAllText(ownerPath).Contains("{banana}"));
    Equal(0, repository.Scan(service.Current).Changes.Count);
});

await Check("invalid raw is preserved while unrelated notes still commit", async () =>
{
    var path = Workspace("invalid"); var repository = new MarkdownWorkspaceRepository(path); using var service = new KnowledgeService(repository);
    var first = await Create(service, "First", "@code{ @Fruit = {apple} }");
    await Create(service, "Second", "@code{ @Independent = {one} }");
    var file = FileFor(path, repository, first);
    ExternalBody(file, "@code{ @Fruit = {"); var invalid = File.ReadAllBytes(file);
    await Observe(repository, service);
    True(service.Current.Notes[first].IsSourceStale); Equal("@code{ @Fruit = {", service.Current.Notes[first].CurrentSource);
    var independent = service.Current.Definitions.Values.Single(d => d.Name == "Independent");
    Equal("committed", (await service.ChangeLiteralAsync(Op(), independent.Id, service.Current.Revision, "two")).Status);
    Equal("two", Value(service, "Independent")); True(invalid.AsSpan().SequenceEqual(File.ReadAllBytes(file)));
});

await Check("plain source scan preserves metadata and UTF encodings until actual edit", async () =>
{
    var path = Workspace("encoding");
    var sources = new[]
    {
        ("Utf8.md", (Encoding)new UTF8Encoding(false, true)),
        ("Utf8Bom.md", (Encoding)new UTF8Encoding(true, true)),
        ("Utf16LE.md", (Encoding)new UnicodeEncoding(false, true, true)),
        ("Utf16BE.md", (Encoding)new UnicodeEncoding(true, true, true)),
    };
    var originals = new Dictionary<string, byte[]>();
    foreach (var (name, encoding) in sources)
    {
        var text = "---\r\n# 原註解 😀\r\nuser: '不變'\r\n---\r\n@code{ @" + Path.GetFileNameWithoutExtension(name) + " = {中文} }\r\n";
        var bytes = encoding.GetPreamble().Concat(encoding.GetBytes(text)).ToArray(); originals[name] = bytes; File.WriteAllBytes(Path.Combine(path, name), bytes);
    }
    var repository = new MarkdownWorkspaceRepository(path); using var service = new KnowledgeService(repository);
    await Observe(repository, service);
    foreach (var (name, bytes) in originals) True(bytes.AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(path, name))), "scan rewrote plain source");
    Equal(4, service.Current.Notes.Count);
    foreach (var (name, encoding) in sources)
    {
        var key = Path.GetFileNameWithoutExtension(name); var definition = service.Current.Definitions.Values.Single(d => d.Name == key);
        Equal("committed", (await service.ChangeLiteralAsync(Op(), definition.Id, service.Current.Revision, "修改")).Status);
        var bytes = File.ReadAllBytes(Path.Combine(path, name)); True(bytes.AsSpan().StartsWith(encoding.GetPreamble()));
        var text = encoding.GetString(bytes.AsSpan(encoding.GetPreamble().Length));
        True(text.Contains("# 原註解 😀\r\nuser: '不變'\r\n")); True(text.Contains("{修改}"));
        True(MarkdownEnvelopeCodec.Read(text).Metadata is not null);
    }
    File.WriteAllBytes(Path.Combine(path, "Unknown.md"), [0xff, 0xff, 0xff]);
    True(repository.Scan(service.Current).Issues.Any(i => i.RelativePath == "Unknown.md"));
});

await Check("restart completes files-written but not-yet-semantic intent", async () =>
{
    var path = Workspace("files-written"); var op = Op();
    var repository = new MarkdownWorkspaceRepository(path);
    using (var service = new KnowledgeService(repository))
    {
        repository.AfterFilesWrittenForTest = () => throw new IOException("simulated stop before DB commit");
        await Throws(() => service.CreateNoteAsync(op, "Survives", "@code{ @Saved = {yes} }"));
        True(repository.IsWriteBlocked); Equal(0, repository.Load().Notes.Count);
    }
    repository = new(path); using var restarted = new KnowledgeService(repository);
    True(!repository.IsWriteBlocked, string.Join(";", repository.PendingRecoveryIssues));
    Equal("yes", Value(restarted, "Saved")); Equal(op, repository.FindReceipt(op)!.OperationId);
    Equal(1, Directory.GetFiles(path, "*.md").Length);
});

await Check("restart resumes a partially written shared change", async () =>
{
    var path = Workspace("partial"); var repository = new MarkdownWorkspaceRepository(path);
    using (var service = new KnowledgeService(repository))
    {
        await Create(service, "AOwner", "@code{ @Fruit = {apple} }");
        await Create(service, "BCarrier", "[apple](:ref:Fruit)");
        var count = 0; repository.FileCheckpointForTest = point => { if (point.Stage == "after-mutation" && ++count == 1) throw new IOException("partial stop"); };
        var definition = service.Current.Definitions.Values.Single();
        await Throws(() => service.ChangeLiteralAsync(Op(), definition.Id, service.Current.Revision, "banana"));
    }
    repository = new(path); using var restarted = new KnowledgeService(repository);
    True(!repository.IsWriteBlocked, string.Join(";", repository.PendingRecoveryIssues)); Equal("banana", Value(restarted, "Fruit"));
    True(Directory.GetFiles(path, "*.md").All(file => File.ReadAllText(file).Contains("banana")));
});

await Check("durable receipt survives lost reply and later legitimate external edit", async () =>
{
    var path = Workspace("reply-lost"); var repository = new MarkdownWorkspaceRepository(path); string file;
    var op = Op();
    using (var service = new KnowledgeService(repository))
    {
        var note = await Create(service, "Owner", "@code{ @Fruit = {apple} }"); file = FileFor(path, repository, note);
        repository.AfterDatabaseCommitForTest = () => throw new IOException("lost reply after DB commit");
        await Throws(() => service.ChangeLiteralAsync(op, service.Current.Definitions.Values.Single().Id, service.Current.Revision, "banana"));
        True(repository.FindReceipt(op) is not null);
        ExternalBody(file, "@code{ @Fruit = {cherry} }");
    }
    repository = new(path); using var restarted = new KnowledgeService(repository);
    True(!repository.IsWriteBlocked, string.Join(";", repository.PendingRecoveryIssues)); True(File.ReadAllText(file).Contains("cherry"));
    await Observe(repository, restarted); Equal("cherry", Value(restarted, "Fruit"));
});

await Check("unfinalized operation cannot overwrite third-party bytes on restart", async () =>
{
    var path = Workspace("conflicted-recovery"); var repository = new MarkdownWorkspaceRepository(path); string file;
    using (var service = new KnowledgeService(repository))
    {
        var note = await Create(service, "Owner", "@code{ @Fruit = {apple} }"); file = FileFor(path, repository, note);
        repository.AfterFilesWrittenForTest = () => throw new IOException("stop");
        await Throws(() => service.ChangeLiteralAsync(Op(), service.Current.Definitions.Values.Single().Id, service.Current.Revision, "banana"));
        ExternalBody(file, "@code{ @Fruit = {external} }");
    }
    repository = new(path); using var restarted = new KnowledgeService(repository);
    True(repository.IsWriteBlocked); True(repository.PendingRecoveryIssues.Count > 0);
    True(File.ReadAllText(file).Contains("external")); Equal("apple", Value(restarted, "Fruit"));
    await Throws(() => restarted.CreateNoteAsync(Op(), "Blocked", "body"));
});

await Check("duplicate identity and malformed managed YAML preserve all sources", async () =>
{
    var path = Workspace("identity"); var repository = new MarkdownWorkspaceRepository(path); using var service = new KnowledgeService(repository);
    var note = await Create(service, "Owner", "@code{ @Fruit = {apple} }"); var file = FileFor(path, repository, note);
    var copy = Path.Combine(path, "Copied.md"); File.Copy(file, copy);
    var batch = repository.Scan(service.Current); True(batch.Issues.Any(i => i.Code == "duplicate-identity")); Equal(0, batch.Changes.Count);
    var bytes = File.ReadAllBytes(file);
    await Throws(() => service.ChangeLiteralAsync(Op(), service.Current.Definitions.Values.Single().Id, service.Current.Revision, "wrong"));
    True(bytes.AsSpan().SequenceEqual(File.ReadAllBytes(file))); True(bytes.AsSpan().SequenceEqual(File.ReadAllBytes(copy)));
    File.Delete(copy);
    File.WriteAllText(file, File.ReadAllText(file).Replace("schema: 1", "schema: 999"));
    batch = repository.Scan(service.Current); True(batch.Issues.Any(i => i.Code == "metadata-schema")); Equal(0, batch.MissingNoteIds.Count);
    await Throws(() => service.ChangeLiteralAsync(Op(), service.Current.Definitions.Values.Single().Id, service.Current.Revision, "wrong"));
    True(File.ReadAllText(file).Contains("schema: 999")); True(Directory.GetFiles(Path.Combine(path, ".grasp", "source-conflicts"), "*.bin").Length > 0);
    var conflicting = File.ReadAllBytes(file);
    Equal("source-observed", (await service.MarkSourceUnavailableAsync(Op(), new Dictionary<string,string> { [note] = "metadata-schema" })).Status);
    Equal("unavailable", service.Current.Notes[note].SavedSource!.Status);
    True(service.Current.Definitions.Values.Single().Status != "Valid");
    await Create(service, "Unaffected", "normal text");
    True(conflicting.AsSpan().SequenceEqual(File.ReadAllBytes(file)), "mark-unavailable or unrelated commit rewrote unknown bytes");
});

await Check("canonical move retains identity; deletion with draft never resurrects file", async () =>
{
    var path = Workspace("move-delete"); var repository = new MarkdownWorkspaceRepository(path); using var service = new KnowledgeService(repository);
    var note = await Create(service, "Owner", "@code{ @Fruit = {apple} }"); var file = FileFor(path, repository, note);
    var moved = Path.Combine(path, "Moved.md"); File.Move(file, moved); await Observe(repository, service);
    Equal("Moved.md", repository.LoadSourceFiles().Single().RelativePath); Equal(note, service.Current.Notes.Keys.Single());
    var current = service.Current.Notes[note]; await service.SaveDraftAsync(new(note, "session", 1, current.Revision, current.Title, "local draft", current.CurrentSourceHash));
    File.Delete(moved); await Observe(repository, service);
    Equal("missing", service.Current.Notes[note].SavedSource!.Status); True(!File.Exists(moved)); True(service.GetDraft(note) is not null);
    await Create(service, "Other", "unrelated"); True(!File.Exists(moved));
});

await Check("observation leases do not bleed between operations and stale scans refuse writes", async () =>
{
    var path = Workspace("lease"); var repository = new MarkdownWorkspaceRepository(path); using var service = new KnowledgeService(repository);
    var file = Path.Combine(path, "External.md"); File.WriteAllText(file, "outside");
    var batch = repository.Scan(service.Current); var observation = Op();
    using var lease = repository.BeginObservation(observation, batch.States);
    await Create(service, "Independent", "created while another scan is leased");
    True(repository.LoadSourceFiles().All(f => f.RelativePath != "External.md"));
    File.WriteAllText(file, "newer outside");
    await Throws(() => service.ObserveExternalAsync(observation, batch.Changes));
    Equal("newer outside", File.ReadAllText(file)); True(!repository.IsWriteBlocked);
});

await Check("unobserved semantic dependencies cannot be treated as current", async () =>
{
    var path = Workspace("read-guards"); var repository = new MarkdownWorkspaceRepository(path); using var service = new KnowledgeService(repository);
    var owner = await Create(service, "Owner", "@code{ @Fruit = {apple} }");
    ExternalBody(FileFor(path, repository, owner), "@code{ @Fruit = {pear} }");
    await Throws(() => service.CreateNoteAsync(Op(), "NewCarrier", "[apple](:ref:Fruit)"));
    Equal(1, Directory.GetFiles(path, "*.md").Length); True(!repository.IsWriteBlocked);
    await Observe(repository, service);
    var carrier = await Create(service, "NewCarrier", "[apple](:ref:Fruit)");
    True(service.Current.Notes[carrier].CurrentSource.Contains("[pear](:ref:Fruit)"));
});

await Check("create location lease and readable collision-safe paths", async () =>
{
    var path = Workspace("locations"); var repository = new MarkdownWorkspaceRepository(path); using var service = new KnowledgeService(repository);
    var operation = Op();
    using (repository.BeginNewNoteLocation(operation, "人物/Chapter"))
    {
        Equal("committed", (await service.CreateNoteAsync(operation, "Triensa", "body")).Status);
        await Create(service, "Independent", "different operation");
    }
    True(File.Exists(Path.Combine(path, "人物", "Chapter", "Triensa.md")));
    True(File.Exists(Path.Combine(path, "Independent.md")));
    var collision = Op();
    using (repository.BeginNewNoteLocation(collision, "人物/Chapter"))
        Equal("committed", (await service.CreateNoteAsync(collision, "Triensa", "second body")).Status);
    Equal(2, Directory.GetFiles(Path.Combine(path, "人物", "Chapter"), "Triensa*.md").Length);
    await Create(service, "CON", "reserved name"); True(File.Exists(Path.Combine(path, "_CON.md")));
    try { using var bad = repository.BeginNewNoteLocation(Op(), "../escape"); throw new Exception("Unsafe parent accepted"); }
    catch (ArgumentException) { }
});

Console.WriteLine($"Markdown workspace: {passed} passed, {failed} failed. Evidence workspace: {testRoot}");
return failed == 0 ? 0 : 1;
