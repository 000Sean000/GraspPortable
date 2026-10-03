using System.Text;
using System.Text.RegularExpressions;

namespace GraspPortable.Host.Workspace.Markdown;

public sealed record GroupedNoteInput(string NoteId, string Title, string Body);
public sealed record GroupedSourceRange(int Start, int Length);
public sealed record GroupedMember(string NoteId, string Body, GroupedSourceRange BodyRange, GroupedSourceRange FrameRange);
public sealed record GroupedUnassigned(string Text, GroupedSourceRange Range);
public sealed record GroupedNoteIssue(string Code, string Message, int Start = 0, int Length = 0, bool IsWarning = false);
public sealed record GroupedNoteParse(string Source, IReadOnlyList<string> KnownNoteIds,
    IReadOnlyList<GroupedMember> Members, IReadOnlyList<GroupedUnassigned> Unassigned,
    IReadOnlyList<GroupedNoteIssue> Issues, bool CanRewrite);
public sealed record GroupedNoteWriteResult(bool Success, string Source, IReadOnlyList<GroupedNoteIssue> Issues);

/// <summary>
/// Body-only framing codec: ranges are UTF-16 offsets relative to the supplied envelope body.
/// An additional newline before each closing marker belongs to framing, never to the member.
/// YAML, file bytes/version guards and preserving Unassigned text on split belong to the caller.
/// </summary>
public static class GroupedNoteCodec
{
    private static readonly Regex Marker = new(@"\A<!-- (?<close>/)?grasp:note (?<id>[0-9a-fA-F-]+) -->[ \t]*\z", RegexOptions.CultureInvariant);
    private static readonly Regex Fence = new(@"\A {0,3}(?<run>`{3,}|~{3,})(?<tail>.*)\z", RegexOptions.CultureInvariant);
    private sealed record Line(int Start, int TextEnd, int End, string Text);

    public static GroupedNoteParse Parse(string source, IEnumerable<string> knownNoteIds)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(knownNoteIds);
        var issues = new List<GroupedNoteIssue>();
        var known = NormalizeIds(knownNoteIds, issues);
        var mask = CodeMask(source, issues);
        var members = new List<GroupedMember>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        (string Id, int Start, int BodyStart)? active = null;
        foreach (var line in Lines(source))
        {
            if (mask[line.Start]) continue;
            var marker = Marker.Match(line.Text);
            if (!marker.Success)
            {
                if (line.Text.StartsWith("<!-- grasp:note", StringComparison.Ordinal) || line.Text.StartsWith("<!-- /grasp:note", StringComparison.Ordinal))
                    issues.Add(new("invalid-marker", "Reserved member marker is malformed.", line.Start, line.Text.Length));
                continue;
            }
            if (!TryId(marker.Groups["id"].Value, out var id))
            {
                issues.Add(new("invalid-id", "Member marker requires a nonempty UUID.", line.Start, line.Text.Length));
                continue;
            }
            if (!known.Contains(id)) issues.Add(new("unknown-id", $"Member {id} is absent from identity metadata.", line.Start, line.Text.Length));
            if (!marker.Groups["close"].Success)
            {
                if (active is not null) issues.Add(new("nested-member", "Member markers cannot nest or cross.", line.Start, line.Text.Length));
                else active = (id, line.Start, line.End);
                if (!seen.Add(id)) issues.Add(new("duplicate-member", $"Member {id} appears more than once.", line.Start, line.Text.Length));
                if (line.TextEnd == line.End) issues.Add(new("opening-newline", "Opening marker requires its own terminating newline.", line.Start, line.Text.Length));
            }
            else if (active is not { } opening)
                issues.Add(new("unexpected-close", "Closing marker has no matching opening marker.", line.Start, line.Text.Length));
            else if (opening.Id != id)
                issues.Add(new("crossed-member", "Closing marker does not match the active member.", line.Start, line.Text.Length));
            else
            {
                var separator = PreviousNewlineLength(source, line.Start);
                var bodyEnd = line.Start - separator;
                if (separator == 0 || bodyEnd < opening.BodyStart)
                    issues.Add(new("missing-framing-newline", "Closing marker requires an additional framing newline after the exact member body.", line.Start, line.Text.Length));
                else
                {
                    var body = source[opening.BodyStart..bodyEnd];
                    members.Add(new(id, body, new(opening.BodyStart, body.Length), new(opening.Start, line.End - opening.Start)));
                }
                active = null;
            }
        }
        if (active is { } unclosed) issues.Add(new("unclosed-member", $"Member {unclosed.Id} has no safe closing marker.", unclosed.Start));
        foreach (var id in known)
            if (!seen.Contains(id)) issues.Add(new("missing-member", $"Identity metadata member {id} has no opening marker."));
        var unassigned = new List<GroupedUnassigned>();
        var at = 0;
        foreach (var member in members)
        {
            AddUnassigned(at, member.FrameRange.Start);
            at = member.FrameRange.Start + member.FrameRange.Length;
        }
        AddUnassigned(at, source.Length);
        return new(source, known.ToArray(), members.AsReadOnly(), unassigned.AsReadOnly(), issues.AsReadOnly(), issues.All(i => i.IsWarning));

        void AddUnassigned(int start, int end)
        {
            if (end <= start) return;
            var text = source[start..end];
            unassigned.Add(new(text, new(start, end - start)));
            if (!string.IsNullOrWhiteSpace(text)) issues.Add(new("unassigned-content", "Text outside member frames must be preserved explicitly when splitting.", start, end - start, true));
        }
    }

    public static GroupedNoteWriteResult Serialize(IReadOnlyList<GroupedNoteInput> notes, string newline = "\n")
    {
        ArgumentNullException.ThrowIfNull(notes);
        var issues = new List<GroupedNoteIssue>();
        if (newline is not ("\n" or "\r\n" or "\r")) return Fail("invalid-newline", "Framing newline must be LF, CRLF or CR.");
        var ids = NormalizeIds(notes.Select(n => n.NoteId), issues);
        foreach (var note in notes) ValidateBody(note.Body, issues);
        if (issues.Any(i => !i.IsWarning)) return new(false, "", issues.AsReadOnly());
        var output = new StringBuilder();
        foreach (var note in notes)
        {
            TryId(note.NoteId, out var id);
            output.Append("## ").Append(Heading(note.Title)).Append(newline)
                .Append("<!-- grasp:note ").Append(id).Append(" -->").Append(newline)
                // Prevent a body's final bare CR from merging with a framing LF.
                .Append(note.Body).Append(note.Body.EndsWith('\r') && newline == "\n" ? "\r\n" : newline)
                .Append("<!-- /grasp:note ").Append(id).Append(" -->").Append(newline).Append(newline);
        }
        var source = output.ToString();
        var parsed = Parse(source, ids);
        if (!parsed.CanRewrite || parsed.Members.Count != notes.Count || !parsed.Members.Select(m => m.Body).SequenceEqual(notes.Select(n => n.Body), StringComparer.Ordinal))
            return new(false, "", parsed.Issues.Concat(new[] { new GroupedNoteIssue("roundtrip-invalid", "Generated framing did not preserve exact member bodies.") }).ToArray());
        return new(true, source, parsed.Issues);
    }

    public static GroupedNoteWriteResult ReplaceMember(string source, GroupedNoteParse parsed, string noteId, string newBody)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(parsed);
        ArgumentNullException.ThrowIfNull(newBody);
        if (!string.Equals(source, parsed.Source, StringComparison.Ordinal)) return Fail("source-changed", "Source changed after parsing; reparse before replacing.", source);
        // Reparse public records; never trust caller-supplied offsets or CanRewrite flags.
        var fresh = Parse(source, parsed.KnownNoteIds);
        if (!fresh.CanRewrite) return new(false, source, fresh.Issues);
        if (!TryId(noteId, out var id) || fresh.Members.SingleOrDefault(m => m.NoteId == id) is not { } member)
            return Fail("member-not-found", "Requested member is absent.", source);
        var issues = new List<GroupedNoteIssue>();
        ValidateBody(newBody, issues);
        if (issues.Any(i => !i.IsWarning)) return new(false, source, issues.AsReadOnly());
        var suffix = source[(member.BodyRange.Start + member.BodyRange.Length)..];
        var separatorProtection = newBody.EndsWith('\r') && suffix.StartsWith('\n') ? "\r" : "";
        var result = source[..member.BodyRange.Start] + newBody + separatorProtection + suffix;
        var verified = Parse(result, fresh.KnownNoteIds);
        if (!verified.CanRewrite || verified.Members.Count != fresh.Members.Count ||
            !verified.Members.All(m => m.Body == (m.NoteId == id ? newBody : fresh.Members.Single(n => n.NoteId == m.NoteId).Body)) ||
            !verified.Unassigned.Select(x => x.Text).SequenceEqual(fresh.Unassigned.Select(x => x.Text), StringComparer.Ordinal))
            return Fail("patch-invalid", "Replacement did not preserve framing, other members and unassigned source.", source);
        return new(true, result, verified.Issues);
    }

    private static void ValidateBody(string body, List<GroupedNoteIssue> issues)
    {
        ArgumentNullException.ThrowIfNull(body);
        var mask = CodeMask(body, issues);
        foreach (var line in Lines(body))
            if (!mask[line.Start] && (line.Text.StartsWith("<!-- grasp:note", StringComparison.Ordinal) || line.Text.StartsWith("<!-- /grasp:note", StringComparison.Ordinal)))
                issues.Add(new("marker-collision", "Member body contains an active reserved framing marker; preserve the original file instead of merging.", line.Start, line.Text.Length));
    }

    // Bounded Markdown context scanner. Code spans can cross lines; fenced blocks must close.
    // Framing is deliberately column-zero and is not inferred from headings or indented examples.
    private static bool[] CodeMask(string source, List<GroupedNoteIssue> issues)
    {
        var mask = new bool[source.Length + 1];
        char fence = '\0'; int width = 0, fenceStart = 0;
        foreach (var line in Lines(source))
        {
            var match = Fence.Match(line.Text);
            if (width > 0)
            {
                Array.Fill(mask, true, line.Start, line.End - line.Start);
                if (match.Success && match.Groups["run"].Value[0] == fence && match.Groups["run"].Length >= width && match.Groups["tail"].Value.Trim().Length == 0) width = 0;
            }
            else if (match.Success && (match.Groups["run"].Value[0] != '`' || !match.Groups["tail"].Value.Contains('`')))
            {
                fence = match.Groups["run"].Value[0]; width = match.Groups["run"].Length; fenceStart = line.Start;
                Array.Fill(mask, true, line.Start, line.End - line.Start);
            }
            else if (line.Text.StartsWith("    ", StringComparison.Ordinal) || line.Text.StartsWith('\t'))
                Array.Fill(mask, true, line.Start, line.End - line.Start);
        }
        if (width > 0) issues.Add(new("unclosed-fence", "An unclosed fenced code block makes member boundaries unsafe; raw source remains preservable.", fenceStart, source.Length - fenceStart));
        for (var at = 0; at < source.Length; at++)
        {
            if (mask[at] || source[at] != '`' || Escaped(source, at)) continue;
            var count = Run(source, at);
            for (var next = at + count; next < source.Length;)
            {
                if (mask[next] || source[next] != '`') { next++; continue; }
                var length = Run(source, next);
                if (length == count) { Array.Fill(mask, true, at, next + length - at); at = next + length - 1; break; }
                next += length;
            }
            // Unmatched backticks are literal Markdown, not an open code span.
        }
        return mask;
    }

    private static IEnumerable<Line> Lines(string source)
    {
        for (var start = 0; start < source.Length;)
        {
            var end = start;
            while (end < source.Length && source[end] is not ('\r' or '\n')) end++;
            var next = end;
            if (next < source.Length) next += source[next] == '\r' && next + 1 < source.Length && source[next + 1] == '\n' ? 2 : 1;
            yield return new(start, end, next, source[start..end]); start = next;
        }
    }
    private static int PreviousNewlineLength(string source, int at) => at == 0 ? 0 : source[at - 1] == '\n' ? at > 1 && source[at - 2] == '\r' ? 2 : 1 : source[at - 1] == '\r' ? 1 : 0;
    private static int Run(string source, int at) { var end = at + 1; while (end < source.Length && source[end] == '`') end++; return end - at; }
    private static bool Escaped(string source, int at) { var count = 0; while (at > 0 && source[--at] == '\\') count++; return count % 2 != 0; }
    private static bool TryId(string? value, out string id)
    {
        if ((Guid.TryParseExact(value, "N", out var guid) || Guid.TryParseExact(value, "D", out guid)) && guid != Guid.Empty) { id = guid.ToString("N"); return true; }
        id = ""; return false;
    }
    private static HashSet<string> NormalizeIds(IEnumerable<string> values, List<GroupedNoteIssue> issues)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        foreach (var value in values)
            if (!TryId(value, out var id)) issues.Add(new("invalid-metadata-id", "Known member IDs must be nonempty UUIDs."));
            else if (!result.Add(id)) issues.Add(new("duplicate-metadata-id", $"Known member ID {id} is duplicated."));
        return result;
    }
    private static string Heading(string title) => Regex.Replace(title.Replace('\r', ' ').Replace('\n', ' '), @"([\\`*_{}\[\]<>#!|])", @"\$1");
    private static GroupedNoteWriteResult Fail(string code, string message, string source = "") => new(false, source, new[] { new GroupedNoteIssue(code, message) });
}
