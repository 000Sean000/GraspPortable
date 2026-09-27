import { describe, expect, it } from 'vitest';
import { parseReferenceAt, scanReferences, serializeReference, type ReferenceKind } from '../src/domain/reference-language';

const kinds: ReferenceKind[] = ['pure', 'wiki'];
function roundTrip(value: string, kind: ReferenceKind) {
  const source = serializeReference({ kind, identifier: 'Person.Job', value });
  const result = parseReferenceAt(source);
  if (!result.ok) throw new Error(`Parse failure for ${JSON.stringify({ kind, value, source, diagnostic: result.diagnostic })}`);
  const node = result.reference;
  if (node.value !== value || node.identifier !== 'Person.Job' || node.kind !== kind || node.to !== source.length) {
    throw new Error(`Round trip failed for ${JSON.stringify({ kind, value, source, node })}`);
  }
  if (node.valueOffsets.length !== value.length + 1) throw new Error('Invalid UTF-16 map length');
  for (let index = 0; index < value.length; index++) {
    const segment = source.slice(node.valueOffsets[index], node.valueOffsets[index + 1]);
    const expected = /[\\[\]|]/.test(value[index]) ? `\\${value[index]}` : value[index];
    if (segment !== expected) throw new Error(`Invalid mapping for ${JSON.stringify({ value, index, segment, expected })}`);
  }
  return node;
}

describe('managed reference lexical contract', () => {
  it.each(kinds)('%s preserves empty and all EOL forms without trimming', kind => {
    for (const value of ['', ' ', '\n', '\r', '\r\n', '\n\nfirst\r\n\rsecond\n', ' first\n\nsecond ', '\t\r\n']) {
      const node = roundTrip(value, kind);
      expect(node.value).toBe(value);
      expect(node.valueOffsets.at(-1)).toBe(node.valueTo);
    }
  });

  it.each(kinds)('%s escapes only value delimiters and keeps Markdown opaque', kind => {
    const value = '[[@Fake|nested]] and [label](:ref:Other)\n\n@Binding = <|x|>\n```\ncode\n```\n\\q\t|[]';
    const node = roundTrip(value, kind);
    const scanned = scanReferences(node.raw);
    expect(scanned.diagnostics).toEqual([]);
    expect(scanned.references.map(reference => reference.identifier)).toEqual(['Person.Job']);
    expect(scanned.references[0].value).toBe(value);
  });

  it('provides absolute raw UTF-16 ranges and decoded boundary mappings', () => {
    const prefix = '🙂前文\r\n';
    const source = prefix + '[a\\]🙂\r\n\\|\\\\](:ref:X.Y)' + ' 後文';
    const result = parseReferenceAt(source, prefix.length);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = result.reference;
    expect(node.value).toBe('a]🙂\r\n|\\');
    expect(source.slice(node.from, node.to)).toBe(node.raw);
    expect(source.slice(node.nameFrom, node.nameTo)).toBe('X.Y');
    expect(source.slice(node.valueFrom, node.valueTo)).toBe('a\\]🙂\r\n\\|\\\\');
    expect(node.valueOffsets).toEqual([7, 8, 10, 11, 12, 13, 14, 16, 18]);
    expect(source.slice(node.to)).toBe(' 後文');
  });

  it('keeps adjacent prose and independent references outside the exact span', () => {
    const source = '前 [](:ref:X) 後 [next](:ref:Y)\n[[@Z|]] trailing';
    const result = scanReferences(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.references.map(({ identifier, value }) => [identifier, value])).toEqual([['X', ''], ['Y', 'next'], ['Z', '']]);
    expect(result.references.map(reference => source.slice(reference.from, reference.to))).toEqual(['[](:ref:X)', '[next](:ref:Y)', '[[@Z|]]']);
  });

  it('does not seek a later managed suffix after an ordinary link closer', () => {
    const source = '[ordinary|label](https://example.test) stray](:ref:X) [good](:ref:Y)';
    const result = scanReferences(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.references.map(reference => reference.identifier)).toEqual(['Y']);
  });

  it.each([
    ['[bad\\q](:ref:X)', 'invalid-escape'],
    ['[bad|pipe](:ref:X)', 'unescaped-delimiter'],
    ['[bad [ok](:ref:Y)', 'unescaped-delimiter'],
    ['[[@X|bad] prose', 'invalid-closer'],
    ['[[@A..B|bad]]', 'invalid-identifier'],
    ['[bad](:ref:A..B)', 'invalid-identifier'],
    ['[bad](:ref:A-B)', 'invalid-identifier'],
    ['[[@A\\|bad]]', 'invalid-separator'],
  ])('rejects malformed %s and recovers at the next occurrence', (malformed, code) => {
    const source = malformed + ' [good](:ref:Next)';
    const result = scanReferences(source);
    expect(result.diagnostics[0].code).toBe(code);
    expect(result.references.at(-1)?.identifier).toBe('Next');
    expect(result.references.some(reference => reference.identifier === 'X')).toBe(false);
    expect(source).toBe(malformed + ' [good](:ref:Next)');
  });

  it('preserves unclosed and unknown-escape failures without partial success', () => {
    for (const source of ['[missing', '[[@X|missing', '[[@X|unknown\\q]]', '[unknown\\q](:ref:X)', '[trailing\\']) {
      const result = parseReferenceAt(source);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.nextOffset).toBe(source.length);
        expect(result.diagnostic.offset).toBeGreaterThanOrEqual(0);
      }
      expect(scanReferences(source).references).toEqual([]);
    }
  });

  it('does not treat escaped ordinary openers as active occurrences', () => {
    const result = scanReferences('\\[hidden](:ref:X) \\\\[visible](:ref:Y)');
    expect(result.references.map(reference => reference.identifier)).toEqual(['Y']);
  });

  it('accepts only explicit qualified identifiers and keeps case', () => {
    for (const identifier of ['X', '_', 'Person.Job', 'X_1.a2']) {
      const result = parseReferenceAt(serializeReference({ kind: 'pure', identifier, value: '' }));
      expect(result.ok && result.reference.identifier).toBe(identifier);
    }
    for (const identifier of ['', '@X', 'X-Y', 'X.', '.X', 'X..Y', '1X', '名']) {
      expect(() => serializeReference({ kind: 'pure', identifier, value: '' })).toThrow('Invalid qualified identifier');
    }
    expect(() => parseReferenceAt('[](:ref:X)', -1)).toThrow(RangeError);
    expect(() => parseReferenceAt('[](:ref:X)', 0.5)).toThrow(RangeError);
  });

  it('round trips every value of length 0–4 over a 10-character delimiter/EOL alphabet', () => {
    const alphabet = ['<', '>', '|', '[', ']', '\\', ' ', '\r', '\n', 'a'];
    let layer = [''];
    let count = 0;
    for (let length = 0; length <= 4; length++) {
      for (const value of layer) {
        for (const kind of kinds) roundTrip(value, kind);
        count++;
      }
      if (length < 4) layer = layer.flatMap(prefix => alphabet.map(character => prefix + character));
    }
    expect(count).toBe(11111);
  });

  it('round trips 750 deterministic longer Unicode and Markdown values (seed 0x47524153)', () => {
    let seed = 0x47524153;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    const fragments = ['🙂', '漢字', 'e\u0301', '\ud800', '\udfff', '\0', '\r\n', '\r', '\n', '[[@X|nested]]',
      '[x](:ref:Y)', '\\', '|', '<||x||>', '`code`', ' a ', '@X = <|x|>', '"quoted"', '\t'];
    for (let sample = 0; sample < 750; sample++) {
      const length = 1 + random() % 90;
      let value = '';
      for (let index = 0; index < length; index++) value += fragments[random() % fragments.length];
      for (const kind of kinds) roundTrip(value, kind);
    }
  });

  it('advances through 100,000 broken openers and a long unterminated value without rescanning suffixes', () => {
    const source = '['.repeat(100_000) + 'valid](:ref:X)' + '[[@Y|' + 'x'.repeat(300_000);
    const result = scanReferences(source);
    expect(result.references.map(reference => [reference.identifier, reference.value])).toEqual([['X', 'valid']]);
    expect(result.diagnostics).toHaveLength(100_000);
    expect(result.diagnostics.at(-1)?.code).toBe('unterminated');
  }, 5000);
});
