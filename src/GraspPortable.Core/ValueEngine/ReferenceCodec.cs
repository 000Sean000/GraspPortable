using System.Text;

namespace GraspPortable.Core.ValueEngine;

public static class ReferenceCodec
{
    public static string Encode(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var character in value)
        {
            if (IsEscapable(character)) builder.Append('\\');
            builder.Append(character);
        }
        return builder.ToString();
    }

    public static string Serialize(ReferenceKind kind, string name, string value)
    {
        if (!SyntaxCharacters.IsName(name)) throw new ArgumentException("Invalid identifier.", nameof(name));
        return kind == ReferenceKind.Wiki
            ? "[[@" + name + "|" + Encode(value) + "]]"
            : "[" + Encode(value) + "](:ref:" + name + ")";
    }

    public static SourcePatch ValuePatch(ParsedReference reference, string value) => new(reference.ValueSpan, Encode(value));
    public static SourcePatch NamePatch(ParsedReference reference, string name)
    {
        if (!SyntaxCharacters.IsName(name)) throw new ArgumentException("Invalid identifier.", nameof(name));
        return new(reference.NameSpan, name);
    }

    /// <summary>Applies non-overlapping edits against one already revision-checked source snapshot.</summary>
    public static string ApplyPatches(string source, IEnumerable<SourcePatch> patches)
    {
        var ordered = patches.OrderBy(patch => patch.Span.Start).ToArray();
        var builder = new StringBuilder(source.Length);
        var cursor = 0;
        foreach (var patch in ordered)
        {
            if (patch.Span.Start < cursor || patch.Span.Length < 0 || patch.Span.End > source.Length)
                throw new ArgumentException("Patches must be in bounds and must not overlap.", nameof(patches));
            builder.Append(source, cursor, patch.Span.Start - cursor);
            builder.Append(patch.Text);
            cursor = patch.Span.End;
        }
        builder.Append(source, cursor, source.Length - cursor);
        return builder.ToString();
    }

    private static bool IsEscapable(char character) => character is '\\' or '[' or ']' or '|';

    internal static bool TryRead(string source, int start, int end, out ParsedReference? reference,
        out ParseDiagnostic? diagnostic, out int next, CancellationToken cancellationToken = default)
    {
        reference = null;
        diagnostic = null;
        next = start + 1;
        var wiki = source.AsSpan(start, end - start).StartsWith("[[@", StringComparison.Ordinal);
        var at = start + (wiki ? 3 : 1);
        var nameStart = at;
        var nameEnd = at;
        if (wiki)
        {
            if (!SyntaxCharacters.ReadName(source, ref at, end) || at >= end || source[at] != '|')
            {
                diagnostic = new("reference-name", "Managed wikilink 需要合法名稱及 | 分隔符。", SourceSpan.Between(start, at));
                next = Math.Max(start + 3, at);
                return false;
            }
            nameEnd = at++;
        }
        var valueStart = at;
        var builder = new StringBuilder();
        string? valueError = null;
        while (at < end)
        {
            if ((at & 4095) == 0) cancellationToken.ThrowIfCancellationRequested();
            var character = source[at];
            if (character == ']') break;
            if (character == '[')
            {
                // Never borrow a later independent occurrence's closer.
                if (wiki) diagnostic = new("reference-value", "引用值中的 [ 必須跳脫。", new(at, 1));
                next = at;
                return false;
            }
            if (character == '\\')
            {
                if (at + 1 < end && IsEscapable(source[at + 1]))
                {
                    builder.Append(source[at + 1]);
                    at += 2;
                    continue;
                }
                valueError = "引用值含未知 escape；只辨識反斜線、中括弧與 pipe。";
            }
            if (character == '|') valueError = "引用值中的 pipe 必須跳脫。";
            builder.Append(character);
            at++;
        }
        if (at >= end)
        {
            if (wiki) diagnostic = new("reference-unclosed", "Managed wikilink 尚未閉合。", SourceSpan.Between(start, end));
            next = end;
            return false;
        }
        var valueEnd = at;
        if (wiki)
        {
            if (at + 1 >= end || source[at + 1] != ']')
            {
                diagnostic = new("reference-unclosed", "Managed wikilink 需要連續的 ]]；值中的 ] 必須跳脫。", new(at, 1));
                next = at + 1;
                return false;
            }
            at += 2;
        }
        else
        {
            if (!source.AsSpan(at, end - at).StartsWith("](:ref:", StringComparison.Ordinal))
            {
                next = at + 1;
                return false;
            }
            at += 7;
            nameStart = at;
            if (!SyntaxCharacters.ReadName(source, ref at, end) || at >= end || source[at] != ')')
            {
                diagnostic = new("reference-name", "Reference 需要合法名稱及閉合的 )。", SourceSpan.Between(start, at));
                next = at;
                return false;
            }
            nameEnd = at++;
        }
        next = at;
        if (valueError is not null)
        {
            diagnostic = new("reference-value", valueError, SourceSpan.Between(valueStart, valueEnd));
            return false;
        }
        reference = new(wiki ? ReferenceKind.Wiki : ReferenceKind.Pure, source[nameStart..nameEnd],
            SourceSpan.Between(nameStart, nameEnd), SourceSpan.Between(valueStart, valueEnd),
            SourceSpan.Between(start, at), builder.ToString());
        return true;
    }
}
