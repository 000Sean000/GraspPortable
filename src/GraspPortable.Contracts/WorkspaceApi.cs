namespace GraspPortable.Contracts;

public static class Protocol { public const int Version = 3; }
public record WorkspaceInfo(string WorkspaceId, string Path, long Revision, long PolicyRevision, string[] EnabledFenceLanguages, int ProtocolVersion = Protocol.Version, string? MigratedFrom = null);
public record NoteSummary(string Id, string Title, long Revision, bool HasDraft);
public record DiagnosticDto(string Code, string Message, int Start = 0, int Length = 0);
public record DefinitionDto(string Id, string NoteId, string Name, string? Value, string Status, bool IsLiteral, int Start, int Length, int NameStart, int NameLength, string? LastGoodValue = null);
public record ReferenceDto(string NoteId, string Name, string Kind, string CachedValue, int Start, int Length, int ValueStart, int ValueLength);
public record DraftDto(string SessionId, long Revision, long BaseNoteRevision, string Source, string Title, string? BaseSourceHash = null);
public record RegionDto(int Start, int Length, bool IsComplete);
public record NoteDto(string Id, string Title, string Source, long Revision, long KnowledgeRevision, DraftDto? Draft, DefinitionDto[] Definitions, ReferenceDto[] References, DiagnosticDto[] Diagnostics, RegionDto[]? Regions = null,
    string? SourceHash = null, string SourceStatus = "accepted", string? RelativePath = null);
public record CreateNoteRequest(string OperationId, string Title, string Source = "", string ParentPath = "");
public record SaveDraftRequest(string SessionId, long DraftRevision, long BaseNoteRevision, string Title, string Source, string? BaseSourceHash = null);
public record CommitNoteRequest(string OperationId, string SessionId, long DraftRevision, long ExpectedNoteRevision, long ExpectedKnowledgeRevision, bool ConfirmRename = false);
public record OperationResult(string OperationId, string Status, long Revision, string? NoteId = null, string? Message = null, DiagnosticDto[]? Diagnostics = null, string[]? AffectedNoteIds = null);
public record LiteralChangeRequest(string OperationId, long ExpectedKnowledgeRevision, string Value);
public record ImpactDto(long Revision, string[] NoteIds, int Definitions, int References, bool HasDirtyDraft, string? Message = null);
public record PolicyRequest(string OperationId, long ExpectedKnowledgeRevision, string[] EnabledFenceLanguages);
public record RevisionEvent(long Revision, string[] NoteIds, long PolicyRevision);
public record ApiError(string Message);
