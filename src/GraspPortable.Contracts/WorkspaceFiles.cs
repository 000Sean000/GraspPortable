namespace GraspPortable.Contracts;

public record WorkspaceFileEntry(string RelativePath, string Name, bool IsDirectory,
    string? NoteId = null, bool HasChildren = false, bool IsMissing = false);
public record WorkspaceFilePage(string ParentPath, WorkspaceFileEntry[] Entries, int Total, int Offset, int Limit);

public record WorkspaceSourceIssue(string RelativePath, string Code, string Message, string? NoteId = null);
public record WorkspaceSourceStatus(bool WritesBlocked, WorkspaceSourceIssue[] Issues, DateTimeOffset? LastScan);

public record FileActionPreviewRequest(string Action, string SourcePath, string DestinationPath);
public record FileActionChange(string Path, string? NewPath, string Kind);
public record FileActionPreview(string PreviewId, long Revision, FileActionChange[] Changes, string[] Warnings, bool CanApply);
public record FileActionApplyRequest(string OperationId, string PreviewId);
