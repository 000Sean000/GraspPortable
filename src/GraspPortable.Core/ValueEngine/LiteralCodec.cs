using System.Text;

namespace GraspPortable.Core.ValueEngine;

public static class LiteralCodec
{
    public const string SyntaxVersion = "grasp-braces-1";

    /// <summary>Serializes a logical value without normalizing its whitespace or EOLs.</summary>
    public static string Serialize(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length == 0) return "{}";
        var longestRun = 0;
        for (var i = 0; i < value.Length; i++)
        {
            if (value[i] is not ('{' or '}')) continue;
            var run = SyntaxCharacters.Run(value, i, value.Length, value[i]);
            longestRun = Math.Max(longestRun, run);
            i += run - 1;
        }
        var layers = longestRun + 1;
        var opener = new string('{', layers);
        var closer = new string('}', layers);
        // Raw block mode avoids the only context-sensitive inline boundary escapes.
        var block = value.Contains('\r') || value.Contains('\n') || value[0] == '{' || value[^1] == '}'
            || value.StartsWith("\\{", StringComparison.Ordinal) || value.EndsWith("\\}", StringComparison.Ordinal);
        if (!block) return opener + value + closer;
        // CRLF cannot merge a value's trailing lone CR into the structural newline.
        return opener + "\r\n" + value + "\r\n" + closer;
    }

    internal static bool TryRead(string source, ref int at, int end, out string value, out string? error,
        CancellationToken cancellationToken = default)
    {
        value = "";
        error = null;
        var layers = SyntaxCharacters.Run(source, at, end, '{');
        at += layers;
        var afterOpening = at;
        while (at < end && source[at] is ' ' or '\t') at++;
        var eol = SyntaxCharacters.EolLength(source, at, end);
        if (eol > 0)
        {
            at += eol;
            return ReadBlock(source, ref at, end, layers, out value, out error, cancellationToken);
        }
        at = afterOpening;
        return ReadInline(source, ref at, end, layers, out value, out error, cancellationToken);
    }

    private static bool ReadBlock(string source, ref int at, int end, int layers,
        out string value, out string? error, CancellationToken cancellationToken)
    {
        var contentStart = at;
        var lineStart = at;
        value = "";
        error = null;
        while (at < end)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var first = at;
            while (first < end && source[first] is ' ' or '\t') first++;
            var closingRun = SyntaxCharacters.Run(source, first, end, '}');
            if (closingRun >= layers)
            {
                // A closing delimiter must be on its own line, or followed by expression/region tokens.
                // Additional right braces belong to the enclosing region, never guessed as value.
                var contentEnd = lineStart;
                if (contentEnd > contentStart && source[contentEnd - 1] == '\n')
                {
                    contentEnd--;
                    if (contentEnd > contentStart && source[contentEnd - 1] == '\r') contentEnd--;
                }
                else if (contentEnd > contentStart && source[contentEnd - 1] == '\r') contentEnd--;
                value = source[contentStart..contentEnd];
                at = first + layers;
                return true;
            }
            while (at < end && SyntaxCharacters.EolLength(source, at, end) == 0)
            {
                if (source[at] is '{' or '}')
                {
                    var run = SyntaxCharacters.Run(source, at, end, source[at]);
                    if (run >= layers)
                    {
                        error = "Literal 內容與 marker 層數衝突；請增加兩端 marker 層數。";
                        return false;
                    }
                    at += run;
                }
                else at++;
            }
            at += SyntaxCharacters.EolLength(source, at, end);
            lineStart = at;
        }
        error = "多行 literal 尚未閉合。";
        return false;
    }

    private static bool ReadInline(string source, ref int at, int end, int layers,
        out string value, out string? error, CancellationToken cancellationToken)
    {
        var builder = new StringBuilder();
        value = "";
        error = null;
        while (at + 1 < end && source[at] == '\\' && source[at + 1] == '{')
        {
            builder.Append('{');
            at += 2;
        }
        while (at < end)
        {
            if ((at & 4095) == 0) cancellationToken.ThrowIfCancellationRequested();
            if (source[at] == '\\' && at + 1 < end && source[at + 1] == '}')
            {
                var suffix = at;
                var count = 0;
                while (suffix + 1 < end && source[suffix] == '\\' && source[suffix + 1] == '}')
                {
                    suffix += 2;
                    count++;
                }
                if (SyntaxCharacters.Run(source, suffix, end, '}') >= layers)
                {
                    builder.Append('}', count);
                    at = suffix + layers;
                    value = builder.ToString();
                    return true;
                }
            }
            if (source[at] is '{' or '}')
            {
                var character = source[at];
                var run = SyntaxCharacters.Run(source, at, end, character);
                if (run >= layers)
                {
                    if (character == '}')
                    {
                        at += layers;
                        value = builder.ToString();
                        return true;
                    }
                    error = "Literal 內容與 marker 層數衝突；請增加兩端 marker 層數。";
                    return false;
                }
                builder.Append(character, run);
                at += run;
            }
            else builder.Append(source[at++]);
        }
        error = "Literal 尚未閉合。";
        return false;
    }
}
