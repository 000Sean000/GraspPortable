/** Current grasp-v1 only; synthetic fixtures, no corpus argument or private input.
 * Run alone: node --expose-gc --import tsx scripts/benchmark-shared.ts
 * Writes only docs/benchmarks/shared-domain.json; SQLite scratch is under OS temp.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpus, platform, arch, tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { buildKnowledge } from '../src/domain/knowledge';
import { ValueGraph } from '../src/domain/graph';
import { applySharedIntent, prepareSharedWorkspace } from '../src/domain/shared';
import type { Note, RuntimeResult, WorkspaceSnapshot } from '../src/domain/model';
import { WorkspaceStore } from '../server/store';
import { sourceHash, type SharedCommand } from '../server/semantic';

assert.equal(process.argv.length, 2, 'This benchmark accepts no corpus or path arguments.');
const gc = (globalThis as { gc?: () => void }).gc;
const round = (value: number) => Math.round(value * 100) / 100;
const elapsed = <T>(action: () => T): { value: T; ms: number } => { const start = performance.now(); const value = action(); return { value, ms: round(performance.now() - start) }; };
const memory = (phase: string) => ({ phase, ...process.memoryUsage() });
const collect = () => { gc?.(); };
const statistics = (samples: number[]) => {
  assert(samples.length > 0); const sorted = [...samples].sort((a, b) => a - b);
  return { count: samples.length, minMs: round(sorted[0]), p50Ms: round(sorted[Math.floor(sorted.length / 2)]),
    p95Ms: round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]), maxMs: round(sorted.at(-1)!), samplesMs: samples.map(round) };
};
const metrics = (result: RuntimeResult) => Object.fromEntries(Object.entries(result.metrics).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value]));
const note = (id: string, markdown: string, revision = 1): Note => ({ id, title: id, markdown, revision, updatedAt: '2026-01-01T00:00:00.000Z', folderId: null, syntaxVersion: 'grasp-v1' });
const refs = (name: string, count = 1000) => Array.from({ length: count }, (_, index) => index % 2 ? `[[@${name}|old]]` : `[old](:ref:${name})`).join('\n');
const chain = (count: number) => ['@Root = <|seed|>', ...Array.from({ length: count - 1 }, (_, index) => `@N${index + 1} = ${index === 0 ? 'Root' : `N${index}`}`)].join('\n');
const snapshot = (notes: Note[]): WorkspaceSnapshot => ({ id: 'synthetic-shared-benchmark', name: 'Synthetic v1', revision: 1, notes, folders: [], records: [], attachments: [], settings: {} });

function graphCase(label: string, source: string, last: string, value: (root: string) => string, definitions: number) {
  console.error(`[shared benchmark] ${label}`); collect();
  const samples = [memory('before')], graph = new ValueGraph(); let revision = 0;
  const step = (name: string, raw: string, expectedStatus: 'ok' | 'missing' | 'cycle', expectedValue?: string) => {
    const notes = [note('definitions', raw, ++revision), note('references', refs(last), revision)];
    const parse = elapsed(() => buildKnowledge(notes));
    assert.equal(parse.value.definitions.length, definitions); assert.equal(parse.value.diagnostics.length, 0);
    const update = elapsed(() => graph.update(parse.value, revision));
    assert.equal(update.value.values[last].status, expectedStatus, `${label}/${name}`);
    if (expectedValue !== undefined) assert.equal(update.value.values[last].value, expectedValue);
    const result = { phase: name, parseMs: parse.ms, graphWallMs: update.ms, graph: metrics(update.value), diagnosticCount: update.value.diagnostics.length,
      bodyReferences: parse.value.references.filter(reference => reference.kind === 'reference').length, lastStatus: update.value.values[last].status };
    samples.push(memory(name)); return result;
  };
  const phases = [
    step('initial', source, 'ok', value('seed')),
    step('root-literal-edit', source.replace('@Root = <|seed|>', '@Root = <|changed|>'), 'ok', value('changed')),
    step('missing', source.replace('@Root = <|seed|>', '@Root = Absent'), 'missing'),
    step('missing-recovery', source, 'ok', value('seed')),
    step('cycle', source.replace('@Root = <|seed|>', `@Root = ${last}`), 'cycle'),
    step('cycle-recovery', source, 'ok', value('seed')),
  ];
  const lookup = elapsed(() => { let checksum = 0; for (let index = 0; index < 100_000; index++) { checksum += graph.findReferences(index % 2 ? 'Root' : last).length; if (graph.getDefinition(last)) checksum++; } return checksum; });
  assert(lookup.value > 0); collect(); samples.push(memory('after-gc'));
  return { syntaxVersion: 'grasp-v1', definitions, sourceUtf16Characters: source.length, sourceUtf8Bytes: Buffer.byteLength(source), phases,
    indexedLookup: { iterations: 100_000, definitionAndReferenceMs: lookup.ms, checksum: lookup.value }, memory: samples };
}

function repeatedSharedPreparation() {
  console.error('[shared benchmark] 10k independent nodes plus a four-node affected diamond, 30 edits');
  const stable = Array.from({ length: 10_000 }, (_, index) => `@Stable${index} = <|${index}|>`).join('\n');
  const source = `${stable}\n@Edit = <|initial|>\n@Left = Edit + <|L|>\n@Right = Edit + <|R|>\n@Join = Left + <|/|> + Right`;
  const input = snapshot([note('definitions', source), note('references', refs('Join'))]);
  let identity = 0; const newId = (kind: 'identifier' | 'binding' | 'occurrence') => `${kind}-${++identity}`;
  const initial = elapsed(() => prepareSharedWorkspace(input, { hash: sourceHash, newId }));
  let prepared = initial.value, current = { ...input, notes: prepared.notes }; assert(prepared.canCommit);
  const bindingId = prepared.state.bindings.find(binding => binding.name === 'Edit')!.id;
  const originalOccurrences = prepared.state.occurrences.map(item => item.id), originalBindings = prepared.state.bindings.map(item => item.id);
  collect(); const samples = [memory('initial-prepared-after-gc')], whole: number[] = [], intentTimes: number[] = [], prepareTimes: number[] = [], graphTimes: number[] = [], recalculated: number[] = [], patchCounts: number[] = [];
  for (let iteration = 1; iteration <= 30; iteration++) {
    const start = performance.now(), value = `value-${iteration}`;
    const intent = elapsed(() => applySharedIntent(current, prepared.state, { kind: 'set-literal', bindingId, partIndex: 0, value }, { hash: sourceHash }));
    const candidate = { ...intent.value.snapshot, revision: current.revision + 1, notes: intent.value.snapshot.notes.map((item, index) => item.markdown === current.notes[index].markdown ? item : { ...item, revision: item.revision + 1 }) };
    const update = elapsed(() => prepareSharedWorkspace(candidate, { previous: prepared.state, previousSnapshot: current, graph: prepared.graph, hash: sourceHash, newId, identityHints: intent.value.identityHints }));
    whole.push(performance.now() - start); intentTimes.push(intent.ms); prepareTimes.push(update.ms); graphTimes.push(update.value.runtime.metrics.elapsedMs);
    assert(update.value.canCommit); assert.equal(update.value.runtime.values.Join.value, `${value}L/${value}R`);
    assert.equal(update.value.runtime.metrics.recalculated, 4); assert.equal(update.value.runtime.metrics.affected, 4);
    assert.deepEqual(update.value.state.occurrences.map(item => item.id), originalOccurrences); assert.deepEqual(update.value.state.bindings.map(item => item.id), originalBindings);
    assert.equal(update.value.patches.length, 1000);
    assert(update.value.notes[1].markdown.includes(`[${value}L/${value}R](:ref:Join)`));
    assert(update.value.notes[1].markdown.includes(`[[@Join|${value}L/${value}R]]`));
    recalculated.push(update.value.runtime.metrics.recalculated); patchCounts.push(update.value.patches.length);
    prepared = update.value; current = { ...candidate, notes: prepared.notes };
    if (iteration % 5 === 0) { collect(); samples.push(memory(`edit-${iteration}-after-gc`)); }
  }
  return { definitions: 10_004, bodyReferences: 1000, edits: 30, initialPrepareMs: initial.ms, intent: statistics(intentTimes), prepare: statistics(prepareTimes), intentAndPrepare: statistics(whole),
    graphOnly: statistics(graphTimes), recalculatedPerEdit: recalculated, sourceCachePatchesPerEdit: patchCounts, stableBindingAndOccurrenceIds: true,
    memory: samples, retainedHeapDeltaBytes: samples.at(-1)!.heapUsed - samples[0].heapUsed,
    timingScope: 'prepare includes source parsing, graph fork/update, semantic identity validation, persisted-cache source materialization and source reindexing; graphOnly is a contained subphase, not extra latency.' };
}

function sqliteSharedCommit() {
  console.error('[shared benchmark] SQLite 12k-node chain and 1000 cached references, five durable shared commits');
  const tempRoot = realpathSync(tmpdir()), directory = mkdtempSync(join(tempRoot, 'grasp-v1-shared-benchmark-'));
  const scratch = realpathSync(directory), inside = relative(tempRoot, scratch);
  assert(inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`));
  const repoRelative = relative(resolve('.'), scratch); assert(repoRelative === '..' || repoRelative.startsWith(`..${sep}`) || isAbsolute(repoRelative), 'SQLite scratch must be outside the repository.');
  const database = join(scratch, 'synthetic.db'); let store: WorkspaceStore | undefined;
  try {
    const setup = elapsed(() => {
      store = new WorkspaceStore(database, { create: true }); const first = store.snapshot().notes[0];
      store.updateNote(first.id, 'Deep chain', chain(12_000), first.revision, undefined, 'grasp-v1'); store.createNote('References', refs('N11999'), null, 'grasp-v1');
    });
    assert(store); collect(); const memorySamples = [memory('sqlite-loaded-after-gc')];
    const baseline = store.semanticState(), bindingIds = baseline.bindings.map(item => item.id), occurrenceIds = baseline.occurrences.map(item => item.id);
    const commitTimes: number[] = [], durableLookupTimes: number[] = [], changedNoteCounts: number[] = []; let lastCommand!: SharedCommand;
    for (let iteration = 1; iteration <= 5; iteration++) {
      const state = store.semanticState(), root = state.bindings.find(binding => binding.name === 'Root')!;
      lastCommand = { operationId: randomUUID(), workspaceId: store.id, baseSemanticRevision: state.revision, intent: { kind: 'set-literal', bindingId: root.id, bindingRevision: root.revision, partIndex: 0, value: `committed-${iteration}` } };
      const measured = elapsed(() => store!.commitShared(lastCommand)), result = measured.value;
      commitTimes.push(measured.ms); changedNoteCounts.push(result.receipt.changedNoteIds.length);
      assert.equal(result.semantic.results.find(item => item.name === 'N11999')?.current.value, `committed-${iteration}`);
      assert.equal(result.receipt.changedNoteIds.length, 2); assert.deepEqual(result.semantic.bindings.map(item => item.id), bindingIds); assert.deepEqual(result.semantic.occurrences.map(item => item.id), occurrenceIds);
      assert.equal(result.semantic.occurrences.filter(item => item.cache.renderedValue === `committed-${iteration}`).length, 1000);
      const lookup = elapsed(() => store!.operation(lastCommand.operationId)); assert.equal(lookup.value.operationId, lastCommand.operationId); durableLookupTimes.push(lookup.ms);
      collect(); memorySamples.push(memory(`sqlite-commit-${iteration}-after-gc`));
    }
    const replay = elapsed(() => store!.commitShared(lastCommand)); assert.equal(replay.value.receipt.operationId, lastCommand.operationId);
    const finalRevision = store.semanticState().revision; store.close(); store = undefined;
    const databaseBytes = statSync(database).size;
    const reopened = elapsed(() => { store = new WorkspaceStore(database); return store.sharedState(); });
    assert.equal(reopened.value.semantic.revision, finalRevision); assert.deepEqual(reopened.value.semantic.bindings.map(item => item.id), bindingIds); assert.deepEqual(reopened.value.semantic.occurrences.map(item => item.id), occurrenceIds);
    assert.equal(reopened.value.semantic.results.find(item => item.name === 'N11999')?.current.value, 'committed-5');
    assert.equal(store!.operation(lastCommand.operationId).operationId, lastCommand.operationId);
    collect(); memorySamples.push(memory('sqlite-reopened-after-gc'));
    return { definitions: 12_000, bodyReferences: 1000, initialDatabaseAndSourceSetupMs: setup.ms, durableCommit: statistics(commitTimes), receiptRead: statistics(durableLookupTimes),
      replayMs: replay.ms, reopenAndAuthoritativeReadMs: reopened.ms, databaseBytes, changedNoteCounts, restartIdentityAndReceiptVerified: true, memory: memorySamples,
      timingScope: 'Actual SQLite commit includes transaction, semantic preparation/cache materialization, receipt/inverse serialization and synchronous durability. Reopen does not flush the OS disk cache. No HTTP, worker or DOM latency is measured.' };
  } finally {
    store?.close(); const checked = realpathSync(directory), remaining = relative(tempRoot, checked);
    assert.equal(checked, scratch); assert(remaining && !isAbsolute(remaining) && remaining !== '..' && !remaining.startsWith(`..${sep}`));
    assert(remaining.startsWith('grasp-v1-shared-benchmark-')); rmSync(checked, { recursive: true, force: true });
  }
}

const started = performance.now(), initialMemory = memory('process-start');
const deep = graphCase('deep chain 12,000', chain(12_000), 'N11999', value => value, 12_000);
const wideSource = '@Root = <|seed|>\n' + Array.from({ length: 10_000 }, (_, index) => `@W${index} = Root + <|:${index}|>`).join('\n');
const wide = graphCase('wide fanout 10,000', wideSource, 'W9999', value => `${value}:9999`, 10_001);
const diamondSource = '@Root = <|seed|>\n' + Array.from({ length: 2000 }, (_, index) => `@Left${index} = Root + <|L|>\n@Right${index} = Root + <|R|>\n@Join${index} = Left${index} + <|/|> + Right${index}`).join('\n');
const mixed = graphCase('2,000 shared-root diamonds', diamondSource, 'Join1999', value => `${value}L/${value}R`, 6001);
const repeated = repeatedSharedPreparation(), persistence = sqliteSharedCommit(); collect();
const report = {
  format: 'grasp-shared-domain-benchmark', version: 1, generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, explicitGc: Boolean(gc) },
  command: 'node --expose-gc --import tsx scripts/benchmark-shared.ts',
  scope: 'Current grasp-v1 synthetic fixtures only. Production parser, graph, shared preparation and SQLite transaction; no private corpus, legacy grammar, filesystem publisher or browser interaction claim.',
  deepChain12k: deep, wideFanout10k: wide, mixedDiamonds: mixed, repeatedSmallSharedEdits: repeated, sqliteSharedCommit: persistence,
  memory: { units: 'bytes', initial: initialMemory, finalAfterGc: memory('process-final-after-gc'), maxRssKiBReportedByOS: process.resourceUsage().maxRSS,
    interpretation: 'Boundary samples and OS-reported high water mark, not allocation profiling. RSS may remain reserved after GC; durable receipts intentionally grow the database. A finite synthetic run does not prove absence of leaks.' },
  totalMs: round(performance.now() - started),
};
const output = resolve('docs/benchmarks/shared-domain.json'); mkdirSync(resolve('docs/benchmarks'), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ output: 'docs/benchmarks/shared-domain.json', totalMs: report.totalMs, deepParseMs: deep.phases[0].parseMs, wideParseMs: wide.phases[0].parseMs,
  repeatedPrepareP95Ms: repeated.prepare.p95Ms, sharedCommitP95Ms: persistence.durableCommit.p95Ms, allAssertionsPassed: true }, null, 2));
