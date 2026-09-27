/** Versioned lexical codec. Markdown context/ownership is decided by its caller. */
export const REFERENCE_SYNTAX_VERSION = 'grasp-reference-v1' as const;
const QUALIFIED_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const NAME_CHARACTER = /[A-Za-z0-9_.]/;
const ESCAPABLE = new Set(['\\', '[', ']', '|']);

export type ReferenceKind = 'pure' | 'wiki';
export interface ReferenceValue {
  kind: ReferenceKind;
  identifier: string;
  value: string;
}
export interface ParsedReference extends ReferenceValue {
  syntaxVersion: typeof REFERENCE_SYNTAX_VERSION;
  from: number;
  to: number;
  nameFrom: number;
  nameTo: number;
  valueFrom: number;
  valueTo: number;
  raw: string;
  /** Absolute raw offset for every decoded UTF-16 boundary, including the end. */
  valueOffsets: number[];
}
export interface ReferenceDiagnostic {
  code: 'not-reference' | 'invalid-identifier' | 'invalid-separator' | 'invalid-escape'
    | 'unescaped-delimiter' | 'invalid-closer' | 'unterminated';
  from: number;
  to: number;
  offset: number;
  message: string;
  /** False for an ambiguous plain '[' candidate with no managed suffix yet. */
  managed: boolean;
}
export type ReferenceParseResult =
  | { ok: true; reference: ParsedReference; nextOffset: number }
  | { ok: false; diagnostic: ReferenceDiagnostic; nextOffset: number };

export function serializeReference(reference: ReferenceValue): string {
  if (!QUALIFIED_IDENTIFIER.test(reference.identifier)) throw new Error('Invalid qualified identifier');
  if (reference.kind !== 'pure' && reference.kind !== 'wiki') throw new Error('Invalid reference kind');
  const value = reference.value.replace(/[\\[\]|]/g, character => `\\${character}`);
  return reference.kind === 'pure'
    ? `[${value}](:ref:${reference.identifier})`
    : `[[@${reference.identifier}|${value}]]`;
}

/** Parse exactly at a raw UTF-16 offset; failure never searches for a later closer. */
export function parseReferenceAt(source: string, from = 0): ReferenceParseResult {
  if (!Number.isInteger(from) || from < 0 || from > source.length) throw new RangeError('Invalid source offset');
  const kind: ReferenceKind = source.startsWith('[[@', from) ? 'wiki' : 'pure';
  let managed = kind === 'wiki';
  const fail = (code: ReferenceDiagnostic['code'], offset: number, message: string, next = offset + 1): ReferenceParseResult => ({
    ok: false,
    diagnostic: { code, from, to: Math.min(source.length, Math.max(offset + 1, from)), offset, message, managed },
    nextOffset: Math.min(source.length, Math.max(from + 1, next)),
  });
  if (source[from] !== '[') return fail('not-reference', from, 'No reference opener');

  let index = from + 1;
  let nameFrom = -1;
  let nameTo = -1;
  let identifier = '';
  if (kind === 'wiki') {
    index = nameFrom = from + 3;
    while (index < source.length && NAME_CHARACTER.test(source[index])) index++;
    nameTo = index;
    identifier = source.slice(nameFrom, nameTo);
    if (!QUALIFIED_IDENTIFIER.test(identifier)) {
      return fail('invalid-identifier', index, 'Expected a qualified identifier', source[index] === '[' ? index : index + 1);
    }
    if (source[index] !== '|') {
      return fail('invalid-separator', index, 'Canonical wiki separator must be an unescaped pipe', source[index] === '[' ? index : index + 1);
    }
    index++;
  }
  const valueFrom = index;
  const valueOffsets = [index];
  const characters: string[] = [];
  let invalid: { code: 'invalid-escape' | 'unescaped-delimiter'; offset: number; message: string } | undefined;

  while (index < source.length) {
    const character = source[index];
    if (character === '[') {
      // Leave the new opener for the scanner. Do not re-scan the failed prefix.
      return fail('unescaped-delimiter', index, 'Unescaped opening bracket inside cached value', index);
    }
    if (character === ']') {
      const valueTo = index;
      let to: number;
      if (kind === 'wiki') {
        if (source[index + 1] !== ']') return fail('invalid-closer', index, 'Expected the second closing bracket');
        to = index + 2;
      } else {
        if (!source.startsWith('(:ref:', index + 1)) {
          return fail('not-reference', index, 'First closing bracket has no managed reference suffix');
        }
        managed = true;
        nameFrom = index + 7;
        index = nameFrom;
        while (index < source.length && NAME_CHARACTER.test(source[index])) index++;
        nameTo = index;
        identifier = source.slice(nameFrom, nameTo);
        if (!QUALIFIED_IDENTIFIER.test(identifier) || source[index] !== ')') {
          return fail('invalid-identifier', index, 'Expected a qualified identifier followed by a closing parenthesis', source[index] === '[' ? index : index + 1);
        }
        to = index + 1;
      }
      if (invalid) return fail(invalid.code, invalid.offset, invalid.message, to);
      return {
        ok: true,
        reference: { syntaxVersion: REFERENCE_SYNTAX_VERSION, kind, identifier, value: characters.join(''),
          from, to, nameFrom, nameTo, valueFrom, valueTo, raw: source.slice(from, to), valueOffsets },
        nextOffset: to,
      };
    }
    if (character === '\\') {
      const escaped = source[index + 1];
      if (!ESCAPABLE.has(escaped)) {
        invalid ??= { code: 'invalid-escape', offset: index, message: 'Only backslash, brackets and pipe can be escaped in a cached value' };
      }
      // Unknown escapes stay invalid; their characters never become a success.
      if (index + 1 >= source.length) break;
      characters.push(escaped);
      index += 2;
    } else {
      if (character === '|') invalid ??= { code: 'unescaped-delimiter', offset: index, message: 'Pipe in a cached value must be escaped' };
      characters.push(character);
      index++;
    }
    valueOffsets.push(index);
  }
  return invalid
    ? fail(invalid.code, invalid.offset, invalid.message, source.length)
    : fail('unterminated', source.length, 'Unterminated reference candidate', source.length);
}

/**
 * Monotonic lexical scan. Context exclusions and source revision belong to the caller.
 * Ambiguous incomplete '[' candidates have diagnostic.managed=false; callers decide
 * whether to show those diagnostics in ordinary prose. Complete ordinary links are ignored.
 */
export function scanReferences(source: string): { references: ParsedReference[]; diagnostics: ReferenceDiagnostic[] } {
  const references: ParsedReference[] = [];
  const diagnostics: ReferenceDiagnostic[] = [];
  for (let index = 0; index < source.length;) {
    // Honor escaped openers in ordinary source, without global unescaping.
    if (source[index] === '\\') { index += 2; continue; }
    if (source[index] !== '[') { index++; continue; }
    const result = parseReferenceAt(source, index);
    if (result.ok) references.push(result.reference);
    else if (result.diagnostic.code !== 'not-reference') diagnostics.push(result.diagnostic);
    index = result.nextOffset;
  }
  return { references, diagnostics };
}
