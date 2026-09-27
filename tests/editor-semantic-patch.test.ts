import { describe, expect, it, vi } from 'vitest';
import { ChangeDesc, EditorSelection, EditorState } from '@codemirror/state';
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

  it('maps a large ordered mixed-EOL cascade without rescanning the change list for each insertion', () => {
    const count = 4000, source = '\uFEFF\r\n' + 'x;\r\n'.repeat(count), state = initial(source);
    const values = ['one\ntwo', 'one\r\ntwo', 'one\rtwo', '😀'];
    const changes = Array.from({ length: count }, (_, index) => ({ from: 3 + index * 4, to: 4 + index * 4, expected: 'x', insert: values[index % values.length] }));
    let scans = 0; const original = ChangeDesc.prototype.mapPos;
    const spy = vi.spyOn(ChangeDesc.prototype, 'mapPos').mockImplementation(function (this: ChangeDesc, ...args: Parameters<ChangeDesc['mapPos']>) {
      if (!this.empty) scans++;
      return Reflect.apply(original, this, args);
    });
    try {
      const result = patch(state, changes);
      expect(rawDocument(result.state)).toBe('\uFEFF\r\n' + changes.map(change => change.insert + ';\r\n').join(''));
      expect(rawDocument(state)).toBe(source);
      expect(scans).toBeLessThan(100);
    } finally { spy.mockRestore(); }
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
