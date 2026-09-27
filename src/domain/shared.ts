import type { Definition, Diagnostic, Note, NoteSyntaxVersion, Reference, RuntimeResult, SourceLocation, StructuredRecord, ValueOwner, ValuePart, ValueResult, WorkspaceSnapshot } from './model';
import { buildKnowledge } from './knowledge';
import { ValueGraph } from './graph';
import { IDENTIFIER_PATTERN, parseTemplate } from './template';
import { isQualifiedIdentifier, serializeRawLiteral } from './binding-language';
import { serializeReference } from './reference-language';
import { planRename } from './rename';

export interface SemanticIdentifier { id: string; name: string; revision: number }
export interface SemanticBinding {
  id: string; identifierId: string; name: string; revision: number; owner: ValueOwner; syntaxVersion: NoteSyntaxVersion;
  sourceRevision: number; sourceHash: string; location: SourceLocation; nameLocation?: SourceLocation;
  parts: ValuePart[]; dependencies: string[]; dependencyIds: string[]; fingerprint: string;
}
export interface SemanticResult {
  identifierId: string; name: string; current: ValueResult; semanticRevision: number; fingerprint: string;
  lastGood?: { value: string; semanticRevision: number; fingerprint: string };
}
export interface SemanticOccurrence {
  id: string; identifierId: string; name: string; owner: ValueOwner;
  representation: 'pure' | 'wiki' | 'legacy'; location: SourceLocation; nameLocation?: SourceLocation;
  sourceRevision: number; sourceHash: string;
  cache: { current: ValueResult; renderedValue: string; semanticRevision: number; inputFingerprint: string; source: 'computed' | 'last-good' | 'observation' };
}
export interface SemanticSource { noteId: string; revision: number; hash: string; syntaxVersion: NoteSyntaxVersion }
export interface SharedSemanticState {
  schemaVersion: 1; workspaceId: string; revision: number;
  identifiers: SemanticIdentifier[]; bindings: SemanticBinding[]; occurrences: SemanticOccurrence[]; results: SemanticResult[]; sources: SemanticSource[];
}
export interface SemanticIdentityHints {
  renames?: Array<{ from: string; to: string }>;
  bindingOwners?: Array<{ bindingId: string; owner: ValueOwner }>;
  occurrences?: Array<{ occurrenceId: string; noteId: string; from: number }>;
  sourceEdits?: SourceEditProof[];
}
/** One editor transaction, in raw UTF-16 offsets against its starting document. */
export interface RawSourceChange { from: number; to: number; insert: string; expected?: string }
export interface SourceEditProof { noteId: string; baseRevision: number; baseHash: string; steps: RawSourceChange[][] }
export interface SourceEditMapping { occurrences: Array<{ occurrenceId: string; noteId: string; from: number }>; retiredIds: string[] }

/** Replay an exact editing journal; never infer an identity from equal text. */
export function replaySourceEditProof(before: string, after: string, proof: SourceEditProof,
  occurrences: readonly SemanticOccurrence[]): SourceEditMapping {
  if (!Array.isArray(proof.steps)) throw new Error('Source edit proof steps must be an array.');
  let source = before;
  let tracked = occurrences.filter(item => item.owner.kind === 'note' && item.owner.noteId === proof.noteId)
    .map(item => ({ id: item.id, from: item.location.from, to: item.location.to })).sort((a, b) => a.from - b.from);
  const retiredIds: string[] = [];
  for (const changes of proof.steps) {
    if (!Array.isArray(changes)) throw new Error('Source edit proof transaction must be an array.');
    const pieces: string[] = []; let end = 0; let lastFrom = -1;
    for (const change of changes) {
      if (!change || !Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to)
        || change.from < end || change.from === lastFrom || change.to < change.from || change.to > source.length
        || typeof change.insert !== 'string' || (change.expected !== undefined && source.slice(change.from, change.to) !== change.expected)) {
        throw new Error('Source edit proof has invalid, overlapping or stale raw ranges.');
      }
      pieces.push(source.slice(end, change.from), change.insert); end = change.to; lastFrom = change.from;
    }
    pieces.push(source.slice(end));
    // Both lists are ordered. Skip completed edits once, keeping this linear in
    // tracked occurrences plus transaction changes rather than their product.
    let index = 0; let shift = 0;
    const survivors: typeof tracked = [];
    for (const item of tracked) {
      while (index < changes.length && changes[index].to <= item.from) {
        const change = changes[index++]; shift += change.insert.length - (change.to - change.from);
      }
      const next = changes[index];
      if (next && next.from < item.to && next.to > item.from) retiredIds.push(item.id);
      else survivors.push({ id: item.id, from: item.from + shift, to: item.to + shift });
    }
    tracked = survivors; source = pieces.join('');
  }
  if (source !== after) throw new Error('Source edit proof does not reproduce the submitted source.');
  return { occurrences: tracked.map(item => ({ occurrenceId: item.id, noteId: proof.noteId, from: item.from })), retiredIds };
}
export interface SemanticSourcePatch { noteId: string; from: number; to: number; before: string; after: string; reason: 'cache' }
export interface PrepareSharedOptions {
  previous?: SharedSemanticState; previousSnapshot?: WorkspaceSnapshot; graph?: ValueGraph;
  hash: (source: string) => string; newId: (kind: 'identifier' | 'binding' | 'occurrence') => string;
  identityHints?: SemanticIdentityHints;
}
export interface PreparedSharedWorkspace {
  state: SharedSemanticState; notes: Note[]; runtime: RuntimeResult; graph: ValueGraph;
  patches: SemanticSourcePatch[]; canCommit: boolean; diagnostics: Diagnostic[];
}

const ownerKey = (owner: ValueOwner): string => owner.kind === 'note' ? `note:${owner.noteId}` : JSON.stringify(['record', owner.recordId, owner.field]);
const actualSyntax = (note: Note): NoteSyntaxVersion => note.syntaxVersion ?? 'legacy-v0.2';
function partsOf(definition: Definition): ValuePart[] {
  const parts: ValuePart[] = definition.parts ?? parseTemplate(definition.template).map(part => part.kind === 'text'
    ? { kind: 'literal', value: part.text } : { kind: 'identifier', name: part.name });
  return parts.length ? parts : [{ kind: 'literal', value: '' }];
}
function semanticParts(parts: ValuePart[]): unknown[] {
  return parts.map(part => part.kind === 'literal' ? ['literal', part.value] : ['identifier', part.name]);
}
function addIndex<T>(map: Map<string, T[]>, key: string, item: T): void {
  const entries = map.get(key) ?? []; entries.push(item); map.set(key, entries);
}
function spanMapper(before: string, after: string): (from: number, to: number) => { from: number; to: number } | undefined {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length && suffix < after.length && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  return (from, to) => {
    // A repeated insertion can make both the unchanged prefix and suffix claim
    // the same old span at different new positions. Only an explicit edit map
    // may choose between them.
    if (to <= prefix && from >= before.length - suffix && before.length !== after.length) return;
    if (to <= prefix) return { from, to };
    if (from >= before.length - suffix) return { from: from + after.length - before.length, to: to + after.length - before.length };
  };
}
function applyPatches(source: string, patches: readonly { from: number; to: number; before: string; after: string }[]): string {
  let end = source.length;
  const pieces: string[] = [];
  for (const patch of [...patches].sort((a, b) => b.from - a.from)) {
    if (patch.from < 0 || patch.to > end || source.slice(patch.from, patch.to) !== patch.before) throw new Error('Source patches overlap or their original text changed.');
    pieces.push(source.slice(patch.to, end), patch.after); end = patch.from;
  }
  pieces.push(source.slice(0, end)); return pieces.reverse().join('');
}

/** Pure preparation. Only the host may publish the returned graph/state after its DB transaction succeeds. */
export function prepareSharedWorkspace(snapshot: WorkspaceSnapshot, options: PrepareSharedOptions): PreparedSharedWorkspace {
  const { hash, newId, previous, identityHints = {} } = options;
  if (previous && previous.workspaceId !== snapshot.id) throw new Error('Semantic state belongs to another workspace.');
  if (previous && snapshot.revision < previous.revision) throw new Error('Semantic candidate is older than committed state.');
  const renamed = new Map(identityHints.renames?.map(item => [item.from, item.to]));
  const rename = (name: string) => renamed.get(name) ?? name;
  const parsed = buildKnowledge(snapshot.notes, snapshot.records);
  const diagnostics = [...parsed.diagnostics];
  const priorSources = new Map(previous?.sources.map(source => [source.noteId, source]));
  const noteMap = new Map(snapshot.notes.map(note => [note.id, note]));
  const noteHashes = new Map(snapshot.notes.map(note => [note.id, hash(note.markdown)]));
  const previousNotes = new Map(options.previousSnapshot?.notes.map(note => [note.id, note]));
  const editMappings: SourceEditMapping[] = [];
  const provedNotes = new Set<string>();
  for (const proof of identityHints.sourceEdits ?? []) {
    const before = proof && previousNotes.get(proof.noteId), after = proof && noteMap.get(proof.noteId);
    const prior = proof && priorSources.get(proof.noteId);
    if (!proof || !before || !after || !prior || provedNotes.has(proof.noteId)
      || proof.baseRevision !== before.revision || proof.baseRevision !== prior.revision
      || proof.baseHash !== prior.hash || hash(before.markdown) !== proof.baseHash
      || actualSyntax(before) !== actualSyntax(after)) throw new Error('Source edit proof has a stale, duplicate or mismatched base.');
    provedNotes.add(proof.noteId);
    editMappings.push(replaySourceEditProof(before.markdown, after.markdown, proof, previous?.occurrences ?? []));
  }
  const spanMappers = new Map(snapshot.notes.flatMap(note => {
    const before = previousNotes.get(note.id);
    return before ? [[note.id, spanMapper(before.markdown, note.markdown)] as const] : [];
  }));
  const recordMap = new Map(snapshot.records.map(record => [record.id, record]));
  let canCommit = !parsed.diagnostics.some(diagnostic => {
    if (diagnostic.kind !== 'syntax') return false;
    const note = diagnostic.location && noteMap.get(diagnostic.location.noteId);
    if (!note) return true;
    const old = priorSources.get(note.id);
    // Existing legacy documents remain readable during migration. New/changed
    // invalid text is a draft and must not replace the committed semantics.
    return !(actualSyntax(note) === 'legacy-v0.2' && (!previous || old?.hash === noteHashes.get(note.id)));
  });
  const conflict = (message: string, name?: string, location?: SourceLocation) => {
    diagnostics.push({ kind: 'syntax', message, name, location }); canCommit = false;
  };
  const identifiers: SemanticIdentifier[] = [];
  const identifierByName = new Map<string, SemanticIdentifier>();
  const previousByName = new Map<string, SemanticIdentifier[]>();
  for (const identifier of previous?.identifiers ?? []) addIndex(previousByName, rename(identifier.name), identifier);
  for (const name of new Set([...parsed.definitions.map(item => item.name), ...parsed.references.map(item => item.name)])) {
    const matches = previousByName.get(name) ?? [];
    if (matches.length > 1) conflict('Identity rename would merge distinct identifiers.', name);
    const old = matches.length === 1 ? matches[0] : undefined;
    const identifier = { id: old?.id ?? newId('identifier'), name, revision: old?.name === name ? old.revision : snapshot.revision };
    identifiers.push(identifier); identifierByName.set(name, identifier);
  }
  const graph = options.graph?.fork() ?? new ValueGraph();
  // A rehydrated process can start without an in-memory graph; persisted state
  // remains the authority and is never mutated during candidate preparation.
  let runtime = graph.update(parsed, snapshot.revision);
  const valueFingerprints = new Map(Object.entries(runtime.values).map(([name, value]) => [name, hash(JSON.stringify(value))]));
  const previousResults = new Map(previous?.results.map(item => [item.identifierId, item]));
  const definitionsByName = new Map<string, Definition[]>();
  for (const definition of parsed.definitions) addIndex(definitionsByName, definition.name, definition);
  const results: SemanticResult[] = identifiers.map(identifier => {
    const current = runtime.values[identifier.name] ?? { value: '', status: 'missing' as const, message: `Identifier “${identifier.name}” is not defined.` };
    const definitions = definitionsByName.get(identifier.name) ?? [];
    const fingerprint = hash(JSON.stringify([identifier.id, definitions.map(definition => semanticParts(partsOf(definition))),
      definitions.flatMap(definition => definition.dependencies.map(name => [identifierByName.get(name)?.id, valueFingerprints.get(name) ?? 'missing']))]));
    const old = previousResults.get(identifier.id);
    return { identifierId: identifier.id, name: identifier.name, current: { ...current }, semanticRevision: snapshot.revision, fingerprint,
      ...(current.status === 'ok' ? { lastGood: { value: current.value, semanticRevision: snapshot.revision, fingerprint } } : old?.lastGood ? { lastGood: { ...old.lastGood } } : {}) };
  });
  const resultById = new Map(results.map(result => [result.identifierId, result]));
  const oldBindingGroups = new Map<string, SemanticBinding[]>();
  const newBindingGroups = new Map<string, Definition[]>();
  for (const definition of parsed.definitions) addIndex(newBindingGroups, JSON.stringify([ownerKey(definition.owner!), definition.name]), definition);
  const ownerHints = new Map(identityHints.bindingOwners?.map(item => [item.bindingId, item.owner]));
  for (const binding of previous?.bindings ?? []) addIndex(oldBindingGroups, JSON.stringify([ownerKey(ownerHints.get(binding.id) ?? binding.owner), rename(binding.name)]), binding);
  const usedBindings = new Set<string>();
  const bindings: SemanticBinding[] = parsed.definitions.map(definition => {
    const owner = definition.owner!;
    const key = JSON.stringify([ownerKey(owner), definition.name]);
    const candidates = (oldBindingGroups.get(key) ?? []).filter(binding => !usedBindings.has(binding.id));
    const newGroup = newBindingGroups.get(key)!;
    const parts = partsOf(definition);
    const fingerprint = hash(JSON.stringify(semanticParts(parts)));
    const mapBinding = (binding: SemanticBinding) => owner.kind === 'note'
      ? priorSources.get(owner.noteId)?.hash === noteHashes.get(owner.noteId) ? binding.location : spanMappers.get(owner.noteId)?.(binding.location.from, binding.location.to)
      : binding.location;
    const exact = candidates.filter(binding => {
      const mapped = mapBinding(binding); return mapped?.from === definition.location.from && mapped?.to === definition.location.to;
    });
    const old = exact.length === 1 ? exact[0] : candidates.length === 1 && newGroup.length === 1 ? candidates[0] : undefined;
    const reservedElsewhere = candidates.every(binding => {
      const mapped = mapBinding(binding);
      return mapped && newGroup.some(item => item !== definition && item.location.from === mapped.from && item.location.to === mapped.to);
    });
    if (candidates.length && !old && !reservedElsewhere) conflict('Binding identity is ambiguous; source was preserved for review.', definition.name, definition.location);
    if (old) usedBindings.add(old.id);
    const note = owner.kind === 'note' ? noteMap.get(owner.noteId)! : undefined;
    const record = owner.kind === 'record' ? recordMap.get(owner.recordId)! : undefined;
    return { id: old?.id ?? newId('binding'), identifierId: identifierByName.get(definition.name)!.id, name: definition.name, owner: { ...owner },
      revision: old?.fingerprint === fingerprint && old.name === definition.name && ownerKey(old.owner) === ownerKey(owner) ? old.revision : snapshot.revision,
      syntaxVersion: note ? actualSyntax(note) : 'legacy-v0.2', sourceRevision: note?.revision ?? record!.revision,
      sourceHash: note ? noteHashes.get(note.id)! : hash(record!.fields[(owner as Extract<ValueOwner, { kind: 'record' }>).field]),
      location: { ...definition.location }, nameLocation: definition.nameLocation && { ...definition.nameLocation }, parts, dependencies: [...definition.dependencies],
      dependencyIds: definition.dependencies.map(name => identifierByName.get(name)!.id), fingerprint };
  });
  const references = parsed.references.filter(reference => reference.kind === 'reference');
  const occurrenceById = new Map(previous?.occurrences.map(item => [item.id, item]));
  const referenceStarts = new Map(references.map(reference => [JSON.stringify([ownerKey(reference.owner!), reference.location.from]), reference]));
  const retiredOccurrences = new Set(editMappings.flatMap(mapping => mapping.retiredIds));
  const explicitHints = new Map<string, { occurrenceId: string; noteId: string; from: number }>();
  const hintedTargets = new Set<string>();
  const addHint = (hint: { occurrenceId: string; noteId: string; from: number }) => {
    const old = occurrenceById.get(hint.occurrenceId);
    const key = JSON.stringify([`note:${hint.noteId}`, hint.from]);
    const target = referenceStarts.get(key);
    if (!old || old.owner.kind !== 'note' || old.owner.noteId !== hint.noteId || !Number.isSafeInteger(hint.from)
      || retiredOccurrences.has(old.id) || !target || target.name !== rename(old.name)
      || (target.representation ?? 'legacy') !== old.representation || explicitHints.has(old.id) || hintedTargets.has(key)) {
      throw new Error('Occurrence identity hint is unknown, duplicate or mismatches its source owner/target.');
    }
    explicitHints.set(old.id, hint); hintedTargets.add(key);
  };
  for (const mapping of editMappings) for (const hint of mapping.occurrences) {
    const old = occurrenceById.get(hint.occurrenceId)!;
    const target = referenceStarts.get(JSON.stringify([`note:${hint.noteId}`, hint.from]));
    // An unchanged raw token may cease to be a reference after a host-context
    // edit (e.g. inserting a code fence). Its old occurrence is then removed.
    if (!target || target.name !== rename(old.name) || (target.representation ?? 'legacy') !== old.representation) retiredOccurrences.add(old.id);
    else addHint(hint);
  }
  for (const hint of identityHints.occurrences ?? []) {
    if (provedNotes.has(hint.noteId)) throw new Error('An explicit occurrence hint cannot override a proved source edit.');
    addHint(hint);
  }
  const oldOccurrences = new Map<string, SemanticOccurrence[]>();
  for (const occurrence of previous?.occurrences ?? []) if (!retiredOccurrences.has(occurrence.id)) addIndex(oldOccurrences, JSON.stringify([ownerKey(occurrence.owner), rename(occurrence.name), occurrence.representation]), occurrence);
  const occurrencesByGroup = new Map<string, Reference[]>();
  for (const reference of references) addIndex(occurrencesByGroup, JSON.stringify([ownerKey(reference.owner!), reference.name, reference.representation ?? 'legacy']), reference);
  const occurrenceAt = new Map<string, SemanticOccurrence[]>();
  const locationKey = (key: string, from: number, to: number) => JSON.stringify([key, from, to]);
  const newOccurrenceLocations = new Set(references.map(reference => locationKey(
    JSON.stringify([ownerKey(reference.owner!), reference.name, reference.representation ?? 'legacy']), reference.location.from, reference.location.to)));
  const newOccurrenceStarts = new Map(references.map(reference => [JSON.stringify([ownerKey(reference.owner!), reference.location.from]), reference]));
  const explicitOccurrenceLocations = explicitHints;
  const uncertainOccurrences = new Set<string>();
  const uncertainCounts = new Map<string, number>();
  for (const [key, group] of oldOccurrences) for (const item of group) {
    const noteId = item.owner.kind === 'note' ? item.owner.noteId : undefined;
    let mapped = noteId ? priorSources.get(noteId)?.hash === noteHashes.get(noteId) ? item.location
      : spanMappers.get(noteId)?.(item.location.from, item.location.to) : undefined;
    const explicit = explicitOccurrenceLocations.get(item.id);
    if (explicit && explicit.noteId === noteId) {
      const target = newOccurrenceStarts.get(JSON.stringify([ownerKey(item.owner), explicit.from]));
      if (target?.name === rename(item.name) && (target.representation ?? 'legacy') === item.representation) mapped = target.location;
    }
    const mappedKey = mapped ? locationKey(key, mapped.from, mapped.to) : undefined;
    if (mappedKey && newOccurrenceLocations.has(mappedKey)) addIndex(occurrenceAt, mappedKey, item);
    else { uncertainOccurrences.add(item.id); uncertainCounts.set(key, (uncertainCounts.get(key) ?? 0) + 1); }
  }
  const occurrenceHints = new Map([...explicitHints.values()].map(item => [JSON.stringify([item.noteId, item.from]), item.occurrenceId]));
  const groupCursors = new Map<string, number>();
  const reportedAmbiguity = new Set<string>();
  const usedOccurrences = new Set<string>();
  const occurrences: SemanticOccurrence[] = [];
  const patches: SemanticSourcePatch[] = [];
  for (const reference of references) {
    const owner = reference.owner!;
    const key = JSON.stringify([ownerKey(owner), reference.name, reference.representation ?? 'legacy']);
    const group = oldOccurrences.get(key) ?? [];
    const ordinal = groupCursors.get(key) ?? 0; groupCursors.set(key, ordinal + 1);
    const note = owner.kind === 'note' ? noteMap.get(owner.noteId)! : undefined;
    const hinted = owner.kind === 'note' ? occurrenceHints.get(JSON.stringify([owner.noteId, reference.location.from])) : undefined;
    let old = hinted ? occurrenceById.get(hinted) : undefined;
    if (old && (ownerKey(old.owner) !== ownerKey(owner) || rename(old.name) !== reference.name || old.representation !== (reference.representation ?? 'legacy') || usedOccurrences.has(old.id))) old = undefined;
    if (hinted && !old) conflict('Occurrence identity hint does not match its owner or target.', reference.name, reference.location);
    const mapped = occurrenceAt.get(locationKey(key, reference.location.from, reference.location.to)) ?? [];
    if (!old && mapped.length === 1 && !usedOccurrences.has(mapped[0].id)) old = mapped[0];
    if (!old && group.length === 1 && occurrencesByGroup.get(key)!.length === 1 && !usedOccurrences.has(group[0].id)) old = group[0];
    if (!old && identityHints.renames?.length && group.length === occurrencesByGroup.get(key)!.length && !usedOccurrences.has(group[ordinal].id)) old = group[ordinal];
    if (!old && (uncertainCounts.get(key) ?? 0) && !reportedAmbiguity.has(key)) {
      conflict('Occurrence identity is ambiguous; provide a source mapping instead of guessing.', reference.name, reference.location); reportedAmbiguity.add(key);
    }
    if (old) {
      usedOccurrences.add(old.id);
      if (uncertainOccurrences.has(old.id)) uncertainCounts.set(key, (uncertainCounts.get(key) ?? 0) - 1);
    }
    const identifier = identifierByName.get(reference.name)!;
    const result = resultById.get(identifier.id)!;
    const renderedValue = result.current.status === 'ok' ? result.current.value : result.lastGood?.value ?? reference.cachedValue ?? old?.cache.renderedValue ?? '';
    const cache: SemanticOccurrence['cache'] = { current: { ...result.current }, renderedValue, semanticRevision: snapshot.revision,
      inputFingerprint: result.fingerprint, source: result.current.status === 'ok' ? 'computed' : result.lastGood ? 'last-good' : 'observation' };
    occurrences.push({ id: old?.id ?? newId('occurrence'), identifierId: identifier.id, name: reference.name, owner: { ...owner },
      representation: reference.representation ?? 'legacy', location: { ...reference.location }, nameLocation: reference.nameLocation && { ...reference.nameLocation },
      sourceRevision: note?.revision ?? 0, sourceHash: note ? noteHashes.get(note.id)! : hash(''), cache });
    if (note && reference.representation && reference.representation !== 'legacy') {
      const before = note.markdown.slice(reference.location.from, reference.location.to);
      const after = serializeReference({ kind: reference.representation, identifier: reference.name, value: renderedValue });
      if (before !== after) patches.push({ noteId: note.id, from: reference.location.from, to: reference.location.to, before, after, reason: 'cache' });
    }
  }
  const patchesByNote = new Map<string, SemanticSourcePatch[]>();
  for (const patch of patches) addIndex(patchesByNote, patch.noteId, patch);
  const notes = snapshot.notes.map(note => {
    const changes = patchesByNote.get(note.id);
    if (!changes?.length) return note;
    const oldRevision = priorSources.get(note.id)?.revision;
    return { ...note, markdown: applyPatches(note.markdown, changes),
      revision: oldRevision === undefined || note.revision > oldRevision ? note.revision : note.revision + 1 };
  });
  if (patches.length) {
    const finalParsed = buildKnowledge(notes, snapshot.records);
    const originalSyntax = parsed.diagnostics.filter(item => item.kind === 'syntax').map(item => item.message).sort();
    const finalSyntax = finalParsed.diagnostics.filter(item => item.kind === 'syntax').map(item => item.message).sort();
    if (JSON.stringify(originalSyntax) !== JSON.stringify(finalSyntax)) throw new Error('Cache serialization changed source validity.');
    const finalDefinitions = new Map<string, Definition[]>();
    const definitionCursors = new Map<string, number>();
    for (const definition of finalParsed.definitions) addIndex(finalDefinitions, ownerKey(definition.owner!), definition);
    for (const binding of bindings) {
      const key = ownerKey(binding.owner), index = definitionCursors.get(key) ?? 0;
      const match = finalDefinitions.get(key)?.[index]; definitionCursors.set(key, index + 1);
      if (!match || match.name !== binding.name) throw new Error('Cache serialization changed binding structure.');
      binding.location = { ...match.location }; binding.nameLocation = match.nameLocation && { ...match.nameLocation }; binding.parts = partsOf(match);
    }
    const finalRefs = finalParsed.references.filter(reference => reference.kind === 'reference');
    if (finalRefs.length !== occurrences.length) throw new Error('Cache serialization changed occurrence structure.');
    finalRefs.forEach((reference, index) => {
      const occurrence = occurrences[index];
      if (reference.name !== occurrence.name || ownerKey(reference.owner!) !== ownerKey(occurrence.owner)) throw new Error('Cache serialization changed occurrence ownership.');
      occurrence.location = { ...reference.location }; occurrence.nameLocation = reference.nameLocation && { ...reference.nameLocation };
    });
    runtime = graph.reindex(finalParsed)!;
  }
  const sources = notes.map(note => ({ noteId: note.id, revision: note.revision, hash: hash(note.markdown), syntaxVersion: actualSyntax(note) }));
  const sourceMap = new Map(sources.map(source => [source.noteId, source]));
  for (const item of [...bindings, ...occurrences]) if (item.owner.kind === 'note') {
    const source = sourceMap.get(item.owner.noteId)!; item.sourceRevision = source.revision; item.sourceHash = source.hash;
  }
  for (const binding of bindings) binding.parts = binding.parts.map(part => part.kind === 'identifier'
    ? { ...part, identifierId: identifierByName.get(part.name)!.id } : part);
  return { state: { schemaVersion: 1, workspaceId: snapshot.id, revision: snapshot.revision, identifiers, bindings, occurrences, results, sources }, notes,
    runtime, graph, patches, canCommit, diagnostics: [...runtime.diagnostics, ...diagnostics.slice(parsed.diagnostics.length)] };
}

export type SharedIntent =
  | { kind: 'set-literal'; bindingId: string; partIndex?: number; value: string; expectedSourceHash?: string }
  | { kind: 'set-dependency'; bindingId: string; partIndex: number; identifier: string; expectedSourceHash?: string }
  | { kind: 'source-edit'; noteId: string; markdown: string; syntaxVersion?: NoteSyntaxVersion; expectedSourceHash?: string }
  | { kind: 'rename'; from: string; to: string; mode?: 'identifier' | 'namespace' };
export interface SharedEditInverse { notes: Array<Pick<Note, 'id' | 'markdown' | 'syntaxVersion'>>; records: StructuredRecord[] }
export interface MaterializedSharedEdit { snapshot: WorkspaceSnapshot; identityHints: SemanticIdentityHints; inverse: SharedEditInverse }

/** Validate an explicit shared edit and return changed source. Revision/receipt/undo authorization stays with the host. */
export function applySharedIntent(snapshot: WorkspaceSnapshot, state: SharedSemanticState, intent: SharedIntent,
  options: { hash: (raw: string) => string }): MaterializedSharedEdit {
  if (snapshot.id !== state.workspaceId) throw new Error('Shared edit belongs to another workspace.');
  const notes = [...snapshot.notes], records = [...snapshot.records];
  const inverse: SharedEditInverse = { notes: [], records: [] };
  let identityHints: SemanticIdentityHints = {};
  const editNote = (note: Note, markdown: string, syntaxVersion = note.syntaxVersion) => {
    inverse.notes.push({ id: note.id, markdown: note.markdown, syntaxVersion: note.syntaxVersion });
    notes[notes.findIndex(item => item.id === note.id)] = { ...note, markdown, syntaxVersion };
  };
  if (intent.kind === 'rename') {
    const plan = planRename(snapshot, { from: intent.from, to: intent.to, mode: intent.mode ?? 'identifier' });
    if (!plan.canApply) throw new Error(plan.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('; ') || 'Rename has no changes.');
    for (const change of plan.changes) inverse.notes.push({ id: change.id, markdown: change.before, syntaxVersion: snapshot.notes.find(note => note.id === change.id)?.syntaxVersion });
    for (const change of plan.recordChanges) inverse.records.push(change.before);
    identityHints = { renames: plan.renames.map(({ from, to }) => ({ from, to })), bindingOwners: state.bindings.flatMap(binding => {
      if (binding.owner.kind !== 'record') return [];
      const owner = binding.owner;
      const changed = plan.recordChanges.find(item => item.id === owner.recordId);
      if (!changed) return [];
      const field = changed.edits.find(item => item.kind === 'record-field' && item.before === owner.field)?.after ?? owner.field;
      return [{ bindingId: binding.id, owner: { ...owner, collection: changed.after.collection, recordName: changed.after.name, field } }];
    }) };
    return { snapshot: { ...snapshot, notes: plan.notes, records: plan.records }, identityHints, inverse };
  }
  if (intent.kind === 'source-edit') {
    const note = notes.find(item => item.id === intent.noteId);
    if (!note) throw new Error('Note no longer exists.');
    if (intent.expectedSourceHash && options.hash(note.markdown) !== intent.expectedSourceHash) throw new Error('Source changed before editing.');
    if (intent.syntaxVersion !== undefined && intent.syntaxVersion !== 'legacy-v0.2' && intent.syntaxVersion !== 'grasp-v1') throw new Error('Unknown syntax version.');
    editNote(note, intent.markdown, intent.syntaxVersion ?? note.syntaxVersion);
  } else {
    const binding = state.bindings.find(item => item.id === intent.bindingId);
    if (!binding) throw new Error('Binding no longer exists.');
    const index = intent.partIndex ?? (binding.parts.length === 1 && binding.parts[0].kind === 'literal' ? 0 : -1);
    const part = binding.parts[index];
    if (!part || (intent.kind === 'set-literal' ? part.kind !== 'literal' : part.kind !== 'identifier')) throw new Error('Choose an explicit literal or dependency fragment; an expanded composition cannot be inverted.');
    if (intent.kind === 'set-dependency' && !(binding.syntaxVersion === 'grasp-v1' ? isQualifiedIdentifier(intent.identifier) : IDENTIFIER_PATTERN.test(intent.identifier))) throw new Error('Invalid dependency identifier for the binding syntax version.');
    const owner = binding.owner;
    const note = owner.kind === 'note' ? notes.find(item => item.id === owner.noteId) : undefined;
    const record = owner.kind === 'record' ? records.find(item => item.id === owner.recordId) : undefined;
    const raw = note?.markdown ?? (record && owner.kind === 'record' ? record.fields[owner.field] : undefined);
    if (raw === undefined || options.hash(raw) !== binding.sourceHash || intent.expectedSourceHash && intent.expectedSourceHash !== binding.sourceHash) throw new Error('Shared binding source is stale.');
    const nextParts = binding.parts.map((item, at) => at !== index ? item : intent.kind === 'set-literal'
      ? { kind: 'literal' as const, value: intent.value } : { kind: 'identifier' as const, name: intent.identifier });
    if (note && binding.syntaxVersion === 'grasp-v1') {
      if (!part.location) throw new Error('Binding fragment has no source span.');
      const replacement = intent.kind === 'set-literal' ? serializeRawLiteral(intent.value) : intent.identifier;
      editNote(note, applyPatches(raw, [{ ...part.location, before: raw.slice(part.location.from, part.location.to), after: replacement }]));
    } else {
      const template = nextParts.map(item => item.kind === 'literal' ? item.value.replace(/\{/g, '{{').replace(/\}/g, '}}') : `{${item.name}}`).join('');
      if (note) {
        const declaration = raw.slice(binding.location.from, binding.location.to);
        const match = /^(@[^=]*=\s*)(.*?)(\s*)$/.exec(declaration);
        if (!match) throw new Error('Legacy declaration source no longer matches.');
        editNote(note, applyPatches(raw, [{ ...binding.location, before: declaration, after: match[1] + JSON.stringify(template) + match[3] }]));
      } else if (record && owner.kind === 'record') {
        inverse.records.push(record);
        records[records.findIndex(item => item.id === record.id)] = { ...record, fields: { ...record.fields, [owner.field]: template } };
      }
    }
  }
  return { snapshot: { ...snapshot, notes, records }, identityHints, inverse };
}
