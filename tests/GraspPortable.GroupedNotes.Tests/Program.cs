using GraspPortable.Host.Workspace.Markdown;

try
{
var a = "11111111111111111111111111111111";
var b = "22222222222222222222222222222222";
var c = "33333333333333333333333333333333";
var passed = 0;
var failed = 0;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
void Test(string name, Action run)
{
    try { run(); passed++; Console.WriteLine($"PASS {name}"); }
    catch (Exception error) { failed++; Console.WriteLine($"FAIL {name}: {error.Message}"); }
}
string Frame(string id, string body, string newline = "\n") => $"<!-- grasp:note {id} -->{newline}{body}{newline}<!-- /grasp:note {id} -->{newline}";
GroupedNoteParse Parse(string source, params string[] ids) => GroupedNoteCodec.Parse(source, ids.Length == 0 ? [a, b] : ids);

Test("exact bodies and UTF-16 ranges for LF CRLF CR and final newlines", () =>
{
    foreach (var newline in new[] { "\n", "\r\n", "\r" })
    foreach (var body in new[] { "", "正文😀", "正文\n", "正文\r", "正文\r\n", "首\r\n\r\n末\r\n\r\n", "  value  \n\t" })
    {
        var written = GroupedNoteCodec.Serialize([new(a, "中文標題", body), new(b, "second", "尾")], newline);
        Check(written.Success, string.Join(";", written.Issues.Select(x => x.Code)));
        var parsed = Parse(written.Source);
        Check(parsed.CanRewrite && parsed.Members.Count == 2, "parse failed");
        Check(parsed.Members[0].Body == body, "exact body lost");
        var span = parsed.Members[0].BodyRange;
        Check(written.Source.Substring(span.Start, span.Length) == body, "range is not exact UTF-16 source");
    }
});
Test("replace preserves prefix separators suffix and other member", () =>
{
    var source = "前言\r\n## heading not body\r\n" + Frame(a, "甲\n", "\r\n") + "\r\n分隔文字\r\n" + Frame(b, "乙\r\n", "\r\n") + "結語";
    var parsed = Parse(source);
    Check(parsed.CanRewrite && parsed.Unassigned.Count == 3 && parsed.Issues.Any(i => i.IsWarning), "unassigned not reported");
    var result = GroupedNoteCodec.ReplaceMember(source, parsed, a, "新😀\r\n\r\n");
    Check(result.Success, "replace failed");
    var after = Parse(result.Source);
    Check(after.Members[0].Body == "新😀\r\n\r\n" && after.Members[1].Body == "乙\r\n", "member changed incorrectly");
    Check(after.Unassigned.Select(x => x.Text).SequenceEqual(parsed.Unassigned.Select(x => x.Text)), "unassigned lost");
    var lfSource = Frame(a, "old");
    var bareCr = GroupedNoteCodec.ReplaceMember(lfSource, Parse(lfSource, a), a, "new\r");
    Check(bareCr.Success && Parse(bareCr.Source, a).Members.Single().Body == "new\r", "body CR merged with framing LF");
});
Test("closed fences ignore complete marker examples", () =>
{
    var body = "```markdown\n" + Frame(a, "example") + "```\n~~~text\n" + Frame(c, "unknown demo") + "~~~\n";
    var written = GroupedNoteCodec.Serialize([new(a, "one", body), new(b, "two", "normal")]);
    Check(written.Success && Parse(written.Source).Members[0].Body == body, "fence sample cut member");
});
Test("inline multiline code ignores marker example", () =>
{
    var body = "before `\n" + Frame(c, "sample") + "` after";
    var written = GroupedNoteCodec.Serialize([new(a, "one", body)]);
    Check(written.Success && Parse(written.Source, a).Members.Single().Body == body, "inline example cut member");
});
Test("unclosed fence blocks merge patch and external parse without changing raw", () =>
{
    Check(!GroupedNoteCodec.Serialize([new(a, "one", "```md\nunfinished")]).Success, "merge allowed unclosed fence");
    var source = Frame(a, "safe");
    var replaced = GroupedNoteCodec.ReplaceMember(source, Parse(source, a), a, "~~~\nunfinished");
    Check(!replaced.Success && replaced.Source == source, "failed patch changed source");
    var external = Frame(a, "```\nunfinished");
    var parsed = Parse(external, a);
    Check(!parsed.CanRewrite && parsed.Source == external && parsed.Issues.Any(i => i.Code == "unclosed-fence"), "external unclosed fence not protected");
});
Test("active marker collision and malformed marker rejected", () =>
{
    Check(!GroupedNoteCodec.Serialize([new(a, "one", Frame(c, "collision"))]).Success, "reserved marker allowed");
    Check(!GroupedNoteCodec.Serialize([new(a, "one", "<!-- grasp:note broken -->")]).Success, "malformed reserved marker allowed");
});
Test("unknown duplicate and missing identities rejected", () =>
{
    Check(!Parse(Frame(a, "a") + Frame(c, "c")).CanRewrite, "unknown ID allowed");
    Check(!Parse(Frame(a, "a") + Frame(a, "a"), a).CanRewrite, "duplicate ID allowed");
    Check(!Parse(Frame(a, "a")).CanRewrite, "missing ID allowed");
    Check(!Parse(Frame(a, "a"), a, a).CanRewrite, "duplicate known ID allowed");
    Check(!Parse(Frame(a, "a"), "bad-id").CanRewrite, "bad known ID allowed");
});
Test("crossed nested and orphan framing rejected", () =>
{
    var crossed = $"<!-- grasp:note {a} -->\n\n<!-- grasp:note {b} -->\n\n<!-- /grasp:note {a} -->\n\n<!-- /grasp:note {b} -->\n";
    Check(!Parse(crossed).CanRewrite, "crossed accepted");
    Check(!Parse($"<!-- /grasp:note {a} -->\n", a).CanRewrite, "orphan accepted");
    Check(!Parse($"<!-- grasp:note {a} -->\nbody", a).CanRewrite, "missing end accepted");
});
Test("empty body requires separate framing newline", () =>
{
    Check(Parse(Frame(a, ""), a).CanRewrite, "empty failed");
    Check(!Parse($"<!-- grasp:note {a} -->\n<!-- /grasp:note {a} -->\n", a).CanRewrite, "missing separator silently accepted");
});
Test("source guard and forged parse ranges cannot overwrite adjacent content", () =>
{
    var source = "prefix\n" + Frame(a, "one") + Frame(b, "two") + "suffix";
    var parsed = Parse(source);
    var stale = GroupedNoteCodec.ReplaceMember(source + "changed", parsed, a, "new");
    Check(!stale.Success && stale.Source == source + "changed", "stale guard failed");
    var forged = parsed with { Members = [new(a, "fake", new(0, source.Length), new(0, source.Length))], CanRewrite = true };
    var result = GroupedNoteCodec.ReplaceMember(source, forged, a, "new");
    Check(result.Success && result.Source == "prefix\n" + Frame(a, "new") + Frame(b, "two") + "suffix", "forged range trusted");
    var invalid = Parse(Frame(a, "```\nunsafe"), a) with { CanRewrite = true, Issues = [] };
    Check(!GroupedNoteCodec.ReplaceMember(invalid.Source, invalid, a, "safe").Success, "forged CanRewrite trusted");
});
Test("canonical UUIDs and escaped headings do not affect identities or body", () =>
{
    var written = GroupedNoteCodec.Serialize([new(Guid.Parse(a).ToString("D"), "title`\n<!-- grasp:note bad -->", "body")]);
    Check(written.Success, "title breaks framing");
    var parsed = Parse(written.Source, a);
    Check(parsed.CanRewrite && parsed.Members.Single().NoteId == a && parsed.Members[0].Body == "body", "canonical identity failed");
    Check(written.Source.StartsWith("## ", StringComparison.Ordinal), "missing H2");
});
Test("external body edit and headings remain body source", () =>
{
    var source = Frame(a, "## inner heading\nexternal edit\n");
    var parsed = Parse(source, a);
    Check(parsed.CanRewrite && parsed.Members.Single().Body == "## inner heading\nexternal edit\n", "heading guessed body boundary");
    Check(!GroupedNoteCodec.ReplaceMember(source, parsed, b, "wrong").Success, "absent member allowed");
});

Console.WriteLine($"GroupedNotes: {passed} fixtures passed, {failed} failed.");
return failed == 0 ? 0 : 1;
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
