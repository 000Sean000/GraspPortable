import { createHash } from 'node:crypto';
import type { Note, WorkspaceSnapshot } from '../src/domain/model.js';
import type { RawSourceChange, SemanticSourcePatch, SharedSemanticState } from '../src/domain/shared.js';

/** Hash exact UTF-16 code units, including original line endings and lone surrogates. */
export function sourceHash(source: string): string { return createHash('sha256').update(source, 'utf16le').digest('hex'); }
export type SourceSyntax = 'legacy-v0.2' | 'grasp-v1';
export interface DurableDraft {
  id: string; clientId: string; noteId: string; title: string; markdown: string; syntaxVersion: SourceSyntax;
  baseNoteRevision: number; baseSourceHash: string; revision: number; updatedAt: string;
  /** Exact ordered editor transactions, relative first to the committed base. */
  sourceEdits?: RawSourceChange[][];
}
export type SharedIntent =
  | { kind: 'commit-draft'; draftId: string; draftRevision: number }
  | { kind: 'set-literal'; bindingId: string; bindingRevision: number; partIndex: number; value: string }
  | { kind: 'set-dependency'; bindingId: string; bindingRevision: number; partIndex: number; targetIdentifierId: string }
  | { kind: 'rename'; identifierId: string; identifierRevision: number; name: string }
  | { kind: 'rename-namespace'; from: string; to: string }
  | { kind: 'undo'; operationId: string };
export interface SharedCommand { operationId: string; workspaceId: string; baseSemanticRevision: number; intent: SharedIntent }
export interface SharedSourcePatch {
  noteId: string; baseRevision: number; baseSourceHash: string; revision: number; sourceHash: string;
  /** Ranges refer to the preceding committed source, never an unsaved editor draft. */
  edits: { from: number; to: number; insert: string }[];
}
export interface DraftAcknowledgement {
  draftId: string; draftRevision: number; noteId: string; submittedSourceHash: string;
  /** Cache-only edits, relative to the exact submitted durable draft source. */
  edits: { from: number; to: number; insert: string }[];
}
export interface OperationReceipt {
  operationId: string; payloadHash: string; workspaceId: string; workspaceRevision: number; semanticRevision: number;
  createdAt: string; kind: SharedIntent['kind'] | 'content-update'; changedNoteIds: string[]; changedRecordIds: string[];
  sourcePatches: SharedSourcePatch[]; undoable: boolean; undoneOperationId?: string;
  draftAcknowledgement?: DraftAcknowledgement;
}
export interface SharedStateResponse {
  snapshot: WorkspaceSnapshot; semantic: SharedSemanticState;
  noteSources: { noteId: string; revision: number; sourceHash: string }[];
}
export interface SharedCommitResponse extends SharedStateResponse { receipt: OperationReceipt; sourcePatches: SharedSourcePatch[]; draftAcknowledgement?: DraftAcknowledgement }

export function canonicalPayload(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalPayload).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalPayload((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
/** A bounded replacement retains exact untouched prefix/suffix and raw EOLs. */
export function sourcePatch(before: Note, after: Note): SharedSourcePatch {
  let from = 0; let beforeEnd = before.markdown.length; let afterEnd = after.markdown.length;
  while (from < beforeEnd && from < afterEnd && before.markdown[from] === after.markdown[from]) from++;
  while (beforeEnd > from && afterEnd > from && before.markdown[beforeEnd - 1] === after.markdown[afterEnd - 1]) { beforeEnd--; afterEnd--; }
  const splitsUnit = (raw: string, at: number) => at > 0 && at < raw.length && ((raw[at - 1] === '\r' && raw[at] === '\n')
    || (raw.charCodeAt(at - 1) >= 0xd800 && raw.charCodeAt(at - 1) <= 0xdbff && raw.charCodeAt(at) >= 0xdc00 && raw.charCodeAt(at) <= 0xdfff));
  if (splitsUnit(before.markdown, from) || splitsUnit(after.markdown, from)) from--;
  if (splitsUnit(before.markdown, beforeEnd) || splitsUnit(after.markdown, afterEnd)) { beforeEnd++; afterEnd++; }
  return { noteId: after.id, baseRevision: before.revision, baseSourceHash: sourceHash(before.markdown), revision: after.revision, sourceHash: sourceHash(after.markdown),
    edits: before.markdown === after.markdown ? [] : [{ from, to: beforeEnd, insert: after.markdown.slice(from, afterEnd) }] };
}

/** Combine source and indexed cache edits without replacing untouched prose. */
export function semanticSourcePatch(before: Note, candidate: Note, after: Note, cachePatches: SemanticSourcePatch[]): SharedSourcePatch {
  const fallback = sourcePatch(before, after);
  const sourceEdits = sourcePatch(before, candidate).edits;
  const edit = sourceEdits[0];
  const edits = [...sourceEdits];
  for (const patch of cachePatches.filter(p => p.noteId === after.id)) {
    let from = patch.from, to = patch.to;
    if (edit) {
      const delta = edit.insert.length - (edit.to - edit.from);
      if (to <= edit.from) { /* untouched prefix */ }
      else if (from >= edit.from + edit.insert.length) { from -= delta; to -= delta; }
      else return fallback;
    }
    edits.push({ from, to, insert: patch.after });
  }
  edits.sort((a, b) => a.from - b.from);
  let cursor = 0; const parts: string[] = [];
  for (const e of edits) { if (e.from < cursor || e.to < e.from) return fallback; parts.push(before.markdown.slice(cursor, e.from), e.insert); cursor = e.to; }
  parts.push(before.markdown.slice(cursor));
  return parts.join('') === after.markdown ? { ...fallback, edits } : fallback;
}
