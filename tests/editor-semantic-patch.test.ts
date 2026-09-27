import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { rawDocument, rawSourceField, rawSourceHistory, rawSourceNormalization, sourceFormat } from '../src/editor/raw-source';
import { prepareSemanticPatch, type SemanticPatchChange } from '../src/editor/semantic-patch';

function initial(source: string) {
  return EditorState.create({ doc: source, extensions: [rawSourceField.init(() => sourceFormat(source)), rawSourceHistory, rawSourceNormalization, history()] });
}
function patch(state: EditorState, changes: SemanticPatchChange[]) {
  return prepareSemanticPatch(state, { expectedKey: 'note', expectedRevision: 3, nextRevision: 4, expectedSource: rawDocument(state), changes });
}
describe('guarded raw semantic source patch', () => {
  it('retains distinct raw line separators for inserts with equal normalized text', () => {
    const state = initial('aXbYc');
    const transaction = patch(state, [{ from: 1, to: 2, expected: 'X', insert: '\nN' }, { from: 3, to: 4, expected: 'Y', insert: '\r\nN' }]);
    expect(rawDocument(transaction.state)).toBe('a\nNb\r\nNc');
    expect(rawDocument(state)).toBe('aXbYc');
  });

  it('normalizes the editor line model when a patch joins lone CR and LF without losing raw source', () => {
    const transaction = patch(initial('a\rb\nc'), [{ from: 2, to: 3, expected: 'b', insert: '' }]);
    expect(rawDocument(transaction.state)).toBe('a\r\nc');
    expect(transaction.state.doc.toString()).toBe('a\nc');
  });

  it.each([
    { changes: [{ from: 1, to: 3, expected: 'bc', insert: 'X' }, { from: 2, to: 4, expected: 'cd', insert: 'Y' }] },
    { changes: [{ from: 1, to: 1, expected: '', insert: 'X' }, { from: 1, to: 1, expected: '', insert: 'Y' }] },
    { changes: [{ from: 1, to: 2, expected: 'wrong', insert: 'X' }] },
    { changes: [{ from: -1, to: 1, expected: 'a', insert: 'X' }] },
  ])('rejects invalid ranges before any mutation', ({ changes }) => {
    const state = initial('abcd'); expect(() => patch(state, changes)).toThrow('ranges'); expect(rawDocument(state)).toBe('abcd');
  });

  it('rejects source mismatches, stale target revisions, and a patch inside a CRLF separator', () => {
    const state = initial('a\r\nb');
    expect(() => prepareSemanticPatch(state, { expectedKey: 'n', expectedRevision: 3, nextRevision: 4, expectedSource: 'other', changes: [] })).toThrow('base');
    expect(() => prepareSemanticPatch(state, { expectedKey: 'n', expectedRevision: 3, nextRevision: 2, expectedSource: rawDocument(state), changes: [] })).toThrow('revision');
    expect(() => patch(state, [{ from: 2, to: 2, expected: '', insert: 'x' }])).toThrow('CRLF');
  });

  it('maps local selection and undo/redo over committed external changes', () => {
    let state = initial('value old\r\nTail');
    state = state.update({ changes: { from: state.doc.length, insert: ' local' }, userEvent: 'input.type' }).state;
    state = state.update({ selection: EditorSelection.range(10, 14) }).state;
    state = patch(state, [{ from: 6, to: 9, expected: 'old', insert: 'new value' }]).state;
    expect(state.doc.sliceString(state.selection.main.from, state.selection.main.to)).toBe('Tail');
    const command = (run: typeof undo) => run({ state, dispatch: transaction => { state = transaction.state; } });
    command(undo); expect(rawDocument(state)).toBe('value new value\r\nTail');
    command(redo); expect(rawDocument(state)).toBe('value new value\r\nTail local');
  });
});
