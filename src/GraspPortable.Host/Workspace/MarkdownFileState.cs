using GraspPortable.Core.Knowledge;
using System.Text.Json.Serialization;

namespace GraspPortable.Host.Workspace;

public sealed record MarkdownFileState(string DocumentId, string NoteId, string RelativePath, string Text,
    string ByteHash, string EncodingName, bool HasBom, bool IsManaged, bool Exists = true,
    IReadOnlyList<string>? MemberNoteIds = null, bool IsGrouped = false)
{
    // NoteId remains the primary Explorer anchor; ownership always uses NoteIds.
    [JsonIgnore] public IReadOnlyList<string> NoteIds => MemberNoteIds ?? [NoteId];
}
public sealed record MarkdownScanIssue(string RelativePath, string Code, string Message, string? NoteId = null,
    string? ObservedByteHash = null, string? PreservedRelativePath = null);
public sealed record MarkdownScanBatch(IReadOnlyList<MarkdownFileState> States, IReadOnlyList<ExternalNoteChange> Changes,
    IReadOnlyList<MarkdownScanIssue> Issues, IReadOnlyList<string> MissingNoteIds);
