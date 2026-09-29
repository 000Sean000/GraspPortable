/** Correctness after measurement, on an exclusively owned Scratch trial. Not timed baseline work. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, toNamespacedPath } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceStore } from '../server/store';
import { ProjectionWorkspaceFiles } from '../server/projection';
import { readFullGenerationStreaming } from '../server/projection-generation';
import { assertOutsideRepository, isWithin, repositoryRoot, resolvePhysicalPath } from './evidence-path';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
function scratchPath(key: string) {
  const supplied = args.get(key); assert(supplied && isAbsolute(supplied), `Missing absolute ${key}`);
  const value = assertOutsideRepository(supplied), scratch = resolvePhysicalPath(resolve(repositoryRoot, '..', 'Scratch'));
  assert(value !== scratch && isWithin(scratch, value), 'Verification inputs and output must stay inside Scratch.'); return value;
}
const workspace = scratchPath('--workspace'), frozen = scratchPath('--frozen-workspace'), output = scratchPath('--output-root');
const trialRoot = dirname(dirname(workspace)), frozenRoot = dirname(dirname(frozen));
assert(!isWithin(trialRoot, frozenRoot) && !isWithin(frozenRoot, trialRoot), 'Trial and frozen workspace roots must be disjoint.');
assert(!isWithin(trialRoot, output) && !isWithin(frozenRoot, output) && !isWithin(output, trialRoot) && !isWithin(output, frozenRoot), 'Use a separate new evidence directory.');
const baseline = JSON.parse(await readFile(scratchPath('--baseline-report'), 'utf8'));
assert(resolvePhysicalPath(baseline.workspace) === workspace && baseline.hostStop?.exitObserved === true && Number.isSafeInteger(baseline.hostPid), 'Require the matching finished baseline host.');
let hostGone = false;
try { process.kill(baseline.hostPid, 0); } catch (error) { hostGone = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
assert(hostGone, 'The measured host is still running or cannot be proved stopped.');
await mkdir(toNamespacedPath(output));
const report: Record<string, unknown> = { version: 1, baselineRunId: baseline.runId, baselineCommit: baseline.commit, baselineBuildId: baseline.build?.buildId,
  startedAt: new Date().toISOString(), status: 'running', timedBaseline: false, phases: {} };
const save = () => writeFile(toNamespacedPath(resolve(output, 'correctness.json')), JSON.stringify(report, null, 2));
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function phase<T>(name: string, action: () => Promise<T>): Promise<T> {
  report.phase = name; await save(); console.log(name); const start = performance.now(), result = await action();
  (report.phases as Record<string, number>)[name] = performance.now() - start; await save(); return result;
}
function compareOriginalRows() {
  const original = new DatabaseSync(frozen, { readOnly: true }), trial = new DatabaseSync(workspace, { readOnly: true });
  try {
    let notes = 0;
    const current = trial.prepare('SELECT * FROM notes WHERE id=?');
    for (const row of original.prepare('SELECT * FROM notes ORDER BY id').iterate()) { assert.equal(sha(JSON.stringify(current.get(row.id))), sha(JSON.stringify(row)), 'Original note identity/source/EOL changed.'); notes++; }
    for (const name of ['folders', 'records', 'attachments']) assert.deepEqual(trial.prepare(`SELECT * FROM ${name} ORDER BY id`).all(), original.prepare(`SELECT * FROM ${name} ORDER BY id`).all());
    return notes;
  } finally { original.close(); trial.close(); }
}
let store: WorkspaceStore | undefined, service: ProjectionWorkspaceFiles | undefined;
try {
  report.originalNotesVerified = compareOriginalRows();
  store = new WorkspaceStore(workspace); service = new ProjectionWorkspaceFiles(store);
  const status = await phase('explicit-final-checkpoint', () => service!.checkpoint());
  await writeFile(toNamespacedPath(resolve(output, 'checkpoint-private.json')), JSON.stringify(status, null, 2));
  assert.equal(status.state, 'ready', 'Final checkpoint did not succeed; preserve its terminal error privately.');
  const expected = store.projectionCapture(); report.revision = expected.snapshot.revision;
  const fallback = resolve(output, 'Standalone-fallback');
  await phase('copy-standalone-fallback', () => cp(toNamespacedPath(status.projectionRoot), toNamespacedPath(fallback), { recursive: true, force: false, errorOnExist: true }));
  const recoveryRoot = resolve(dirname(dirname(workspace)), '.grasp', 'recovery');
  const names = (await readdir(toNamespacedPath(recoveryRoot))).filter(name => /^generation-[a-f\d-]+$/.test(name));
  let valid = 0, invalid = 0, foreign = 0;
  await phase('validate-retained-recovery', async () => {
    for (const name of names) {
      try {
        const generation = await readFullGenerationStreaming(resolve(recoveryRoot, name, '.grasp-export', 'manifest.json'));
        if (generation.snapshot.id === expected.snapshot.id) valid++; else foreign++;
      }
      catch { invalid++; }
    }
    assert(valid >= 2, 'Missing evidence: fewer than two independent valid recovery generations for this workspace.');
  });
  report.recovery = { validGenerations: valid, invalidPreservedGenerations: invalid, foreignPreservedGenerations: foreign };
  await service.close(); service = undefined; store.close(); store = undefined;
  const portable = await phase('validate-standalone-fallback', () => readFullGenerationStreaming(resolve(fallback, '.grasp-export', 'manifest.json')));
  const rebuilt = resolve(output, 'Rebuilt', '.grasp', 'workspace.grasp.db');
  store = await phase('fresh-db-rebuild', () => WorkspaceStore.rebuildStreaming(rebuilt, portable.snapshot, portable.readBlob, undefined, portable.recovery));
  const actual = store.projectionCapture();
  assert.notEqual(actual.snapshot.id, expected.snapshot.id);
  assert.deepEqual(actual.snapshot, { ...expected.snapshot, id: actual.snapshot.id });
  assert.deepEqual(actual.semantic, { ...expected.semantic, workspaceId: actual.snapshot.id });
  assert.deepEqual(actual.strategy, { ...expected.strategy, workspaceId: actual.snapshot.id });
  assert.deepEqual(actual.drafts, expected.drafts); assert.equal(actual.lineageId, expected.lineageId); assert.deepEqual(actual.provenance, expected.provenance);
  for (const asset of actual.snapshot.attachments) assert.equal(sha(store.readBlob(asset.sha256)), asset.sha256);
  store.close(); store = new WorkspaceStore(rebuilt); assert.deepEqual(store.projectionCapture(), actual);
  report.originalNotesVerifiedAfter = compareOriginalRows();
  report.verified = { exactSourceEolAndIdentities: true, foldersRecordsAttachmentsUnchanged: true, standaloneFreshDatabase: true,
    sharedSemanticState: true, strategy: true, durableDrafts: true, lineageAndProvenance: true, allAttachmentHashes: actual.snapshot.attachments.length, restart: true,
    operationReceiptsAndHistory: 'Not a fallback guarantee; unchanged contracts covered by regression suite.' };
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; await writeFile(toNamespacedPath(resolve(output, 'failure-private.txt')), error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await service?.close(); }
  catch { report.status = 'failed'; report.closeError = true; process.exitCode = 1; }
  finally { try { store?.close(); } finally { report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, phase: report.phase })); } }
}
