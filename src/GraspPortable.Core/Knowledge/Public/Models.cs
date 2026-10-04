using GraspPortable.Core.ValueEngine;
using GraspPortable.Core.Records;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace GraspPortable.Core.Knowledge;

// Source/Syntax remain the last accepted semantic snapshot. SavedSource is the
// independently saved, possibly incomplete text; ranges from the two never mix.
public record SavedNoteSource(string Text, string Status, ParseDiagnostic[] Diagnostics, RecordsDocumentDescriptor? Records = null)
{
    [JsonIgnore] public string Hash => SourceHash(Text);
    public static string SourceHash(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
}
public record Note(string Id, string Title, string Source, long Revision, ParseResult Syntax, ParseDiagnostic[] Diagnostics,
    SavedNoteSource? SavedSource = null, RecordsDocumentDescriptor? Records = null)
{
    [JsonIgnore] public string CurrentSource => SavedSource?.Text ?? Source;
    [JsonIgnore] public string CurrentSourceHash => SavedNoteSource.SourceHash(CurrentSource);
    [JsonIgnore] public bool IsSourceStale => SavedSource is { Status: not "accepted" };
    [JsonIgnore] public RecordsDocumentDescriptor? CurrentRecords => SavedSource is null ? Records : SavedSource.Records;
}
public record KnowledgeDefinition(string Id, string NoteId, string Name, string? Value, string Status, bool IsLiteral,
    SourceSpan Span, SourceSpan NameSpan, string? LastGoodValue, long? LastGoodRevision, FieldDefinitionOrigin? FieldOrigin = null);
public record Draft(string NoteId, string SessionId, long Revision, long BaseNoteRevision, string Title, string Source,
    string? BaseSourceHash = null);
public record Snapshot(string WorkspaceId, long Revision, long PolicyRevision, string[] Languages,
    IReadOnlyDictionary<string, Note> Notes, IReadOnlyDictionary<string, KnowledgeDefinition> Definitions);
public record Receipt(string OperationId, string Fingerprint, string Status, long Revision, string? NoteId = null,
    string? Message = null, ParseDiagnostic[]? Diagnostics = null, string[]? AffectedNoteIds = null);
public record Impact(long Revision, string[] NoteIds, int Definitions, int References, bool HasDirtyDraft, string? Message = null);
public record CommitIntent(string OperationId, string NoteId, string SessionId, long DraftRevision,
    long ExpectedNoteRevision, long ExpectedKnowledgeRevision, bool ConfirmRename = false);
public record ChangeNotice(long Revision, string[] NoteIds, long PolicyRevision);
public record ExternalNoteChange(string NoteId, string Title, string Source, string? ExpectedSourceHash,
    IReadOnlyDictionary<string, string>? DefinitionIds = null, RecordsDocumentDescriptor? Records = null);

public interface IWorkspaceRepository : IDisposable
{
    bool UsesSavedSourceAuthority => false;
    Snapshot Load();
    IReadOnlyList<Draft> LoadDrafts();
    Receipt? FindReceipt(string operationId);
    void SaveDraft(Draft draft);
    // The adapter durably publishes the snapshot, receipt, and consumed draft.
    // Markdown adapters also journal physical files; this is not multi-file ACID.
    void Commit(Snapshot previous, Snapshot next, Receipt receipt, string? consumedDraftNoteId);
}
