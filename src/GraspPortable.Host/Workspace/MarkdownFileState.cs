using GraspPortable.Core.Knowledge;

namespace GraspPortable.Host.Workspace;

public sealed record MarkdownFileState(string DocumentId, string NoteId, string RelativePath, string Text,
    string ByteHash, string EncodingName, bool HasBom, bool IsManaged, bool Exists = true);
public sealed record MarkdownScanIssue(string RelativePath, string Code, string Message, string? NoteId = null,
    string? ObservedByteHash = null, string? PreservedRelativePath = null);
public sealed record MarkdownScanBatch(IReadOnlyList<MarkdownFileState> States, IReadOnlyList<ExternalNoteChange> Changes,
    IReadOnlyList<MarkdownScanIssue> Issues, IReadOnlyList<string> MissingNoteIds);
