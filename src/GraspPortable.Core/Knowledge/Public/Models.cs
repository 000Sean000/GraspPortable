using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Knowledge;

public record Note(string Id, string Title, string Source, long Revision, ParseResult Syntax, ParseDiagnostic[] Diagnostics);
public record KnowledgeDefinition(string Id, string NoteId, string Name, string? Value, string Status, bool IsLiteral,
    SourceSpan Span, SourceSpan NameSpan, string? LastGoodValue, long? LastGoodRevision);
public record Draft(string NoteId, string SessionId, long Revision, long BaseNoteRevision, string Title, string Source);
public record Snapshot(string WorkspaceId, long Revision, long PolicyRevision, string[] Languages,
    IReadOnlyDictionary<string, Note> Notes, IReadOnlyDictionary<string, KnowledgeDefinition> Definitions);
public record Receipt(string OperationId, string Fingerprint, string Status, long Revision, string? NoteId = null,
    string? Message = null, ParseDiagnostic[]? Diagnostics = null, string[]? AffectedNoteIds = null);
public record Impact(long Revision, string[] NoteIds, int Definitions, int References, bool HasDirtyDraft, string? Message = null);
public record CommitIntent(string OperationId, string NoteId, string SessionId, long DraftRevision,
    long ExpectedNoteRevision, long ExpectedKnowledgeRevision, bool ConfirmRename = false);
public record ChangeNotice(long Revision, string[] NoteIds, long PolicyRevision);

public interface IWorkspaceRepository : IDisposable
{
    Snapshot Load();
    IReadOnlyList<Draft> LoadDrafts();
    Receipt? FindReceipt(string operationId);
    void SaveDraft(Draft draft);
    // Snapshot, read models, receipt, and consumed draft form one SQLite transaction.
    void Commit(Snapshot previous, Snapshot next, Receipt receipt, string? consumedDraftNoteId);
}
