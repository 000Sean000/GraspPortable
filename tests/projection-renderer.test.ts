import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parser, GFM } from '@lezer/markdown';
import { prepareSharedWorkspace } from '../src/domain/shared';
import { serializeBinding } from '../src/domain/binding-language';
import { compileProjectionPlan, createDefaultProjectionStrategy, createProjectionCatalog, type ProjectionPlan } from '../src/domain/projection';
import { renderProjection, reviewProjectionFile, relativeProjectionLink, type RenderedProjectionFile } from '../src/domain/projection-renderer';
import type { WorkspaceSnapshot } from '../src/domain/model';

const hash = (raw: string) => createHash('sha256').update(raw, 'utf16le').digest('hex');
function fixture(value = 'Apple') {
  const source = '\ufeff# Daily\r\nBefore\r\n' + serializeBinding('Fruit', [{ kind: 'literal', value }]) + '\r\nBetween\r\n@Person.Job = <|PRIVATE_JOB_SECRET|>\r\nAfter [old](:ref:Fruit)\r\n\r\n![photo](grasp-asset:asset)\r\n[[Target#Topic|next]]\r\n';
  const snapshot: WorkspaceSnapshot = { id: 'w1', name: 'Test', revision: 3, settings: {}, records: [], folders: [],
    notes: [{ id: 'n1', title: 'Daily', markdown: source, syntaxVersion: 'grasp-v1', folderId: null, revision: 3, updatedAt: '2026-09-28' },
      { id: 'n2', title: 'Target', markdown: '# Target\n\n## Topic\n\nTarget body.', syntaxVersion: 'grasp-v1', folderId: null, revision: 3, updatedAt: '2026-09-28' }],
    attachments: [{ id: 'asset', path: 'images/photo (1).png', name: 'photo (1).png', mimeType: 'image/png', size: 3, sha256: 'a'.repeat(64), revision: 3, createdAt: '2026-09-28' }] };
  let serial = 0;
  const prepared = prepareSharedWorkspace(snapshot, { hash, newId: kind => `${kind}-${++serial}` });
  snapshot.notes = prepared.notes;
  const catalog = createProjectionCatalog(snapshot, prepared.state, { hash });
  const strategy = createDefaultProjectionStrategy(catalog);
  const fruit = catalog.units.find(unit => unit.kind === 'binding' && unit.binding.name === 'Fruit')!;
  const job = catalog.units.find(unit => unit.kind === 'binding' && unit.binding.name === 'Person.Job')!;
  strategy.groups = [
    { id: 'notes', path: 'Notes/Daily.md', render: 'sections-v1', members: ['noteProse:n1'] },
    { id: 'fruit', path: 'Food/Fruit.md', render: 'sections-v1', members: [fruit.id] },
    { id: 'job', path: 'People/Job.md', render: 'sections-v1', members: [job.id] },
    { id: 'target', path: 'Notes/Target.md', render: 'sections-v1', members: ['noteProse:n2'] },
  ];
  return { snapshot, catalog, strategy, fruit, job, plan: compileProjectionPlan(catalog, strategy) };
}
function file(plan: ProjectionPlan, path: string): RenderedProjectionFile { return renderProjection(plan).files.find(file => file.path === path)!; }
function replaceRegion(baseline: RenderedProjectionFile, kind: string, transform: (text: string) => string) {
  const region = baseline.regions.find(region => region.kind === kind)!;
  return baseline.text.slice(0, region.from) + transform(baseline.text.slice(region.from, region.to)) + baseline.text.slice(region.to);
}

describe('scoped readable projection and controlled review', () => {
  it('renders separated canonical bindings once, physical links/assets and deterministic complete payload', () => {
    const data = fixture(); const rendered = renderProjection(data.plan);
    expect(rendered).toEqual(renderProjection(structuredClone(data.plan)));
    const daily = rendered.files.find(file => file.path === 'Notes/Daily.md')!.text;
    const fruit = rendered.files.find(file => file.path === 'Food/Fruit.md')!.text;
    expect(daily).not.toContain('@Fruit ='); expect(daily).not.toContain('PRIVATE_JOB_SECRET');
    expect(daily).toContain('../Food/Fruit.md#grasp-'); expect(daily).toContain('../People/Job.md#grasp-');
    expect(daily).toContain('../_Attachments/images/photo%20%281%29.png');
    expect(daily).toContain('Target.md#grasp-'); expect(daily).toContain('original heading: Topic');
    expect(fruit.match(/@Fruit = <\|Apple\|>/g)).toHaveLength(1);
    const targets = new Map(rendered.files.map(file => [file.path, file.text]));
    for (const location of rendered.locations) expect(targets.get(location.path)).toContain(`## ${location.anchor}\n`);
    const syntax: string[] = []; parser.configure(GFM).parse(daily).iterate({ enter(node) { syntax.push(node.name); } });
    expect(syntax).toContain('Image'); expect(syntax.filter(name => name === 'Link').length).toBeGreaterThan(2);
    for (const baseline of rendered.files) expect(reviewProjectionFile(baseline, baseline.text)).toEqual({ canApply: false, changes: [], diagnostics: [] });
  });

  it('a binding-only partial file and its baseline cannot leak its original note or sibling definition', () => {
    const data = fixture(); const plan = compileProjectionPlan(data.catalog, data.strategy, { mode: 'partial', units: [data.fruit.id] });
    const rendered = renderProjection(plan), json = JSON.stringify(rendered);
    expect(rendered.files).toHaveLength(1); expect(rendered.files[0].path).toBe('Food/Fruit.md');
    expect(json).not.toContain('PRIVATE_JOB_SECRET'); expect(json).not.toContain('Between'); expect(json).not.toContain('photo');
    expect(rendered.files[0].text).toContain('@Fruit = <|Apple|>');
  });

  it('prose-only output retains readable cached observations and explicitly omitted definitions', () => {
    const data = fixture(); const partial = compileProjectionPlan(data.catalog, data.strategy, { mode: 'partial', units: ['noteProse:n1'] });
    const rendered = renderProjection(partial); expect(rendered.files[0].text).toContain('definition not included or missing');
    expect(rendered.files[0].text).toContain('> Apple'); expect(JSON.stringify(rendered)).not.toContain('PRIVATE_JOB_SECRET');
    expect(rendered.files[0].text).toContain('next (target not included in this export)');
  });

  it.each(['', 'one\n\ntwo **bold**\n\n| A | B |\n| - | - |\n| x | y |', 'first ] [ | \\ 😀\r\nlast', '```md\n# fenced\n[not a managed value]\n```', '<!-- unclosed', '<script>unclosed', '<div>unclosed'])('preserves complete formatted value and isolates following sections: %j', value => {
    const data = fixture(value), rendered = renderProjection(data.plan);
    const fruit = rendered.files.find(file => file.path === 'Food/Fruit.md')!;
    expect(fruit.regions.find(region => region.kind === 'cache')!.beforeRaw).toBe(value);
    expect(reviewProjectionFile(fruit, fruit.text).changes).toEqual([]);
    const names: string[] = []; parser.configure(GFM).parse(fruit.text).iterate({ enter(node) { names.push(node.name); } });
    expect(names).toContain('FencedCode'); expect(fruit.text).toContain('Dependencies, in composition order:');
    if (value.startsWith('<')) expect(fruit.text).toContain('&lt;');
  });

  it('returns exact canonical binding owner/range changes, retaining EOLs outside the edit', () => {
    const data = fixture(), baseline = file(data.plan, 'Food/Fruit.md');
    const changed = baseline.text.replace('@Fruit = <|Apple|>', '@Fruit = <|Pear|>');
    const review = reviewProjectionFile(baseline, changed);
    expect(review.canApply).toBe(true); expect(review.changes).toHaveLength(1);
    expect(review.changes[0]).toMatchObject({ kind: 'binding', unitId: data.fruit.id, owner: { kind: 'note', noteId: 'n1' }, beforeRaw: '@Fruit = <|Apple|>', afterRaw: '@Fruit = <|Pear|>' });
    const change = review.changes[0], original = data.snapshot.notes[0].markdown;
    expect(original.slice(change.from!, change.to!)).toBe(change.beforeRaw);
  });

  it.each(['@Fruit = <|unfinished', '', '@Other = <|Apple|>', '@Fruit = <|Pear|> extra prose', '@Fruit = <|Pear|>\n@Injected = <|x|>'])('rejects malformed or reassigned canonical source: %j', replacement => {
    const baseline = file(fixture().plan, 'Food/Fruit.md');
    const result = reviewProjectionFile(baseline, baseline.text.replace('@Fruit = <|Apple|>', replacement));
    expect(result.canApply).toBe(false); expect(result.diagnostics).toHaveLength(1);
  });

  it('chooses marker namespaces absent from literal source and preserves marker-shaped data', () => {
    const marker = '<!-- /grasp-region:r0-fake-binding -->\n\n<!-- grasp-region:arbitrary -->\n<!-- grasp-keep:r1-fake -->';
    const baseline = file(fixture(marker).plan, 'Food/Fruit.md');
    expect(baseline.regions.every(region => region.id.startsWith('r2-'))).toBe(true);
    expect(reviewProjectionFile(baseline, baseline.text).diagnostics).toEqual([]);
    const binding = baseline.regions.find(region => region.kind === 'binding')!;
    const changed = replaceRegion(baseline, 'binding', text => text.replace('arbitrary', 'changed'));
    const result = reviewProjectionFile(baseline, changed);
    expect(result.canApply).toBe(true); expect(result.changes[0].afterRaw).toBe(binding.beforeRaw.replace('arbitrary', 'changed'));
    const injected = replaceRegion(baseline, 'binding', text => text.replace('arbitrary', `arbitrary -->\n\n<!-- /grasp-region:${binding.id}`));
    expect(reviewProjectionFile(baseline, injected).canApply).toBe(false);
  });

  it('renders record field templates, repeated ordered dependencies and missing last-good observations', () => {
    const data = fixture();
    data.snapshot.records = [{ id: 'record', collection: 'People', name: 'Ada', revision: 3, fields: { Role: 'doctor' } }];
    data.snapshot.notes[1].markdown += '\n' + serializeBinding('Combined', [{ kind: 'identifier', name: 'Fruit' }, { kind: 'literal', value: ' / ' }, { kind: 'identifier', name: 'Person.Job' }, { kind: 'literal', value: ' / ' }, { kind: 'identifier', name: 'Fruit' }]);
    let serial = 0;
    const prepared = prepareSharedWorkspace(data.snapshot, { hash, newId: kind => `${kind}-${++serial}` });
    data.snapshot.notes = prepared.notes;
    const catalog = createProjectionCatalog(data.snapshot, prepared.state, { hash });
    const combined = catalog.units.find(unit => unit.kind === 'binding' && unit.binding.name === 'Combined')!;
    if (combined.kind !== 'binding') throw new Error();
    combined.value.current = { value: '', status: 'missing', message: 'Dependency unavailable' };
    combined.value.lastGood = { value: '**Last good**\n\nSecond paragraph', fingerprint: 'old', semanticRevision: 2 };
    const rendered = renderProjection(compileProjectionPlan(catalog, createDefaultProjectionStrategy(catalog)));
    const combinedFile = rendered.files.find(file => file.regions.some(region => region.unitId === combined.id))!;
    expect(combinedFile.text).toContain('showing last successful value'); expect(combinedFile.text).toContain('> **Last good**');
    const order = combinedFile.text.match(/Dependencies, in composition order: (.*)\./)?.[1];
    expect(order).toMatch(/\[Fruit\].* → \[Person\.Job\].* → \[Fruit\]/);
    const recordFile = rendered.files.find(file => file.regions.some(region => region.source?.owner.kind === 'record'))!;
    const changed = replaceRegion(recordFile, 'binding', text => text.replace('doctor', 'engineer'));
    const result = reviewProjectionFile(recordFile, changed);
    expect(result.canApply).toBe(true);
    expect(result.changes[0]).toMatchObject({ kind: 'binding', beforeRaw: 'doctor', afterRaw: 'engineer', owner: { kind: 'record', recordId: 'record', field: 'Role' } });
    expect(result.changes[0].from).toBeUndefined();
  });

  it('keeps legacy source semantics and rejects legacy binding insertion into prose', () => {
    const data = fixture(); data.snapshot.notes[1].syntaxVersion = 'legacy-v0.2';
    data.snapshot.notes[1].markdown = 'Before\r\n@old-name = "old"\r\nAfter';
    let serial = 0;
    const prepared = prepareSharedWorkspace(data.snapshot, { hash, newId: kind => `${kind}-${++serial}` });
    data.snapshot.notes = prepared.notes;
    const catalog = createProjectionCatalog(data.snapshot, prepared.state, { hash });
    const rendered = renderProjection(compileProjectionPlan(catalog, createDefaultProjectionStrategy(catalog)));
    const baseline = rendered.files.find(file => file.regions.some(region => region.bindingName === 'old-name'))!;
    expect(reviewProjectionFile(baseline, baseline.text.replace('@old-name = "old"', '@old-name = "new"')).canApply).toBe(true);
    expect(reviewProjectionFile(baseline, baseline.text.replace('> Before', '> @Injected = "x"')).canApply).toBe(false);
  });

  it('prose edits preserve exact untouched raw CRLF/BOM and canonical references', () => {
    const data = fixture(), baseline = file(data.plan, 'Notes/Daily.md');
    const review = reviewProjectionFile(baseline, baseline.text.replace('> Before', '> Updated'));
    expect(review.canApply).toBe(true); expect(review.changes).toHaveLength(1);
    expect(review.changes[0]).toMatchObject({ kind: 'prose', beforeRaw: '\ufeff# Daily\r\nBefore\r\n', afterRaw: '\ufeff# Daily\r\nUpdated\r\n' });
    const afterRef = reviewProjectionFile(baseline, baseline.text.replace('> After ', '> Later '));
    expect(afterRef.canApply).toBe(true); expect(afterRef.changes[0].afterRaw).toContain('[Apple](:ref:Fruit)\r\n');
    expect(afterRef.changes[0].afterRaw).toContain('![photo](grasp-asset:asset)');
    expect(reviewProjectionFile(baseline, baseline.text.replaceAll('\n', '\r\n')).changes).toEqual([]);
  });

  it('provides precise edit evidence around unchanged opaque references, including repeated identical occurrences', () => {
    const data = fixture();
    data.snapshot.notes[1].markdown = 'Before 😀\r\n[old](:ref:Fruit) between [old](:ref:Fruit)\r\nAfter 👩';
    let serial = 0;
    const prepared = prepareSharedWorkspace(data.snapshot, { hash, newId: kind => `${kind}-${++serial}` });
    data.snapshot.notes = prepared.notes;
    const catalog = createProjectionCatalog(data.snapshot, prepared.state, { hash });
    const rendered = renderProjection(compileProjectionPlan(catalog, createDefaultProjectionStrategy(catalog)));
    const baseline = rendered.files.find(file => file.regions.some(region => region.unitId === 'noteProse:n2'))!;
    const review = reviewProjectionFile(baseline, baseline.text.replace('Before 😀', 'Before 😃').replace(' between ', ' 中間 ').replace('After 👩', 'After 👨'));
    expect(review.canApply).toBe(true); expect(review.changes).toHaveLength(1);
    const change = review.changes[0]; expect(change.rawEdits).toHaveLength(3);
    let restored = change.beforeRaw;
    for (const edit of [...change.rawEdits].reverse()) restored = restored.slice(0, edit.from) + edit.insert + restored.slice(edit.to);
    expect(restored).toBe(change.afterRaw); expect(restored).toContain('\r\n');
    const occurrences = prepared.state.occurrences.filter(item => item.owner.kind === 'note' && item.owner.noteId === 'n2');
    for (const occurrence of occurrences) for (const edit of change.rawEdits) {
      expect(edit.to <= occurrence.location.from || edit.from >= occurrence.location.to).toBe(true);
    }
    const after = { ...data.snapshot, notes: data.snapshot.notes.map(note => note.id === 'n2' ? { ...note, markdown: restored, revision: note.revision + 1 } : note), revision: data.snapshot.revision + 1 };
    const reconciled = prepareSharedWorkspace(after, { hash, newId: kind => `${kind}-${++serial}`, previous: prepared.state, previousSnapshot: data.snapshot,
      identityHints: { sourceEdits: [{ noteId: 'n2', baseRevision: data.snapshot.notes[1].revision, baseHash: hash(change.beforeRaw), steps: [change.rawEdits] }] } });
    expect(reconciled.canCommit).toBe(true);
    expect(reconciled.state.occurrences.filter(item => item.owner.kind === 'note' && item.owner.noteId === 'n2').map(item => item.id)).toEqual(occurrences.map(item => item.id));
  });

  it('cache-only edits have no canonical authority, including mixed source/cache proposals', () => {
    const baseline = file(fixture().plan, 'Food/Fruit.md');
    const changed = replaceRegion(baseline, 'cache', text => text.replace('Apple', 'Injected'));
    const result = reviewProjectionFile(baseline, changed);
    expect(result.canApply).toBe(false); expect(result.changes[0]).toMatchObject({ kind: 'cache-only', beforeRaw: 'Apple', afterRaw: 'Injected' });
    expect(result.changes[0].owner).toBeUndefined(); expect(result.diagnostics[0].code).toBe('cache-observation');
    expect(reviewProjectionFile(baseline, changed.replace('@Fruit = <|Apple|>', '@Fruit = <|Pear|>')).canApply).toBe(false);
  });

  it.each(['marker', 'outside', 'duplicated', 'metadata', 'managed-link', 'new-binding'])('rejects unsupported mutation: %s', kind => {
    const baseline = file(fixture().plan, 'Notes/Daily.md');
    const modified = kind === 'marker' ? baseline.text.replace('grasp-region:', 'forged:')
      : kind === 'outside' ? baseline.text + '\nUnmapped new content'
      : kind === 'duplicated' ? baseline.text + baseline.text
      : kind === 'metadata' ? baseline.text.replace('workspace revision 3', 'workspace revision 999')
      : kind === 'managed-link' ? baseline.text.replace(/grasp-occurrence-[0-9a-f-]+/, 'forged-target')
      : baseline.text.replace('> Before', '> @Injected = <|x|>');
    const result = reviewProjectionFile(baseline, modified); expect(result.canApply).toBe(false); expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('uses source-aware raw-HTML protection without escaping fenced/inline code', () => {
    const data = fixture(), unit = data.plan.units.find(unit => unit.id === 'noteProse:n2')!;
    if (unit.kind !== 'noteProse') throw new Error();
    unit.layout = [{ kind: 'prose', from: 0, to: 50, raw: 'Text <em>word</em>\n\n`<safe>`\n\n```html\n<div>\n```' }];
    const baseline = file(data.plan, 'Notes/Target.md');
    expect(baseline.text).toContain('&lt;em>'); expect(baseline.text).toContain('`<safe>`'); expect(baseline.text).toContain('> <div>');
    const result = reviewProjectionFile(baseline, baseline.text.replace('> Text ', '> Changed '));
    expect(result.canApply).toBe(true); expect(result.changes[0].afterRaw).toContain('Changed <em>word</em>');
    expect(result.changes[0].afterRaw).toContain('```html\n<div>\n```');
  });

  it('escapes physical link paths and rejects escaping the projection root', () => {
    expect(relativeProjectionLink('Notes/中文.md', 'Assets/a)b (1).png')).toBe('../Assets/a%29b%20%281%29.png');
    expect(() => relativeProjectionLink('Notes/A.md', '../outside.md')).toThrow();
    const data = fixture(); data.plan.groups[0].members.push(data.plan.groups[0].members[0]); expect(() => renderProjection(data.plan)).toThrow(/duplicate/);
  });
});
