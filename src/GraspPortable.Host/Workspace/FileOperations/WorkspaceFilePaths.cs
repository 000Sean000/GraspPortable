namespace GraspPortable.Host.Workspace.FileOperations;

/// <summary>
/// Rejects traversal, reserved names and existing reparse points. Checks are
/// repeated at I/O boundaries, but are not a defense against a hostile process
/// concurrently substituting directory entries (filesystem namespace TOCTOU).
/// </summary>
internal sealed class WorkspaceFilePaths
{
    public string Root { get; }
    public WorkspaceFilePaths(string root)
    {
        Root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        EnsureNoReparse(Root);
        Directory.CreateDirectory(Root);
        EnsureNoReparse(Root);
    }

    public string NormalizeUserPath(string relative)
    {
        if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative) || relative.Contains(':'))
            throw new ArgumentException("A workspace-relative file path is required.", nameof(relative));
        var parts = relative.Replace('\\', '/').Split('/');
        foreach (var part in parts)
        {
            if (part.Length == 0 || part is "." or ".." || part.EndsWith(' ') || part.EndsWith('.')
                || part.Any(c => c < 32 || "<>:\"|?*".Contains(c)))
                throw new ArgumentException("Unsafe file path segment.", nameof(relative));
            var stem = part.Split('.')[0].ToUpperInvariant();
            if (stem is "CON" or "PRN" or "AUX" or "NUL" || (stem.Length == 4
                && (stem.StartsWith("COM", StringComparison.Ordinal) || stem.StartsWith("LPT", StringComparison.Ordinal))
                && stem[3] is >= '1' and <= '9'))
                throw new ArgumentException("Reserved Windows file name.", nameof(relative));
        }
        if (parts[0].Equals(".grasp", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("The .grasp directory is reserved for recovery metadata.", nameof(relative));
        var normalized = string.Join('/', parts);
        _ = Resolve(normalized);
        return normalized;
    }

    public string Resolve(string relative)
    {
        var full = Path.GetFullPath(Path.Combine(Root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Path escapes the workspace.", nameof(relative));
        EnsureNoReparse(full);
        return full;
    }

    public void EnsureDirectory(string relative)
    {
        var path = Resolve(relative);
        Directory.CreateDirectory(path);
        EnsureNoReparse(path);
    }

    public static void EnsureNoReparse(string path)
    {
        for (string? current = path; current is not null; current = Path.GetDirectoryName(current))
        {
            try
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException($"Reparse points and symbolic links are not supported: {current}");
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
        }
    }
}
