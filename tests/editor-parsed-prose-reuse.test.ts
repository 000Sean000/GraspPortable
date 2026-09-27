import { describe, expect, it } from 'vitest';
import { parseNoteLanguage, type ParsedNoteLanguage } from '../src/domain/note-language';
import { serializeBinding } from '../src/domain/binding-language';
import { serializeReference } from '../src/domain/reference-language';
import { reusePlainProseAppend } from '../src/editor/parsed-prose-reuse';

function semantics(parsed: ParsedNoteLanguage) {
  const { contextPasses: _passes, hostCharactersRead: _read, ...result } = parsed; return result;
}

describe('conservative plain-prose append reuse', () => {
  it('reuses only proven unchanged semantic structure and exact raw offsets', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const source = '@X = <|bold **value**|>' + eol + '[old](:ref:X)' + eol + eol + 'Typing area: ';
      const before = parseNoteLanguage(source, 4), after = source + '中é e\u0301 123';
      const reused = reusePlainProseAppend(before, after, 5)!;
      expect(reused).toBeDefined(); expect(semantics(reused)).toEqual(semantics(parseNoteLanguage(after, 5)));
      expect(reused.bindings).toBe(before.bindings); expect(reused.references).toBe(before.references);
      expect(before.source).toBe(source); expect(reused.source).toBe(after); expect(reused.hostCharactersRead).toBe(0);
    }
  });

  it('falls back for syntax, open contexts, incomplete statements, non-EOF edits and ambiguous paragraph joins', () => {
    const sources = [
      '@X = Ref', '@X = <|value', '@X = <|value\n\nTyping area: ',
      '[cache](:ref:X', '[[@X|cache', '[[@X|cache\n\nTyping area: ',
      '```\n\nTyping area: ', '<script>\n\nTyping area: ', '<!--\n\nTyping area: ',
      '---\nkey: value\n\nTyping area: ', 'paragraph\nTyping area: ', '    Typing area: ',
      '> Typing area: ', '- Typing area: ', '## Typing area: ', '[Typing area: ', '\\Typing area: ',
    ];
    for (const source of sources) expect(reusePlainProseAppend(parseNoteLanguage(source), source + '中', 1), source).toBeUndefined();
    const source = '@X = <|value|>\n\nTyping area: ', previous = parseNoteLanguage(source);
    for (const inserted of ['\n', '\r', '@', '[', ']', '<', '>', '`', '*', '_', '|', '\\', '"', '!', '#', '=', ':', '.', '-']) {
      expect(reusePlainProseAppend(previous, source + inserted, 1), inserted).toBeUndefined();
    }
    expect(reusePlainProseAppend(previous, source.replace('value', 'other') + '中', 1)).toBeUndefined();
    expect(reusePlainProseAppend(previous, source.slice(0, -1), 1)).toBeUndefined();
  });

  it('matches a full parse across seeded prefixes, mixed EOLs, opaque values and successive Unicode appends', () => {
    let seed = 0x17bb4455;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const contexts = ['# Heading', '- list\n  continuation', '> quote', '| A | B |\n|---|---|\n| a | b |', '```js\nconst x = "@Ignored = <|v|>"\n```', '<!-- comment -->', '[site](https://example.test)', '[id]: https://example.test', 'prose `code` and **bold**', '\\@escaped'];
    const values = ['**value**', 'a\r\nb\nc\rd', '```\n@Fake = <|v|>\n```', '<script>\n<!--', '[[@Fake|hidden]]'];
    for (let sample = 0; sample < 90; sample++) {
      const eol = ['\n', '\r\n', '\r'][random() % 3];
      const prefix = Array.from({ length: 1 + random() % 5 }, () => contexts[random() % contexts.length].replace(/\n/g, eol)).join(eol + eol);
      const value = values[random() % values.length];
      let source = prefix + eol + eol + serializeBinding('X', [{ kind: 'literal', value }]) + eol + eol
        + serializeReference({ kind: sample % 2 ? 'pure' : 'wiki', identifier: 'X', value }) + eol + eol + 'Typing area: ';
      let previous = parseNoteLanguage(source, sample);
      for (const insertion of ['中', 'abc', 'é', ' ', 'e\u0301', '123']) {
        source += insertion;
        const reused = reusePlainProseAppend(previous, source, sample + 1);
        const full = parseNoteLanguage(source, sample + 1);
        // Conservative exclusions may reject a candidate. Every admitted fast
        // path must preserve all syntax, diagnostics and Markdown context ranges.
        if (reused) expect(semantics(reused), `sample ${sample}`).toEqual(semantics(full));
        previous = reused ?? full;
      }
    }
  });
});
