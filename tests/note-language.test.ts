import { describe, expect, it } from 'vitest';
import { parseNoteLanguage } from '../src/domain/note-language';
import { serializeBinding, serializeRawLiteral } from '../src/domain/binding-language';
import { serializeReference } from '../src/domain/reference-language';

describe('note semantic context adapter', () => {
  it.each(['@A = <|x|>', '# @A = <|x|>', '- @A = <|x|>', '> @A = <|x|>'])
    ('recognizes bindings in ordinary host context %s', source => {
      const parsed = parseNoteLanguage(source, 17);
      expect(parsed.bindings.map(binding => binding.name)).toEqual(['A']);
      expect(parsed.contextsComplete).toBe(true);
      expect(parsed).toMatchObject({ source, revision: 17 });
      expect(source.slice(parsed.bindings[0].from, parsed.bindings[0].to)).toBe('@A = <|x|>');
    });

  it.each([
    '[x](:ref:A)', '# [x](:ref:A)', '- [x](:ref:A)', '> [x](:ref:A)',
    '| Value |\n| --- |\n| [x](:ref:A) |',
  ])('recognizes references without exposing a host AST: %s', source => {
    const parsed = parseNoteLanguage(source);
    expect(parsed.references.map(reference => reference.identifier)).toEqual(['A']);
    expect(parsed.contextsComplete).toBe(true);
  });

  it.each([
    '```md\n@A = <|x|>\n[x](:ref:A)\n```',
    '~~~\n@A = <|x|>\n[x](:ref:A)\n~~~',
    '`@A = <|x|>` and `[x](:ref:A)`',
    '    @A = <|x|>\n    [x](:ref:A)',
    '> ```\n> @A = <|x|>\n> [x](:ref:A)\n> ```',
    '- list\n\n      @A = <|x|>\n      [x](:ref:A)',
  ])('keeps true Markdown code inert: %s', source => {
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings).toEqual([]);
    expect(parsed.references).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.excluded.some(range => range.kind === 'code')).toBe(true);
  });

  it('honors escaped openers without normalizing the source', () => {
    const source = '\\@A = <|x|> \\[x](:ref:A) \\[[@A|x]]\n\\\\@B = <|y|>';
    expect(parseNoteLanguage(source).bindings.map(node => node.name)).toEqual(['B']);
    expect(parseNoteLanguage(source).references).toEqual([]);
  });

  it('hides literal/cache internals and recovers prose behind fake fences', () => {
    const first = serializeBinding('A', [{ kind: 'literal', value: '```\n@Hidden = <||>\n[x](:ref:Hidden)' }]);
    const cached = serializeReference({ kind: 'wiki', identifier: 'A', value: '~~~\n@AlsoHidden = <||>\n[z](:ref:Hidden)' });
    const source = `${first}\n\n${cached}\n\n@B = A\n[visible](:ref:B)`;
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings.map(node => node.name)).toEqual(['A', 'B']);
    expect(parsed.references.map(node => node.identifier)).toEqual(['A', 'B']);
    expect(parsed.bindings[0].dependencies).toEqual([]);
    expect(parsed.references[0].value).toBe('~~~\n@AlsoHidden = <||>\n[z](:ref:Hidden)');
    expect(parsed.contextsComplete).toBe(true);
    expect(parsed.contextPasses).toBeLessThanOrEqual(4);
  });

  it('never promotes a candidate whose opener is inside real code even if it crosses the closing fence', () => {
    const source = '```\n@Hidden = <|\n```\n|>\n\n@Visible = <|safe|>';
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings.map(node => node.name)).toEqual(['Visible']);
  });

  it('does not publish nested semantics exposed by a stale fence mask', () => {
    const source = '@A = <|\n~~~\n|>\n\n@B = <|\n~~~\n[inner](:ref:X)\n@Inner = <||>\n|>\n';
    const parsed = parseNoteLanguage(source);
    expect(parsed.contextsComplete).toBe(true);
    expect(parsed.bindings.map(node => node.name)).toEqual(['A', 'B']);
    expect(parsed.references).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('does not turn same-line trailing semantics into indented code when shielding earlier nodes', () => {
    const source = '@A = <|xxxxxxxxxx|>; [one](:ref:A) [two](:ref:A)';
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings.map(node => node.name)).toEqual(['A']);
    expect(parsed.references.map(node => node.value)).toEqual(['one', 'two']);
    expect(parsed.contextsComplete).toBe(true);
  });

  it.each([
    '---\nsetting: @A = <|x|>\n---\n\n@Visible = <|y|>',
    '<div data-value="@A = <|x|>">\n[x](:ref:A)\n</div>\n\n@Visible = <|y|>',
    '<span title="@A = <|x|>">text</span>\n\n@Visible = <|y|>',
    '[normal](https://example.com/\"@A=<||>\")\n\n@Visible = <|y|>',
  ])('conservatively excludes metadata/HTML/URLs with a policy diagnostic: %s', source => {
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings.map(node => node.name)).toEqual(['Visible']);
    expect(parsed.references).toEqual([]);
    expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'context-excluded')).toBe(true);
  });

  it('does not strip quote prefixes inside an exact multiline cached value', () => {
    const source = '> [first\n> second](:ref:A)';
    expect(parseNoteLanguage(source).references[0].value).toBe('first\n> second');
  });

  it('preserves ordinary malformed brackets without suppressing later bindings', () => {
    expect(parseNoteLanguage('[ordinary unclosed prose\n@A = <|x|>').bindings.map(node => node.name)).toEqual(['A']);
  });

  it('keeps unclosed raw literals opaque instead of harvesting later apparent bindings', () => {
    const parsed = parseNoteLanguage('@A = <|\nunfinished\n@B = <||>');
    expect(parsed.bindings).toEqual([]);
    expect(parsed.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['literal-unclosed']);
  });

  it.each(['\n', '\r\n', '\r'])('keeps host context and raw ranges correct with %j line endings', eol => {
    const source = ['```', '@Hidden = <|x|>', '```', '', '@Visible = <|y|>', '[y](:ref:Visible)'].join(eol);
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings.map(node => node.name)).toEqual(['Visible']);
    expect(parsed.references.map(node => node.identifier)).toEqual(['Visible']);
    expect(source.slice(parsed.bindings[0].from, parsed.bindings[0].to)).toBe('@Visible = <|y|>');
  });

  it('does not let frontmatter fences mask the note after its closing delimiter', () => {
    const source = '---\nexample: ```\n```\n---\n\n@A = <|safe|>';
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings.map(node => node.name)).toEqual(['A']);
    expect(parsed.excluded[0]).toMatchObject({ from: 0, kind: 'metadata' });
  });

  it('retains real exclusions and container behavior when retiring closed source prefixes', () => {
    const chain = Array.from({ length: 30 }, (_, index) => `> @A${index} = ${serializeRawLiteral('~~~\nopaque')}`).join('\n\n');
    const source = '`@Before = <||>`\n\n' + chain + '\n\n> ```\n> @Hidden = <||>\n> ```\n\n@Last = <|ok|>';
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings.map(node => node.name)).toEqual([...Array.from({ length: 30 }, (_, index) => `A${index}`), 'Last']);
    expect(parsed.excluded.filter(range => range.kind === 'code')).toHaveLength(2);
    expect(parsed.diagnostics).toEqual([]);
  });

  it.each([30, 300, 3000])('accepts %i fake-fence units without blank separators or repeated growing-leaf scans', count => {
    const source = Array.from({ length: count }, (_, index) => `@A${index} = ${serializeRawLiteral('```\nopaque')}`).join('\n');
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings).toHaveLength(count);
    expect(parsed.hostCharactersRead).toBeLessThan(source.length * 10);
    expect(parsed.contextPasses).toBe(2);
  });

  it('returns to host rules when the next candidate could start an indented code block', () => {
    const source = '@A = <|x|>\n\n    @Hidden = <|y|>\n\n@B = <|z|>';
    expect(parseNoteLanguage(source).bindings.map(node => node.name)).toEqual(['A', 'B']);
  });

  it.each(['`', '<!--', '<span title="'])('does not activate a candidate inside a true host construct whose closer is beyond lookahead: %s', opener => {
    const closer = opener === '`' ? '`' : opener === '<!--' ? '-->' : '">';
    const source = opener + '\n@Hidden = <|x|>\n[hidden](:ref:A)\n' + 'ordinary line\n'.repeat(2000) + closer + '\n\n@Visible = <|y|>';
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings.map(node => node.name)).toEqual(['Visible']);
    expect(parsed.references).toEqual([]);
  });

  it('handles many nodes in one physical paragraph without restarting host context', () => {
    const source = Array.from({ length: 5000 }, (_, index) => `@A${index} = <|x|>; [x](:ref:A${index})`).join(' ');
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings).toHaveLength(5000);
    expect(parsed.references).toHaveLength(5000);
    expect(parsed.contextPasses).toBe(2);
    expect(parsed.hostCharactersRead).toBeLessThan(source.length * 5);
  });

  it.each([30, 300, 3000])('handles %i fake-fence units through incremental host subtrees', count => {
    const source = Array.from({ length: count }, (_, index) => `@A${index} = ${serializeRawLiteral('```\nopaque')}`).join('\n\n');
    const parsed = parseNoteLanguage(source);
    expect(parsed.contextsComplete).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.bindings).toHaveLength(count);
    expect(parsed.references).toEqual([]);
    expect(parsed.hostCharactersRead).toBeLessThan(source.length * 30);
    expect(parsed.bindings.at(-1)?.name).toBe(`A${count - 1}`);
  });

  it('handles a substantial ordinary note in a bounded number of host passes', () => {
    const source = Array.from({ length: 5_000 }, (_, index) => `@A${index} = <|value ${index}|>\n[cached](:ref:A${index})`).join('\n\n');
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings).toHaveLength(5_000);
    expect(parsed.references).toHaveLength(5_000);
    expect(parsed.contextsComplete).toBe(true);
    expect(parsed.contextPasses).toBeLessThan(50);
    expect(parsed.hostCharactersRead).toBeLessThan(source.length * 15);
  });
});
