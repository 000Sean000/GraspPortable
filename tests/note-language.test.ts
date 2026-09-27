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

  it('bounds repeated context reparsing for a chain of fake fences and reports the limit', () => {
    const source = Array.from({ length: 30 }, (_, index) => `@A${index} = ${serializeRawLiteral('```\nopaque')}`).join('\n\n');
    const parsed = parseNoteLanguage(source);
    expect(parsed.contextPasses).toBeLessThanOrEqual(8);
    expect(parsed.contextsComplete).toBe(false);
    expect(parsed.diagnostics.some(d => d.code === 'context-pass-limit')).toBe(true);
    expect(parsed.bindings).toEqual([]);
    expect(parsed.references).toEqual([]);
  });

  it('handles a substantial ordinary note in a bounded number of host passes', () => {
    const source = Array.from({ length: 5_000 }, (_, index) => `@A${index} = <|value ${index}|>\n[cached](:ref:A${index})`).join('\n\n');
    const parsed = parseNoteLanguage(source);
    expect(parsed.bindings).toHaveLength(5_000);
    expect(parsed.references).toHaveLength(5_000);
    expect(parsed.contextsComplete).toBe(true);
    expect(parsed.contextPasses).toBe(2);
  });
});
