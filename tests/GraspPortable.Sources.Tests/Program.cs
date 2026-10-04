using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Workspace;

try
{
var repositoryRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
var workspace = Path.Combine(repositoryRoot, "workspaces", "sources-" + Guid.NewGuid().ToString("N"));
var count = 0;
void Check(bool pass, string label) { if(!pass) throw new Exception(label); Console.WriteLine("PASS: " + label); count++; }
string Op() => Guid.NewGuid().ToString("N");
var repository = new SqliteWorkspaceRepository(workspace);
var service = new KnowledgeService(repository);
async Task<string> Create(string title, string source)
{ var result = await service.CreateNoteAsync(Op(), title, source); Check(result.Status == "committed", "created " + title); return result.NoteId!; }
ExternalNoteChange Change(string id, string source) => new(id, service.Current.Notes[id].Title, source, service.Current.Notes[id].CurrentSourceHash);
var owner = await Create("owner", "@code{ @Fruit = {apple} @Label = {A } + Fruit }");
var refs = await Create("references", "[old](:ref:Fruit)\n\n[[@Label|old]]");
var independent = await Create("independent", "@code{ @Other = {one} }");
var fruit = service.Current.Definitions.Values.Single(d => d.Name == "Fruit");
var beforeInvalid = service.Current.Notes[owner];
var broken = beforeInvalid.Source + "\n@code{ @Incomplete = {";
var result = await service.ObserveExternalAsync(Op(), [Change(owner, broken)]);
Check(result.Status == "source-observed" && service.Current.Notes[owner].CurrentSource == broken, "incomplete observed source is preserved");
Check(service.Current.Notes[owner].Source == beforeInvalid.Source && service.Current.Notes[owner].Syntax.IsValid, "accepted source and AST remain paired");
Check(service.Current.Definitions[fruit.Id].Status == "Stale" && service.Current.Definitions[fruit.Id].Value is null && service.Current.Definitions[fruit.Id].LastGoodValue == "apple", "old value is explicitly stale, identity retained");
Check(service.Current.Definitions.Values.Single(d => d.Name == "Label").Status == "Stale", "all definitions in invalid document are withheld");
Check(service.Current.Notes[refs].Source.Contains("[apple](:ref:Fruit)"), "stale value does not replace reference cache");
var other = service.Current.Definitions.Values.Single(d => d.Name == "Other");
Check((await service.ChangeLiteralAsync(Op(), other.Id, service.Current.Revision, "two")).Status == "committed", "unrelated valid changes continue while source is invalid");
Check(service.Current.Notes[owner].CurrentSource == broken, "unrelated prepare does not patch invalid raw source");
var savedSource = service.Current.Notes[owner];
service.Dispose();
repository = new SqliteWorkspaceRepository(workspace); service = new(repository);
Check(service.Current.Notes[owner].CurrentSource == broken && service.Current.Definitions[fruit.Id].Status == "Stale", "raw and accepted snapshots survive SQLite reopen");
result = await service.ObserveExternalAsync(Op(), [new(owner, "owner", beforeInvalid.Source, beforeInvalid.CurrentSourceHash)]);
Check(result.Status == "conflict" && service.Current.Notes[owner].CurrentSource == broken, "old semantic hash cannot overwrite new invalid raw source");
result = await service.ObserveExternalAsync(Op(), [Change(owner, beforeInvalid.Source.Replace("apple", "pear"))]);
Check(result.Status == "source-observed" && !service.Current.Notes[owner].IsSourceStale && service.Current.Definitions[fruit.Id].Value == "pear", "fixed external source reaccepts same definition identity");
Check(service.Current.Notes[refs].Source.Contains("[pear](:ref:Fruit)"), "fixed source updates dependent cache");

var referenceBefore = service.Current.Notes[refs];
var literalBefore = service.Current.Notes[owner];
var referenceExternal = referenceBefore.Source.Replace("[pear]", "[banana]");
result = await service.ObserveExternalAsync(Op(), [Change(refs, referenceExternal)]);
Check(service.Current.Definitions[fruit.Id].Value == "banana", "unique external reference edit updates source literal");
Check(service.Current.Notes[owner].Source.Contains("{banana}") && service.Current.Notes[refs].Source.Contains("A banana"), "shared edit uses literal serializer and updates composition");

var wholeBefore = service.Current.Notes[refs].Source;
var mixedShared = wholeBefore.Replace("[banana]", "[kiwi]").Replace("|A banana]]", "|new composition]]");
result = await service.ObserveExternalAsync(Op(), [Change(refs, mixedShared)]);
Check(service.Current.Notes[refs].IsSourceStale && service.Current.Definitions[fruit.Id].Value == "banana", "one nonliteral shared target prevents partial mutation of another literal");
Check(service.Current.Notes[refs].CurrentSource == mixedShared, "conflicting shared batch keeps full observed source");
await service.ObserveExternalAsync(Op(), [Change(refs, wholeBefore)]);

var raceReference = service.Current.Notes[refs].Source.Replace("[banana]", "[lemon]");
var raceOwner = service.Current.Notes[owner].Source.Replace("{banana}", "{orange}");
result = await service.ObserveExternalAsync(Op(), [Change(owner, raceOwner), Change(refs, raceReference)]);
Check(service.Current.Notes[refs].IsSourceStale && service.Current.Notes[refs].CurrentSource == raceReference, "contradictory source/ref intent retains external reference version");
Check(service.Current.Definitions[fruit.Id].Value == "orange", "direct owner edit is not overwritten by conflicting shared intent");
// Explicitly resolve the reference raw text using current source as the new base.
await service.ObserveExternalAsync(Op(), [Change(refs, service.Current.Notes[refs].Source)]);

var note = service.Current.Notes[owner];
var draft = new Draft(owner, "session", 1, note.Revision, note.Title, note.Source + "\nlocal draft", note.CurrentSourceHash);
await service.SaveDraftAsync(draft);
var rawWithDraft = note.Source.Replace("orange", "grape");
result = await service.ObserveExternalAsync(Op(), [Change(owner, rawWithDraft)]);
Check(service.GetDraft(owner) == draft && service.Current.Notes[owner].CurrentSource == rawWithDraft, "external raw and local dirty draft are both retained");
Check(service.Current.Notes[owner].SavedSource?.Status == "conflict" && service.Current.Definitions[fruit.Id].Status == "Stale", "dirty conflict is not fresh semantics");
var refused = await service.CommitNoteAsync(new(Op(), owner, draft.SessionId, draft.Revision, draft.BaseNoteRevision, service.Current.Revision));
Check(refused.Status == "conflict" && service.GetDraft(owner) == draft, "stale draft cannot overwrite observed source");
var operation = Op();
var duplicateSource = "@code{ @Other = {duplicate} }";
var newId = Op();
var duplicate = new ExternalNoteChange(newId, "duplicate", duplicateSource, null);
result = await service.ObserveExternalAsync(operation, [duplicate]);
Check(result.Status == "source-observed" && service.Current.Notes[newId].CurrentSource == duplicateSource && service.Current.Notes[newId].IsSourceStale, "duplicate external definition preserves raw without stealing name");
Check(service.Current.Definitions[other.Id].Value == "two", "duplicate source does not disturb unrelated accepted definition");
var revision = service.Current.Revision;
Check((await service.ObserveExternalAsync(operation, [duplicate])).Revision == revision && service.Current.Revision == revision, "observed operation retry is idempotent");

var unrelatedRaw = service.Current.Notes[independent].Source.Replace("{two}", "{three}");
var anotherDuplicate = new ExternalNoteChange(Op(), "another duplicate", duplicateSource, null);
await service.ObserveExternalAsync(Op(), [anotherDuplicate, Change(independent, unrelatedRaw)]);
Check(service.Current.Definitions[other.Id].Value == "three" && !service.Current.Notes[independent].IsSourceStale, "semantic duplicate is isolated from unrelated observed changes");
var shortBad = "@code{";
await service.ObserveExternalAsync(Op(), [Change(independent, shortBad)]);
Check(service.Current.Notes[independent].Diagnostics.All(d => d.Span.Start >= 0 && d.Span.End <= shortBad.Length), "diagnostics never use old AST ranges against shorter observed text");

var sameUuid = Guid.NewGuid();
var firstIdentity = new ExternalNoteChange(Op(), "identity one", "@code{ @IdA = {a} }", null,
    new Dictionary<string,string> { ["IdA"] = sameUuid.ToString("N") });
var secondIdentity = new ExternalNoteChange(Op(), "identity two", "@code{ @IdB = {b} }", null,
    new Dictionary<string,string> { ["IdB"] = sameUuid.ToString("D").ToUpperInvariant() });
await service.ObserveExternalAsync(Op(), [firstIdentity, secondIdentity]);
Check(!service.Current.Definitions.Values.Any(d => d.Name is "IdA" or "IdB"), "different UUID spellings cannot bypass identity uniqueness");
Check(service.Current.Notes[firstIdentity.NoteId].CurrentSource == firstIdentity.Source && service.Current.Notes[secondIdentity.NoteId].CurrentSource == secondIdentity.Source, "duplicate UUID preserves both original sources");

var deleteOwner = await Create("delete owner", "@code{ @DeleteValue = {before delete} }");
var deleteDependent = await Create("delete dependent", "@code{ @AfterDelete = DeleteValue + {!} }\n\n[old](:ref:DeleteValue)");
var obsoleteDeleteHash = service.Current.Notes[deleteOwner].CurrentSourceHash;
await service.ObserveExternalAsync(Op(), [Change(deleteOwner, "@code{ @DeleteValue = {latest before delete} }")]);
var beforeRefusedDeletion = service.Current.Revision;
result = await service.ObserveDeletedAsync(Op(), new Dictionary<string,string> { [deleteOwner] = obsoleteDeleteHash });
Check(result.Status == "conflict" && service.Current.Revision == beforeRefusedDeletion && service.Current.Notes.ContainsKey(deleteOwner), "stale deletion source hash cannot remove a newer source");
var deleteOperation = Op();
var deletionGuards = new Dictionary<string,string> { [deleteOwner] = service.Current.Notes[deleteOwner].CurrentSourceHash };
result = await service.ObserveDeletedAsync(deleteOperation, deletionGuards);
Check(result.Status == "source-observed" && !service.Current.Notes.ContainsKey(deleteOwner), "clean external deletion removes the note");
Check(!service.Current.Definitions.Values.Any(d => d.Name == "DeleteValue"), "clean deletion removes owned definitions");
Check(service.Current.Definitions.Values.Single(d => d.Name == "AfterDelete").Status == "Missing"
    && service.Current.Notes[deleteDependent].Diagnostics.Any(d => d.Code == "Missing"), "deleted definition makes dependent and reference explicitly missing");
Check(service.Current.Notes[deleteDependent].Source.Contains("[latest before delete](:ref:DeleteValue)"), "deletion preserves reference cached text without pretending it is current");
var deletionRevision = service.Current.Revision;
Check((await service.ObserveDeletedAsync(deleteOperation, deletionGuards)).Revision == deletionRevision && service.Current.Revision == deletionRevision, "deletion receipt retries without deleting again");

var dirtyDeleteOwner = await Create("dirty delete owner", "@code{ @DirtyMissing = {preserve me} }");
var dirtyDeleteBefore = service.Current.Notes[dirtyDeleteOwner];
var dirtyDeleteDraft = new Draft(dirtyDeleteOwner, "delete-draft", 1, dirtyDeleteBefore.Revision, dirtyDeleteBefore.Title,
    dirtyDeleteBefore.Source + "\nlocal unsaved prose", dirtyDeleteBefore.CurrentSourceHash);
await service.SaveDraftAsync(dirtyDeleteDraft);
result = await service.ObserveDeletedAsync(Op(), new Dictionary<string,string> { [dirtyDeleteOwner] = dirtyDeleteBefore.CurrentSourceHash });
Check(result.Status == "source-observed" && service.GetDraft(dirtyDeleteOwner) == dirtyDeleteDraft, "dirty deletion keeps the full app draft");
Check(service.Current.Notes[dirtyDeleteOwner].SavedSource?.Status == "missing"
    && service.Current.Notes[dirtyDeleteOwner].CurrentSource == dirtyDeleteBefore.CurrentSource, "dirty deletion retains last source with explicit missing state");
Check(service.Current.Definitions.Values.Single(d => d.Name == "DirtyMissing") is { Status: "Stale", Value: null, LastGoodValue: "preserve me" }, "dirty deletion withholds fresh semantics while retaining last good value");
Check((await service.CommitNoteAsync(new(Op(), dirtyDeleteOwner, dirtyDeleteDraft.SessionId, dirtyDeleteDraft.Revision,
    dirtyDeleteDraft.BaseNoteRevision, service.Current.Revision))).Status == "conflict", "pre-deletion draft cannot silently recreate a deleted source");
service.Dispose();
repository = new SqliteWorkspaceRepository(workspace); service = new(repository);
Check(!service.Current.Notes.ContainsKey(deleteOwner) && !service.Current.Definitions.Values.Any(d => d.Name == "DeleteValue"), "clean deletion survives SQLite reopen");
Check(service.GetDraft(dirtyDeleteOwner) == dirtyDeleteDraft && service.Current.Notes[dirtyDeleteOwner].SavedSource?.Status == "missing", "dirty deletion source and draft survive SQLite reopen");

service.Dispose();
var savedAuthorityWorkspace = workspace + "-saved-authority";
repository = new SqliteWorkspaceRepository(savedAuthorityWorkspace);
service = new(new SavedSourceAuthorityRepository(repository));
var savedOwner = await Create("saved owner", "@code{ @SavedValue = {valid before} }");
var savedRefs = await Create("saved references", "[old](:ref:SavedValue)");
var acceptedBeforeDraft = service.Current.Notes[savedOwner];
var savedIdentity = service.Current.Definitions.Values.Single(d => d.Name == "SavedValue").Id;
var invalidRaw = acceptedBeforeDraft.Source + "\r\n@code{ @Unfinished = {";
var invalidDraft = new Draft(savedOwner, "invalid-source", 1, acceptedBeforeDraft.Revision, "saved invalid title", invalidRaw, acceptedBeforeDraft.CurrentSourceHash);
Check((await service.SaveDraftAsync(invalidDraft)).Status == "draft", "invalid source draft is durable before explicit save");
var invalidIntent = new CommitIntent(Op(), savedOwner, invalidDraft.SessionId, invalidDraft.Revision, invalidDraft.BaseNoteRevision, service.Current.Revision);
result = await service.CommitNoteAsync(invalidIntent);
Check(result.Status == "source-saved" && service.GetDraft(savedOwner) is null, "saved-source authority saves invalid raw and consumes the persisted draft");
Check(service.Current.Notes[savedOwner].CurrentSource == invalidRaw && service.Current.Notes[savedOwner].SavedSource?.Status == "invalid", "invalid committed raw is preserved byte-for-character including CRLF");
Check(service.Current.Notes[savedOwner].Source == acceptedBeforeDraft.Source && service.Current.Notes[savedOwner].Syntax.IsValid, "invalid save retains accepted source and AST together");
Check(service.Current.Definitions[savedIdentity] is { Status: "Stale", Value: null, LastGoodValue: "valid before" }, "invalid save retains canonical identity and explicit last-good stale value");
Check(service.Current.Notes[savedRefs].Source.Contains("[valid before](:ref:SavedValue)"), "invalid save does not write a fabricated fresh reference value");
var invalidSavedRevision = service.Current.Revision;
Check((await service.CommitNoteAsync(invalidIntent)).Status == "source-saved" && service.Current.Revision == invalidSavedRevision, "source-saved receipt retries after draft consumption");
service.Dispose();
repository = new SqliteWorkspaceRepository(savedAuthorityWorkspace); service = new(new SavedSourceAuthorityRepository(repository));
Check(service.Current.Notes[savedOwner].CurrentSource == invalidRaw && service.Current.Definitions[savedIdentity].Status == "Stale"
    && service.GetDraft(savedOwner) is null, "invalid raw, stale semantics and consumed draft survive reopen");
Check((await service.CommitNoteAsync(invalidIntent)).Status == "source-saved" && service.Current.Revision == invalidSavedRevision, "durable source-saved receipt survives reopen");
var beforeRepair = service.Current.Notes[savedOwner];
var repairDraft = new Draft(savedOwner, "repair-source", 1, beforeRepair.Revision, beforeRepair.Title,
    acceptedBeforeDraft.Source.Replace("valid before", "fixed value"), acceptedBeforeDraft.CurrentSourceHash);
await service.SaveDraftAsync(repairDraft);
Check((await service.CommitNoteAsync(new(Op(), savedOwner, repairDraft.SessionId, repairDraft.Revision, beforeRepair.Revision, service.Current.Revision))).Status == "conflict",
    "repair must guard current saved raw hash rather than the older accepted hash");
repairDraft = repairDraft with { Revision = 2, BaseSourceHash = beforeRepair.CurrentSourceHash };
await service.SaveDraftAsync(repairDraft);
result = await service.CommitNoteAsync(new(Op(), savedOwner, repairDraft.SessionId, repairDraft.Revision, beforeRepair.Revision, service.Current.Revision));
Check(result.Status == "committed" && !service.Current.Notes[savedOwner].IsSourceStale && service.Current.Notes[savedOwner].SavedSource is null, "fixed source re-enters accepted semantics");
Check(service.Current.Definitions[savedIdentity] is { Status: "Valid", Value: "fixed value" }
    && service.Current.Notes[savedRefs].Source.Contains("[fixed value](:ref:SavedValue)"), "repair keeps identity and refreshes dependent reference cache");
service.Dispose();
Console.WriteLine($"PASS: {count} source consistency assertions. Workspace: {workspace}");

// Test-only capability wrapper; the concrete SQLite repository remains unchanged.
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;

sealed class SavedSourceAuthorityRepository(IWorkspaceRepository inner) : IWorkspaceRepository
{
    public bool UsesSavedSourceAuthority => true;
    public Snapshot Load() => inner.Load();
    public IReadOnlyList<Draft> LoadDrafts() => inner.LoadDrafts();
    public Receipt? FindReceipt(string operationId) => inner.FindReceipt(operationId);
    public void SaveDraft(Draft draft) => inner.SaveDraft(draft);
    public void Commit(Snapshot previous, Snapshot next, Receipt receipt, string? consumedDraftNoteId)
        => inner.Commit(previous, next, receipt, consumedDraftNoteId);
    public void Dispose() => inner.Dispose();
}
