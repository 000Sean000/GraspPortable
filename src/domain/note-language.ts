import { parser as markdownParser } from '@lezer/markdown';
import { parseBindingAt, type BindingNode, type SyntaxDiagnostic } from './binding-language';
import { parseReferenceAt, type ParsedReference } from './reference-language';

export interface NoteLanguageDiagnostic extends SyntaxDiagnostic {
  area: 'binding' | 'reference' | 'context';
}
export interface ContextRange { from: number; to: number; kind: 'code' | 'html' | 'destination' | 'metadata' }
export interface ParsedNoteLanguage {
  source: string; revision: number; bindings: BindingNode[]; references: ParsedReference[];
  diagnostics: NoteLanguageDiagnostic[]; excluded: ContextRange[];
  /** False means the bounded context pass stopped before all candidates were considered. */
  contextsComplete: boolean; contextPasses: number;
}

const MAX_CONTEXT_PASSES = 8;
const sourceEol = /\r\n|\r|\n/g;

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
function discoverContexts(source: string): ContextRange[] {
  const ranges: ContextRange[] = [];
  const metadata = metadataEnd(source);
  if (metadata) ranges.push({ from: 0, to: metadata, kind: 'metadata' });
  markdownParser.parse(source).iterate({ enter(node) {
    if (node.to <= metadata) return false;
    let kind: ContextRange['kind'] | undefined;
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) kind = 'code';
    else if (['HTMLBlock', 'HTMLTag', 'CommentBlock', 'ProcessingInstructionBlock'].includes(node.name)) kind = 'html';
    else if (['URL', 'Autolink', 'LinkReference'].includes(node.name)) kind = 'destination';
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
 * Each pass accepts all currently visible semantic nodes, then hides their
 * interiors from Markdown. A raw/cache fence cannot permanently mask later prose.
 * The fixed pass ceiling bounds repeated host parsing and reports incomplete
 * context discovery explicitly instead of guessing after ambiguous long chains.
 */
export function parseNoteLanguage(source: string, revision = 0): ParsedNoteLanguage {
  const bindings: BindingNode[] = [];
  const references: ParsedReference[] = [];
  const diagnostics = new Map<string, NoteLanguageDiagnostic>();
  const accepted = new Map<number, BindingNode | ParsedReference>();
  const shield = source.split('');
  let excluded: ContextRange[] = [];
  let contextsComplete = false;
  let contextPasses = 0;
  const diagnose = (diagnostic: NoteLanguageDiagnostic) => {
    diagnostics.set(`${diagnostic.area}:${diagnostic.from}:${diagnostic.code}`, diagnostic);
  };
  const accept = (node: BindingNode | ParsedReference, hostEnds: Uint32Array): boolean => {
    accepted.set(node.from, node);
    let hostSuffixChanged = false;
    // Preserve raw UTF-16 length, line breaks and ordinary layout. Remove every
    // Markdown delimiter inside an admitted opaque node, including fake fences.
    for (let at = node.from; at < node.to; at++) {
      if (!/[\r\n \t]/.test(source[at])) shield[at] = 'x';
      if (hostEnds[at] > node.to) hostSuffixChanged = true;
    }
    return hostSuffixChanged;
  };

  for (; contextPasses < MAX_CONTEXT_PASSES;) {
    contextPasses++;
    excluded = discoverContexts(shield.join(''));
    const mask = new Uint8Array(source.length);
    const hostEnds = new Uint32Array(source.length);
    for (const range of excluded) {
      mask.fill(1, range.from, range.to);
      hostEnds[range.from] = Math.max(hostEnds[range.from], range.to);
    }
    let changed = false;
    for (let cursor = 0; cursor < source.length;) {
      const previous = accepted.get(cursor);
      if (previous) { cursor = previous.to; continue; }
      if (mask[cursor]) { cursor++; continue; }
      if (source[cursor] === '\\') { cursor += 2; continue; }
      if (source[cursor] === '@') {
        const parsed = parseBindingAt(source, cursor);
        if (parsed.ok) {
          bindings.push(parsed.node); changed = true; cursor = parsed.node.to;
          // An admitted raw fence may have masked a later *outer* candidate.
          // Reparse that suffix before accepting anything inside its payload.
          if (accept(parsed.node, hostEnds)) break;
          continue;
        }
        if (parsed.diagnostic.code !== 'binding-opener') {
          diagnose({ ...parsed.diagnostic, area: 'binding' });
          cursor = Math.max(cursor + 1, parsed.recoveryTo); continue;
        }
      } else if (source[cursor] === '[') {
        const parsed = parseReferenceAt(source, cursor);
        if (parsed.ok) {
          references.push(parsed.reference); changed = true; cursor = parsed.nextOffset;
          if (accept(parsed.reference, hostEnds)) break;
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
    if (!changed) { contextsComplete = true; break; }
  }
  if (!contextsComplete) diagnose({ area: 'context', code: 'context-pass-limit', from: 0, to: source.length,
    message: 'Context discovery reached its bounded pass limit; unresolved contexts were not activated.' });
  for (const range of excluded) {
    if (range.kind !== 'code' && /@[A-Za-z_][A-Za-z0-9_.]*[ \t]*=|\[\[@|\(:ref:/.test(source.slice(range.from, range.to))) {
      diagnose({ ...range, area: 'context', code: 'context-excluded',
        message: `Managed syntax in ${range.kind} context remains ordinary source and does not execute.` });
    }
  }
  // A caller cannot accidentally publish an incomplete subset as current knowledge.
  return { source, revision, bindings: contextsComplete ? bindings.sort((a, b) => a.from - b.from) : [],
    references: contextsComplete ? references.sort((a, b) => a.from - b.from) : [],
    diagnostics: [...diagnostics.values()].sort((a, b) => a.from - b.from), excluded, contextsComplete, contextPasses };
}
