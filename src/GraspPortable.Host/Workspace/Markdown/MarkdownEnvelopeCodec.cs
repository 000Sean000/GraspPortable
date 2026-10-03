using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.RegularExpressions;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;
using YamlDotNet.RepresentationModel;

namespace GraspPortable.Host.Workspace.Markdown;

public sealed record MarkdownIdentityNote(string Id, string Title, IReadOnlyDictionary<string, string> Bindings);
public sealed record MarkdownIdentityMetadata(int Schema, string DocumentId, IReadOnlyList<MarkdownIdentityNote> Notes);
public sealed record MarkdownEnvelopeIssue(string Code, string Message, int Start = 0, int Length = 0);
public sealed record MarkdownEnvelope(string Source, string Body, int BodyStart, string NewLine,
    MarkdownIdentityMetadata? Metadata, IReadOnlyList<MarkdownEnvelopeIssue> Issues, bool HasFrontMatter, bool CanRewrite);
public sealed record MarkdownEnvelopeWriteResult(bool Success, string Source, IReadOnlyList<MarkdownEnvelopeIssue> Issues);

/// <summary>
/// Text-only identity envelope. The caller retains bytes/encoding and owns file version checks.
/// Only the root grasp entry is serialized; all other YAML and the body remain exact source slices.
/// Unknown values inside grasp survive, though that owned entry's YAML presentation is normalized.
/// </summary>
public static class MarkdownEnvelopeCodec
{
    private static readonly Regex Identifier = new(@"\A[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\z", RegexOptions.CultureInvariant);
    private sealed record Layout(int YamlStart, int YamlEnd, int BodyStart, YamlMappingNode Root,
        YamlScalarNode? GraspKey, YamlMappingNode? Grasp, int GraspEnd, int Indent);
    private sealed record ReadResult(MarkdownEnvelope Envelope, Layout? Layout);

    public static MarkdownEnvelope Read(string source) => ReadInternal(source).Envelope;

    public static MarkdownEnvelopeWriteResult Write(MarkdownEnvelope envelope, MarkdownIdentityMetadata metadata)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        ArgumentNullException.ThrowIfNull(metadata);
        // A public record may have been copied with a forged CanRewrite/Metadata value.
        var current = ReadInternal(envelope.Source);
        if (!current.Envelope.CanRewrite) return new(false, envelope.Source, current.Envelope.Issues);
        var validation = new List<MarkdownEnvelopeIssue>();
        var supplied = BuildMetadata(metadata, null);
        var normalized = ReadMetadata(supplied, validation, 0);
        if (validation.Count != 0 || normalized is null) return new(false, envelope.Source, validation.AsReadOnly());
        var node = BuildMetadata(normalized, current.Layout?.Grasp);
        var fragment = SerializeEntry(node, current.Envelope.NewLine, current.Layout?.Indent ?? 0);
        string result;
        if (current.Layout is not { } layout)
        {
            var bom = envelope.Source.StartsWith('\uFEFF') ? 1 : 0;
            result = envelope.Source[..bom] + "---" + current.Envelope.NewLine + fragment
                + "---" + current.Envelope.NewLine + envelope.Source[bom..];
        }
        else if (layout.GraspKey is { } key && layout.Grasp is { } value)
        {
            var start = LineStart(envelope.Source, layout.YamlStart + (int)key.Start.Index);
            var end = EntryEnd(envelope.Source, layout.YamlStart + layout.GraspEnd, start, layout.YamlEnd);
            result = envelope.Source[..start] + fragment + envelope.Source[end..];
        }
        else
        {
            result = envelope.Source[..layout.YamlEnd] + fragment + envelope.Source[layout.YamlEnd..];
        }
        var verified = Read(result);
        if (!verified.CanRewrite || verified.Metadata is null || verified.Body != current.Envelope.Body)
            return new(false, envelope.Source, Array.AsReadOnly(new[] { new MarkdownEnvelopeIssue("rewrite-invalid", "Metadata rewrite did not preserve a valid envelope and exact body. " + string.Join("; ", verified.Issues.Select(i => i.Message))) }));
        return new(true, result, Array.Empty<MarkdownEnvelopeIssue>());
    }

    private static ReadResult ReadInternal(string source)
    {
        ArgumentNullException.ThrowIfNull(source);
        var newline = Regex.Match(source, @"\r\n|\r|\n") is { Success: true } match ? match.Value : "\n";
        var bom = source.StartsWith('\uFEFF') ? 1 : 0;
        var issues = new List<MarkdownEnvelopeIssue>();
        var first = ReadLine(source, bom);
        if (first.Text.TrimEnd(' ', '\t') != "---")
            return new(new(source, source[bom..], bom, newline, null, issues.AsReadOnly(), false, true), null);
        var yamlStart = first.End;
        var closingStart = -1;
        var bodyStart = source.Length;
        for (var at = first.End; at < source.Length;)
        {
            var line = ReadLine(source, at);
            if (line.Text.TrimEnd(' ', '\t') is "---" or "...") { closingStart = at; bodyStart = line.End; break; }
            at = line.End;
        }
        if (closingStart < 0)
        {
            issues.Add(new("unclosed-frontmatter", "Frontmatter has no closing delimiter; source was preserved.", bom, source.Length - bom));
            return new(new(source, source[bom..], bom, newline, null, issues.AsReadOnly(), true, false), null);
        }
        var yaml = source[yamlStart..closingStart];
        try
        {
            var parser = new Parser(new StringReader(yaml));
            var events = new List<ParsingEvent>();
            while (parser.MoveNext())
            {
                events.Add(parser.Current!);
                if (parser.Current is AnchorAlias || parser.Current is NodeEvent n && !n.Anchor.IsEmpty)
                    issues.Add(new("yaml-alias", "YAML anchors and aliases are preserved but cannot be rewritten safely.",
                        yamlStart + (int)parser.Current.Start.Index, (int)(parser.Current.End.Index - parser.Current.Start.Index)));
            }
            if (issues.Count != 0) return Failed();
            var stream = new YamlStream();
            stream.Load(new StringReader(yaml));
            if (stream.Documents.Count > 1) { issues.Add(new("yaml-documents", "Only one frontmatter document is supported.")); return Failed(); }
            YamlMappingNode root;
            if (stream.Documents.Count == 0 || stream.Documents[0].RootNode is YamlScalarNode { Value: null or "" }) root = new();
            else if (stream.Documents[0].RootNode is YamlMappingNode mapping) root = mapping;
            else { issues.Add(new("yaml-root", "Frontmatter must be a mapping.")); return Failed(); }
            ValidateKeys(root, issues, yamlStart);
            if (root.Style == MappingStyle.Flow) issues.Add(new("yaml-root-style", "Flow-style root frontmatter is preserved; rewriting requires a block mapping."));
            if (issues.Count != 0) return Failed();
            var key = root.Children.Keys.Cast<YamlScalarNode>().SingleOrDefault(k => k.Value == "grasp");
            YamlMappingNode? grasp = null;
            MarkdownIdentityMetadata? metadata = null;
            if (key is not null)
            {
                if (root.Children[key] is YamlMappingNode own) { grasp = own; metadata = ReadMetadata(own, issues, yamlStart); }
                else issues.Add(new("grasp-type", "The grasp entry must be a mapping.", yamlStart + (int)key.Start.Index));
            }
            // YamlDotNet columns are 1-based; source indices are UTF-16 0-based.
            var indent = root.Children.Count == 0 ? 0 : (int)root.Children.Keys.First().Start.Column - 1;
            var graspEnd = key is null ? 0 : ValueEnd(events, events.FindIndex(e => e is Scalar && e.Start.Index == key.Start.Index) + 1);
            var envelope = new MarkdownEnvelope(source, source[bodyStart..], bodyStart, newline, metadata,
                issues.AsReadOnly(), true, issues.Count == 0);
            return new(envelope, new(yamlStart, closingStart, bodyStart, root, key, grasp, graspEnd, indent));
        }
        catch (YamlException exception)
        {
            issues.Add(new("yaml-invalid", exception.Message, yamlStart + (int)exception.Start.Index,
                Math.Max(0, (int)(exception.End.Index - exception.Start.Index))));
            return Failed();
        }
        ReadResult Failed() => new(new(source, source[bodyStart..], bodyStart, newline, null, issues.AsReadOnly(), true, false), null);
    }

    private static void ValidateKeys(YamlNode node, List<MarkdownEnvelopeIssue> issues, int offset)
    {
        if (node is YamlMappingNode map)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var pair in map.Children)
            {
                if (pair.Key is not YamlScalarNode scalar || scalar.Value is null)
                    issues.Add(new("yaml-complex-key", "Complex or empty YAML keys are preserved but cannot be rewritten.", offset + (int)pair.Key.Start.Index));
                else if (!seen.Add(scalar.Value)) issues.Add(new("yaml-duplicate-key", "Duplicate YAML mapping key.", offset + (int)scalar.Start.Index));
                ValidateKeys(pair.Value, issues, offset);
            }
        }
        else if (node is YamlSequenceNode sequence)
            foreach (var child in sequence.Children) ValidateKeys(child, issues, offset);
    }

    private static int ValueEnd(IReadOnlyList<ParsingEvent> events, int start)
    {
        if (events[start] is Scalar scalar) return (int)scalar.End.Index;
        var depth = 0;
        var contentEnd = (int)events[start].End.Index;
        for (var at = start; at < events.Count; at++)
        {
            if (events[at] is MappingStart or SequenceStart) depth++;
            // Block collection-end events point at the next root key, after
            // intervening comments. Scalar tokens include their actual block
            // content (including chomp-sensitive blank lines); flow end tokens
            // have width and include the literal closing delimiter.
            if (events[at] is Scalar || events[at] is MappingEnd or SequenceEnd && events[at].End.Index > events[at].Start.Index)
                contentEnd = Math.Max(contentEnd, (int)events[at].End.Index);
            if (events[at] is MappingEnd or SequenceEnd && --depth == 0) return contentEnd;
        }
        throw new InvalidOperationException("Parsed YAML value has no ending event.");
    }

    private static MarkdownIdentityMetadata? ReadMetadata(YamlMappingNode map, List<MarkdownEnvelopeIssue> issues, int offset)
    {
        var before = issues.Count;
        void Issue(string code, string message, YamlNode? node = null) => issues.Add(new(code, message, node is null ? offset : offset + (int)node.Start.Index));
        string? Scalar(YamlMappingNode owner, string key)
        {
            var node = Get(owner, key);
            if (node is YamlScalarNode { Value: not null } value) return value.Value;
            Issue("metadata-value", $"{key} must be a scalar value.", node); return null;
        }
        string? Id(YamlMappingNode owner, string key)
        {
            var value = Scalar(owner, key);
            if (TryId(value, out var id)) return id;
            Issue("metadata-id", $"{key} must be a nonempty UUID.", Get(owner, key)); return null;
        }
        var schemaText = Scalar(map, "schema");
        if (schemaText != "1") Issue("metadata-schema", "Only grasp schema 1 can be rewritten.", Get(map, "schema"));
        var documentId = Id(map, "documentId");
        var noteIds = new HashSet<string>(StringComparer.Ordinal);
        var bindingIds = new HashSet<string>(StringComparer.Ordinal);
        var names = new HashSet<string>(StringComparer.Ordinal);
        var notes = new List<MarkdownIdentityNote>();
        if (Get(map, "notes") is not YamlSequenceNode sequence) Issue("metadata-notes", "notes must be a sequence.", Get(map, "notes"));
        else foreach (var item in sequence.Children)
        {
            if (item is not YamlMappingNode note) { Issue("metadata-note", "Each note must be a mapping.", item); continue; }
            var id = Id(note, "id");
            var title = Scalar(note, "title");
            if (id is not null && !noteIds.Add(id)) Issue("duplicate-note-id", "A note ID appears more than once.", Get(note, "id"));
            var bindings = new Dictionary<string, string>(StringComparer.Ordinal);
            if (Get(note, "bindings") is not YamlMappingNode bindingMap) Issue("metadata-bindings", "bindings must be a mapping.", Get(note, "bindings"));
            else foreach (var binding in bindingMap.Children)
            {
                var name = (binding.Key as YamlScalarNode)?.Value;
                var bindingId = (binding.Value as YamlScalarNode)?.Value;
                if (name is null || !Identifier.IsMatch(name)) { Issue("binding-name", "Binding names require case-sensitive ASCII dot-separated identifiers.", binding.Key); continue; }
                if (!names.Add(name)) Issue("duplicate-binding-name", $"Binding name {name} appears more than once.", binding.Key);
                if (!TryId(bindingId, out var canonical)) { Issue("binding-id", "Binding IDs must be nonempty UUIDs.", binding.Value); continue; }
                if (!bindingIds.Add(canonical)) Issue("duplicate-binding-id", "A binding ID appears more than once.", binding.Value);
                bindings.TryAdd(name, canonical);
            }
            if (id is not null && title is not null) notes.Add(new(id, title, new ReadOnlyDictionary<string, string>(bindings)));
        }
        return issues.Count == before && documentId is not null ? new(1, documentId, notes.AsReadOnly()) : null;
    }

    private static bool TryId(string? value, out string canonical)
    {
        if ((Guid.TryParseExact(value, "N", out var id) || Guid.TryParseExact(value, "D", out id)) && id != Guid.Empty)
        { canonical = id.ToString("N"); return true; }
        canonical = ""; return false;
    }
    private static YamlNode? Get(YamlMappingNode map, string key) => map.Children.FirstOrDefault(p => p.Key is YamlScalarNode scalar && scalar.Value == key).Value;
    private static void Set(YamlMappingNode map, string key, YamlNode value)
    {
        var existing = map.Children.Keys.OfType<YamlScalarNode>().FirstOrDefault(k => k.Value == key);
        map.Children[existing ?? new YamlScalarNode(key)] = value;
    }
    private static YamlMappingNode BuildMetadata(MarkdownIdentityMetadata metadata, YamlMappingNode? previous)
    {
        var map = previous ?? new YamlMappingNode();
        Set(map, "schema", new YamlScalarNode(metadata.Schema.ToString(CultureInfo.InvariantCulture)));
        Set(map, "documentId", new YamlScalarNode(metadata.DocumentId));
        var oldNotes = Get(map, "notes") as YamlSequenceNode;
        var notes = new YamlSequenceNode();
        foreach (var note in metadata.Notes)
        {
            var old = oldNotes?.Children.OfType<YamlMappingNode>().FirstOrDefault(n =>
                TryId((Get(n, "id") as YamlScalarNode)?.Value, out var id) && TryId(note.Id, out var desired) && id == desired);
            var item = old ?? new YamlMappingNode();
            Set(item, "id", new YamlScalarNode(note.Id));
            Set(item, "title", new YamlScalarNode(note.Title) { Style = ScalarStyle.DoubleQuoted });
            var bindings = new YamlMappingNode();
            foreach (var pair in note.Bindings) bindings.Add(new YamlScalarNode(pair.Key), new YamlScalarNode(pair.Value));
            Set(item, "bindings", bindings);
            notes.Add(item);
        }
        Set(map, "notes", notes);
        return map;
    }
    private static string SerializeEntry(YamlMappingNode node, string newline, int indent)
    {
        var stream = new YamlStream(new YamlDocument(new YamlMappingNode(new YamlScalarNode("grasp"), node)));
        using var writer = new StringWriter(CultureInfo.InvariantCulture) { NewLine = "\n" };
        stream.Save(writer, false);
        var text = writer.ToString().Replace("\r\n", "\n").TrimEnd('\n');
        if (text.StartsWith("---\n", StringComparison.Ordinal)) text = text[4..];
        if (text.EndsWith("\n...", StringComparison.Ordinal)) text = text[..^4];
        var prefix = new string(' ', indent);
        return string.Join(newline, text.Split('\n').Select(line => prefix + line)) + newline;
    }
    private static (string Text, int End) ReadLine(string source, int at)
    {
        var end = at;
        while (end < source.Length && source[end] is not ('\r' or '\n')) end++;
        var text = source[at..end];
        if (end < source.Length) end += source[end] == '\r' && end + 1 < source.Length && source[end + 1] == '\n' ? 2 : 1;
        return (text, end);
    }
    private static int LineStart(string source, int at)
    {
        while (at > 0 && source[at - 1] is not ('\r' or '\n')) at--;
        return at;
    }
    private static int EntryEnd(string source, int nodeEnd, int start, int yamlEnd)
    {
        nodeEnd = Math.Min(nodeEnd, yamlEnd);
        var atLine = LineStart(source, nodeEnd);
        var end = source[atLine..nodeEnd].All(c => c is ' ' or '\t') ? atLine : ReadLine(source, atLine).End;
        return Math.Min(end, yamlEnd);
    }
}
