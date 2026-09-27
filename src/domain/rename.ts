import { buildKnowledge } from './knowledge';
import { IDENTIFIER_PATTERN } from './template';
import { parser as markdownParser } from '@lezer/markdown';
import type { Definition, Note, ParseResult, SourceLocation, StructuredRecord, ValueOwner, WorkspaceSnapshot } from './model';

export interface RenameRequest { from: string; to: string; mode: 'identifier' | 'namespace' }
export interface RenameEdit {
  kind: 'declaration' | 'reference' | 'dependency' | 'record-collection' | 'record-name' | 'record-field';
  from: number; to: number; before: string; after: string; location: SourceLocation; owner: ValueOwner;
}
export interface RenameDiagnostic { severity: 'error' | 'warning'; kind: string; message: string; name?: string; location?: SourceLocation }
export interface RenamePlan {
  workspaceId: string; workspaceRevision: number; request: RenameRequest; canApply: boolean;
  renames: Array<{ from: string; to: string; definitions: number; references: number }>;
  changes: Array<{ id: string; title: string; before: string; after: string; edits: RenameEdit[] }>;
  recordChanges: Array<{ id: string; before: StructuredRecord; after: StructuredRecord; edits: RenameEdit[] }>;
  /** Complete proposed collections; revisions remain the source revisions until the host commits. */
  notes: Note[]; records: StructuredRecord[]; diagnostics: RenameDiagnostic[];
  impact: {
    /** Post-rename names changed directly, followed by their remaining downstream dependents. */
    direct: string[]; transitive: string[]; noteIds: string[]; recordIds: string[];
    missingBefore: string[]; missingAfter: string[]; cyclesBefore: string[]; cyclesAfter: string[];
  };
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key); if (list) list.push(value); else map.set(key, [value]);
}
function definitionIndex(parsed: ParseResult): Map<string, Definition[]> {
  const index = new Map<string, Definition[]>();
  for (const definition of parsed.definitions) append(index, definition.name, definition);
  return index;
}
function topology(parsed: ParseResult): { missing: string[]; cycles: string[]; reverse: Map<string, string[]> } {
  const definitions = definitionIndex(parsed);
  const edges = new Map<string, string[]>(), reverse = new Map<string, string[]>();
  for (const [name, owners] of definitions) {
    const dependencies = [...new Set(owners.flatMap(owner => owner.dependencies))];
    edges.set(name, dependencies.filter(dependency => definitions.has(dependency)));
    for (const dependency of dependencies) append(reverse, dependency, name);
  }
  // Iterative Kosaraju passes identify every member of a cycle without evaluating strings.
  const visited = new Set<string>(), finished: string[] = [];
  for (const name of edges.keys()) {
    if (visited.has(name)) continue;
    visited.add(name);
    const stack = [{ name, cursor: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1], children = edges.get(frame.name)!;
      if (frame.cursor < children.length) {
        const child = children[frame.cursor++];
        if (!visited.has(child)) { visited.add(child); stack.push({ name: child, cursor: 0 }); }
      } else { finished.push(frame.name); stack.pop(); }
    }
  }
  const assigned = new Set<string>(), cycles: string[] = [];
  for (let at = finished.length - 1; at >= 0; at--) {
    const name = finished[at]; if (assigned.has(name)) continue;
    const component = [name]; assigned.add(name);
    for (let i = 0; i < component.length; i++) for (const parent of reverse.get(component[i]) ?? []) {
      if (!assigned.has(parent)) { assigned.add(parent); component.push(parent); }
    }
    if (component.length > 1 || edges.get(name)!.includes(name)) for (const member of component) cycles.push(member);
  }
  return { missing: [...new Set(parsed.references.filter(reference => !definitions.has(reference.name)).map(reference => reference.name))].sort(), cycles: cycles.sort(), reverse };
}
function applyEdits(source: string, edits: RenameEdit[]): string {
  let end = source.length;
  const parts: string[] = [];
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    if (edit.from < 0 || edit.to > end || source.slice(edit.from, edit.to) !== edit.before) throw new Error('Semantic rename spans overlap or no longer match their source.');
    parts.push(source.slice(edit.to, end), edit.after); end = edit.from;
  }
  parts.push(source.slice(0, end));
  return parts.reverse().join('');
}
const isRecordComponent = (value: string): boolean => IDENTIFIER_PATTERN.test(value) && value.length <= 100;

/** A reviewable, side-effect-free plan. The host owns authorization, token/revision checks and atomic commit. */
export function planRename(snapshot: WorkspaceSnapshot, request: RenameRequest): RenamePlan {
  const plan: RenamePlan = {
    workspaceId: snapshot.id, workspaceRevision: snapshot.revision, request: { ...request }, canApply: false,
    renames: [], changes: [], recordChanges: [], notes: [...snapshot.notes], records: [...snapshot.records], diagnostics: [],
    impact: { direct: [], transitive: [], noteIds: [], recordIds: [], missingBefore: [], missingAfter: [], cyclesBefore: [], cyclesAfter: [] },
  };
  const diagnostic = (kind: string, message: string, name?: string, severity: 'error' | 'warning' = 'error', location?: SourceLocation) => plan.diagnostics.push({ severity, kind, message, ...(name === undefined ? {} : { name }), ...(location ? { location } : {}) });
  if (!request || !['identifier', 'namespace'].includes(request.mode) || typeof request.from !== 'string' || typeof request.to !== 'string' || !IDENTIFIER_PATTERN.test(request.from) || !IDENTIFIER_PATTERN.test(request.to)) {
    diagnostic('invalid-request', '來源與目標必須符合 identifier 語法；mode 必須是 identifier 或 namespace。'); return plan;
  }
  if (request.from === request.to) { diagnostic('no-change', '來源與目標相同。'); return plan; }
  const rename = (name: string): string => name === request.from || (request.mode === 'namespace' && name.startsWith(`${request.from}.`)) ? request.to + name.slice(request.from.length) : name;
  const before = buildKnowledge(snapshot.notes, snapshot.records);
  const beforeDefinitions = definitionIndex(before);
  const counts = new Map<string, { from: string; to: string; definitions: number; references: number }>();
  for (const [kind, entries] of [['definitions', before.definitions], ['references', before.references]] as const) for (const entry of entries) {
    const target = rename(entry.name); if (target === entry.name) continue;
    const item = counts.get(entry.name) ?? { from: entry.name, to: target, definitions: 0, references: 0 };
    item[kind]++; counts.set(entry.name, item);
  }
  plan.renames = [...counts.values()].sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
  for (const item of plan.renames) {
    if (item.definitions > 1) diagnostic('ambiguous-definition', '來源 identifier 有多個定義，請先消除歧義。', item.from);
    else if (!item.definitions) diagnostic('reference-only', '此名稱沒有定義；本次只會更改其語意引用。', item.from, 'warning');
  }
  const noteEdits = new Map<string, RenameEdit[]>();
  const fieldEdits = new Map<string, Map<string, RenameEdit[]>>();
  const notesById = new Map(snapshot.notes.map(note => [note.id, note]));
  const recordsById = new Map(snapshot.records.map(record => [record.id, record]));
  if (notesById.size !== snapshot.notes.length || recordsById.size !== snapshot.records.length) { diagnostic('duplicate-owner', 'Workspace 含有重複的 note 或 record ID。'); return plan; }
  const addSemanticEdit = (entry: typeof before.references[number] | Definition, kind: 'declaration' | 'reference' | 'dependency') => {
    const target = rename(entry.name);
    if (target === entry.name) return;
    const owner = entry.owner, location = entry.nameLocation;
    // Record declarations are metadata, not character offsets in their field values.
    if (kind === 'declaration' && owner?.kind === 'record') return;
    if (!owner || !location) { diagnostic('missing-span', '解析器沒有提供可安全改寫的位置。', entry.name); return; }
    const source = owner.kind === 'note' ? notesById.get(owner.noteId)!.markdown : recordsById.get(owner.recordId)!.fields[owner.field];
    const edit: RenameEdit = { kind, from: location.from, to: location.to, before: source.slice(location.from, location.to), after: target, location, owner };
    if (owner.kind === 'note') append(noteEdits, owner.noteId, edit);
    else { let fields = fieldEdits.get(owner.recordId); if (!fields) fieldEdits.set(owner.recordId, fields = new Map()); append(fields, owner.field, edit); }
  };
  for (const definition of before.definitions) addSemanticEdit(definition, 'declaration');
  for (const reference of before.references) addSemanticEdit(reference, reference.kind);
  plan.notes = snapshot.notes.map(note => {
    const edits = noteEdits.get(note.id); if (!edits?.length) return note;
    const markdown = applyEdits(note.markdown, edits);
    plan.changes.push({ id: note.id, title: note.title, before: note.markdown, after: markdown, edits });
    return { ...note, markdown };
  });
  plan.records = snapshot.records.map(record => {
    let collection = record.collection, name = record.name;
    const prefix = `${record.collection}.${record.name}`;
    const edits: RenameEdit[] = [];
    const metadataEdit = (kind: 'record-collection' | 'record-name' | 'record-field', before: string, after: string, field = '') => {
      if (before === after) return;
      edits.push({ kind, from: 0, to: 0, before, after, location: { noteId: `record:${record.id}`, from: 0, to: 0, line: 1 },
        owner: { kind: 'record', recordId: record.id, collection: record.collection, recordName: record.name, field } });
    };
    let metadataRenamed = false;
    if (request.mode === 'namespace' && rename(record.collection) !== record.collection) {
      collection = rename(record.collection); metadataRenamed = true;
      if (!isRecordComponent(collection)) diagnostic('record-ownership', '目標 collection 不符合 record component 語法或超過 100 字元。', collection);
      metadataEdit('record-collection', record.collection, collection);
    } else if (request.mode === 'namespace' && rename(prefix) !== prefix) {
      const targetPrefix = rename(prefix);
      if (!targetPrefix.startsWith(`${record.collection}.`)) {
        diagnostic('record-ownership', `Record namespace 的目標必須保留已知 collection “${record.collection}”；跨 collection 請直接重新命名 collection，避免猜測 dotted owner。`, prefix);
      } else {
        name = targetPrefix.slice(record.collection.length + 1); metadataRenamed = true;
        if (!isRecordComponent(name)) diagnostic('record-ownership', '目標 record name 不符合語法或超過 100 字元。', name);
        metadataEdit('record-name', record.name, name);
      }
    }
    const fields: [string, string][] = [];
    const seenFields = new Set<string>();
    for (const [field, value] of Object.entries(record.fields)) {
      const current = `${prefix}.${field}`, target = rename(current);
      let nextField = field;
      if (target !== current && !metadataRenamed) {
        if (!target.startsWith(`${prefix}.`)) diagnostic('record-ownership', '單一 record 欄位只能在其已知 collection / record 內改名；不會推測新的 owner。', current);
        else {
          nextField = target.slice(prefix.length + 1);
          if (!isRecordComponent(nextField)) diagnostic('record-ownership', '目標欄位名稱不符合語法或超過 100 字元。', target);
          metadataEdit('record-field', field, nextField, field);
        }
      }
      if (seenFields.has(nextField)) diagnostic('field-collision', '改名後會覆蓋既有 record 欄位。', `${collection}.${name}.${nextField}`);
      seenFields.add(nextField);
      const changes = fieldEdits.get(record.id)?.get(field) ?? [];
      for (const change of changes) edits.push(change);
      fields.push([nextField, changes.length ? applyEdits(value, changes) : value]);
    }
    if (!edits.length) return record;
    const after = { ...record, collection, name, fields: Object.fromEntries(fields) };
    plan.recordChanges.push({ id: record.id, before: record, after, edits });
    return after;
  });
  const recordNames = new Set<string>();
  for (const record of plan.records) {
    const identity = JSON.stringify([record.collection, record.name]);
    if (recordNames.has(identity)) diagnostic('record-collision', '改名後會產生重複的 collection / record name。', `${record.collection}.${record.name}`);
    recordNames.add(identity);
  }
  // Query JSON is another language inside code fences. Preserve it rather than
  // silently rewriting literals, but never approve a rename that empties its view.
  const movedCollections = new Set(plan.recordChanges.filter(change => change.before.collection !== change.after.collection).map(change => change.before.collection));
  const movedFields = new Map<string, Set<string>>();
  for (const change of plan.recordChanges) for (const edit of change.edits) if (edit.kind === 'record-field') {
    const fields = movedFields.get(change.before.collection) ?? new Set<string>(); fields.add(edit.before); movedFields.set(change.before.collection, fields);
  }
  if (movedCollections.size || movedFields.size) for (const note of snapshot.notes) {
    markdownParser.parse(note.markdown).iterate({ enter(node) {
      if (node.name !== 'FencedCode') return;
      const info = node.node.getChild('CodeInfo');
      if (!info || note.markdown.slice(info.from, info.to).trim() !== 'grasp-query') return false;
      const code = node.node.getChildren('CodeText').map(child => note.markdown.slice(child.from, child.to)).join('\n');
      try {
        const query = JSON.parse(code);
        if (query && typeof query.collection === 'string' && (movedCollections.has(query.collection) || movedFields.get(query.collection)?.has(query.where?.field))) {
          const line = note.markdown.slice(0, node.from).split('\n').length;
          diagnostic('query-impact', '此 grasp-query 使用將被改名的 collection 或篩選欄位。請先明確調整查詢，再重新預覽；改名不會暗中覆寫 code fence。', query.collection, 'error', { noteId: note.id, from: node.from, to: node.to, line });
        }
      } catch { /* Malformed query source is already inactive and remains verbatim. */ }
      return false;
    } });
  }
  if (!plan.changes.length && !plan.recordChanges.length) diagnostic('no-match', '找不到可更改的語意定義、引用或 record namespace。');
  const after = buildKnowledge(plan.notes, plan.records), afterDefinitions = definitionIndex(after);
  for (const [name, owners] of afterDefinitions) if (owners.length > 1) {
    const involved = plan.renames.some(item => item.to === name);
    diagnostic('definition-collision', involved ? '目標 identifier 已有其他定義；不會合併或覆蓋。' : 'Workspace 原有重複定義尚未解決。', name, involved ? 'error' : 'warning', owners[0].location);
  }
  const beforeTopology = topology(before), afterTopology = topology(after);
  Object.assign(plan.impact, { missingBefore: beforeTopology.missing, missingAfter: afterTopology.missing, cyclesBefore: beforeTopology.cycles, cyclesAfter: afterTopology.cycles });
  const expectedMissing = new Set(beforeTopology.missing.map(rename)), expectedCycles = new Set(beforeTopology.cycles.map(rename));
  for (const name of afterTopology.missing) if (!expectedMissing.has(name)) diagnostic('new-missing', '改名會產生新的未定義引用。', name);
  for (const name of afterTopology.cycles) if (!expectedCycles.has(name)) diagnostic('new-cycle', '目標名稱會使既有引用重新綁定，產生新的依賴循環。', name);
  if (afterTopology.missing.length) diagnostic('existing-missing', `改名後仍有 ${afterTopology.missing.length} 個未定義的引用名稱；請檢查影響清單。`, undefined, 'warning');
  if (afterTopology.cycles.length && !plan.diagnostics.some(item => item.kind === 'new-cycle')) diagnostic('existing-cycle', `改名後仍有 ${afterTopology.cycles.length} 個值位於既有依賴循環。`, undefined, 'warning');
  if (before.diagnostics.some(item => item.kind === 'syntax')) diagnostic('existing-syntax', 'Workspace 含有無法解析的語法；這些原文保持不變，未參與語意改名。', undefined, 'warning');
  const direct = new Set(plan.renames.map(item => item.to));
  for (const definition of before.definitions) if (definition.dependencies.some(dependency => rename(dependency) !== dependency)) direct.add(rename(definition.name));
  for (const name of beforeTopology.missing) if (rename(name) === name && afterDefinitions.has(name) && !beforeDefinitions.has(name)) {
    diagnostic('reference-rebound', '原先缺少定義的同名引用，改名後會連到這個新定義。', name, 'warning'); direct.add(name);
  }
  const affected = new Set(direct), queue = [...direct];
  for (let at = 0; at < queue.length; at++) for (const dependent of afterTopology.reverse.get(queue[at]) ?? []) if (!affected.has(dependent)) { affected.add(dependent); queue.push(dependent); }
  const noteIds = new Set(plan.changes.map(change => change.id)), recordIds = new Set(plan.recordChanges.map(change => change.id));
  for (const entries of [after.definitions, after.references]) for (const entry of entries) if (affected.has(entry.name)) {
    if (entry.owner?.kind === 'note') noteIds.add(entry.owner.noteId);
    else if (entry.owner?.kind === 'record') recordIds.add(entry.owner.recordId);
  }
  Object.assign(plan.impact, { direct: [...direct].sort(), transitive: [...affected].filter(name => !direct.has(name)).sort(), noteIds: [...noteIds].sort(), recordIds: [...recordIds].sort() });
  plan.canApply = !plan.diagnostics.some(item => item.severity === 'error') && !!(plan.changes.length || plan.recordChanges.length);
  return plan;
}
