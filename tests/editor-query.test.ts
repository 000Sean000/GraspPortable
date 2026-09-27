import { describe, expect, it } from 'vitest';
import { assetIdentifier, assetUrl, attachmentMarkdown, executeQuery, inlineAsset, parseQuery, safeLink } from '../src/editor/query';
import type { RuntimeResult, StructuredRecord } from '../src/domain/model';

const record: StructuredRecord = { id: 'r1', collection: 'aura', name: 'bright', fields: { element: '{base}', description: '<script>alert(1)</script>' }, revision: 1 };
const runtime: RuntimeResult = { revision: 1, values: { 'aura.bright.element': { status: 'ok', value: 'fire' }, 'aura.bright.description': { status: 'ok', value: '<script>alert(1)</script>' } }, definitions: [], references: [], diagnostics: [], metrics: { elapsedMs: 0, recalculated: 0, total: 0, affected: 0 } };

describe('editor query projection', () => {
  it('filters and renders evaluated values, retaining untrusted content as data', () => {
    const result = executeQuery(parseQuery('{"collection":"aura","where":{"field":"element","equals":"fire"}}'), [record], runtime);
    expect(result.total).toBe(1);
    expect(result.rows[0].cells.map(cell => cell.value)).toEqual(['<script>alert(1)</script>', 'fire']);
    expect(executeQuery({ collection: 'aura', where: { field: 'element', equals: '{base}' } }, [record], runtime).rows).toEqual([]);
    expect(executeQuery({ collection: 'aura', where: { field: 'absent', equals: '' } }, [record], runtime).rows).toEqual([]);
  });
  it('rejects code-like and ambiguous query instructions', () => {
    for (const source of ['null', '[]', '{"collection":"aura","sql":"delete"}', '{"collection":"aura","where":{"field":"element"}}', '{"collection":"aura","where":{"field":"element","equals":1}}']) expect(() => parseQuery(source)).toThrow();
  });
  it('bounds rendering without misreporting result count', () => {
    const result = executeQuery({ collection: 'aura' }, [record, { ...record, name: 'dim' }], runtime, 1);
    expect(result.rows).toHaveLength(1); expect(result.total).toBe(2); expect(result.truncated).toBe(true);
  });
  it('allows only explicit safe external link protocols', () => {
    expect(safeLink('https://example.com')).toBe('https://example.com');
    expect(safeLink('mailto:test@example.com')).toBe('mailto:test@example.com');
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///c:/secret', '//example.com', 'java\nscript:alert(1)']) expect(safeLink(url)).toBeNull();
  });
  it('uses portable attachment IDs, escaped labels and a strict raster allowlist', () => {
    expect(assetIdentifier('grasp-asset:known-id')).toBe('known-id');
    for (const url of ['grasp-asset:../bad', 'grasp-asset:id?html=1', 'javascript:alert(1)', '/api/assets/id', 'grasp-asset:id/path']) expect(assetIdentifier(url)).toBeNull();
    expect(assetUrl('a/b', 'workspace&other')).toBe('/api/assets/a%2Fb?workspace=workspace%26other');
    expect(attachmentMarkdown({ id: 'id', name: '[圖]\\.png', mimeType: 'image/png' })).toBe('![\\[圖\\]\\\\.png](grasp-asset:id)');
    expect(attachmentMarkdown({ id: 'id', name: 'page.svg', mimeType: 'image/svg+xml' }, true)).toBe('[page.svg](grasp-asset:id)');
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) expect(inlineAsset(mime)).toBe(true);
    for (const mime of ['text/html', 'image/svg+xml', 'application/pdf', 'image/avif']) expect(inlineAsset(mime)).toBe(false);
  });
});
