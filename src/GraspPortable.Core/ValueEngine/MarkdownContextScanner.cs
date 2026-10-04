namespace GraspPortable.Core.ValueEngine;

internal readonly record struct ParseContext(int Start, int End, bool IsFence);

/// <summary>Finds hard Markdown fence boundaries before scanning Grasp tokens.</summary>
internal static class MarkdownContextScanner
{
    internal static IReadOnlyList<ParseContext> Scan(string source, IReadOnlyList<string> enabledFenceLanguages,
        int start = 0, CancellationToken cancellationToken = default, ISet<int>? indentedCodeLineStarts = null,
        IDictionary<int, int>? listContentColumns = null)
    {
        var languages = enabledFenceLanguages.Select(language => language.ToLowerInvariant()).ToHashSet(StringComparer.Ordinal);
        var result = new List<ParseContext>();
        var plainStart = start;
        var fenceStart = 0;
        var fenceCharacter = '\0';
        var fenceLength = 0;
        var enabled = false;
        var lineStart = start;
        var listIndents = new List<int>();
        var opaqueUntil = start;
        while (lineStart < source.Length)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var lineEnd = lineStart;
            while (lineEnd < source.Length && source[lineEnd] is not ('\r' or '\n')) lineEnd++;
            var nextLine = lineEnd + SyntaxCharacters.EolLength(source, lineEnd, source.Length);
            var markerStart = ContentStart(source, lineStart, lineEnd, listIndents, fenceLength > 0 || lineStart < opaqueUntil, out var indentedCode);
            if (indentedCode && fenceLength == 0) indentedCodeLineStarts?.Add(lineStart);
            if ((fenceLength == 0 && !indentedCode || fenceLength > 0 && enabled) && listIndents.Count > 0)
                listContentColumns?.Add(lineStart, listIndents[^1]);
            if (fenceLength == 0 && !indentedCode && lineStart >= opaqueUntil)
                opaqueUntil = GraspParser.OpaqueHostEnd(source, markerStart, lineEnd, cancellationToken);
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

    private static int ContentStart(string source, int start, int end, List<int> listIndents, bool inFence, out bool indentedCode)
    {
        // Only indentation beyond an established list item's content column is code.
        // Never trim or rebuild the input: all semantic spans still address original UTF-16 text.
        indentedCode = false;
        var at = start;
        var columns = 0;
        while (at < end && source[at] is ' ' or '\t')
        { columns += source[at++] == '\t' ? 4 - columns % 4 : 1; }
        if (at == end) return end; // Blank lines do not terminate an enclosing list.
        if (!inFence)
            while (listIndents.Count > 0 && columns < listIndents[^1]) listIndents.RemoveAt(listIndents.Count - 1);
        var containerIndent = listIndents.Count == 0 ? 0 : listIndents[^1];
        if (columns - containerIndent >= 4) { indentedCode = true; return end; }
        while (at < end && source[at] == '>')
        {
            at++;
            if (at < end && source[at] == ' ') at++;
        }
        // Fence content cannot introduce list containers. Ordered marker widths matter too.
        if (!inFence)
        {
            var markerEnd = at;
            if (at < end && source[at] is '-' or '+' or '*') markerEnd++;
            else
            {
                while (markerEnd < end && markerEnd - at < 9 && char.IsAsciiDigit(source[markerEnd])) markerEnd++;
                if (markerEnd == at || markerEnd >= end || source[markerEnd] is not ('.' or ')')) markerEnd = at;
                else markerEnd++;
            }
            if (markerEnd > at && markerEnd < end && source[markerEnd] is ' ' or '\t')
            {
                var content = markerEnd;
                var contentColumn = columns + markerEnd - at;
                var padding = 0;
                while (content < end && source[content] is ' ' or '\t')
                {
                    var width = source[content] == '\t' ? 4 - (contentColumn + padding) % 4 : 1;
                    if (padding + width > 4) break;
                    padding += width; content++;
                }
                // Five or more spaces after a marker form one padding space plus indented code.
                if (content < end && source[content] is ' ' or '\t')
                {
                    listIndents.Add(contentColumn + 1);
                    indentedCode = true;
                    return end;
                }
                listIndents.Add(contentColumn + padding);
                at = content;
            }
        }
        return at;
    }
}
