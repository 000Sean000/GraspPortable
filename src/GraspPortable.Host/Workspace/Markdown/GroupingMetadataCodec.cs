using System.Globalization;
using YamlDotNet.RepresentationModel;

namespace GraspPortable.Host.Workspace.Markdown;

public sealed record GroupingMetadataSource(string Source, string RelativePath, string DocumentId, IReadOnlyList<string> MemberIds);
public sealed record GroupingMetadataIssue(string Code, string Message, string? SourcePath = null, bool IsWarning = false);
/// <summary>Yaml is a mapping fragment, not a new identity envelope. The service must preserve each fragment explicitly.</summary>
public sealed record GroupingMetadataPreservation(string SourcePath, string Scope, string Yaml);
public sealed record GroupingUnassignedText(string SourcePath, string Text, int Start, int Length);
/// <summary>FrontMatter contains only a complete YAML envelope. Append the separately framed current body once.</summary>
public sealed record GroupingMetadataResult(bool Success, string FrontMatter,
    IReadOnlyList<GroupingMetadataPreservation> Preservation, IReadOnlyList<GroupingUnassignedText> Unassigned,
    IReadOnlyList<GroupingMetadataIssue> Issues);

/// <summary>
/// Canonical metadata conversion, not a byte-exact YAML formatter. Unknown YAML values survive;
/// original formatting/comments require the file operation's before-bytes journal.
/// No member body is copied into frontmatter, and file writes/links belong to the caller.
/// </summary>
public static class GroupingMetadataCodec
{
    public static IReadOnlyDictionary<string, string> ReadPresentationAnchors(string source)
    {
        var (root, _) = PresentationRoot(source);
        var notes = (YamlSequenceNode)Get((YamlMappingNode)Get(root, "grasp")!, "notes")!;
        return notes.Children.Cast<YamlMappingNode>().Where(n => Get(n, "presentationAnchor") is not null)
            .ToDictionary(n => Guid.Parse(Scalar(n, "id")!).ToString("N"),
                n => Scalar(n, "presentationAnchor") ?? throw new InvalidDataException("Presentation anchor must be plain text."), StringComparer.Ordinal);
    }

    /// <summary>Only changes the presentation hint; canonical note titles and bodies remain separate.</summary>
    public static string WritePresentationAnchors(string frontMatter, IReadOnlyDictionary<string, string?> anchors)
    {
        var (root, envelope) = PresentationRoot(frontMatter);
        var notes = (YamlSequenceNode)Get((YamlMappingNode)Get(root, "grasp")!, "notes")!;
        foreach (var note in notes.Children.Cast<YamlMappingNode>())
        {
            if (!anchors.TryGetValue(Guid.Parse(Scalar(note, "id")!).ToString("N"), out var anchor)) continue;
            var key = note.Children.Keys.OfType<YamlScalarNode>().FirstOrDefault(k => k.Value == "presentationAnchor");
            if (anchor is null) { if (key is not null) note.Children.Remove(key); }
            else Set(note, "presentationAnchor", new YamlScalarNode(anchor));
        }
        return "---" + envelope.NewLine + Yaml(root).Replace("\n", envelope.NewLine) + "---" + envelope.NewLine + envelope.Body;
    }

    private static (YamlMappingNode, MarkdownEnvelope) PresentationRoot(string source)
    {
        var envelope = MarkdownEnvelopeCodec.Read(source);
        if (!envelope.CanRewrite || envelope.Metadata is null) throw new InvalidDataException("Invalid identity envelope.");
        var yaml = new YamlStream(); yaml.Load(new StringReader(source[..envelope.BodyStart].TrimStart('\uFEFF')));
        return ((YamlMappingNode)yaml.Documents[0].RootNode, envelope);
    }
    private static readonly string[] OwnedGrasp = ["schema", "documentId", "layout", "notes", "grouping"];
    private sealed record Input(GroupingMetadataSource Request, MarkdownEnvelope Envelope, YamlMappingNode Root, YamlMappingNode Grasp);

    public static GroupingMetadataResult GetMergeMetadata(IReadOnlyList<GroupingMetadataSource> sources, string targetDocumentId, string newline = "\n")
    {
        ArgumentNullException.ThrowIfNull(sources);
        var context = new Context();
        if (!TryId(targetDocumentId, out var targetId)) context.Error("target-id", "Target document ID must be a nonempty UUID.");
        if (sources.Count == 0) context.Error("no-sources", "Merge requires at least one source document.");
        if (!ValidNewline(newline)) context.Error("newline", "Newline must be LF, CRLF or CR.");
        var ownerMap = new YamlMappingNode();
        var notes = new YamlSequenceNode();
        var seenNotes = new HashSet<string>(StringComparer.Ordinal);
        var seenDocuments = new HashSet<string>(StringComparer.Ordinal);
        foreach (var request in sources)
        {
            if (string.IsNullOrWhiteSpace(request.RelativePath)) context.Error("source-path", "Merge inputs require their original relative path.");
            var input = Read(request, context);
            if (input is null) continue;
            var metadata = input.Envelope.Metadata!;
            if (!seenDocuments.Add(metadata.DocumentId)) context.Error("duplicate-document", "Input document ID is duplicated.", request.RelativePath);
            if (metadata.DocumentId == targetId) context.Error("target-document-collision", "A merged file requires a new document ID.", request.RelativePath);
            foreach (var note in ((YamlSequenceNode)Get(input.Grasp, "notes")!).Children.Cast<YamlMappingNode>())
            {
                TryId(Scalar(note, "id"), out var id);
                if (!seenNotes.Add(id)) context.Error("duplicate-member", "A note ID occurs in more than one input.", request.RelativePath);
                Set(note, "id", new YamlScalarNode(id));
                notes.Add(note); // Unknown note subtree fields remain attached to their canonical member.
            }
            if (metadata.Layout == "grouped")
            {
                var existing = ReadOwners(input, context);
                if (existing is not null)
                    foreach (var pair in existing.Children)
                    {
                        TryId(((YamlScalarNode)pair.Key).Value, out var owner);
                        if (Get(ownerMap, owner) is not null)
                            context.Error("duplicate-original-owner", "Two inputs claim the same original document metadata; reconcile them before merging.", request.RelativePath);
                        else ownerMap.Add(owner, pair.Value);
                    }
                PreserveGroupExtras(input, context);
                ReadUnassigned(input, context);
            }
            else
            {
                if (Get(input.Grasp, "grouping") is not null)
                {
                    context.Error("unexpected-grouping", "A single document already has a grouping key; it cannot be overwritten.", request.RelativePath);
                    continue;
                }
                if (Get(ownerMap, metadata.DocumentId) is not null)
                    context.Error("duplicate-original-owner", "Original document metadata has more than one owner.", request.RelativePath);
                else ownerMap.Add(metadata.DocumentId, new YamlMappingNode {
                    { "originalPath", new YamlScalarNode(request.RelativePath) },
                    { "memberIds", new YamlSequenceNode(metadata.Notes.Select(n => new YamlScalarNode(n.Id))) },
                    { "frontmatter", Except(input.Root, "grasp") },
                    { "graspExtras", Except(input.Grasp, OwnedGrasp) }
                });
            }
        }
        var grasp = Identity(targetId, "grouped", notes);
        grasp.Add("grouping", new YamlMappingNode { { "schema", new YamlScalarNode("1") }, { "sources", ownerMap } });
        return Finish(new YamlMappingNode { { "grasp", grasp } }, newline, context);
    }

    public static GroupingMetadataResult GetSplitMetadata(string groupSource, string noteId, string newDocumentId,
        string sourcePath = "", string newline = "\n")
    {
        ArgumentNullException.ThrowIfNull(groupSource);
        var context = new Context();
        if (!TryId(noteId, out var memberId)) context.Error("member-id", "Member ID must be a nonempty UUID.", sourcePath);
        if (!TryId(newDocumentId, out var documentId)) context.Error("target-id", "Split output document ID must be a nonempty UUID.", sourcePath);
        if (!ValidNewline(newline)) context.Error("newline", "Newline must be LF, CRLF or CR.", sourcePath);
        var envelope = MarkdownEnvelopeCodec.Read(groupSource);
        var input = Read(new(groupSource, sourcePath, envelope.Metadata?.DocumentId ?? "", envelope.Metadata?.Notes.Select(n => n.Id).ToArray() ?? []), context);
        if (input is null) return context.Failure();
        if (input.Envelope.Metadata!.Layout != "grouped") context.Error("not-grouped", "Split requires explicit grouped layout.", sourcePath);
        if (input.Envelope.Metadata.DocumentId == documentId) context.Error("target-document-collision", "Split output requires a document ID different from the group.", sourcePath);
        var owners = ReadOwners(input, context);
        PreserveGroupExtras(input, context);
        ReadUnassigned(input, context);
        if (context.HasErrors) return context.Failure();
        var note = ((YamlSequenceNode)Get(input.Grasp, "notes")!).Children.OfType<YamlMappingNode>()
            .SingleOrDefault(n => TryId(Scalar(n, "id"), out var id) && id == memberId);
        if (note is null) context.Error("member-missing", "Requested member is absent from group metadata.", sourcePath);
        var owner = owners?.Children.Values.OfType<YamlMappingNode>().SingleOrDefault(n => MemberIds(n).Contains(memberId));
        if (owner is null) context.Error("owner-missing", "Requested member has no unique original metadata owner.", sourcePath);
        if (context.HasErrors || owner is null || note is null) return context.Failure();
        var root = Copy((YamlMappingNode)Get(owner, "frontmatter")!);
        var grasp = Copy((YamlMappingNode)Get(owner, "graspExtras")!);
        Set(note, "id", new YamlScalarNode(memberId));
        foreach (var pair in Identity(documentId, "single", new YamlSequenceNode(note)).Children) grasp.Add(pair.Key, pair.Value);
        root.Add("grasp", grasp);
        // Unknown future provenance fields have no destination in a singleton identity schema.
        var ownerId = ((YamlScalarNode)owners!.Children.Single(p => ReferenceEquals(p.Value, owner)).Key).Value;
        context.Preserve(sourcePath, "original-source-extra/" + ownerId, Except(owner, "originalPath", "memberIds", "frontmatter", "graspExtras"));
        return Finish(root, newline, context);
    }

    private static Input? Read(GroupingMetadataSource request, Context context)
    {
        var envelope = MarkdownEnvelopeCodec.Read(request.Source);
        if (!envelope.CanRewrite || envelope.Metadata is null || !envelope.HasFrontMatter)
        {
            foreach (var issue in envelope.Issues) context.Error(issue.Code, issue.Message, request.RelativePath);
            context.Error("identity-envelope-required", "Grouping requires a valid canonical identity envelope; source is not rewritten.", request.RelativePath);
            return null;
        }
        if (!TryId(request.DocumentId, out var expectedDocument) || expectedDocument != envelope.Metadata.DocumentId)
            context.Error("document-mismatch", "Expected document ID does not match source metadata.", request.RelativePath);
        var expected = new HashSet<string>(StringComparer.Ordinal);
        foreach (var raw in request.MemberIds)
            if (!TryId(raw, out var id) || !expected.Add(id)) context.Error("expected-members", "Expected member IDs are invalid or duplicated.", request.RelativePath);
        if (!expected.SetEquals(envelope.Metadata.Notes.Select(n => n.Id)))
            context.Error("member-mismatch", "Input must include exactly all physical document members.", request.RelativePath);
        // Envelope already rejects aliases, duplicate/complex keys and unsupported identity schemas.
        var stream = new YamlStream();
        stream.Load(new StringReader(request.Source[..envelope.BodyStart].TrimStart('\uFEFF')));
        var root = (YamlMappingNode)stream.Documents[0].RootNode;
        return new(request, envelope, root, (YamlMappingNode)Get(root, "grasp")!);
    }

    private static YamlMappingNode? ReadOwners(Input input, Context context)
    {
        var path = input.Request.RelativePath;
        if (Get(input.Grasp, "grouping") is not YamlMappingNode grouping || Scalar(grouping, "schema") != "1" || Get(grouping, "sources") is not YamlMappingNode sources)
        { context.Error("grouping-schema", "Grouped metadata requires grasp.grouping schema 1 and sources mapping.", path); return null; }
        var members = input.Envelope.Metadata!.Notes.Select(n => n.Id).ToHashSet(StringComparer.Ordinal);
        var assigned = new HashSet<string>(StringComparer.Ordinal);
        var owners = new YamlMappingNode();
        var knownOwnerIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var pair in sources.Children)
        {
            if (!TryId((pair.Key as YamlScalarNode)?.Value, out var ownerId) || !knownOwnerIds.Add(ownerId))
            { context.Error("owner-id", "Original source keys must be unique canonical UUIDs.", path); continue; }
            if (pair.Value is not YamlMappingNode owner || string.IsNullOrWhiteSpace(Scalar(owner, "originalPath")) ||
                Get(owner, "memberIds") is not YamlSequenceNode ids || Get(owner, "frontmatter") is not YamlMappingNode frontmatter || Get(owner, "graspExtras") is not YamlMappingNode extras)
            { context.Error("owner-shape", "Original source needs originalPath, memberIds, frontmatter and graspExtras.", path); continue; }
            if (Get(frontmatter, "grasp") is not null || OwnedGrasp.Any(key => Get(extras, key) is not null))
                context.Error("owner-reserved-key", "Preserved metadata conflicts with owned identity keys.", path);
            if (ids.Children.Count == 0) context.Error("owner-empty", "Original metadata owner has no members.", path);
            foreach (var raw in ids.Children)
                if (!TryId((raw as YamlScalarNode)?.Value, out var id) || !members.Contains(id) || !assigned.Add(id))
                    context.Error("owner-members", "Each member must have exactly one known original metadata owner.", path);
            owners.Add(ownerId, owner);
        }
        if (!members.SetEquals(assigned)) context.Error("owner-incomplete", "Original metadata ownership does not cover all members.", path);
        return owners;
    }

    private static void PreserveGroupExtras(Input input, Context context)
    {
        context.Preserve(input.Request.RelativePath, "group-frontmatter", Except(input.Root, "grasp"));
        context.Preserve(input.Request.RelativePath, "group-grasp-extra", Except(input.Grasp, OwnedGrasp));
        if (Get(input.Grasp, "grouping") is YamlMappingNode grouping)
            context.Preserve(input.Request.RelativePath, "grouping-extra", Except(grouping, "schema", "sources"));
    }
    private static void ReadUnassigned(Input input, Context context)
    {
        var parsed = GroupedNoteCodec.Parse(input.Envelope.Body, input.Envelope.Metadata!.Notes.Select(n => n.Id));
        foreach (var issue in parsed.Issues.Where(i => !i.IsWarning)) context.Error(issue.Code, issue.Message, input.Request.RelativePath);
        foreach (var item in parsed.Unassigned)
            context.Unassigned.Add(new(input.Request.RelativePath, item.Text, input.Envelope.BodyStart + item.Range.Start, item.Range.Length));
        if (parsed.Unassigned.Any(item => !string.IsNullOrWhiteSpace(item.Text)))
            context.Issues.Add(new("unassigned-content", "Group text outside members requires explicit preservation by the operation preview.", input.Request.RelativePath, true));
    }
    private static GroupingMetadataResult Finish(YamlMappingNode root, string newline, Context context)
    {
        if (context.HasErrors) return context.Failure();
        var result = "---" + newline + Yaml(root).Replace("\n", newline) + "---" + newline;
        var envelope = MarkdownEnvelopeCodec.Read(result);
        if (!envelope.CanRewrite || envelope.Metadata is null || envelope.Body.Length != 0)
        {
            context.Error("output-invalid", "Generated metadata envelope did not validate without body content.");
            foreach (var issue in envelope.Issues) context.Error(issue.Code, issue.Message);
            return context.Failure();
        }
        return new(true, result, context.Preservation.AsReadOnly(), context.Unassigned.AsReadOnly(), context.Issues.AsReadOnly());
    }
    private static YamlMappingNode Identity(string documentId, string layout, YamlSequenceNode notes) => new() {
        { "schema", new YamlScalarNode("1") }, { "documentId", new YamlScalarNode(documentId) },
        { "layout", new YamlScalarNode(layout) }, { "notes", notes }
    };
    private static YamlMappingNode Copy(YamlMappingNode source) => Except(source);
    private static YamlMappingNode Except(YamlMappingNode source, params string[] excluded)
    {
        var result = new YamlMappingNode();
        foreach (var pair in source.Children)
            if (!excluded.Contains(((YamlScalarNode)pair.Key).Value, StringComparer.Ordinal)) result.Add(pair.Key, pair.Value);
        return result;
    }
    private static IEnumerable<string> MemberIds(YamlMappingNode owner) => ((YamlSequenceNode)Get(owner, "memberIds")!).Children
        .OfType<YamlScalarNode>().Select(n => TryId(n.Value, out var id) ? id : "");
    private static string? Scalar(YamlMappingNode node, string key) => (Get(node, key) as YamlScalarNode)?.Value;
    private static YamlNode? Get(YamlMappingNode node, string key) => node.Children.FirstOrDefault(p => p.Key is YamlScalarNode scalar && scalar.Value == key).Value;
    private static void Set(YamlMappingNode node, string key, YamlNode value)
    {
        var existing = node.Children.Keys.OfType<YamlScalarNode>().FirstOrDefault(k => k.Value == key);
        node.Children[existing ?? new YamlScalarNode(key)] = value;
    }
    private static string Yaml(YamlMappingNode node)
    {
        using var writer = new StringWriter(CultureInfo.InvariantCulture) { NewLine = "\n" };
        new YamlStream(new YamlDocument(node)).Save(writer, false);
        var result = writer.ToString().Replace("\r\n", "\n");
        if (result.StartsWith("---\n", StringComparison.Ordinal)) result = result[4..];
        if (result.EndsWith("...\n", StringComparison.Ordinal)) result = result[..^4];
        return result.EndsWith('\n') ? result : result + "\n";
    }
    private static bool ValidNewline(string newline) => newline is "\n" or "\r\n" or "\r";
    private static bool TryId(string? value, out string id)
    {
        if ((Guid.TryParseExact(value, "N", out var guid) || Guid.TryParseExact(value, "D", out guid)) && guid != Guid.Empty) { id = guid.ToString("N"); return true; }
        id = ""; return false;
    }
    private sealed class Context
    {
        public List<GroupingMetadataIssue> Issues { get; } = [];
        public List<GroupingMetadataPreservation> Preservation { get; } = [];
        public List<GroupingUnassignedText> Unassigned { get; } = [];
        public bool HasErrors => Issues.Any(i => !i.IsWarning);
        public void Error(string code, string message, string? path = null) => Issues.Add(new(code, message, path));
        public void Preserve(string path, string scope, YamlMappingNode metadata)
        {
            if (metadata.Children.Count == 0) return;
            Preservation.Add(new(path, scope, Yaml(metadata)));
            Issues.Add(new("metadata-preservation", $"Metadata in {scope} requires an explicit preservation output.", path, true));
        }
        public GroupingMetadataResult Failure() => new(false, "", Preservation.AsReadOnly(), Unassigned.AsReadOnly(), Issues.AsReadOnly());
    }
}
