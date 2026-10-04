using GraspPortable.Host.Workspace.Markdown;

try
{
var a = "11111111111111111111111111111111";
var b = "22222222222222222222222222222222";
var passed = 0;
var failed = 0;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
void Test(string name, Action run)
{
    try { run(); passed++; Console.WriteLine($"PASS {name}"); }
    catch (Exception error) { failed++; Console.WriteLine($"FAIL {name}: {error.Message}"); }
}
string Apply(string source, GroupingLinkPlan plan, string path)
{
    Check(plan.CanApply, string.Join(";", plan.Issues.Select(i => i.Code + ":" + i.Message)));
    foreach (var patch in plan.Patches.Where(p => p.SourcePath == path).OrderByDescending(p => p.Start))
    {
        Check(source.Substring(patch.Start, patch.Length) == patch.Before, "patch source mismatch");
        source = source[..patch.Start] + patch.After + source[(patch.Start + patch.Length)..];
    }
    return source;
}
GroupingLinkPlan Merge(string bodyA, string bodyB, string incoming, params string[] assets) => GroupingLinks.Plan(
    [new(a, "Notes/A.md", "Groups/All.md", bodyA, AfterPresentationAnchor: "Member A"), new(b, "Notes/B.md", "Groups/All.md", bodyB, AfterPresentationAnchor: "Member B")],
    [new("Notes/A.md", bodyA), new("Notes/B.md", bodyB), new("Index.md", incoming)],
    ["Notes/A.md", "Notes/B.md", "Index.md", .. assets], ["", "grasp"]);

Test("incoming Markdown/wiki paths keep labels titles aliases and select member", () =>
{
    var source = "😀\r\n[甲](Notes/A.md \"title\")\r\n[[B|別名]]";
    var plan = Merge("A", "B", source);
    Check(Apply(source, plan, "Index.md") == "😀\r\n[甲](Groups/All.md#Member%20A \"title\")\r\n[[Groups/All#Member B|別名]]", "incoming format changed");
    Check(plan.Patches.All(p => p.OriginNoteId is null), "incoming external owner invented");
});
Test("H1 H2 and Setext anchors remain flat and exact", () =>
{
    var incoming = "[one](Notes/A.md#Intro) [[A#Details|two]] [three](Notes/B.md#Setext%20heading)";
    var plan = Merge("# Intro\n## Details\n", "Setext heading\n---\n", incoming);
    var rewritten = Apply(incoming, plan, "Index.md");
    Check(rewritten == "[one](Groups/All.md#Intro) [[Groups/All#Details|two]] [three](Groups/All.md#Setext%20heading)", "anchor/alias encoding lost");
    Check(!rewritten.Contains("#Member"), "nested heading strategy introduced");
});
Test("relative assets and self headings relocate from member physical origin", () =>
{
    var body = "# Intro\r\n![pic](../Assets/a%20b.png 'caption')\r\n[self](#Intro)\r\n[[B|cross]]";
    var plan = Merge(body, "B", "", "Assets/a b.png");
    Check(Apply(body, plan, "Notes/A.md") == "# Intro\r\n![pic](../Assets/a%20b.png 'caption')\r\n[self](#Intro)\r\n[[Groups/All#Member B|cross]]", "asset/self/cross semantics lost");
    var nested = GroupingLinks.Plan([new(a, "Deep/Notes/A.md", "All.md", "![x](../../Assets/x.png)", AfterPresentationAnchor: "A")],
        [new("Deep/Notes/A.md", "![x](../../Assets/x.png)")], ["Deep/Notes/A.md", "Assets/x.png"], []);
    Check(Apply("![x](../../Assets/x.png)", nested, "Deep/Notes/A.md") == "![x](Assets/x.png)", "outgoing asset not rebased");
});
Test("duplicate target heading and unsupported anchor stop preview", () =>
{
    Check(!Merge("# Same\n", "## Same\n", "[x](Notes/A.md#Same)").CanApply, "duplicate heading allowed");
    Check(!Merge("# Same\n", "## SAME\n", "[x](Notes/A.md#Same)").CanApply, "case variant heading allowed");
    Check(!Merge("line one\nline two\n---\n", "B", "[x](Notes/A.md#line%20two)").CanApply, "multiline Setext misidentified");
    foreach (var anchor in new[] { "^block", "Unknown", "Intro#Child" })
        Check(!Merge("# Intro\n", "B", $"[[A#{anchor}]]").CanApply, "unsupported anchor allowed: " + anchor);
});
Test("public heading query exposes only supported locally unique anchors", () =>
{
    var anchors = GroupingLinks.FindHeadingAnchors("# Intro\n## Child\n\nSetext\n===\n\n# Repeat\n## REPEAT\n```md\n# Code\n```\n", []);
    Check(anchors.SequenceEqual(new[] { "Intro", "Child", "Setext" }), "resolver heading contract differs");
    Check(GroupingLinks.FindHeadingAnchors("# Intro\n# **Intro**\n", []).Count == 0, "formatted collision falsely considered unique");
    Check(!Merge("# **Member B**\n", "B", "[[A]]").CanApply, "formatted presentation collision allowed");
});
Test("split restores member path and strips only known presentation anchor", () =>
{
    var grouped = GroupedNoteCodec.Serialize([new(a, "Member A", "# Intro\n[other](All.md#Member%20B)"), new(b, "Member B", "B heading\n===\n")]).Source;
    var parsed = GroupedNoteCodec.Parse(grouped, [a, b]);
    var incoming = "[[Groups/All#Member A|甲]] [sub](Groups/All.md#B%20heading)";
    var notes = parsed.Members.Select(m => new GroupingLinkNote(m.NoteId, "Groups/All.md", m.NoteId == a ? "Out/A.md" : "Out/B.md", m.Body, m.BodyRange.Start, m.NoteId == a ? "Member A" : "Member B")).ToArray();
    var plan = GroupingLinks.Plan(notes, [new("Groups/All.md", grouped), new("Index.md", incoming)], ["Groups/All.md", "Index.md"], []);
    Check(Apply(incoming, plan, "Index.md") == "[[Out/A|甲]] [sub](Out/B.md#B%20heading)", "split incoming wrong");
    Check(Apply(grouped, plan, "Groups/All.md").Contains("[other](B.md)"), "split member outgoing link wrong");
});
Test("split group without member refuses implicit primary", () =>
{
    var grouped = GroupedNoteCodec.Serialize([new(a, "Member A", "A"), new(b, "Member B", "B")]).Source;
    var parsed = GroupedNoteCodec.Parse(grouped, [a, b]);
    var notes = parsed.Members.Select(m => new GroupingLinkNote(m.NoteId, "All.md", m.NoteId == a ? "A.md" : "B.md", m.Body, m.BodyRange.Start, m.NoteId == a ? "Member A" : "Member B")).ToArray();
    var plan = GroupingLinks.Plan(notes, [new("All.md", grouped), new("Index.md", "[[All]]")], ["All.md", "Index.md"], []);
    Check(!plan.CanApply && plan.Issues.Any(i => i.Code == "group-without-member"), "primary silently selected");
});
Test("fence inline code literals and reference cache are never rewritten", () =>
{
    var input = "`[[A]]`\n```md\n[A](Notes/A.md)\n```\n@code{ @Demo = {[[A]]} }\n[[@Demo|[[A]]]]\n<!-- [[A]] -->";
    var plan = Merge("A", "B", input);
    Check(plan.CanApply && plan.Patches.Count == 0, "opaque content rewritten");
});
Test("presentation drift duplicate heading and forged member slice refused", () =>
{
    var grouped = GroupedNoteCodec.Serialize([new(a, "Changed", "A")]).Source;
    var member = GroupedNoteCodec.Parse(grouped, [a]).Members.Single();
    var plan = GroupingLinks.Plan([new(a, "All.md", "A.md", member.Body, member.BodyRange.Start, "Original")], [new("All.md", grouped)], ["All.md"], []);
    Check(!plan.CanApply && plan.Issues.Any(i => i.Code == "presentation-changed"), "external heading changed silently accepted");
    Check(!Merge("# Member B\n", "B", "").CanApply, "presentation/body heading collision allowed");
    Check(!GroupingLinks.Plan([new(a, "A.md", "All.md", "fake")], [new("A.md", "real")], ["A.md"], []).CanApply, "forged source accepted");
});
Test("ambiguous wiki targets missing assets HTML and note embeds refused", () =>
{
    var plan = GroupingLinks.Plan([new(a, "A.md", "All.md", "[[Same]]", AfterPresentationAnchor: "A")], [new("A.md", "[[Same]]")], ["A.md", "X/Same.md", "Y/Same.md"], []);
    Check(!plan.CanApply, "ambiguous basename allowed");
    Check(!Merge("![x](missing.png)", "B", "").CanApply, "missing asset guessed");
    Check(!Merge("<img src='pic.png'>", "B", "", "Notes/pic.png").CanApply, "HTML rewritten");
    Check(!Merge("A", "B", "![[A]]").CanApply, "note embed incorrectly mapped to H2 section");
});
Test("reference definition angle destination escaped parentheses and alias retained", () =>
{
    var input = "[ref]: <Notes/A.md> 'tooltip'\n[[A|alias with \\| pipe]]\n";
    var plan = Merge("A", "B", input);
    Check(Apply(input, plan, "Index.md") == "[ref]: <Groups/All.md#Member%20A> 'tooltip'\n[[Groups/All#Member A|alias with \\| pipe]]\n", "source format not preserved");
    var body = "![x](../Assets/a\\(b\\).png)";
    Check(Merge(body, "B", "", "Assets/a(b).png").CanApply, "escaped parentheses unsupported");
});

Console.WriteLine($"GroupingLinks: {passed} fixtures passed, {failed} failed.");
return failed == 0 ? 0 : 1;
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
