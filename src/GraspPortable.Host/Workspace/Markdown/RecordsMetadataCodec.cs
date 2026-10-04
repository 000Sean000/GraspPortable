using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using GraspPortable.Core.Records;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace GraspPortable.Host.Workspace.Markdown;

/// <summary>Host-owned collection presentation; field values exist only in the Markdown body.</summary>
public sealed record RecordsMetadata(string CollectionId, string Title, RecordsDocumentDescriptor Descriptor, string? ViewsYaml = null);
public sealed record RecordsMetadataResult(RecordsMetadata? Metadata, IReadOnlyList<MarkdownEnvelopeIssue> Issues)
{ public bool Success => Metadata is not null && Issues.Count == 0; }

/// <summary>Versioned descriptor carrier. Unknown mapping entries follow their stable IDs on rewrite.</summary>
public static class RecordsMetadataCodec
{
    private static readonly Regex Key = new(@"\A[A-Za-z_][A-Za-z0-9_]*\z", RegexOptions.CultureInvariant);
    private static readonly Regex RecordKey = new(@"\A[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\z", RegexOptions.CultureInvariant);
    public static bool SameDescriptor(RecordsDocumentDescriptor? a, RecordsDocumentDescriptor? b)
        => JsonSerializer.Serialize(Normalized(a)) == JsonSerializer.Serialize(Normalized(b));
    private static RecordsDocumentDescriptor? Normalized(RecordsDocumentDescriptor? value) => value is null ? null
        : value with { Fields = value.Fields.Select(f => f with { Options = f.Options ?? [] }).ToArray() };

    public static RecordsMetadataResult Read(YamlNode node, int sourceOffset = 0)
    {
        var issues = new List<MarkdownEnvelopeIssue>();
        void Error(string message, YamlNode? at = null) => issues.Add(new("records-metadata", message, sourceOffset + (int)(at?.Start.Index ?? 0)));
        string Text(YamlMappingNode map, string key)
        {
            if (Get(map, key) is YamlScalarNode { Value: not null } value) return value.Value;
            Error(key + " must be a scalar.", Get(map, key)); return "";
        }
        string Id(YamlMappingNode map, string key)
        {
            var value = Text(map, key);
            if (TryId(value, out var id)) return id;
            Error(key + " must be a nonempty UUID.", Get(map, key)); return "";
        }
        string Identifier(YamlMappingNode map, bool qualified = false)
        {
            var value = Text(map, "key");
            if (!(qualified ? RecordKey : Key).IsMatch(value)) Error(qualified ? "Record keys require dot-separated ASCII identifiers." : "Field keys require one case-sensitive ASCII identifier segment.", Get(map, "key"));
            return value;
        }
        IReadOnlyList<YamlMappingNode> Items(YamlMappingNode owner, string key, bool optional = false)
        {
            var value = Get(owner, key);
            if (value is null && optional) return [];
            if (value is not YamlSequenceNode sequence) { Error(key + " must be a sequence.", value); return []; }
            var result = new List<YamlMappingNode>();
            foreach (var item in sequence.Children)
                if (item is YamlMappingNode map) result.Add(map); else Error(key + " entries must be mappings.", item);
            return result;
        }
        void Unique(IEnumerable<string> values, string label)
        { var seen = new HashSet<string>(StringComparer.Ordinal); foreach (var value in values) if (!seen.Add(value)) Error("Duplicate " + label + ": " + value); }
        if (node is not YamlMappingNode root) { Error("records must be a mapping.", node); return new(null, issues); }
        if (Text(root, "version") != "1") Error("Only Records metadata version 1 is supported.", root);
        var collectionId = Id(root, "collectionId"); var title = Text(root, "title");
        var schemas = new List<FieldSchema>();
        foreach (var item in Items(root, "schema"))
        {
            var id = Id(item, "id"); var key = Identifier(item); var name = Text(item, "displayName"); var kindText = Text(item, "kind");
            if (!Enum.TryParse<RecordFieldKind>(kindText, false, out var kind) || !Enum.IsDefined(kind) || kind.ToString() != kindText)
                Error("Unknown field kind: " + kindText, Get(item, "kind"));
            var options = Items(item, "options", true).Select(option => new FieldOption(Id(option, "id"), Text(option, "displayName"))).ToArray();
            Unique(options.Select(o => o.Id), "option ID");
            if (options.Length > 0 && kind is not (RecordFieldKind.SingleSelect or RecordFieldKind.MultiSelect)) Error("Only select fields may define options.", item);
            schemas.Add(new(id, key, name, kind, options.Length == 0 ? null : options));
        }
        Unique(schemas.Select(f => f.Id), "field ID"); Unique(schemas.Select(f => f.Key), "field key");
        var records = new List<RecordDescriptor>(); var allLocators = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in Items(root, "items"))
        {
            var id = Id(item, "id"); var key = Identifier(item, qualified: true); var name = Text(item, "displayName"); var fields = new List<FieldLocator>();
            foreach (var field in Items(item, "fields"))
            {
                var fieldId = Id(field, "fieldId"); var locator = Id(field, "locatorId"); var layoutText = Text(field, "layout");
                if (!Enum.TryParse<FieldLayout>(layoutText, false, out var layout) || !Enum.IsDefined(layout) || layout.ToString() != layoutText)
                    Error("Unknown field layout: " + layoutText, Get(field, "layout"));
                if (!int.TryParse(Text(field, "indent"), NumberStyles.None, CultureInfo.InvariantCulture, out var indent)
                    || indent < 0 || indent > 64 || layout == FieldLayout.Headings && indent != 0 || layout == FieldLayout.NestedList && indent < 1)
                    Error("Field indentation must match the explicit heading or nested-list layout.", field);
                if (!schemas.Any(s => s.Id == fieldId)) Error("Locator refers to an unknown field schema.", field);
                if (!allLocators.Add(locator)) Error("Locator ID must be unique within the note.", field);
                fields.Add(new(fieldId, locator, layout, indent));
            }
            Unique(fields.Select(f => f.FieldId), "record field");
            records.Add(new(id, key, name, fields));
        }
        Unique(records.Select(r => r.Id), "record ID"); Unique(records.Select(r => r.Key), "record key");
        var views = Get(root, "views");
        if (views is not null && views is not (YamlMappingNode or YamlSequenceNode)) Error("views must be a mapping or sequence.", views);
        return new(issues.Count == 0 ? new(collectionId, title, new(records, schemas), views is null ? null : Serialize(views)) : null, issues);
    }

    public static YamlMappingNode Write(RecordsMetadata metadata, YamlMappingNode? previous = null)
    {
        var root = previous ?? new YamlMappingNode();
        Set(root, "version", "1"); Set(root, "collectionId", metadata.CollectionId); Set(root, "title", metadata.Title);
        var schema = new YamlSequenceNode();
        foreach (var field in metadata.Descriptor.Fields)
        {
            var item = Existing(root, "schema", "id", field.Id);
            Set(item, "id", field.Id); Set(item, "key", field.Key); Set(item, "displayName", field.DisplayName); Set(item, "kind", field.Kind.ToString());
            var options = new YamlSequenceNode();
            foreach (var option in field.Options ?? [])
            {
                var child = Existing(item, "options", "id", option.Id);
                Set(child, "id", option.Id); Set(child, "displayName", option.DisplayName); options.Add(child);
            }
            if (field.Options is not null) Set(item, "options", options); else Remove(item, "options");
            schema.Add(item);
        }
        var records = new YamlSequenceNode();
        foreach (var record in metadata.Descriptor.Records)
        {
            var item = Existing(root, "items", "id", record.Id);
            Set(item, "id", record.Id); Set(item, "key", record.Key); Set(item, "displayName", record.DisplayName);
            var fields = new YamlSequenceNode();
            foreach (var locator in record.Fields)
            {
                var child = Existing(item, "fields", "locatorId", locator.LocatorId);
                Set(child, "fieldId", locator.FieldId); Set(child, "locatorId", locator.LocatorId);
                Set(child, "layout", locator.Layout.ToString()); Set(child, "indent", locator.Indent.ToString(CultureInfo.InvariantCulture)); fields.Add(child);
            }
            Set(item, "fields", fields); records.Add(item);
        }
        Set(root, "schema", schema); Set(root, "items", records);
        if (metadata.ViewsYaml is null) Remove(root, "views");
        else
        {
            var stream = new YamlStream(); stream.Load(new StringReader(metadata.ViewsYaml));
            if (stream.Documents.Count != 1 || stream.Documents[0].RootNode is not (YamlMappingNode or YamlSequenceNode))
                throw new ArgumentException("Views must contain one YAML mapping or sequence.", nameof(metadata));
            Set(root, "views", stream.Documents[0].RootNode);
        }
        return root;
    }

    private static YamlMappingNode Existing(YamlMappingNode root, string sequence, string key, string id)
        => (Get(root, sequence) as YamlSequenceNode)?.Children.OfType<YamlMappingNode>().FirstOrDefault(n =>
            TryId((Get(n, key) as YamlScalarNode)?.Value, out var existing) && TryId(id, out var desired) && existing == desired) ?? new();
    private static bool TryId(string? value, out string result)
    { if ((Guid.TryParseExact(value, "N", out var id) || Guid.TryParseExact(value, "D", out id)) && id != Guid.Empty) { result = id.ToString("N"); return true; } result = ""; return false; }
    private static YamlNode? Get(YamlMappingNode map, string key) => map.Children.FirstOrDefault(p => p.Key is YamlScalarNode scalar && scalar.Value == key).Value;
    private static void Set(YamlMappingNode map, string key, string value) => Set(map, key, new YamlScalarNode(value));
    private static void Set(YamlMappingNode map, string key, YamlNode value) => map.Children[new YamlScalarNode(key)] = value;
    private static void Remove(YamlMappingNode map, string key) => map.Children.Remove(new YamlScalarNode(key));
    private static string Serialize(YamlNode node)
    { using var writer = new StringWriter(CultureInfo.InvariantCulture); new YamlStream(new YamlDocument(node)).Save(writer, false); return writer.ToString(); }
}
