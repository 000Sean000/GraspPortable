using GraspPortable.Contracts;
using GraspPortable.Host.Workspace.FileOperations;
using GraspPortable.Host.Workspace.Markdown;

namespace GraspPortable.Host.Workspace;

public sealed record WorkspaceContentSource(string NoteId, string RelativePath, bool IsGroupMember=false,
    string? PresentationAnchor=null, string[]? HeadingAnchors=null, bool IsPrimary=false);

/// <summary>Resolves local Markdown content without launching programs or making network requests.</summary>
public sealed class WorkspaceContentResolver
{
    private const int MaximumImageBytes = 8 * 1024 * 1024;
    private const int MaximumSearchEntries = 20_000;
    private readonly string root;
    private readonly Func<IReadOnlyList<WorkspaceContentSource>> sources;

    public WorkspaceContentResolver(string root, Func<IReadOnlyList<WorkspaceContentSource>> sources)
    {
        this.root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        WorkspaceFilePaths.EnsureNoReparse(this.root);
        this.sources = sources;
    }

    public ContentLinkDto ResolveLink(ContentResolveRequest request)
    {
        try
        {
            var resolved = Resolve(request);
            if (resolved.Status != "resolved") return new(resolved.Status, Anchor: resolved.Anchor, Message: resolved.Message);
            var targets=resolved.Sources.Where(s=>EqualPath(s.RelativePath,resolved.RelativePath!)).ToArray();
            var noteIds = targets.Select(s => s.NoteId).Distinct(StringComparer.Ordinal).ToArray();
            if(targets.Length>0 && targets.All(s=>s.IsGroupMember))
            {
                if(string.IsNullOrEmpty(resolved.Anchor))
                {
                    var primary=targets.Where(s=>s.IsPrimary).ToArray();
                    if(primary.Length==1)return new("resolved",primary[0].NoteId,RelativePath:resolved.RelativePath);
                }
                else
                {
                    var selected=targets.Where(s=>string.Equals(s.PresentationAnchor,resolved.Anchor,StringComparison.OrdinalIgnoreCase)
                        || s.HeadingAnchors?.Contains(resolved.Anchor,StringComparer.OrdinalIgnoreCase)==true).ToArray();
                    if(selected.Length==1)return new("resolved",selected[0].NoteId,
                        string.Equals(selected[0].PresentationAnchor,resolved.Anchor,StringComparison.OrdinalIgnoreCase)?null:resolved.Anchor,
                        RelativePath:resolved.RelativePath);
                }
                return new("ambiguous",Anchor:resolved.Anchor,Message:"無法唯一定位合併檔案中的標題，請從檔案中的筆記清單選擇。",RelativePath:resolved.RelativePath);
            }
            if (noteIds.Length > 1) return new("ambiguous", Anchor: resolved.Anchor, Message: "此路徑對應多個筆記身分，請先處理來源衝突。");
            if (resolved.RelativePath!.EndsWith(".md", StringComparison.OrdinalIgnoreCase) && noteIds.Length == 0)
                return new("missing", Anchor: resolved.Anchor, Message: "Markdown 檔案尚未由工作區辨識，請等待來源掃描。", RelativePath: resolved.RelativePath);
            return new("resolved", noteIds.FirstOrDefault(), resolved.Anchor, RelativePath: resolved.RelativePath);
        }
        catch (Exception error) when (Expected(error)) { return new("unsupported", Message: error.Message); }
    }

    public static IReadOnlyList<WorkspaceContentSource> DescribeSources(IReadOnlyList<MarkdownFileState> files,IReadOnlyList<string> languages)
    {
        var result=new List<WorkspaceContentSource>();
        foreach(var file in files.Where(f=>f.Exists))
        {
            if(!file.IsGrouped) { result.Add(new(file.NoteId,file.RelativePath)); continue; }
            var envelope=MarkdownEnvelopeCodec.Read(file.Text);
            if(!envelope.CanRewrite)continue;
            var group=GroupedNoteCodec.Parse(envelope.Body,file.NoteIds);
            if(!group.CanRewrite)continue;
            var physicalAnchors=GroupingLinks.FindHeadingAnchors(envelope.Body,languages).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var saved=GroupingMetadataCodec.ReadPresentationAnchors(file.Text);
            foreach(var member in group.Members)
            {
                var presentation=saved.GetValueOrDefault(member.NoteId);
                var prefix=envelope.Body[..member.FrameRange.Start].TrimEnd('\r','\n');
                var previousLine=prefix[(Math.Max(prefix.LastIndexOf('\n'),prefix.LastIndexOf('\r'))+1)..];
                if(presentation is not null && (previousLine!="## "+presentation || !physicalAnchors.Contains(presentation)))presentation=null;
                result.Add(new(member.NoteId,file.RelativePath,true,presentation,
                    GroupingLinks.FindHeadingAnchors(member.Body,languages).Where(physicalAnchors.Contains).ToArray(),member.NoteId==file.NoteId));
            }
        }
        return result;
    }

    public ContentImageDto ReadImage(ContentResolveRequest request)
    {
        try
        {
            var resolved = Resolve(request);
            if (resolved.Status != "resolved") return new(resolved.Status, Message: resolved.Message);
            if (!string.IsNullOrEmpty(resolved.Anchor)) return new("unsupported", Message: "圖片 fragment／區塊定位尚未支援。");
            var path = Physical(resolved.RelativePath!);
            var extension = Path.GetExtension(path).ToLowerInvariant();
            var mime = extension switch { ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".gif" => "image/gif", ".webp" => "image/webp", ".bmp" => "image/bmp", _ => null };
            if (mime is null) return new("unsupported", Message: "僅支援 PNG、JPEG、GIF、WebP、BMP 圖片。");
            WorkspaceFilePaths.EnsureNoReparse(path);
            // Deny concurrent writes and replacement while reading this one snapshot.
            // A busy external editor yields an explicit retryable error, not mixed bytes.
            using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (file.Length > MaximumImageBytes) return new("unsupported", Message: "圖片超過 8 MiB 上限。");
            var bytes = new byte[checked((int)file.Length)];
            file.ReadExactly(bytes);
            if (file.ReadByte() != -1) return new("unsupported", Message: "圖片讀取期间已變更，請重試。");
            if (!MatchesMagic(extension, bytes)) return new("unsupported", Message: "圖片內容與副檔名不符。");
            return new("resolved", "data:" + mime + ";base64," + Convert.ToBase64String(bytes));
        }
        catch (FileNotFoundException) { return new("missing", Message: "圖片已不存在。"); }
        catch (DirectoryNotFoundException) { return new("missing", Message: "圖片目錄已不存在。"); }
        catch (Exception error) when (Expected(error)) { return new("unsupported", Message: error.Message); }
    }

    private Resolution Resolve(ContentResolveRequest request)
    {
        var known = sources().ToArray();
        var origins = known.Where(s => s.NoteId == request.OriginNoteId).ToArray();
        if (origins.Length == 0) return new("missing", null, null, "來源筆記不存在。", known);
        if (origins.Length != 1) return new("ambiguous", null, null, "來源筆記有多個位置。", known);
        var origin = Physical(origins[0].RelativePath);
        var target = request.Target ?? "";
        if (target.Length > 4096 || target.Any(char.IsControl)) throw new ArgumentException("連結過長或包含控制字元。");
        var hash = target.IndexOf('#');
        var encodedPath = hash < 0 ? target : target[..hash];
        var anchor = hash < 0 ? null : Decode(target[(hash + 1)..]);
        if (anchor?.StartsWith('^') == true) return new("unsupported", null, anchor, "Block anchor 尚未支援。", known);
        if (encodedPath.Contains('?')) return new("unsupported", null, anchor, "本機連結尚不支援 query string。", known);
        var link = Decode(encodedPath).Replace('\\', '/');
        if (link.Contains(':') || Path.IsPathRooted(link) || link.StartsWith('/') || link.Any(c => char.IsControl(c) || "<>\"|?*".Contains(c)))
            return new("unsupported", null, anchor, "只允許工作區內的相對連結。", known);
        foreach (var segment in link.Split('/'))
            if (segment is not "." and not ".." && (segment.EndsWith('.') || segment.EndsWith(' ')))
                throw new ArgumentException("路徑尾端空白或句點無法可靠解析。");
        if (link.Length == 0)
            return File.Exists(origin) ? new("resolved", Relative(origin), anchor, null, known) : new("missing", null, anchor, "來源檔案不存在。", known);

        var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string physical)
        {
            var relative = Relative(physical);
            if (Excluded(relative)) throw new ArgumentException("此路徑是工作區內部資料，不能作為內容連結。");
            WorkspaceFilePaths.EnsureNoReparse(physical);
            if (File.Exists(physical)) candidates.Add(relative);
        }
        var parent = Path.GetDirectoryName(origin)!;
        var names = link.EndsWith(".md", StringComparison.OrdinalIgnoreCase) || !request.IsWiki && Path.HasExtension(link)
            ? new[] { link } : new[] { link, link + ".md" };
        foreach (var name in names)
        {
            Add(Path.GetFullPath(Path.Combine(parent, name)));
            // Both Markdown and wiki links may use vault-root paths. Explicit
            // ./ and ../ disambiguate origin-relative paths; bare paths do not.
            if (!link.StartsWith("./", StringComparison.Ordinal) && !link.StartsWith("../", StringComparison.Ordinal))
                Add(Path.GetFullPath(Path.Combine(root, name)));
        }
        if (request.IsWiki && !link.Contains('/'))
        {
            foreach (var file in VisibleFiles())
                if (names.Any(name => string.Equals(Path.GetFileName(file), name, StringComparison.OrdinalIgnoreCase))) candidates.Add(file);
        }
        return candidates.Count switch
        {
            0 => new("missing", null, anchor, "找不到工作區內的目標檔案。", known),
            1 => new("resolved", candidates.Single(), anchor, null, known),
            _ => new("ambiguous", null, anchor, "存在多個符合名稱的檔案，請使用明確相對路徑。", known)
        };
    }

    private IEnumerable<string> VisibleFiles()
    {
        var pending = new Stack<(string Path, int Depth)>(); pending.Push((root, 0));
        var entries = 0;
        while (pending.TryPop(out var current))
        {
            if (current.Depth > 64) throw new IOException("目錄層級超過內容搜尋上限，請改用明確相對路徑。");
            WorkspaceFilePaths.EnsureNoReparse(current.Path);
            foreach (var path in Directory.EnumerateFileSystemEntries(current.Path))
            {
                if (++entries > MaximumSearchEntries) throw new IOException("檔案数量超過內容搜尋上限，請改用明確相對路徑。");
                var relative = Relative(path);
                if (Excluded(relative)) continue;
                var attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
                if ((attributes & FileAttributes.Directory) != 0) pending.Push((path, current.Depth + 1));
                else yield return relative;
            }
        }
    }
    private string Physical(string relative)
    {
        if (Path.IsPathRooted(relative) || relative.Contains(':')) throw new ArgumentException("來源路徑必須在工作區內。");
        var result = Path.GetFullPath(Path.Combine(root, relative.Replace('\\', '/')));
        if (Excluded(Relative(result))) throw new ArgumentException("來源位於內部目錄。");
        WorkspaceFilePaths.EnsureNoReparse(result); return result;
    }
    private string Relative(string path)
    {
        var full = Path.GetFullPath(path);
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("連結不可離開工作區。");
        return Path.GetRelativePath(root, full).Replace('\\', '/');
    }
    private static bool Excluded(string relative)
    {
        var parts = relative.Split('/');
        return parts.Any(p => p.Equals(".grasp", StringComparison.OrdinalIgnoreCase) || p.Equals(".git", StringComparison.OrdinalIgnoreCase)
            || p.Equals(".obsidian", StringComparison.OrdinalIgnoreCase) || p.Equals("artifacts", StringComparison.OrdinalIgnoreCase))
            || parts[^1].Equals(".grasp.lock", StringComparison.OrdinalIgnoreCase)
            || parts[^1].StartsWith("workspace.grasp.db", StringComparison.OrdinalIgnoreCase);
    }
    private static string Decode(string value)
    {
        for (var i = 0; i < value.Length; i++)
            if (value[i] == '%' && (i + 2 >= value.Length || !Uri.IsHexDigit(value[i + 1]) || !Uri.IsHexDigit(value[i + 2])))
                throw new ArgumentException("連結的 percent encoding 不完整。");
        return Uri.UnescapeDataString(value);
    }
    private static bool EqualPath(string left, string right) => string.Equals(left.Replace('\\', '/'), right.Replace('\\', '/'), StringComparison.OrdinalIgnoreCase);
    private static bool MatchesMagic(string extension, ReadOnlySpan<byte> bytes) => extension switch
    {
        ".png" => bytes.StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
        ".jpg" or ".jpeg" => bytes.StartsWith(new byte[] { 255, 216, 255 }),
        ".gif" => bytes.StartsWith("GIF87a"u8) || bytes.StartsWith("GIF89a"u8),
        ".webp" => bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes[8..12].SequenceEqual("WEBP"u8),
        ".bmp" => bytes.StartsWith("BM"u8),
        _ => false
    };
    private static bool Expected(Exception error) => error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException;
    private sealed record Resolution(string Status, string? RelativePath, string? Anchor, string? Message, WorkspaceContentSource[] Sources);
}
