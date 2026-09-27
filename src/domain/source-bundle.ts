import { BINDING_SYNTAX_VERSION, type BindingNode } from './binding-language';
import { parseNoteLanguage, type ParsedNoteLanguage } from './note-language';
import { REFERENCE_SYNTAX_VERSION, type ParsedReference } from './reference-language';

export interface BindingIdentityInput { from: number; to: number; bindingId: string; identifierId: string }
export interface BundleBinding {
  /** A revision-local representation slot, never a canonical entity identity. */
  slot: string;
  identity: { kind: 'representation-slot' } | { kind: 'canonical'; bindingId: string; identifierId: string };
  syntax: BindingNode;
}
export type SourceLayout = { kind: 'prose'; from: number; to: number; raw: string }
  | { kind: 'binding'; from: number; to: number; slot: string };
export interface SourceBundle {
  format: 'grasp-note-source-bundle';
  version: 1;
  language: { binding: typeof BINDING_SYNTAX_VERSION; reference: typeof REFERENCE_SYNTAX_VERSION; context: 1 };
  note: { id: string; revision: number };
  source: { utf16Length: number; sha256Utf16LE: string };
  layout: SourceLayout[];
  bindings: BundleBinding[];
  references: ParsedReference[];
  /** Integrity checksum, not authentication or permission to import. */
  integrity: { algorithm: 'sha256-utf16le'; digest: string };
}
type BundlePayload = Omit<SourceBundle, 'integrity'>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid source bundle: ${message}`);
}
function object(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  invariant(Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label} fields/version are unsupported`);
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
async function digest(value: string): Promise<string> {
  // Hash exact JS source code units, including BOM, CRLF and lone surrogates.
  // UTF-8 encoding alone would collapse different lone surrogates to U+FFFD.
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index); bytes[index * 2] = unit & 255; bytes[index * 2 + 1] = unit >>> 8;
  }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}
function validParsed(parsed: ParsedNoteLanguage): void {
  invariant(parsed.contextsComplete, 'semantic context discovery is incomplete');
  invariant(!parsed.diagnostics.some(diagnostic => diagnostic.area !== 'context'), 'source has malformed managed syntax');
}
function validNote(id: unknown, revision: unknown): void {
  invariant(typeof id === 'string' && id.length > 0, 'note ID is required');
  invariant(Number.isSafeInteger(revision) && (revision as number) >= 0, 'revision must be a nonnegative safe integer');
}

/** Complete single-note source representation. This is not a workspace fallback. */
export async function createSourceBundle(input: {
  noteId: string; revision: number; source: string; bindingIds?: readonly BindingIdentityInput[];
}): Promise<SourceBundle> {
  validNote(input.noteId, input.revision);
  invariant(typeof input.source === 'string', 'source must be a string');
  const parsed = parseNoteLanguage(input.source, input.revision);
  validParsed(parsed);
  const identities = new Map<string, BindingIdentityInput>();
  const canonicalIds = new Set<string>();
  for (const identity of input.bindingIds ?? []) {
    const range = `${identity.from}:${identity.to}`;
    invariant(!identities.has(range), 'duplicate identity mapping for a source slot');
    invariant(typeof identity.bindingId === 'string' && identity.bindingId.length > 0
      && typeof identity.identifierId === 'string' && identity.identifierId.length > 0, 'canonical identities must be nonempty');
    invariant(!canonicalIds.has(identity.bindingId), 'canonical BindingID assigned to multiple slots');
    identities.set(range, identity); canonicalIds.add(identity.bindingId);
  }
  const layout: SourceLayout[] = [];
  const bindings: BundleBinding[] = [];
  let cursor = 0;
  for (const syntax of parsed.bindings) {
    if (syntax.from > cursor) layout.push({ kind: 'prose', from: cursor, to: syntax.from, raw: input.source.slice(cursor, syntax.from) });
    const slot = `binding-slot-${bindings.length + 1}`;
    const key = `${syntax.from}:${syntax.to}`;
    const identity = identities.get(key);
    identities.delete(key);
    bindings.push({ slot, identity: identity
      ? { kind: 'canonical', bindingId: identity.bindingId, identifierId: identity.identifierId }
      : { kind: 'representation-slot' }, syntax });
    layout.push({ kind: 'binding', from: syntax.from, to: syntax.to, slot });
    cursor = syntax.to;
  }
  invariant(identities.size === 0, 'identity mapping has no matching parsed binding range');
  if (cursor < input.source.length) layout.push({ kind: 'prose', from: cursor, to: input.source.length, raw: input.source.slice(cursor) });
  const payload: BundlePayload = {
    format: 'grasp-note-source-bundle', version: 1,
    language: { binding: BINDING_SYNTAX_VERSION, reference: REFERENCE_SYNTAX_VERSION, context: 1 },
    note: { id: input.noteId, revision: input.revision },
    source: { utf16Length: input.source.length, sha256Utf16LE: await digest(input.source) },
    layout, bindings, references: parsed.references,
  };
  return { ...payload, integrity: { algorithm: 'sha256-utf16le', digest: await digest(canonicalJson(payload)) } };
}

/** Stable serialization; writing an artifact/file is the host's responsibility. */
export function serializeSourceBundle(bundle: SourceBundle): string { return canonicalJson(bundle) + '\n'; }

/** Validate portable data, reconstruct placement, then independently parse its semantics. */
export async function restoreSourceBundle(input: string | unknown): Promise<{
  source: string; parsed: ParsedNoteLanguage; bundle: SourceBundle;
}> {
  // Snapshot before the first await: a caller cannot mutate a reviewed payload in flight.
  const value: unknown = JSON.parse(typeof input === 'string' ? input : JSON.stringify(input));
  object(value, ['format', 'version', 'language', 'note', 'source', 'layout', 'bindings', 'references', 'integrity'], 'bundle');
  invariant(value.format === 'grasp-note-source-bundle' && value.version === 1, 'unknown format/version');
  object(value.language, ['binding', 'reference', 'context'], 'language');
  invariant(value.language.binding === BINDING_SYNTAX_VERSION && value.language.reference === REFERENCE_SYNTAX_VERSION
    && value.language.context === 1, 'unknown language version');
  object(value.note, ['id', 'revision'], 'note'); validNote(value.note.id, value.note.revision);
  object(value.source, ['utf16Length', 'sha256Utf16LE'], 'source');
  invariant(Number.isSafeInteger(value.source.utf16Length) && (value.source.utf16Length as number) >= 0, 'invalid source length');
  invariant(typeof value.source.sha256Utf16LE === 'string' && /^[a-f0-9]{64}$/.test(value.source.sha256Utf16LE), 'invalid source digest');
  object(value.integrity, ['algorithm', 'digest'], 'integrity');
  invariant(value.integrity.algorithm === 'sha256-utf16le' && typeof value.integrity.digest === 'string', 'unsupported integrity format');
  invariant(Array.isArray(value.layout) && Array.isArray(value.bindings) && Array.isArray(value.references), 'layout and semantic lists must be arrays');
  const bindings = new Map<string, BundleBinding>();
  const canonicalIds = new Set<string>();
  for (const entry of value.bindings) {
    object(entry, ['slot', 'identity', 'syntax'], 'binding');
    invariant(typeof entry.slot === 'string' && entry.slot.length > 0 && !bindings.has(entry.slot), 'duplicate/invalid binding slot');
    invariant(entry.syntax !== null && typeof entry.syntax === 'object', 'missing binding syntax');
    const identity = entry.identity as Record<string, unknown> | null;
    invariant(identity !== null && typeof identity === 'object', 'missing binding identity');
    if (identity.kind === 'representation-slot') object(identity, ['kind'], 'representation identity');
    else {
      object(identity, ['kind', 'bindingId', 'identifierId'], 'canonical identity');
      invariant(identity.kind === 'canonical' && typeof identity.bindingId === 'string' && identity.bindingId.length > 0
        && typeof identity.identifierId === 'string' && identity.identifierId.length > 0, 'invalid canonical identity');
      invariant(!canonicalIds.has(identity.bindingId), 'duplicate canonical binding identity'); canonicalIds.add(identity.bindingId);
    }
    bindings.set(entry.slot, entry as unknown as BundleBinding);
  }
  const pieces: string[] = [];
  const usedSlots = new Set<string>();
  let cursor = 0;
  for (const span of value.layout) {
    invariant(span !== null && typeof span === 'object', 'invalid layout span');
    object(span, span.kind === 'prose' ? ['kind', 'from', 'to', 'raw'] : ['kind', 'from', 'to', 'slot'], 'layout span');
    invariant(Number.isSafeInteger(span.from) && Number.isSafeInteger(span.to) && span.from === cursor
      && (span.to as number) > cursor && (span.to as number) <= (value.source.utf16Length as number), 'layout has a gap, overlap or invalid range');
    let raw: string;
    if (span.kind === 'prose') {
      invariant(typeof span.raw === 'string', 'prose must contain raw source'); raw = span.raw;
    } else {
      invariant(span.kind === 'binding' && typeof span.slot === 'string', 'unknown layout kind');
      const binding = bindings.get(span.slot);
      invariant(binding && !usedSlots.has(span.slot), 'missing or repeated binding slot');
      invariant(binding.syntax.from === span.from && binding.syntax.to === span.to, 'binding range disagrees with placement');
      invariant(typeof binding.syntax.raw === 'string', 'binding must contain raw source');
      raw = binding.syntax.raw; usedSlots.add(span.slot);
    }
    invariant(raw.length === (span.to as number) - cursor, 'raw span length disagrees with range');
    pieces.push(raw); cursor = span.to as number;
  }
  invariant(cursor === value.source.utf16Length && usedSlots.size === bindings.size, 'incomplete source/binding coverage');
  const source = pieces.join('');
  invariant(await digest(source) === value.source.sha256Utf16LE, 'source checksum mismatch');
  const parsed = parseNoteLanguage(source, value.note.revision as number);
  validParsed(parsed);
  invariant(canonicalJson(parsed.bindings) === canonicalJson(value.bindings.map((binding: BundleBinding) => binding.syntax)), 'binding semantics disagree with reconstructed source');
  invariant(canonicalJson(parsed.references) === canonicalJson(value.references), 'reference semantics disagree with reconstructed source');
  const { integrity, ...payload } = value;
  invariant(await digest(canonicalJson(payload)) === (integrity as Record<string, unknown>).digest, 'bundle checksum mismatch');
  return { source, parsed, bundle: value as unknown as SourceBundle };
}
