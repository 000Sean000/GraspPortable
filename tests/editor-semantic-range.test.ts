import { describe, expect, it } from 'vitest';
import { semanticRangeIndex } from '../src/editor/semantic-range-index';

describe('opaque semantic source range lookup', () => {
  it('matches the original span predicate for gaps, adjacent ranges, nesting and reordered input', () => {
    for (const spans of [[], [{ from: 3, to: 9 }], [{ from: 8, to: 14 }, { from: 2, to: 6 }, { from: 6, to: 8 }, { from: 4, to: 5 }]]) {
      const index = semanticRangeIndex(spans);
      for (let from = 0; from <= 18; from++) {
        expect(index.contains(from)).toBe(spans.some(span => from >= span.from && from < span.to));
        for (let to = from + 1; to <= 19; to++) expect(index.overlaps(from, to)).toBe(spans.some(span => from < span.to && to > span.from));
      }
    }
  });

  it('handles the full workload without rereading original spans for every visible Markdown node', () => {
    let reads = 0;
    const spans = Array.from({ length: 60000 }, (_, n) => ({ get from() { reads++; return n * 5; }, get to() { reads++; return n * 5 + 3; } }));
    const index = semanticRangeIndex(spans); reads = 0;
    for (let n = 0; n < 60000; n++) {
      expect(index.contains(n * 5)).toBe(true);
      expect(index.contains(n * 5 + 3)).toBe(false);
      expect(index.overlaps(n * 5 + 3, n * 5 + 5)).toBe(false);
    }
    expect(reads).toBe(0);
  });
});
