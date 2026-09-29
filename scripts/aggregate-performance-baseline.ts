/** Privacy-reviewed P0 summaries. Reads evidence only; never opens a workspace database. */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { assertOutsideRepository, isWithin, repositoryRoot, resolvePhysicalPath } from './evidence-path';

type Data = Record<string, any>;
const object = (value: unknown): Data => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const phases = ['cold', 'idle', 'warm', 'noop', 'validation', 'graph', 'stress'] as const;
const cells = [...phases, 'setup', 'verification', 'cleanup', 'unattributed'];
const counts = { typing: 100, search: 30, navigation: 30, mode: 30, selection: 30, panel: 10, save: 10 };
const outcomes = ['ok', 'error', 'http_error', 'timeout', 'cancelled', 'not-ready', 'superseded', 'destroyed', 'stale', 'unknown'];
const uiNames = ['ui.input.raf', 'ui.beforeinput.raf', 'ui.keydown.raf', 'ui.search.raf', 'ui.selection.raf', 'ui.click.raf', 'ui.note.intent', 'ui.mode.intent', 'ui.panel.shell.intent', 'ui.panel.content.intent'];
const loads = ['publication', 'generation', 'db', 'validation', 'hashing', 'graph'];
const stageNames = [
  'http.request', 'http.body', 'http.parse', 'http.serialize', 'db.open', 'db.snapshot', 'db.capture', 'db.transaction', 'db.commit',
  'db.semantic', 'db.shared-state', 'db.draft-save', 'db.draft.parse', 'db.blob', 'db.parse', 'db.serialize',
  'projection.checkpoint', 'projection.publish', 'projection.wait', 'projection.capture', 'projection.catalog', 'projection.plan',
  'projection.render', 'projection.hash', 'projection.generation', 'projection.recovery', 'projection.retention', 'projection.inspect',
  'projection.locate', 'projection.parse', 'projection.serialize', 'fs.read', 'fs.write', 'fs.check', 'fs.rename', 'fs.inventory',
  'fs.validate', 'fs.dirty', 'fs.copy', 'fs.cleanup',
];
const operationKinds = [
  'typing-source', 'typing-live', 'typing-background-source', 'extreme-typing-source', 'extreme-typing-live', 'extreme-save-ack', 'search', 'navigation',
  'mode', 'extreme-mode', 'selection', 'panel-shell', 'panel-content', 'save', 'availability-probe',
  'cold-checkpoint', 'warm-checkpoint', 'noop-checkpoint', 'checkpoint-before-idle', 'checkpoint-before-noop',
  'stress-checkpoint-a', 'stress-checkpoint-b', 'filesystem-validation', 'large-synthetic-db-operation', 'extreme-synthetic-db-operation',
  'selection-prepare', 'sustained-typing-prepare', 'graph-typing-prepare', 'idle-precondition-save', 'noop-precondition-save',
];
function choose(value: unknown, allowed: readonly string[], fallback = 'unknown'): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}
function numericFields<K extends string>(value: unknown, keys: readonly K[]): Record<K, number | null> {
  const input = object(value); return Object.fromEntries(keys.map(key => [key, number(input[key])])) as Record<K, number | null>;
}
function percentile(values: number[], p: number): number | null {
  return values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;
}
function distribution(values: number[]) {
  return { count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95),
    minMs: values.reduce<number | null>((min, value) => Math.min(min ?? value, value), null), maxMs: values.reduce<number | null>((max, value) => Math.max(max ?? 0, value), null) };
}
export function summarizeSamples(input: unknown[]) {
  const samples = input.map(object), outcomeCounts = Object.fromEntries(outcomes.map(outcome => [outcome, 0]));
  const successful: number[] = [], nonSuccessful: number[] = [], censored: number[] = []; let missingDuration = 0;
  for (const sample of samples) {
    const outcome = choose(sample.outcome, outcomes), elapsed = number(sample.durationMs); outcomeCounts[outcome]++;
    if (elapsed === null) { missingDuration++; continue; }
    (outcome === 'ok' ? successful : nonSuccessful).push(elapsed);
    if (['timeout', 'cancelled'].includes(outcome)) censored.push(elapsed);
  }
  return { attempted: samples.length, outcomes: outcomeCounts, missingDuration, successfulOnly: distribution(successful),
    nonSuccessfulObserved: distribution(nonSuccessful), censoredLowerBounds: distribution(censored),
    completionP95Ms: missingDuration === 0 && successful.length === samples.length ? percentile(successful, .95) : null };
}
type SampleSummary = ReturnType<typeof summarizeSamples>;
function budget(summary: SampleSummary, limitMs: number | null) {
  const observed = summary.successfulOnly.p95Ms;
  return { limitMs, successfulOnlyP95Ms: observed, assessment: limitMs === null ? 'separate-no-fixed-budget'
    : observed === null ? 'unavailable' : observed > limitMs ? 'exceeded'
    : summary.attempted !== summary.successfulOnly.count ? 'incomplete-outcomes' : 'within-observed-successes' };
}
function tier(cell: string) { return cell === 'stress' ? 'extreme' : 'daily'; }
function interactionScope(sample: Data): string {
  if (sample.cell !== 'stress') return 'daily';
  if (['extreme-typing-source', 'extreme-typing-live', 'extreme-mode', 'extreme-save-ack'].includes(sample.operationKind)) return 'extreme-note';
  return operationKinds.includes(sample.operationKind) ? 'ordinary-under-stress' : 'stress-unclassified';
}
function uiBudget(scope: string, name: string): number | null {
  if (scope === 'stress-unclassified') return null;
  if (name === 'ui.input.raf') return scope === 'extreme-note' ? 100 : 50;
  return ['ui.search.raf', 'ui.selection.raf', 'ui.note.intent', 'ui.mode.intent', 'ui.panel.content.intent'].includes(name) ? 100 : null;
}
function ackScope(sample: Data): string {
  if (sample.cell !== 'stress' && sample.scope !== 'extreme-stress') return 'ordinary';
  // The current API trace has no note identity or request-size classification. Cell membership alone cannot classify a draft as large.
  return sample.operationKind === 'extreme-save-ack' ? 'extreme-note' : 'mixed-stress-unclassified';
}
function hex(value: unknown, length: number | null = null): string | null {
  return typeof value === 'string' && /^[a-f\d]{8,64}$/i.test(value) && (length === null || value.length === length) ? value.toLowerCase() : null;
}
function buildId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value) ? value.toLowerCase() : hex(value);
}
function version(value: unknown): string | null { return typeof value === 'string' && /^v?\d+(?:\.\d+){1,3}$/.test(value) ? value : null; }
function timestamp(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}
function coverageCodes(value: unknown) {
  const known = new Set([
    ...Object.keys(counts).map(key => `sample-count:${key}`),
    ...['uiEventLatency', 'browserBlocking', 'browserWorker', 'coordinatorLoop', 'dbOperations', 'projectionCpu', 'filesystemIo', 'checkpointEndToEnd', 'uiDuringCheckpoint'].map(key => `metric:${key}`),
    ...phases.flatMap(cell => loads.flatMap(load => [`overlap:${cell}/${load}`, `typing-overlap:${cell}/${load}`])),
    ...['typing', 'search', 'navigation', 'mode', 'selection', 'panel'].flatMap(key => [`direct-action:${key}`, `missing-direct-actions:${key}`]),
    'panel-useful-content', 'extreme-fixture',
  ]);
  return list(value).map(item => typeof item === 'string' && known.has(item) ? item : 'unrecognized-coverage-item');
}

export function emptyHostSamples() {
  return { source: 'unavailable', samples: 0, availableDelaySamples: 0, unavailableDelaySamples: 0, malformedLines: 0,
    worstSampledP99Ms: null as number | null, maxDelayMs: null as number | null, processCpuUserMs: null as number | null,
    processCpuSystemMs: null as number | null, eventLoopActiveMs: null as number | null, eventLoopIdleMs: null as number | null,
    peakRssBytes: null as number | null, peakHeapUsedBytes: null as number | null };
}
type HostSamples = ReturnType<typeof emptyHostSamples>;
export async function readHostSamples(path: string): Promise<HostSamples> {
  const result = emptyHostSamples();
  try { await stat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result; throw error; }
  result.source = 'streamed-host-trace';
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: Data; try { event = object(JSON.parse(line)); } catch { result.malformedLines++; continue; }
    if (event.version !== 1 || event.name !== 'coordinator.event-loop' || event.phase !== 'sample') continue;
    const metrics = object(event.metrics); result.samples++;
    if (metrics.eventLoopDelayAvailable === true) {
      result.availableDelaySamples++;
      for (const [key, source] of [['worstSampledP99Ms', 'eventLoopP99Ms'], ['maxDelayMs', 'eventLoopMaxMs']] as const) {
        const value = number(metrics[source]); if (value !== null) result[key] = Math.max(result[key] ?? 0, value);
      }
    } else result.unavailableDelaySamples++;
    for (const key of ['processCpuUserMs', 'processCpuSystemMs', 'eventLoopActiveMs', 'eventLoopIdleMs'] as const) {
      const value = number(metrics[key]); if (value !== null) result[key] = (result[key] ?? 0) + value;
    }
    for (const [key, source] of [['peakRssBytes', 'rssBytes'], ['peakHeapUsedBytes', 'heapUsedBytes']] as const) {
      const value = number(metrics[source]); if (value !== null) result[key] = Math.max(result[key] ?? 0, value);
    }
  }
  return result;
}
function sanitizeHostSamples(input: HostSamples) {
  const clean = { source: choose(input.source, ['streamed-host-trace', 'report', 'unavailable']),
    ...numericFields(input, ['samples', 'availableDelaySamples', 'unavailableDelaySamples', 'malformedLines', 'worstSampledP99Ms', 'maxDelayMs',
      'processCpuUserMs', 'processCpuSystemMs', 'eventLoopActiveMs', 'eventLoopIdleMs', 'peakRssBytes', 'peakHeapUsedBytes']) };
  return { ...clean, budget: { sampledP99LimitMs: 20, maxLimitExclusiveMs: 100,
    assessment: clean.worstSampledP99Ms === null || clean.maxDelayMs === null ? 'unavailable'
      : clean.worstSampledP99Ms > 20 || clean.maxDelayMs >= 100 ? 'exceeded' : 'within-observed-windows' } };
}
function sanitizedStage(value: unknown) {
  const data = object(value), successful = object(data.successfulOnly);
  return { count: number(data.count), outcomes: numericFields(data.outcomes, outcomes),
    allObserved: numericFields(data.allObserved, ['totalElapsedMs', 'maxMs']),
    successfulOnly: numericFields(successful, ['p50Ms', 'p95Ms', 'maxMs']), nestedDurationsNotAdditive: true };
}
export function aggregateTrial(raw: unknown, correctnessRaw: unknown, host: HostSamples, index: number) {
  const report = object(raw), summary = object(report.summary), correctness = object(correctnessRaw), corpus = object(report.corpus);
  const direct = list(summary.directBrowserSamples).map(object), operations = list(report.operations).map(object);
  const ui = cells.flatMap(cell => uiNames.flatMap(name => ['daily', 'extreme-note', 'ordinary-under-stress', 'stress-unclassified'].flatMap(scope => {
    const selected = direct.filter(sample => sample.cell === cell && sample.name === name && interactionScope(sample) === scope); if (!selected.length) return [];
    const samples = summarizeSamples(selected); return [{ cell, scope, tier: scope === 'extreme-note' ? 'extreme' : scope === 'stress-unclassified' ? 'unclassified' : 'daily', metric: name, ...samples, budget: budget(samples, uiBudget(scope, name)),
      withActualPublicationOverlap: selected.filter(sample => list(sample.publicationOverlap).length > 0).length }];
  })));
  const acknowledgement = ['ordinary', 'extreme-note', 'mixed-stress-unclassified'].flatMap(scope => ['draft-save', 'semantic-commit'].map(kind => {
    const samples = summarizeSamples(list(summary.directBrowserApiSamples).filter(sample => object(sample).name === 'api.request'
      && ackScope(object(sample)) === scope && object(sample).acknowledgement === kind));
    return { scope, kind, ...samples, budget: budget(samples, scope === 'ordinary' ? 200 : null) };
  }));
  const actions = cells.flatMap(cell => operationKinds.flatMap(kind => ['http', 'driver'].flatMap(measurement => {
    const selected = operations.filter(sample => sample.cell === cell && sample.kind === kind && sample.measurement === measurement);
    if (!selected.length) return [];
    const samples = summarizeSamples(selected);
    return [{ cell, kind, measurement, purpose: kind.endsWith('-prepare') || kind.endsWith('-precondition-save') ? 'preparation' : 'operation', ...samples, budget: budget(samples, kind === 'availability-probe' ? 100 : null) }];
  })));
  const byStage = object(summary.byStage), stages = Object.fromEntries(['coordinator', 'db', 'projection', 'filesystem'].flatMap(lane => stageNames.flatMap(name => {
    const key = `${lane}/${name}`; return byStage[key] ? [[key, sanitizedStage(byStage[key])]] : [];
  })));
  const integrity = { ...numericFields(report.traceIntegrity, ['rawHostEvents', 'compactStructuralSpans', 'unclosedHostSpans', 'hostDroppedEvents', 'hostSinkErrors',
    'browserDropped', 'browserDroppedIntents', 'browserActiveIntents', 'malformedLines']), orderlyExitObserved: bool(object(report.traceIntegrity).orderlyExitObserved) };
  const checkpointAttempts = operations.filter(sample => sample.measurement === 'http' && operationKinds.includes(sample.kind) && sample.kind.includes('checkpoint')).map(sample => ({
    cell: choose(sample.cell, cells), kind: choose(sample.kind, operationKinds), outcome: choose(sample.outcome, outcomes), durationMs: number(sample.durationMs),
    httpStatus: number(sample.httpStatus), applicationState: choose(sample.applicationState, ['ready', 'pending', 'dirty', 'error', 'idle']) }));
  const actionEvidence = Object.fromEntries(['terminal-observed', 'censored-no-terminal-observed', 'missing-direct-observation', 'driver-failure-before-observation'].map(key =>
    [key, list(summary.driverActionEvidence).filter(value => object(value).evidence === key).length]));
  const correctnessMatched = typeof report.runId === 'string' && report.runId.length > 0 && correctness.baselineRunId === report.runId;
  const correctnessResult = { status: choose(correctness.status, ['passed', 'failed', 'running'], 'unavailable'), matchedBaseline: correctnessMatched,
    ...numericFields(correctness, ['originalNotesVerified', 'originalNotesVerifiedAfter', 'revision']),
    recovery: numericFields(correctness.recovery, ['validGenerations', 'invalidPreservedGenerations', 'foreignPreservedGenerations']),
    verified: Object.fromEntries(['exactSourceEolAndIdentities', 'foldersRecordsAttachmentsUnchanged', 'standaloneFreshDatabase', 'sharedSemanticState', 'strategy', 'durableDrafts', 'lineageAndProvenance', 'restart'].map(key => [key, bool(object(correctness.verified)[key])])),
    allAttachmentHashes: number(object(correctness.verified).allAttachmentHashes) };
  const cellResults = phases.map(name => {
    const matches = list(report.cells).filter(value => object(value).name === name), cell = object(matches[0]), start = number(cell.start), end = number(cell.end);
    return { name, tier: tier(name), occurrences: matches.length, outcome: choose(cell.outcome, ['ok', 'measured-failures', 'measured-non-ready', 'incomplete', 'running']),
      durationMs: start !== null && end !== null && end >= start ? end - start : null };
  });
  const attempted = numericFields(report.attemptedActionCounts, Object.keys(counts));
  const reasons: string[] = [];
  if (report.countsPreset !== 'full' || Object.entries(counts).some(([key, minimum]) => (attempted[key] ?? -1) < minimum)) reasons.push('full-sampling-not-proved');
  if (list(report.phases).length !== 7 || phases.some(phase => !list(report.phases).includes(phase))
    || cellResults.some(cell => cell.occurrences !== 1 || cell.durationMs === null || !['ok', 'measured-failures', 'measured-non-ready'].includes(cell.outcome))) reasons.push('seven-finished-cells-not-proved');
  if (report.measurementCoverageComplete !== true || list(report.coverageMissing).length) reasons.push('measurement-coverage-incomplete');
  if (report.originalDataUnchanged !== true) reasons.push('original-fidelity-not-proved');
  if (correctness.status !== 'passed' || !correctnessMatched) reasons.push('matching-correctness-not-proved');
  if (Object.values(integrity).some(value => value === null) || integrity.orderlyExitObserved !== true
    || (['unclosedHostSpans', 'hostDroppedEvents', 'hostSinkErrors', 'browserDropped', 'browserDroppedIntents', 'browserActiveIntents', 'malformedLines'] as const).some(key => integrity[key] !== 0)) reasons.push('trace-integrity-not-proved');
  const clockUncertainties = Object.values(object(report.clocks)).map(value => number(object(object(value).combined).uncertaintyMs)).filter((value): value is number => value !== null);
  return { trial: `trial-${index + 1}`, startedAt: timestamp(report.startedAt), finishedAt: timestamp(report.finishedAt),
    status: choose(report.status, ['running', 'incomplete', 'complete', 'complete-with-measured-failures', 'complete-with-measured-non-ready']),
    commit: hex(report.commit, 40), buildId: buildId(object(report.build).buildId), dirtyWorkingTree: typeof report.workingTree === 'string' ? report.workingTree.length > 0 : null,
    countsPreset: choose(report.countsPreset, ['full', 'smoke']), corpus: { ...numericFields(corpus, ['notes', 'noteBytes', 'folders', 'records', 'attachments', 'attachmentBytes', 'revision', 'databaseBytes']), originalDigest: hex(corpus.originalDigest, 64) },
    environment: { node: version(object(report.environment).node), platform: choose(object(report.environment).platform, ['win32', 'linux', 'darwin']),
      ...numericFields(report.environment, ['logicalCpus', 'ramBytes']), browserVersion: version(object(report.browser).version), browserChannel: choose(object(report.browser).channel, ['msedge', 'chromium']),
      headless: bool(object(report.browser).headless), powerProfile: 'not-reported', storageDevice: 'not-reported', osDiskCache: 'uncontrolled' },
    cells: cellResults, attemptedActionCounts: attempted, successfulActionCounts: numericFields(report.successfulActionCounts, Object.keys(counts)),
    measurementCoverageComplete: report.measurementCoverageComplete === true, coverageMissing: coverageCodes(report.coverageMissing), traceIntegrity: integrity,
    metricCoverage: { ...Object.fromEntries(['uiEventLatency', 'browserBlocking', 'browserWorker', 'coordinatorLoop', 'dbOperations', 'projectionCpu', 'filesystemIo', 'checkpointEndToEnd', 'uiDuringCheckpoint'].map(key => [key, bool(object(summary.metricCoverage)[key])])), dbQueue: 'not-applicable-current-host-has-no-dedicated-db-queue' },
    originalDataUnchanged: bool(report.originalDataUnchanged), maximumClockUncertaintyMs: clockUncertainties.length ? Math.max(...clockUncertainties) : null,
    ui, acknowledgement, actions, actionEvidence, checkpointAttempts, stages, hostSamples: sanitizeHostSamples(host),
    unclassifiedDirectSamples: summarizeSamples(direct.filter(sample => !cells.includes(sample.cell) || !uiNames.includes(sample.name))),
    unclassifiedOperations: summarizeSamples(operations.filter(sample => !cells.includes(sample.cell) || !operationKinds.includes(sample.kind) || !['http', 'driver'].includes(sample.measurement))),
    actualPublicationCount: list(summary.publicationSpans).length, publicationInvocationCount: list(summary.publicationInvocationSpans).length,
    genuinePublicationOverlapSamples: number(summary.genuinePublicationOverlapSamples),
    overlapByCell: Object.fromEntries(phases.map(cell => [cell, numericFields(object(summary.overlapByCell)[cell], loads)])),
    typingOverlapByCell: Object.fromEntries(phases.map(cell => [cell, numericFields(object(summary.typingOverlapByCell)[cell], loads)])),
    correctness: correctnessResult, formalTrialEligible: reasons.length === 0, formalIneligibility: reasons };
}
export function aggregateReports(inputs: Array<{ report: unknown; correctness?: unknown; host?: HostSamples; independentWorkspace?: string }>) {
  if (![1, 3].includes(inputs.length)) throw new Error('Supply one smoke review or three formal trial reports.');
  const trials = inputs.map((input, index) => aggregateTrial(input.report, input.correctness, input.host ?? emptyHostSamples(), index));
  const independent = inputs.every(input => typeof input.independentWorkspace === 'string' && input.independentWorkspace.length > 0)
    && new Set(inputs.map(input => input.independentWorkspace)).size === inputs.length;
  const sameCorpus = trials.every(trial => trial.corpus.originalDigest !== null && trial.corpus.originalDigest === trials[0].corpus.originalDigest);
  const sameBuild = trials.every(trial => trial.commit !== null && trial.buildId !== null && trial.commit === trials[0].commit && trial.buildId === trials[0].buildId && trial.dirtyWorkingTree === false);
  const complete = inputs.length === 3 && independent && sameCorpus && sameBuild && trials.every(trial => trial.formalTrialEligible);
  const checkpointRanges = operationKinds.filter(kind => kind.includes('checkpoint')).flatMap(kind => {
    const attempts = trials.flatMap(trial => trial.checkpointAttempts.filter(sample => sample.kind === kind)), values = attempts.filter(sample => sample.outcome === 'ok' && sample.durationMs !== null).map(sample => sample.durationMs!);
    return attempts.length ? [{ kind, attempts: attempts.length, successful: values.length, successfulIndividualMs: values,
      successfulRangeMs: { min: values.reduce<number | null>((min, value) => Math.min(min ?? value, value), null), max: values.reduce<number | null>((max, value) => Math.max(max ?? 0, value), null) } }] : [];
  });
  return { schemaVersion: 1, status: complete ? '3-trial-complete' : inputs.length === 1 ? 'single-trial-review' : '3-trial-incomplete',
    trialCount: inputs.length, independentWorkspaces: independent, matchingCorpusDigest: sameCorpus, matchingCleanBuild: sameBuild, checkpointRanges,
    interpretation: [
      'Budget failures are baseline findings; evidence completeness does not imply performance success.',
      'UI timing is handler-to-next-rAF/useful-update evidence, not physical input-to-pixel or native IME.',
      'Stress UI is split by driver attribution: extreme-note, ordinary-under-stress, or unclassified. Other cells include daily interactions under graph and publication load.',
      'Stress ACKs without note-level attribution are mixed/unclassified; cell membership does not prove a giant-source save.',
      'Panel shell is feedback only; panel content carries the useful-state budget.',
      'ACK is dispatch-to-response, separately for durable draft and semantic commit; debounce is excluded.',
      'Unsuccessful and censored attempts remain counted; successful-only percentiles are not all-attempt completion percentiles.',
      'Stage wall times include nested/overlapping work and must not be added or called CPU.',
      'CPU is process-wide sampled deltas. Worst sampled loop p99 is not a whole-run p99.',
      'Main-thread background attribution and native interaction remain separate evidence; no blocking-task budget pass is inferred.',
      'Individual checkpoint durations across three trials are not a reliable checkpoint p95.',
    ], trials };
}
type Aggregate = ReturnType<typeof aggregateReports>;
const fmt = (value: number | null) => value === null ? 'N/A' : value.toFixed(2);
export function renderMarkdown(aggregate: Aggregate): string {
  const lines = ['# P0 performance aggregate', '', `Evidence status: **${aggregate.status}**. Trials: ${aggregate.trialCount}.`, '',
    'Private names, locations, source and raw errors are excluded. Detailed failures remain in the private evidence.', ''];
  for (const trial of aggregate.trials) {
    lines.push(`## ${trial.trial}`, '', `Run: ${trial.status}. Sampling: ${trial.countsPreset}. Formal evidence eligible: ${trial.formalTrialEligible}. Correctness: ${trial.correctness.status}.`, '',
      `Corpus: ${trial.corpus.notes ?? 'N/A'} notes, ${trial.corpus.noteBytes ?? 'N/A'} source bytes. Build: ${trial.buildId ?? 'N/A'}; commit: ${trial.commit ?? 'N/A'}.`, '',
      `Actual publications: ${trial.actualPublicationCount}; invocation spans: ${trial.publicationInvocationCount}; direct samples overlapping publication: ${trial.genuinePublicationOverlapSamples ?? 'N/A'}.`, '',
      '| Cell / tier | Direct metric | Attempts / successful | p50 ms | p95 ms | max ms | Budget ms / assessment |', '|---|---|---:|---:|---:|---:|---|');
    for (const row of trial.ui) lines.push(`| ${row.cell} / ${row.scope} | ${row.metric} | ${row.attempted} / ${row.successfulOnly.count} | ${fmt(row.successfulOnly.p50Ms)} | ${fmt(row.successfulOnly.p95Ms)} | ${fmt(row.successfulOnly.maxMs)} | ${fmt(row.budget.limitMs)} / ${row.budget.assessment} |`);
    lines.push('', '| ACK scope | Kind | Attempts / successful | p95 ms | max ms | Budget assessment |', '|---|---|---:|---:|---:|---|');
    for (const row of trial.acknowledgement) lines.push(`| ${row.scope} | ${row.kind} | ${row.attempted} / ${row.successfulOnly.count} | ${fmt(row.successfulOnly.p95Ms)} | ${fmt(row.successfulOnly.maxMs)} | ${row.budget.assessment} |`);
    lines.push('', '| HTTP/driver operation | Cell | Outcome counts (ok/error/timeout/cancelled/not-ready) | Successful p95 ms | Censored max lower bound ms |', '|---|---|---|---:|---:|');
    for (const row of trial.actions.filter(row => row.measurement === 'http' || row.purpose === 'preparation' || row.attempted !== row.successfulOnly.count)) lines.push(`| ${row.measurement}/${row.kind} (${row.purpose}) | ${row.cell} | ${['ok', 'error', 'timeout', 'cancelled', 'not-ready'].map(outcome => row.outcomes[outcome]).join('/')} | ${fmt(row.successfulOnly.p95Ms)} | ${fmt(row.censoredLowerBounds.maxMs)} |`);
    lines.push('', '| Checkpoint | Cell | Outcome / application state | Observed elapsed ms (individual) |', '|---|---|---|---:|');
    for (const sample of trial.checkpointAttempts) lines.push(`| ${sample.kind} | ${sample.cell} | ${sample.outcome} / ${sample.applicationState} | ${fmt(sample.durationMs)} |`);
    const host = trial.hostSamples;
    lines.push('', `Host: worst sampled loop p99 ${fmt(host.worstSampledP99Ms)} ms; maximum delay ${fmt(host.maxDelayMs)} ms (${host.budget.assessment}). Process CPU user/system ${fmt(host.processCpuUserMs)}/${fmt(host.processCpuSystemMs)} ms; peak RSS ${host.peakRssBytes ?? 'N/A'} bytes.`, '',
      `Unclosed host spans: ${trial.traceIntegrity.unclosedHostSpans ?? 'N/A'}; host dropped/sink errors: ${trial.traceIntegrity.hostDroppedEvents ?? 'N/A'}/${trial.traceIntegrity.hostSinkErrors ?? 'N/A'}; browser dropped: ${trial.traceIntegrity.browserDropped ?? 'N/A'}.`, '',
      `Coverage omissions: ${trial.coverageMissing.length ? trial.coverageMissing.join(', ') : 'none reported'}. Formal evidence omissions: ${trial.formalIneligibility.length ? trial.formalIneligibility.join(', ') : 'none'}.`, '',
      '| Host stage (nested, nonadditive) | Count | Success p95 ms | All-outcome max ms |', '|---|---:|---:|---:|');
    for (const [name, stage] of Object.entries(trial.stages)) lines.push(`| ${name} | ${stage.count ?? 'N/A'} | ${fmt(stage.successfulOnly.p95Ms)} | ${fmt(stage.allObserved.maxMs)} |`);
    lines.push('');
  }
  lines.push('## Interpretation', '', ...aggregate.interpretation.map(text => `- ${text}`), '');
  return lines.join('\n');
}
export interface AggregateArguments { output: string; inputs: Array<{ report: string; correctness?: string }> }
export function parseArguments(args: string[]): AggregateArguments {
  const inputs: AggregateArguments['inputs'] = []; let output = '';
  for (let at = 0; at < args.length; at += 2) {
    const key = args[at], value = args[at + 1]; if (!value || !isAbsolute(value)) throw new Error('Every argument needs an absolute path.');
    if (key === '--report') inputs.push({ report: value });
    else if (key === '--correctness' && inputs.length && !inputs.at(-1)!.correctness) inputs.at(-1)!.correctness = value;
    else if (key === '--output-root' && !output) output = value;
    else throw new Error('Use --report, optional following --correctness, and one --output-root.');
  }
  if (![1, 3].includes(inputs.length) || !output) throw new Error('Supply one or three reports and an exclusive output directory.');
  return { inputs, output };
}
function scratchPath(path: string): string {
  const value = assertOutsideRepository(path), scratch = resolvePhysicalPath(resolve(repositoryRoot, '..', 'Scratch'));
  if (!isWithin(scratch, value) || value === scratch) throw new Error('All evidence must be inside Scratch.'); return value;
}
async function readJson(path: string): Promise<unknown> {
  if ((await stat(path)).size > 256 * 1024 * 1024) throw new Error('Report exceeds the bounded JSON input size.');
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function main(args: string[]): Promise<void> {
  const options = parseArguments(args), output = scratchPath(options.output);
  const inputs = options.inputs.map(input => ({ report: scratchPath(input.report), correctness: input.correctness ? scratchPath(input.correctness) : undefined }));
  if (new Set(inputs.map(input => input.report)).size !== inputs.length) throw new Error('Reports must be distinct.');
  for (const input of inputs) for (const file of [input.report, input.correctness].filter((path): path is string => !!path)) {
    if (isWithin(output, file) || isWithin(dirname(file), output)) throw new Error('Output must be separate from each input evidence directory.');
  }
  const data = [];
  for (const input of inputs) {
    const report = object(await readJson(input.report)); if (report.schemaVersion !== 1) throw new Error('Unsupported report schema.');
    const correctness = input.correctness ? await readJson(input.correctness) : undefined;
    const host = await readHostSamples(scratchPath(resolve(dirname(input.report), 'host.jsonl')));
    const independentWorkspace = typeof report.workspace === 'string' && isAbsolute(report.workspace) ? scratchPath(report.workspace) : undefined;
    data.push({ report, correctness, host, independentWorkspace });
  }
  const aggregate = aggregateReports(data);
  await mkdir(output); // Exclusive: never reuse or overwrite an existing evidence directory.
  await writeFile(resolve(output, 'aggregate.json'), JSON.stringify(aggregate, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(output, 'aggregate.md'), renderMarkdown(aggregate), { flag: 'wx' });
  console.log(JSON.stringify({ status: aggregate.status, trials: aggregate.trialCount }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => { console.error('Aggregation failed; inputs and any partial output are preserved.'); process.exitCode = 1; });
}
