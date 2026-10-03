using System.Text.RegularExpressions;
using GraspPortable.Core.ValueEngine;
using GraspPortable.Host.Workspace.FileOperations;
using GraspPortable.Host.Workspace.Markdown;

namespace GraspPortable.Host.Workspace;

internal sealed record FileLinkPlan(IReadOnlyDictionary<string, string> Rewrites, string[] Warnings);

/// <summary>A bounded source-span codec, not a Markdown renderer. Unsupported ambiguous links block a move.</summary>
internal static class FileLinks
{
    private sealed record Link(int Start, int Length, string Path, bool Wiki, bool Angle, bool Complete = true);
    public static FileLinkPlan Plan(string root, IReadOnlyList<MarkdownFileState> registry, string source,
        string target, bool folder, IReadOnlyList<string> languages)
    {
        var paths = new WorkspaceFilePaths(root);
        var known = EnumerateFiles(paths).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var outputs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var warnings = new List<string>();
        bool Moved(string path) => path.Equals(source, StringComparison.OrdinalIgnoreCase) || folder && path.StartsWith(source + "/", StringComparison.OrdinalIgnoreCase);
        string Map(string path) => Moved(path) ? target + path[source.Length..] : path;
        foreach (var file in registry.Where(f => f.Exists))
        {
            var text = file.Text;
            var mask = Exclusions(text, languages);
            var replacements = new List<SourcePatch>();
            foreach (var link in ReadLinks(text, mask))
            {
                var raw = link.Path;
                if (External(raw) || raw.Length == 0 || raw.StartsWith('#') || raw.StartsWith('?')) continue;
                var separator = raw.IndexOfAny(['#', '?']);
                var baseRaw = separator < 0 ? raw : raw[..separator]; var tail = separator < 0 ? "" : raw[separator..];
                var decoded = Decode(baseRaw);
                if (decoded is null) { Warn("不支援的連結跳脫", raw); continue; }
                var candidates = Resolve(paths, known, file.RelativePath, decoded, link.Wiki);
                var couldAffect = Moved(file.RelativePath) || candidates.Any(Moved)
                    || candidates.Count == 0 && (folder || Path.GetFileNameWithoutExtension(decoded).Equals(Path.GetFileNameWithoutExtension(source), StringComparison.OrdinalIgnoreCase));
                if (!couldAffect) continue;
                if (!link.Complete) { Warn("連結尚未完整或使用未支援的 title 格式", raw); continue; }
                if (candidates.Count != 1) { Warn(candidates.Count == 0 ? "連結目標不存在或超出工作區" : "連結目標不唯一", raw); continue; }
                var resolved = candidates[0]; var newOrigin = Map(file.RelativePath); var newTarget = Map(resolved);
                string destination;
                if (link.Wiki)
                {
                    // Explicit vault-relative paths are stable under later basename collisions.
                    destination = newTarget;
                    if (!decoded.EndsWith(".md", StringComparison.OrdinalIgnoreCase) && destination.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) destination = destination[..^3];
                    if (decoded.StartsWith('/')) destination = "/" + destination;
                    destination = EscapeWiki(destination);
                }
                else if (decoded.StartsWith('/')) destination = "/" + EncodeSegments(newTarget, link.Angle);
                else
                {
                    var parent = Path.GetDirectoryName(paths.Resolve(newOrigin))!;
                    destination = Path.GetRelativePath(parent, paths.Resolve(newTarget)).Replace('\\', '/');
                    if (decoded.StartsWith("./", StringComparison.Ordinal) && !destination.StartsWith("../", StringComparison.Ordinal)) destination = "./" + destination;
                    destination = EncodeSegments(destination, link.Angle);
                }
                destination += tail;
                if (destination != raw) replacements.Add(new(new(link.Start, link.Length), destination));
            }
            // HTML links are retained. Do not pretend an unimplemented HTML codec can keep them correct.
            foreach (Match html in Regex.Matches(text, @"\b(?:src|href)\s*=\s*[""'](?<url>[^""']+)[""']", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
            {
                if (mask[html.Index]) continue;
                var raw = html.Groups["url"].Value;
                if (External(raw) || raw.StartsWith('#')) continue;
                var decoded = Decode(raw.Split('#', '?')[0]);
                if (Moved(file.RelativePath) || decoded is not null && Resolve(paths, known, file.RelativePath, decoded, false).Any(Moved))
                    Warn("HTML 相對連結尚未支援自動改寫", raw);
            }
            if (replacements.Count > 0) outputs[file.RelativePath] = ReferenceCodec.ApplyPatches(text, replacements);
            void Warn(string reason, string raw) => warnings.Add($"{file.RelativePath}：{reason}「{raw}」，未套用搬移。");
        }
        return new(outputs, warnings.Distinct().ToArray());
    }

    private static List<string> Resolve(WorkspaceFilePaths paths, HashSet<string> known, string origin, string raw, bool wiki)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string candidate)
        {
            try
            {
                var absolute = Path.GetFullPath(Path.Combine(paths.Root, candidate.Replace('/', Path.DirectorySeparatorChar)));
                var relative = Path.GetRelativePath(paths.Root, absolute).Replace('\\', '/');
                paths.NormalizeUserPath(relative);
                if (known.Contains(relative)) result.Add(known.First(p => p.Equals(relative, StringComparison.OrdinalIgnoreCase)));
                if (wiki && !relative.EndsWith(".md", StringComparison.OrdinalIgnoreCase) && known.Contains(relative + ".md"))
                    result.Add(known.First(p => p.Equals(relative + ".md", StringComparison.OrdinalIgnoreCase)));
            }
            catch (Exception e) when (e is IOException or ArgumentException or NotSupportedException) { }
        }
        if (raw.StartsWith('/')) Add(raw.TrimStart('/'));
        else if (wiki && !raw.Contains('/'))
        {
            foreach (var path in known)
                if (Path.GetFileName(path).Equals(raw, StringComparison.OrdinalIgnoreCase)
                    || path.EndsWith(".md", StringComparison.OrdinalIgnoreCase) && Path.GetFileNameWithoutExtension(path).Equals(raw, StringComparison.OrdinalIgnoreCase)) result.Add(path);
        }
        else if (wiki && !raw.StartsWith("./", StringComparison.Ordinal) && !raw.StartsWith("../", StringComparison.Ordinal))
        {
            // Obsidian vault paths plus unambiguous suffix paths. Multiple matches are an explicit conflict.
            Add(raw);
            foreach (var path in known)
                if (path.EndsWith("/" + raw, StringComparison.OrdinalIgnoreCase) || path.EndsWith("/" + raw + ".md", StringComparison.OrdinalIgnoreCase)) result.Add(path);
        }
        else
        {
            var slash = origin.LastIndexOf('/');
            Add((slash < 0 ? "" : origin[..(slash + 1)]) + raw);
        }
        return result.ToList();
    }

    private static IEnumerable<Link> ReadLinks(string text, bool[] excluded)
    {
        for (var at = 0; at < text.Length; at++)
        {
            if (excluded[at] || text[at] != '[' || Escaped(text, at)) continue;
            if (at + 1 < text.Length && text[at + 1] == '[')
            {
                var end = at + 2;
                while (end + 1 < text.Length && !(text[end] == ']' && text[end + 1] == ']' && !Escaped(text, end))) end++;
                if (end + 1 >= text.Length) continue;
                var split = at + 2;
                while (split < end && (text[split] != '|' || Escaped(text, split))) split++;
                if (split > at + 2 && text[at + 2] != '@' && !AnyExcluded(excluded, at, end + 2))
                    yield return new(at + 2, split - at - 2, text[(at + 2)..split], true, false);
                at = end + 1; continue;
            }
            var close = at + 1; var depth = 1;
            for (; close < text.Length; close++)
            {
                if (excluded[close] || Escaped(text, close)) continue;
                if (text[close] == '[') depth++;
                if (text[close] == ']' && --depth == 0) break;
                // A non-bracket must not affect nesting depth.
                if (text[close] != ']') continue;
            }
            if (close + 1 >= text.Length) continue;
            var destination = close + 1;
            if (text[destination] == '(')
            {
                destination++; while (destination < text.Length && char.IsWhiteSpace(text[destination])) destination++;
                var angle = destination < text.Length && text[destination] == '<'; if (angle) destination++;
                var end = DestinationEnd(text, destination, angle);
                if (end > destination && !AnyExcluded(excluded, destination, end))
                    yield return new(destination, end - destination, text[destination..end], false, angle, HasClosing(text, end, angle, true));
                // Do not skip the whole label: nested image destinations remain discoverable.
            }
            else if (text[destination] == ':' && IsLinePrefix(text, at))
            {
                destination++; while (destination < text.Length && text[destination] is ' ' or '\t') destination++;
                var angle = destination < text.Length && text[destination] == '<'; if (angle) destination++;
                var end = DestinationEnd(text, destination, angle);
                if (end > destination && !AnyExcluded(excluded, destination, end))
                    yield return new(destination, end - destination, text[destination..end], false, angle, HasClosing(text, end, angle, false));
            }
        }
    }
    private static bool HasClosing(string text, int end, bool angle, bool inline)
    {
        var at = end;
        if (angle) { if (at >= text.Length || text[at] != '>') return false; at++; }
        while (at < text.Length && text[at] is ' ' or '\t') at++;
        if (at < text.Length && text[at] is '"' or '\'')
        {
            var quote = text[at++];
            while (at < text.Length && (text[at] != quote || Escaped(text, at)))
            { if (text[at] is '\r' or '\n') return false; at++; }
            if (at >= text.Length) return false;
            at++; while (at < text.Length && text[at] is ' ' or '\t') at++;
        }
        return inline ? at < text.Length && text[at] == ')' : at == text.Length || text[at] is '\r' or '\n';
    }
    private static int DestinationEnd(string text, int start, bool angle)
    {
        var depth = 0;
        for (var at = start; at < text.Length; at++)
        {
            if (text[at] == '\\' && at + 1 < text.Length) { at++; continue; }
            if (text[at] is '\r' or '\n') return angle ? start : at;
            if (angle) { if (text[at] == '>') return at; continue; }
            if (char.IsWhiteSpace(text[at])) return at;
            if (text[at] == '(') depth++;
            if (text[at] == ')' && depth-- == 0) return at;
        }
        return angle ? start : text.Length;
    }
    private static bool[] Exclusions(string text, IReadOnlyList<string> languages)
    {
        var mask = new bool[text.Length];
        void Mark(int start, int end) { Array.Fill(mask, true, Math.Clamp(start, 0, text.Length), Math.Clamp(end, start, text.Length) - start); }
        var envelope = MarkdownEnvelopeCodec.Read(text); Mark(0, envelope.BodyStart);
        var parsed = GraspParser.Parse(text, languages);
        foreach (var region in parsed.Regions ?? []) Mark(region.Span.Start, region.Span.End);
        foreach (var reference in parsed.References) Mark(reference.Span.Start, reference.Span.End);
        foreach (var diagnostic in parsed.Diagnostics) Mark(diagnostic.Span.Start, diagnostic.Span.End);
        var fence = '\0'; var fenceLength = 0;
        for (var line = envelope.BodyStart; line < text.Length;)
        {
            var end = text.IndexOf('\n', line); if (end < 0) end = text.Length;
            var content = text[line..end].TrimEnd('\r');
            var prefix = Regex.Match(content, @"^ {0,3}(?:(?:> ?)+)?(?:(?:[-+*]|[0-9]+[.)]) +)?(?<mark>`{3,}|~{3,})(?<tail>.*)$");
            if (fenceLength > 0)
            {
                Mark(line, Math.Min(text.Length, end + 1));
                if (prefix.Success && prefix.Groups["mark"].Value[0] == fence && prefix.Groups["mark"].Length >= fenceLength && prefix.Groups["tail"].Value.Trim().Length == 0) fenceLength = 0;
            }
            else if (prefix.Success)
            {
                fence = prefix.Groups["mark"].Value[0]; fenceLength = prefix.Groups["mark"].Length;
                Mark(line, Math.Min(text.Length, end + 1));
            }
            else if (content.StartsWith("    ", StringComparison.Ordinal) || content.StartsWith('\t')) Mark(line, Math.Min(text.Length, end + 1));
            line = end + 1;
        }
        for (var at = 0; at < text.Length; at++)
        {
            if (mask[at]) continue;
            if (text.AsSpan(at).StartsWith("<!--", StringComparison.Ordinal))
            {
                var close = text.IndexOf("-->", at + 4, StringComparison.Ordinal);
                var end = close < 0 ? text.Length : close + 3; Mark(at, end); at = end - 1; continue;
            }
            if (text[at] != '`' || Escaped(text, at)) continue;
            var run = 1; while (at + run < text.Length && text[at + run] == '`') run++;
            var next = at + run;
            while (next < text.Length)
            {
                if (text[next] != '`') { next++; continue; }
                var length = 1; while (next + length < text.Length && text[next + length] == '`') length++;
                if (length == run) { Mark(at, next + length); at = next + length - 1; break; }
                next += length;
            }
        }
        return mask;
    }
    private static bool AnyExcluded(bool[] mask, int start, int end) { for (var i = start; i < end; i++) if (mask[i]) return true; return false; }
    private static bool IsLinePrefix(string text, int at)
    { var start = text.LastIndexOf('\n', Math.Max(0, at - 1)); return text.AsSpan(start + 1, at - start - 1).Trim().IsEmpty; }
    private static bool Escaped(string text, int at) { var count = 0; while (at > 0 && text[--at] == '\\') count++; return count % 2 == 1; }
    private static bool External(string path) => path.StartsWith("//", StringComparison.Ordinal) || Regex.IsMatch(path, @"^[A-Za-z][A-Za-z0-9+.-]*:", RegexOptions.CultureInvariant);
    private static string? Decode(string raw)
    {
        try
        {
            if (raw.Contains('&')) return null; // Entity decoding is outside this bounded codec.
            return Uri.UnescapeDataString(Regex.Replace(raw, @"\\([!""#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])", "$1")).Replace('\\', '/');
        }
        catch (UriFormatException) { return null; }
    }
    private static string EscapeWiki(string path) => path.Replace("%", "%25").Replace("#", "%23").Replace("?", "%3F").Replace("|", "%7C").Replace("[", "%5B").Replace("]", "%5D");
    private static string EncodeSegments(string path, bool angle) => string.Join('/', path.Split('/').Select(segment =>
        Uri.EscapeDataString(segment).Replace("%20", angle ? " " : "%20")));
    private static IEnumerable<string> EnumerateFiles(WorkspaceFilePaths paths)
    {
        var pending = new Stack<string>(); pending.Push(paths.Root);
        while (pending.TryPop(out var directory))
        {
            WorkspaceFilePaths.EnsureNoReparse(directory);
            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                if (new[] { ".grasp", ".git", ".obsidian", "artifacts" }.Contains(Path.GetFileName(path), StringComparer.OrdinalIgnoreCase)) continue;
                var attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
                if ((attributes & FileAttributes.Directory) != 0) pending.Push(path);
                else yield return Path.GetRelativePath(paths.Root, path).Replace('\\', '/');
            }
        }
    }
}
