import type { Attachment, Note, NoteSyntaxVersion, StructuredRecord, WorkspaceSnapshot } from './model';
import { prepareSharedWorkspace, type SemanticBinding, type SemanticIdentifier, type SemanticOccurrence, type SemanticResult, type SharedSemanticState } from './shared';
import { buildLinkIndex, parseNoteLinks, resolveIndexedLink, type LinkStatus } from './links';

export type ProjectionUnitId = `noteProse:${string}` | `binding:${string}` | `recordInfo:${string}`;
export type ProjectionLayoutSpan = { kind: 'prose'; from: number; to: number; raw: string }
  | { kind: 'binding'; from: number; to: number; bindingId: string };
export interface ProjectionNoteOwner {
  noteId: string; sourceRevision: number; sourceHash: string; syntaxVersion: NoteSyntaxVersion;
  utf16Length: number; layout: ProjectionLayoutSpan[];
}
interface ProjectionUnitBase {
  id: ProjectionUnitId; stableKey: string; label: string; owner: { kind: 'note' | 'record'; id: string }; revision: number; hash: string; dependencyUnitIds: ProjectionUnitId[];
  identifierIds: string[]; attachmentIds: string[]; sourceNotePath?: string;
  links?: ProjectionLink[];
}
export interface ProjectionLink {
  content: 'prose' | 'binding-value' | 'occurrence-value'; occurrenceId?: string;
  from: number; to: number; raw: string; target: string; syntax: 'wiki' | 'markdown'; embed: boolean; label?: string;
  status: LinkStatus | 'omitted'; targetUnitId?: ProjectionUnitId; attachmentId?: string; fragment?: string; message?: string;
}
export type ProjectionUnit = ProjectionUnitBase & (
  { kind: 'noteProse'; note: Omit<Note, 'markdown'>; layout: ProjectionLayoutSpan[]; occurrences: SemanticOccurrence[] }
  | { kind: 'binding'; binding: SemanticBinding; value: SemanticResult; raw: string }
  | { kind: 'recordInfo'; record: Omit<StructuredRecord, 'fields'>; fields: Array<{ field: string; bindingId: string }> }
);
/** Complete private catalog. Never serialize this object as a partial export. */
export interface ProjectionCatalog {
  format: 'grasp-projection-catalog'; version: 1; workspaceId: string; workspaceRevision: number;
  semanticRevision: number; fingerprint: string; units: ProjectionUnit[]; identifiers: SemanticIdentifier[];
  attachments: Attachment[]; owners: ProjectionNoteOwner[];
}
export type ProjectionSelector = ProjectionUnitId | { kind: 'note' | 'record' | 'identifier'; id: string }
  | { kind: 'record-field'; recordId: string; field: string };
export interface ProjectionGroup { id: string; path: string; render: 'sections-v1'; members: ProjectionUnitId[] }
export interface ProjectionProposal {
  format: 'grasp-projection-proposal'; version: 1; workspaceId: string;
  base: { workspaceRevision: number; strategyRevision: number }; planningPackageId: string;
  coverage: { mode: 'full' | 'partial'; units: ProjectionSelector[] };
  groups: Array<Omit<ProjectionGroup, 'members'> & { members: ProjectionSelector[] }>;
  /** Explicit action; merely omitting a covered member never unassigns it. */
  unassign?: ProjectionSelector[];
  rationale?: string;
  unassigned: 'deterministic-default-v1';
}
export interface ProjectionStrategy {
  format: 'grasp-projection-strategy'; version: 1; workspaceId: string; revision: number;
  planningPackageId: string; groups: ProjectionGroup[]; unassigned: 'deterministic-default-v1';
}
export interface ProjectionDiagnostic { code: string; message: string; unitId?: ProjectionUnitId; path?: string }
export interface ProjectionReview {
  canApply: boolean; diagnostics: ProjectionDiagnostic[]; unassigned: ProjectionUnitId[];
  changes: Array<{ unitId: ProjectionUnitId; before: { groupId: string; path: string } | null; after: { groupId: string; path: string } | null }>;
  strategy?: ProjectionStrategy;
}
export interface ProjectionPlan {
  version: 1; workspaceId: string; workspaceRevision: number; strategyRevision: number;
  scope: { mode: 'full' | 'partial'; selected: ProjectionUnitId[]; included: ProjectionUnitId[]; omitted: ProjectionUnitId[]; dependencyClosure: boolean };
  units: ProjectionUnit[]; identifiers: SemanticIdentifier[]; groups: ProjectionGroup[];
  targetMap: Array<{ unitId: ProjectionUnitId; path: string; anchor: string }>;
  attachments: Array<Attachment & { file: string }>;
  omittedTargets: Array<{ identifierId: string; name: string; reason: string }>;
  diagnostics: ProjectionDiagnostic[];
}
export interface ProjectionScope { mode: 'full' | 'partial'; units?: ProjectionSelector[]; includeDependencies?: boolean; attachmentIds?: string[] }
export interface ProjectionHash { hash: (source: string) => string }
export interface ProjectionPlanningPackage {
  format: 'grasp-projection-planning-package'; version: 1; id: string; workspaceId: string;
  base: { workspaceRevision: number; strategyRevision: number }; catalogFingerprint: string;
  units: Array<{ id: ProjectionUnitId; revision: number; hash: string; provided: 'full' | 'metadata'; unit?: ProjectionUnit }>;
}
export interface FullProjectionBundle {
  format: 'grasp-full-fallback'; version: 1; exporterVersion: 1; workspaceLineageId: string;
  snapshot: WorkspaceSnapshot; semantic: SharedSemanticState; strategy: ProjectionStrategy;
  owners: ProjectionNoteOwner[]; provenance?: unknown;
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sorted = <T extends string>(items: Iterable<T>): T[] => [...new Set(items)].sort(compare);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const pathKey = (value: string) => value.normalize('NFC').toLowerCase();
const bindingId = (id: string): ProjectionUnitId => `binding:${id}`;
function invariant(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Invalid projection: ${message}`); }
function knownKeys(value: unknown, keys: string[], label: string): void {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key)), `${label} contains unsupported fields`);
}
/** Canonical JSON for fingerprints, never dependent on object insertion order. */
export function projectionJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => projectionJson(item ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort(compare)
    .map(key => `${JSON.stringify(key)}:${projectionJson((value as Record<string, unknown>)[key])}`).join(',') + '}';
  return JSON.stringify(value);
}
function unique<T>(items: readonly T[], getId: (item: T) => string, label: string): Map<string, T> {
  invariant(Array.isArray(items), `${label} must be an array`);
  const map = new Map<string, T>();
  for (const item of items) { const id = getId(item); invariant(typeof id === 'string' && id.length > 0 && !map.has(id), `${label} has invalid or duplicate identity`); map.set(id, item); }
  return map;
}
function append<T>(map: Map<string, T[]>, key: string, value: T): void { const values = map.get(key) ?? []; values.push(value); map.set(key, values); }

export function createProjectionCatalog(snapshot: WorkspaceSnapshot, semantic: SharedSemanticState, { hash }: ProjectionHash): ProjectionCatalog {
  invariant(semantic.schemaVersion === 1 && snapshot.id === semantic.workspaceId, 'semantic state/workspace mismatch');
  invariant(typeof snapshot.id === 'string' && snapshot.id.length > 0 && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0
    && Number.isSafeInteger(semantic.revision) && semantic.revision >= 0 && semantic.revision <= snapshot.revision, 'workspace/semantic revisions are inconsistent');
  for (const entity of [...snapshot.notes, ...snapshot.records, ...snapshot.folders, ...snapshot.attachments]) invariant(Number.isSafeInteger(entity.revision)
    && entity.revision >= 0 && entity.revision <= snapshot.revision, 'entity revision is outside the committed workspace');
  const notes = unique(snapshot.notes, item => item.id, 'notes');
  const records = unique(snapshot.records, item => item.id, 'records');
  unique(snapshot.attachments, item => item.id, 'attachments');
  const identifiers = unique(semantic.identifiers, item => item.id, 'identifiers');
  const bindings = unique(semantic.bindings, item => item.id, 'bindings');
  unique(semantic.occurrences, item => item.id, 'occurrences');
  const results = unique(semantic.results, item => item.identifierId, 'results');
  const sources = unique(semantic.sources, item => item.noteId, 'sources');
  invariant(sources.size === notes.size, 'note source coverage differs from snapshot');
  const byNote = new Map<string, SemanticBinding[]>(), byRecord = new Map<string, SemanticBinding[]>(), byIdentifier = new Map<string, SemanticBinding[]>();
  for (const binding of bindings.values()) {
    invariant(identifiers.get(binding.identifierId)?.name === binding.name && results.has(binding.identifierId), 'binding identifier/result is missing or inconsistent');
    invariant(binding.dependencies.length === binding.dependencyIds.length && binding.dependencies.every((name, index) => identifiers.get(binding.dependencyIds[index])?.name === name), 'binding dependency identities are inconsistent');
    for (const part of binding.parts) if (part.kind === 'identifier') invariant(part.identifierId && identifiers.get(part.identifierId)?.name === part.name, 'ordered dependency identity is inconsistent');
    append(byIdentifier, binding.identifierId, binding);
    if (binding.owner.kind === 'note') { invariant(notes.has(binding.owner.noteId), 'binding note owner is missing'); append(byNote, binding.owner.noteId, binding); }
    else { invariant(records.has(binding.owner.recordId), 'binding record owner is missing'); append(byRecord, binding.owner.recordId, binding); }
  }
  const noteOccurrences = new Map<string, SemanticOccurrence[]>();
  for (const occurrence of semantic.occurrences) {
    invariant(occurrence.owner.kind === 'note' && notes.has(occurrence.owner.noteId), 'occurrence note owner is missing');
    invariant(identifiers.get(occurrence.identifierId)?.name === occurrence.name && results.has(occurrence.identifierId), 'occurrence target is inconsistent');
    append(noteOccurrences, occurrence.owner.noteId, occurrence);
  }
  const linkIndex = buildLinkIndex(snapshot.notes, snapshot.folders, snapshot.attachments.map(asset => ({ id: asset.id, path: asset.path })));
  const noteCatalog = linkIndex.catalog;
  invariant(!noteCatalog.diagnostics.some(item => item.kind === 'invalid-folder' || item.kind === 'invalid-path'), 'invalid logical folder/note hierarchy');
  const units: ProjectionUnit[] = [], owners: ProjectionNoteOwner[] = [];
  const dependencies = (ids: string[]) => sorted(ids.flatMap(id => (byIdentifier.get(id) ?? []).map(binding => bindingId(binding.id))));
  const finish = <T extends Omit<ProjectionUnitBase, 'hash' | 'stableKey'> & Record<string, unknown>>(unit: T): ProjectionUnit =>
    ({ ...unit, stableKey: hash(unit.id), hash: hash(projectionJson(unit)) }) as unknown as ProjectionUnit;
  const linksOf = (markdown: string, noteId: string, content: ProjectionLink['content'], offset = 0, occurrenceId?: string): ProjectionLink[] =>
    parseNoteLinks({ id: noteId, title: '', markdown }).map(link => {
      const resolved = resolveIndexedLink(link, linkIndex);
      const fragment = link.target.includes('#') ? link.target.slice(link.target.indexOf('#') + 1) : undefined;
      return { content, ...(occurrenceId ? { occurrenceId } : {}), from: link.location.from + offset, to: link.location.to + offset,
        raw: link.raw, target: link.target, syntax: link.syntax, embed: link.embed, ...(link.alias ? { label: link.alias } : {}), status: resolved.status,
        ...(resolved.resolvedTarget?.kind === 'asset' ? { attachmentId: resolved.resolvedTarget.id } : {}),
        ...(resolved.resolvedTarget?.kind === 'note' ? { targetUnitId: `noteProse:${resolved.resolvedTarget.id}` as ProjectionUnitId } : {}),
        ...(fragment ? { fragment } : {}), ...(resolved.message ? { message: resolved.message } : {}) };
    });
  for (const note of notes.values()) {
    const source = sources.get(note.id)!;
    const syntaxVersion = note.syntaxVersion ?? 'legacy-v0.2';
    invariant(source.revision === note.revision && source.hash === hash(note.markdown) && source.syntaxVersion === syntaxVersion, 'stale note source state');
    const owned = [...byNote.get(note.id) ?? []].sort((a, b) => a.location.from - b.location.from);
    const layout: ProjectionLayoutSpan[] = []; let cursor = 0;
    for (const binding of owned) {
      const { from, to } = binding.location;
      invariant(binding.location.noteId === note.id && binding.sourceHash === source.hash && binding.sourceRevision === note.revision
        && Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= cursor && to > from && to <= note.markdown.length, 'invalid binding owner placement');
      if (from > cursor) layout.push({ kind: 'prose', from: cursor, to: from, raw: note.markdown.slice(cursor, from) });
      layout.push({ kind: 'binding', from, to, bindingId: binding.id }); cursor = to;
    }
    if (cursor < note.markdown.length) layout.push({ kind: 'prose', from: cursor, to: note.markdown.length, raw: note.markdown.slice(cursor) });
    const occurrences = [...noteOccurrences.get(note.id) ?? []].sort((a, b) => a.location.from - b.location.from);
    let spanIndex = 0;
    for (const occurrence of occurrences) {
      while (spanIndex < layout.length && layout[spanIndex].to <= occurrence.location.from) spanIndex++;
      const span = layout[spanIndex];
      invariant(occurrence.sourceHash === source.hash && occurrence.sourceRevision === note.revision
        && occurrence.location.noteId === note.id && occurrence.location.from >= 0 && occurrence.location.to <= note.markdown.length
        && occurrence.location.to > occurrence.location.from && span?.kind === 'prose' && span.from <= occurrence.location.from && span.to >= occurrence.location.to, 'invalid occurrence source placement');
    }
    const identifierIds = sorted(occurrences.map(item => item.identifierId));
    const { markdown: _markdown, ...metadata } = note;
    const sourceNotePath = noteCatalog.notePaths.get(note.id)!;
    // Readable observations may contain attachment links that raw cache syntax
    // hides from an ordinary Markdown parser. Include them explicitly.
    const insideOccurrence = (from: number, to: number) => {
      let low = 0, high = occurrences.length;
      while (low < high) { const mid = (low + high) >>> 1; if (occurrences[mid].location.from <= from) low = mid + 1; else high = mid; }
      return low > 0 && occurrences[low - 1].location.to >= to;
    };
    const links = layout.flatMap(span => span.kind === 'prose' ? linksOf(span.raw, note.id, 'prose', span.from).filter(link => !insideOccurrence(link.from, link.to)) : [])
      .concat(occurrences.flatMap(occurrence => linksOf(occurrence.cache.renderedValue, note.id, 'occurrence-value', 0, occurrence.id)));
    units.push(finish({ id: `noteProse:${note.id}` as ProjectionUnitId, kind: 'noteProse', label: note.title, owner: { kind: 'note', id: note.id }, revision: note.revision,
      dependencyUnitIds: dependencies(identifierIds), identifierIds, attachmentIds: sorted(links.flatMap(link => link.attachmentId ? [link.attachmentId] : [])), sourceNotePath, links, note: metadata, layout, occurrences }));
    owners.push({ noteId: note.id, sourceRevision: note.revision, sourceHash: source.hash, syntaxVersion, utf16Length: note.markdown.length, layout });
  }
  for (const binding of bindings.values()) {
    const value = results.get(binding.identifierId)!;
    const note = binding.owner.kind === 'note' ? notes.get(binding.owner.noteId)! : undefined;
    const sourceNotePath = note && noteCatalog.notePaths.get(note.id);
    const raw = note ? note.markdown.slice(binding.location.from, binding.location.to)
      : records.get((binding.owner as Extract<SemanticBinding['owner'], { kind: 'record' }>).recordId)!.fields[(binding.owner as Extract<SemanticBinding['owner'], { kind: 'record' }>).field];
    invariant(typeof raw === 'string', 'record binding field is missing');
    const identifierIds = sorted([binding.identifierId, ...binding.dependencyIds]);
    const links = linksOf(value.current.status === 'ok' ? value.current.value : value.lastGood?.value ?? '', note?.id ?? `record:${binding.owner.kind === 'record' ? binding.owner.recordId : ''}`, 'binding-value');
    units.push(finish({ id: bindingId(binding.id), kind: 'binding', label: binding.name,
      owner: binding.owner.kind === 'note' ? { kind: 'note', id: binding.owner.noteId } : { kind: 'record', id: binding.owner.recordId },
      revision: binding.revision, dependencyUnitIds: dependencies(binding.dependencyIds), identifierIds,
      attachmentIds: sorted(links.flatMap(link => link.attachmentId ? [link.attachmentId] : [])), links,
      ...(sourceNotePath ? { sourceNotePath } : {}), binding, value, raw }));
  }
  for (const record of records.values()) {
    const owned = byRecord.get(record.id) ?? [];
    const byField = new Map<string, SemanticBinding[]>();
    for (const binding of owned) if (binding.owner.kind === 'record') append(byField, binding.owner.field, binding);
    const fields = Object.keys(record.fields).sort(compare).map(field => {
      const matches = byField.get(field) ?? [];
      invariant(matches.length === 1, 'record field binding coverage is incomplete or ambiguous');
      return { field, bindingId: matches[0].id };
    });
    invariant(fields.length === owned.length, 'extra record binding is not represented by a field');
    const { fields: _fields, ...metadata } = record;
    units.push(finish({ id: `recordInfo:${record.id}` as ProjectionUnitId, kind: 'recordInfo', label: `${record.collection}.${record.name}`,
      owner: { kind: 'record', id: record.id }, revision: record.revision, dependencyUnitIds: [], identifierIds: [], attachmentIds: [], record: metadata, fields }));
  }
  units.sort((a, b) => compare(a.id, b.id)); owners.sort((a, b) => compare(a.noteId, b.noteId));
  const payload = { format: 'grasp-projection-catalog' as const, version: 1 as const, workspaceId: snapshot.id, workspaceRevision: snapshot.revision,
    semanticRevision: semantic.revision, units, identifiers: [...identifiers.values()].sort((a, b) => compare(a.id, b.id)),
    attachments: [...snapshot.attachments].sort((a, b) => compare(a.id, b.id)), owners };
  return clone({ ...payload, fingerprint: hash(projectionJson(payload)) });
}

const reservedName = /^(?:con(?:in\$|out\$)?|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
/** Portable lexical validation; filesystem reparse/symlink checks belong to the host. */
export function validateProjectionPath(path: string, markdown = true, internal = false): void {
  invariant(typeof path === 'string' && path.length > 0 && path.length <= 4096 && !path.includes('\\'), 'output path must be bounded and relative');
  const parts = path.split('/');
  for (const part of parts) invariant(part.length > 0 && part.length <= 255 && part !== '.' && part !== '..'
    && !/[<>:"|?*\u0000-\u001f\u007f]/.test(part) && !/[ .]$/.test(part) && !reservedName.test(part), 'unsafe or reserved output path');
  invariant(!markdown || /\.md$/i.test(path), 'group path must be a Markdown filename');
  invariant(internal || !['.grasp', '.grasp-export', '_attachments', '_unassigned'].includes(pathKey(parts[0])), 'output path uses an internal reserved directory');
}
function validatePaths(paths: readonly string[]): void {
  const files = new Set<string>(), directories = new Set<string>();
  for (const path of paths) {
    const key = pathKey(path); invariant(!files.has(key) && !directories.has(key), 'duplicate/case/Unicode output path or file-directory collision');
    const parts = key.split('/'); let prefix = '';
    for (let index = 0; index < parts.length - 1; index++) {
      prefix = prefix ? prefix + '/' + parts[index] : parts[index];
      invariant(!files.has(prefix), 'output path file-directory collision'); directories.add(prefix);
    }
    files.add(key);
  }
}
function validateStrategy(strategy: ProjectionStrategy, workspaceId: string): void {
  knownKeys(strategy, ['format', 'version', 'workspaceId', 'revision', 'planningPackageId', 'groups', 'unassigned'], 'strategy');
  invariant(strategy?.format === 'grasp-projection-strategy' && strategy.version === 1 && strategy.workspaceId === workspaceId
    && Number.isSafeInteger(strategy.revision) && strategy.revision >= 0 && typeof strategy.planningPackageId === 'string'
    && strategy.unassigned === 'deterministic-default-v1', 'unsupported strategy or workspace');
  unique(strategy.groups, group => group.id, 'strategy groups');
  const assigned = new Set<string>();
  for (const group of strategy.groups) {
    knownKeys(group, ['id', 'path', 'render', 'members'], 'strategy group');
    invariant(group.id.length <= 200 && !/[\u0000-\u001f]/.test(group.id) && group.render === 'sections-v1', 'unsupported group identity/profile');
    validateProjectionPath(group.path);
    invariant(Array.isArray(group.members), 'group members must be an array');
    for (const id of group.members) { invariant(typeof id === 'string' && /^(noteProse|binding|recordInfo):.+/.test(id) && !assigned.has(id), 'duplicate or invalid canonical assignment'); assigned.add(id); }
  }
  validatePaths(strategy.groups.map(group => group.path));
}

function selectorExpander(catalog: ProjectionCatalog): (selectors: readonly ProjectionSelector[]) => ProjectionUnitId[] {
  const units = new Map<string, ProjectionUnit>(catalog.units.map(unit => [unit.id, unit]));
  const byOwner = new Map<string, ProjectionUnit[]>(), byIdentifier = new Map<string, ProjectionUnit[]>(), byField = new Map<string, ProjectionUnit[]>();
  for (const unit of catalog.units) {
    append(byOwner, `${unit.owner.kind}:${unit.owner.id}`, unit);
    if (unit.kind === 'binding') {
      append(byIdentifier, unit.binding.identifierId, unit);
      if (unit.binding.owner.kind === 'record') append(byField, JSON.stringify([unit.binding.owner.recordId, unit.binding.owner.field]), unit);
    }
  }
  return selectors => {
  invariant(Array.isArray(selectors), 'selectors must be an array');
  const result: ProjectionUnitId[] = [], seen = new Set<string>();
  for (const selector of selectors) {
    let selected: ProjectionUnit[];
    if (typeof selector === 'string') { const unit = units.get(selector); invariant(unit, `unknown unit ${selector}`); selected = [unit]; }
    else {
      invariant(selector && typeof selector === 'object', 'invalid selector');
      knownKeys(selector, selector.kind === 'record-field' ? ['kind', 'recordId', 'field'] : ['kind', 'id'], 'selector');
      if (selector.kind === 'note' || selector.kind === 'record') selected = byOwner.get(`${selector.kind}:${selector.id}`) ?? [];
      else if (selector.kind === 'identifier') {
        selected = byIdentifier.get(selector.id) ?? [];
        invariant(selected.length === 1, 'identifier selector has no unique binding; select an explicit terminal unit');
      } else if (selector.kind === 'record-field') selected = byField.get(JSON.stringify([selector.recordId, selector.field])) ?? [];
      else throw new Error('Invalid projection: unsupported selector kind');
      invariant(selected.length > 0, 'selector does not identify an existing unit');
    }
    for (const unit of selected) { invariant(!seen.has(unit.id), 'selector aliases overlap the same canonical unit'); seen.add(unit.id); result.push(unit.id); }
  }
  return result;
  };
}
const expand = (catalog: ProjectionCatalog, selectors: readonly ProjectionSelector[]) => selectorExpander(catalog)(selectors);
function assignments(groups: readonly ProjectionGroup[]): Map<ProjectionUnitId, { groupId: string; path: string }> {
  return new Map(groups.flatMap(group => group.members.map(id => [id, { groupId: group.id, path: group.path }] as const)));
}
function safeComponent(component: string): string {
  let safe = component.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[ .]+$/, '').slice(0, 120) || 'untitled';
  if (safe === '.' || safe === '..' || reservedName.test(safe) || ['.grasp', '.grasp-export', '_attachments', '_unassigned'].includes(pathKey(safe))) safe = '_' + safe;
  return safe;
}
export function createDefaultProjectionStrategy(catalog: ProjectionCatalog): ProjectionStrategy {
  const groups: ProjectionGroup[] = [];
  const bindingsByOwner = new Map<string, ProjectionUnit[]>();
  for (const unit of catalog.units) if (unit.kind === 'binding') append(bindingsByOwner, `${unit.owner.kind}:${unit.owner.id}`, unit);
  for (const unit of catalog.units) if (unit.kind === 'noteProse' || unit.kind === 'recordInfo') {
    const base = unit.kind === 'noteProse' ? unit.sourceNotePath ?? `${unit.note.title}.md` : `Records/${unit.record.collection}/${unit.record.name}.md`;
    const path = base.split('/').map(safeComponent).join('/');
    groups.push({ id: `default-${unit.stableKey}`, path: /\.md$/i.test(path) ? path : path + '.md', render: 'sections-v1',
      members: [unit.id, ...(bindingsByOwner.get(`${unit.owner.kind}:${unit.owner.id}`) ?? []).map(other => other.id)] });
  }
  const counts = new Map<string, number>();
  for (const group of groups) counts.set(pathKey(group.path), (counts.get(pathKey(group.path)) ?? 0) + 1);
  for (const group of groups) if (counts.get(pathKey(group.path))! > 1) group.path = group.path.slice(0, -3) + '--' + group.id.slice(-20) + '.md';
  // Extremely unusual logical names can use a *.md folder as another file's
  // ancestor. Keep identities/hierarchy in metadata and use a stable safe path.
  try { validatePaths(groups.map(group => group.path)); }
  catch { for (const group of groups) group.path = `Notes/${group.id}.md`; }
  const strategy: ProjectionStrategy = { format: 'grasp-projection-strategy', version: 1, workspaceId: catalog.workspaceId, revision: 0,
    planningPackageId: 'initial-deterministic-default', groups, unassigned: 'deterministic-default-v1' };
  validateStrategy(strategy, catalog.workspaceId); return strategy;
}

export function createProjectionPlanningPackage(catalog: ProjectionCatalog, options: {
  id: string; strategyRevision: number; units?: ProjectionSelector[]; provided?: 'full' | 'metadata';
}): ProjectionPlanningPackage {
  invariant(typeof options.id === 'string' && options.id.length > 0 && Number.isSafeInteger(options.strategyRevision) && options.strategyRevision >= 0, 'invalid planning package identity/base');
  const selected = new Set(options.units ? expand(catalog, options.units) : catalog.units.map(unit => unit.id));
  return clone({ format: 'grasp-projection-planning-package', version: 1, id: options.id, workspaceId: catalog.workspaceId,
    base: { workspaceRevision: catalog.workspaceRevision, strategyRevision: options.strategyRevision }, catalogFingerprint: catalog.fingerprint,
    units: catalog.units.filter(unit => selected.has(unit.id)).map(unit => ({ id: unit.id, revision: unit.revision, hash: unit.hash,
      provided: options.provided ?? 'metadata', ...(options.provided === 'full' ? { unit } : {}) })) });
}

export function reviewProjectionProposal(catalog: ProjectionCatalog, proposal: ProjectionProposal,
  previousStrategy?: ProjectionStrategy | null, planningPackage?: ProjectionPlanningPackage): ProjectionReview {
  const diagnostics: ProjectionDiagnostic[] = [];
  try {
    knownKeys(proposal, ['format', 'version', 'workspaceId', 'base', 'planningPackageId', 'coverage', 'groups', 'unassigned', 'unassign', 'rationale'], 'proposal');
    knownKeys(proposal.base, ['workspaceRevision', 'strategyRevision'], 'proposal base');
    knownKeys(proposal.coverage, ['mode', 'units'], 'proposal coverage');
    invariant(proposal.rationale === undefined || typeof proposal.rationale === 'string', 'proposal rationale must be text');
    if (previousStrategy) validateStrategy(previousStrategy, catalog.workspaceId);
    invariant(proposal?.format === 'grasp-projection-proposal' && proposal.version === 1 && proposal.workspaceId === catalog.workspaceId
      && proposal.base?.workspaceRevision === catalog.workspaceRevision && proposal.base.strategyRevision === (previousStrategy?.revision ?? 0), 'proposal base is stale or belongs to another workspace');
    invariant(proposal.unassigned === 'deterministic-default-v1' && typeof proposal.planningPackageId === 'string' && proposal.planningPackageId.length > 0
      && ['full', 'partial'].includes(proposal.coverage?.mode), 'unsupported proposal contract');
    const expandSelectors = selectorExpander(catalog);
    const covered = new Set(expandSelectors(proposal.coverage.units));
    if (proposal.coverage.mode === 'full') invariant(covered.size === catalog.units.length, 'full proposal coverage is incomplete');
    if (planningPackage) {
      invariant(planningPackage.format === 'grasp-projection-planning-package' && planningPackage.version === 1 && planningPackage.id === proposal.planningPackageId
        && planningPackage.workspaceId === catalog.workspaceId && planningPackage.catalogFingerprint === catalog.fingerprint
        && planningPackage.base.workspaceRevision === catalog.workspaceRevision && planningPackage.base.strategyRevision === (previousStrategy?.revision ?? 0), 'planning package is stale or mismatched');
      const packageUnits = unique(planningPackage.units, unit => unit.id, 'planning package units');
      const current = new Map(catalog.units.map(unit => [unit.id, unit]));
      for (const id of covered) {
        const supplied = packageUnits.get(id), unit = current.get(id)!;
        invariant(supplied && supplied.revision === unit.revision && supplied.hash === unit.hash, 'proposal exceeds or changes its planning package scope');
        invariant(supplied.provided === 'metadata' ? supplied.unit === undefined : supplied.provided === 'full'
          && projectionJson(supplied.unit) === projectionJson(unit), 'planning package supplied content is inconsistent');
      }
    }
    unique(proposal.groups, group => group.id, 'proposal groups');
    const assigned = new Set<ProjectionUnitId>();
    const incoming: ProjectionGroup[] = proposal.groups.map(group => {
      knownKeys(group, ['id', 'path', 'render', 'members'], 'proposal group');
      const members = expandSelectors(group.members);
      for (const id of members) { invariant(covered.has(id), 'group member is outside the proposal coverage'); invariant(!assigned.has(id), 'duplicate canonical assignment across groups'); assigned.add(id); }
      return { id: group.id, path: group.path, render: group.render, members };
    });
    const unassigned = new Set(expandSelectors(proposal.unassign ?? []));
    for (const id of unassigned) invariant(covered.has(id) && !assigned.has(id), 'explicit unassign is outside coverage or conflicts with an assignment');
    let groups = incoming;
    if (proposal.coverage.mode === 'partial' && previousStrategy) {
      const incomingById = new Map(incoming.map(group => [group.id, group]));
      groups = previousStrategy.groups.map(group => {
        const retained = group.members.filter(id => !assigned.has(id) && !unassigned.has(id));
        const replacement = incomingById.get(group.id);
        if (!replacement) return { ...group, members: retained };
        incomingById.delete(group.id);
        invariant(!retained.length || (group.path === replacement.path && group.render === replacement.render), 'partial proposal would move unselected group members');
        return { ...replacement, members: [...retained, ...replacement.members] };
      }).filter(group => group.members.length > 0);
      groups.push(...incomingById.values());
    }
    const strategy: ProjectionStrategy = { format: 'grasp-projection-strategy', version: 1, workspaceId: catalog.workspaceId,
      revision: (previousStrategy?.revision ?? 0) + 1, planningPackageId: proposal.planningPackageId, groups, unassigned: 'deterministic-default-v1' };
    validateStrategy(strategy, catalog.workspaceId);
    const before = assignments(previousStrategy?.groups ?? []), after = assignments(groups);
    const changes = catalog.units.flatMap(unit => projectionJson(before.get(unit.id)) === projectionJson(after.get(unit.id)) ? []
      : [{ unitId: unit.id, before: before.get(unit.id) ?? null, after: after.get(unit.id) ?? null }]);
    return clone({ canApply: true, diagnostics, unassigned: catalog.units.filter(unit => !after.has(unit.id)).map(unit => unit.id), changes, strategy });
  } catch (error) {
    diagnostics.push({ code: 'invalid-proposal', message: error instanceof Error ? error.message : 'Invalid proposal data.' });
    return { canApply: false, diagnostics, unassigned: [], changes: [] };
  }
}

export function compileProjectionPlan(catalog: ProjectionCatalog, strategy: ProjectionStrategy, scope: ProjectionScope = { mode: 'full' }): ProjectionPlan {
  validateStrategy(strategy, catalog.workspaceId);
  invariant(scope.mode === 'full' || scope.mode === 'partial', 'unsupported projection scope');
  invariant(scope.mode !== 'full' || !scope.units, 'a full export cannot silently ignore a selected subset');
  const selected = scope.mode === 'full' ? catalog.units.map(unit => unit.id) : expand(catalog, scope.units ?? []);
  const included = new Set(selected), unitMap = new Map(catalog.units.map(unit => [unit.id, unit]));
  if (scope.includeDependencies) {
    const queue = [...selected];
    for (let index = 0; index < queue.length; index++) for (const id of unitMap.get(queue[index])!.dependencyUnitIds) if (!included.has(id)) { included.add(id); queue.push(id); }
  }
  const diagnostics: ProjectionDiagnostic[] = [];
  const groups = strategy.groups.map(group => ({ ...group, members: group.members.filter(id => {
    if (!unitMap.has(id)) diagnostics.push({ code: 'deleted-unit', unitId: id, message: 'Accepted strategy refers to a unit no longer present in the current snapshot.' });
    return included.has(id);
  }) })).filter(group => group.members.length > 0);
  const assigned = new Set(groups.flatMap(group => group.members));
  const units = catalog.units.filter(unit => included.has(unit.id)).map(clone);
  for (const unit of units) if (!assigned.has(unit.id)) {
    diagnostics.push({ code: 'unassigned', unitId: unit.id, message: 'Unit uses the deterministic unassigned location until reviewed.' });
    groups.push({ id: `unassigned-${unit.stableKey}`, path: `_Unassigned/${unit.kind}/${unit.stableKey}.md`, render: 'sections-v1', members: [unit.id] });
  }
  groups.sort((a, b) => compare(a.path, b.path) || compare(a.id, b.id));
  const includedIdentifierIds = new Set(units.flatMap(unit => unit.identifierIds));
  const identifiers = catalog.identifiers.filter(identifier => includedIdentifierIds.has(identifier.id)).map(clone);
  const targetMap = groups.flatMap(group => group.members.map(unitId => ({ unitId, path: group.path, anchor: `grasp-${unitMap.get(unitId)!.stableKey}` })));
  const assetIds = new Set(scope.mode === 'full' ? catalog.attachments.map(asset => asset.id) : [...units.flatMap(unit => unit.attachmentIds), ...scope.attachmentIds ?? []]);
  const knownAssetIds = new Set(catalog.attachments.map(asset => asset.id));
  invariant([...assetIds].every(id => knownAssetIds.has(id)), 'explicit attachment scope contains an unknown identity');
  const attachments = catalog.attachments.filter(asset => assetIds.has(asset.id)).map(asset => ({ ...clone(asset), file: `_Attachments/${asset.path}` }));
  for (const asset of attachments) validateProjectionPath(asset.file, false, true);
  validatePaths([...groups.map(group => group.path), ...attachments.map(asset => asset.file)]);
  for (const unit of units) for (const link of unit.links ?? []) {
    if ((link.targetUnitId && !included.has(link.targetUnitId)) || (link.attachmentId && !assetIds.has(link.attachmentId))) {
      link.status = 'omitted'; link.message = 'Target is outside the explicit export scope.';
    }
  }
  const includedDefinitions = new Set(units.flatMap(unit => unit.kind === 'binding' ? [unit.binding.identifierId] : []));
  const allDefinitions = new Set(catalog.units.flatMap(unit => unit.kind === 'binding' ? [unit.binding.identifierId] : []));
  const omittedTargets = identifiers.filter(identifier => !includedDefinitions.has(identifier.id)).map(identifier => ({ identifierId: identifier.id, name: identifier.name,
    reason: allDefinitions.has(identifier.id) ? 'Definition is outside the selected scope.' : 'Identifier has no definition.' }));
  return { version: 1, workspaceId: catalog.workspaceId, workspaceRevision: catalog.workspaceRevision, strategyRevision: strategy.revision,
    scope: { mode: scope.mode, selected: sorted(selected), included: sorted(included), omitted: catalog.units.filter(unit => !included.has(unit.id)).map(unit => unit.id), dependencyClosure: !!scope.includeDependencies },
    units, identifiers, groups, targetMap, attachments, omittedTargets, diagnostics };
}

export function createFullProjectionBundle(snapshot: WorkspaceSnapshot, semantic: SharedSemanticState, strategy: ProjectionStrategy,
  options: ProjectionHash & { lineageId?: string; provenance?: unknown }): FullProjectionBundle {
  const catalog = createProjectionCatalog(snapshot, semantic, options);
  compileProjectionPlan(catalog, strategy, { mode: 'full' });
  return clone({ format: 'grasp-full-fallback', version: 1, exporterVersion: 1, workspaceLineageId: options.lineageId ?? snapshot.id,
    snapshot, semantic, strategy, owners: catalog.owners, ...(options.provenance === undefined ? {} : { provenance: options.provenance }) });
}

/** Validate portable semantics without trusting renderer output or creating IDs. */
export function validateFullProjectionBundle(input: unknown, options: ProjectionHash): { bundle: FullProjectionBundle; catalog: ProjectionCatalog } {
  const bundle = clone(input) as FullProjectionBundle;
  knownKeys(bundle, ['format', 'version', 'exporterVersion', 'workspaceLineageId', 'snapshot', 'semantic', 'strategy', 'owners', 'provenance'], 'full fallback');
  invariant(bundle?.format === 'grasp-full-fallback' && bundle.version === 1 && bundle.exporterVersion === 1
    && typeof bundle.workspaceLineageId === 'string' && bundle.workspaceLineageId.length > 0, 'unsupported full fallback version/lineage');
  invariant(bundle.snapshot && bundle.semantic && bundle.strategy && Array.isArray(bundle.owners), 'full fallback metadata is incomplete');
  const catalog = createProjectionCatalog(bundle.snapshot, bundle.semantic, options);
  invariant(projectionJson(bundle.owners) === projectionJson(catalog.owners), 'owner layout/source coverage is incomplete, overlapping or inconsistent');
  compileProjectionPlan(catalog, bundle.strategy, { mode: 'full' });
  const prepared = prepareSharedWorkspace({ ...bundle.snapshot, revision: bundle.semantic.revision }, { hash: options.hash,
    previous: bundle.semantic, previousSnapshot: bundle.snapshot, newId: () => { throw new Error('Invalid projection: semantic coverage would require a new identity'); } });
  invariant(prepared.canCommit && prepared.patches.length === 0, 'fallback source/cache semantics require repair');
  const comparable = (state: SharedSemanticState) => ({ ...state,
    identifiers: [...state.identifiers].sort((a, b) => compare(a.id, b.id)), bindings: [...state.bindings].sort((a, b) => compare(a.id, b.id)),
    occurrences: [...state.occurrences].sort((a, b) => compare(a.id, b.id)), results: [...state.results].sort((a, b) => compare(a.identifierId, b.identifierId)),
    sources: [...state.sources].sort((a, b) => compare(a.noteId, b.noteId)) });
  invariant(projectionJson(comparable(prepared.state)) === projectionJson(comparable(bundle.semantic)), 'fallback semantic identities, values or relations disagree with exact source');
  return { bundle, catalog };
}
