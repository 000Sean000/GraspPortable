using System.Text;
using System.Text.RegularExpressions;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Records;

/// <summary>Explicit first-conversion preview. Callers archive OriginalSource and Mapping before applying.</summary>
public static class HeadingConversion
{
    private sealed record Heading(int Line, int LastLine, int Level, string Label, SourceSpan Span);
    private static readonly Regex Atx = new(@"\A {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)\z", RegexOptions.CultureInvariant);
    private static readonly Regex Setext = new(@"\A {0,3}(=+|-+)[ \t]*\z", RegexOptions.CultureInvariant);

    public static HeadingConversionPreview Preview(string originalMarkdown, FieldLayout layout = FieldLayout.Headings, int preferredMinimumLevel = 5,
        IReadOnlyList<SourceSpan>? protectedSpans = null)
    {
        if (preferredMinimumLevel is < 2 or > 6) throw new ArgumentOutOfRangeException(nameof(preferredMinimumLevel));
        var lines = RecordText.Lines(originalMarkdown).ToArray();
        var headings = new List<Heading>(); var fence = new RecordText.Fence();
        var diagnostics = new List<RecordDiagnostic>();
        var ordinaryPrevious = false;
        for (var index = 0; index < lines.Length; index++)
        {
            var line = lines[index];
            // A reference inside a heading's label must not shield the heading marker itself.
            if (protectedSpans?.Any(s => line.Start >= s.Start && line.Start < s.End) == true)
            { ordinaryPrevious = false; continue; }
            if (fence.Consume(line.Text)) { ordinaryPrevious = false; continue; }
            // Container Markdown needs a richer block parser to safely distinguish
            // nested headings/fences. Preserve it rather than claim a no-H1 rewrite.
            var container = Regex.Match(line.Text, @"\A {0,3}(?:(?:>[ \t]*|[-+*][ \t]+|[0-9]+[.)][ \t]+))+");
            if (container.Success && (Atx.IsMatch(line.Text[container.Length..]) || Setext.IsMatch(line.Text[container.Length..])))
                diagnostics.Add(new("heading-container", "Heading inside a quote/list container needs explicit conversion review; original source is retained.", new(line.Start, line.Text.Length)));
            var atx = Atx.Match(line.Text);
            if (atx.Success)
            {
                var label = Regex.Replace(atx.Groups[2].Value, @"[ \t]+#+[ \t]*\z", "");
                headings.Add(new(index, index, atx.Groups[1].Length, label, new(line.Start, line.Text.Length)));
                ordinaryPrevious = false; continue;
            }
            var setext = Setext.Match(line.Text);
            if (setext.Success && ordinaryPrevious)
            {
                var previous = lines[index - 1];
                headings.Add(new(index - 1, index, setext.Groups[1].Value[0] == '=' ? 1 : 2, previous.Text.Trim(), SourceSpan.Between(previous.Start, line.Start + line.Text.Length)));
                ordinaryPrevious = false; continue;
            }
            ordinaryPrevious = line.Text.Length > 0 && !string.IsNullOrWhiteSpace(line.Text)
                && !line.Text.StartsWith("    ", StringComparison.Ordinal) && !line.Text.StartsWith('>')
                && !Regex.IsMatch(line.Text, @"\A {0,3}(?:[-+*]|[0-9]+[.)])[ \t]");
        }
        if (diagnostics.Count > 0) return new(originalMarkdown, originalMarkdown, layout, [], diagnostics);
        if (headings.Count == 0) return new(originalMarkdown, originalMarkdown, layout, [], []);
        var minimum = headings.Min(h => h.Level);
        var shift = Math.Max(0, preferredMinimumLevel - minimum);
        var useList = layout == FieldLayout.NestedList || headings.Any(h => h.Level + shift > 6);
        var selectedLayout = useList ? FieldLayout.NestedList : FieldLayout.Headings;
        var byLine = headings.ToDictionary(h => h.Line);
        var result = new StringBuilder(); var maps = new List<HeadingMap>();
        var activeDepth = -1;
        var ancestors = new Stack<int>();
        for (var index = 0; index < lines.Length; index++)
        {
            if (byLine.TryGetValue(index, out var heading))
            {
                var start = result.Length;
                while (ancestors.TryPeek(out var level) && level >= heading.Level) ancestors.Pop();
                var depth = ancestors.Count;
                ancestors.Push(heading.Level);
                // Keep the heading's inline Markdown (Wiki links, links, emphasis) intact.
                // An added bold wrapper or escaping brackets would alter its semantics.
                var converted = useList ? new string(' ', depth * 2) + "- " + heading.Label
                    : new string('#', heading.Level + shift) + " " + heading.Label;
                result.Append(converted);
                maps.Add(new(heading.Span, new(start, converted.Length), heading.Level, useList ? null : heading.Level + shift, useList ? depth : 0));
                result.Append(lines[heading.LastLine].Eol);
                activeDepth = useList ? depth : -1;
                index = heading.LastLine;
            }
            else
            {
                // Keep entire block content (including fences/tables/blank lines)
                // under its converted heading node, without flattening hierarchy.
                if (useList && activeDepth >= 0 && lines[index].Text.Length > 0) result.Append(' ', (activeDepth + 1) * 2);
                result.Append(lines[index].Text).Append(lines[index].Eol);
            }
        }
        return new(originalMarkdown, result.ToString(), selectedLayout, maps, []);
    }
}
