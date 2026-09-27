import { parser as markdownParser } from '@lezer/markdown';
import { TreeFragment, type Input, type Tree, type ChangedRange } from '@lezer/common';
import { parseBindingAt, type BindingNode, type SyntaxDiagnostic } from './binding-language';
import { parseReferenceAt, type ParsedReference } from './reference-language';

export interface NoteLanguageDiagnostic extends SyntaxDiagnostic {
  area: 'binding' | 'reference' | 'context';
}
export interface ContextRange { from: number; to: number; kind: 'code' | 'html' | 'destination' | 'metadata' }
export interface ParsedNoteLanguage {
  source: string; revision: number; bindings: BindingNode[]; references: ParsedReference[];
  diagnostics: NoteLanguageDiagnostic[]; excluded: ContextRange[];
  /** A parse covers the entire note; no arbitrary candidate/pass ceiling applies. */
  contextsComplete: boolean; contextPasses: number;
  /** Actual host input reads, useful for detecting accidental whole-document rescans. */
  hostCharactersRead: number;
}

const sourceEol = /\r\n|\r|\n/g;

/** Fixed-size edits avoid repeatedly copying a long line containing many nodes. */
class ShieldedInput implements Input {
  readonly length: number;
  readonly lineChunks = true;
  charactersRead = 0;
  private chunks: string[] = [];
  private lineEnds: number[] = [];
  private readonly chunkSize = 2048;

  constructor(source: string) {
    // Lezer uses LF internally. A lone CR becomes LF only in this host view,
    // with no length change; codecs still receive the untouched original.
    const hostSource = source.replace(/\r(?!\n)/g, '\n');
    this.length = source.length;
    for (let at = 0; at < hostSource.length; at += this.chunkSize) this.chunks.push(hostSource.slice(at, at + this.chunkSize));
    for (let at = 0; at < hostSource.length; at++) if (hostSource[at] === '\n') this.lineEnds.push(at);
    this.lineEnds.push(hostSource.length);
  }
  read(from: number, to: number): string {
    this.charactersRead += to - from;
    const parts: string[] = [];
    for (let at = from; at < to;) {
      const index = Math.floor(at / this.chunkSize);
      const end = Math.min(to, (index + 1) * this.chunkSize);
      parts.push(this.chunks[index].slice(at % this.chunkSize, end - index * this.chunkSize));
      at = end;
    }
    return parts.join('');
  }
  chunk(from: number): string {
    if (from >= this.length) return '';
    let low = 0, high = this.lineEnds.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.lineEnds[mid] < from) low = mid + 1; else high = mid;
    }
    return this.read(from, this.lineEnds[low] === from ? from + 1 : this.lineEnds[low]);
  }
  shield(from: number, to: number): void {
    for (let at = from; at < to;) {
      const index = Math.floor(at / this.chunkSize);
      const begin = at % this.chunkSize;
      const end = Math.min(to, (index + 1) * this.chunkSize) - index * this.chunkSize;
      const chunk = this.chunks[index];
      this.chunks[index] = chunk.slice(0, begin) + chunk.slice(begin, end).replace(/[^\r\n \t]/g, 'x') + chunk.slice(end);
      at = index * this.chunkSize + end;
    }
  }
}

function metadataEnd(source: string): number {
  const opener = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\r|\n)/.exec(source);
  if (!opener) return 0;
  let from = opener[0].length;
  sourceEol.lastIndex = from;
  for (;;) {
    const next = sourceEol.exec(source);
    const to = next ? next.index : source.length;
    if (/^(?:---|\.\.\.)[ \t]*$/.test(source.slice(from, to))) return next ? sourceEol.lastIndex : to;
    if (!next) return source.length;
    from = sourceEol.lastIndex;
  }
}

/** Third-party Markdown nodes remain private to this replaceable context adapter. */
function contextKind(name: string): ContextRange['kind'] | undefined {
  if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(name)) return 'code';
  if (['HTMLBlock', 'HTMLTag', 'CommentBlock', 'Comment', 'ProcessingInstructionBlock', 'ProcessingInstruction'].includes(name)) return 'html';
  if (['URL', 'Autolink', 'LinkReference'].includes(name)) return 'destination';
}

function discoverContexts(tree: Tree, metadata: number, to = tree.length): ContextRange[] {
  const ranges: ContextRange[] = [];
  if (metadata) ranges.push({ from: 0, to: metadata, kind: 'metadata' });
  tree.iterate({ to, enter(node) {
    if (node.to <= metadata) return false;
    const kind = contextKind(node.name);
    if (kind) { ranges.push({ from: node.from, to: node.to, kind }); return false; }
  } });
  return ranges.sort((a, b) => a.from - b.from || b.to - a.to);
}

/**
 * Note-level v1 adapter; intentionally separate from the existing v0.2 runtime.
 * Code, URL/link destinations, HTML and initial YAML metadata never execute.
 * Paragraphs, headings, lists, quotes and tables keep exact raw source offsets;
 * container prefixes inside a multiline value are NOT silently stripped.
 *
 * The source cursor advances once. Admitted spans become neutral host text.
 * When one invalidates a later host context, official Lezer TreeFragments reuse
 * unaffected block subtrees; no full-note scanner/mask is rebuilt per candidate.
 * Real host exclusions are checked before any syntax is admitted. Code hidden
 * inside raw/cache values therefore cannot permanently mask later prose.
 */
export function parseNoteLanguage(source: string, revision = 0): ParsedNoteLanguage {
  const bindings: BindingNode[] = [];
  const references: ParsedReference[] = [];
  const diagnostics = new Map<string, NoteLanguageDiagnostic>();
  const input = new ShieldedInput(source);
  const metadata = metadataEnd(source);
  // Parse only enough prefix to decide the next candidate. Parsing the entire
  // suffix first would repeatedly pair fake fences differently, defeating even
  // incremental tree reuse on a long chain of otherwise independent literals.
  if (metadata) input.shield(0, metadata);
  let tree = markdownParser.parse('');
  let contextPasses = 0;
  let invalidSuffix = false;
  let base = 0;
  const retiredExcluded: ContextRange[] = [];
  const acceptedRanges: { from: number; to: number }[] = [];
  let continuationFrom = -1;
  let pending: ChangedRange[] = [];
  const diagnose = (diagnostic: NoteLanguageDiagnostic) => {
    diagnostics.set(`${diagnostic.area}:${diagnostic.from}:${diagnostic.code}`, diagnostic);
  };
  const ensureContext = (position: number) => {
    if (!invalidSuffix && position < base + tree.length) return;
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree, [], true), pending, 0);
    const window: Input = { length: input.length - base, lineChunks: true,
      chunk: from => input.chunk(base + from), read: (from, to) => input.read(base + from, base + to) };
    const parse = markdownParser.startParse(window, fragments);
    // A fixed lookahead amortizes ordinary notes. Once an opaque span changes
    // the suffix, use an exact prefix until that span is safely behind us.
    parse.stopAt(Math.min(source.length, position + (invalidSuffix ? 0 : 16_384)) - base);
    let finished: Tree | null = null;
    while (!(finished = parse.advance())) { /* Lezer retains its own block/container state. */ }
    tree = finished;
    contextPasses++;
    pending = [];
    invalidSuffix = false;
  };
  const accept = (node: BindingNode | ParsedReference) => {
    let suffixChanged = false;
    // Every exclusion that crosses this span's end contains its final code unit.
    // A boundary lookup avoids traversing a large paragraph's earlier siblings
    // once per semantic node.
    if (node.to <= base + tree.length) {
      for (let host = tree.resolveInner(node.to - base - 1, 1); host; host = host.parent!) {
        if (contextKind(host.name) && host.from + base >= node.from && host.to + base > node.to) suffixChanged = true;
      }
    }
    acceptedRanges.push(node);
    input.shield(node.from, node.to);
    pending.push({ fromA: node.from - base, toA: node.to - base, fromB: node.from - base, toB: node.to - base });
    // Whitespace between opaque semantic nodes cannot introduce a code delimiter,
    // HTML tag or URL. Carry the established context through such a run, while
    // returning to Markdown for indentation that could begin a code block.
    // This avoids reparsing an ever-growing paragraph for adjacent multiline
    // statements with no blank separator.
    let next = node.to, indent = 0, newline = false;
    while (next < source.length && /[ \t\r\n]/.test(source[next])) {
      if (source[next] === '\r' || source[next] === '\n') { indent = 0; newline = true; }
      else indent += source[next] === '\t' ? 4 - indent % 4 : 1;
      next++;
    }
    continuationFrom = (!newline || indent < 4) && (source[next] === '@' || source[next] === '[') ? next : -1;
    // Re-establish context before considering a later outer candidate, otherwise
    // its payload could be incorrectly admitted while its opener remains masked.
    if (suffixChanged || node.to >= base + tree.length) invalidSuffix = true;
    if (invalidSuffix) {
      const gap = /^[ \t]*(?:\r\n|\r|\n)(?:[ \t]*(?:\r\n|\r|\n))+/.exec(source.slice(node.to));
      const cut = gap ? node.to + gap[0].length : -1;
      // A blank line followed by column-zero content ends the previous leaf and
      // lazy container continuation. Retire that closed prefix instead of
      // repeatedly rebuilding an ever-growing root tree for a long raw chain.
      if (cut >= 0 && (cut === source.length || (source[cut] !== ' ' && source[cut] !== '\t'))) {
        for (const range of discoverContexts(tree, 0, cut - base)) {
          const absolute = { ...range, from: range.from + base, to: range.to + base };
          if (absolute.to > cut) continue;
          let low = 0, high = acceptedRanges.length;
          while (low < high) {
            const mid = (low + high) >>> 1;
            if (acceptedRanges[mid].from <= absolute.from) low = mid + 1; else high = mid;
          }
          if (low && acceptedRanges[low - 1].to > absolute.from) continue;
          retiredExcluded.push(absolute);
        }
        base = cut;
        tree = markdownParser.parse('');
        pending = [];
      }
    }
  };
    for (let cursor = metadata; cursor < source.length;) {
      if (source[cursor] === '\\') { cursor += 2; continue; }
      if (source[cursor] !== '@' && source[cursor] !== '[') { cursor++; continue; }
      let excludedTo = cursor;
      if (cursor !== continuationFrom) {
        ensureContext(cursor);
        for (let host = tree.resolveInner(cursor - base, 1); host; host = host.parent!) {
          if (contextKind(host.name) && host.from + base <= cursor && cursor < host.to + base) excludedTo = Math.max(excludedTo, host.to + base);
        }
      }
      continuationFrom = -1;
      if (excludedTo > cursor) { cursor = excludedTo; continue; }
      if (source[cursor] === '@') {
        const parsed = parseBindingAt(source, cursor);
        if (parsed.ok) {
          bindings.push(parsed.node); cursor = parsed.node.to; accept(parsed.node);
          continue;
        }
        if (parsed.diagnostic.code !== 'binding-opener') {
          diagnose({ ...parsed.diagnostic, area: 'binding' });
          cursor = Math.max(cursor + 1, parsed.recoveryTo); continue;
        }
      } else if (source[cursor] === '[') {
        const parsed = parseReferenceAt(source, cursor);
        if (parsed.ok) {
          references.push(parsed.reference); cursor = parsed.nextOffset; accept(parsed.reference);
          continue;
        }
        if (parsed.diagnostic.managed) {
          diagnose({ ...parsed.diagnostic, area: 'reference' });
          cursor = parsed.nextOffset; continue;
        }
        // Ordinary Markdown brackets cannot hide an unrelated later binding.
      }
      cursor++;
    }
  ensureContext(source.length);
  const excluded = [...(metadata ? [{ from: 0, to: metadata, kind: 'metadata' as const }] : []), ...retiredExcluded,
    ...discoverContexts(tree, 0).map(range => ({ ...range, from: range.from + base, to: range.to + base }))];
  for (const range of excluded) {
    if (range.kind !== 'code' && /@[A-Za-z_][A-Za-z0-9_.]*[ \t]*=|\[\[@|\(:ref:/.test(source.slice(range.from, range.to))) {
      diagnose({ ...range, area: 'context', code: 'context-excluded',
        message: `Managed syntax in ${range.kind} context remains ordinary source and does not execute.` });
    }
  }
  return { source, revision, bindings, references,
    diagnostics: [...diagnostics.values()].sort((a, b) => a.from - b.from), excluded,
    contextsComplete: true, contextPasses, hostCharactersRead: input.charactersRead };
}
