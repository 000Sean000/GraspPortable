using System.Text.RegularExpressions;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Host.Workspace.Markdown;

public sealed record GroupingLinkNote(string NoteId, string BeforePath, string AfterPath, string Body, int SourceStart = 0,
    string? BeforePresentationAnchor = null, string? AfterPresentationAnchor = null);
public sealed record GroupingLinkFile(string RelativePath, string Source);
public sealed record GroupingLinkPatch(string SourcePath, string? OriginNoteId, int Start, int Length, string Before, string After);
public sealed record GroupingLinkIssue(string Code, string Message, string SourcePath, int Start = 0);
public sealed record GroupingLinkPlan(bool CanApply, IReadOnlyList<GroupingLinkPatch> Patches, IReadOnlyList<GroupingLinkIssue> Issues);

/// <summary>Pure snapshot planning. Patches address original physical-file UTF-16 spans; no filesystem writes or metadata changes.</summary>
public static class GroupingLinks
{
    private sealed record Link(int Start, int Length, string Target, bool Wiki, bool Angle, bool Embed, bool Complete = true);
    private sealed record Heading(string Text, bool Supported);
    private sealed record Line(int Start, int End, string Text);
    private static readonly StringComparer Paths = StringComparer.OrdinalIgnoreCase;
    private static readonly StringComparer Anchors = StringComparer.OrdinalIgnoreCase;

    /// <summary>Supported, unambiguous plain ATX/Setext headings within one member. Callers still check uniqueness across members.</summary>
    public static IReadOnlyList<string> FindHeadingAnchors(string body, IReadOnlyList<string> languages)
    {
        var headings = ReadHeadings(body, languages);
        // A formatted heading may render to the same text as a plain heading.
        // This codec does not guess rendered text or a renderer-specific slug.
        if (headings.Any(h => !h.Supported)) return [];
        return headings.GroupBy(h => h.Text, Anchors).Where(g => g.Count() == 1).Select(g => g.First().Text).ToArray();
    }

    public static GroupingLinkPlan Plan(IReadOnlyList<GroupingLinkNote> notes, IReadOnlyList<GroupingLinkFile> files,
        IReadOnlyList<string> knownFilePaths, IReadOnlyList<string> languages)
    {
        var issues = new List<GroupingLinkIssue>();
        var patches = new List<GroupingLinkPatch>();
        var documents = new Dictionary<string, GroupingLinkFile>(Paths);
        var physicalHeadings = new Dictionary<string, Heading[]>(Paths);
        var inventory = new HashSet<string>(Paths);
        foreach (var path in knownFilePaths)
            if (Normalize(path) is { } normalized) inventory.Add(normalized);
            else issues.Add(new("invalid-path", "Observed path escapes or is outside the workspace.", path));
        foreach (var file in files)
            if (Normalize(file.RelativePath) is { } path && path == file.RelativePath && documents.TryAdd(path, file)) inventory.Add(path);
            else issues.Add(new("duplicate-file", "Observed file paths must be unique normalized workspace paths.", file.RelativePath));
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var headings = new Dictionary<string, Heading[]>(StringComparer.Ordinal);
        foreach (var note in notes)
        {
            if (!Guid.TryParse(note.NoteId, out var id) || id == Guid.Empty || !ids.Add(id.ToString("N")))
                Issue("note-id", "Member IDs must be unique nonempty UUIDs.", note.BeforePath);
            if (Normalize(note.BeforePath) != note.BeforePath || Normalize(note.AfterPath) != note.AfterPath ||
                !documents.TryGetValue(note.BeforePath, out var source) || note.SourceStart < 0 ||
                note.SourceStart > source.Source.Length - note.Body.Length ||
                !source.Source.AsSpan(note.SourceStart, note.Body.Length).SequenceEqual(note.Body))
            { Issue("source-range", "Member body must match its exact original physical source slice.", note.BeforePath); continue; }
            headings[note.NoteId] = ReadHeadings(note.Body, languages);
            if (note.BeforePresentationAnchor is { } before)
            {
                var prefix = source.Source[..note.SourceStart];
                var escaped = Regex.Escape(before);
                var boundary = new Regex(@"(?:\A|\r?\n|\r)## " + escaped + @"[ \t]*(?:\r\n|\r|\n)<!-- grasp:note (?<id>[0-9a-fA-F-]+) -->[ \t]*(?:\r\n|\r|\n)\z", RegexOptions.CultureInvariant).Match(prefix);
                if (!PlainHeading(before) || !boundary.Success || !Guid.TryParse(boundary.Groups["id"].Value, out var markerId) || markerId != id)
                    Issue("presentation-changed", "Saved presentation heading no longer directly precedes its member marker.", note.BeforePath, note.SourceStart);
            }
            if (note.AfterPresentationAnchor is { } after && !PlainHeading(after))
                Issue("presentation-unsupported", "Planned presentation heading must be nonempty plain text without Markdown punctuation.", note.AfterPath);
        }
        foreach (var group in notes.GroupBy(n => n.BeforePath, Paths))
        {
            var ordered = group.OrderBy(n => n.SourceStart).ToArray();
            for (var i = 1; i < ordered.Length; i++)
                if (ordered[i].SourceStart < ordered[i - 1].SourceStart + ordered[i - 1].Body.Length)
                    Issue("overlapping-members", "Member source ranges overlap.", group.Key);
            foreach (var member in group.Where(n => n.BeforePresentationAnchor is not null))
                if (GetPhysicalHeadings(group.Key).Count(h => Anchors.Equals(h.Text, member.BeforePresentationAnchor)) != 1)
                    Issue("presentation-ambiguous", "Saved presentation heading is not globally unique in its physical document.", group.Key);
        }
        foreach (var group in notes.GroupBy(n => n.AfterPath, Paths))
        {
            if (group.Any(Changed) && group.Any(n => n.AfterPresentationAnchor is not null))
                foreach (var member in group)
                    if (headings.TryGetValue(member.NoteId, out var content))
                        foreach (var heading in content.Where(h => !h.Supported))
                            Issue("unsupported-heading", "Cannot prove presentation-heading uniqueness beside formatted/multiline heading: " + heading.Text, member.BeforePath);
            foreach (var member in group.Where(n => n.AfterPresentationAnchor is not null))
                if (CountHeading(group, member.AfterPresentationAnchor!, true) != 1)
                    Issue("presentation-ambiguous", "Planned presentation heading conflicts with another member or body heading.", group.Key);
        }
        if (issues.Count != 0) return new(false, patches, issues);

        foreach (var file in files)
        {
            var mask = Exclusions(file.Source, languages);
            var fileMembers = notes.Where(n => Paths.Equals(n.BeforePath, file.RelativePath)).ToArray();
            foreach (var link in ReadLinks(file.Source, mask))
            {
                var owner = fileMembers.SingleOrDefault(n => link.Start >= n.SourceStart && link.Start + link.Length <= n.SourceStart + n.Body.Length);
                var originMoved = owner is not null ? Changed(owner) : fileMembers.Any(Changed);
                var raw = link.Target;
                if (External(raw)) continue;
                var hash = raw.IndexOf('#');
                var pathRaw = hash < 0 ? raw : raw[..hash];
                var rawFragment = hash < 0 ? "" : raw[(hash + 1)..];
                var decoded = Decode(pathRaw);
                var candidates = decoded is null ? [] : decoded.Length == 0 ? new List<string> { file.RelativePath } : Resolve(inventory, file.RelativePath, decoded, link.Wiki);
                var targetMoved = candidates.Any(path => notes.Any(n => Paths.Equals(n.BeforePath, path) && Changed(n)));
                // Missing destinations in a moved member cannot safely retain their relative meaning.
                if (!originMoved && !targetMoved) continue;
                if (!link.Complete || decoded is null || pathRaw.Contains('?')) { Warn("unsupported-link", "Incomplete destination, query or unsupported escaping."); continue; }
                if (candidates.Count != 1) { Warn("target-ambiguous", "Destination is missing, outside the workspace or ambiguous."); continue; }
                if (owner is null && fileMembers.Any(Changed)) { Warn("unassigned-origin", "A link outside members needs an explicit preservation-note destination."); continue; }
                var oldTarget = candidates[0];
                var newOrigin = owner?.AfterPath ?? file.RelativePath;
                var newTarget = oldTarget;
                var tail = hash < 0 ? "" : "#" + rawFragment;
                if (targetMoved)
                {
                    var targets = notes.Where(n => Paths.Equals(n.BeforePath, oldTarget)).ToArray();
                    var fragment = Decode(rawFragment);
                    GroupingLinkNote? target = null;
                    var bodyHeading = false;
                    if (link.Embed && oldTarget.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
                    { Warn("note-embed", "Note embedding cannot be preserved by a presentation heading alone."); continue; }
                    if (hash < 0 || rawFragment.Length == 0)
                    {
                        if (targets.Length == 1) target = targets[0];
                        else { Warn("group-without-member", "A link to the whole multi-member group has no unique split destination."); continue; }
                    }
                    else if (fragment is null || fragment.StartsWith('^') || fragment.Contains('#') || !PlainHeading(fragment))
                    { Warn("unsupported-anchor", "Block, nested or unsupported anchors require explicit resolution."); continue; }
                    else
                    {
                        var oldHeadings = GetPhysicalHeadings(oldTarget);
                        if (oldHeadings.FirstOrDefault(h => !h.Supported) is { } unsupported)
                        { Warn("unsupported-heading", "Cannot prove fragment uniqueness beside formatted/multiline heading: " + unsupported.Text); continue; }
                        if (oldHeadings.Count(h => Anchors.Equals(h.Text, fragment)) != 1)
                        { Warn("anchor-ambiguous", "The original physical document does not have one matching heading."); continue; }
                        var presentations = targets.Where(n => Anchors.Equals(n.BeforePresentationAnchor, fragment)).ToArray();
                        var matching = targets.SelectMany(n => headings[n.NoteId].Where(h => Anchors.Equals(h.Text, fragment)).Select(h => (Note: n, Heading: h))).ToArray();
                        if (presentations.Length + matching.Length != 1 || matching.Any(m => !m.Heading.Supported))
                        { Warn("anchor-ambiguous", "The original fragment does not identify one supported heading/member."); continue; }
                        target = presentations.Length == 1 ? presentations[0] : matching[0].Note;
                        bodyHeading = presentations.Length == 0;
                    }
                    if (target is null) { Warn("target-member-missing", "No member mapping exists for the destination."); continue; }
                    newTarget = target.AfterPath;
                    if (bodyHeading)
                    {
                        if (CountHeading(notes.Where(n => Paths.Equals(n.AfterPath, newTarget)), fragment!, true) != 1)
                        { Warn("anchor-ambiguous", "The fragment becomes ambiguous in the destination group."); continue; }
                        // Keep the original anchor spelling/escaping, including H1/H2 and Setext.
                        tail = "#" + rawFragment;
                    }
                    else tail = target.AfterPresentationAnchor is { } anchor ? "#" + (link.Wiki ? anchor : Uri.EscapeDataString(anchor)) : "";
                }
                string destination;
                if (pathRaw.Length == 0 && Paths.Equals(newOrigin, newTarget)) destination = "";
                else if (link.Wiki)
                {
                    destination = newTarget;
                    if (!decoded.EndsWith(".md", StringComparison.OrdinalIgnoreCase) && destination.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) destination = destination[..^3];
                    destination = EscapeWiki(destination);
                    if (decoded.StartsWith('/')) destination = "/" + destination;
                }
                else if (decoded.StartsWith('/')) destination = "/" + EncodePath(newTarget, link.Angle);
                else
                {
                    destination = Relative(newOrigin, newTarget);
                    if (decoded.StartsWith("./", StringComparison.Ordinal) && !destination.StartsWith("../", StringComparison.Ordinal)) destination = "./" + destination;
                    destination = EncodePath(destination, link.Angle);
                }
                destination += tail;
                if (destination != raw) patches.Add(new(file.RelativePath, owner?.NoteId, link.Start, link.Length, raw, destination));
                void Warn(string code, string message) => Issue(code, message + " Target: " + raw, file.RelativePath, link.Start);
            }
            foreach (Match html in Regex.Matches(file.Source, @"\b(?:src|href)\s*=\s*[""'](?<url>[^""']+)[""']", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
            {
                if (mask[html.Index] || External(html.Groups["url"].Value)) continue;
                var target = Decode(html.Groups["url"].Value.Split('#', '?')[0]);
                if (fileMembers.Any(Changed) || target is not null && Resolve(inventory, file.RelativePath, target, false).Any(p => notes.Any(n => Paths.Equals(n.BeforePath, p) && Changed(n))))
                    Issue("html-link", "HTML local URLs are not rewritten by this bounded codec.", file.RelativePath, html.Index);
            }
        }
        return new(issues.Count == 0, patches.AsReadOnly(), issues.AsReadOnly());

        void Issue(string code, string message, string path, int at = 0) => issues.Add(new(code, message, path, at));
        Heading[] GetPhysicalHeadings(string path)
        {
            if (physicalHeadings.TryGetValue(path, out var cached)) return cached;
            var result = documents.TryGetValue(path, out var physical) ? ReadHeadings(physical.Source, languages, true) : [];
            physicalHeadings[path] = result; return result;
        }
        int CountHeading(IEnumerable<GroupingLinkNote> members, string name, bool after) => members.Sum(n =>
            (Anchors.Equals(after ? n.AfterPresentationAnchor : n.BeforePresentationAnchor, name) ? 1 : 0) +
            (headings.TryGetValue(n.NoteId, out var content) ? content.Count(h => Anchors.Equals(h.Text, name)) : 0));
    }

    private static bool Changed(GroupingLinkNote note) => !Paths.Equals(note.BeforePath, note.AfterPath) || note.BeforePresentationAnchor != note.AfterPresentationAnchor;
    private static bool PlainHeading(string text) => !string.IsNullOrWhiteSpace(text) && text == text.Trim() && text.IndexOfAny(['#', '^', '|', '[', ']', '<', '>', '`', '*', '_', '\\', '&', '\r', '\n']) < 0;
    private static Heading[] ReadHeadings(string body, IReadOnlyList<string> languages, bool envelope = false)
    {
        var mask = Exclusions(body, languages, envelope);
        var result = new List<Heading>();
        var paragraph = new List<string>();
        foreach (var line in Lines(body))
        {
            if (mask[line.Start] || string.IsNullOrWhiteSpace(line.Text)) { paragraph.Clear(); continue; }
            var atx = Regex.Match(line.Text, @"^ {0,3}#{1,6}(?:[ \t]+(?<title>.*)|[ \t]*)$");
            if (atx.Success)
            {
                var title = Regex.Replace(atx.Groups["title"].Value, @"[ \t]+#+[ \t]*$", "").Trim();
                result.Add(new(title, PlainHeading(title))); paragraph.Clear();
            }
            else if (paragraph.Count > 0 && Regex.IsMatch(line.Text, @"^ {0,3}(?:=+|-+)[ \t]*$"))
            { var title = string.Join(" ", paragraph); result.Add(new(title, paragraph.Count == 1 && PlainHeading(title))); paragraph.Clear(); }
            else paragraph.Add(line.Text.Trim());
        }
        return result.ToArray();
    }
    private static List<string> Resolve(HashSet<string> known, string origin, string path, bool wiki)
    {
        var result = new HashSet<string>(Paths);
        void Add(string candidate)
        {
            var normalized = Normalize(candidate); if (normalized is null) return;
            if (known.TryGetValue(normalized, out var actual)) result.Add(actual);
            if (wiki && !normalized.EndsWith(".md", StringComparison.OrdinalIgnoreCase) && known.TryGetValue(normalized + ".md", out actual)) result.Add(actual);
        }
        if (path.StartsWith('/')) Add(path.TrimStart('/'));
        else if (wiki && !path.Contains('/'))
        {
            foreach (var existing in known)
                if (Path.GetFileName(existing).Equals(path, StringComparison.OrdinalIgnoreCase) || existing.EndsWith(".md", StringComparison.OrdinalIgnoreCase) && Path.GetFileNameWithoutExtension(existing).Equals(path, StringComparison.OrdinalIgnoreCase)) result.Add(existing);
        }
        else if (wiki && !path.StartsWith("./", StringComparison.Ordinal) && !path.StartsWith("../", StringComparison.Ordinal))
        {
            Add(path);
            foreach (var existing in known)
                if (existing.EndsWith("/" + path, StringComparison.OrdinalIgnoreCase) || existing.EndsWith("/" + path + ".md", StringComparison.OrdinalIgnoreCase)) result.Add(existing);
        }
        else { var slash = origin.LastIndexOf('/'); Add((slash < 0 ? "" : origin[..(slash + 1)]) + path); }
        return result.ToList();
    }
    private static string? Normalize(string path)
    {
        if (path.StartsWith('/') || path.Contains(':') || path.Contains('\\')) return null;
        var parts = new List<string>();
        foreach (var part in path.Split('/'))
            if (part is "" or ".") continue;
            else if (part == "..") { if (parts.Count == 0) return null; parts.RemoveAt(parts.Count - 1); }
            else if (part is ".grasp" or ".git") return null;
            else parts.Add(part);
        return parts.Count == 0 ? null : string.Join('/', parts);
    }
    private static string Relative(string origin, string target)
    {
        var originParts = origin.Split('/')[..^1]; var targetParts = target.Split('/'); var common = 0;
        while (common < originParts.Length && common < targetParts.Length && Paths.Equals(originParts[common], targetParts[common])) common++;
        return string.Join('/', Enumerable.Repeat("..", originParts.Length - common).Concat(targetParts.Skip(common)));
    }
    private static IEnumerable<Link> ReadLinks(string text, bool[] mask)
    {
        for (var at = 0; at < text.Length; at++)
        {
            if (mask[at] || text[at] != '[' || Escaped(text, at)) continue;
            var embed = at > 0 && text[at - 1] == '!' && !Escaped(text, at - 1);
            if (at + 1 < text.Length && text[at + 1] == '[')
            {
                var end = at + 2;
                while (end + 1 < text.Length && !(text[end] == ']' && text[end + 1] == ']' && !Escaped(text, end))) end++;
                if (end + 1 >= text.Length) continue;
                var split = at + 2;
                while (split < end && (text[split] != '|' || Escaped(text, split))) split++;
                if (split > at + 2 && text[at + 2] != '@' && !Excluded(mask, at, end + 2)) yield return new(at + 2, split - at - 2, text[(at + 2)..split], true, false, embed);
                at = end + 1; continue;
            }
            var close = at + 1; var depth = 1;
            for (; close < text.Length; close++)
            {
                if (mask[close] || Escaped(text, close)) continue;
                if (text[close] == '[') depth++;
                if (text[close] == ']' && --depth == 0) break;
            }
            if (close + 1 >= text.Length) continue;
            var start = close + 1;
            var inline = text[start] == '(';
            if (!inline && !(text[start] == ':' && LinePrefix(text, at))) continue;
            start++; while (start < text.Length && text[start] is ' ' or '\t') start++;
            var angle = start < text.Length && text[start] == '<'; if (angle) start++;
            var endAt = DestinationEnd(text, start, angle);
            if (endAt > start && !Excluded(mask, start, endAt)) yield return new(start, endAt - start, text[start..endAt], false, angle, embed, HasClosing(text, endAt, angle, inline));
        }
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
    private static bool HasClosing(string text, int at, bool angle, bool inline)
    {
        if (angle) { if (at >= text.Length || text[at] != '>') return false; at++; }
        while (at < text.Length && text[at] is ' ' or '\t') at++;
        if (at < text.Length && text[at] is '"' or '\'')
        {
            var quote = text[at++];
            while (at < text.Length && (text[at] != quote || Escaped(text, at))) { if (text[at] is '\r' or '\n') return false; at++; }
            if (at >= text.Length) return false;
            at++; while (at < text.Length && text[at] is ' ' or '\t') at++;
        }
        return inline ? at < text.Length && text[at] == ')' : at == text.Length || text[at] is '\r' or '\n';
    }
    private static bool[] Exclusions(string text, IReadOnlyList<string> languages, bool envelope = true)
    {
        var mask = new bool[text.Length + 1];
        void Mark(int start, int end) { start = Math.Clamp(start, 0, text.Length); end = Math.Clamp(end, start, text.Length); Array.Fill(mask, true, start, end - start); }
        if (envelope) Mark(0, MarkdownEnvelopeCodec.Read(text).BodyStart);
        var parsed = GraspParser.Parse(text, languages);
        foreach (var region in parsed.Regions ?? []) Mark(region.Span.Start, region.Span.End);
        foreach (var reference in parsed.References) Mark(reference.Span.Start, reference.Span.End);
        foreach (var issue in parsed.Diagnostics) Mark(issue.Span.Start, issue.Span.End);
        var fence = '\0'; var width = 0;
        foreach (var line in Lines(text))
        {
            var prefix = Regex.Match(line.Text, @"^ {0,3}(?:(?:> ?)+)?(?:(?:[-+*]|[0-9]+[.)]) +)?(?<mark>`{3,}|~{3,})(?<tail>.*)$");
            if (width > 0)
            {
                Mark(line.Start, line.End);
                if (prefix.Success && prefix.Groups["mark"].Value[0] == fence && prefix.Groups["mark"].Length >= width && prefix.Groups["tail"].Value.Trim().Length == 0) width = 0;
            }
            else if (prefix.Success) { fence = prefix.Groups["mark"].Value[0]; width = prefix.Groups["mark"].Length; Mark(line.Start, line.End); }
            else if (line.Text.StartsWith("    ", StringComparison.Ordinal) || line.Text.StartsWith('\t')) Mark(line.Start, line.End);
        }
        for (var at = 0; at < text.Length; at++)
        {
            if (mask[at]) continue;
            if (text.AsSpan(at).StartsWith("<!--", StringComparison.Ordinal))
            { var close = text.IndexOf("-->", at + 4, StringComparison.Ordinal); var end = close < 0 ? text.Length : close + 3; Mark(at, end); at = end - 1; continue; }
            if (text[at] != '`' || Escaped(text, at)) continue;
            var run = 1; while (at + run < text.Length && text[at + run] == '`') run++;
            for (var next = at + run; next < text.Length;)
            {
                if (mask[next] || text[next] != '`') { next++; continue; }
                var length = 1; while (next + length < text.Length && text[next + length] == '`') length++;
                if (length == run) { Mark(at, next + length); at = next + length - 1; break; }
                next += length;
            }
        }
        return mask;
    }
    private static IEnumerable<Line> Lines(string source)
    {
        for (var at = 0; at < source.Length;)
        {
            var end = at; while (end < source.Length && source[end] is not ('\r' or '\n')) end++;
            var next = end; if (next < source.Length) next += source[next] == '\r' && next + 1 < source.Length && source[next + 1] == '\n' ? 2 : 1;
            yield return new(at, next, source[at..end]); at = next;
        }
    }
    private static bool Excluded(bool[] mask, int start, int end) { for (var i = start; i < end; i++) if (mask[i]) return true; return false; }
    private static bool Escaped(string text, int at) { var count = 0; while (at > 0 && text[--at] == '\\') count++; return count % 2 != 0; }
    private static bool LinePrefix(string text, int at) { var start = at; while (start > 0 && text[start - 1] is not ('\r' or '\n')) start--; return text.AsSpan(start, at - start).Trim().IsEmpty; }
    private static bool External(string target) => target.StartsWith("//", StringComparison.Ordinal) || Regex.IsMatch(target, @"^[A-Za-z][A-Za-z0-9+.-]*:");
    private static string? Decode(string raw)
    {
        if (raw.Contains('&')) return null;
        try { return Uri.UnescapeDataString(Regex.Replace(raw, @"\\([!""#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])", "$1")).Replace('\\', '/'); }
        catch (UriFormatException) { return null; }
    }
    private static string EscapeWiki(string path) => path.Replace("%", "%25").Replace("#", "%23").Replace("?", "%3F").Replace("|", "%7C").Replace("[", "%5B").Replace("]", "%5D");
    private static string EncodePath(string path, bool angle) => string.Join('/', path.Split('/').Select(segment => Uri.EscapeDataString(segment).Replace("%20", angle ? " " : "%20")));
}
