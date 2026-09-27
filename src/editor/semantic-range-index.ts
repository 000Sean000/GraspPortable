export interface SemanticRangeIndex {
  contains(position: number): boolean;
  overlaps(from: number, to: number): boolean;
}

/** A source revision's opaque semantic spans, queried by visible Markdown nodes. */
export function semanticRangeIndex(spans: readonly { from: number; to: number }[]): SemanticRangeIndex {
  const ranges: Array<{ from: number; to: number }> = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from || a.to - b.to)) {
    if (span.from >= span.to) continue;
    const previous = ranges[ranges.length - 1];
    if (previous && span.from <= previous.to) previous.to = Math.max(previous.to, span.to);
    else ranges.push({ from: span.from, to: span.to });
  }
  const candidate = (position: number) => {
    let low = 0, high = ranges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges[middle].to <= position) low = middle + 1; else high = middle;
    }
    return ranges[low];
  };
  return {
    contains(position) { const range = candidate(position); return !!range && range.from <= position; },
    overlaps(from, to) { const range = candidate(from); return !!range && range.from < to; },
  };
}
