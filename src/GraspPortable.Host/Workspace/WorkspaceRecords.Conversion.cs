using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.Records;
using GraspPortable.Core.ValueEngine;
using YamlDotNet.RepresentationModel;

namespace GraspPortable.Host.Workspace;

public sealed partial class WorkspaceRecords
{
    /// <summary>Pure preview: no draft, receipt, archive or current document is written.</summary>
    public RecordFieldConversionPreview PreviewFieldConversion(string recordId, string fieldId, PreviewRecordFieldConversionRequest request)
    {
        var basis = knowledge.Current;
        try
        {
            if (basis.Revision != request.ExpectedKnowledgeRevision) throw new IOException("欄位基底已更新，請保留輸入並重新讀取。");
            var owner = Owners(basis).SingleOrDefault(o => o.Note.CurrentRecords!.Records.Any(r => r.Id == recordId))
                ?? throw new KeyNotFoundException("Record 不存在或身分不唯一。");
            if (owner.Note.IsSourceStale || knowledge.GetDraft(owner.Note.Id) is not null || repository.IsWriteBlocked)
                throw new IOException("來源有草稿、未接受內容或待恢復寫入，請先處理來源。");
            var descriptor = owner.Note.CurrentRecords!;
            var schema = descriptor.Fields.Single(f => f.Id == fieldId);
            var locator = descriptor.Records.Single(r => r.Id == recordId).Fields.Single(f => f.FieldId == fieldId);
            if (schema.Kind != RecordFieldKind.Markdown || request.IsNull)
                return new(basis.Revision, false, request.RawSource, locator.Layout.ToString(), [], [], null, true);
            var originalSyntax = GraspParser.Parse(request.RawSource, basis.Languages);
            var protectedSpans = originalSyntax.References.Select(r => r.Span)
                .Concat(originalSyntax.Regions?.Select(r => r.Span) ?? []).ToArray();
            var converted = HeadingConversion.Preview(request.RawSource, protectedSpans: protectedSpans);
            if (!converted.CanApply)
                return new(basis.Revision, false, request.RawSource, locator.Layout.ToString(), [], converted.Diagnostics.Select(Diagnostic).ToArray(), null, false);
            var requires = converted.ConvertedSource != request.RawSource;
            var layout = requires ? converted.Layout : locator.Layout;
            var mapping = converted.Mapping.Select(m => new RecordFieldHeadingMapDto(m.OriginalSpan.Start, m.OriginalSpan.Length,
                m.ConvertedSpan.Start, m.ConvertedSpan.Length, m.OriginalLevel, m.ConvertedLevel, m.ListDepth)).ToArray();
            string? previewToken = null;
            if (requires)
            {
                if (converted.Layout == FieldLayout.NestedList && originalSyntax.Regions?.Any(r =>
                    request.RawSource.AsSpan(r.Span.Start, r.Span.Length).IndexOfAny('\r', '\n') >= 0) == true)
                    return new(basis.Revision, true, converted.ConvertedSource, layout.ToString(), mapping,
                        [new("conversion-grasp-indent", "巢狀清單縮排可能改變多行 Grasp literal 的空白值；請先將該定義保留在來源的欄位外。", 0, 0)], null, false);
                // Prove the same physical replacement/descriptor is parseable before offering confirmation.
                var prepared = ConvertedDocument(owner, recordId, fieldId, converted.ConvertedSource, layout);
                var fieldSource = VerticalRecordCodec.Parse(prepared.Source, prepared.Descriptor).Fields
                    .Single(f => f.RecordId == recordId && f.FieldId == fieldId);
                var convertedSyntax = GraspParser.Parse(fieldSource.RawSource, basis.Languages);
                if (!originalSyntax.References.Select(r => (r.Kind, r.Name)).SequenceEqual(convertedSyntax.References.Select(r => (r.Kind, r.Name))))
                    return new(basis.Revision, true, converted.ConvertedSource, layout.ToString(), mapping,
                        [new("conversion-reference-context", "轉換會改變 Grasp 引用的解析範圍，未套用；請保留原文並調整欄位結構。", 0, 0)], null, false);
                var syntax = RecordNoteSyntax.Parse(prepared.Source, prepared.Descriptor, basis.Languages);
                if (!syntax.IsValid)
                    return new(basis.Revision, true, converted.ConvertedSource, layout.ToString(), mapping,
                        syntax.Diagnostics.Select(d => new DiagnosticDto(d.Code, d.Message, d.Span.Start, d.Span.Length)).ToArray(), null, false);
                previewToken = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new {
                    format = 1, basis.WorkspaceId, basis.Revision, owner.Note.Id, owner.Note.CurrentSourceHash,
                    recordId, fieldId, request.RawSource, request.IsNull, converted.ConvertedSource, layout, mapping }))));
            }
            return new(basis.Revision, requires, converted.ConvertedSource, layout.ToString(), mapping, [], previewToken, true);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or KeyNotFoundException or IOException)
        {
            return new(basis.Revision, false, request.RawSource, "Headings", [],
                [new(error is IOException ? "conversion-conflict" : "conversion-invalid", error.Message, 0, 0)], null, false);
        }
    }

    private (string Source, RecordsDocumentDescriptor Descriptor) ConvertedDocument(Owner owner, string recordId, string fieldId,
        string convertedSource, FieldLayout layout)
    {
        var descriptor = owner.Note.CurrentRecords!;
        var parsed = VerticalRecordCodec.Parse(owner.Note.CurrentSource, descriptor);
        if (!parsed.CanRewrite) throw new ArgumentException("欄位原文邊界不明，不能轉換。");
        var field = parsed.Fields.Single(f => f.RecordId == recordId && f.FieldId == fieldId);
        var old = descriptor.Records.Single(r => r.Id == recordId).Fields.Single(f => f.FieldId == fieldId);
        // Preserve an existing enclosing list's indentation; otherwise the converted top list starts at two spaces.
        var locator = old with { Layout = layout, Indent = layout == FieldLayout.NestedList ? Math.Max(2, old.Indent) : 0 };
        var next = descriptor with { Records = descriptor.Records.Select(r => r.Id == recordId
            ? r with { Fields = r.Fields.Select(f => f.FieldId == fieldId ? locator : f).ToArray() } : r).ToArray() };
        var encoded = VerticalRecordCodec.SerializeCarrier(locator, new(convertedSource),
            owner.Note.CurrentSource.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n");
        if (!encoded.Success) throw new ArgumentException(string.Join("；", encoded.Diagnostics.Select(d => d.Message)));
        var source = ReferenceCodec.ApplyPatches(owner.Note.CurrentSource, [new(field.CarrierSpan, encoded.Source!)]);
        var verified = VerticalRecordCodec.Parse(source, next);
        if (!verified.CanRewrite || verified.Fields.Single(f => f.RecordId == recordId && f.FieldId == fieldId).RawSource != convertedSource)
            throw new ArgumentException("轉換後欄位無法完整往返，未套用。");
        return (source, next);
    }

    private async Task<Receipt> ApplyFieldConversion(Owner owner, string recordId, string fieldId, RecordFieldChangeRequest request,
        FieldSourceEdit original, RecordFieldConversionPreview preview, string hash, CancellationToken token)
    {
        var converted = ConvertedDocument(owner, recordId, fieldId, preview.ConvertedSource, Enum.Parse<FieldLayout>(preview.Layout));
        var history = owner.Metadata.ConversionHistoryYaml is null ? new YamlSequenceNode()
            : Yaml(owner.Metadata.ConversionHistoryYaml) as YamlSequenceNode ?? throw new ArgumentException("既有轉換歷史格式無效。");
        // This immutable recovery snapshot is never read as a live field value. Base64 avoids YAML newline normalization.
        history.Add(Yaml(ViewSerializer.Serialize(new {
            format = 1, operationId = request.OperationId, recordId, fieldId, basisRevision = preview.BasisRevision,
            previewToken = preview.PreviewToken, originalSourceUtf8Base64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(original.Source)),
            originalLayout = owner.Note.CurrentRecords!.Records.Single(r => r.Id == recordId).Fields.Single(f => f.FieldId == fieldId),
            convertedLayout = preview.Layout, mapping = preview.Mapping
        })));
        var metadata = owner.Metadata with { Descriptor = converted.Descriptor, ConversionHistoryYaml = YamlText(history) };
        return await Commit(request.OperationId, hash, request.ExpectedKnowledgeRevision, owner.Note.Id, owner.Note.Title,
            converted.Source, metadata, request.ConfirmRename, token);
    }
}
