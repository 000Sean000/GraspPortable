namespace GraspPortable.Core.ValueEngine;

internal readonly record struct ParseContext(int Start, int End, bool IsFence);

/// <summary>Finds hard Markdown fence boundaries before scanning Grasp tokens.</summary>
internal static class MarkdownContextScanner
{
    internal static IReadOnlyList<ParseContext> Scan(string source, IReadOnlyList<string> enabledFenceLanguages,
        int start = 0, CancellationToken cancellationToken = default)
    {
        var languages = enabledFenceLanguages.Select(language => language.ToLowerInvariant()).ToHashSet(StringComparer.Ordinal);
        var result = new List<ParseContext>();
        var plainStart = start;
        var fenceStart = 0;
        var fenceCharacter = '\0';
        var fenceLength = 0;
        var enabled = false;
        var lineStart = start;
        while (lineStart < source.Length)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var lineEnd = lineStart;
            while (lineEnd < source.Length && source[lineEnd] is not ('\r' or '\n')) lineEnd++;
            var nextLine = lineEnd + SyntaxCharacters.EolLength(source, lineEnd, source.Length);
            var markerStart = ContentStart(source, lineStart, lineEnd);
            if (markerStart < lineEnd && source[markerStart] is '`' or '~')
            {
                var character = source[markerStart];
                var length = SyntaxCharacters.Run(source, markerStart, lineEnd, character);
                if (fenceLength > 0)
                {
                    if (character == fenceCharacter && length >= fenceLength
                        && source.AsSpan(markerStart + length, lineEnd - markerStart - length).Trim().IsEmpty)
                    {
                        if (enabled && lineStart > fenceStart) result.Add(new(fenceStart, lineStart, true));
                        fenceLength = 0;
                        plainStart = nextLine;
                    }
                }
                else if (length >= 3)
                {
                    var info = source[(markerStart + length)..lineEnd].Trim();
                    if (character != '`' || !info.Contains('`'))
                    {
                        if (lineStart > plainStart) result.Add(new(plainStart, lineStart, false));
                        fenceCharacter = character;
                        fenceLength = length;
                        fenceStart = nextLine;
                        var separator = info.IndexOfAny([' ', '\t']);
                        var language = (separator < 0 ? info : info[..separator]).ToLowerInvariant();
                        enabled = languages.Contains(language);
                    }
                }
            }
            lineStart = nextLine;
        }
        if (fenceLength > 0)
        {
            if (enabled && fenceStart < source.Length) result.Add(new(fenceStart, source.Length, true));
        }
        else if (plainStart < source.Length) result.Add(new(plainStart, source.Length, false));
        return result;
    }

    private static int ContentStart(string source, int start, int end)
    {
        // Quote/list prefixes are host structure. Original offsets remain untouched.
        var at = start;
        var spaces = 0;
        while (at < end && source[at] == ' ' && spaces < 4) { at++; spaces++; }
        if (spaces == 4) return end;
        while (at < end && source[at] == '>')
        {
            at++;
            if (at < end && source[at] == ' ') at++;
        }
        if (at + 1 < end && source[at] is '-' or '+' or '*' && source[at + 1] == ' ') at += 2;
        return at;
    }
}
