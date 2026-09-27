import type { Definition, Diagnostic, Note, ParseResult, Reference, SourceLocation, StructuredRecord } from './model';
import { IDENTIFIER_PATTERN, parseTemplate } from './template';
import { parser as markdownParser } from '@lezer/markdown';
import { parseNoteLanguage } from './note-language';

function isEscaped(source: string, offset: number): boolean {
  let count = 0;
  while (offset > 0 && source[--offset] === '\\') count++;
  return count % 2 === 1;
}

/** The Markdown parser stays inside this replaceable adapter; its AST never escapes. */
function codeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  markdownParser.parse(source).iterate({ enter(node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') {
      mask.fill(1, node.from, node.to);
      return false;
    }
  } });
  return mask;
}

/** Map decoded JSON-string UTF-16 offsets back to the user's exact source. */
function jsonOffsets(literal: string): number[] {
  const offsets: number[] = [];
  for (let i = 1; i < literal.length - 1;) {
    offsets.push(i);
    i += literal[i] === '\\' ? (literal[i + 1] === 'u' ? 6 : 2) : 1;
  }
  offsets.push(literal.length - 1);
  return offsets;
}

function duplicateDiagnostics(definitions: Definition[]): Diagnostic[] {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const definition of definitions) {
    if (seen.has(definition.name)) diagnostics.push({ kind: 'duplicate', name: definition.name, location: definition.location, message: `Identifier “${definition.name}” has more than one definition.` });
    seen.add(definition.name);
  }
  return diagnostics;
}

export function parseNote(note: Note): ParseResult {
  if (note.syntaxVersion === 'grasp-v1') return parseVersionOneNote(note);
  if (note.syntaxVersion !== undefined && note.syntaxVersion !== 'legacy-v0.2') return {
    definitions: [], references: [], diagnostics: [{ kind: 'syntax', message: 'Unknown note syntax version; source was preserved.', location: { noteId: note.id, from: 0, to: note.markdown.length, line: 1 } }],
  };
  const result: ParseResult = { definitions: [], references: [], diagnostics: [] };
  const source = note.markdown;
  const mask = codeMask(source);
  let from = 0;
  let lineNumber = 1;
  for (const line of source.split('\n')) {
    const declaration = /^ {0,3}@([^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
    if (declaration && !mask[from + line.indexOf('@')]) {
      const name = declaration[1].trim();
      const at = line.indexOf('@');
      const location: SourceLocation = { noteId: note.id, from: from + at, to: from + line.length, line: lineNumber };
      try {
        if (!IDENTIFIER_PATTERN.test(name)) throw new Error('Use letters, digits, _, . and -; begin with a letter or _.');
        const literal = declaration[2];
        const template: unknown = JSON.parse(literal);
        if (typeof template !== 'string') throw new Error('The value must be a JSON string in double quotes.');
        const parts = parseTemplate(template);
        const dependencies = [...new Set(parts.flatMap(part => part.kind === 'reference' ? [part.name] : []))];
        const nameFrom = from + line.indexOf(name, at + 1);
        const owner = { kind: 'note' as const, noteId: note.id };
        result.definitions.push({ name, template, dependencies, location, owner, nameLocation: { ...location, from: nameFrom, to: nameFrom + name.length } });
        const valueFrom = from + line.indexOf(literal, line.indexOf('=') + 1);
        const offsets = jsonOffsets(literal);
        for (const part of parts) if (part.kind === 'reference') {
          result.references.push({ name: part.name, kind: 'dependency', owner,
            location: { noteId: note.id, from: valueFrom + offsets[part.from], to: valueFrom + offsets[part.to], line: lineNumber },
            nameLocation: { noteId: note.id, from: valueFrom + offsets[part.from + 1], to: valueFrom + offsets[part.to - 1], line: lineNumber } });
        }
      } catch (error) {
        result.diagnostics.push({ kind: 'syntax', name, location, message: `Invalid declaration: ${error instanceof Error ? error.message : 'expected a quoted string'}` });
      }
      // Escaped {{braces}} inside a declaration are not note references.
      mask.fill(1, from, from + line.length);
    }
    const reference = /\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g;
    for (const match of line.matchAll(reference)) {
      const start = from + match.index;
      if (!mask[start] && !isEscaped(source, start)) result.references.push({ name: match[1], kind: 'reference', owner: { kind: 'note', noteId: note.id },
        location: { noteId: note.id, from: start, to: start + match[0].length, line: lineNumber },
        nameLocation: { noteId: note.id, from: start + 2, to: start + match[0].length - 2, line: lineNumber } });
    }
    from += line.length + 1;
    lineNumber++;
  }
  for (const diagnostic of duplicateDiagnostics(result.definitions)) result.diagnostics.push(diagnostic);
  return result;
}

function parseVersionOneNote(note: Note): ParseResult {
  const parsed = parseNoteLanguage(note.markdown, note.revision);
  const lineStarts = [0];
  for (let at = 0; at < note.markdown.length; at++) {
    if (note.markdown[at] === '\r') { if (note.markdown[at + 1] === '\n') at++; lineStarts.push(at + 1); }
    else if (note.markdown[at] === '\n') lineStarts.push(at + 1);
  }
  const location = (from: number, to: number): SourceLocation => {
    let low = 0, high = lineStarts.length;
    while (low < high) { const mid = (low + high) >>> 1; if (lineStarts[mid] <= from) low = mid + 1; else high = mid; }
    return { noteId: note.id, from, to, line: low };
  };
  const owner = { kind: 'note' as const, noteId: note.id };
  const definitions: Definition[] = parsed.bindings.map(node => ({
    name: node.name, template: node.raw, syntaxVersion: 'grasp-v1', owner,
    location: location(node.from, node.to), nameLocation: location(node.nameRange.from, node.nameRange.to),
    dependencies: [...new Set(node.dependencies)],
    parts: node.parts.map(part => part.kind === 'literal'
      ? { kind: 'literal', value: part.value, location: location(part.from, part.to) }
      : { kind: 'identifier', name: part.name, location: location(part.from, part.to) }),
  }));
  const references: Reference[] = parsed.references.map(node => ({
    name: node.identifier, kind: 'reference', owner, representation: node.kind, cachedValue: node.value,
    location: location(node.from, node.to), nameLocation: location(node.nameFrom, node.nameTo),
  }));
  for (const definition of definitions) for (const part of definition.parts ?? []) if (part.kind === 'identifier') {
    references.push({ name: part.name, kind: 'dependency', owner, location: part.location!, nameLocation: part.location });
  }
  return { definitions, references, diagnostics: [
    ...parsed.diagnostics.filter(item => item.code !== 'context-excluded').map(item => ({ kind: 'syntax' as const, message: item.message, location: location(item.from, item.to) })),
    ...duplicateDiagnostics(definitions),
  ] };
}

export function buildKnowledge(notes: Note[], records: StructuredRecord[] = []): ParseResult {
  const result: ParseResult = { definitions: [], references: [], diagnostics: [] };
  for (const note of notes) {
    const parsed = parseNote(note);
    for (const definition of parsed.definitions) result.definitions.push(definition);
    for (const reference of parsed.references) result.references.push(reference);
    for (const diagnostic of parsed.diagnostics) if (diagnostic.kind !== 'duplicate') result.diagnostics.push(diagnostic);
  }
  for (const record of records) for (const [field, template] of Object.entries(record.fields)) {
    const name = `${record.collection}.${record.name}.${field}`;
    const location: SourceLocation = { noteId: `record:${record.id}`, from: 0, to: 0, line: 1 };
    if (!IDENTIFIER_PATTERN.test(name) || typeof template !== 'string') {
      result.diagnostics.push({ kind: 'syntax', name, location, message: `Invalid structured field “${name}”.` });
      continue;
    }
    const parts = parseTemplate(template);
    const owner = { kind: 'record' as const, recordId: record.id, collection: record.collection, recordName: record.name, field };
    result.definitions.push({ name, template, location, owner, dependencies: [...new Set(parts.flatMap(part => part.kind === 'reference' ? [part.name] : []))] });
    for (const part of parts) if (part.kind === 'reference') result.references.push({ name: part.name, kind: 'dependency', owner,
      location: { ...location, from: part.from, to: part.to }, nameLocation: { ...location, from: part.from + 1, to: part.to - 1 } });
  }
  for (const diagnostic of duplicateDiagnostics(result.definitions)) result.diagnostics.push(diagnostic);
  return result;
}
