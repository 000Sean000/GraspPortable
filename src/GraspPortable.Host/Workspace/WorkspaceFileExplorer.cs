using GraspPortable.Contracts;
using GraspPortable.Host.Workspace.FileOperations;

namespace GraspPortable.Host.Workspace;

/// <summary>Reads actual directories. Folder layout never changes record or note identity.</summary>
public sealed class WorkspaceFileExplorer(string workspaceRoot, Func<IReadOnlyList<MarkdownFileState>> sourceFiles)
{
    private readonly WorkspaceFilePaths paths = new(workspaceRoot);
    private static readonly HashSet<string> InternalDirectories = new(StringComparer.OrdinalIgnoreCase) { ".grasp", ".git", ".obsidian", "artifacts" };
    private static bool Visible(string path)
    {
        var name = Path.GetFileName(path);
        return !InternalDirectories.Contains(name) && name != ".grasp.lock"
            && !name.StartsWith("workspace.grasp.db", StringComparison.OrdinalIgnoreCase);
    }

    public WorkspaceFilePage Read(string? parentPath, int offset = 0, int limit = 100, string? search = null,
        CancellationToken cancellationToken = default)
    {
        var parent = string.IsNullOrEmpty(parentPath) ? "" : paths.NormalizeUserPath(parentPath);
        var directory = parent.Length == 0 ? paths.Root : paths.Resolve(parent);
        if(!Directory.Exists(directory)) throw new KeyNotFoundException("資料夾不存在，請重新整理。");
        offset = Math.Max(0, offset); limit = Math.Clamp(limit, 1, 200);
        var byPath = sourceFiles().Where(f => f.Exists).ToDictionary(f => f.RelativePath, StringComparer.OrdinalIgnoreCase);
        var entries = new List<WorkspaceFileEntry>();
        var pending = new Stack<string>(); pending.Push(directory);
        while(pending.TryPop(out var folder))
        {
            cancellationToken.ThrowIfCancellationRequested();
            foreach(var fullPath in Directory.EnumerateFileSystemEntries(folder))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if(!Visible(fullPath)) continue;
                var attributes = File.GetAttributes(fullPath);
                var isDirectory = (attributes & FileAttributes.Directory) != 0;
                var isLink = (attributes & FileAttributes.ReparsePoint) != 0;
                var relative = Path.GetRelativePath(paths.Root, fullPath).Replace('\\', '/');
                var name = Path.GetFileName(fullPath);
                if(!string.IsNullOrWhiteSpace(search) && isDirectory && !isLink) pending.Push(fullPath);
                if(!string.IsNullOrWhiteSpace(search) && !relative.Contains(search, StringComparison.OrdinalIgnoreCase)) continue;
                entries.Add(new(relative, name, isDirectory, byPath.GetValueOrDefault(relative)?.NoteId,
                    isDirectory && !isLink && Directory.EnumerateFileSystemEntries(fullPath).Any(Visible)));
            }
            if(string.IsNullOrWhiteSpace(search)) break;
        }
        var page = entries.OrderByDescending(e => e.IsDirectory).ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.RelativePath, StringComparer.Ordinal).Skip(offset).Take(limit).ToArray();
        return new(parent, page, entries.Count, offset, limit);
    }

    public string ResolveUserPath(string relativePath) => paths.Resolve(paths.NormalizeUserPath(relativePath));
}
