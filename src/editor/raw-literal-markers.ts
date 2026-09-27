import { Prec, StateEffect, StateField, type EditorState, type Extension, type ChangeDesc } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';

interface OwnedPair { from: number; closeFrom: number; level: number }
function mapPair(pair: OwnedPair, changes: ChangeDesc): OwnedPair {
  return { ...pair, from: changes.mapPos(pair.from, 1), closeFrom: changes.mapPos(pair.closeFrom, 1) };
}
const restorePairs = StateEffect.define<readonly OwnedPair[]>({ map: (pairs, changes) => pairs.map(pair => mapPair(pair, changes)) });
const pairField = StateField.define<readonly OwnedPair[]>({
  create: () => [],
  update(value, tr) {
    let pairs = tr.docChanged ? value.map(pair => mapPair(pair, tr.changes)) : value;
    for (const effect of tr.effects) if (effect.is(restorePairs)) pairs = effect.value;
    return pairs.filter(pair => {
      const marker = '|'.repeat(pair.level);
      return pair.from >= 0 && pair.closeFrom >= pair.from + 1 + pair.level
        && tr.newDoc.sliceString(pair.from, pair.from + 1 + pair.level) === '<' + marker
        && tr.newDoc.sliceString(pair.closeFrom, pair.closeFrom + pair.level + 1) === marker + '>';
    });
  },
});
function excluded(state: EditorState, at: number): boolean {
  for (let node = syntaxTree(state).resolveInner(at, -1); node; node = node.parent!) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'Link', 'Image'].includes(node.name)) return true;
    if (!node.parent) break;
  }
  return false;
}

/** Only pairs inserted by this editor are maintained; hand-written delimiters stay raw. */
export function rawLiteralMarkers(enabled: (state: EditorState) => boolean, composing: () => boolean): Extension {
  return [pairField, invertedEffects.of(tr => tr.docChanged || tr.effects.some(effect => effect.is(restorePairs))
    ? [restorePairs.of(tr.startState.field(pairField))] : []),
  EditorView.inputHandler.of((view, from, to, text) => {
    if (!enabled(view.state) || composing() || view.composing || from !== to || text.length !== 1) return false;
    const pairs = view.state.field(pairField);
    const extending = pairs.find(pair => from === pair.from + 1 + pair.level);
    if (text === '|' && extending) {
      const changes = [{ from, insert: '|' }, { from: extending.closeFrom, insert: '|' }];
      // An empty literal has both insertions at the same boundary; combine them.
      const actual = from === extending.closeFrom ? [{ from, insert: '||' }] : changes;
      const desc = view.state.changes(actual);
      const updated = pairs.map(pair => pair === extending
        ? { from: pair.from, closeFrom: pair.closeFrom + 1, level: pair.level + 1 } : mapPair(pair, desc));
      view.dispatch({ changes: actual, selection: { anchor: from + 1 }, effects: restorePairs.of(updated),
        userEvent: 'input.type', annotations: isolateHistory.of('full') }); return true;
    }
    if (text === '|' && from > 0 && view.state.doc.sliceString(from - 1, from) === '<'
      && view.state.doc.sliceString(Math.max(0, from - 2), from - 1) !== '\\' && !excluded(view.state, from - 1)) {
      const change = { from, insert: '||>' }; const desc = view.state.changes(change);
      view.dispatch({ changes: change, selection: { anchor: from + 1 },
        effects: restorePairs.of([...pairs.map(pair => mapPair(pair, desc)), { from: from - 1, closeFrom: from + 1, level: 1 }]),
        userEvent: 'input.type', annotations: isolateHistory.of('full') }); return true;
    }
    const closing = pairs.find(pair => from >= pair.closeFrom && from < pair.closeFrom + pair.level + 1);
    if (closing && (text === '|' || text === '>') && view.state.doc.sliceString(from, from + 1) === text) {
      view.dispatch({ selection: { anchor: from + 1 }, userEvent: 'select' }); return true;
    }
    return false;
  }),
  Prec.highest(keymap.of([{ key: 'Backspace', run(view) {
    if (!enabled(view.state) || composing() || view.composing || !view.state.selection.main.empty) return false;
    const from = view.state.selection.main.head, pairs = view.state.field(pairField);
    const pair = pairs.find(item => item.closeFrom === from && item.closeFrom === item.from + 1 + item.level);
    if (!pair) return false;
    if (pair.level === 1) {
      const changes = { from: pair.from + 1, to: pair.closeFrom + 2 }; const desc = view.state.changes(changes);
      view.dispatch({ changes, selection: { anchor: pair.from + 1 }, effects: restorePairs.of(pairs.filter(item => item !== pair).map(item => mapPair(item, desc))),
        userEvent: 'delete.backward', annotations: isolateHistory.of('full') });
    } else {
      const changes = [{ from: from - 1, to: from }, { from: pair.closeFrom, to: pair.closeFrom + 1 }];
      const desc = view.state.changes(changes);
      view.dispatch({ changes, selection: { anchor: from - 1 }, effects: restorePairs.of(pairs.map(item => item === pair
        ? { ...pair, level: pair.level - 1, closeFrom: pair.closeFrom - 1 } : mapPair(item, desc))),
        userEvent: 'delete.backward', annotations: isolateHistory.of('full') });
    }
    return true;
  } }]))];
}
