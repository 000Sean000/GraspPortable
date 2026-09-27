/** Versioned, context-free binding syntax. Markdown ownership is a separate adapter. */
export const BINDING_SYNTAX_VERSION = 1 as const;

export interface SourceRange { from: number; to: number }
export interface SyntaxDiagnostic extends SourceRange { code: string; message: string }
export type SyntaxResult<T> = { ok: true; node: T } | {
  ok: false; diagnostic: SyntaxDiagnostic; recoveryTo: number;
};
export interface RawLiteralNode extends SourceRange {
  kind: 'literal'; value: string; raw: string; level: number;
  style: 'compact' | 'block'; contentRange: SourceRange;
}
export interface IdentifierPart extends SourceRange { kind: 'identifier'; name: string }
export type BindingPart = RawLiteralNode | IdentifierPart;
export interface BindingNode extends SourceRange {
  kind: 'binding'; name: string; nameRange: SourceRange; raw: string;
  parts: BindingPart[]; dependencies: string[];
}
export type BindingInputPart = { kind: 'literal'; value: string } | { kind: 'identifier'; name: string };

const namePattern = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
export function isQualifiedIdentifier(name: string): boolean { return namePattern.test(name); }
const horizontal = (c: string | undefined) => c === ' ' || c === '\t';
const nameCharacter = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_.]/.test(c);
const nameStart = (c: string | undefined) => c !== undefined && /[A-Za-z_]/.test(c);
const eolLength = (source: string, at: number) => source[at] === '\r'
  ? (source[at + 1] === '\n' ? 2 : 1) : source[at] === '\n' ? 1 : 0;
const fail = (code: string, message: string, from: number, to: number, recoveryTo: number): SyntaxResult<never> =>
  ({ ok: false, diagnostic: { code, message, from, to }, recoveryTo });

/** All offsets address the original string in UTF-16 code units. No normalization. */
export function parseRawLiteral(source: string, from = 0): SyntaxResult<RawLiteralNode> {
  if (source[from] !== '<' || source[from + 1] !== '|') {
    return fail('literal-opener', 'Expected a raw literal opener.', from, Math.min(from + 1, source.length), from + 1);
  }
  let cursor = from + 1;
  while (source[cursor] === '|') cursor++;
  const run = cursor - from - 1;
  if (source[cursor] === '>' && run % 2 === 0) {
    const middle = from + 1 + run / 2;
    return { ok: true, node: { kind: 'literal', from, to: cursor + 1,
      raw: source.slice(from, cursor + 1), value: '', level: run / 2,
      style: 'compact', contentRange: { from: middle, to: middle } } };
  }
  const openerEnd = cursor;
  const openingEol = eolLength(source, cursor);
  const style = openingEol ? 'block' : 'compact';
  const contentFrom = cursor + openingEol;
  cursor = contentFrom;
  let lineStart = cursor;
  let indentationOnly = true;
  while (cursor < source.length) {
    const newline = eolLength(source, cursor);
    if (newline) {
      if (style === 'compact') {
        return fail('literal-inline-newline', 'A multiline raw literal needs an EOL immediately after its opener.',
          openerEnd, cursor + newline, source.length);
      }
      cursor += newline;
      lineStart = cursor;
      indentationOnly = true;
      continue;
    }
    if (source[cursor] === '|') {
      const pipesFrom = cursor;
      while (source[cursor] === '|') cursor++;
      if (cursor - pipesFrom === run && source[cursor] === '>' && (style === 'compact' || indentationOnly)) {
        let contentTo = style === 'compact' ? pipesFrom : lineStart;
        if (style === 'block' && contentTo > contentFrom) {
          if (source[contentTo - 1] === '\n') {
            contentTo--;
            if (contentTo > contentFrom && source[contentTo - 1] === '\r') contentTo--;
          } else if (source[contentTo - 1] === '\r') contentTo--;
        }
        contentTo = Math.max(contentFrom, contentTo);
        return { ok: true, node: { kind: 'literal', from, to: cursor + 1,
          raw: source.slice(from, cursor + 1), value: source.slice(contentFrom, contentTo), level: run,
          style, contentRange: { from: contentFrom, to: contentTo } } };
      }
      indentationOnly = false;
      continue;
    }
    if (!horizontal(source[cursor])) indentationOnly = false;
    cursor++;
  }
  return fail('literal-unclosed', 'Raw literal has no matching closer.', from, source.length, source.length);
}

/** Canonical spelling preserves every logical character, including mixed EOLs. */
export function serializeRawLiteral(value: string): string {
  if (value === '') return '<||>';
  const blockedLevels = new Set<number>();
  for (let at = 0; at < value.length;) {
    if (value[at] !== '|') { at++; continue; }
    const start = at;
    while (value[at] === '|') at++;
    if (value[at] === '>') blockedLevels.add(at - start);
  }
  if (!/[\r\n]/.test(value) && !value.startsWith('|') && !value.endsWith('|') && !blockedLevels.has(1)) {
    return `<|${value}|>`;
  }
  let level = 1;
  while (blockedLevels.has(level)) level++;
  const marker = '|'.repeat(level);
  // LF after a trailing lone CR would merge into a structural CRLF and lose data.
  const closingEol = value.endsWith('\r') ? '\r\n' : '\n';
  return `<${marker}\n${value}${closingEol}${marker}>`;
}

interface BindingStart { name: string; nameRange: SourceRange; expressionFrom: number }
function characterBefore(source: string, at: number): string {
  const tail = source.charCodeAt(at - 1);
  const head = source.charCodeAt(at - 2);
  return source.slice(at - (tail >= 0xdc00 && tail <= 0xdfff && head >= 0xd800 && head <= 0xdbff ? 2 : 1), at);
}
function bindingStart(source: string, from: number): BindingStart | undefined {
  if (source[from] !== '@' || !nameStart(source[from + 1])) return;
  // Reject email/name interiors. Non-ASCII letters and digits are name interiors too.
  if (from > 0 && /[\p{L}\p{N}\p{M}_.@\-]/u.test(characterBefore(source, from))) return;
  let cursor = from + 1;
  while (nameCharacter(source[cursor])) cursor++;
  const name = source.slice(from + 1, cursor);
  if (!isQualifiedIdentifier(name)) return;
  const nameRange = { from: from + 1, to: cursor };
  while (horizontal(source[cursor])) cursor++;
  if (source[cursor] !== '=') return;
  return { name, nameRange, expressionFrom: cursor + 1 };
}

/** Parse one statement. Incomplete or malformed expressions never publish partial parts. */
export function parseBindingAt(source: string, from = 0): SyntaxResult<BindingNode> {
  const start = bindingStart(source, from);
  if (!start) return fail('binding-opener', 'Expected @QualifiedIdentifier = at a token boundary.',
    from, Math.min(from + 1, source.length), from + 1);
  const parts: BindingPart[] = [];
  let cursor = start.expressionFrom;
  let end = cursor;
  while (true) {
    // Newlines are layout only while an atom is required (after = or +).
    while (horizontal(source[cursor]) || eolLength(source, cursor)) cursor += eolLength(source, cursor) || 1;
    if (cursor >= source.length || source[cursor] === ';' || bindingStart(source, cursor)) {
      return fail('binding-missing-atom', 'Binding requires a literal or identifier after = or +.',
        cursor, Math.min(cursor + 1, source.length), cursor);
    }
    if (source[cursor] === '<' && source[cursor + 1] === '|') {
      const parsed = parseRawLiteral(source, cursor);
      if (!parsed.ok) return parsed;
      parts.push(parsed.node);
      cursor = parsed.node.to;
    } else if (nameStart(source[cursor])) {
      const atomFrom = cursor;
      while (nameCharacter(source[cursor])) cursor++;
      const name = source.slice(atomFrom, cursor);
      if (!isQualifiedIdentifier(name)) return fail('binding-identifier', 'Invalid qualified identifier.', atomFrom, cursor, cursor);
      parts.push({ kind: 'identifier', name, from: atomFrom, to: cursor });
    } else {
      return fail('binding-atom', 'Expected a raw literal or qualified identifier.', cursor,
        Math.min(cursor + 1, source.length), cursor + 1);
    }
    end = cursor;
    while (horizontal(source[cursor])) cursor++;
    if (source[cursor] === '+') { cursor++; continue; }
    if (source[cursor] === ';') { end = cursor + 1; break; }
    if (cursor === source.length || eolLength(source, cursor) || bindingStart(source, cursor)) break;
    return fail('binding-missing-separator', 'Expected +, ;, EOL, EOF, or another complete binding.',
      cursor, Math.min(cursor + 1, source.length), cursor + 1);
  }
  return { ok: true, node: { kind: 'binding', from, to: end, name: start.name, nameRange: start.nameRange,
    raw: source.slice(from, end), parts,
    dependencies: parts.flatMap(part => part.kind === 'identifier' ? [part.name] : []) } };
}

/** Context-free discovery; callers exclude Markdown code, escaped \\@, and other nonsemantic contexts. */
export function scanBindings(source: string): { bindings: BindingNode[]; diagnostics: SyntaxDiagnostic[] } {
  const bindings: BindingNode[] = [];
  const diagnostics: SyntaxDiagnostic[] = [];
  for (let cursor = 0; cursor < source.length;) {
    if (!bindingStart(source, cursor)) { cursor++; continue; }
    const result = parseBindingAt(source, cursor);
    if (result.ok) { bindings.push(result.node); cursor = result.node.to; }
    else { diagnostics.push(result.diagnostic); cursor = Math.max(cursor + 1, result.recoveryTo); }
  }
  return { bindings, diagnostics };
}

export function serializeBinding(name: string, parts: readonly BindingInputPart[]): string {
  if (!isQualifiedIdentifier(name)) throw new Error('Invalid qualified binding identifier.');
  if (!parts.length) throw new Error('A binding needs at least one atom; use an explicit empty literal.');
  const expression = parts.map(part => {
    if (part.kind === 'literal') return serializeRawLiteral(part.value);
    if (!isQualifiedIdentifier(part.name)) throw new Error('Invalid qualified dependency identifier.');
    return part.name;
  }).join(' + ');
  return `@${name} = ${expression}`;
}
