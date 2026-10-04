namespace GraspPortable.Contracts;

public sealed record GroupingSplitTarget(string NoteId, string RelativePath);
public sealed record GroupingPreviewRequest(string Action, string[] SourcePaths, string? DestinationPath = null,
    GroupingSplitTarget[]? SplitTargets = null, string? PreservationPath = null);
public sealed record GroupingMemberDto(string NoteId, string Title, string SourcePath, string DestinationPath, string? Anchor);
public sealed record GroupingPreview(string PreviewId, long Revision, GroupingMemberDto[] Members,
    FileActionChange[] Changes, string[] Warnings, bool CanApply);
public sealed record GroupingApplyRequest(string OperationId, string PreviewId);
public sealed record GroupingSourceDto(string RelativePath, bool IsGrouped, NoteSummary[] Members);
