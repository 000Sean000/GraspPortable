import { describe, expect, it } from 'vitest';
import {
  isQualifiedIdentifier, parseBindingAt, parseRawLiteral, scanBindings,
  serializeBinding, serializeRawLiteral, type BindingNode, type RawLiteralNode,
} from '../src/domain/binding-language';

function literal(source: string, from = 0): RawLiteralNode {
  const parsed = parseRawLiteral(source, from);
  if (!parsed.ok) throw new Error(`${parsed.diagnostic.code}: ${JSON.stringify(source)}`);
  expect(parsed.node.raw).toBe(source.slice(parsed.node.from, parsed.node.to));
  expect(parsed.node.value).toBe(source.slice(parsed.node.contentRange.from, parsed.node.contentRange.to));
  return parsed.node;
}
function binding(source: string, from = 0): BindingNode {
  const parsed = parseBindingAt(source, from);
  if (!parsed.ok) throw new Error(`${parsed.diagnostic.code}: ${JSON.stringify(source)}`);
  return parsed.node;
}
function roundtrip(value: string): void {
  const source = serializeRawLiteral(value);
  const node = literal(source);
  if (node.value !== value || node.to !== source.length) {
    throw new Error(`Literal roundtrip: ${JSON.stringify({ value, source, node })}`);
  }
}

describe('raw literal grammar', () => {
  it.each([
    ['<||>', '', 1, 'compact'], ['<||||>', '', 2, 'compact'],
    ['<||x||>', 'x', 2, 'compact'], ['<|a ||> b|>', 'a ||> b', 1, 'compact'],
    ['<||a |> b||>', 'a |> b', 2, 'compact'],
    ['<|"Q" + Fruit = \\path|>', '"Q" + Fruit = \\path', 1, 'compact'],
    ['<|\n|>', '', 1, 'block'], ['<|\n\nx\n\n|>', '\nx\n', 1, 'block'],
    ['<|\r\n\r\nx\r\n\r\n|>', '\r\nx\r\n', 1, 'block'],
    ['<|\nx\r\r\n|>', 'x\r', 1, 'block'],
    ['<|\r\t a  \rb\r\t |>', '\t a  \rb', 1, 'block'],
    ['<|\n  a\n\tb\n    |>', '  a\n\tb', 1, 'block'],
  ] as const)('reads %j exactly', (source, value, level, style) => {
    expect(literal(source)).toMatchObject({ value, level, style, from: 0, to: source.length });
  });

  it('does not mistake longer pipe runs or their suffix for a closer', () => {
    expect(literal('<|a ||||||> b|>').value).toBe('a ||||||> b');
    expect(parseRawLiteral('<||a |||>')).toMatchObject({ ok: false, diagnostic: { code: 'literal-unclosed' } });
  });

  it('treats binding, fence and reference spellings inside a literal as opaque', () => {
    const source = '@A = <|\n```\n@B = <||>\n[[@C|cached]]\n```\n|>\n@D = A';
    const parsed = scanBindings(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.bindings.map(node => node.name)).toEqual(['A', 'D']);
    expect(parsed.bindings[0].dependencies).toEqual([]);
  });

  it('preserves Unicode and uses raw UTF-16 offsets', () => {
    const source = '🧭 前言：@A = <|😀\ud800|>; 後文';
    const node = binding(source, source.indexOf('@'));
    const part = node.parts[0] as RawLiteralNode;
    expect(source.slice(node.nameRange.from, node.nameRange.to)).toBe('A');
    expect(part.value).toBe('😀\ud800');
    expect(part.contentRange.to - part.contentRange.from).toBe(3);
    expect(source.slice(node.to)).toBe(' 後文');
  });

  it('has explicit unclosed/newline errors and never guesses a later binding as the literal end', () => {
    const source = '@A = <|\nunclosed\n@B = <||>\n';
    expect(scanBindings(source)).toMatchObject({ bindings: [], diagnostics: [{ code: 'literal-unclosed' }] });
    expect(parseRawLiteral('<|a\nb|>')).toMatchObject({ ok: false, diagnostic: { code: 'literal-inline-newline' } });
  });

  it('selects collision-free levels and protects leading/trailing pipes', () => {
    expect(serializeRawLiteral('')).toBe('<||>');
    expect(serializeRawLiteral('apple')).toBe('<|apple|>');
    expect(serializeRawLiteral('|apple|')).toBe('<|\n|apple|\n|>');
    expect(serializeRawLiteral('a |> b')).toBe('<||\na |> b\n||>');
    const value = Array.from({ length: 100 }, (_, i) => '|'.repeat(i + 1) + '>').join('\n');
    expect(literal(serializeRawLiteral(value))).toMatchObject({ level: 101, value });
  });

  it('roundtrips every short delimiter/EOL combination (10-symbol alphabet, lengths 0–4)', () => {
    const alphabet = ['<', '>', '|', '[', ']', '\\', ' ', '\r', '\n', 'x'];
    let cases = 0;
    function visit(value: string, remaining: number): void {
      roundtrip(value); cases++;
      if (remaining) for (const char of alphabet) visit(value + char, remaining - 1);
    }
    visit('', 4);
    expect(cases).toBe(11_111);
  });

  it('roundtrips fixed-seed long Unicode/mixed-EOL values (seed 0x47524153, 1000 cases)', () => {
    let state = 0x47524153;
    const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
    const chunks = ['😀', '中文', '\ud800', '\udc00', '\r', '\n', '\r\n', '|>', '||>', '<|', '\\', '\t', ' ', '[[@X|v]]', '@A =', '```', 'abc'];
    for (let index = 0; index < 1000; index++) {
      const size = random() % 100;
      let value = '';
      for (let part = 0; part < size; part++) value += chunks[random() % chunks.length];
      roundtrip(value);
    }
  });

  it('handles huge pipe runs and an unclosed opaque body without recursive or repeated rescans', () => {
    const pipes = '|'.repeat(200_000);
    expect(literal('<' + pipes + '>')).toMatchObject({ value: '', level: 100_000 });
    const source = '@A = <|\n' + '@Candidate = <||>\n'.repeat(20_000);
    expect(scanBindings(source)).toMatchObject({ bindings: [], diagnostics: [{ code: 'literal-unclosed', to: source.length }] });
  });
});

describe('binding statements and composition', () => {
  it('retains ordered fragments and repeated dependencies', () => {
    const source = '@Slogan = <|An |> + Fruit + <| a day |> + Person.Job + Fruit';
    const node = binding(source);
    expect(node.dependencies).toEqual(['Fruit', 'Person.Job', 'Fruit']);
    expect(node.parts.map(part => part.kind === 'literal' ? part.value : part.name))
      .toEqual(['An ', 'Fruit', ' a day ', 'Person.Job', 'Fruit']);
    expect(node.raw).toBe(source);
    for (const part of node.parts) expect(source.slice(part.from, part.to)).toBe(part.kind === 'literal' ? part.raw : part.name);
  });

  it('continues only after = or trailing +; ordinary next-line list stays outside', () => {
    const source = '@A =\r\n<|x|> +\rB\n+ unrelated item\n@C = <|z|>';
    const parsed = scanBindings(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.bindings.map(node => node.name)).toEqual(['A', 'C']);
    expect(parsed.bindings[0].dependencies).toEqual(['B']);
    expect(parsed.bindings[0].raw).toBe('@A =\r\n<|x|> +\rB');
  });

  it('ends at a semicolon or next complete binding while preserving neighboring prose', () => {
    const source = '說明：@A = <|x|>; 後文 @B = <|y|> @C = B';
    const parsed = scanBindings(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.bindings.map(node => node.raw)).toEqual(['@A = <|x|>;', '@B = <|y|>', '@C = B']);
    expect(source.slice(parsed.bindings[0].to, parsed.bindings[1].from)).toBe(' 後文 ');
  });

  it.each(['@A =', '@A = <|x|> +', '@A = <|x|> +\r\n', '@A = ;', '@A = @B = <|y|>'])
    ('does not publish an incomplete expression %j', source => {
      expect(parseBindingAt(source)).toMatchObject({ ok: false, diagnostic: { code: 'binding-missing-atom' } });
    });

  it.each(['@A = First Last', '@A = <|x|> <|y|>', '@A = <|x|> prose'])
    ('requires explicit same-line operators and prose separators %j', source => {
      expect(parseBindingAt(source)).toMatchObject({ ok: false, diagnostic: { code: 'binding-missing-separator' } });
    });

  it('recovers monotonically at an independent next binding after a missing atom', () => {
    expect(scanBindings('@A =\n@B = <|safe|>')).toMatchObject({
      bindings: [{ name: 'B' }], diagnostics: [{ code: 'binding-missing-atom' }],
    });
  });

  it('ignores email/name interiors and keeps candidate versioned identifiers strict', () => {
    expect(scanBindings('person@A = <|x|> 字@B = <|y|> 𐐀@C = <|z|> e\u0301@D = <|z|> @E-F = <|z|>').bindings).toEqual([]);
    for (const valid of ['A', '_a', 'Person.Job', 'Name_2.Sub3']) expect(isQualifiedIdentifier(valid)).toBe(true);
    for (const invalid of ['a-b', '@A', '.A', 'A.', 'A..B', '2A', 'A.2B']) expect(isQualifiedIdentifier(invalid)).toBe(false);
  });

  it('serializes bindings without losing composition or raw values', () => {
    const parts = [
      { kind: 'literal' as const, value: '\n|first|\r' },
      { kind: 'identifier' as const, name: 'Fruit' },
      { kind: 'literal' as const, value: '😀 a |> b ||>\r\n' },
      { kind: 'identifier' as const, name: 'Fruit' },
    ];
    const node = binding(serializeBinding('Person.Job', parts));
    expect(node.parts.map(part => part.kind === 'literal' ? { kind: part.kind, value: part.value } : { kind: part.kind, name: part.name })).toEqual(parts);
    expect(node.dependencies).toEqual(['Fruit', 'Fruit']);
    expect(() => serializeBinding('A', [])).toThrow();
    expect(() => serializeBinding('a-b', parts)).toThrow();
  });
});
