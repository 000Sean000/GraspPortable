using System.Numerics;
using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;

try
{
var count = 0;
void Check(bool pass, string label) { if (!pass) throw new Exception(label); count++; Console.WriteLine("PASS: " + label); }
string Id() => Guid.NewGuid().ToString("N");
var field = new FieldSchema(Id(), "Description", "描述", RecordFieldKind.Markdown);
var locator = new FieldLocator(field.Id, Id());
var record = new RecordDescriptor(Id(), "Characters.Triensa", "提恩莎", [locator]);
var descriptor = new RecordsDocumentDescriptor([record], [field]);
var raw = "第一段 😀\r\n\r\n## 任意標題不關閉欄位\r\n\r\n![image](portrait.png) [[link]]\r\n"
    + "```json\r\n# not a heading\r\n<!-- /grasp:field " + locator.LocatorId + " -->\r\n```\r\n"
    + "\\<!-- /grasp:field " + locator.LocatorId + " -->\r\n[舊值](:ref:World.Description)\r\n";
foreach (var layout in new[] { FieldLayout.Headings, FieldLayout.NestedList })
{
    var currentLocator = locator with { Layout = layout, Indent = layout == FieldLayout.NestedList ? 6 : 0 };
    var currentRecord = record with { Fields = [currentLocator] };
    var currentDescriptor = descriptor with { Records = [currentRecord] };
    var encoded = VerticalRecordCodec.SerializeCarrier(currentLocator, new(raw), "\r\n");
    Check(encoded.Success, layout + " serializes long Markdown/fence/escaped marker");
    var source = "## 角色\r\n\r\n" + encoded.Source + "\r\n\r\n尾段保留";
    var parsed = VerticalRecordCodec.Parse(source, currentDescriptor);
    Check(parsed.CanRewrite && parsed.Fields.Single().RawSource == raw, layout + " round-trips actual CRLF paragraphs without using heading boundaries");
    var value = parsed.Fields.Single();
    Check(value.SourceMap.All(m => source.Substring(m.SourceSpan.Start, m.SourceSpan.Length) == raw.Substring(m.ValueSpan.Start, m.ValueSpan.Length)), layout + " source map slices remain exact UTF-16 source");
    var mapped = value.MapToSource(new(raw.IndexOf("World.Description", StringComparison.Ordinal), "World.Description".Length));
    Check(source.Substring(mapped.Start, mapped.Length) == "World.Description", layout + " emoji before reference does not shift UTF-16 offsets");
    var edit = VerticalRecordCodec.PrepareFieldEdit(source, parsed, record.Id, field.Id, new("新段落\r\n\r\n第二段"));
    var patched = ReferenceCodec.ApplyPatches(source, [edit.Patch!]);
    Check(edit.Success && patched.StartsWith("## 角色\r\n\r\n", StringComparison.Ordinal) && patched.EndsWith("\r\n\r\n尾段保留", StringComparison.Ordinal)
        && VerticalRecordCodec.Parse(patched, currentDescriptor).Fields.Single().RawSource == "新段落\r\n\r\n第二段", layout + " field edit changes only its carrier and preserves surroundings");
    Check(!VerticalRecordCodec.PrepareFieldEdit(source + "changed", parsed, record.Id, field.Id, new("x")).Success, layout + " stale source cannot reuse ranges");
}

var simple = VerticalRecordCodec.SerializeCarrier(locator, new("original")).Source!;
Check(!VerticalRecordCodec.SerializeCarrier(locator, new("<!-- /grasp:field " + locator.LocatorId + " -->")).Success, "unescaped marker collision refuses rewriting");
Check(!VerticalRecordCodec.SerializeCarrier(locator, new("```json\nunfinished")).Success, "unclosed fence cannot hide a serialized field boundary");
Check(!VerticalRecordCodec.Parse(simple + "\n" + simple, descriptor).CanRewrite, "duplicate field identity is read-only ambiguity");
Check(!VerticalRecordCodec.Parse(simple[..simple.LastIndexOf("<!-- /", StringComparison.Ordinal)], descriptor).CanRewrite, "missing boundary preserves source and refuses rewrite");
var nestedLocator = locator with { Layout = FieldLayout.NestedList, Indent = 6 };
var brokenNested = VerticalRecordCodec.SerializeCarrier(nestedLocator, new("value")).Source!.Replace("      value", "escaped indentation", StringComparison.Ordinal);
Check(!VerticalRecordCodec.Parse(brokenNested, descriptor with { Records = [record with { Fields = [nestedLocator] }] }).CanRewrite, "nested source escaping its indentation is not silently accepted");
var parsedSimple = VerticalRecordCodec.Parse(simple, descriptor);
var forged = parsedSimple with { Fields = [parsedSimple.Fields.Single() with { CarrierSpan = new(0, 0) }] };
Check(VerticalRecordCodec.PrepareFieldEdit(simple, forged, record.Id, field.Id, new("changed")).Patch!.Span.Length == simple.Length, "write API revalidates public record ranges before patching");

foreach (var sample in new[] { new FieldSourceEdit("", true), new FieldSourceEdit(""), new FieldSourceEdit("0"), new FieldSourceEdit("false") })
{
    var carrier = VerticalRecordCodec.SerializeCarrier(locator, sample).Source!;
    var restored = VerticalRecordCodec.Parse(carrier, descriptor).Fields.Single();
    Check(restored.RawSource == sample.Source && restored.IsNull == sample.IsNull, $"carrier keeps null={sample.IsNull}, text='{sample.Source}' distinct");
}
Check(RecordValueCodec.Parse(field, true, "").Value is NullRecordValue && RecordValueCodec.Parse(field, false, "").Value is MarkdownRecordValue { Markdown: "" }, "typed null differs from empty Markdown");
var number = field with { Kind = RecordFieldKind.Number };
var boolean = field with { Kind = RecordFieldKind.Boolean };
Check(RecordValueCodec.Parse(number, false, "0").Value is NumberRecordValue { Coefficient.IsZero: true }
    && RecordValueCodec.Parse(boolean, false, "false").Value is BooleanRecordValue { Value: false }, "zero and false are valid typed values");
Check(!RecordValueCodec.Parse(number, false, "").IsValid && !RecordValueCodec.Parse(boolean, false, "").IsValid, "empty scalar is invalid rather than implicit null");
var exact = (NumberRecordValue)RecordValueCodec.Parse(number, false, "123456789012345678901234567890.123456789").Value!;
Check(exact.Coefficient == BigInteger.Parse("123456789012345678901234567890123456789") && exact.Scale == 9, "large decimal preserves every digit beyond System.Decimal precision");
Check(RecordValueCodec.Parse(number, false, "-1.25e3").Value is NumberRecordValue { Coefficient: var coefficient, Scale: -1 } && coefficient == -125, "base-ten exponent is represented exactly");
Check(!RecordValueCodec.Parse(number, false, "1e10001").IsValid && !RecordValueCodec.Parse(number, false, new string('1', 4097)).IsValid
    && !RecordValueCodec.Parse(number, false, "1,234").IsValid, "numeric resource and locale ambiguity guards reject without rounding");
Check(RecordValueCodec.Parse(field with { Kind = RecordFieldKind.Date }, false, "2024-02-29").Value is DateRecordValue
    && !RecordValueCodec.Parse(field with { Kind = RecordFieldKind.Date }, false, "2023-02-29").IsValid, "date-only handles actual calendar validity");
var optionId = Id(); var otherOption = Id();
var select = field with { Kind = RecordFieldKind.MultiSelect, Options = [new(optionId, "新名稱"), new(otherOption, "第二個")] };
var optionSource = RecordValueCodec.IdentityCarrier("舊[名稱]", "#old", optionId, false) + "\n" + RecordValueCodec.IdentityCarrier("第二個", "#two", otherOption, false);
Check(RecordValueCodec.Parse(select, false, optionSource).Value is SelectRecordValue options && options.OptionIds.SequenceEqual(new[] { optionId, otherOption }), "multiple option carriers preserve IDs despite label rename and escaped brackets");
Check(RecordValueCodec.Parse(select, false, "").Value is SelectRecordValue { OptionIds.Count: 0 }
    && !RecordValueCodec.Parse(select with { Kind = RecordFieldKind.SingleSelect }, false, "").IsValid, "empty multi value differs from missing single value");
Check(!RecordValueCodec.Parse(select, false, optionSource + "\n" + RecordValueCodec.IdentityCarrier("duplicate", "#x", optionId, false)).IsValid, "duplicate option IDs are not silently collapsed");
var related = Id(); var relation = RecordValueCodec.IdentityCarrier("安莉亞", "./Characters.md#安莉亞", related, true);
var relationField = field with { Kind = RecordFieldKind.SingleRelation };
var missing = RecordValueCodec.Parse(relationField, false, relation, new(new HashSet<string>()));
Check(missing.Value is RelationRecordValue { RecordIds.Count: 1 } && missing.Diagnostics.Single().Code == "missing-relation", "missing relation retains target identity and explicit diagnostic");
Check(RecordValueCodec.Parse(relationField, false, relation, new(new HashSet<string> { related })).IsValid, "known record ID resolves independently of readable path");
Check(RecordValueCodec.Parse(field with { Kind = RecordFieldKind.Tag }, false, "- Mentor\n- 導師").Value is TagRecordValue tags && tags.Tags.SequenceEqual(new[] { "Mentor", "導師" }), "Unicode tags preserve exact case and text");

var projectionRaw = "@code{ @Inside = {yes} }\n[stale](:ref:Inside)\n[old](:ref:Characters.Triensa.Description)\n```json\n[x](:ref:NotAnEdge)\n```";
var projectionSource = VerticalRecordCodec.SerializeCarrier(locator, new(projectionRaw)).Source!;
var projectionField = VerticalRecordCodec.Parse(projectionSource, descriptor).Fields.Single();
var projection = FieldSourceProjection.Project(record, field, projectionField, ["", "grasp"]);
Check(projection.OriginalSyntax.Definitions.Single().Name == "Inside" && projection.Parts.Count(p => p.Kind == PartKind.Identifier) == 2
    && projection.Parts.All(p => p.Text != "NotAnEdge"), "projection returns handwritten definitions and only original active reference dependencies");
var generated = new Definition(projection.PublicName, projectionField.BodySpan, projectionField.CarrierSpan, projectionField.BodySpan, projection.Parts);
var evaluated = DependencyEvaluator.Evaluate(projection.OriginalSyntax.Definitions.Append(generated));
Check(evaluated.Values[projection.PublicName].Status == EvaluationStatus.Cycle, "existing evaluator sees generated self-cycle without another engine");
var computed = "@code{ @Injected = {not parsed} }";
Check(RecordValueCodec.Parse(field, false, computed).Value is MarkdownRecordValue { Markdown: var text } && text == computed, "typed projection never reparses computed Markdown into Grasp definitions");

var headings = "# 背景\r\n內容\r\n\r\n## 子節\r\n```json\r\n# literal\r\n```\r\n";
var converted = HeadingConversion.Preview(headings);
Check(converted.CanApply && converted.Layout == FieldLayout.Headings && converted.ConvertedSource.StartsWith("##### 背景\r\n", StringComparison.Ordinal)
    && converted.ConvertedSource.Contains("###### 子節", StringComparison.Ordinal) && converted.ConvertedSource.Contains("# literal", StringComparison.Ordinal), "heading preview maps structural levels without touching fenced examples");
Check(converted.OriginalSource == headings && converted.Mapping.All(m => m.ConvertedLevel is >= 2 and <= 6), "conversion returns recoverable original and explicit heading mapping");
var deep = HeadingConversion.Preview("# Top\nintro\n\n### Middle\nbody\n\n###### Deep\nlast\n");
Check(deep.Layout == FieldLayout.NestedList && deep.Mapping.Select(m => m.ListDepth).SequenceEqual(new[] { 0, 1, 2 })
    && deep.Mapping.Select(m => m.OriginalLevel).SequenceEqual(new[] { 1, 3, 6 })
    && deep.ConvertedSource.Contains("    - **Deep**", StringComparison.Ordinal), "depth overflow preserves ancestor hierarchy and skipped levels in mapping without generating code indentation");
var setext = HeadingConversion.Preview("標題\n===\nbody\n");
Check(setext.Mapping.Single().OriginalLevel == 1 && setext.ConvertedSource.StartsWith("##### 標題\n", StringComparison.Ordinal), "setext H1 conversion also produces no H1");
Check(HeadingConversion.Preview("plain\n\n---\n").Mapping.Count == 0, "standalone thematic rule is not guessed as a heading");
var containerHeading = "> # Nested H1\n";
Check(!HeadingConversion.Preview(containerHeading).CanApply && HeadingConversion.Preview(containerHeading).ConvertedSource == containerHeading,
    "unsupported container heading is preserved read-only rather than silently leaving converted H1");
Console.WriteLine($"PASS: {count} bounded Records assertions.");
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
