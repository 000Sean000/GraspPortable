import { Transaction, type Annotation, type EditorState } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { editorToRaw, insertedSourcesEffects, normalizeSource, rawDocument, rawToEditor } from './raw-source';

export interface SemanticPatchChange { from: number; to: number; expected: string; insert: string }
export interface SemanticPatch {
  expectedKey: string | undefined; expectedRevision: number; nextRevision: number; expectedSource: string;
  changes: readonly SemanticPatchChange[];
}
export type SemanticPatchResult = { status: 'applied' | 'stale' | 'composing'; reason?: string };

/** Prepare one exact raw-source transaction without mutating a view or resetting its history. */
export function prepareSemanticPatch(state: EditorState, patch: SemanticPatch, annotations: readonly Annotation<unknown>[] = []): Transaction {
  const source = rawDocument(state);
  if (source !== patch.expectedSource) throw new Error('The local source no longer matches the patch base');
  if (!Number.isSafeInteger(patch.nextRevision) || patch.nextRevision < patch.expectedRevision) throw new Error('Invalid next revision');
  let previousTo = -1, previousFrom = -1, cursor = 0, insertedDelta = 0;
  const pieces: string[] = [];
  const insertions: Array<{ at: number; source: string }> = [];
  const changes = patch.changes.map(change => {
    if (!Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to) || change.from < 0 || change.to < change.from
      || change.to > source.length || change.from < previousTo || change.from === previousFrom || typeof change.insert !== 'string'
      || source.slice(change.from, change.to) !== change.expected) throw new Error('Patch ranges or expected text no longer match');
    const from = rawToEditor(state, change.from), to = rawToEditor(state, change.to);
    if (editorToRaw(state, from) !== change.from || editorToRaw(state, to) !== change.to) throw new Error('Patch splits a CRLF separator');
    pieces.push(source.slice(cursor, change.from), change.insert); cursor = change.to;
    // Changes are sorted in the original document. Accumulate normalized length
    // deltas once; calling ChangeDesc.mapPos for every cache patch would rescan
    // every earlier change and turn a large shared cascade into quadratic work.
    if (/[\r\n]/.test(change.insert)) insertions.push({ at: from + insertedDelta, source: change.insert });
    insertedDelta += normalizeSource(change.insert).length - (to - from);
    previousFrom = change.from; previousTo = change.to;
    return { from, to, insert: change.insert };
  });
  pieces.push(source.slice(cursor));
  const initial = state.update({ changes, annotations: [Transaction.addToHistory.of(false), isolateHistory.of('full'), ...annotations], filter: false });
  const effects = insertedSourcesEffects(insertions);
  const transaction = state.update(initial, { effects, sequential: true });
  if (rawDocument(transaction.state) !== pieces.join('')) throw new Error('Raw source mapping rejected the patch');
  return transaction;
}
