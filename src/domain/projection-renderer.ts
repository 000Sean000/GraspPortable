import { parser as markdownParser } from '@lezer/markdown';
import { parseNote } from './knowledge';
import type { ProjectionPlan, ProjectionUnit, ProjectionUnitId, ProjectionDiagnostic, ProjectionLink } from './projection';
import type { NoteSyntaxVersion, ValueOwner } from './model';

export interface ProjectionSourceRange { owner: ValueOwner; from?: number; to?: number }
export interface ProjectionOpaqueToken { text: string; raw: string; from: number; to: number }
export interface ProjectionRegion {
  id: string; unitId: ProjectionUnitId; kind: 'prose' | 'binding' | 'cache';
  /** UTF-16 offsets into the exported file. The host must retain this baseline. */
  from: number; to: number; beforeRaw: string; source?: ProjectionSourceRange;
  occurrenceId?: string; bindingId?: string; syntaxVersion?: NoteSyntaxVersion; bindingName?: string;
  encoding: { kind: 'quote' } | { kind: 'fence'; fence: string };
  opaque: ProjectionOpaqueToken[];
}
export interface RenderedProjectionFile { path: string; text: string; regions: ProjectionRegion[] }
export interface RenderedProjection {
  version: 1; files: RenderedProjectionFile[];
  locations: Array<{ unitId: ProjectionUnitId; path: string; anchor: string; from: number; to: number }>;
  diagnostics: ProjectionDiagnostic[];
}
export interface ProjectionReadingChange {
  unitId: ProjectionUnitId; regionId: string; kind: 'prose' | 'binding' | 'cache-only';
  beforeRaw: string; afterRaw: string; owner?: ValueOwner; from?: number; to?: number; occurrenceId?: string; bindingId?: string;
  /** Relative to beforeRaw. Opaque reference spans are never part of an edit. */
  rawEdits: Array<{ from: number; to: number; insert: string }>;
}
export interface ProjectionReadingReview { canApply: boolean; changes: ProjectionReadingChange[]; diagnostics: ProjectionDiagnostic[] }

const lf = (text: string) => text.replace(/\r\n|\r/g, '\n');
const hex = (text: string) => Array.from(text, character => character.codePointAt(0)!.toString(16) + '-').join('').slice(0, -1);
const label = (text: string) => lf(text).replace(/\n/g, ' ').replace(/[\\[\]*_`<>|]/g, character => `\\${character}`);
const quote = (text: string) => lf(text).split('\n').map(line => `> ${line}`).join('\n');
const unquote = (text: string) => {
  const lines = text.split('\n');
  if (lines.some(line => !line.startsWith('> '))) throw new Error('Reading block quote prefixes were changed; preserve the block structure.');
  return lines.map(line => line.slice(2)).join('\n');
};
function validPath(path: string): void {
  if (!path || /[\\:#?\u0000-\u001f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Projection path must stay relative to its root.');
}
export function relativeProjectionLink(from: string, to: string, anchor?: string): string {
  validPath(from); validPath(to);
  const base = from.split('/').slice(0, -1), target = to.split('/');
  while (base.length && target.length && base[0] === target[0]) { base.shift(); target.shift(); }
  const escaped = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return [...base.map(() => '..'), ...target.map(escaped)].join('/') + (anchor ? `#${escaped(anchor)}` : '');
}
function htmlRanges(raw: string) {
  const ranges: Array<{ from: number; to: number }> = [];
  markdownParser.parse(lf(raw)).iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return false;
    if (['HTMLBlock', 'HTMLTag', 'CommentBlock', 'ProcessingInstructionBlock'].includes(node.name)) { ranges.push({ from: node.from, to: node.to }); return false; }
  } });
  // The parser sees normalized EOLs; convert its boundaries back to exact raw offsets.
  const offsets = normalizedOffsets(raw);
  return ranges.map(range => ({ from: offsets[range.from], to: offsets[range.to] }));
}
function normalizedOffsets(raw: string): number[] {
  const offsets = [0];
  for (let at = 0; at < raw.length;) { if (raw[at] === '\r' && raw[at + 1] === '\n') at += 2; else at++; offsets.push(at); }
  return offsets;
}
function preserveEols(before: string, after: string): string {
  const normalized = lf(before); after = lf(after);
  if (normalized === after) return before;
  let start = 0, oldEnd = normalized.length, newEnd = after.length;
  while (start < oldEnd && start < newEnd && normalized[start] === after[start]) start++;
  while (oldEnd > start && newEnd > start && normalized[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  const offsets = normalizedOffsets(before);
  return before.slice(0, offsets[start]) + after.slice(start, newEnd) + before.slice(offsets[oldEnd]);
}
type Replacement = { from: number; to: number; display: string };
function readingText(raw: string, id: string, replacements: Replacement[] = []): { text: string; opaque: ProjectionOpaqueToken[] } {
  const patches = [...replacements];
  for (const range of htmlRanges(raw)) if (!patches.some(patch => patch.from < range.to && patch.to > range.from)) {
    patches.push({ ...range, display: lf(raw.slice(range.from, range.to)).replace(/&/g, '&amp;').replace(/</g, '&lt;') });
  }
  patches.sort((a, b) => a.from - b.from);
  const pieces: string[] = [], opaque: ProjectionOpaqueToken[] = []; let cursor = 0;
  for (const [index, patch] of patches.entries()) {
    if (patch.from < cursor || patch.to < patch.from || patch.to > raw.length) throw new Error('Overlapping or stale projection source mapping.');
    // Put the closed comment after visible Markdown. A comment at line start
    // would make CommonMark treat the following link as an HTML block.
    const token = `${patch.display}<!-- grasp-keep:${id}-${index} -->`;
    if (raw.includes(token)) throw new Error('Source collides with a reserved projection token.');
    pieces.push(lf(raw.slice(cursor, patch.from)), token);
    opaque.push({ text: token, raw: raw.slice(patch.from, patch.to), from: patch.from, to: patch.to }); cursor = patch.to;
  }
  pieces.push(lf(raw.slice(cursor))); return { text: pieces.join(''), opaque };
}
function gapEdit(before: string, after: string, offset: number): ProjectionReadingChange['rawEdits'] {
  if (before === after) return [];
  let from = 0, to = before.length, end = after.length;
  while (from < to && from < end && before[from] === after[from]) from++;
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
  const splits = (raw: string, at: number) => at > 0 && at < raw.length && (raw[at - 1] === '\r' && raw[at] === '\n'
    || /[\uD800-\uDBFF]/.test(raw[at - 1]) && /[\uDC00-\uDFFF]/.test(raw[at]));
  if (splits(before, from) || splits(after, from)) from--;
  if (splits(before, to) || splits(after, end)) { to++; end++; }
  return [{ from: offset + from, to: offset + to, insert: after.slice(from, end) }];
}
function reverseReading(region: ProjectionRegion, text: string): { raw: string; rawEdits: ProjectionReadingChange['rawEdits'] } {
  if (region.encoding.kind === 'fence') {
    const opener = region.encoding.fence + 'text\n', closer = '\n' + region.encoding.fence;
    if (!text.startsWith(opener) || !text.endsWith(closer)) throw new Error('Canonical source fence was changed.');
    const raw = preserveEols(region.beforeRaw, text.slice(opener.length, -closer.length));
    return { raw, rawEdits: gapEdit(region.beforeRaw, raw, 0) };
  }
  const decoded = unquote(text), pieces: string[] = [];
  const rawEdits: ProjectionReadingChange['rawEdits'] = [];
  let projectedCursor = 0, rawCursor = 0;
  for (const token of region.opaque) {
    const at = decoded.indexOf(token.text, projectedCursor);
    if (at < 0 || decoded.indexOf(token.text, at + token.text.length) >= 0) throw new Error('Managed link or protected HTML mapping was modified, removed or duplicated.');
    const before = region.beforeRaw.slice(rawCursor, token.from), gap = preserveEols(before, decoded.slice(projectedCursor, at));
    pieces.push(gap, token.raw); rawEdits.push(...gapEdit(before, gap, rawCursor));
    rawCursor = token.to; projectedCursor = at + token.text.length;
  }
  const before = region.beforeRaw.slice(rawCursor), gap = preserveEols(before, decoded.slice(projectedCursor));
  pieces.push(gap); rawEdits.push(...gapEdit(before, gap, rawCursor));
  return { raw: pieces.join(''), rawEdits };
}

/** One finite reading profile for full and scoped output. No DB access or evaluation. */
export function renderProjection(plan: ProjectionPlan): RenderedProjection {
  if (plan.version !== 1) throw new Error('Unsupported projection version.');
  const units = new Map(plan.units.map(unit => [unit.id, unit]));
  if (units.size !== plan.units.length) throw new Error('Duplicate projection unit.');
  const targets = new Map(plan.targetMap.map(target => [target.unitId, target]));
  const bindings = new Map<string, ProjectionUnit[]>();
  for (const unit of plan.units) if (unit.kind === 'binding') bindings.set(unit.binding.identifierId, [...(bindings.get(unit.binding.identifierId) ?? []), unit]);
  const output: RenderedProjection = { version: 1, files: [], locations: [], diagnostics: [...plan.diagnostics] };
  // Literal values can contain arbitrary marker-shaped text. Pick a deterministic
  // namespace absent from every included raw body, without banning valid values.
  const reserved = new Set<string>();
  for (const unit of plan.units) {
    const bodies = unit.kind === 'noteProse' ? [...unit.layout.flatMap(span => span.kind === 'prose' ? [span.raw] : []), ...unit.occurrences.map(item => item.cache.renderedValue)]
      : unit.kind === 'binding' ? [unit.raw, unit.value.current.value, unit.value.lastGood?.value ?? ''] : [];
    for (const body of bodies) for (const match of body.matchAll(/grasp-(?:region|keep):r(\d+)-/g)) reserved.add(match[1]);
  }
  let namespace = 0; while (reserved.has(String(namespace))) namespace++;
  const assigned = new Set<string>();
  for (const group of plan.groups) {
    validPath(group.path); if (!/\.md$/i.test(group.path)) throw new Error('Projection group must be Markdown.');
    const file: RenderedProjectionFile = { path: group.path, text: `# ${label(group.path.split('/').at(-1)!.slice(0, -3))}\n\nGrasp projection · ${plan.scope.mode} · workspace revision ${plan.workspaceRevision}.\n\n`, regions: [] };
    const linkUnit = (id: ProjectionUnitId, text: string) => {
      const target = targets.get(id);
      return target && units.has(id) ? `[${label(text)}](${relativeProjectionLink(group.path, target.path, target.anchor)})` : `${label(text)} (not included in this export)`;
    };
    const linkIdentifier = (identifierId: string, name: string) => {
      const matches = bindings.get(identifierId) ?? [];
      return matches.length === 1 ? linkUnit(matches[0].id, name) : `${label(name)} (${matches.length ? 'ambiguous definitions' : 'definition not included or missing'})`;
    };
    const externalLinks = (unit: ProjectionUnit, links: ProjectionLink[], offset = 0): Replacement[] => links.map(link => {
      const text = link.label ?? link.target;
      let display: string;
      const attachment = link.attachmentId && plan.attachments.find(asset => asset.id === link.attachmentId);
      if (link.status === 'resolved' && attachment) display = `${link.embed ? '!' : ''}[${label(text)}](${relativeProjectionLink(group.path, attachment.file)})`;
      else if (link.status === 'resolved' && link.targetUnitId && targets.has(link.targetUnitId)) {
        display = linkUnit(link.targetUnitId, text);
        if (link.embed) display += ' (linked note; content not embedded)';
        if (link.fragment) display += ` (original heading: ${label(link.fragment)}; link opens the exported note)`;
      } else if (link.status === 'external') display = link.raw;
      else {
        display = `${label(text)} (${link.status === 'omitted' || link.status === 'resolved' ? 'target not included in this export' : link.status})`;
        output.diagnostics.push({ code: `projection-link-${link.status}`, message: link.message ?? display, unitId: unit.id, path: group.path });
      }
      return { from: link.from - offset, to: link.to - offset, display };
    });
    const addRegion = (input: Omit<ProjectionRegion, 'from' | 'to' | 'encoding' | 'opaque'>, replacements: Replacement[] = [], fenced = false) => {
      const transformed = fenced ? { text: '', opaque: [] } : readingText(input.beforeRaw, input.id, replacements);
      const fence = '`'.repeat(Math.max(3, ...[...input.beforeRaw.matchAll(/`+/g)].map(match => match[0].length + 1)));
      const content = fenced ? `${fence}text\n${lf(input.beforeRaw)}\n${fence}` : quote(transformed.text);
      file.text += `<!-- grasp-region:${input.id} -->\n\n`;
      const from = file.text.length; file.text += content;
      file.regions.push({ ...input, from, to: file.text.length, encoding: fenced ? { kind: 'fence', fence } : { kind: 'quote' }, opaque: fenced ? [] : transformed.opaque });
      file.text += `\n\n<!-- /grasp-region:${input.id} -->\n\n`;
    };
    for (const unitId of group.members) {
      const unit = units.get(unitId), target = targets.get(unitId);
      if (!unit || !target || target.path !== group.path || assigned.has(unitId)) throw new Error('Unknown, duplicate or inconsistent unit assignment.');
      if (!/^[a-z0-9][a-z0-9-]*$/.test(target.anchor)) throw new Error('Projection anchor must be an explicit stable Markdown heading slug.');
      assigned.add(unitId); const from = file.text.length;
      file.text += `## ${target.anchor}\n\n**${label(unit.label)}**\n\n`;
      const id = `r${namespace}-${hex(unit.id)}`;
      if (unit.kind === 'noteProse') {
        for (const [index, span] of unit.layout.entries()) {
          if (span.kind === 'binding') { file.text += `Binding placement: ${linkUnit(`binding:${span.bindingId}`, 'definition')} (canonical owner remains this note).\n\n`; continue; }
          const references = unit.occurrences.filter(occurrence => occurrence.location.from >= span.from && occurrence.location.to <= span.to);
          const replacements = references.map(occurrence => ({ from: occurrence.location.from - span.from, to: occurrence.location.to - span.from,
            display: `[${label(occurrence.name)}](${relativeProjectionLink(group.path, group.path, `grasp-occurrence-${hex(occurrence.id)}`)})` }));
          replacements.push(...externalLinks(unit, (unit.links ?? []).filter(link => link.content === 'prose' && link.from >= span.from && link.to <= span.to
            && !references.some(occurrence => link.from < occurrence.location.to && link.to > occurrence.location.from)), span.from));
          addRegion({ id: `${id}-prose-${index}`, unitId, kind: 'prose', beforeRaw: span.raw, syntaxVersion: unit.note.syntaxVersion ?? 'legacy-v0.2', source: { owner: { kind: 'note', noteId: unit.note.id }, from: span.from, to: span.to } }, replacements);
        }
        for (const occurrence of unit.occurrences) {
          file.text += `### grasp-occurrence-${hex(occurrence.id)}\n\nReference: ${linkIdentifier(occurrence.identifierId, occurrence.name)} · cached ${occurrence.cache.current.status} value (${occurrence.cache.source}).\n\n`;
          addRegion({ id: `${id}-cache-${hex(occurrence.id)}`, unitId, kind: 'cache', beforeRaw: occurrence.cache.renderedValue, occurrenceId: occurrence.id }, externalLinks(unit, (unit.links ?? []).filter(link => link.content === 'occurrence-value' && link.occurrenceId === occurrence.id)));
        }
      } else if (unit.kind === 'binding') {
        file.text += `Identifier: ${label(unit.binding.name)}. Definition source (Review required to import):\n\n`;
        addRegion({ id: `${id}-binding`, unitId, kind: 'binding', beforeRaw: unit.raw, bindingId: unit.binding.id, syntaxVersion: unit.binding.syntaxVersion, bindingName: unit.binding.name,
          source: { owner: unit.binding.owner, ...(unit.binding.owner.kind === 'note' ? { from: unit.binding.location.from, to: unit.binding.location.to } : {}) } }, [], true);
        file.text += `Rendered value: ${unit.value.current.status}${unit.value.current.status !== 'ok' && unit.value.lastGood ? ' · showing last successful value' : ''}. Changes below are observations, not shared edits.\n\n`;
        addRegion({ id: `${id}-value`, unitId, kind: 'cache', beforeRaw: unit.value.current.status === 'ok' ? unit.value.current.value : unit.value.lastGood?.value ?? unit.value.current.value, bindingId: unit.binding.id }, externalLinks(unit, (unit.links ?? []).filter(link => link.content === 'binding-value')));
        file.text += 'Dependencies, in composition order: ' + (unit.binding.parts.filter(part => part.kind === 'identifier').map(part => part.kind === 'identifier' ? linkIdentifier(part.identifierId ?? '', part.name) : '').join(' → ') || '(none)') + '.\n\n';
      } else {
        file.text += `Record: ${label(unit.record.collection)} / ${label(unit.record.name)}.\n\n`;
        for (const field of unit.fields) file.text += `- ${linkUnit(`binding:${field.bindingId}`, field.field)}\n`;
        file.text += '\n';
      }
      output.locations.push({ unitId, path: group.path, anchor: target.anchor, from, to: file.text.length });
    }
    output.files.push(file);
  }
  if (assigned.size !== units.size) throw new Error('Projection has unassigned included units.');
  return output;
}

/** Compare only with a host-held baseline; file markers never grant authority. */
export function reviewProjectionFile(baseline: RenderedProjectionFile, changedText: string): ProjectionReadingReview {
  const result: ProjectionReadingReview = { canApply: false, changes: [], diagnostics: [] };
  const reject = (message: string) => { result.diagnostics.push({ code: 'protected-projection-content', message, path: baseline.path }); return result; };
  const before = baseline.text, after = lf(changedText);
  let oldCursor = 0, cursor = 0;
  try {
    for (const region of baseline.regions) {
      if (region.from < oldCursor || region.to < region.from || region.to > before.length) throw new Error('Invalid baseline region mapping.');
      const prefix = before.slice(oldCursor, region.from);
      if (!after.startsWith(prefix, cursor)) return reject('Generated metadata, assignment, marker, heading or structure changed.');
      cursor += prefix.length;
      const endMarker = `\n\n<!-- /grasp-region:${region.id} -->`;
      const end = after.indexOf(endMarker, cursor);
      if (end < 0 || after.indexOf(endMarker, end + endMarker.length) >= 0) return reject('Region marker removed or duplicated.');
      const content = after.slice(cursor, end);
      if (content !== before.slice(region.from, region.to)) {
        const { raw, rawEdits } = reverseReading(region, content);
        if (region.source?.owner.kind === 'note') {
          const parsed = parseNote({ id: region.source.owner.noteId, title: '', folderId: null, revision: 0, updatedAt: '', markdown: raw, syntaxVersion: region.syntaxVersion });
          if (region.kind === 'prose' && parsed.definitions.length) return reject('A prose edit introduces managed bindings; use explicit source import review.');
          if (region.kind === 'binding') {
            const definition = parsed.definitions[0];
            if (parsed.diagnostics.some(item => item.kind === 'syntax') || parsed.definitions.length !== 1 || !definition || definition.name !== region.bindingName
              || raw.slice(0, definition.location.from).trim() || raw.slice(definition.location.to).trim()) return reject('Keep one complete definition with the same identifier. Renames, deletion and source restructuring require explicit semantic/source review.');
          }
        }
        result.changes.push({ unitId: region.unitId, regionId: region.id, kind: region.kind === 'cache' ? 'cache-only' : region.kind,
          beforeRaw: region.beforeRaw, afterRaw: raw, rawEdits, ...(region.source ?? {}), ...(region.occurrenceId ? { occurrenceId: region.occurrenceId } : {}), ...(region.bindingId ? { bindingId: region.bindingId } : {}) });
      }
      cursor = end; oldCursor = region.to;
    }
    if (after.slice(cursor) !== before.slice(oldCursor)) return reject('Content outside mapped regions changed; it cannot be silently ignored.');
  } catch (error) { return reject(error instanceof Error ? error.message : 'Malformed reading projection.'); }
  if (result.changes.some(change => change.kind === 'cache-only')) result.diagnostics.push({ code: 'cache-observation', message: 'Cached/rendered text is an observation and has no shared binding write authority.', path: baseline.path });
  result.canApply = result.changes.length > 0 && result.changes.every(change => change.kind !== 'cache-only');
  return result;
}
