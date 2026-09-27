import { parser as markdownParser } from '@lezer/markdown';
import { restoreSourceBundle, serializeSourceBundle, type SourceBundle } from './source-bundle';

export interface RenderedBindingObservation {
  slot: string;
  sourceRevision: number;
  status: 'ok' | 'missing' | 'cycle' | 'error';
  value: string;
}
export interface MarkdownValueLocation {
  kind: 'binding' | 'reference'; slot: string; path: string; anchor: string;
  sourceFrom: number; sourceTo: number; from: number; to: number;
}
/** Reading profile: raw HTML is visible text; genuine Markdown code stays code. */
function literalHtml(source: string): string {
  const ranges: Array<{ from: number; to: number }> = [];
  markdownParser.parse(source).iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return false;
    if (['HTMLBlock', 'HTMLTag', 'CommentBlock', 'ProcessingInstructionBlock'].includes(node.name)) {
      ranges.push({ from: node.from, to: node.to }); return false;
    }
  } });
  const parts: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    parts.push(source.slice(cursor, range.from), source.slice(range.from, range.to).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    cursor = range.to;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}
function quotedBlock(value: string): string {
  // A quote container prevents an unclosed value fence from consuming the next
  // generated section. Raw HTML must also be escaped: an HTML comment/script can
  // otherwise consume later sections in a renderer despite correct Markdown AST.
  // Keep '>' intact because HTML node ranges may contain quote-container prefixes.
  // Only this reading representation normalizes EOLs; the sidecar remains exact.
  return literalHtml(value).split(/\r\n|\r|\n/).map(line => `> ${line}`).join('\n');
}
function valueBlock(value: string): string { return value === '' ? '> *(empty value)*' : quotedBlock(value); }
function filePaths(filePath: string) {
  if (!filePath.endsWith('.md') || /[\\:#?\u0000-\u001f]/.test(filePath)
    || filePath.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Expected a relative Markdown file path');
  const fileName = filePath.split('/').at(-1)!;
  return { selfLink: encodeURIComponent(fileName), metadataPath: filePath.slice(0, -3) + '.source.json',
    metadataLink: encodeURIComponent(fileName.slice(0, -3) + '.source.json') };
}

/**
 * One-note reading adapter, with independent exact-source recovery metadata.
 * Its finite reading profile presents raw HTML as literal text, including unclosed
 * comments/tags; it does not execute HTML or alter fenced/inline code contents.
 * It does not evaluate expressions, group a workspace, publish files or authorize import.
 */
export async function exportSourceBundleMarkdown(bundle: SourceBundle, options: {
  filePath: string; renderedBindings?: readonly RenderedBindingObservation[];
}): Promise<{
  markdown: string; sourceBundleJson: string; sourceBundlePath: string;
  locations: MarkdownValueLocation[]; renderedBindings: RenderedBindingObservation[];
}> {
  const restored = await restoreSourceBundle(bundle);
  const validated = restored.bundle;
  const paths = filePaths(options.filePath);
  // Revision-local anchors are separate from entity identities. The source digest
  // avoids ordinary user headings colliding with generic "binding-1" names.
  const anchorFor = (kind: 'binding' | 'reference', index: number) => `grasp-${validated.source.sha256Utf16LE.slice(0, 16)}-${kind}-${index + 1}`;
  const observations = new Map<string, RenderedBindingObservation>();
  for (const observation of options.renderedBindings ?? []) {
    if (!validated.bindings.some(binding => binding.slot === observation.slot) || observations.has(observation.slot)
      || observation.sourceRevision !== validated.note.revision || typeof observation.value !== 'string'
      || !['ok', 'missing', 'cycle', 'error'].includes(observation.status)) throw new Error('Invalid or stale rendered binding observation');
    observations.set(observation.slot, { ...observation });
  }
  const names = new Map<string, number[]>();
  validated.bindings.forEach((binding, index) => {
    const indexes = names.get(binding.syntax.name) ?? []; indexes.push(index); names.set(binding.syntax.name, indexes);
  });
  const link = (label: string, anchor: string) => `[${label}](${paths.selfLink}#${anchor})`;
  const definitionLink = (name: string) => {
    const indexes = names.get(name);
    return indexes?.length === 1 ? link(name, anchorFor('binding', indexes[0]))
      : `${name} (${indexes?.length ? 'ambiguous definitions' : 'definition outside this note'})`;
  };
  const patches = [
    ...validated.bindings.map((binding, index) => ({ from: binding.syntax.from, to: binding.syntax.to,
      text: link(`Definition: ${binding.syntax.name}`, anchorFor('binding', index)) })),
    ...validated.references.map((reference, index) => ({ from: reference.from, to: reference.to,
      text: link(reference.identifier, anchorFor('reference', index)) })),
  ].sort((left, right) => left.from - right.from);
  const body: string[] = [];
  let cursor = 0;
  for (const patch of patches) { body.push(restored.source.slice(cursor, patch.from), patch.text); cursor = patch.to; }
  body.push(restored.source.slice(cursor));
  let markdown = `# Portable note\n\n[Exact source and structure](${paths.metadataLink})\n\n## Note\n\n${quotedBlock(body.join(''))}\n\n`;
  const locations: MarkdownValueLocation[] = [];
  validated.bindings.forEach((binding, index) => {
    const anchor = anchorFor('binding', index);
    const from = markdown.length;
    markdown += `## ${anchor}\n\n**Identifier:** ${binding.syntax.name}\n\n`;
    const observation = observations.get(binding.slot);
    if (observation) {
      markdown += `**Rendered value (${observation.status}; source revision ${observation.sourceRevision}):**\n\n${valueBlock(observation.value)}\n\n`;
    } else if (binding.syntax.parts.every(part => part.kind === 'literal')) {
      markdown += `**Value:**\n\n${valueBlock(binding.syntax.parts.map(part => part.kind === 'literal' ? part.value : '').join(''))}\n\n`;
    } else markdown += '**Value:** not evaluated in this source-only bundle.\n\n';
    markdown += '**Composition, in order:**\n\n';
    binding.syntax.parts.forEach((part, partIndex) => {
      markdown += part.kind === 'literal'
        ? `${partIndex + 1}. Literal\n\n${valueBlock(part.value)}\n\n`
        : `${partIndex + 1}. Value of ${definitionLink(part.name)}\n\n`;
    });
    locations.push({ kind: 'binding', slot: binding.slot, path: options.filePath, anchor,
      sourceFrom: binding.syntax.from, sourceTo: binding.syntax.to, from, to: markdown.length });
  });
  validated.references.forEach((reference, index) => {
    const anchor = anchorFor('reference', index);
    const from = markdown.length;
    markdown += `## ${anchor}\n\n**Reference:** ${definitionLink(reference.identifier)}\n\n**Cached value:**\n\n${valueBlock(reference.value)}\n\n`;
    locations.push({ kind: 'reference', slot: `reference-slot-${index + 1}`, path: options.filePath, anchor,
      sourceFrom: reference.from, sourceTo: reference.to, from, to: markdown.length });
  });
  return { markdown, sourceBundleJson: serializeSourceBundle(validated), sourceBundlePath: paths.metadataPath,
    locations, renderedBindings: [...observations.values()] };
}
