namespace GraspPortable.Core.ValueEngine;

public static class GraspParser
{
    public static ParseResult Parse(string source, IReadOnlyList<string> enabledFenceLanguages)
        => Parse(source, enabledFenceLanguages, CancellationToken.None);

    public static ParseResult Parse(string source, IReadOnlyList<string> enabledFenceLanguages, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(enabledFenceLanguages);
        var definitions = new List<Definition>();
        var references = new List<ParsedReference>();
        var diagnostics = new List<ParseDiagnostic>();
        var regions = new List<ParsedRegion>();
        var frontmatterEnd = FrontmatterEnd(source);
        var indentedCodeLines = new HashSet<int>();
        cancellationToken.ThrowIfCancellationRequested();
        foreach (var context in MarkdownContextScanner.Scan(source, enabledFenceLanguages, frontmatterEnd, cancellationToken, indentedCodeLines))
        {
            var at = Math.Max(context.Start, frontmatterEnd);
            while (at < context.End)
            {
                if ((at & 4095) == 0) cancellationToken.ThrowIfCancellationRequested();
                if (!context.IsFence && TrySkipMarkdown(source, ref at, context.End, indentedCodeLines)) continue;
                if (source.AsSpan(at, context.End - at).StartsWith("@code{", StringComparison.Ordinal)
                    && (at == context.Start || !SyntaxCharacters.IsNamePart(source[at - 1])))
                {
                    var start = at;
                    var errorsBefore = diagnostics.Count;
                    ParseRegion(source, ref at, context.End, definitions, diagnostics, cancellationToken);
                    regions.Add(new(SourceSpan.Between(start, at), diagnostics.Count == errorsBefore));
                    continue;
                }
                if (source[at] == '[')
                {
                    if (ReferenceCodec.TryRead(source, at, context.End, out var reference, out var diagnostic, out var next, cancellationToken))
                    {
                        references.Add(reference!);
                        at = next;
                        continue;
                    }
                    if (diagnostic is not null)
                    {
                        diagnostics.Add(diagnostic);
                        at = Math.Max(at + 1, next);
                        continue;
                    }
                    // Ordinary Markdown links are opaque; in particular do not scan their destinations.
                    if (TrySkipLink(source, ref at, context.End)) continue;
                }
                at++;
            }
        }
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var definition in definitions)
            if (!names.Add(definition.Name)) diagnostics.Add(new("duplicate", "同 namespace 的 identifier 不能重複定義。", definition.NameSpan));
        return new(definitions, references, diagnostics, regions);
    }

    private static void ParseRegion(string source, ref int at, int end,
        List<Definition> definitions, List<ParseDiagnostic> diagnostics, CancellationToken cancellationToken)
    {
        var regionStart = at;
        var pending = new List<Definition>();
        at += 6;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            SkipWhitespace(source, ref at, end);
            if (at >= end)
            {
                diagnostics.Add(new("region-unclosed", "@code 區域尚未閉合，不能跨過 Markdown fence 邊界。", SourceSpan.Between(regionStart, end)));
                return;
            }
            if (source[at] == '}')
            {
                at++;
                definitions.AddRange(pending);
                return;
            }
            var definitionStart = at;
            if (source[at++] != '@')
            {
                Fail("definition", "定義必須以 @Name = 開始。", definitionStart, ref at);
                return;
            }
            var nameStart = at;
            if (!SyntaxCharacters.ReadName(source, ref at, end))
            {
                Fail("identifier", "Identifier 需使用 ASCII 字母、數字、底線，namespace 點號两側不可有空白。", nameStart, ref at);
                return;
            }
            var nameEnd = at;
            SkipWhitespace(source, ref at, end);
            if (at >= end || source[at++] != '=')
            {
                Fail("assignment", "Identifier 後需要 =。", nameEnd, ref at);
                return;
            }
            SkipWhitespace(source, ref at, end);
            var expressionStart = at;
            var expressionEnd = at;
            var parts = new List<BindingPart>();
            while (true)
            {
                var partStart = at;
                if (at < end && source[at] == '{')
                {
                    if (!LiteralCodec.TryRead(source, ref at, end, out var value, out var error, cancellationToken))
                    {
                        Fail("literal", error!, partStart, ref at);
                        return;
                    }
                    parts.Add(new(PartKind.Literal, value, SourceSpan.Between(partStart, at)));
                }
                else if (SyntaxCharacters.ReadName(source, ref at, end))
                    parts.Add(new(PartKind.Identifier, source[partStart..at], SourceSpan.Between(partStart, at)));
                else
                {
                    Fail("operand", "Expression 缺少 literal 或 identifier；取值不加 @。", partStart, ref at);
                    return;
                }
                expressionEnd = at;
                SkipWhitespace(source, ref at, end);
                if (at < end && source[at] == '+')
                {
                    at++;
                    SkipWhitespace(source, ref at, end);
                    continue;
                }
                if (at < end && source[at] is not ('@' or '}'))
                {
                    Fail("operator", "兩個 operand 間需要 +；下一個定義以 @Name = 開始。", at, ref at);
                    return;
                }
                break;
            }
            pending.Add(new(source[nameStart..nameEnd], SourceSpan.Between(nameStart, nameEnd),
                SourceSpan.Between(definitionStart, expressionEnd), SourceSpan.Between(expressionStart, expressionEnd), parts));
        }

        void Fail(string code, string message, int start, ref int cursor)
        {
            // An invalid region is opaque through the current host span. Do not salvage partial definitions.
            diagnostics.Add(new(code, message, SourceSpan.Between(start, Math.Min(end, Math.Max(start + 1, cursor)))));
            cursor = end;
        }
    }

    private static void SkipWhitespace(string source, ref int at, int end)
    {
        while (at < end && SyntaxCharacters.IsWhitespace(source[at])) at++;
    }

    private static int FrontmatterEnd(string source)
    {
        if (!source.StartsWith("---\n", StringComparison.Ordinal) && !source.StartsWith("---\r", StringComparison.Ordinal)) return 0;
        var at = 3 + SyntaxCharacters.EolLength(source, 3, source.Length);
        while (at < source.Length)
        {
            var end = at;
            while (end < source.Length && source[end] is not ('\r' or '\n')) end++;
            var line = source.AsSpan(at, end - at).Trim();
            if (line.SequenceEqual("---") || line.SequenceEqual("...")) return end + SyntaxCharacters.EolLength(source, end, source.Length);
            at = end + SyntaxCharacters.EolLength(source, end, source.Length);
        }
        return source.Length;
    }

    /// <summary>
    /// Uses the same lexical consumers as parsing to keep multiline values from changing their
    /// enclosing Markdown list context. This does not publish syntax or disable hard fence boundaries.
    /// </summary>
    internal static int OpaqueHostEnd(string source, int at, int lineEnd, CancellationToken token)
    {
        while (at < lineEnd)
        {
            if ((at & 4095) == 0) token.ThrowIfCancellationRequested();
            if (TrySkipMarkdown(source, ref at, source.Length, null))
            { if (at > lineEnd) return at; continue; }
            if (source.AsSpan(at).StartsWith("@code{", StringComparison.Ordinal)
                && (at == 0 || !SyntaxCharacters.IsNamePart(source[at - 1])))
            {
                ParseRegion(source, ref at, source.Length, [], [], token);
                if (at > lineEnd) return at;
                continue;
            }
            if (source[at] == '[')
            {
                if (ReferenceCodec.TryRead(source, at, source.Length, out _, out _, out var next, token))
                { at = next; if (at > lineEnd) return at; continue; }
                if (TrySkipLink(source, ref at, source.Length))
                { if (at > lineEnd) return at; continue; }
            }
            at++;
        }
        return lineEnd;
    }

    private static bool TrySkipMarkdown(string source, ref int at, int end, IReadOnlySet<int>? indentedCodeLines)
    {
        // These exclusions run only outside Grasp regions and reference values.
        if (source[at] == '\\' && at + 1 < end) { at += 2; return true; }
        if (source[at] == '`')
        {
            var length = SyntaxCharacters.Run(source, at, end, '`');
            var next = at + length;
            while (next < end)
            {
                if (source[next] != '`') { next++; continue; }
                var candidate = SyntaxCharacters.Run(source, next, end, '`');
                if (candidate == length) { at = next + length; return true; }
                next += candidate;
            }
            at += length;
            return true;
        }
        if (indentedCodeLines?.Contains(at) == true)
        {
            while (at < end && source[at] is not ('\r' or '\n')) at++;
            return true;
        }
        if (source[at] != '<' || at + 1 >= end) return false;
        if (source.AsSpan(at, end - at).StartsWith("<!--", StringComparison.Ordinal))
        {
            var close = source.IndexOf("-->", at + 4, end - at - 4, StringComparison.Ordinal);
            at = close < 0 ? end : close + 3;
            return true;
        }
        if (!char.IsAsciiLetter(source[at + 1]) && source[at + 1] is not ('/' or '!' or '?')) return false;
        var tagEnd = at + 1;
        char quote = '\0';
        while (tagEnd < end)
        {
            var c = source[tagEnd++];
            if (quote != '\0') { if (c == quote) quote = '\0'; continue; }
            if (c is '\'' or '"') quote = c;
            if (c == '>') break;
        }
        var nameStart = at + 1;
        var nameEnd = nameStart;
        while (nameEnd < tagEnd && char.IsAsciiLetter(source[nameEnd])) nameEnd++;
        var tag = source[nameStart..nameEnd].ToLowerInvariant();
        if (tag is "script" or "style" or "pre" or "textarea")
        {
            var close = source.IndexOf("</" + tag, tagEnd, end - tagEnd, StringComparison.OrdinalIgnoreCase);
            if (close >= 0)
            {
                var closeEnd = source.IndexOf('>', close, end - close);
                at = closeEnd < 0 ? end : closeEnd + 1;
                return true;
            }
            at = end;
            return true;
        }
        var lineStart = at;
        while (lineStart > 0 && source[lineStart - 1] is not ('\r' or '\n')) lineStart--;
        var linePrefix = source.AsSpan(lineStart, at - lineStart);
        var onBlockLine = linePrefix.Length <= 3 && linePrefix.Trim().IsEmpty;
        var blockTags = tag is "address" or "article" or "aside" or "base" or "basefont" or "blockquote"
            or "body" or "caption" or "center" or "col" or "colgroup" or "dd" or "details" or "dialog"
            or "dir" or "div" or "dl" or "dt" or "fieldset" or "figcaption" or "figure" or "footer"
            or "form" or "frame" or "frameset" or "h1" or "h2" or "h3" or "h4" or "h5" or "h6"
            or "head" or "header" or "hr" or "html" or "iframe" or "legend" or "li" or "link"
            or "main" or "menu" or "menuitem" or "nav" or "noframes" or "ol" or "optgroup"
            or "option" or "p" or "param" or "search" or "section" or "summary" or "table"
            or "tbody" or "td" or "tfoot" or "th" or "thead" or "title" or "tr" or "track" or "ul";
        var lineEnd = tagEnd;
        while (lineEnd < end && source[lineEnd] is not ('\r' or '\n')) lineEnd++;
        var wholeLineTag = source.AsSpan(tagEnd, lineEnd - tagEnd).Trim().IsEmpty;
        if (onBlockLine && (blockTags || wholeLineTag))
        {
            at = lineEnd;
            while (at < end)
            {
                at += SyntaxCharacters.EolLength(source, at, end);
                var nextEnd = at;
                while (nextEnd < end && source[nextEnd] is not ('\r' or '\n')) nextEnd++;
                if (source.AsSpan(at, nextEnd - at).Trim().IsEmpty) return true;
                at = nextEnd;
            }
            return true;
        }
        at = tagEnd;
        return true;
    }

    private static bool TrySkipLink(string source, ref int at, int end)
    {
        var cursor = at + 1;
        while (cursor < end)
        {
            if (source[cursor] == '\\') { cursor += 2; continue; }
            if (source[cursor] == '[') return false;
            if (source[cursor] == ']') break;
            cursor++;
        }
        if (cursor + 1 >= end || source[cursor + 1] != '(') return false;
        cursor += 2;
        var depth = 1;
        while (cursor < end)
        {
            if (source[cursor] == '\\') { cursor += 2; continue; }
            if (source[cursor] == '(') depth++;
            if (source[cursor++] == ')' && --depth == 0) { at = cursor; return true; }
        }
        return false;
    }
}
