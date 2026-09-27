/** Full private-corpus acceptance. Only aggregate results may be published. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { cp, lstat, mkdir, open, readFile, readdir, realpath, statfs, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, toNamespacedPath } from 'node:path';
import { cpus } from 'node:os';
import { planVault, applyVault, writeVaultReport } from '../server/migration';
import { WorkspaceStore } from '../server/store';
import { ProjectionWorkspaceFiles } from '../server/projection';
import { readFullGenerationStreaming } from '../server/projection-generation';
import type { WorkspaceSnapshot } from '../src/domain/model';

const options = new Map(process.argv.slice(2).map(argument => { const at = argument.indexOf('='); assert(at > 0); return [argument.slice(0, at), argument.slice(at + 1)]; }));
assert(options.has('--source') && options.has('--output'), 'Use --source=<read-only snapshot> --output=<new private Scratch directory>');
const native = toNamespacedPath;
async function destination(path: string): Promise<string> {
  let current = resolve(path); const missing: string[] = [];
  for (;;) {
    try { await lstat(native(current)); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = dirname(current); assert.notEqual(parent, current); missing.unshift(current.slice(parent.length).replace(/^[\\/]+/, '')); current = parent; }
  }
  return resolve(await realpath(native(current)), ...missing);
}
const requestedSource = resolve(options.get('--source')!), sourceInfo = await lstat(native(requestedSource));
assert(sourceInfo.isDirectory() && !sourceInfo.isSymbolicLink(), 'Source must be a real read-only snapshot directory.');
const source = await realpath(native(requestedSource)), output = await destination(options.get('--output')!);
function inside(root: string, child: string) { const path = relative(root, child); return path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path); }
assert(!inside(source, output) && !inside(output, source) && !inside(await realpath(process.cwd()), output), 'Output must be outside the source tree and repository, including resolved aliases.');
await mkdir(native(output)); // A rerun must choose a new verification directory.
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model }, phases: {}, desktopGuiVerified: false };
const privateState: Record<string, unknown> = { source, output };
async function save() { await writeFile(native(resolve(output, 'aggregate-results.json')), JSON.stringify(report, null, 2)); await writeFile(native(resolve(output, 'locations-private.json')), JSON.stringify(privateState, null, 2)); }
async function measured<T>(name: string, action: () => Promise<T>): Promise<T> {
  report.phase = name; await save(); const start = performance.now(); const value = await action();
  (report.phases as Record<string, unknown>)[name] = { ms: performance.now() - start, memory: process.memoryUsage() }; await save(); return value;
}
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
type FileHash = { path: string; size: number; mtimeMs: number; sha256: string };
async function inventory(root: string) {
  const files: FileHash[] = [], directories: string[] = [];
  async function walk(part: string) {
    for (const name of (await readdir(native(resolve(root, part)))).sort()) {
      const path = part ? `${part}/${name}` : name, absolute = native(resolve(root, path)), before = await lstat(absolute);
      assert(!before.isSymbolicLink(), 'Snapshot contains a symlink.');
      assert(inside(root, await realpath(absolute)), 'Snapshot entry escaped its root.');
      if (before.isDirectory()) { directories.push(path); await walk(path); }
      else {
        assert(before.isFile()); const digest = createHash('sha256'), handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try { for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk); } finally { await handle.close(); }
        const after = await lstat(absolute); assert(after.isFile() && !after.isSymbolicLink()); assert.equal(after.ino, before.ino); assert.equal(after.ctimeMs, before.ctimeMs);
        assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert(inside(root, await realpath(absolute)));
        files.push({ path, size: before.size, mtimeMs: before.mtimeMs, sha256: digest.digest('hex') });
      }
    }
  }
  await walk(''); files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); directories.sort();
  return { files, directories, bytes: files.reduce((sum, file) => sum + file.size, 0), fingerprint: hash(JSON.stringify({ files: files.map(({ mtimeMs: _, ...file }) => file), directories })) };
}
let store: WorkspaceStore | undefined, service: ProjectionWorkspaceFiles | undefined;
try {
  const before = await measured('source-inventory', () => inventory(source));
  await writeFile(native(resolve(output, 'source-before-private.json')), JSON.stringify(before));
  const capacity = await statfs(native(output)); assert(capacity.bavail * capacity.bsize > before.bytes * 10, 'Not enough free space for independent source, DB and fallback generations.');
  const copy = resolve(output, 'Source-copy'); privateState.sourceCopy = copy;
  await measured('copy-source', () => cp(native(source), native(copy), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true }));
  const copied = await measured('verify-source-copy', () => inventory(copy)); assert.equal(copied.fingerprint, before.fingerprint);
  report.original = { files: before.files.length, directories: before.directories.length, bytes: before.bytes, fingerprint: before.fingerprint };
  const plan = await measured('migration-preview', () => planVault(copy));
  await writeVaultReport(plan, resolve(output, 'Private-reports'));
  const database = resolve(output, 'Imported', '.grasp', 'workspace.grasp.db'); privateState.importedDatabase = database;
  await measured('migration-apply', () => applyVault(plan, database));
  store = new WorkspaceStore(database);
  const sourceHashes = new Map(plan.report.files.filter(file => file.kind === 'note').map(file => [file.id, file.sha256]));
  function verifyOriginal(snapshot: WorkspaceSnapshot) {
    for (const [id, expected] of sourceHashes) assert.equal(hash(Buffer.from(snapshot.notes.find(note => note.id === id)!.markdown, 'utf8')), expected);
    // node:sqlite rows have a null prototype; compare the serialized DTO
    // contract, including every field, rather than JavaScript prototypes.
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.folders)), plan.snapshot.folders);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.attachments)), plan.snapshot.attachments);
  }
  await measured('verify-import', async () => {
    assert.equal(store!.snapshot().notes.length, plan.snapshot.notes.length); assert.deepEqual(store!.snapshot().records, plan.snapshot.records);
    verifyOriginal(store!.snapshot()); for (const asset of store!.snapshot().attachments) assert.equal(hash(store!.readBlob(asset.sha256)), asset.sha256);
  });
  report.imported = { ...plan.report.counts, links: plan.report.links, unsupportedPatterns: plan.report.unsupported.length, retainedAssetBytes: plan.report.memory.retainedAssetBytes };
  const created = store.createNote('Grasp acceptance shared workflow', '# Acceptance\r\n\r\n@M4.Root = <|Before|>\r\n@M4.Nested = <|**|> + M4.Root + <|**|>\r\n\r\n[old](:ref:M4.Root)\r\n[[@M4.Nested|old]]\r\n', null, 'grasp-v1');
  const note = created.notes.find(note => note.title === 'Grasp acceptance shared workflow')!;
  service = new ProjectionWorkspaceFiles(store);
  const catalog = await service.apiState(), units = catalog.catalog.units.filter(unit => unit.owner.id === note.id);
  const pkg = service.planningPackage(units.map(unit => unit.id));
  const review = service.planStrategy({ format: 'grasp-projection-proposal', version: 1, workspaceId: store.id, base: pkg.base, planningPackageId: pkg.id,
    coverage: { mode: 'partial', units: units.map(unit => unit.id) }, groups: units.map(unit => ({ id: `acceptance-${unit.id}`, path: `Acceptance/${unit.kind === 'binding' ? unit.label : 'Reading'}.md`, render: 'sections-v1', members: [unit.id] })), unassigned: 'deterministic-default-v1' });
  assert.equal(review.canApply, true); service.applyStrategy(review.token!);
  const initial = await measured('full-checkpoint', () => service!.checkpoint()); assert.equal(initial.state, 'ready', initial.error ?? 'Checkpoint did not publish.'); privateState.projection = initial.projectionRoot;
  const unit = units.find(unit => unit.label === 'M4.Root')!;
  const partial = await measured('selected-export', () => service!.exportScope({ mode: 'partial', units: [unit.id] }));
  const selectedManifest = JSON.parse(await readFile(native(partial.manifestPath), 'utf8'));
  assert.deepEqual(selectedManifest.plan.units.map((item: { id: string }) => item.id), [unit.id]); assert.equal(selectedManifest.plan.attachments.length, 0);
  assert.equal(selectedManifest.kind, 'partial'); assert(!selectedManifest.files.some((item: { path: string }) => item.path === '.grasp-export/recovery.json'));
  for (const file of selectedManifest.files as Array<{ path: string }>) {
    const content = await readFile(native(resolve(dirname(dirname(partial.manifestPath)), file.path)), 'utf8');
    assert(!content.includes('M4.Nested'), 'Selected binding export leaked another binding from its canonical owner.');
  }
  const groupedPath = 'Markdown/Acceptance/M4.Root.md', absolute = resolve(service.root, groupedPath);
  const published = await readFile(native(absolute), 'utf8'), edited = published.replace('@M4.Root = <|Before|>', '@M4.Root = <|After|>'); assert.notEqual(edited, published);
  await writeFile(native(absolute), edited); assert.equal((await service.inspect()).mirror.state, 'dirty');
  const external = await service.externalReview(groupedPath); assert.equal(external.canApply, true);
  const beforeImport = store.semanticState(); store.applyImport(external.snapshot, external.snapshot.revision, 'Acceptance reviewed external edit', external.identityHints, external.approvals);
  assert.deepEqual(store.semanticState().bindings.map(item => item.id), beforeImport.bindings.map(item => item.id));
  assert.equal(store.semanticState().results.find(item => item.name === 'M4.Nested')?.current.value, '**After**'); verifyOriginal(store.snapshot());
  const final = await measured('updated-checkpoint', () => service!.checkpoint()); assert.equal(final.state, 'ready', final.error ?? 'Updated checkpoint did not publish.');
  const beforeRebuild = store.projectionCapture(); privateState.originalSnapshotId = store.id;
  const portable = resolve(output, 'Standalone-fallback');
  await measured('copy-standalone-fallback', () => cp(native(final.projectionRoot), native(portable), { recursive: true, force: false, errorOnExist: true }));
  const manifestPath = resolve(portable, '.grasp-export/manifest.json'); privateState.standaloneManifest = manifestPath;
  await service.close(); service = undefined; store.close(); store = undefined;
  const complete = await measured('validate-standalone-fallback', () => readFullGenerationStreaming(manifestPath));
  const rebuiltPath = resolve(output, 'Rebuilt', '.grasp', 'workspace.grasp.db'); privateState.rebuiltDatabase = rebuiltPath;
  store = await measured('fresh-database-rebuild', () => WorkspaceStore.rebuildStreaming(rebuiltPath, complete.snapshot, complete.readBlob, undefined, complete.recovery));
  assert.notEqual(store.id, beforeRebuild.snapshot.id); assert.deepEqual(store.snapshot(), { ...beforeRebuild.snapshot, id: store.id }); assert.deepEqual(store.semanticState(), { ...beforeRebuild.semantic, workspaceId: store.id });
  const rebuiltCapture = store.projectionCapture();
  assert.deepEqual(rebuiltCapture.strategy, { ...beforeRebuild.strategy, workspaceId: store.id });
  assert.equal(rebuiltCapture.lineageId, beforeRebuild.lineageId); assert.deepEqual(rebuiltCapture.provenance, beforeRebuild.provenance); verifyOriginal(store.snapshot());
  for (const asset of store.snapshot().attachments) assert.equal(hash(store.readBlob(asset.sha256)), asset.sha256);
  const binding = store.semanticState().bindings.find(binding => binding.name === 'M4.Root')!;
  store.commitShared({ operationId: randomUUID(), workspaceId: store.id, baseSemanticRevision: store.semanticState().revision, intent: { kind: 'set-literal', bindingId: binding.id, bindingRevision: binding.revision, partIndex: 0, value: 'After rebuild' } });
  assert.equal(store.semanticState().results.find(item => item.name === 'M4.Nested')?.current.value, '**After rebuild**');
  const restartState = store.sharedState(); store.close(); store = new WorkspaceStore(rebuiltPath); assert.deepEqual(store.sharedState(), restartState); verifyOriginal(store.snapshot());
  const after = await measured('original-source-final-inventory', () => inventory(source)); assert.deepEqual(after, before);
  const copiedAfter = await inventory(copy); assert.deepEqual(copiedAfter, copied);
  report.verified = { originalSnapshotUnchanged: true, copiedSourceUnchanged: true, allImportedNoteHashes: sourceHashes.size, allAttachmentHashes: plan.report.counts.attachments,
    sharedEditAfterRebuild: true, standaloneFallback: true, exactSourceOwnerIdentities: true, strategyPreserved: true, realDatabaseReopen: true, selectedScopeIsolated: true };
  report.status = 'passed'; report.completedAt = new Date().toISOString(); await save(); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = 'failed'; privateState.failure = error instanceof Error ? error.stack : String(error); await save();
  console.error(JSON.stringify({ status: 'failed', phase: report.phase, privateDetailsSaved: true })); process.exitCode = 1;
} finally { await service?.close(); store?.close(); }
