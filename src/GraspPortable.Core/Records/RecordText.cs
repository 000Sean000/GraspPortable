using System.Text.RegularExpressions;

namespace GraspPortable.Core.Records;

internal static class RecordText
{
    internal readonly record struct Line(int Start, string Text, string Eol)
    { public int End => Start + Text.Length + Eol.Length; }
    internal static IEnumerable<Line> Lines(string text)
    {
        for (var start = 0; start < text.Length;)
        {
            var end = start;
            while (end < text.Length && text[end] is not ('\r' or '\n')) end++;
            var eol = end == text.Length ? "" : text[end] == '\r' && end + 1 < text.Length && text[end + 1] == '\n' ? "\r\n" : text[end].ToString();
            yield return new(start, text[start..end], eol); start = end + eol.Length;
        }
    }
    internal static string NewLine(string text) => Lines(text).Select(l => l.Eol).FirstOrDefault(e => e.Length > 0) ?? "\n";
    internal static bool Id(string id) => Guid.TryParseExact(id, "N", out var parsed) && parsed != Guid.Empty && parsed.ToString("N") == id;
    internal static bool Key(string key) => Regex.IsMatch(key, @"\A[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\z", RegexOptions.CultureInvariant);
    /// <summary>Line-oriented fenced-code state, after a known container's indentation is removed.</summary>
    internal sealed class Fence
    {
        private char mark;
        private int count;
        internal bool IsOpen => mark != '\0';
        internal bool Consume(string text)
        {
            var spaces = text.TakeWhile(c => c == ' ').Count();
            if (spaces > 3) return mark != '\0';
            var value = text[spaces..];
            var run = value.Length > 0 && value[0] is '`' or '~' ? value.TakeWhile(c => c == value[0]).Count() : 0;
            if (mark != '\0')
            {
                if (run >= count && value[0] == mark && value[run..].All(c => c is ' ' or '\t')) { mark = '\0'; count = 0; }
                return true;
            }
            if (run >= 3 && (value[0] != '`' || !value[run..].Contains('`'))) { mark = value[0]; count = run; return true; }
            return false;
        }
    }
}
