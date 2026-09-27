import { ChangeSet, Text } from '@codemirror/state';
import type { RawSourceChange } from './shared';

export type SourceEditRebase = { ok: true; rebasedSource: string; rebasedSteps: RawSourceChange[][] }
  | { ok: false; conflict: { kind: 'overlap' | 'invalid-journal'; step?: number; message: string } };

// Text.of, unlike string change specs, preserves CRLF and lone CR code units.
const rawText = (source: string) => Text.of(source.split('\n'));
function changeSet(source: string, changes: readonly RawSourceChange[]): ChangeSet {
  if (!Array.isArray(changes)) throw new Error('A raw edit transaction must be an array.');
  let end = 0; let previousFrom = -1;
  const specs: Array<{ from: number; to: number; insert: Text }> = [];
  for (const change of changes) {
    if (!change || !Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to)
      || change.from < end || change.from === previousFrom || change.to < change.from || change.to > source.length
      || typeof change.insert !== 'string' || (change.expected !== undefined && change.expected !== source.slice(change.from, change.to))) {
      throw new Error('Raw edit ranges are invalid, overlapping, unordered or stale.');
    }
    end = change.to; previousFrom = change.from;
    if (change.insert !== source.slice(change.from, change.to)) specs.push({ from: change.from, to: change.to, insert: rawText(change.insert) });
  }
  return ChangeSet.of(specs, source.length);
}

interface Range { from: number; to: number }
function ranges(set: ChangeSet): Range[] {
  const result: Range[] = [];
  set.iterChanges((from, to) => result.push({ from, to }), true);
  return result;
}
function overlaps(a: Range, b: Range): boolean {
  if (a.from === a.to && b.from === b.to) return a.from === b.from;
  if (a.from === a.to) return a.from > b.from && a.from < b.to;
  if (b.from === b.to) return b.from > a.from && b.from < a.to;
  return a.from < b.to && b.from < a.to;
}
function hasOverlap(left: ChangeSet, right: ChangeSet): boolean {
  const a = ranges(left), b = ranges(right); let index = 0;
  for (const range of a) {
    while (index < b.length && b[index].to < range.from) index++;
    for (let scan = index; scan < b.length && b[scan].from <= range.to; scan++) if (overlaps(range, b[scan])) return true;
  }
  return false;
}

/**
 * Rebase edits typed while a save was publishing its cache-only source patches.
 * This adapter neither chooses shared values nor invents occurrence identities.
 * Overlapping edits retain the caller's original draft for explicit recovery.
 */
export function rebaseSourceEdits(submitted: string, committed: string,
  publicationEdits: readonly RawSourceChange[], pendingSteps: readonly RawSourceChange[][]): SourceEditRebase {
  let step: number | undefined;
  try {
    if (!Array.isArray(pendingSteps)) throw new Error('Pending source edits must be an array.');
    let publication = changeSet(submitted, publicationEdits);
    if (publication.apply(rawText(submitted)).toString() !== committed) throw new Error('Publication edits do not reproduce the committed source.');
    let localSource = submitted;
    let rebasedSource = committed;
    const rebasedSteps: RawSourceChange[][] = [];
    for (step = 0; step < pendingSteps.length; step++) {
      const local = changeSet(localSource, pendingSteps[step]);
      if (hasOverlap(local, publication)) return { ok: false, conflict: { kind: 'overlap', step,
        message: 'Pending input overlaps a published source change; preserve the original draft instead of guessing.' } };
      const mapped = local.map(publication);
      publication = publication.map(local, true);
      const edits: RawSourceChange[] = [];
      mapped.iterChanges((from, to, _fromB, _toB, inserted) => edits.push({ from, to,
        insert: inserted.toString(), expected: rebasedSource.slice(from, to) }), true);
      rebasedSteps.push(edits);
      localSource = local.apply(rawText(localSource)).toString();
      rebasedSource = mapped.apply(rawText(rebasedSource)).toString();
    }
    return { ok: true, rebasedSource, rebasedSteps };
  } catch (error) {
    return { ok: false, conflict: { kind: 'invalid-journal', ...(step === undefined ? {} : { step }),
      message: error instanceof Error ? error.message : 'Invalid source edit journal.' } };
  }
}
