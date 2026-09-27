import { describe, expect, it } from 'vitest';
import { parser as markdownParser } from '@lezer/markdown';
import { serializeBinding } from '../src/domain/binding-language';
import { serializeReference } from '../src/domain/reference-language';
import { createSourceBundle, restoreSourceBundle, serializeSourceBundle, type SourceBundle } from '../src/domain/source-bundle';
import { exportSourceBundleMarkdown } from '../src/domain/markdown-value-export';

function sourceFixture() {
  const value = 'first\r\n\r\nsecond ] | \\🙂\n```\n@Fake = <|x|>\n';
  return '\ufeff# Example\r\nBefore ' + serializeBinding('Fruit', [{ kind: 'literal', value: 'apple' }]) + '; after\n'
    + serializeBinding('Text', [{ kind: 'literal', value }]) + '\r'
    + serializeBinding('Repeated', [{ kind: 'identifier', name: 'Fruit' }, { kind: 'literal', value: ' + ' }, { kind: 'identifier', name: 'Fruit' }])
    + '\r\nPrefix ' + serializeReference({ kind: 'pure', identifier: 'Text', value }) + ' suffix\n'
    + serializeReference({ kind: 'wiki', identifier: 'Fruit', value: 'apple' }) + '\r\n'
    + '\n```md\n@Inert = <|ignored|>\n```\n';
}
function sample(source = sourceFixture()) { return createSourceBundle({ noteId: 'note-one', revision: 42, source }); }
function clone(bundle: SourceBundle): SourceBundle { return JSON.parse(JSON.stringify(bundle)); }

describe('portable note source bundle', () => {
  it('reconstructs exact placement, raw bytes and independently verified semantic structure without a DB', async () => {
    const source = sourceFixture();
    const bundle = await sample(source);
    const restored = await restoreSourceBundle(serializeSourceBundle(bundle));
    expect(restored.source).toBe(source);
    expect(new TextEncoder().encode(restored.source)).toEqual(new TextEncoder().encode(source));
    expect(restored.parsed.bindings.map(binding => binding.name)).toEqual(['Fruit', 'Text', 'Repeated']);
    expect(restored.parsed.bindings[2].dependencies).toEqual(['Fruit', 'Fruit']);
    expect(restored.parsed.bindings[2].parts.map(part => part.kind === 'literal' ? part.value : part.name)).toEqual(['Fruit', ' + ', 'Fruit']);
    expect(restored.parsed.references.map(reference => [reference.kind, reference.identifier])).toEqual([['pure', 'Text'], ['wiki', 'Fruit']]);
    expect(restored.parsed.references[0].value).toBe(restored.parsed.bindings[1].parts[0].kind === 'literal'
      ? restored.parsed.bindings[1].parts[0].value : null);
    expect(bundle.layout.map(span => span.kind)).toEqual(['prose', 'binding', 'prose', 'binding', 'prose', 'binding', 'prose']);
    expect(bundle.bindings.every(binding => binding.identity.kind === 'representation-slot')).toBe(true);
  });

  it.each(['', '\ufeff', 'plain\r\ntext\r\n', 'lone\rcarriage\nline\r', '\ud800', '\udfff'])('preserves source-only case %j', async source => {
    const restored = await restoreSourceBundle(await sample(source));
    expect(restored.source).toBe(source);
    expect(restored.parsed.bindings).toEqual([]);
    expect(restored.parsed.references).toEqual([]);
  });

  it('preserves caller-provided identities while same-name slots remain distinct', async () => {
    const source = '@X = <|one|>\n@X = <|two|>\n[cached](:ref:X)';
    const initial = await sample(source);
    const bundle = await createSourceBundle({ noteId: 'n', revision: 8, source,
      bindingIds: initial.bindings.map((binding, index) => ({ from: binding.syntax.from, to: binding.syntax.to,
        bindingId: `binding-${index}`, identifierId: `identifier-${index}` })) });
    const restored = await restoreSourceBundle(bundle);
    expect(restored.bundle.bindings.map(binding => binding.identity)).toEqual([
      { kind: 'canonical', bindingId: 'binding-0', identifierId: 'identifier-0' },
      { kind: 'canonical', bindingId: 'binding-1', identifierId: 'identifier-1' },
    ]);
    expect(restored.parsed.bindings.map(binding => binding.name)).toEqual(['X', 'X']);
  });

  it('rejects duplicate or unmatched canonical identity mappings', async () => {
    const source = '@A = <|x|>\n@B = <|y|>';
    const bundle = await sample(source);
    const identities = bundle.bindings.map(binding => ({ from: binding.syntax.from, to: binding.syntax.to, bindingId: 'same', identifierId: 'id' }));
    await expect(createSourceBundle({ noteId: 'n', revision: 0, source, bindingIds: identities })).rejects.toThrow('multiple slots');
    await expect(createSourceBundle({ noteId: 'n', revision: 0, source, bindingIds: [{ ...identities[0], from: 1 }] })).rejects.toThrow('no matching');
  });

  it.each(['version', 'language', 'fields'])('rejects unknown %s', async field => {
    const bundle = clone(await sample());
    if (field === 'version') (bundle as unknown as { version: number }).version = 2;
    if (field === 'language') (bundle.language as unknown as { context: number }).context = 99;
    if (field === 'fields') Object.assign(bundle, { execute: 'never' });
    await expect(restoreSourceBundle(bundle)).rejects.toThrow(/version|fields/);
  });

  it.each(['gap', 'overlap', 'truncated', 'wrong-length'])('rejects layout %s', async issue => {
    const bundle = clone(await sample());
    if (issue === 'gap') bundle.layout[1].from++;
    if (issue === 'overlap') bundle.layout[1].from--;
    if (issue === 'truncated') bundle.layout.pop();
    if (issue === 'wrong-length' && bundle.layout[0].kind === 'prose') bundle.layout[0].raw += '!';
    await expect(restoreSourceBundle(bundle)).rejects.toThrow(/gap|overlap|coverage|length/);
  });

  it.each(['composition', 'dependencies', 'reference-value', 'reference-map'])('rejects tampered %s even when raw source remains intact', async field => {
    const bundle = clone(await sample());
    if (field === 'composition') bundle.bindings[2].syntax.parts.reverse();
    if (field === 'dependencies') bundle.bindings[2].syntax.dependencies.pop();
    if (field === 'reference-value') bundle.references[0].value += 'tampered';
    if (field === 'reference-map') bundle.references[0].valueOffsets[1]++;
    await expect(restoreSourceBundle(bundle)).rejects.toThrow('semantics disagree');
  });

  it('rejects changed raw source, including different lone surrogates with identical UTF-8 replacement bytes', async () => {
    for (const [before, after] of [['original', 'changed!'], ['\ud800', '\udfff']]) {
      const bundle = clone(await sample(before));
      if (bundle.layout[0].kind !== 'prose') throw new Error('Expected prose fixture');
      bundle.layout[0].raw = after;
      await expect(restoreSourceBundle(bundle)).rejects.toThrow('source checksum mismatch');
    }
  });

  it('checks metadata integrity separately from source semantics', async () => {
    const bundle = clone(await sample());
    bundle.note.id = 'different-owner';
    await expect(restoreSourceBundle(bundle)).rejects.toThrow('bundle checksum mismatch');
  });

  it('rejects incomplete managed syntax rather than publishing a partial summary', async () => {
    await expect(sample('@A = <|ok|>\n@B = <|incomplete')).rejects.toThrow('malformed managed syntax');
    await expect(sample('[[@A|bad\\q]]')).rejects.toThrow('malformed managed syntax');
  });

  it('snapshots incoming data before asynchronous checks and serializes deterministically', async () => {
    const first = await sample();
    const second = await sample();
    expect(serializeSourceBundle(first)).toBe(serializeSourceBundle(second));
    const pending = restoreSourceBundle(first);
    first.note.id = 'mutated-after-call';
    expect((await pending).bundle.note.id).toBe('note-one');
  });

  it('round trips 80 deterministic free-placement notes with Unicode and mixed EOLs', async () => {
    let seed = 0x534f5552;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    const fragments = ['🙂', '漢字', '\r', '\n', '\r\n', '[x](:ref:Y)', '[[@Z|nested]]', 'a|>b', '\\', '  ', '<||>'];
    for (let sampleIndex = 0; sampleIndex < 80; sampleIndex++) {
      let value = '';
      for (let index = 0; index < 15; index++) value += fragments[random() % fragments.length];
      const source = 'Prefix ' + serializeBinding('X', [{ kind: 'literal', value }]) + '; suffix\r\n'
        + serializeBinding('Y', [{ kind: 'identifier', name: 'X' }, { kind: 'identifier', name: 'X' }]) + '\n'
        + 'Before ' + serializeReference({ kind: sampleIndex % 2 ? 'wiki' : 'pure', identifier: 'Y', value: value + value }) + ' after\r';
      const restored = await restoreSourceBundle(await sample(source));
      expect(restored.source).toBe(source);
      expect(restored.parsed.bindings[1].dependencies).toEqual(['X', 'X']);
      expect(restored.parsed.references[0].value).toBe(value + value);
    }
  });
});

describe('source bundle Markdown reading representation', () => {
  it('emits real relative links/heading anchors and independently restorable metadata', async () => {
    const bundle = await sample();
    const output = await exportSourceBundleMarkdown(bundle, { filePath: 'Notes/Readable Example.md',
      renderedBindings: [{ slot: 'binding-slot-3', sourceRevision: 42, status: 'ok', value: 'apple + apple' }] });
    const tree = markdownParser.parse(output.markdown);
    const topHeadings: string[] = [];
    const destinations: string[] = [];
    tree.iterate({ enter(node) {
      if (node.name === 'ATXHeading2' && node.node.parent?.name === 'Document') topHeadings.push(output.markdown.slice(node.from, node.to));
      if (node.name === 'URL') destinations.push(output.markdown.slice(node.from, node.to));
    } });
    expect(topHeadings).toEqual(['## Note', ...output.locations.map(location => `## ${location.anchor}`)]);
    expect(output.sourceBundlePath).toBe('Notes/Readable Example.source.json');
    expect(destinations).toContain('Readable%20Example.source.json');
    for (const location of output.locations) {
      expect(destinations).toContain(`Readable%20Example.md#${location.anchor}`);
      expect(output.markdown.slice(location.from, location.to)).toMatch(new RegExp(`^## ${location.anchor}`));
    }
    expect(output.markdown).toContain('> apple + apple');
    expect(output.markdown).toContain('> Before [Definition: Fruit]');
    expect(output.markdown).toContain(' suffix');
    expect((await restoreSourceBundle(output.sourceBundleJson)).source).toBe(sourceFixture());
  });

  it.each(['', 'first\n\nsecond', 'a]b|c\\', '```\nunclosed code', '> quote\n\n- list\n\n| A | B |\n| --- | --- |\n| x | y |'])
    ('keeps readable complete value blocks and section boundaries for %j', async value => {
      const source = serializeBinding('X', [{ kind: 'literal', value }]) + '\n'
        + serializeReference({ kind: 'wiki', identifier: 'X', value });
      const output = await exportSourceBundleMarkdown(await sample(source), { filePath: 'readable.md' });
      const tree = markdownParser.parse(output.markdown);
      const headings: string[] = [];
      tree.iterate({ enter(node) {
        if (node.name === 'ATXHeading2' && node.node.parent?.name === 'Document') headings.push(output.markdown.slice(node.from, node.to));
      } });
      expect(headings).toEqual(['## Note', ...output.locations.map(location => `## ${location.anchor}`)]);
      const restored = await restoreSourceBundle(output.sourceBundleJson);
      expect(restored.parsed.references[0].value).toBe(value);
      if (value === '') expect(output.markdown).toContain('*(empty value)*');
      else expect(output.markdown).toContain(value.split(/\r\n|\r|\n/).map(line => `> ${line}`).join('\n'));
    });

  it('does not invent a resolved composition or choose among duplicate names', async () => {
    const source = '@X = <|one|>\n@X = <|two|>\n@Y = X + X\n[cached](:ref:X)';
    const output = await exportSourceBundleMarkdown(await sample(source), { filePath: 'reading.md' });
    expect(output.markdown).toContain('not evaluated in this source-only bundle');
    expect(output.markdown).toContain('X (ambiguous definitions)');
    expect(output.locations.filter(location => location.kind === 'binding')).toHaveLength(3);
  });

  it.each(['<!--\nunclosed comment', '<script>\nalert("test")', '<div>\nraw block'])
    ('renders unclosed HTML as literal text without losing later sections: %j', async value => {
      const source = serializeBinding('X', [{ kind: 'literal', value }]) + '\r\n'
        + serializeReference({ kind: 'pure', identifier: 'X', value }) + '\n\n' + value;
      const output = await exportSourceBundleMarkdown(await sample(source), { filePath: 'reading.md' });
      const html: string[] = [];
      const headings: string[] = [];
      markdownParser.parse(output.markdown).iterate({ enter(node) {
        if (/HTML|CommentBlock|ProcessingInstructionBlock/.test(node.name)) html.push(node.name);
        if (node.name === 'ATXHeading2' && node.node.parent?.name === 'Document') headings.push(output.markdown.slice(node.from, node.to));
      } });
      expect(html).toEqual([]);
      expect(headings).toEqual(['## Note', ...output.locations.map(location => `## ${location.anchor}`)]);
      expect(output.markdown).toContain('> ' + value.replace(/&/g, '&amp;').replace(/</g, '&lt;').split('\n')[0]);
      expect(output.markdown).not.toContain(value.split('\n')[0]);
      const restored = await restoreSourceBundle(output.sourceBundleJson);
      expect(restored.source).toBe(source);
      expect(restored.parsed.references[0].value).toBe(value);
    });

  it('escapes raw inline HTML while leaving real fenced/inline code contents unchanged', async () => {
    const value = '`<script>&literal</script>` and <span title="&amp;">&amp;</span>\n\n```html\n<!--\n<script>\n<div>\n```';
    const source = serializeBinding('X', [{ kind: 'literal', value }]);
    const output = await exportSourceBundleMarkdown(await sample(source), { filePath: 'reading.md' });
    expect(output.markdown).toContain('`<script>&literal</script>` and &lt;span title="&amp;amp;">&amp;&lt;/span>');
    expect(output.markdown).toContain('> ```html\n> <!--\n> <script>\n> <div>\n> ```');
    expect((await restoreSourceBundle(output.sourceBundleJson)).source).toBe(source);
  });

  it('keeps generic user headings separate from deterministic source-specific anchors', async () => {
    const source = '# grasp-binding-1\n\n@X = <|value|>\n[value](:ref:X)';
    const bundle = await sample(source);
    const first = await exportSourceBundleMarkdown(bundle, { filePath: 'reading.md' });
    const second = await exportSourceBundleMarkdown(bundle, { filePath: 'reading.md' });
    expect(first.markdown).toBe(second.markdown);
    expect(first.locations.every(location => location.anchor !== 'grasp-binding-1')).toBe(true);
    expect(first.markdown).toContain('> # grasp-binding-1');
  });

  it('rejects stale rendered observations and unsafe output paths', async () => {
    const bundle = await sample();
    await expect(exportSourceBundleMarkdown(bundle, { filePath: 'reading.md',
      renderedBindings: [{ slot: 'binding-slot-1', sourceRevision: 41, status: 'ok', value: 'old' }] })).rejects.toThrow('stale');
    for (const filePath of ['../outside.md', '/absolute.md', 'C:\\file.md', 'path//file.md', 'file.md#anchor']) {
      await expect(exportSourceBundleMarkdown(bundle, { filePath })).rejects.toThrow('relative Markdown file path');
    }
  });
});
