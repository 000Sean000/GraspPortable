import { describe, expect, it } from 'vitest';
import { ChangeSet, EditorState, MapMode } from '@codemirror/state';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { editorToRaw, insertedSourceEffects, normalizeSource, rawDocument, rawSourceField, rawSourceHistory, rawSourceNormalization, rawToEditor, sourceFormat, trackedAfterMapper } from '../src/editor/raw-source';

function harness(source: string) {
  let state = EditorState.create({ doc: source, extensions: [rawSourceField.init(() => sourceFormat(source)), rawSourceHistory, rawSourceNormalization, history()] });
  const command = (run: typeof undo) => run({ state, dispatch: tr => { state = tr.state; } });
  return {
    get state() { return state; },
    get source() { return rawDocument(state); },
    replace(from: number, to: number, text: string, exact = true, grouped = false) {
      const tr = state.update({ changes: { from: rawToEditor(state, from), to: rawToEditor(state, to), insert: text }, userEvent: 'input.type', filter: !exact, ...(grouped ? {} : { annotations: isolateHistory.of('full') }) });
      state = (exact ? state.update(tr, { effects: insertedSourceEffects(tr, text), sequential: true }) : tr).state;
    },
    undo: () => command(undo), redo: () => command(redo),
  };
}

describe('raw Markdown source boundary', () => {
  it('matches CodeMirror TrackAfter at every boundary of exhaustive pairs and seeded change batches', () => {
    const verify = (changes: ChangeSet) => {
      const indexed = trackedAfterMapper(changes);
      for (let at = 0; at <= changes.length; at++) expect(indexed(at), `${changes.toString()} at ${at}`).toBe(changes.mapPos(at, 1, MapMode.TrackAfter));
    };
    const length = 5;
    for (let from = 0; from <= length; from++) for (let to = from; to <= length; to++) {
      for (const insert of ['', 'X', 'YY']) {
        verify(ChangeSet.of({ from, to, insert }, length));
        for (let nextFrom = to; nextFrom <= length; nextFrom++) for (let nextTo = nextFrom; nextTo <= length; nextTo++) {
          for (const nextInsert of ['', 'Z']) verify(ChangeSet.of([{ from, to, insert }, { from: nextFrom, to: nextTo, insert: nextInsert }], length));
        }
      }
    }
    let seed = 0x6d2b79f5;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let sample = 0; sample < 80; sample++) {
      const changes: Array<{ from: number; to: number; insert: string }> = []; let cursor = 0;
      while (cursor < 120) {
        const from = Math.min(120, cursor + random() % 5), to = Math.min(120, from + random() % 6);
        changes.push({ from, to, insert: 'x'.repeat(random() % 8) }); cursor = Math.max(to, from + 1);
      }
      verify(ChangeSet.of(changes, 120));
    }
  });

  for (const source of ['plain 中文😀', 'a\r\nb\r\n', 'a\rb\r', 'a\nb\r\nc\rd\n\r\n', '\r\n\n\r終']) {
    it(`round-trips source and every character offset ${JSON.stringify(source)}`, () => {
      const h = harness(source);
      expect(h.source).toBe(source);
      expect(h.state.doc.toString()).toBe(normalizeSource(source));
      for (let pos = 0; pos <= h.state.doc.length; pos++) expect(rawToEditor(h.state, editorToRaw(h.state, pos))).toBe(pos);
      for (let pos = 0; pos < source.length; pos++) if (source[pos] !== '\r' && source[pos] !== '\n') expect(h.state.doc.sliceString(rawToEditor(h.state, pos), rawToEditor(h.state, pos + 1))).toBe(source[pos]);
    });
  }

  it('retains untouched mixed separators and restores deleted ones through undo/redo', () => {
    const original = 'one\r\ntwo\nthree\rfour\r\nfive'; const h = harness(original);
    h.replace(original.indexOf('two'), original.indexOf('five'), 'replacement\nline\r\ntail');
    const edited = 'one\r\nreplacement\nline\r\ntailfive'; expect(h.source).toBe(edited);
    h.undo(); expect(h.source).toBe(original);
    h.redo(); expect(h.source).toBe(edited);
    h.undo(); expect(h.source).toBe(original);
  });

  it('uses the first existing separator for a newly typed Enter, retaining LF elsewhere', () => {
    const original = 'one\r\ntwo\nthree\rfour'; const h = harness(original);
    h.replace(2, 2, '\n', false); expect(h.source).toBe('on\r\ne\r\ntwo\nthree\rfour');
    h.undo(); expect(h.source).toBe(original);
    h.redo(); expect(h.source).toBe('on\r\ne\r\ntwo\nthree\rfour');
  });

  it('maps inverse separator effects when adjacent edits are grouped', () => {
    const original = 'a\r\nb\nc\rd\r\ne'; const h = harness(original);
    h.replace(0, 4, 'x\ny', true, true);
    const intermediate = h.source;
    h.replace(2, intermediate.length - 1, 'Z\r\nQ\n', true, true);
    const edited = h.source;
    h.undo(); expect(h.source).toBe(original);
    h.redo(); expect(h.source).toBe(edited);
  });

  it('keeps raw source and visual lines consistent when deleting text joins a lone CR to an LF', () => {
    const original = 'a\rb\nc'; const h = harness(original);
    h.replace(2, 3, ''); expect(h.source).toBe('a\r\nc'); expect(h.state.doc.toString()).toBe('a\nc');
    h.undo(); expect(h.source).toBe(original); expect(h.state.doc.toString()).toBe('a\nb\nc');
    h.redo(); expect(h.source).toBe('a\r\nc'); expect(h.state.doc.toString()).toBe('a\nc');
  });

  it('restores every mixed source across a sequence of raw insertion and deletion boundaries', () => {
    const h = harness('alpha\r\nbeta\ngamma\rdelta\r\n'); const snapshots = [h.source];
    for (let i = 0; i < 30; i++) {
      const source = h.source; let from = (i * 7) % (source.length + 1), to = Math.min(source.length, from + i % 5);
      if (source[from] === '\n' && source[from - 1] === '\r') from--;
      if (source[to] === '\n' && source[to - 1] === '\r') to++;
      const inserted = ['X', '\nA', '\r\nB\n', '\rC', ''][i % 5];
      if (from === to && !inserted) continue;
      h.replace(from, to, inserted);
      expect(h.source).toBe(source.slice(0, from) + inserted + source.slice(to)); snapshots.push(h.source);
      expect(h.state.doc.toString()).toBe(normalizeSource(h.source));
    }
    for (let i = snapshots.length - 2; i >= 0; i--) { h.undo(); expect(h.source, `undo ${i}`).toBe(snapshots[i]); }
    for (let i = 1; i < snapshots.length; i++) { h.redo(); expect(h.source, `redo ${i}`).toBe(snapshots[i]); }
  });
});
