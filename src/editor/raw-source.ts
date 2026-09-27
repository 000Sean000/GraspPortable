import { EditorState, MapMode, StateEffect, StateField, type Transaction } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';

type Separator = '\n' | '\r\n' | '\r';
interface Break { at: number; text: Separator }
interface SourceFormat { preferred: Separator; extra: readonly Break[]; crlf: readonly number[] }

/** CM positions use one character per line break. Only non-LF breaks need metadata. */
function format(preferred: Separator, extra: readonly Break[]): SourceFormat {
  return { preferred, extra, crlf: extra.filter(item => item.text === '\r\n').map(item => item.at) };
}
export function normalizeSource(source: string): string { return source.replace(/\r\n?|\n/g, '\n'); }
export function sourceFormat(source: string): SourceFormat {
  const extra: Break[] = []; let removed = 0; let preferred: Separator | undefined;
  for (const match of source.matchAll(/\r\n?|\n/g)) {
    const text = match[0] as Separator; preferred ??= text;
    if (text !== '\n') extra.push({ at: match.index! - removed, text });
    if (text === '\r\n') removed++;
  }
  return format(preferred ?? '\n', extra);
}

// Inverse effects keep the deleted separators, rather than whole document snapshots.
// Their positions follow CodeMirror's normal history grouping and change mapping.
const restoreBreaks = StateEffect.define<readonly Break[]>({ map: (items, changes) => {
  const mapped = items.flatMap(item => {
    const at = changes.mapPos(item.at, 1, MapMode.TrackAfter);
    return at === null ? [] : [{ ...item, at }];
  });
  return mapped.length ? mapped : undefined;
} });

export const rawSourceField = StateField.define<SourceFormat>({
  create: () => format('\n', []),
  update(value, tr) {
    if (!tr.docChanged && !tr.effects.some(effect => effect.is(restoreBreaks))) return value;
    const extra = new Map<number, Separator>();
    for (const item of value.extra) {
      const at = tr.changes.mapPos(item.at, 1, MapMode.TrackAfter);
      if (at !== null) extra.set(at, item.text);
    }
    if (value.preferred !== '\n') tr.changes.iterChanges((_from, _to, fromB, _toB, inserted) => {
      for (const match of inserted.toString().matchAll(/\n/g)) extra.set(fromB + match.index!, value.preferred);
    });
    for (const effect of tr.effects) if (effect.is(restoreBreaks)) for (const item of effect.value) {
      if (item.at < 0 || item.at >= tr.newDoc.length || tr.newDoc.sliceString(item.at, item.at + 1) !== '\n') continue;
      if (item.text === '\n') extra.delete(item.at); else extra.set(item.at, item.text);
    }
    return format(value.preferred, [...extra].sort(([a], [b]) => a - b).map(([at, text]) => ({ at, text })));
  },
});

export const rawSourceHistory = invertedEffects.of(tr => {
  if (!tr.docChanged) return [];
  const original = new Map(tr.startState.field(rawSourceField).extra.map(item => [item.at, item.text]));
  const deleted: Break[] = [];
  tr.changes.iterChanges((from, to) => {
    for (const match of tr.startState.doc.sliceString(from, to).matchAll(/\n/g)) {
      const at = from + match.index!; deleted.push({ at, text: original.get(at) ?? '\n' });
    }
  });
  for (const effect of tr.effects) if (effect.is(restoreBreaks)) for (const item of effect.value) {
    const at = tr.changes.invertedDesc.mapPos(item.at, 1, MapMode.TrackAfter);
    if (at !== null && tr.startState.doc.sliceString(at, at + 1) === '\n') deleted.push({ at, text: original.get(at) ?? '\n' });
  }
  return deleted.length ? [restoreBreaks.of(deleted)] : [];
});

// A deletion can join a lone CR and an LF into one CRLF. Keep the CM line model
// consistent with that exact raw result without changing either source byte.
export const rawSourceNormalization = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged) return tr;
  const extra = tr.state.field(rawSourceField).extra;
  const positions = new Set(extra.map(item => item.at));
  const merged = extra.filter(item => item.text === '\r' && !positions.has(item.at + 1) && tr.newDoc.sliceString(item.at + 1, item.at + 2) === '\n');
  if (!merged.length) return tr;
  const changes = tr.state.changes(merged.map(item => ({ from: item.at + 1, to: item.at + 2 })));
  return [tr, { changes, effects: restoreBreaks.of(merged.map(item => ({ at: changes.mapPos(item.at), text: '\r\n' }))), sequential: true }];
});

/** Explicit adapter insertion preserves supplied separators, including mixed EOLs. */
export function insertedSourceEffects(tr: Transaction, source: string): StateEffect<unknown>[] {
  const breaks: Break[] = []; let removed = 0;
  for (const match of source.matchAll(/\r\n?|\n/g)) {
    breaks.push({ at: match.index! - removed, text: match[0] as Separator });
    if (match[0] === '\r\n') removed++;
  }
  if (!breaks.length) return [];
  const inserted: Break[] = [];
  tr.changes.iterChanges((_from, _to, fromB, _toB, text) => {
    if (text.toString() === normalizeSource(source)) inserted.push(...breaks.map(item => ({ ...item, at: item.at + fromB })));
  });
  return inserted.length ? [restoreBreaks.of(inserted)] : [];
}

/** Explicit post-change positions avoid confusing equal normalized inserts with different EOLs. */
export function insertedSourcesEffects(insertions: readonly { at: number; source: string }[]): StateEffect<unknown>[] {
  const breaks: Break[] = [];
  for (const insertion of insertions) {
    let removed = 0;
    for (const match of insertion.source.matchAll(/\r\n?|\n/g)) {
      breaks.push({ at: insertion.at + match.index! - removed, text: match[0] as Separator });
      if (match[0] === '\r\n') removed++;
    }
  }
  return breaks.length ? [restoreBreaks.of(breaks)] : [];
}

export function rawDocument(state: EditorState): string {
  const text = state.doc.toString(), extra = state.field(rawSourceField).extra;
  if (!extra.length) return text;
  const chunks: string[] = []; let from = 0;
  for (const item of extra) { chunks.push(text.slice(from, item.at), item.text); from = item.at + 1; }
  chunks.push(text.slice(from)); return chunks.join('');
}

/** Public adapter offsets are UTF-16 positions in the original, unnormalized Markdown. */
export function rawToEditor(state: EditorState, offset: number): number {
  const positions = state.field(rawSourceField).crlf;
  let low = 0, high = positions.length;
  while (low < high) { const middle = (low + high) >>> 1; if (positions[middle] + middle < offset) low = middle + 1; else high = middle; }
  return Math.max(0, Math.min(state.doc.length, offset - low));
}

export function editorToRaw(state: EditorState, offset: number): number {
  const positions = state.field(rawSourceField).crlf;
  let low = 0, high = positions.length;
  while (low < high) { const middle = (low + high) >>> 1; if (positions[middle] < offset) low = middle + 1; else high = middle; }
  return offset + low;
}
