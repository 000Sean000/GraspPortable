import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Note, WorkspaceSnapshot } from '../src/domain/model';
import { prepareSharedWorkspace } from '../src/domain/shared';
import { compileProjectionPlan, createDefaultProjectionStrategy, createFullProjectionBundle, createProjectionCatalog,
  createProjectionPlanningPackage, projectionJson, reviewProjectionProposal, validateFullProjectionBundle, validateProjectionPath,
  type ProjectionProposal, type ProjectionSelector, type ProjectionStrategy, type ProjectionUnitId } from '../src/domain/projection';

const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const note = (id: string, title: string, markdown: string, legacy = false): Note => ({ id, title, markdown, folderId: 'f', revision: 1, updatedAt: '2026-09-28T00:00:00Z', ...(legacy ? {} : { syntaxVersion: 'grasp-v1' }) });
function setup() {
  let serial = 0;
  const input: WorkspaceSnapshot = { id: 'workspace', name: 'Synthetic', revision: 1, settings: {}, folders: [{ id: 'f', name: 'Notes', parentId: null, revision: 1 }],
    notes: [note('n1', 'Daily', '正文 A\r\n@Fruit = <|apple ![fruit](../fruit.png)|>\r\n正文 B\n@Person.Job = <|SECRET_JOB|>\r正文 C'),
      note('n2', 'Reading', '[cached](:ref:Fruit)\n[[Daily]]\n![owned](grasp-asset:fruit)\n'),
      note('legacy', 'Legacy', '@old-name = "{raw} and {Fruit}"\r\n{{old-name}}', true)],
    records: [{ id: 'r1', collection: 'People', name: 'Sam', fields: { Role: 'doctor', Address: 'SECRET_ADDRESS' }, revision: 1 }],
    attachments: [{ id: 'fruit', name: 'fruit.png', path: 'fruit.png', mimeType: 'image/png', sha256: hash('fruit'), size: 5, revision: 1, createdAt: '2026-09-28' },
      { id: 'secret', name: 'SECRET_ASSET.png', path: 'SECRET_ASSET.png', mimeType: 'image/png', sha256: hash('secret'), size: 6, revision: 1, createdAt: '2026-09-28' }] };
  const prepared = prepareSharedWorkspace(input, { hash, newId: kind => `${kind}-${++serial}` });
  const snapshot = { ...input, notes: prepared.notes };
  const semantic = prepared.state;
  const catalog = createProjectionCatalog(snapshot, semantic, { hash });
  const strategy = createDefaultProjectionStrategy(catalog);
  const fruit = catalog.units.find(unit => unit.kind === 'binding' && unit.binding.name === 'Fruit')!;
  const job = catalog.units.find(unit => unit.kind === 'binding' && unit.binding.name === 'Person.Job')!;
  return { snapshot, semantic, catalog, strategy, fruit, job };
}
function proposal(data: ReturnType<typeof setup>, units: ProjectionSelector[], groups: ProjectionProposal['groups'], mode: 'full' | 'partial' = 'partial'): ProjectionProposal {
  return { format: 'grasp-projection-proposal', version: 1, workspaceId: data.catalog.workspaceId,
    base: { workspaceRevision: data.catalog.workspaceRevision, strategyRevision: data.strategy.revision }, planningPackageId: 'package-1',
    coverage: { mode, units }, groups, unassigned: 'deterministic-default-v1' };
}
const group = (id: string, path: string, members: ProjectionSelector[]) => ({ id, path, render: 'sections-v1' as const, members });

describe('projection catalog and ownership', () => {
  it('separates two bindings from one note while preserving exact mixed-EOL source slots', () => {
    const data = setup(), unit = data.catalog.units.find(unit => unit.id === 'noteProse:n1')!;
    if (unit.kind !== 'noteProse') throw new Error('fixture');
    expect(unit.layout.map(span => span.kind)).toEqual(['prose', 'binding', 'prose', 'binding', 'prose']);
    const bindings = new Map(data.catalog.units.filter(unit => unit.kind === 'binding').map(unit => [unit.binding.id, unit.raw]));
    expect(unit.layout.map(span => span.kind === 'prose' ? span.raw : bindings.get(span.bindingId)).join('')).toBe(data.snapshot.notes[0].markdown);
    expect(projectionJson(unit)).not.toContain('SECRET_JOB');
    expect(data.fruit.owner).toEqual({ kind: 'note', id: 'n1' });
    expect(data.catalog.owners[0].sourceHash).toBe(hash(data.snapshot.notes.find(note => note.id === data.catalog.owners[0].noteId)!.markdown));
  });

  it('keeps legacy note source and record field identities without conversion', () => {
    const data = setup();
    const legacy = data.catalog.units.find(unit => unit.kind === 'binding' && unit.binding.name === 'old-name')!;
    if (legacy.kind !== 'binding') throw new Error('fixture');
    expect(legacy.binding.syntaxVersion).toBe('legacy-v0.2');
    expect(legacy.raw).toBe('@old-name = "{raw} and {Fruit}"\r');
    const record = data.catalog.units.find(unit => unit.id === 'recordInfo:r1')!;
    if (record.kind !== 'recordInfo') throw new Error('fixture');
    expect(record.fields.map(field => field.field)).toEqual(['Address', 'Role']);
    expect(projectionJson(record)).not.toContain('SECRET_ADDRESS');
  });

  it('rejects incomplete sources and owner spans, duplicate IDs and wrong ordered dependency targets', () => {
    const data = setup();
    for (const mutate of [
      (state: typeof data.semantic) => { state.sources.pop(); },
      (state: typeof data.semantic) => { state.bindings[0].location.to += 10000; },
      (state: typeof data.semantic) => { state.occurrences.push(state.occurrences[0]); },
      (state: typeof data.semantic) => { const binding = state.bindings.find(binding => binding.dependencies.length)!; binding.dependencyIds[0] = 'unknown'; },
    ]) {
      const semantic = structuredClone(data.semantic); mutate(semantic);
      expect(() => createProjectionCatalog(data.snapshot, semantic, { hash })).toThrow(/Invalid projection/);
    }
  });
});

describe('reviewed strategy contracts', () => {
  it('places same-note definitions in separate groups without moving canonical owners or IDs', () => {
    const data = setup();
    const proposed = proposal(data, ['noteProse:n1', data.fruit.id, data.job.id], [group('daily', 'Notes/Prose.md', ['noteProse:n1']), group('food', 'Data/Food.md', [data.fruit.id]), group('jobs', 'People/Jobs.md', [data.job.id])]);
    const pkg = createProjectionPlanningPackage(data.catalog, { id: 'package-1', strategyRevision: 0, units: proposed.coverage.units });
    const review = reviewProjectionProposal(data.catalog, proposed, data.strategy, pkg);
    expect(review.canApply).toBe(true);
    const plan = compileProjectionPlan(data.catalog, review.strategy!);
    expect(plan.targetMap.find(target => target.unitId === data.fruit.id)?.path).toBe('Data/Food.md');
    expect(plan.targetMap.find(target => target.unitId === data.job.id)?.path).toBe('People/Jobs.md');
    expect(plan.units.find(unit => unit.id === data.fruit.id)?.owner).toEqual(data.fruit.owner);
    expect(review.strategy!.revision).toBe(1);
  });

  it('rejects whole-note/explicit-binding and record-field/identifier aliases of the same canonical assignment', () => {
    const data = setup();
    const recordBinding = data.catalog.units.find(unit => unit.kind === 'binding' && unit.binding.name === 'People.Sam.Role')!;
    if (recordBinding.kind !== 'binding') throw new Error('fixture');
    const noteOverlap = proposal(data, [{ kind: 'note', id: 'n1' }], [group('all', 'All.md', [{ kind: 'note', id: 'n1' }, data.fruit.id])]);
    expect(reviewProjectionProposal(data.catalog, noteOverlap, data.strategy).canApply).toBe(false);
    const fieldOverlap = proposal(data, [recordBinding.id], [group('all', 'All.md', [{ kind: 'record-field', recordId: 'r1', field: 'Role' }, { kind: 'identifier', id: recordBinding.binding.identifierId }])]);
    expect(reviewProjectionProposal(data.catalog, fieldOverlap, data.strategy).canApply).toBe(false);
  });

  it('preserves outside-scope and omitted members of partial proposals', () => {
    const data = setup();
    const before = compileProjectionPlan(data.catalog, data.strategy);
    const proposed = proposal(data, [data.fruit.id, data.job.id], [group('food', 'Food.md', [data.fruit.id])]);
    const review = reviewProjectionProposal(data.catalog, proposed, data.strategy);
    expect(review.canApply).toBe(true);
    const after = compileProjectionPlan(data.catalog, review.strategy!);
    for (const id of ['noteProse:n1', data.job.id, 'noteProse:n2']) expect(after.targetMap.find(target => target.unitId === id)?.path).toBe(before.targetMap.find(target => target.unitId === id)?.path);
    const oldGroup = data.strategy.groups.find(item => item.members.includes(data.fruit.id))!;
    expect(reviewProjectionProposal(data.catalog, proposal(data, [data.fruit.id], [group(oldGroup.id, 'Moved.md', [data.fruit.id])]), data.strategy).canApply).toBe(false);
  });

  it('supports explicit unassign while keeping mere omissions and rejecting contradictory actions', () => {
    const data = setup();
    const proposed = { ...proposal(data, [data.fruit.id, data.job.id], []), unassign: [data.fruit.id] };
    const review = reviewProjectionProposal(data.catalog, proposed, data.strategy);
    expect(review.canApply).toBe(true);
    expect(review.unassigned).toContain(data.fruit.id);
    expect(review.unassigned).not.toContain(data.job.id);
    expect(compileProjectionPlan(data.catalog, review.strategy!).targetMap.find(item => item.unitId === data.fruit.id)?.path).toContain('_Unassigned/');
    expect(reviewProjectionProposal(data.catalog, { ...proposed, groups: [group('food', 'Food.md', [data.fruit.id])] }, data.strategy).canApply).toBe(false);
    expect(reviewProjectionProposal(data.catalog, { ...proposed, unassign: ['noteProse:n2' as ProjectionUnitId] }, data.strategy).canApply).toBe(false);
  });

  it('rejects stale revisions, package tampering and proposal scope expansion', () => {
    const data = setup(), proposed = proposal(data, [data.fruit.id], [group('food', 'Food.md', [data.fruit.id])]);
    const pkg = createProjectionPlanningPackage(data.catalog, { id: 'package-1', strategyRevision: 0, units: [data.fruit.id] });
    expect(reviewProjectionProposal(data.catalog, { ...proposed, base: { ...proposed.base, workspaceRevision: 2 } }, data.strategy, pkg).canApply).toBe(false);
    expect(reviewProjectionProposal(data.catalog, proposed, data.strategy, { ...pkg, catalogFingerprint: 'changed' }).canApply).toBe(false);
    expect(reviewProjectionProposal(data.catalog, { ...proposed, coverage: { mode: 'partial', units: [data.fruit.id, data.job.id] } }, data.strategy, pkg).canApply).toBe(false);
    expect(reviewProjectionProposal(data.catalog, { ...proposed, coverage: { mode: 'full', units: [data.fruit.id] } }, data.strategy).canApply).toBe(false);
    const complete = createProjectionPlanningPackage(data.catalog, { id: 'package-1', strategyRevision: 0, units: [data.fruit.id], provided: 'full' });
    complete.units[0].unit!.label = 'changed after package creation';
    expect(reviewProjectionProposal(data.catalog, proposed, data.strategy, complete).canApply).toBe(false);
    expect(reviewProjectionProposal(data.catalog, { ...proposed, executableTemplate: 'unsupported' } as ProjectionProposal, data.strategy).canApply).toBe(false);
  });

  it('diagnoses deleted assignments and deterministically routes new unassigned units', () => {
    const data = setup();
    const strategy: ProjectionStrategy = { ...data.strategy, groups: [{ ...data.strategy.groups[0], members: ['binding:deleted' as ProjectionUnitId] }] };
    const plan = compileProjectionPlan(data.catalog, strategy);
    expect(plan.diagnostics.some(item => item.code === 'deleted-unit')).toBe(true);
    expect(plan.scope.included).toHaveLength(data.catalog.units.length);
    expect(plan.groups.every(group => group.path.startsWith('_Unassigned/'))).toBe(true);
    expect(projectionJson(plan)).toBe(projectionJson(compileProjectionPlan(data.catalog, strategy)));
  });

  it.each(['../escape.md', '/absolute.md', 'C:/drive.md', 'A\\B.md', 'CON.md', 'NUL/a.md', 'a. /b.md', '.grasp-export/data.md', '_Attachments/a.md'])('rejects unsafe group path %s', path => {
    expect(() => validateProjectionPath(path)).toThrow();
  });

  it.each([['File.md', 'file.MD'], ['caf\u00e9.md', 'cafe\u0301.md'], ['File.md', 'File.md/Child.md']])('rejects portable path collisions %s and %s', (first, second) => {
    const data = setup();
    const proposed = proposal(data, [data.fruit.id, data.job.id], [group('one', first, [data.fruit.id]), group('two', second, [data.job.id])]);
    expect(reviewProjectionProposal(data.catalog, proposed, data.strategy).canApply).toBe(false);
  });
});

describe('scoped export privacy and deterministic plans', () => {
  it('exports only one selected binding without owner prose, sibling value, other records or unrelated assets', () => {
    const data = setup(), plan = compileProjectionPlan(data.catalog, data.strategy, { mode: 'partial', units: [data.fruit.id] });
    expect(plan.units.map(unit => unit.id)).toEqual([data.fruit.id]);
    const json = projectionJson(plan);
    for (const secret of ['SECRET_JOB', '正文 A', '正文 B', 'SECRET_ADDRESS', 'SECRET_ASSET']) expect(json).not.toContain(secret);
    expect(plan.attachments.map(asset => asset.id)).toEqual(['fruit']);
    expect(plan.attachments[0].file).toBe('_Attachments/fruit.png');
    expect(plan.units[0].links?.[0]).toMatchObject({ content: 'binding-value', status: 'resolved', attachmentId: 'fruit' });
    const pkg = createProjectionPlanningPackage(data.catalog, { id: 'p', strategyRevision: 0, units: [data.fruit.id], provided: 'full' });
    expect(projectionJson(pkg)).not.toContain('SECRET_JOB');
  });

  it('makes dependency closure explicit while retaining cached reading values without definitions', () => {
    const data = setup();
    const plain = compileProjectionPlan(data.catalog, data.strategy, { mode: 'partial', units: ['noteProse:n2'] });
    const closed = compileProjectionPlan(data.catalog, data.strategy, { mode: 'partial', units: ['noteProse:n2'], includeDependencies: true });
    expect(plain.scope.included).toEqual(['noteProse:n2']);
    expect(plain.omittedTargets.some(target => target.name === 'Fruit')).toBe(true);
    expect(closed.scope.included).toEqual([data.fruit.id, 'noteProse:n2'].sort());
    expect(closed.omittedTargets).toEqual([]);
    const reading = plain.units[0];
    if (reading.kind !== 'noteProse') throw new Error('fixture');
    expect(reading.occurrences[0].cache.renderedValue).toContain('apple');
    expect(reading.links?.find(link => link.target === 'Daily')).toMatchObject({ status: 'omitted', targetUnitId: 'noteProse:n1' });
  });

  it('classifies dangerous links and keeps ordinary @-prefixed note names as ordinary links', () => {
    const data = setup();
    const input: WorkspaceSnapshot = { ...data.snapshot, revision: 2, notes: [...data.snapshot.notes,
      { ...note('at-note', '@ordinary', 'target note'), revision: 2 },
      { ...note('unsafe-note', 'Unsafe', '[bad](javascript:alert) ![escape](../../outside.png) [[@ordinary]]'), revision: 2 }] };
    let serial = 0;
    const prepared = prepareSharedWorkspace(input, { hash, newId: kind => `new-${kind}-${++serial}`, previous: data.semantic, previousSnapshot: data.snapshot });
    const catalog = createProjectionCatalog({ ...input, notes: prepared.notes }, prepared.state, { hash });
    const plan = compileProjectionPlan(catalog, createDefaultProjectionStrategy(catalog), { mode: 'partial', units: ['noteProse:unsafe-note'] });
    const links = plan.units[0].links!;
    expect(links.find(link => link.target === 'javascript:alert')?.status).toBe('unsafe');
    expect(links.find(link => link.target === '../../outside.png')?.status).toBe('unsafe');
    expect(links.find(link => link.target === '@ordinary')).toMatchObject({ status: 'omitted', targetUnitId: 'noteProse:at-note' });
    expect(plan.attachments).toEqual([]);
    expect(projectionJson(plan)).not.toContain('target note');
  });

  it('preserves group member ordering and yields identical bytes from repeated compilation', () => {
    const data = setup();
    const strategy = { ...data.strategy, groups: [group('ordered', 'Ordered.md', [data.job.id, data.fruit.id])] } as ProjectionStrategy;
    const a = compileProjectionPlan(data.catalog, strategy), b = compileProjectionPlan(data.catalog, structuredClone(strategy));
    expect(a.groups.find(group => group.id === 'ordered')!.members).toEqual([data.job.id, data.fruit.id]);
    expect(projectionJson(a)).toBe(projectionJson(b));
    expect(a.targetMap.find(item => item.unitId === data.fruit.id)!.anchor).toBe(compileProjectionPlan(data.catalog, data.strategy).targetMap.find(item => item.unitId === data.fruit.id)!.anchor);
  });
});

describe('full fallback semantic validation', () => {
  it('reconstructs exact current source, semantic IDs, records and owner placements after JSON serialization', () => {
    const data = setup(), bundle = createFullProjectionBundle(data.snapshot, data.semantic, data.strategy, { hash, lineageId: 'import-lineage', provenance: { fingerprint: 'original-import' } });
    const restored = validateFullProjectionBundle(JSON.parse(JSON.stringify(bundle)), { hash });
    expect(restored.bundle.snapshot).toEqual(data.snapshot);
    expect(restored.bundle.semantic).toEqual(data.semantic);
    expect(restored.bundle.workspaceLineageId).toBe('import-lineage');
    expect(restored.catalog.fingerprint).toBe(data.catalog.fingerprint);
  });

  it('validates saved missing/cycle states with last-good values and current source, without restoring obsolete source', () => {
    const base = setup();
    let serial = 0;
    for (const target of ['Missing', 'Fruit']) {
      const snapshot = { ...base.snapshot, revision: 2, notes: base.snapshot.notes.map(note => note.id === 'n1'
        ? { ...note, revision: 2, markdown: note.markdown.replace('<|apple ![fruit](../fruit.png)|>', target) } : note) };
      const prepared = prepareSharedWorkspace(snapshot, { hash, newId: kind => `${target}-${kind}-${++serial}`, previous: base.semantic, previousSnapshot: base.snapshot });
      const current = { ...snapshot, notes: prepared.notes };
      const catalog = createProjectionCatalog(current, prepared.state, { hash });
      const bundle = createFullProjectionBundle(current, prepared.state, createDefaultProjectionStrategy(catalog), { hash });
      const restored = validateFullProjectionBundle(bundle, { hash });
      expect(restored.bundle.snapshot.notes[0].markdown).toContain(`@Fruit = ${target}`);
      expect(restored.bundle.semantic.results.find(result => result.name === 'Fruit')).toMatchObject({
        current: { status: target === 'Missing' ? 'missing' : 'cycle' }, lastGood: { value: 'apple ![fruit](../fruit.png)' },
      });
    }
  });

  it('does not depend on entity enumeration order when validating semantic state', () => {
    const data = setup(), bundle = createFullProjectionBundle(data.snapshot, data.semantic, data.strategy, { hash });
    bundle.snapshot.notes.reverse(); bundle.semantic.identifiers.reverse(); bundle.semantic.bindings.reverse(); bundle.semantic.occurrences.reverse(); bundle.semantic.sources.reverse(); bundle.semantic.results.reverse();
    expect(() => validateFullProjectionBundle(bundle, { hash })).not.toThrow();
  });

  it('rejects missing layout slots, corrupted exact source, fake logical values and unsupported versions', () => {
    const data = setup(), valid = createFullProjectionBundle(data.snapshot, data.semantic, data.strategy, { hash });
    for (const mutate of [
      (bundle: typeof valid) => { bundle.owners[0].layout.pop(); },
      (bundle: typeof valid) => { bundle.snapshot.notes[0].markdown += 'changed'; },
      (bundle: typeof valid) => { bundle.semantic.results[0].current.value = 'forged'; },
      (bundle: typeof valid) => { (bundle as { version: number }).version = 999; },
      (bundle: typeof valid) => { bundle.semantic.bindings.pop(); },
      (bundle: typeof valid) => { bundle.strategy.groups[0].path = '../escaped.md'; },
      (bundle: typeof valid) => { bundle.strategy.groups[0].members.push(bundle.strategy.groups[0].members[0]); },
      (bundle: typeof valid) => { bundle.snapshot.revision = 0; },
      (bundle: typeof valid) => { bundle.semantic.occurrences[0].identifierId = bundle.semantic.bindings.find(binding => binding.name === 'Person.Job')!.identifierId; },
    ]) { const bad = structuredClone(valid); mutate(bad); expect(() => validateFullProjectionBundle(bad, { hash })).toThrow(); }
  });
});
