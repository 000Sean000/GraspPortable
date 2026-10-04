using System.Diagnostics;
using GraspPortable.Core.ValueEngine;

try
{
var passed = 0;
var failed = 0;
string[] policy = ["", "grasp"];

void Check(string name, Action action)
{
    try { action(); passed++; }
    catch (Exception exception) { failed++; Console.Error.WriteLine($"FAIL {name}: {exception.Message}"); }
}
void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new InvalidOperationException($"Expected [{expected}], actual [{actual}].");
}
void True(bool condition, string message = "Assertion failed")
{
    if (!condition) throw new InvalidOperationException(message);
}
ParseResult Parse(string source) => GraspParser.Parse(source, policy);
string LiteralValue(string literal)
{
    var result = Parse("@code{ @A = " + literal + " }");
    True(result.IsValid, string.Join("; ", result.Diagnostics.Select(d => d.Message)));
    return result.Definitions.Single().Parts.Single().Text;
}

var literals = new Dictionary<string, string>
{
    ["{}"] = "",
    ["{{}}"] = "",
    ["{{{}}}"] = "",
    ["{   }"] = "   ",
    ["{x}"] = "x",
    ["{{x}}"] = "x",
    ["{|x|}"] = "|x|",
    ["{{before {x} after}}"] = "before {x} after",
    ["{{{before {{x}} after}}}"] = "before {{x}} after",
    ["{\\{...\\}}"] = "{...}",
    ["{\\{\\{...\\}\\}}"] = "{{...}}",
    ["{C:\\temp}"] = "C:\\temp",
    ["{\\\\server\\share}"] = "\\\\server\\share",
    ["{\\}"] = "\\",
    ["{\\}}"] = "}",
    ["{{a \\{x\\} b}}"] = "a \\{x\\} b",
    ["{\n}"] = "",
    ["{\n\n}"] = "",
    ["{  \r\n第一段。\r\n\r\n第二段。\r\n  }"] = "第一段。\r\n\r\n第二段。",
    ["{\n\nx\n\n}"] = "\nx\n",
    ["{\r\n\r\nx\r\n\r\n}"] = "\r\nx\r\n",
    ["{\nx\r\r\n}"] = "x\r",
    ["{{\n{\n  \"path\": \"C:\\\\temp\"\n}\n}}"] = "{\n  \"path\": \"C:\\\\temp\"\n}",
};
foreach (var (literal, expected) in literals) Check("literal " + literal.Replace('\n', '↵'), () => Equal(expected, LiteralValue(literal)));

string[] values = ["", " ", "\t", "hello", "|x|", "{x}", "{{x}}", "before {x} after", "中😀文",
    "\n", "\r", "\r\n", "a\r", "\na", "a\n", "\n\n", "\r\n\r", " x \n y ", "\\{",
    "\\}", "\\", "\\\\", "C:\\temp", "\\\\server\\share", "a ] [ | \\ b", "[[@A|x]]",
    "@code{ @A = {x} }", "{\r\nx\n}\r", "a\n\nb", "\r\n{{\r\n}}\r\n", "\n\r\r\n"];
foreach (var value in values)
{
    Check("literal roundtrip " + value.Replace('\n', '↵'), () => Equal(value, LiteralValue(LiteralCodec.Serialize(value))));
    foreach (var kind in Enum.GetValues<ReferenceKind>())
        Check("reference roundtrip " + kind + " " + value.Replace('\n', '↵'), () =>
        {
            var serialized = ReferenceCodec.Serialize(kind, "Person.Job", value);
            var source = "😀 before " + serialized + " after";
            var parsed = Parse(source);
            True(parsed.IsValid, string.Join("; ", parsed.Diagnostics.Select(d => d.Message)));
            var reference = parsed.References.Single();
            Equal(kind, reference.Kind);
            Equal(value, reference.CachedValue);
            Equal("Person.Job", source[reference.NameSpan.Start..reference.NameSpan.End]);
            Equal(serialized, source[reference.Span.Start..reference.Span.End]);
            Equal(10, reference.Span.Start);
        });
}

Check("ordered composition and exact spans", () =>
{
    var source = "😀@code{ @Fruit = {apple} @Person.Job = {doctor} @Slogan = {An } + Fruit\r\n + { a day } + Fruit + Person.Job }";
    var parsed = Parse(source);
    True(parsed.IsValid);
    Equal(3, parsed.Definitions.Count);
    var definition = parsed.Definitions[2];
    Equal("Slogan", source[definition.NameSpan.Start..definition.NameSpan.End]);
    Equal("{An } + Fruit\r\n + { a day } + Fruit + Person.Job", source[definition.ExpressionSpan.Start..definition.ExpressionSpan.End]);
    Equal("An apple a day appledoctor", DependencyEvaluator.Evaluate(parsed.Definitions).Values["Slogan"].Value);
});

string[] invalid = ["@code{ @A = {x}", "@code{ @A = {x} @B = }", "@code{ @A = B C }", "@code{ @A = B + @Next = {x} }",
    "@code{ @A = @B }", "@code{ @Person . Job = {x} }", "@code{ @A = Person. Job }", "@code{ @1A = {x} }",
    "@code{ @A = {a{b} }", "@code{ @A = {\nleft } right\n} }", "@code{ @A = {x}; @B = {y} }", "@code{ @A = {x} @A = {y} }"];
foreach (var source in invalid) Check("invalid " + source, () => True(!Parse(source).IsValid));
Check("invalid region has no partial definitions", () => Equal(0, Parse("@code{ @A = {x} @B = ").Definitions.Count));
Check("namespaces and case are distinct", () => True(Parse("@code{ @A = {x} @a = {y} @First.A = {z} }").IsValid));

foreach (var language in new[] { "", "grasp", "GRASP extra", "json", "grasp-demo", "other" })
    Check("fence " + language, () =>
    {
        var result = Parse("```" + language + "\n@code{ @A = {x} } [x](:ref:A)\n```\n");
        var enabled = language is "" or "grasp" or "GRASP extra";
        Equal(enabled ? 1 : 0, result.Definitions.Count);
        Equal(enabled ? 1 : 0, result.References.Count);
        True(result.IsValid);
    });
Check("disabled outer never reenables inner", () =>
    Equal(0, Parse("````grasp-demo\n```grasp\n@code{ @A = {x} }\n```\n````").Definitions.Count));
Check("fence is hard boundary", () =>
{
    var result = Parse("@code{ @A = {\n```json\ntext\n```\n} }");
    True(!result.IsValid);
    Equal(0, result.Definitions.Count);
});
Check("enabled longer fence carries literal fence", () =>
{
    var result = Parse("````grasp\n@code{ @A = {\n```json\ntext\n```\n} }\n````");
    True(result.IsValid);
    Equal("```json\ntext\n```", result.Definitions.Single().Parts.Single().Text);
});
Check("workspace policy custom language", () => Equal(1,
    GraspParser.Parse("```custom\n@code{ @A = {x} }\n```", ["custom"]).Definitions.Count));
Check("policy change disables definition", () => Equal(0,
    GraspParser.Parse("```grasp\n@code{ @A = {x} }\n```", []).Definitions.Count));
Check("opaque contexts", () =>
{
    var source = "---\nkey: @code{ @A = {x} }\n---\n`@code{ @B = {x} }`\n    @code{ @C = {x} }\n"
        + "<div>\n@code{ @D = {x} }\n</div>\n<span title=\"@code{ @E = {x} }\">ok</span>\n"
        + "[link](https://example.test/@code{@F={x}})\n<!-- @code{ @G = {x} } -->\n";
    var result = Parse(source);
    True(result.IsValid);
    Equal(0, result.Definitions.Count);
});
Check("literal and reference values are opaque", () =>
{
    var source = "@code{ @A = {{text @code{ @X = nope } [x](:ref:X) after}} } "
        + ReferenceCodec.Serialize(ReferenceKind.Pure, "A", "@code{ @Y = {x} } [[@Y|x]]");
    var result = Parse(source);
    True(result.IsValid);
    Equal(1, result.Definitions.Count);
    Equal(1, result.References.Count);
});
Check("fences in frontmatter cannot capture following body", () =>
{
    var result = Parse("---\nexample: ```json\n---\n@code{ @A = {x} }");
    True(result.IsValid);
    Equal(1, result.Definitions.Count);
});
Check("HTML block ends at blank line", () =>
{
    var result = Parse("<section>\n@code{ @Hidden = {x} }\n</section>\n\n@code{ @A = {x} }");
    True(result.IsValid);
    Equal("A", result.Definitions.Single().Name);
});
Check("ordinary link and adjacent references", () =>
{
    var result = Parse("[ordinary](url) [x](:ref:X) [next](:ref:Y) tail");
    True(result.IsValid);
    Equal(2, result.References.Count);
});
Check("unknown reference escape rejected", () => True(!Parse("[a\\q](:ref:X)").IsValid));
Check("wiki first closer never borrowed", () => True(!Parse("[[@X|a] blah ]] next").IsValid));
Check("reference patches preserve surrounding source", () =>
{
    var source = "😀 [old](:ref:X) end";
    var reference = Parse(source).References.Single();
    var patched = ReferenceCodec.ApplyPatches(source, [ReferenceCodec.ValuePatch(reference, "a\n\nb]"), ReferenceCodec.NamePatch(reference, "Y")]);
    Equal("😀 " + ReferenceCodec.Serialize(ReferenceKind.Pure, "Y", "a\n\nb]") + " end", patched);
});
Check("patch overlap rejected", () =>
{
    try { ReferenceCodec.ApplyPatches("hello", [new(new(0, 3), "x"), new(new(2, 2), "y")]); }
    catch (ArgumentException) { return; }
    throw new InvalidOperationException("Overlap was accepted.");
});

Check("graph missing and dependants", () =>
{
    var values = DependencyEvaluator.Evaluate(Parse("@code{ @A = Missing @B = A }").Definitions).Values;
    Equal(EvaluationStatus.Missing, values["A"].Status);
    Equal(EvaluationStatus.DependencyError, values["B"].Status);
});
Check("graph SCC marks only cycle members", () =>
{
    var result = DependencyEvaluator.Evaluate(Parse("@code{ @A = B + C @B = A @C = B @D = A @E = E @F = {ok} }").Definitions);
    foreach (var name in new[] { "A", "B", "C", "E" }) Equal(EvaluationStatus.Cycle, result.Values[name].Status);
    Equal(EvaluationStatus.DependencyError, result.Values["D"].Status);
    Equal("ok", result.Values["F"].Value);
});
Check("resource limit never returns truncated success", () =>
{
    var result = DependencyEvaluator.Evaluate(Parse("@code{ @A = {12345} @B = A + A }").Definitions, maxValueLength: 8);
    Equal(EvaluationStatus.ResourceLimit, result.Values["B"].Status);
    Equal<string?>(null, result.Values["B"].Value);
});
Check("duplicate cross-note definition", () =>
{
    var definitions = Parse("@code{ @A = {x} }").Definitions.Concat(Parse("@code{ @A = {y} @B = A }").Definitions);
    var result = DependencyEvaluator.Evaluate(definitions);
    Equal(EvaluationStatus.Duplicate, result.Values["A"].Status);
    Equal(EvaluationStatus.DependencyError, result.Values["B"].Status);
});
Check("evaluation cancellation", () =>
{
    using var cts = new CancellationTokenSource();
    cts.Cancel();
    try { DependencyEvaluator.Evaluate(Parse("@code{ @A = {x} }").Definitions, cts.Token); }
    catch (OperationCanceledException) { return; }
    throw new InvalidOperationException("Cancellation was ignored.");
});
Check("parse cancellation", () =>
{
    using var cts = new CancellationTokenSource();
    cts.Cancel();
    try { GraspParser.Parse("@code{ @A = {x} }", policy, cts.Token); }
    catch (OperationCanceledException) { return; }
    throw new InvalidOperationException("Cancellation was ignored.");
});
Check("aggregate expansion budget", () =>
{
    var result = DependencyEvaluator.Evaluate(Parse("@code{ @A = {12345} @B = A @C = A }").Definitions,
        maxTotalValueLength: 12);
    Equal(EvaluationStatus.ResourceLimit, result.Values["C"].Status);
    Equal<string?>(null, result.Values["C"].Value);
});
Check("incremental reuse preserves unaffected values and enforces budgets", () =>
{
    var before = DependencyEvaluator.Evaluate(Parse("@code{ @A = {x} @B = A + {!} @Stable = {same} }").Definitions);
    var changed = Parse("@code{ @A = {y} @B = A + {!} @Stable = {same} }").Definitions;
    var affected = new HashSet<string>(["A", "B"], StringComparer.Ordinal);
    var next = DependencyEvaluator.Evaluate(changed, previousValues: before.Values, affectedNames: affected);
    Equal("y!", next.Values["B"].Value);
    True(ReferenceEquals(before.Values["Stable"], next.Values["Stable"]), "Unchanged value was recomputed.");
    True(!ReferenceEquals(before.Values["B"], next.Values["B"]), "Affected value was reused.");
    foreach (var perValue in new[] { 3, 100 })
    {
        var cached = DependencyEvaluator.Evaluate(changed, maxValueLength: perValue, maxTotalValueLength: 5,
            previousValues: before.Values, affectedNames: affected);
        var uncached = DependencyEvaluator.Evaluate(changed, maxValueLength: perValue, maxTotalValueLength: 5);
        foreach (var pair in uncached.Values) Equal(pair.Value, cached.Values[pair.Key]);
        True(cached.Diagnostics.SequenceEqual(uncached.Diagnostics), "Cache changed budget diagnostics.");
    }
});
Check("incremental missing target and dependency replacement update descendants", () =>
{
    var before = DependencyEvaluator.Evaluate(Parse("@code{ @A = New @B = A + {!} @Stable = {same} }").Definitions);
    var added = Parse("@code{ @A = New @B = A + {!} @Stable = {same} @New = {new} @Other = {other} }").Definitions;
    var first = DependencyEvaluator.Evaluate(added, previousValues: before.Values,
        affectedNames: new HashSet<string>(["New", "Other", "A", "B"], StringComparer.Ordinal));
    Equal("new!", first.Values["B"].Value);
    Equal(0, first.Diagnostics.Count);
    True(ReferenceEquals(before.Values["Stable"], first.Values["Stable"]));
    var replaced = Parse("@code{ @A = Other @B = A + {!} @Stable = {same} @New = {new} @Other = {other} }").Definitions;
    var second = DependencyEvaluator.Evaluate(replaced, previousValues: first.Values,
        affectedNames: new HashSet<string>(["A", "B"], StringComparer.Ordinal));
    Equal("other!", second.Values["B"].Value);
    foreach (var pair in DependencyEvaluator.Evaluate(replaced).Values) Equal(pair.Value, second.Values[pair.Key]);
    True(ReferenceEquals(first.Values["Stable"], second.Values["Stable"]));
});
Check("authoritative regions preserve raw UTF16 ranges and host exclusions", () =>
{
    var source = "😀 before\r\n@code{ @A = {text} }\r\n```json\r\n@code{ @Hidden = {x} }\r\n```\r\n`@code{}`\r\n[@code{ @Fake = {x} }](:ref:A)\r\n@code{}";
    var parsed = Parse(source);
    True(parsed.IsValid);
    Equal(2, parsed.Regions!.Count);
    Equal("@code{ @A = {text} }", source.Substring(parsed.Regions[0].Span.Start, parsed.Regions[0].Span.Length));
    Equal("@code{}", source.Substring(parsed.Regions[1].Span.Start, parsed.Regions[1].Span.Length));
    True(parsed.Regions.All(r => r.IsComplete));
    var partial = Parse("@code{ @Pending = {");
    Equal(1, partial.Regions!.Count);
    True(!partial.Regions[0].IsComplete);
    Equal(0, partial.Definitions.Count);
});
Check("deep chain and wide fanout bounded stress", () =>
{
    foreach (var fanout in new[] { false, true })
    {
        var count = fanout ? 10000 : 1000;
        var parts = new List<Definition> { new("N0", new(), new(), new(), [new(PartKind.Literal, "x", new())]) };
        for (var i = 1; i <= count; i++)
            parts.Add(new("N" + i, new(), new(), new(), [new(PartKind.Identifier, "N" + (fanout ? 0 : i - 1), new())]));
        var watch = Stopwatch.StartNew();
        var result = DependencyEvaluator.Evaluate(parts);
        Equal("x", result.Values["N" + count].Value);
        Equal(0, result.Diagnostics.Count);
        Console.WriteLine($"Core {(fanout ? "fanout" : "deep")} {count}: {watch.Elapsed.TotalMilliseconds:F1} ms (not end-to-end/UI evidence)");
    }
});

Console.WriteLine($"Core fixtures: {passed} passed, {failed} failed.");
return failed == 0 ? 0 : 1;
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
