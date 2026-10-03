namespace GraspPortable.Host.Workspace.Backups;

public sealed record BackupProblem(string Code, string Path, string Message);
public sealed record BackupCaptureResult(string Status, string? GenerationPath, BackupProblem[] Problems);
public sealed record BackupVerificationResult(bool Valid, string? WorkspaceId, BackupProblem[] Problems);
public sealed record BackupRestoreResult(string Path, BackupProblem[] Problems);
public sealed record BackupGeneration(string Path, string WorkspaceId, DateTimeOffset CreatedAt, int FileCount);

internal sealed record BackupEntry(string Path, long Length, string Sha256);
internal sealed record BackupInventory(BackupEntry[] Files, string[] Directories);
internal sealed record BackupManifest(int Format, string WorkspaceId, DateTimeOffset CreatedAt, BackupInventory Content);
internal sealed record BackupPublished(int Format, string ManifestSha256);
internal sealed record RestoreReceipt(int Format, string OperationId, string SourceGeneration, string Target,
    string ManifestSha256, BackupRestoreResult Result);
