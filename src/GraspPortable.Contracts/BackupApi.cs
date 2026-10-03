namespace GraspPortable.Contracts;

public record BackupOptionsDto(long Version, int IntervalMinutes = 5, int RetainedCopies = 3);
public record BackupGenerationDto(string Path, DateTimeOffset CreatedAt, int FileCount);
public record BackupIssueDto(string Code, string Path, string Message);
public record BackupStatusDto(BackupOptionsDto Options, BackupGenerationDto[] Generations, string Status, BackupIssueDto[] Issues);
public record BackupSettingsRequest(string OperationId, long ExpectedVersion, int IntervalMinutes, int RetainedCopies);
public record CheckpointRequest(string OperationId, bool OnlyIfChanged = false);
public record RestoreBackupRequest(string OperationId, string GenerationPath, string DestinationPath);
public record BackupResultDto(string OperationId, string Status, string? Path, BackupIssueDto[] Issues);
