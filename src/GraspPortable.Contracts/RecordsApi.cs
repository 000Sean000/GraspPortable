namespace GraspPortable.Contracts;

public record RecordOptionDto(string Id, string DisplayName);
public record RecordFieldSchemaDto(string Id, string Key, string DisplayName, string Kind, RecordOptionDto[]? Options = null);
public record CollectionSummaryDto(string Id, string NoteId, string Title, int RecordCount, int FieldCount, long Revision, bool HasDraft, string SourceStatus);
public record RecordChoiceDto(string Id, string Key, string DisplayName, string CollectionId);
public record RecordTypedValueDto(string Kind, bool IsNull, string? Text = null, string? Coefficient = null, int? Scale = null,
    bool? Boolean = null, string? Date = null, string[]? Ids = null, string[]? Tags = null);
public record RecordCellDto(string FieldId, string RawSource, string? ComputedMarkdown, bool IsNull, string Status,
    bool CanEditShared, RecordTypedValueDto? TypedValue, DiagnosticDto[] Diagnostics,
    ReferenceDto[]? References = null, RegionDto[]? Regions = null);
public record RecordRowDto(string Id, string Key, string DisplayName, RecordCellDto[] Cells);
public record RecordSortDto(string FieldId, bool Descending = false);
public record RecordFilterDto(string FieldId, string Operator, string Value = "");
public record RecordViewDto(string Id, string Name, string[] ColumnOrder, int FrozenRows = 1, int FrozenColumns = 1,
    string Search = "", RecordSortDto[]? Sort = null, RecordFilterDto[]? Filters = null);
public record CollectionDto(string Id, string NoteId, string Title, long Revision, long NoteRevision, string SourceStatus, bool HasDraft,
    RecordFieldSchemaDto[] Fields, RecordRowDto[] Rows, RecordChoiceDto[] RelationChoices, RecordViewDto[] Views, DiagnosticDto[] Diagnostics);
public record CreateCollectionRequest(string OperationId, long ExpectedKnowledgeRevision, string Title,
    string RecordKey = "Record1", string RecordTitle = "第一筆", RecordFieldSchemaDto[]? Fields = null, string ParentPath = "");
public record AddRecordRequest(string OperationId, long ExpectedKnowledgeRevision, string Key, string DisplayName);
public record UpsertRecordFieldRequest(string OperationId, long ExpectedKnowledgeRevision, RecordFieldSchemaDto Field, bool ConfirmRename = false);
public record RenameRecordRequest(string OperationId, long ExpectedKnowledgeRevision, string Key, string DisplayName, bool ConfirmRename = false);
/// <summary>Raw Markdown is the single value carrier. IsNull distinguishes absence from empty/zero/false.</summary>
public record RecordFieldChangeRequest(string OperationId, long ExpectedKnowledgeRevision, string RawSource, bool IsNull = false, bool ConfirmRename = false,
    RecordTypedValueDto? TypedValue = null);
public record SaveRecordViewRequest(string OperationId, long ExpectedKnowledgeRevision, RecordViewDto View);
