import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/store';
import { ProjectionWorkspaceFiles } from '../server/projection';
import { readFullGeneration, byteHash } from '../server/projection-generation';
import { sourceHash } from '../server/semantic';
import type { ProjectionProposal, ProjectionUnitId } from '../src/domain/projection';

const dirs: string[] = [], stores: WorkspaceStore[] = [], files: ProjectionWorkspaceFiles[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'grasp-projection-')); dirs.push(root);
  const store = new WorkspaceStore(join(root, '.grasp/workspace.db'), { create: true }); stores.push(store);
  let note = store.snapshot().notes[0];
  store.updateNote(note.id, 'Original', '\uFEFF# Original\r\n\r\n@Fruit = <|Apple|>\r\n@Person.Job = <|Engineer|>\r\n\r\nStart [old](:ref:Fruit) [old](:ref:Fruit) End\r\n', note.revision, undefined, 'grasp-v1');
  const service = new ProjectionWorkspaceFiles(store); files.push(service);
  return { root, store, service };
}
async function grouped(store: WorkspaceStore, service: ProjectionWorkspaceFiles) {
  const state = await service.apiState(), selected = state.catalog.units.filter(unit => unit.kind === 'binding');
  const pkg = service.planningPackage(selected.map(unit => unit.id));
  const proposal: ProjectionProposal = { format: 'grasp-projection-proposal', version: 1, workspaceId: store.id, base: pkg.base, planningPackageId: pkg.id,
    coverage: { mode: 'partial', units: selected.map(unit => unit.id) }, groups: selected.map(unit => ({ id: unit.label, path: `${unit.label === 'Fruit' ? 'Food' : 'People'}/${unit.label}.md`, render: 'sections-v1', members: [unit.id] })), unassigned: 'deterministic-default-v1' };
  const review = service.planStrategy(proposal); expect(review.diagnostics).toEqual([]); expect(review.canApply).toBe(true); service.applyStrategy(review.token!); return selected;
}
afterEach(async () => { for (const service of files.splice(0)) await service.close(); for (const store of stores.splice(0)) try { store.close(); } catch {} for (const root of dirs.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('complete semantic projection host', () => {
  it('locates current reading files after settings/draft changes without creating a generation, but republishes changed content', async () => {
    const { root, store, service } = fixture();
    const initial = await service.checkpoint(); expect(initial.state).toBe('ready');
    const manifest = readFileSync(initial.manifestPath!, 'utf8'), generations = readdirSync(join(root, '.grasp/recovery'));
    const note = store.snapshot().notes[0];
    store.updateSettings({ editorMode: 'reading', activeNote: note.id });
    store.saveDraft('locate-draft', { clientId: 'client', noteId: note.id, title: note.title, markdown: '@Incomplete = <|', syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, revision: 0 });
    // Also exercise deriving the reading baseline from trusted DB metadata after restart.
    await service.close(); const reopened = new ProjectionWorkspaceFiles(store); files.push(reopened);
    const entry = await reopened.locate('note', note.id);
    expect((await reopened.locateUnit(`noteProse:${note.id}`)).entry.path).toBe(entry.path);
    expect(readFileSync(initial.manifestPath!, 'utf8')).toBe(manifest);
    expect(readdirSync(join(root, '.grasp/recovery'))).toEqual(generations);
    expect(reopened.projectionStatus().lastSuccessRevision).toBe(initial.lastSuccessRevision);
    expect(reopened.projectionStatus().state).toBe('pending');
    store.updateNote(note.id, note.title, note.markdown + '\r\nFresh reading content', note.revision);
    const changed = await reopened.locate('note', note.id);
    expect(readFileSync(changed.absolutePath, 'utf8')).toContain('Fresh reading content');
    expect(readFileSync(initial.manifestPath!, 'utf8')).not.toBe(manifest);
    const fallback = await readFullGeneration(initial.manifestPath!);
    expect(fallback.snapshot.settings).toEqual(store.snapshot().settings);
    expect(fallback.recovery.drafts).toEqual(store.drafts());
    writeFileSync(changed.absolutePath, readFileSync(changed.absolutePath, 'utf8') + '\nExternal edit');
    store.updateSettings({ editorMode: 'source' });
    await expect(reopened.locate('note', note.id)).rejects.toThrow(/外部變更/);
    expect(readFileSync(changed.absolutePath, 'utf8')).toContain('External edit');
  });
  it('locates newly published reading content when settings and a draft arrive during checkpoint', async () => {
    const { store, service } = fixture();
    await service.checkpoint(); await service.close();
    const note = store.snapshot().notes[0];
    store.updateNote(note.id, note.title, note.markdown + '\nCurrent reading content', note.revision);
    let racing!: ProjectionWorkspaceFiles;
    racing = new ProjectionWorkspaceFiles(store, { fail: point => {
      if (point !== 'generation-complete') return;
      const latest = store.snapshot().notes[0]!;
      store.updateSettings({ editorMode: 'reading', activeNote: latest.id });
      store.saveDraft('locate-race', { clientId: 'client', noteId: latest.id, title: latest.title, markdown: 'unfinished draft', syntaxVersion: 'grasp-v1', baseNoteRevision: latest.revision, revision: 0 });
      racing.schedule(store.snapshot(), sha => store.readBlob(sha));
    } });
    files.push(racing);

    const entry = await racing.locate('note', note.id);
    expect(readFileSync(entry.absolutePath, 'utf8')).toContain('Current reading content');
  });
  it('does not reject a locate when non-reading state changes during dirty inspection', async () => {
    const { store, service } = fixture(); await service.checkpoint();
    const note = store.snapshot().notes[0]!;
    const internals = service as unknown as { dirty: () => Promise<string[]> };
    const inspectDirty = internals.dirty.bind(service);
    let entered!: () => void, release!: () => void;
    const scanning = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let inspections = 0;
    internals.dirty = async () => {
      inspections++;
      if (inspections === 1) { entered(); await barrier; }
      else if (inspections === 2) {
        store.saveDraft('locate-race', { clientId: 'client', noteId: note.id, title: note.title, markdown: 'draft revision two', syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, revision: 1 });
        service.schedule(store.snapshot(), sha => store.readBlob(sha));
      }
      return inspectDirty();
    };

    const locating = service.locate('note', note.id);
    await scanning;
    store.updateSettings({ editorMode: 'reading', activeNote: note.id });
    store.saveDraft('locate-race', { clientId: 'client', noteId: note.id, title: note.title, markdown: 'draft revision one', syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, revision: 0 });
    service.schedule(store.snapshot(), sha => store.readBlob(sha));
    release();

    const entry = await locating;
    expect(readFileSync(entry.absolutePath, 'utf8')).toContain('# Original');
    expect(inspections).toBe(1);
    expect(service.projectionStatus().state).toBe('pending');
  });
  it('never returns a stale reading path when content changes during dirty inspection', async () => {
    const { store, service } = fixture(); await service.checkpoint();
    const note = store.snapshot().notes[0]!;
    const internals = service as unknown as { dirty: () => Promise<string[]> };
    const inspectDirty = internals.dirty.bind(service);
    let entered!: () => void, release!: () => void;
    const scanning = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let inspections = 0;
    internals.dirty = async () => {
      if (++inspections === 1) { entered(); await barrier; }
      return inspectDirty();
    };

    const locating = service.locate('note', note.id);
    await scanning;
    store.updateNote(note.id, note.title, note.markdown + '\nChanged during dirty scan', note.revision);
    release();

    await expect(locating).rejects.toMatchObject({ status: 409 });
    const current = await service.locate('note', note.id);
    expect(readFileSync(current.absolutePath, 'utf8')).toContain('Changed during dirty scan');
  });
  it('groups same-owner bindings independently and rebuilds exact IDs, raw placement, assets and recoverable drafts in a new instance', async () => {
    const { root, store, service } = fixture(); await grouped(store, service);
    store.createAttachment('image.png', 'image/png', Buffer.from([1, 2, 3]), 'Images/image.png');
    const note = store.snapshot().notes[0]; store.saveDraft('unfinished', { clientId: 'original-client', noteId: note.id, title: note.title, markdown: '@Broken = <|unfinished', syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, baseSourceHash: sourceHash(note.markdown), revision: 0, sourceEdits: [] });
    const before = store.projectionCapture(); const status = await service.checkpoint(); expect(status.state, status.error).toBe('ready');
    expect(readFileSync(join(root, 'Markdown/Food/Fruit.md'), 'utf8')).toContain('@Fruit = <|Apple|>');
    expect(readFileSync(join(root, 'Markdown/People/Person.Job.md'), 'utf8')).toContain('@Person.Job = <|Engineer|>');
    const recovered = await readFullGeneration(status.manifestPath!);
    expect(recovered.snapshot).toEqual(before.snapshot); expect(recovered.recovery.bundle.semantic).toEqual(before.semantic); expect(recovered.recovery.drafts).toEqual(before.drafts);
    const rebuilt = WorkspaceStore.rebuild(join(root, 'rebuilt.db'), recovered.snapshot, recovered.blobs, undefined, recovered.recovery); stores.push(rebuilt);
    expect(rebuilt.id).not.toBe(store.id); expect(rebuilt.snapshot().notes).toEqual(before.snapshot.notes);
    expect(rebuilt.semanticState()).toEqual({ ...before.semantic, workspaceId: rebuilt.id }); expect(rebuilt.drafts()).toEqual(before.drafts); expect(rebuilt.recoveredDraftsManual()).toBe(true);
    expect(rebuilt.history()).toEqual([]); expect(rebuilt.projectionCapture().lineageId).toBe(store.id);
  });
  it('partial export does not contain unselected binding, full owner source, drafts, or private attachment', async () => {
    const { root, store, service } = fixture(); const units = await grouped(store, service);
    store.createAttachment('secret.txt', 'text/plain', Buffer.from('PRIVATE ASSET'));
    const selected = units.find(unit => unit.label === 'Fruit')!;
    const output = await service.exportScope({ mode: 'partial', units: [selected.id] });
    const manifest = JSON.parse(readFileSync(output.manifestPath, 'utf8'));
    const combined = manifest.files.map((file: { path: string }) => readFileSync(join(output.absolutePath, file.path), 'utf8')).join('\n');
    expect(combined).toContain('Apple'); expect(combined).not.toContain('Engineer'); expect(combined).not.toContain('@Person.Job'); expect(combined).not.toContain('PRIVATE ASSET');
    expect(existsSync(join(output.absolutePath, '.grasp-export/recovery.json'))).toBe(false);
    await expect(readFullGeneration(output.manifestPath)).rejects.toThrow(/selected export/);
    expect(root).toBeTruthy();
  });
  it('preserves external changed/deleted/untracked files when DB changes, but still creates a complete recovery checkpoint', async () => {
    const { root, store, service } = fixture(); await grouped(store, service); expect((await service.checkpoint()).state).toBe('ready');
    const file = join(root, 'Markdown/Food/Fruit.md'); const external = readFileSync(file, 'utf8').replace('Apple', 'External'); writeFileSync(file, external);
    const note = store.snapshot().notes[0]; store.updateNote(note.id, note.title, note.markdown + '\r\nDB prose', note.revision);
    const status = await service.checkpoint(); expect(status.state).toBe('dirty'); expect(status.dirtyPaths).toContain('Food/Fruit.md'); expect(readFileSync(file, 'utf8')).toBe(external); expect(status.recoveryRevision).toBe(store.snapshot().revision);
    expect((await service.inspect()).mirror.state).toBe('dirty');
  });
  it('journals the two-rename cutover, restores previous complete public bytes on failure, then succeeds after restart', async () => {
    const { root, store, service } = fixture(); await grouped(store, service); const before = await service.checkpoint(); const old = readFileSync(before.manifestPath!, 'utf8');
    const note = store.snapshot().notes[0]; store.updateNote(note.id, note.title, note.markdown + 'next', note.revision);
    const failing = new ProjectionWorkspaceFiles(store, { fail: point => { if (point === 'old-renamed') throw new Error('injected cutover failure'); } }); files.push(failing);
    const failure = await failing.checkpoint(); expect(failure.state).toBe('error'); expect(readFileSync(before.manifestPath!, 'utf8')).toBe(old);
    await failing.close(); const reopened = new ProjectionWorkspaceFiles(store); files.push(reopened); const after = await reopened.checkpoint(); expect(after.state, after.error).toBe('ready');
    expect((await readFullGeneration(after.manifestPath!)).snapshot.notes[0].markdown.endsWith('next')).toBe(true);
    expect(readdirSync(join(root, '.grasp/internal/projection')).some(name => name.endsWith('.json.done'))).toBe(true);
  });
  it('draft-only changes produce a new checkpoint and retain two independent verified ordinary-file generations', async () => {
    const { root, store, service } = fixture(); await service.checkpoint(); const note = store.snapshot().notes[0];
    for (let i = 0; i < 3; i++) { store.saveDraft('draft', { clientId: 'client', noteId: note.id, title: note.title, markdown: `draft ${i}`, syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, revision: i }); expect((await service.checkpoint()).state).toBe('ready'); }
    const generations = readdirSync(join(root, '.grasp/recovery')).filter(name => name.startsWith('generation-')); expect(generations).toHaveLength(2);
    for (const generation of generations) { const data = await readFullGeneration(join(root, '.grasp/recovery', generation, '.grasp-export/manifest.json')); expect(data.snapshot.notes).toEqual(store.snapshot().notes); expect(data.recovery.drafts).toHaveLength(1); }
  });
  it('persists scoped packages across restart, rejects unknown/stale proposals and single-use reviewed apply', async () => {
    const { store, service } = fixture(); const state = await service.apiState(); const id = state.catalog.units[0].id as ProjectionUnitId; const pkg = service.planningPackage([id]);
    const proposal: ProjectionProposal = { format: 'grasp-projection-proposal', version: 1, workspaceId: store.id, base: pkg.base, planningPackageId: pkg.id, coverage: { mode: 'partial', units: [id] }, groups: [{ id: 'one', path: 'One.md', render: 'sections-v1', members: [id] }], unassigned: 'deterministic-default-v1' };
    const restarted = new ProjectionWorkspaceFiles(store); files.push(restarted); expect(() => restarted.planStrategy({ ...proposal, planningPackageId: 'unknown' })).toThrow(/planningPackageId/);
    const review = restarted.planStrategy(proposal); expect(review.canApply).toBe(true); restarted.applyStrategy(review.token!); expect(() => restarted.applyStrategy(review.token!)).toThrow(/過期/);
    const stale = restarted.planStrategy(proposal); expect(stale.canApply).toBe(false);
  });

  it('restores externally changed public bytes when a write lands after the final dirty scan', async () => {
    const { root, store, service } = fixture(); await grouped(store, service); await service.checkpoint();
    const file = join(root, 'Markdown/Food/Fruit.md'), original = readFileSync(file, 'utf8');
    const note = store.snapshot().notes[0]; store.updateNote(note.id, note.title, note.markdown + 'DB change', note.revision);
    const racing = new ProjectionWorkspaceFiles(store, { fail: point => { if (point === 'journal-durable') writeFileSync(file, original + '\nExternal concurrent edit'); } }); files.push(racing);
    const status = await racing.checkpoint(); expect(status.state).toBe('dirty'); expect(status.dirtyPaths).toContain('Food/Fruit.md'); expect(readFileSync(file, 'utf8')).toBe(original + '\nExternal concurrent edit');
  });

  it('reviews split-owner dirty files atomically and retains accepted hashes through a restart before publication', async () => {
    const { root, store, service } = fixture(); await grouped(store, service); await service.checkpoint();
    for (const [path, from, to] of [['Food/Fruit.md', '@Fruit = <|Apple|>', '@Fruit = <|Apricot|>'], ['People/Person.Job.md', '@Person.Job = <|Engineer|>', '@Person.Job = <|Writer|>']]) {
      const file = join(root, 'Markdown', path); writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
    }
    const review = await service.externalReview('Markdown/Food/Fruit.md'); expect(review.canApply).toBe(true); expect(review.approvals).toHaveLength(2);
    const before = store.snapshot(); store.applyImport({ notes: review.snapshot.notes, folders: review.snapshot.folders, records: review.snapshot.records }, before.revision, 'reviewed files', review.identityHints, review.approvals);
    const after = store.sharedState(); expect(after.semantic.results.find(value => value.name === 'Fruit')?.current.value).toBe('Apricot'); expect(after.semantic.results.find(value => value.name === 'Person.Job')?.current.value).toBe('Writer');
    await service.close(); store.close(); const reopenedStore = new WorkspaceStore(store.path); stores.push(reopenedStore); const restarted = new ProjectionWorkspaceFiles(reopenedStore); files.push(restarted);
    const status = await restarted.checkpoint(); expect(status.state, status.error).toBe('ready'); expect(reopenedStore.projectionMetadata('externalApprovals')).toEqual([]);
    expect((await readFullGeneration(status.manifestPath!)).snapshot).toEqual(after.snapshot);
  });

  it('does not trust externally re-signed reading baseline metadata as authority to edit another binding', async () => {
    const { root, store, service } = fixture(); await grouped(store, service); const status = await service.checkpoint();
    const file = join(root, 'Markdown/Food/Fruit.md'); writeFileSync(file, readFileSync(file, 'utf8').replace('@Fruit = <|Apple|>', '@Fruit = <|Pear|>'));
    const baselinePath = join(root, 'Markdown/.grasp-export/rendered.json'), baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    for (const item of baseline.files) for (const region of item.regions) if (region.kind === 'binding') { region.bindingId = 'attacker-selected-id'; region.beforeRaw = 'forged'; }
    const raw = JSON.stringify(baseline); writeFileSync(baselinePath, raw);
    const manifest = JSON.parse(readFileSync(status.manifestPath!, 'utf8')), entry = manifest.files.find((entry: { path: string }) => entry.path === '.grasp-export/rendered.json'); entry.sha256 = byteHash(raw); entry.size = Buffer.byteLength(raw);
    const metadata = JSON.stringify(manifest); writeFileSync(status.manifestPath!, metadata); writeFileSync(join(root, 'Markdown/.grasp-export/complete.json'), JSON.stringify({ format: 'grasp-generation-complete', version: 1, sha256: byteHash(metadata) }));
    const restarted = new ProjectionWorkspaceFiles(store); files.push(restarted); const review = await restarted.externalReview('Markdown/Food/Fruit.md');
    expect(review.canApply).toBe(true); expect(review.snapshot.notes[0].markdown).toContain('@Fruit = <|Pear|>'); expect(review.snapshot.notes[0].markdown).toContain('@Person.Job = <|Engineer|>');
    expect((await restarted.inspect()).mirror.dirtyPaths).toContain('Markdown/.grasp-export/rendered.json');
  });

  it('keeps duplicate occurrence identities when external prose edits surround their protected display tokens', async () => {
    const { store, service } = fixture(); await service.checkpoint(); const before = store.sharedState();
    const location = await service.locate('note', before.snapshot.notes[0].id), original = readFileSync(location.absolutePath, 'utf8');
    const edited = original.replace('> Start ', '> Updated start ').replace(' End', ' Updated end'); expect(edited).not.toBe(original); writeFileSync(location.absolutePath, edited);
    const review = await service.externalReview(location.path); expect(review.canApply).toBe(true);
    store.applyImport({ notes: review.snapshot.notes, folders: review.snapshot.folders, records: review.snapshot.records }, before.snapshot.revision, 'reviewed prose', review.identityHints, review.approvals);
    expect(store.semanticState().occurrences.map(item => item.id)).toEqual(before.semantic.occurrences.map(item => item.id));
    expect(store.snapshot().notes[0].markdown).toContain('Updated start [Apple](:ref:Fruit) [Apple](:ref:Fruit) Updated end');
  });
});
