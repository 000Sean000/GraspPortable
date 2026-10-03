namespace GraspPortable.Host.Workspace.FileOperations;

/// <param name="ExpectedSha256">Null means that the path must be absent.</param>
/// <param name="NextContent">Null deletes the file; an empty array writes an empty file.</param>
public sealed record FileMutation(string RelativePath, string? ExpectedSha256, byte[]? NextContent);

public sealed record PreparedFileChange(string RelativePath, string? ExpectedSha256, string? BeforeSha256, string? DesiredSha256);
public sealed record FileOperationManifest(int FormatVersion, Guid OperationId, string PayloadSha256,
    DateTimeOffset PreparedAt, IReadOnlyList<PreparedFileChange> Files);
public enum FileOperationPhase { Prepared, PartiallyWritten, FilesWritten, SemanticFinalized, Conflict }
public enum FileVersionState { Expected, Desired, Unexpected }
public sealed record FileProgress(string RelativePath, string? CurrentSha256, FileVersionState State);
public sealed record FileConflict(string RelativePath, string Reason, string? ObservedSha256, string? PreservedRelativePath,
    bool ObservedAfterFilesWritten = false);
/// <summary>Conflicts retain audit evidence after finalization; Phase determines whether they still block the operation.</summary>
public sealed record FileOperationReport(Guid OperationId, string PayloadSha256, FileOperationPhase Phase,
    bool FilesWritten, string? SemanticReceipt, IReadOnlyList<FileProgress> Files, IReadOnlyList<FileConflict> Conflicts);
public sealed record FileOperationCheckpoint(Guid OperationId, string RelativePath, string Stage);

internal sealed record MutationAttempt(int Index, Guid AttemptId);
internal sealed record CompletionMarker(string PayloadSha256, string? Receipt = null);
