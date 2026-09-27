import { describe, expect, it } from 'vitest';
import { rebaseSourceEdits } from '../src/domain/edit-rebase';
import { replaySourceEditProof, type RawSourceChange } from '../src/domain/shared';

function rebased(submitted: string, committed: string, publication: RawSourceChange[], steps: RawSourceChange[][]) {
  const result = rebaseSourceEdits(submitted, committed, publication, steps);
  if (!result.ok) throw new Error(result.conflict.message);
  expect(() => replaySourceEditProof(committed, result.rebasedSource, {
    noteId: 'n', baseRevision: 2, baseHash: '', steps: result.rebasedSteps,
  }, [])).not.toThrow();
  return result;
}

describe('raw source edits during cache publication', () => {
  it('rebases delayed typing between multiple references with raw CRLF, lone CR and UTF16 emoji', () => {
    const submitted = '[old](:ref:A)\r\n😀 middle\r[old](:ref:B)\nend';
    const first = '[old](:ref:A)', second = '[old](:ref:B)';
    const committed = submitted.replace(first, '[long\r\nvalue](:ref:A)').replace(second, '[短](:ref:B)');
    const publication = [{ from: 0, to: first.length, insert: '[long\r\nvalue](:ref:A)', expected: first },
      { from: submitted.indexOf(second), to: submitted.indexOf(second) + second.length, insert: '[短](:ref:B)', expected: second }];
    const at = submitted.indexOf(' middle') + 7;
    const typed = ' changed\r\n';
    const result = rebased(submitted, committed, publication, [[{ from: at, to: at, insert: typed }],
      [{ from: submitted.length + typed.length, to: submitted.length + typed.length, insert: ' later' }]]);
    expect(result.rebasedSource).toBe(committed.replace(' middle', ' middle' + typed) + ' later');
  });

  it('maps successive editing and deleting of newly typed text without touching caches', () => {
    const submitted = '[x](:ref:A) tail', committed = '[a longer value](:ref:A) tail';
    const result = rebased(submitted, committed, [{ from: 0, to: 11, insert: '[a longer value](:ref:A)' }], [
      [{ from: submitted.length, to: submitted.length, insert: ' new' }],
      [{ from: submitted.length + 1, to: submitted.length + 4, insert: 'later', expected: 'new' }],
      [{ from: submitted.length, to: submitted.length + 6, insert: '', expected: ' later' }],
    ]);
    expect(result.rebasedSource).toBe(committed);
  });

  it('preserves inserts exactly outside replacement boundaries', () => {
    const result = rebased('before CACHE after', 'before NEW after', [{ from: 7, to: 12, insert: 'NEW' }], [[
      { from: 7, to: 7, insert: 'left ' }, { from: 12, to: 12, insert: ' right' },
    ]]);
    expect(result.rebasedSource).toBe('before left NEW right after');
  });

  it.each([
    [{ from: 8, to: 8, insert: 'typed' }], [{ from: 7, to: 12, insert: 'other' }],
    [{ from: 0, to: 10, insert: '' }],
  ])('refuses a real overlap instead of losing either input', (...step) => {
    const result = rebaseSourceEdits('before CACHE after', 'before NEW after', [{ from: 7, to: 12, insert: 'NEW' }], [step]);
    expect(result).toMatchObject({ ok: false, conflict: { kind: 'overlap', step: 0 } });
  });

  it('detects a later overlap after mapping publication through earlier input', () => {
    const result = rebaseSourceEdits('CACHE end', 'VALUE end', [{ from: 0, to: 5, insert: 'VALUE' }], [
      [{ from: 0, to: 0, insert: 'prefix ' }], [{ from: 8, to: 8, insert: 'inside cache' }],
    ]);
    expect(result).toMatchObject({ ok: false, conflict: { kind: 'overlap', step: 1 } });
  });

  it('does not choose an arbitrary order for two concurrent inserts at the same point', () => {
    expect(rebaseSourceEdits('ab', 'aXb', [{ from: 1, to: 1, insert: 'X' }], [[{ from: 1, to: 1, insert: 'Y' }]]))
      .toMatchObject({ ok: false, conflict: { kind: 'overlap' } });
  });

  it('rejects mismatched publications and invalid or stale pending ranges', () => {
    expect(rebaseSourceEdits('abc', 'changed', [], [])).toMatchObject({ ok: false, conflict: { kind: 'invalid-journal' } });
    for (const step of [[{ from: 0, to: 1, insert: 'x', expected: 'wrong' }],
      [{ from: 0, to: 2, insert: '' }, { from: 1, to: 3, insert: '' }], [{ from: -1, to: 0, insert: '' }]]) {
      expect(rebaseSourceEdits('abc', 'abc', [], [step])).toMatchObject({ ok: false, conflict: { kind: 'invalid-journal', step: 0 } });
    }
  });

  it('accepts title-only saves and empty transactions without altering any EOL', () => {
    expect(rebased('a\r\nb\rc\n', 'a\r\nb\rc\n', [], [[]])).toEqual({ ok: true, rebasedSource: 'a\r\nb\rc\n', rebasedSteps: [[]] });
  });
});
