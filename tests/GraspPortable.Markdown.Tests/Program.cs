using GraspPortable.Host.Workspace.Markdown;
using YamlDotNet.RepresentationModel;

try
{
var passed = 0;
var failed = 0;
void Check(string name, Action action)
{
    try { action(); passed++; }
    catch (Exception exception) { failed++; Console.Error.WriteLine($"FAIL {name}: {exception}"); }
}
void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected [{expected}], actual [{actual}].");
}
void True(bool value, string message = "Assertion failed") { if (!value) throw new InvalidOperationException(message); }
const string documentId = "11111111111111111111111111111111";
const string noteId = "22222222222222222222222222222222";
const string bindingId = "33333333333333333333333333333333";
MarkdownIdentityMetadata Metadata(string title = "角色 😀 \"Triensa\"") => new(1, documentId,
    [new(noteId, title, new Dictionary<string, string>(StringComparer.Ordinal) { ["Triensa.Title"] = bindingId })]);
string Write(string source, MarkdownIdentityMetadata? metadata = null)
{
    var result = MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read(source), metadata ?? Metadata());
    True(result.Success, string.Join("; ", result.Issues.Select(i => i.Code + ": " + i.Message)));
    return result.Source;
}
void Reject(string source, string? code = null)
{
    var read = MarkdownEnvelopeCodec.Read(source);
    True(!read.CanRewrite, "unsafe source was marked writable");
    if (code is not null) True(read.Issues.Any(i => i.Code == code), string.Join(", ", read.Issues.Select(i => i.Code)));
    var result = MarkdownEnvelopeCodec.Write(read with { CanRewrite = true, Issues = [] }, Metadata());
    True(!result.Success, "forged CanRewrite bypassed validation");
    Equal(source, result.Source);
}

Check("plain source and first envelope preserve exact body", () =>
{
    const string body = "😀 第一段\n\n---\n\n```yaml\ngrasp: example\n---\n```\n";
    var original = MarkdownEnvelopeCodec.Read(body);
    Equal(0, original.BodyStart); Equal(body, original.Body); True(!original.HasFrontMatter);
    var written = Write(body);
    var read = MarkdownEnvelopeCodec.Read(written);
    True(read.CanRewrite); Equal(body, read.Body); Equal(body, written[read.BodyStart..]);
    Equal(documentId, read.Metadata!.DocumentId); Equal(noteId, read.Metadata.Notes[0].Id);
    Equal(bindingId, read.Metadata.Notes[0].Bindings["Triensa.Title"]);
    Equal(Metadata().Notes[0].Title, read.Metadata.Notes[0].Title);
    Equal(written, Write(written));
});

Check("BOM CRLF comments order unknown user YAML remain exact", () =>
{
    const string header = "\uFEFF---\r\n# 保留 😀\r\n\"title\": '原有標題' # inline\r\ntags: [one, 二]\r\ncustom:\r\n  literal: |\r\n    # markdown here\r\n    😀 data\r\n# footer comment\r\n";
    const string suffix = "---\r\n正文 😀\r\n\r\n# Heading\r\n";
    var written = Write(header + suffix);
    True(written.StartsWith(header, StringComparison.Ordinal)); True(written.EndsWith(suffix, StringComparison.Ordinal));
    True(!written.Replace("\r\n", "").Contains('\n'), "write introduced mixed newline");
    var read = MarkdownEnvelopeCodec.Read(written);
    Equal("正文 😀\r\n\r\n# Heading\r\n", read.Body);
    Equal(read.Body, written[read.BodyStart..]);
    var changed = Write(written, Metadata("New \"title\"\nsecond line"));
    True(changed.StartsWith(header, StringComparison.Ordinal)); True(changed.EndsWith(suffix, StringComparison.Ordinal));
    Equal("New \"title\"\nsecond line", MarkdownEnvelopeCodec.Read(changed).Metadata!.Notes[0].Title);
});

Check("replace only grasp entry between existing keys and trailing comments", () =>
{
    const string prefix = "---\ntitle: '😀 Original' # untouched\n# before grasp\n";
    var own = Write("");
    own = own[4..own.LastIndexOf("---", StringComparison.Ordinal)];
    const string suffix = "# after grasp\n\nuser: {nested: true} # untouched\n---\nbody\n";
    var source = prefix + own + suffix;
    var result = Write(source, Metadata("Renamed"));
    True(result.StartsWith(prefix, StringComparison.Ordinal)); True(result.EndsWith(suffix, StringComparison.Ordinal));
    Equal("Renamed", MarkdownEnvelopeCodec.Read(result).Metadata!.Notes[0].Title);
});

Check("unknown owned metadata values survive merge", () =>
{
    var source = Write("body").Replace("grasp:\n", "grasp:\n  custom: {value: 'kept', items: [one, 二]}\n")
        .Replace("    title:", "    noteCustom: preserved\n    title:");
    // Identify whatever indentation the emitter chose rather than assuming a list style.
    if (!source.Contains("noteCustom:")) source = source.Replace("  - id:", "  - noteCustom: preserved\n    id:");
    var result = Write(source, Metadata("Changed"));
    True(result.Contains("custom:")); True(result.Contains("kept")); True(result.Contains("二"));
    True(result.Contains("noteCustom:"), "unknown note metadata was not retained");
    Equal("body", MarkdownEnvelopeCodec.Read(result).Body);
});

Check("quoted grasp key, indented root, and flow owned mapping", () =>
{
    var source = $"---\n  user: unchanged\n  'grasp': {{schema: 1, documentId: {documentId}, notes: []}}\n  other: 'kept'\n---\nbody";
    var result = Write(source);
    True(result.Contains("  user: unchanged\n")); True(result.Contains("  other: 'kept'\n"));
    Equal(noteId, MarkdownEnvelopeCodec.Read(result).Metadata!.Notes[0].Id);
});

Check("owned unknown block scalar preserves comment-like lines and trailing newlines", () =>
{
    var source = Write("body");
    var close = source.LastIndexOf("---", StringComparison.Ordinal);
    source = source[..close] + "  custom: |+\n    # actual scalar content\n\n\n# outside comment\n" + source[close..];
    string Custom(string text)
    {
        var end = text.LastIndexOf("---", StringComparison.Ordinal);
        var stream = new YamlStream(); stream.Load(new StringReader(text[4..end]));
        var root = (YamlMappingNode)stream.Documents[0].RootNode;
        var grasp = (YamlMappingNode)root.Children[new YamlScalarNode("grasp")];
        return ((YamlScalarNode)grasp.Children[new YamlScalarNode("custom")]).Value!;
    }
    var changed = Write(source, Metadata("Changed"));
    Equal(Custom(source), Custom(changed));
    True(changed.EndsWith("# outside comment\n---\nbody", StringComparison.Ordinal));
    Equal(changed, Write(changed, Metadata("Changed")));
});

Check("empty frontmatter and EOF closing delimiter", () =>
{
    foreach (var source in new[] { "---\n---", "---\n# comment\n...\n", "\uFEFF" })
    {
        var original = MarkdownEnvelopeCodec.Read(source);
        var result = Write(source);
        Equal(original.Body, MarkdownEnvelopeCodec.Read(result).Body);
    }
});

Check("CR-only line endings remain CR-only", () =>
{
    var result = Write("---\rtitle: text\r---\rbody\r");
    True(!result.Contains('\n')); Equal("body\r", MarkdownEnvelopeCodec.Read(result).Body);
});

Check("canonical UUID forms and ordinal binding names", () =>
{
    var value = new MarkdownIdentityMetadata(1, Guid.Parse(documentId).ToString("D"),
        [new(Guid.Parse(noteId).ToString("D"), "Title", new Dictionary<string, string> { ["Name"] = bindingId, ["name"] = "44444444444444444444444444444444" })]);
    var read = MarkdownEnvelopeCodec.Read(Write("", value));
    Equal(documentId, read.Metadata!.DocumentId); Equal(2, read.Metadata.Notes[0].Bindings.Count);
    True(!read.Metadata.Notes[0].Bindings.ContainsKey("NAME"));
});

Check("duplicate and invalid metadata reject without source change", () =>
{
    var valid = Write("body");
    Reject(valid.Replace("schema: 1", "schema: 2"), "metadata-schema");
    Reject(valid.Replace(documentId, "not-a-uuid"), "metadata-id");
    Reject(valid.Replace("Triensa.Title", "Triensa . Title"), "binding-name");
    foreach (var value in new[]
    {
        new MarkdownIdentityMetadata(1, documentId, [Metadata().Notes[0], Metadata().Notes[0]]),
        new MarkdownIdentityMetadata(1, documentId, [Metadata().Notes[0], new("55555555555555555555555555555555", "Other", new Dictionary<string,string> { ["Triensa.Title"] = "66666666666666666666666666666666" })]),
        new MarkdownIdentityMetadata(1, documentId, [new(noteId, "Title", new Dictionary<string,string> { ["One"] = bindingId, ["Two"] = Guid.Parse(bindingId).ToString("D") })]),
    })
    {
        var result = MarkdownEnvelopeCodec.Write(MarkdownEnvelopeCodec.Read(valid), value);
        True(!result.Success); Equal(valid, result.Source);
    }
});

Check("invalid YAML, aliases, duplicate keys, complex keys and future schema refuse rewrite", () =>
{
    foreach (var source in new[]
    {
        "---\nx: [unterminated\n---\nbody",
        "---\nx: 1\nx: 2\n---\nbody",
        "---\nx: {same: 1, same: 2}\n---\nbody",
        "---\nx: &anchor [one]\ny: *anchor\n---\nbody",
        "---\n? [one, two]\n: value\n---\nbody",
        "---\n{title: flow-root}\n---\nbody",
        "---\ngrasp: null\n---\nbody",
        "---\ntitle: missing-closing\nbody",
    }) Reject(source);
});

Check("frontmatter markers in ordinary body and fences are not envelopes", () =>
{
    foreach (var body in new[] { "\n---\nbody", "```yaml\n---\nkey: value\n---\n```", "# title\n---\nbody" })
    {
        var read = MarkdownEnvelopeCodec.Read(body);
        True(!read.HasFrontMatter); Equal(body, MarkdownEnvelopeCodec.Read(Write(body)).Body);
    }
});

Console.WriteLine($"Markdown envelope: {passed} passed, {failed} failed.");
return failed == 0 ? 0 : 1;
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
