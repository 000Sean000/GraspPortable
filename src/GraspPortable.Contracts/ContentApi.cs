namespace GraspPortable.Contracts;

public record ContentResolveRequest(string OriginNoteId, string Target, bool IsWiki = false);
public record ContentLinkDto(string Status, string? NoteId = null, string? Anchor = null, string? Message = null, string? RelativePath = null);
public record ContentImageDto(string Status, string? DataUrl = null, string? Message = null);
