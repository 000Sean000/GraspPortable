using System.Text;
using System.Text.RegularExpressions;
using GraspPortable.Core.ValueEngine;

namespace GraspPortable.Core.Records;

public sealed record MarkdownTableCell(string Source, string Markdown, SourceSpan Span, int ConvertedBreaks);
public sealed record MarkdownImportTable(int Index, SourceSpan Span, IReadOnlyList<string> Headers,
    IReadOnlyList<IReadOnlyList<MarkdownTableCell>> Rows, IReadOnlyList<RecordDiagnostic> Diagnostics)
{ public bool CanImport => Diagnostics.Count == 0; }
public sealed record MarkdownTablesResult(IReadOnlyList<MarkdownImportTable> Tables, IReadOnlyList<RecordDiagnostic> Diagnostics);

/// <summary>Bounded pipe-table reader, not a general Markdown parser. It preserves cell Markdown,
/// treats wiki aliases/code spans/escaped pipes as content, and reports uncertain row boundaries.</summary>
public static class MarkdownTableImport
{
    public const int MaximumSourceLength = 2 * 1024 * 1024;
    private static readonly Regex Separator = new(@"\A:?-{3,}:?\z", RegexOptions.CultureInvariant);
    private static readonly Regex Break = new(@"\G<br\s*/?>", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private sealed record Cell(string Text, int Start, int Length);
    private sealed record Row(IReadOnlyList<Cell> Cells, bool HasPipes, bool Balanced);

    public static MarkdownTablesResult Read(string source)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (source.Length > MaximumSourceLength) return new([], [Problem("table-size", "Source exceeds the bounded 2 MiB import limit.", 0, source.Length)]);
        var lines = RecordText.Lines(source).ToArray(); var tables = new List<MarkdownImportTable>();
        var fence = new RecordText.Fence();
        for (var index = 0; index + 1 < lines.Length; index++)
        {
            var line = lines[index];
            if (fence.Consume(line.Text) || Container(line.Text)) continue;
            var header = Split(line.Text); var separator = Split(lines[index + 1].Text);
            if (!header.HasPipes || !separator.HasPipes || separator.Cells.Count == 0 || !separator.Cells.All(c => Separator.IsMatch(c.Text.Trim()))) continue;
            var issues = new List<RecordDiagnostic>(); var rows = new List<IReadOnlyList<MarkdownTableCell>>();
            var start = line.Start; var end = lines[index + 1].End;
            if (!header.Balanced || !separator.Balanced || header.Cells.Count != separator.Cells.Count || header.Cells.Count > 64)
                issues.Add(Problem("table-header", "Header and separator must contain the same 1–64 unambiguous columns.", start, end - start));
            index += 2;
            for (; index < lines.Length; index++)
            {
                line = lines[index];
                if (string.IsNullOrWhiteSpace(line.Text) || Container(line.Text) || StartsFence(line.Text)
                    || Regex.IsMatch(line.Text, @"\A {0,3}(?:#{1,6}(?:\s|$)|[-+*]\s|[0-9]+[.)]\s)")) break;
                var row = Split(line.Text);
                end = line.End;
                if (!row.Balanced || row.Cells.Count != header.Cells.Count)
                    issues.Add(Problem("table-row", "Ragged rows or unmatched wiki/code delimiters require review; nothing is padded or discarded.", line.Start, line.Text.Length));
                rows.Add(row.Cells.Select(cell =>
                {
                    var (markdown, breaks) = ConvertBreaks(cell.Text);
                    return new MarkdownTableCell(cell.Text, markdown, new(line.Start + cell.Start, cell.Length), breaks);
                }).ToArray());
                if (rows.Count >= 1000)
                {
                    if (index + 1 < lines.Length && Split(lines[index + 1].Text).HasPipes)
                        issues.Add(Problem("table-rows", "Table exceeds the bounded 1,000-row import limit.", line.Start, line.Text.Length));
                    index++; break;
                }
            }
            index--; // Let the outer block-context scan consume the terminating line.
            if (rows.Count == 0) issues.Add(Problem("table-empty", "A table needs at least one data row.", start, end - start));
            tables.Add(new(tables.Count, new(start, end - start), header.Cells.Select(c => c.Text).ToArray(), rows, issues));
            if (tables.Count >= 100) return new(tables, [Problem("table-count", "Source exceeds the bounded 100-table scan limit.", end, 0)]);
        }
        return new(tables, []);
    }

    private static Row Split(string line)
    {
        var cuts = new List<int>(); var wiki = false; var ticks = 0; var balanced = true;
        for (var index = 0; index < line.Length; index++)
        {
            var character = line[index];
            if (character == '\\' && ticks == 0) { if (index + 1 < line.Length) index++; continue; }
            if (character == '`')
            {
                var end = index + 1; while (end < line.Length && line[end] == '`') end++;
                var count = end - index;
                if (ticks == 0) ticks = count; else if (ticks == count) ticks = 0;
                index = end - 1; continue;
            }
            if (ticks > 0) continue;
            if (index + 1 < line.Length && line.AsSpan(index, 2).SequenceEqual("[[")) { if (wiki) balanced = false; wiki = true; index++; continue; }
            if (index + 1 < line.Length && line.AsSpan(index, 2).SequenceEqual("]]")) { if (!wiki) balanced = false; wiki = false; index++; continue; }
            if (character == '|' && !wiki) cuts.Add(index);
        }
        if (wiki || ticks != 0) balanced = false;
        var start = 0; var cells = new List<Cell>();
        foreach (var cut in cuts.Append(line.Length))
        {
            var left = start; var right = cut;
            while (left < right && char.IsWhiteSpace(line[left])) left++;
            while (right > left && char.IsWhiteSpace(line[right - 1])) right--;
            cells.Add(new(line[left..right], left, right - left)); start = cut + 1;
        }
        if (cuts.Count > 0 && string.IsNullOrWhiteSpace(line[..cuts[0]])) cells.RemoveAt(0);
        if (cuts.Count > 0 && string.IsNullOrWhiteSpace(line[(cuts[^1] + 1)..])) cells.RemoveAt(cells.Count - 1);
        return new(cells, cuts.Count > 0, balanced);
    }

    private static (string Markdown, int Count) ConvertBreaks(string cell)
    {
        var result = new StringBuilder(); var ticks = 0; var count = 0;
        for (var index = 0; index < cell.Length;)
        {
            if (cell[index] == '\\' && ticks == 0 && index + 1 < cell.Length) { result.Append(cell, index, 2); index += 2; continue; }
            if (cell[index] == '`')
            {
                var end = index + 1; while (end < cell.Length && cell[end] == '`') end++;
                var length = end - index; if (ticks == 0) ticks = length; else if (ticks == length) ticks = 0;
                result.Append(cell, index, length); index = end; continue;
            }
            if (ticks == 0 && cell[index] == '<' && Break.Match(cell, index) is { Success: true } match)
            { result.Append('\n'); index += match.Length; count++; }
            else result.Append(cell[index++]);
        }
        return (result.ToString(), count);
    }
    private static bool Container(string line) => line.StartsWith("    ", StringComparison.Ordinal) || line.StartsWith('\t') || line.TrimStart().StartsWith('>');
    private static bool StartsFence(string line) => line.TrimStart().StartsWith("```", StringComparison.Ordinal) || line.TrimStart().StartsWith("~~~", StringComparison.Ordinal);
    private static RecordDiagnostic Problem(string code, string message, int start, int length) => new(code, message, new(start, length));
}
