using GraspPortable.Host.Workspace.Markdown;
using YamlDotNet.RepresentationModel;

try
{
var a = "11111111111111111111111111111111";
var b = "22222222222222222222222222222222";
var c = "33333333333333333333333333333333";
var docA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
var docB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
var docC = "cccccccccccccccccccccccccccccccc";
var groupId = "dddddddddddddddddddddddddddddddd";
var regroupId = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
var splitId = "ffffffffffffffffffffffffffffffff";
var passed = 0;
var failed = 0;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
void Test(string name, Action run)
{
    try { run(); passed++; Console.WriteLine($"PASS {name}"); }
    catch (Exception error) { failed++; Console.WriteLine($"FAIL {name}: {error.Message}"); }
}
string Single(string document, string note, string root = "", string extra = "", string noteExtra = "", string body = "正文 only once") =>
    $"---\n{root}grasp:\n  schema: 1\n  documentId: {document}\n  layout: single\n{extra}  notes:\n    - id: {note}\n      title: 中文\n      bindings: {{}}\n{noteExtra}---\n{body}";
GroupingMetadataSource Input(string source, string path)
{
    var envelope = MarkdownEnvelopeCodec.Read(source);
    return new(source, path, envelope.Metadata!.DocumentId, envelope.Metadata.Notes.Select(n => n.Id).ToArray());
}
string GroupBody(params (string Id, string Body)[] members) => GroupedNoteCodec.Serialize(members.Select(m => new GroupedNoteInput(m.Id, "標題", m.Body)).ToArray()).Source;
YamlMappingNode Map(string text) { var stream = new YamlStream(); stream.Load(new StringReader(text)); return (YamlMappingNode)stream.Documents[0].RootNode; }
YamlNode Node(YamlMappingNode map, string key) => map.Children[new YamlScalarNode(key)];
YamlMappingNode Child(YamlMappingNode map, string key) => (YamlMappingNode)Node(map, key);
string Equivalent(YamlNode node) => node switch {
    YamlScalarNode scalar => "s:" + scalar.Tag + ":" + scalar.Value,
    YamlSequenceNode sequence => "[" + string.Join("|", sequence.Children.Select(Equivalent)) + "]",
    YamlMappingNode map => "{" + string.Join("|", map.Children.Select(p => Equivalent(p.Key) + "=" + Equivalent(p.Value)).Order(StringComparer.Ordinal)) + "}",
    _ => throw new Exception("unexpected YAML kind")
};
var originalA = Single(docA, a, "tags: [中文, alpha]\ncustom:\n  nullable: null\n  truth: false\n  count: 0\n  text: '001'\n  lines: |-\n    第一行\n    第二行\n", "  extension:\n    schema: 9\n    flags: [a, b]\n", "      records:\n        key: Person\n        future: {type: rich, value: false}\n");
var originalB = Single(docB, b, "author: B\n", "  vendor: future\n", "      unknown: [one, two]\n");
var merged = GroupingMetadataCodec.GetMergeMetadata([Input(originalA, "Notes/A.md"), Input(originalB, "Notes/B.md")], groupId);

Test("merge preserves owners unknown note metadata and no body duplication", () =>
{
    Check(merged.Success, string.Join(";", merged.Issues.Select(i => i.Message)));
    var envelope = MarkdownEnvelopeCodec.Read(merged.FrontMatter);
    Check(envelope.CanRewrite && envelope.Body == "" && envelope.Metadata!.Layout == "grouped" && envelope.Metadata.Notes.Count == 2, "wrong group identity");
    Check(!merged.FrontMatter.Contains("正文 only once"), "body copied into YAML");
    var grasp = Child(Map(merged.FrontMatter), "grasp");
    var sources = Child(Child(grasp, "grouping"), "sources");
    Check(sources.Children.Count == 2, "missing owner");
    Check(Equivalent(Node(Child((YamlMappingNode)Node(sources, docA), "frontmatter"), "custom")) == Equivalent(Node(Map(originalA[..MarkdownEnvelopeCodec.Read(originalA).BodyStart]), "custom")), "root values changed");
    var notes = (YamlSequenceNode)Node(grasp, "notes");
    Check(((YamlMappingNode)notes.Children[0]).Children.ContainsKey(new YamlScalarNode("records")), "unknown records subtree lost");
});
Test("split restores root grasp extras and unknown member subtree by value", () =>
{
    var split = GroupingMetadataCodec.GetSplitMetadata(merged.FrontMatter + GroupBody((a, "edited body"), (b, "second")), a, splitId, "Group.md", "\r\n");
    Check(split.Success, string.Join(";", split.Issues.Select(i => i.Message)));
    var original = Map(originalA[..MarkdownEnvelopeCodec.Read(originalA).BodyStart]);
    var result = Map(split.FrontMatter);
    Check(Equivalent(Node(original, "custom")) == Equivalent(Node(result, "custom")), "custom metadata differs");
    Check(Equivalent(Node(original, "tags")) == Equivalent(Node(result, "tags")), "tags differ");
    Check(Equivalent(Node(Child(original, "grasp"), "extension")) == Equivalent(Node(Child(result, "grasp"), "extension")), "grasp extension differs");
    Check(Equivalent(Node(Child(original, "grasp"), "notes")) == Equivalent(Node(Child(result, "grasp"), "notes")), "member subtree differs");
    var envelope = MarkdownEnvelopeCodec.Read(split.FrontMatter);
    Check(envelope.Metadata!.Layout == "single" && envelope.Metadata.DocumentId == splitId && envelope.Body == "", "split identity wrong");
    Check(split.Unassigned.Any(x => x.Text.Contains("## 標題")), "generated heading must be explicitly preserved");
    Check(split.FrontMatter.Contains("\r\n"), "requested newline ignored");
});
Test("regroup flattens original owners without group body in metadata", () =>
{
    var source = merged.FrontMatter + "group introduction\n" + GroupBody((a, "A edit"), (b, "B edit")) + "group ending";
    var result = GroupingMetadataCodec.GetMergeMetadata([Input(source, "Group.md"), Input(Single(docC, c), "C.md")], regroupId);
    Check(result.Success, string.Join(";", result.Issues.Select(i => i.Message)));
    var owners = Child(Child(Child(Map(result.FrontMatter), "grasp"), "grouping"), "sources");
    Check(owners.Children.Count == 3 && !owners.Children.ContainsKey(new YamlScalarNode(groupId)), "group owner was nested instead of flattened");
    Check(result.Unassigned.First().Text.Contains("group introduction") && result.Unassigned.Last().Text.EndsWith("group ending", StringComparison.Ordinal), "outside text lost");
    Check(result.Unassigned.All(item => source.Substring(item.Start, item.Length) == item.Text), "unassigned full-source UTF-16 ranges changed");
    Check(!result.FrontMatter.Contains("A edit") && !result.FrontMatter.Contains("group introduction"), "body copied into metadata");
});
Test("group root grasp and grouping extensions returned explicitly", () =>
{
    var extra = merged.FrontMatter.Replace("grasp:\n", "groupLabel: 新外文\ngrasp:\n  futureGroup: {enabled: true}\n").Replace("  grouping:\n", "  grouping:\n    plugin: [future, data]\n") + GroupBody((a, "A"), (b, "B"));
    var result = GroupingMetadataCodec.GetSplitMetadata(extra, a, splitId, "Group.md");
    Check(result.Success && result.Preservation.Count == 3, "group extras not exposed");
    Check(result.Preservation.Single(x => x.Scope == "group-frontmatter").Yaml.Contains("新外文"), "root extra lost");
    Check(result.Preservation.Single(x => x.Scope == "group-grasp-extra").Yaml.Contains("enabled"), "grasp extra lost");
    Check(result.Preservation.Single(x => x.Scope == "grouping-extra").Yaml.Contains("future"), "grouping extra lost");
});
Test("aliases duplicate keys unknown schema and absent identity rejected", () =>
{
    foreach (var source in new[] { originalA.Replace("tags: [中文, alpha]", "tags: &x [中文, alpha]\ncopy: *x"), originalA.Replace("tags: [中文, alpha]", "tags: first\ntags: second"), originalA.Replace("  schema: 1", "  schema: 2"), "plain body" })
    {
        var result = GroupingMetadataCodec.GetMergeMetadata([new(source, "A.md", docA, [a])], groupId);
        Check(!result.Success && result.FrontMatter == "", "invalid envelope rewritten");
    }
});
Test("mismatched expectations duplicated inputs and target collisions rejected", () =>
{
    Check(!GroupingMetadataCodec.GetMergeMetadata([Input(originalA, "A.md") with { DocumentId = docB }], groupId).Success, "document mismatch allowed");
    Check(!GroupingMetadataCodec.GetMergeMetadata([Input(originalA, "A.md") with { MemberIds = [b] }], groupId).Success, "member mismatch allowed");
    Check(!GroupingMetadataCodec.GetMergeMetadata([Input(originalA, "A.md"), Input(originalA, "Other.md")], groupId).Success, "duplicate allowed");
    Check(!GroupingMetadataCodec.GetMergeMetadata([Input(originalA, "A.md")], docA).Success, "target collision allowed");
});
Test("malformed and conflicting original ownership refuses split without throwing", () =>
{
    foreach (var metadata in new[] { merged.FrontMatter.Replace("originalPath: Notes/A.md", "originalPath: ''"), merged.FrontMatter.Replace("- " + b, "- " + a), merged.FrontMatter.Replace("    sources:", "    missingSources:") })
    {
        var result = GroupingMetadataCodec.GetSplitMetadata(metadata + GroupBody((a, "A"), (b, "B")), a, splitId, "Group.md");
        Check(!result.Success, "ambiguous ownership allowed");
    }
});
Test("reserved provenance key on singleton is not overwritten", () =>
{
    var source = Single(docA, a, extra: "  grouping: {userData: keep}\n");
    Check(!GroupingMetadataCodec.GetMergeMetadata([Input(source, "A.md")], groupId).Success, "unknown grouping key overwritten");
});
Test("invalid member framing blocks transformation while raw remains untouched", () =>
{
    var source = merged.FrontMatter + GroupBody((a, "A"), (b, "B"));
    var corrupt = source.Replace("<!-- /grasp:note " + b + " -->", "no closing marker");
    Check(!GroupingMetadataCodec.GetSplitMetadata(corrupt, a, splitId, "Group.md").Success, "broken frame split");
    Check(!GroupingMetadataCodec.GetMergeMetadata([Input(corrupt, "Group.md")], regroupId).Success, "broken frame merged");
});
Test("unknown source provenance retained on merge and surfaced on split", () =>
{
    var metadata = merged.FrontMatter.Replace("originalPath: Notes/A.md", "extraProvenance: {plugin: 12}\n        originalPath: Notes/A.md");
    var source = metadata + GroupBody((a, "A"), (b, "B"));
    var regroup = GroupingMetadataCodec.GetMergeMetadata([Input(source, "Group.md")], regroupId);
    Check(regroup.Success && regroup.FrontMatter.Contains("extraProvenance"), "future provenance lost in merge");
    var split = GroupingMetadataCodec.GetSplitMetadata(source, a, splitId, "Group.md");
    Check(split.Success && split.Preservation.Any(p => p.Scope == "original-source-extra/" + docA && p.Yaml.Contains("plugin")), "future provenance lost in split");
});

Console.WriteLine($"GroupingMetadata: {passed} fixtures passed, {failed} failed.");
return failed == 0 ? 0 : 1;
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
