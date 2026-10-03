namespace GraspPortable.Core.ValueEngine;

/// <summary>A half-open range in the original .NET/JavaScript UTF-16 source.</summary>
public readonly record struct SourceSpan(int Start, int Length)
{
    public int End => checked(Start + Length);
    public static SourceSpan Between(int start, int end) => new(start, end - start);
}

public enum PartKind { Literal, Identifier }
public enum ReferenceKind { Pure, Wiki }
public enum EvaluationStatus { Valid, Missing, Cycle, DependencyError, ResourceLimit, Duplicate }

public sealed record BindingPart(PartKind Kind, string Text, SourceSpan Span);
public sealed record Definition(string Name, SourceSpan NameSpan, SourceSpan Span,
    SourceSpan ExpressionSpan, IReadOnlyList<BindingPart> Parts);
public sealed record ParsedReference(ReferenceKind Kind, string Name, SourceSpan NameSpan,
    SourceSpan ValueSpan, SourceSpan Span, string CachedValue);
public sealed record ParseDiagnostic(string Code, string Message, SourceSpan Span);
public sealed record ParseResult(IReadOnlyList<Definition> Definitions,
    IReadOnlyList<ParsedReference> References, IReadOnlyList<ParseDiagnostic> Diagnostics)
{
    public bool IsValid => Diagnostics.Count == 0;
}

public sealed record SourcePatch(SourceSpan Span, string Text);
public sealed record EvaluatedValue(string? Value, EvaluationStatus Status);
public sealed record EvaluationResult(IReadOnlyDictionary<string, EvaluatedValue> Values,
    IReadOnlyList<ParseDiagnostic> Diagnostics);

internal static class SyntaxCharacters
{
    internal static bool IsNameStart(char c) => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or '_';
    internal static bool IsNamePart(char c) => IsNameStart(c) || c is >= '0' and <= '9';
    internal static bool IsWhitespace(char c) => c is ' ' or '\t' or '\r' or '\n';
    internal static int EolLength(string source, int at, int end) => at < end
        ? source[at] == '\r' ? at + 1 < end && source[at + 1] == '\n' ? 2 : 1
        : source[at] == '\n' ? 1 : 0 : 0;

    internal static bool ReadName(string source, ref int at, int end)
    {
        if (at >= end || !IsNameStart(source[at])) return false;
        while (true)
        {
            at++;
            while (at < end && IsNamePart(source[at])) at++;
            if (at >= end || source[at] != '.') return true;
            at++;
            if (at >= end || !IsNameStart(source[at])) return false;
        }
    }

    internal static bool IsName(string name)
    {
        var at = 0;
        return ReadName(name, ref at, name.Length) && at == name.Length;
    }

    internal static int Run(string source, int at, int end, char character)
    {
        var start = at;
        while (at < end && source[at] == character) at++;
        return at - start;
    }
}
