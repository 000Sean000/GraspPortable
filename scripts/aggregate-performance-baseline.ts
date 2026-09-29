/** Privacy-reviewed P0 summaries. Reads evidence only; never opens a workspace database. */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { assertOutsideRepository, isWithin, repositoryRoot, resolvePhysicalPath } from './evidence-path';
import { aggregateBrowserPerformance, renderBrowserPerformanceMarkdown } from './aggregate-browser-performance';

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
  'graph-fixture-verification', 'extreme-fixture-verification', 'graph-fixture-readback', 'extreme-fixture-readback',
  'extreme-source-prepare', 'extreme-live-prepare',
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
const SMALL_SOURCE_MAX_CHARACTERS = 16_384, GIANT_SOURCE_MIN_CHARACTERS = 1_000_000, ACK_LINK_MAX_GAP_MS = 10;
const requestId = (value: unknown): value is string => typeof value === 'string' && /^r[1-9]\d{0,30}$/.test(value);
interface DraftRequestSize { characters: number | null; bodyBytes: number | null; parseObservations: number; ambiguous: boolean }
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
    ...['source', 'live'].flatMap(mode => [`sample-count:extreme-typing-${mode}`, `direct-action:extreme-typing-${mode}`, `missing-direct-actions:extreme-typing-${mode}`]),
    'panel-useful-content', 'extreme-fixture', 'verified-graph-fixture', 'verified-extreme-fixture', 'extreme-fixture-dimensions',
  ]);
  return list(value).map(item => typeof item === 'string' && known.has(item) ? item : 'unrecognized-coverage-item');
}

export function emptyHostSamples() {
  return { source: 'unavailable', samples: 0, availableDelaySamples: 0, unavailableDelaySamples: 0, malformedLines: 0,
    worstSampledP99Ms: null as number | null, maxDelayMs: null as number | null, processCpuUserMs: null as number | null,
    processCpuSystemMs: null as number | null, eventLoopActiveMs: null as number | null, eventLoopIdleMs: null as number | null,
    peakRssBytes: null as number | null, peakHeapUsedBytes: null as number | null,
    requestSizes: {} as Record<string, DraftRequestSize> };
}
type HostSamples = ReturnType<typeof emptyHostSamples>;
export async function readHostSamples(path: string, requestedIds: Iterable<string> = []): Promise<HostSamples> {
  const result = emptyHostSamples();
  const wanted = new Set([...requestedIds].filter(requestId));
  try { await stat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result; throw error; }
  result.source = 'streamed-host-trace';
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: Data; try { event = object(JSON.parse(line)); } catch { result.malformedLines++; continue; }
    if (event.version !== 1) continue;
    if (requestId(event.requestId) && wanted.has(event.requestId)) {
      const parse = event.name === 'db.draft.parse' && event.phase === 'start' && event.lane === 'db';
      const body = event.name === 'http.body' && event.phase === 'instant' && event.lane === 'coordinator';
      if (parse || body) {
        const size = result.requestSizes[event.requestId] ??= { characters: null, bodyBytes: null, parseObservations: 0, ambiguous: false };
        if (parse) {
          const characters = number(object(event.metrics).characters); size.parseObservations++;
          if (size.parseObservations > 1 || characters === null || !Number.isSafeInteger(characters)) size.ambiguous = true;
          size.characters = characters;
        } else {
          const bytes = number(object(event.metrics).bytes);
          if (size.bodyBytes !== null && size.bodyBytes !== bytes) size.ambiguous = true;
          size.bodyBytes = bytes;
        }
      }
    }
    if (event.name !== 'coordinator.event-loop' || event.phase !== 'sample') continue;
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
/** Join only successful, uniquely matched ACKs. A semantic command's tiny body is never its source-size evidence. */
export function classifyAcknowledgements(raw: unknown, host: HostSamples) {
  const summary = object(object(raw).summary);
  const requests = list(summary.directBrowserApiSamples).map(object).filter(sample => sample.name === 'api.request'
    && ['draft-save', 'semantic-commit'].includes(sample.acknowledgement));
  const sizes = requests.map(sample => {
    const evidence = requestId(sample.requestId) ? host.requestSizes[sample.requestId] : undefined;
    return evidence && !evidence.ambiguous && evidence.parseObservations === 1 ? number(evidence.characters) : null;
  });
  const semanticSizes = new Map<number, number>(), pendingDrafts = new Map<string, { characters: number | null; at: number }>();
  const consumed = new Set<number>();
  const instants = list(summary.browserAcknowledgementInstants).map((value, index): Data => ({ ...object(value), index }))
    .filter(value => number(value.at) !== null && ['app.draft.ack', 'app.commit.ack'].includes(value.name)
      && typeof value.parentId === 'string' && /^s(?:0|[1-9]\d*):b[1-9]\d*$/.test(value.parentId))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  for (const instant of instants) {
    const kind = instant.name === 'app.draft.ack' ? 'draft-save' : 'semantic-commit';
    const candidates = requests.flatMap((sample, index) => sample.acknowledgement === kind && sample.outcome === 'ok' && !consumed.has(index)
      && number(sample.at) !== null && sample.at <= instant.at && instant.at - sample.at <= ACK_LINK_MAX_GAP_MS ? [index] : []);
    const index = candidates.length === 1 ? candidates[0] : undefined;
    if (index !== undefined) consumed.add(index);
    if (kind === 'draft-save') pendingDrafts.set(instant.parentId, { characters: index === undefined ? null : sizes[index], at: instant.at });
    else {
      const draft = pendingDrafts.get(instant.parentId), sample = index === undefined ? undefined : requests[index];
      if (index !== undefined && draft?.characters !== null && draft?.characters !== undefined && sample
        && number(sample.durationMs) !== null && sample.at - sample.durationMs >= draft.at) semanticSizes.set(index, draft.characters);
      pendingDrafts.delete(instant.parentId);
    }
  }
  return requests.map((sample, index) => {
    const successful = sample.outcome === 'ok', draft = sample.acknowledgement === 'draft-save';
    const sourceCharacters = successful ? draft ? sizes[index] : semanticSizes.get(index) ?? null : null;
    const scope = sourceCharacters === null ? 'unclassified' : sourceCharacters <= SMALL_SOURCE_MAX_CHARACTERS ? 'ordinary-small'
      : sourceCharacters >= GIANT_SOURCE_MIN_CHARACTERS ? 'giant-source' : 'intermediate-source';
    const body = requestId(sample.requestId) ? host.requestSizes[sample.requestId] : undefined;
    return { kind: choose(sample.acknowledgement, ['draft-save', 'semantic-commit']), cell: choose(sample.cell, cells, 'unattributed'),
      outcome: choose(sample.outcome, outcomes), durationMs: number(sample.durationMs), scope, sourceCharacters, requestBodyBytes: number(body?.bodyBytes),
      evidence: sourceCharacters === null ? 'unclassified' : draft ? 'host-draft-parse' : 'preceding-draft-in-same-flush',
      reason: sourceCharacters !== null ? 'classified' : successful ? 'missing-or-ambiguous-correlation' : 'non-success-retained-unclassified' };
  });
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
export function verifiedFixture(input: unknown, kind: 'graph' | 'extreme') {
  const value = object(input);
  const dimensions = (source: unknown) => ({ ...numericFields(source, ['bytes', 'definitions', 'references', 'dependencyReferences', 'noteRevision', 'workspaceRevision']), sourceHash: hex(object(source).sourceHash, 64) });
  const expected = dimensions(value.expected), returned = dimensions(value.returned), readback = dimensions(value.readback);
  const matching = expected.sourceHash !== null && expected.sourceHash === returned.sourceHash && expected.sourceHash === readback.sourceHash
    && (['bytes', 'definitions', 'references'] as const).every(key => expected[key] !== null && expected[key] === returned[key] && expected[key] === readback[key]);
  const requiredDimensions = kind === 'graph' ? { definitions: 1000, references: 5000 } : { definitions: 10000, references: 50000 };
  const valid = value.verificationVersion === 1 && value.verified === true && value.requiredMutationSucceeded === true && matching
    && expected.definitions === requiredDimensions.definitions && expected.references === requiredDimensions.references
    && (kind !== 'extreme' || expected.bytes === 1_750_000)
    && returned.dependencyReferences === expected.definitions! - 1 && readback.dependencyReferences === returned.dependencyReferences
    && returned.noteRevision !== null && returned.workspaceRevision !== null && readback.noteRevision === returned.noteRevision
    && readback.workspaceRevision !== null && readback.workspaceRevision >= returned.workspaceRevision;
  return { verified: valid, verificationVersion: number(value.verificationVersion), requiredMutationSucceeded: bool(value.requiredMutationSucceeded), expected, returned, readback };
}
export function extremeInputEvidence(raw: unknown) {
  const report = object(raw), operations = list(report.operations).map(object), direct = list(object(report.summary).directBrowserSamples).map(object);
  return Object.fromEntries((['source', 'live'] as const).map(mode => {
    const kind = `extreme-typing-${mode}`, attempts = operations.filter(operation => operation.cell === 'stress' && operation.measurement === 'driver' && operation.kind === kind);
    const ids = new Set(attempts.map(operation => operation.id).filter(id => typeof id === 'string' && /^o[1-9]\d*$/.test(id)));
    const terminals = direct.filter(sample => sample.cell === 'stress' && sample.name === 'ui.input.raf' && sample.operationKind === kind && ids.has(sample.operationId));
    const terminalIds = new Set(terminals.map(sample => sample.operationId));
    const deliveredIds = new Set(terminals.filter(sample => sample.outcome === 'ok' && number(sample.durationMs) !== null).map(sample => sample.operationId));
    const observed = { attempted: attempts.length, driverSuccessful: attempts.filter(operation => operation.outcome === 'ok').length,
      driverFailed: attempts.filter(operation => operation.outcome !== 'ok').length, directTerminalAttempts: attempts.filter(operation => terminalIds.has(operation.id)).length,
      deliveredAttempts: attempts.filter(operation => deliveredIds.has(operation.id)).length,
      missingDirectSuccessfulAttempts: attempts.filter(operation => operation.outcome === 'ok' && !terminalIds.has(operation.id)).length };
    const reported = numericFields(object(report.extremeInputCoverage)[mode], Object.keys(observed) as Array<keyof typeof observed>);
    const reportedCountsMatch = (Object.keys(observed) as Array<keyof typeof observed>).every(key => reported[key] === observed[key]);
    const expectedAttempts = mode === 'source' ? 30 : 20;
    return [mode, { ...observed, reported, reportedCountsMatch, expectedFullAttempts: expectedAttempts,
      validOperationIds: ids.size === attempts.length,
      formalDeliveryVerified: ids.size === attempts.length && reportedCountsMatch && observed.attempted >= expectedAttempts
        && observed.deliveredAttempts > 0 && observed.missingDirectSuccessfulAttempts === 0,
      directTiming: summarizeSamples(terminals), driverTiming: summarizeSamples(attempts) }];
  })) as Record<'source' | 'live', { attempted: number; driverSuccessful: number; driverFailed: number; directTerminalAttempts: number;
    deliveredAttempts: number; missingDirectSuccessfulAttempts: number; reported: Record<string, number | null>; reportedCountsMatch: boolean;
    expectedFullAttempts: number; validOperationIds: boolean; formalDeliveryVerified: boolean; directTiming: SampleSummary; driverTiming: SampleSummary }>;
}
export function aggregateTrial(raw: unknown, correctnessRaw: unknown, host: HostSamples, index: number, browserRaw?: unknown) {
  const report = object(raw), summary = object(report.summary), correctness = object(correctnessRaw), corpus = object(report.corpus);
  const browserPerformance = aggregateBrowserPerformance(raw, browserRaw);
  const direct = list(summary.directBrowserSamples).map(object), operations = list(report.operations).map(object);
  const ui = cells.flatMap(cell => uiNames.flatMap(name => ['daily', 'extreme-note', 'ordinary-under-stress', 'stress-unclassified'].flatMap(scope => {
    const selected = direct.filter(sample => sample.cell === cell && sample.name === name && interactionScope(sample) === scope); if (!selected.length) return [];
    const samples = summarizeSamples(selected); return [{ cell, scope, tier: scope === 'extreme-note' ? 'extreme' : scope === 'stress-unclassified' ? 'unclassified' : 'daily', metric: name, ...samples, budget: budget(samples, uiBudget(scope, name)),
      withActualPublicationOverlap: selected.filter(sample => list(sample.publicationOverlap).length > 0).length }];
  })));
  const acknowledgementSamples = classifyAcknowledgements(report, host);
  const acknowledgement = ['ordinary-small', 'giant-source', 'intermediate-source', 'unclassified'].flatMap(scope => ['draft-save', 'semantic-commit'].map(kind => {
    const selected = acknowledgementSamples.filter(sample => sample.scope === scope && sample.kind === kind), samples = summarizeSamples(selected);
    const unknown = acknowledgementSamples.filter(sample => sample.scope === 'unclassified' && sample.kind === kind).length;
    const comparison = budget(samples, scope === 'ordinary-small' ? 200 : null);
    if (scope === 'ordinary-small' && unknown && comparison.assessment === 'within-observed-successes') comparison.assessment = 'incomplete-attribution';
    return { scope, kind, ...samples, sourceCharacters: { min: selected.reduce<number | null>((min, sample) => sample.sourceCharacters === null ? min : Math.min(min ?? sample.sourceCharacters, sample.sourceCharacters), null),
      max: selected.reduce<number | null>((max, sample) => sample.sourceCharacters === null ? max : Math.max(max ?? 0, sample.sourceCharacters), null) },
      unclassifiedSameKind: unknown, budget: comparison };
  }));
  const actions = cells.flatMap(cell => operationKinds.flatMap(kind => ['http', 'driver'].flatMap(measurement => {
    const selected = operations.filter(sample => sample.cell === cell && sample.kind === kind && sample.measurement === measurement);
    if (!selected.length) return [];
    const samples = summarizeSamples(selected);
    return [{ cell, kind, measurement, purpose: kind.endsWith('-prepare') || kind.endsWith('-precondition-save') || kind.includes('-fixture-') ? 'preparation' : 'operation', ...samples, budget: budget(samples, kind === 'availability-probe' ? 100 : null) }];
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
  const graphFixture = verifiedFixture(report.graphFixture, 'graph'), extremeFixture = verifiedFixture(report.extremeFixture, 'extreme');
  const extremeInputCoverage = extremeInputEvidence(report);
  const reasons: string[] = [];
  if (report.countsPreset !== 'full' || Object.entries(counts).some(([key, minimum]) => (attempted[key] ?? -1) < minimum)) reasons.push('full-sampling-not-proved');
  if (list(report.phases).length !== 7 || phases.some(phase => !list(report.phases).includes(phase))
    || cellResults.some(cell => cell.occurrences !== 1 || cell.durationMs === null || !['ok', 'measured-failures', 'measured-non-ready'].includes(cell.outcome))) reasons.push('seven-finished-cells-not-proved');
  if (report.measurementCoverageComplete !== true || list(report.coverageMissing).length) reasons.push('measurement-coverage-incomplete');
  if (browserPerformance.availability !== 'observed') reasons.push('browser-evidence-unavailable');
  if (!graphFixture.verified) reasons.push('stored-graph-fixture-not-proved');
  if (!extremeFixture.verified) reasons.push('stored-extreme-fixture-not-proved');
  for (const mode of ['source', 'live'] as const) if (!extremeInputCoverage[mode].formalDeliveryVerified) reasons.push(`extreme-${mode}-input-not-proved`);
  if (report.originalDataUnchanged !== true) reasons.push('original-fidelity-not-proved');
  if (correctness.status !== 'passed' || !correctnessMatched) reasons.push('matching-correctness-not-proved');
  if (Object.values(integrity).some(value => value === null) || integrity.orderlyExitObserved !== true
    || (['unclosedHostSpans', 'hostDroppedEvents', 'hostSinkErrors', 'browserDropped', 'browserDroppedIntents', 'browserActiveIntents', 'malformedLines'] as const).some(key => integrity[key] !== 0)) reasons.push('trace-integrity-not-proved');
  const clockUncertainties = Object.values(object(report.clocks)).map(value => number(object(object(value).combined).uncertaintyMs)).filter((value): value is number => value !== null);
  return { trial: `trial-${index + 1}`, startedAt: timestamp(report.startedAt), finishedAt: timestamp(report.finishedAt),
    status: choose(report.status, ['running', 'incomplete', 'complete', 'complete-with-measured-failures', 'complete-with-measured-non-ready']),
    commit: hex(report.commit, 40), buildId: buildId(object(report.build).buildId), dirtyWorkingTree: typeof report.workingTree === 'string' ? report.workingTree.length > 0 : null,
    httpTransport: numericFields(report.httpTransport, ['configuredDeadlineMs', 'availabilityProbeDeadlineMs']),
    countsPreset: choose(report.countsPreset, ['full', 'smoke']), corpus: { ...numericFields(corpus, ['notes', 'noteBytes', 'folders', 'records', 'attachments', 'attachmentBytes', 'revision', 'databaseBytes']), originalDigest: hex(corpus.originalDigest, 64) },
    environment: { node: version(object(report.environment).node), platform: choose(object(report.environment).platform, ['win32', 'linux', 'darwin']),
      ...numericFields(report.environment, ['logicalCpus', 'ramBytes']), browserVersion: version(object(report.browser).version), browserChannel: choose(object(report.browser).channel, ['msedge', 'chromium']),
      headless: bool(object(report.browser).headless), powerProfile: 'not-reported', storageDevice: 'not-reported', osDiskCache: 'uncontrolled' },
    cells: cellResults, attemptedActionCounts: attempted, successfulActionCounts: numericFields(report.successfulActionCounts, Object.keys(counts)),
    measurementCoverageComplete: report.measurementCoverageComplete === true, coverageMissing: coverageCodes(report.coverageMissing), traceIntegrity: integrity,
    metricCoverage: { ...Object.fromEntries(['uiEventLatency', 'browserBlocking', 'browserWorker', 'coordinatorLoop', 'dbOperations', 'projectionCpu', 'filesystemIo', 'checkpointEndToEnd', 'uiDuringCheckpoint'].map(key => [key, bool(object(summary.metricCoverage)[key])])), dbQueue: 'not-applicable-current-host-has-no-dedicated-db-queue' },
    originalDataUnchanged: bool(report.originalDataUnchanged), maximumClockUncertaintyMs: clockUncertainties.length ? Math.max(...clockUncertainties) : null,
    ui, acknowledgement, acknowledgementSamples, acknowledgementSizePolicy: { smallSourceMaxCharacters: SMALL_SOURCE_MAX_CHARACTERS,
      giantSourceMinCharacters: GIANT_SOURCE_MIN_CHARACTERS, ackLinkMaxGapMs: ACK_LINK_MAX_GAP_MS, charactersUnit: 'UTF-16-code-units',
      interpretation: 'Explicit analysis bins, not product limits. Semantic source size comes only from a uniquely paired saved draft; failed or ambiguous attempts remain unclassified.' },
    graphFixture, extremeFixture, extremeInputCoverage, browserPerformance, actions, actionEvidence, checkpointAttempts, stages, hostSamples: sanitizeHostSamples(host),
    unclassifiedDirectSamples: summarizeSamples(direct.filter(sample => !cells.includes(sample.cell) || !uiNames.includes(sample.name))),
    unclassifiedOperations: summarizeSamples(operations.filter(sample => !cells.includes(sample.cell) || !operationKinds.includes(sample.kind) || !['http', 'driver'].includes(sample.measurement))),
    actualPublicationCount: list(summary.publicationSpans).length, publicationInvocationCount: list(summary.publicationInvocationSpans).length,
    genuinePublicationOverlapSamples: number(summary.genuinePublicationOverlapSamples),
    overlapByCell: Object.fromEntries(phases.map(cell => [cell, numericFields(object(summary.overlapByCell)[cell], loads)])),
    typingOverlapByCell: Object.fromEntries(phases.map(cell => [cell, numericFields(object(summary.typingOverlapByCell)[cell], loads)])),
    correctness: correctnessResult, formalTrialEligible: reasons.length === 0, formalIneligibility: reasons };
}
export function aggregateReports(inputs: Array<{ report: unknown; correctness?: unknown; host?: HostSamples; browser?: unknown; independentWorkspace?: string }>) {
  if (![1, 3].includes(inputs.length)) throw new Error('Supply one smoke review or three formal trial reports.');
  const trials = inputs.map((input, index) => aggregateTrial(input.report, input.correctness, input.host ?? emptyHostSamples(), index, input.browser));
  const independent = inputs.every(input => typeof input.independentWorkspace === 'string' && input.independentWorkspace.length > 0)
    && new Set(inputs.map(input => input.independentWorkspace)).size === inputs.length;
  const sameCorpus = trials.every(trial => trial.corpus.originalDigest !== null && trial.corpus.originalDigest === trials[0].corpus.originalDigest);
  const sameBuild = trials.every(trial => trial.commit !== null && trial.buildId !== null && trial.commit === trials[0].commit && trial.buildId === trials[0].buildId && trial.dirtyWorkingTree === false);
  const sameProtocol = trials.every(trial => (['configuredDeadlineMs', 'availabilityProbeDeadlineMs'] as const).every(key =>
    trial.httpTransport[key] !== null && trial.httpTransport[key]! > 0 && trial.httpTransport[key] === trials[0].httpTransport[key]));
  const complete = inputs.length === 3 && independent && sameCorpus && sameBuild && sameProtocol && trials.every(trial => trial.formalTrialEligible);
  const checkpointRanges = operationKinds.filter(kind => kind.includes('checkpoint')).flatMap(kind => {
    const attempts = trials.flatMap(trial => trial.checkpointAttempts.filter(sample => sample.kind === kind)), values = attempts.filter(sample => sample.outcome === 'ok' && sample.durationMs !== null).map(sample => sample.durationMs!);
    return attempts.length ? [{ kind, attempts: attempts.length, successful: values.length, successfulIndividualMs: values,
      successfulRangeMs: { min: values.reduce<number | null>((min, value) => Math.min(min ?? value, value), null), max: values.reduce<number | null>((max, value) => Math.max(max ?? 0, value), null) } }] : [];
  });
  return { schemaVersion: 1, status: complete ? '3-trial-complete' : inputs.length === 1 ? 'single-trial-review' : '3-trial-incomplete',
    trialCount: inputs.length, independentWorkspaces: independent, matchingCorpusDigest: sameCorpus, matchingCleanBuild: sameBuild, matchingDeadlineProtocol: sameProtocol, checkpointRanges,
    interpretation: [
      'Budget failures are baseline findings; evidence completeness does not imply performance success.',
      'UI timing is handler-to-next-rAF/useful-update evidence, not physical input-to-pixel or native IME.',
      'Stress UI is split by driver attribution: extreme-note, ordinary-under-stress, or unclassified. Other cells include daily interactions under graph and publication load.',
      'Extreme Source/Live delivery is checked independently by distinct operation IDs; preparation stalls and unsuccessful input attempts are retained separately.',
      'ACK source sizes join actual host draft parsing by request ID. Semantic ACKs require a uniquely paired preceding draft within one browser flush; cell and command-body size never classify source size.',
      'Panel shell is feedback only; panel content carries the useful-state budget.',
      'ACK is dispatch-to-response, separately for durable draft and semantic commit; debounce is excluded.',
      'Unsuccessful and censored attempts remain counted; successful-only percentiles are not all-attempt completion percentiles.',
      'Stage wall times include nested/overlapping work and must not be added or called CPU.',
      'CPU is process-wide sampled deltas. Worst sampled loop p99 is not a whole-run p99.',
      'Main-thread background attribution and native interaction remain separate evidence; no blocking-task budget pass is inferred.',
      'Individual checkpoint durations across three trials are not a reliable checkpoint p95.',
      'Harness total HTTP deadlines and availability-probe deadlines are explicit protocol parameters, separate from product request timeouts.',
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
      `Harness HTTP deadline: ${trial.httpTransport.configuredDeadlineMs ?? 'N/A'} ms; availability-probe deadline: ${trial.httpTransport.availabilityProbeDeadlineMs ?? 'N/A'} ms.`, '',
      `Actual publications: ${trial.actualPublicationCount}; invocation spans: ${trial.publicationInvocationCount}; direct samples overlapping publication: ${trial.genuinePublicationOverlapSamples ?? 'N/A'}.`, '',
      '| Cell / tier | Direct metric | Attempts / successful | p50 ms | p95 ms | max ms | Budget ms / assessment |', '|---|---|---:|---:|---:|---:|---|');
    for (const row of trial.ui) lines.push(`| ${row.cell} / ${row.scope} | ${row.metric} | ${row.attempted} / ${row.successfulOnly.count} | ${fmt(row.successfulOnly.p50Ms)} | ${fmt(row.successfulOnly.p95Ms)} | ${fmt(row.successfulOnly.maxMs)} | ${fmt(row.budget.limitMs)} / ${row.budget.assessment} |`);
    lines.push('', '| ACK scope | Kind | Attempts / successful | p95 ms | max ms | Budget assessment |', '|---|---|---:|---:|---:|---|');
    for (const row of trial.acknowledgement) lines.push(`| ${row.scope} | ${row.kind} | ${row.attempted} / ${row.successfulOnly.count} | ${fmt(row.successfulOnly.p95Ms)} | ${fmt(row.successfulOnly.maxMs)} | ${row.budget.assessment} |`);
    lines.push('', `ACK source bins: small <=${SMALL_SOURCE_MAX_CHARACTERS} UTF-16 code units; giant >=${GIANT_SOURCE_MIN_CHARACTERS}; intermediate and unclassified remain separate. Small-source target: 200 ms.`, '',
      `Stored fixture proofs: graph ${trial.graphFixture.verified ? 'verified' : 'unproved'}; extreme ${trial.extremeFixture.verified ? 'verified' : 'unproved'}.`);
    lines.push('', '| Extreme mode | Attempts / delivered | Driver failed | Missing terminal after driver success | Direct p95 ms | Delivery proved |', '|---|---:|---:|---:|---:|---|');
    for (const mode of ['source', 'live'] as const) { const evidence = trial.extremeInputCoverage[mode]; lines.push(`| ${mode} | ${evidence.attempted} / ${evidence.deliveredAttempts} | ${evidence.driverFailed} | ${evidence.missingDirectSuccessfulAttempts} | ${fmt(evidence.directTiming.successfulOnly.p95Ms)} | ${evidence.formalDeliveryVerified} |`); }
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
    lines.push('', ...renderBrowserPerformanceMarkdown(trial.browserPerformance), '');
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
    let browser: unknown;
    try { browser = await readJson(scratchPath(resolve(dirname(input.report), 'browser.json'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const wanted = list(object(report.summary).directBrowserApiSamples).map(object).filter(sample => sample.name === 'api.request'
      && ['draft-save', 'semantic-commit'].includes(sample.acknowledgement)).map(sample => sample.requestId).filter(requestId);
    const host = await readHostSamples(scratchPath(resolve(dirname(input.report), 'host.jsonl')), wanted);
    const independentWorkspace = typeof report.workspace === 'string' && isAbsolute(report.workspace) ? scratchPath(report.workspace) : undefined;
    data.push({ report, correctness, host, browser, independentWorkspace });
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
