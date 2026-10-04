namespace GraspPortable.Contracts;

public sealed record RecordImportFieldMapping(int ColumnIndex, string Key, string DisplayName, string Kind = "Markdown");
public sealed record RecordImportPreviewRequest(string SourceNoteId, int TableIndex = 0, string Title = "",
    string RecordKeyPrefix = "Imported", RecordImportFieldMapping[]? FieldMappings = null);
public sealed record RecordImportColumn(int ColumnIndex, string SourceHeader, string Key, string DisplayName, string Kind);
public sealed record RecordImportHeadingMap(int RowIndex, int ColumnIndex, int OriginalStart, int OriginalLength,
    int ConvertedStart, int ConvertedLength, int OriginalLevel, int? ConvertedLevel, int ListDepth);
public sealed record RecordImportPreview(string PreviewId, string SourceNoteId, long Revision, long SourceRevision,
    int TableIndex, int TableCount, string Title, string RecordKeyPrefix, RecordImportColumn[] Columns, int RowCount,
    string[][] SampleRows, RecordImportHeadingMap[] HeadingMaps, string[] Warnings, bool CanApply);
public sealed record RecordImportApplyRequest(string OperationId, string PreviewId);
