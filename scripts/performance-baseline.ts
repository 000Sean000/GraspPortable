/** Opt-in P0 measurement only. Never opens Acceptance, edits existing notes, or changes execution topology. */
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as nodeHttpRequest, type IncomingHttpHeaders } from 'node:http';
import { cpus, platform, arch, release, totalmem } from 'node:os';
import { createReadStream, existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from '@playwright/test';
import type { Note, WorkspaceSnapshot } from '../src/domain/model';
import { assertOutsideRepository, isWithin, repositoryRoot, resolvePhysicalPath } from './evidence-path';

export interface TraceEvent {
  version: number; lane: string; name: string; phase: string; id: string; at: number;
  durationMs?: number; outcome?: string; requestId?: string; jobId?: string; parentId?: string;
  metrics?: Record<string, number | boolean | string>;
}
export interface Operation {
  id: string; cell: string; kind: string; measurement: 'driver' | 'http'; start: number; end: number;
  durationMs: number; outcome: 'ok' | 'error' | 'timeout' | 'cancelled' | 'not-ready';
  httpStatus?: number; applicationState?: string; requestId?: string; errorType?: string;
  errorStage?: 'transport' | 'decode' | 'application'; transportErrorCode?: string;
}
export interface TraceSpan { lane: string; name: string; id: string; start: number; end: number; outcome?: string; jobId?: string }
export interface ClockSample { offsetMs: number; uncertaintyMs: number; sampledAt: number }
export const phases = ['cold', 'idle', 'warm', 'noop', 'validation', 'graph', 'stress'] as const;
type Phase = typeof phases[number];
type Counts = { typing: number; search: number; navigation: number; mode: number; selection: number; panel: number; save: number };
export const countPresets: Record<'full' | 'smoke', Counts> = {
  full: { typing: 100, search: 30, navigation: 30, mode: 30, selection: 30, panel: 10, save: 10 },
  smoke: { typing: 4, search: 2, navigation: 2, mode: 2, selection: 2, panel: 2, save: 2 },
};

export function quantile(samples: number[], percentile: number): number | null {
  if (!(percentile > 0 && percentile <= 1) || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid quantile input.');
  if (!samples.length) return null;
  return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * percentile) - 1];
}
export function summarizeOperations(samples: Operation[]) {
  const completed = samples.filter(sample => sample.outcome === 'ok').map(sample => sample.durationMs);
  const censored = samples.filter(sample => sample.outcome === 'timeout' || sample.outcome === 'cancelled');
  return { attempted: samples.length, successful: completed.length, errors: samples.filter(sample => sample.outcome === 'error').length,
    timeouts: samples.filter(sample => sample.outcome === 'timeout').length, cancelled: samples.filter(sample => sample.outcome === 'cancelled').length, notReady: samples.filter(sample => sample.outcome === 'not-ready').length,
    successfulOnly: { p50Ms: quantile(completed, .5), p95Ms: quantile(completed, .95), maxMs: completed.length ? Math.max(...completed) : null },
    allObserved: { elapsedMs: samples.map(sample => sample.durationMs), outcomes: samples.map(sample => sample.outcome),
      censoredLowerBoundsMs: censored.map(sample => sample.durationMs), completionP95Ms: samples.some(sample => sample.outcome !== 'ok') ? null : quantile(completed, .95) },
    interpretation: 'Successful-only statistics exclude non-ready responses and failures explicitly; timeouts/cancellations are censored. A pending checkpoint response is not proof its publication failed.' };
}
export function applicationFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  return Boolean(object.error) || object.state === 'error' || object.state === 'dirty'
    || (object.status !== undefined && applicationFailure(object.status))
    || (object.mirror !== undefined && applicationFailure(object.mirror));
}
export function responseFailed(httpStatus: number, value: unknown, requireReady = false): boolean {
  return httpStatus < 200 || httpStatus >= 300 || applicationFailure(value) || (requireReady && statusOf(value) !== 'ready');
}
/** Preparation only: retain each request's evidence and retry exclusively a pending checkpoint. */
export async function verifyReadyCheckpoint(action: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await action(); return; }
    catch (error) {
      if (!(error instanceof Error) || error.name !== 'CheckpointNotReady' || attempt === 3) throw error;
    }
  }
}
/** A total harness deadline, without fetch's separate pre-header transport timeout. */
export async function measuredHttpJson(url: string, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number,
  onHeaders?: (status: number, headers: IncomingHttpHeaders) => void): Promise<{ status: number; headers: IncomingHttpHeaders; value: any }> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = nodeHttpRequest(url, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(body)) }) } }, response => {
      const chunks: Buffer[] = []; const status = response.statusCode ?? 0;
      onHeaders?.(status, response.headers);
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => {
        clearTimeout(timer);
        try { resolve({ status, headers: response.headers, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', error => { clearTimeout(timer); reject(error); });
    timer = setTimeout(() => { const error = new Error(`Harness HTTP deadline ${timeoutMs} ms exceeded.`); error.name = 'TimeoutError'; request.destroy(error); }, timeoutMs);
    request.end(body);
  });
}
export function syntheticGraph(prefix: string, bindings: number, references: number, bytes?: number): string {
  if (!/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(prefix) || !Number.isSafeInteger(bindings) || bindings < 2 || !Number.isSafeInteger(references) || references < 0) throw new Error('Invalid synthetic graph dimensions.');
  const referenceText = Array.from({ length: references }, (_, i) => i % 2 ? `[[@${prefix}V${i % (bindings - 1)}|old]]` : `[old](:ref:${prefix}V${i % (bindings - 1)})`);
  let source = `# Synthetic P0 graph\n\n@${prefix}R = <|A|>\n` + Array.from({ length: bindings - 1 }, (_, i) => `@${prefix}V${i} = ${prefix}R + <|:${i}|>`).join('\n') + '\n\n'
    + Array.from({ length: Math.ceil(references / 10) }, (_, i) => referenceText.slice(i * 10, i * 10 + 10).join(' ')).join('\n\n') + '\n\nTyping area: ';
  if (bytes !== undefined) {
    if (!Number.isSafeInteger(bytes) || Buffer.byteLength(source) > bytes) throw new Error('Requested synthetic byte target is smaller than the graph.');
    const padding = bytes - Buffer.byteLength(source); source += ('\n' + 'x'.repeat(79)).repeat(Math.ceil(padding / 80)).slice(0, padding);
  }
  return source;
}
export function completeSpans(events: TraceEvent[]): TraceSpan[] {
  const starts = new Map<string, TraceEvent>(), result: TraceSpan[] = [];
  for (const event of events) {
    const key = `${event.lane}:${event.id}`;
    if (event.phase === 'start') starts.set(key, event);
    else if (event.phase === 'end') {
      const start = starts.get(key);
      if (start && start.name === event.name && event.at >= start.at) {
        result.push({ lane: event.lane, name: event.name, id: event.id, start: start.at, end: event.at, outcome: event.outcome, jobId: event.jobId ?? start.jobId });
        starts.delete(key);
      }
    }
  }
  return result;
}
/** A guaranteed intersection for every clock offset inside the calibration uncertainty. */
export function overlaps(sample: { start: number; end: number }, span: { start: number; end: number }, offsetMs = 0, uncertaintyMs = 0): boolean {
  return sample.start + offsetMs + uncertaintyMs < span.end && sample.end + offsetMs - uncertaintyMs > span.start;
}
function indexIntervals(spans: TraceSpan[]) {
  const ordered = [...spans].sort((a, b) => a.start - b.start), maxEnds: number[] = [];
  for (let i = 0; i < ordered.length; i++) maxEnds.push(Math.max(ordered[i].end, maxEnds[i - 1] ?? -Infinity));
  return (sample: { start: number; end: number }, offset = 0, uncertainty = 0) => {
    let low = 0, high = ordered.length;
    while (low < high) { const mid = (low + high) >>> 1; if (ordered[mid].start < sample.end + offset - uncertainty) low = mid + 1; else high = mid; }
    const ids: string[] = []; let count = 0;
    for (let i = low - 1; i >= 0 && maxEnds[i] > sample.start + offset + uncertainty; i--) {
      if (overlaps(sample, ordered[i], offset, uncertainty)) { count++; if (ids.length < 16) ids.push(ordered[i].id); }
    }
    return { count, ids };
  };
}
type StageSummary = Record<string, unknown>;
interface CompactTrace { spans: TraceSpan[]; byStage: StageSummary }
interface BrowserTables { routes?: string[]; methods?: string[] }
const actionMetric = (kind: string): string | undefined => kind.endsWith('-prepare') ? undefined : kind.includes('typing-') ? 'ui.input.raf' : ({ search: 'ui.search.raf', navigation: 'ui.note.intent', mode: 'ui.mode.intent', 'extreme-mode': 'ui.mode.intent', selection: 'ui.selection.raf', 'panel-shell': 'ui.panel.shell.intent' } as Record<string, string>)[kind];
/** Match the initiating action, not a later operation overlapped by a slow first-useful span. */
export function relatedDriverOperation(name: string, interval: { start: number; end: number }, operations: Operation[], browserToRunnerOffsetMs = 0, uncertaintyMs = 0): Operation | undefined {
  const compatible = (kind: string) => actionMetric(kind) === name
    || (name === 'ui.panel.content.intent' && kind === 'panel-shell')
    || (name === 'ui.search.raf' && kind === 'navigation')
    || (['ui.beforeinput.raf', 'ui.keydown.raf'].includes(name) && (kind.includes('typing-') || kind === 'selection'))
    || (name === 'ui.input.raf' && kind === 'save');
  const start = interval.start + browserToRunnerOffsetMs;
  return operations.filter(operation => operation.measurement === 'driver' && !operation.kind.endsWith('-prepare') && compatible(operation.kind)
    && start + uncertaintyMs >= operation.start && start - uncertaintyMs <= operation.end)
    .sort((a, b) => Math.abs(start - a.start) - Math.abs(start - b.start))[0];
}
export function browserScopeBoundary(events: TraceEvent[], session: number, boundaryAtBrowserMs: number, uncertaintyMs = 0) {
  const pending = new Map<string, TraceEvent>();
  for (const event of events) if (event.id.startsWith(`s${session}:`)) {
    if (event.phase === 'start') pending.set(`${event.lane}:${event.id}`, event);
    else if (event.phase === 'end') pending.delete(`${event.lane}:${event.id}`);
  }
  return [...pending.values()].map(event => ({ id: event.id, name: event.name, lane: event.lane, start: event.at,
    outcome: 'censored-at-scope-boundary', observedLowerBoundMs: Math.max(0, boundaryAtBrowserMs - event.at - uncertaintyMs) }));
}
export function summarizeTrace(host: TraceEvent[], browser: TraceEvent[], operations: Operation[], clock: ClockSample | null, hostToRunnerOffsetMs = 0, compact?: CompactTrace, tables: BrowserTables = {}) {
  const spans = compact?.spans ?? completeSpans(host), publicationInvocations = spans.filter(span => span.name === 'projection.publish');
  const generations = spans.filter(span => span.name === 'projection.generation');
  const publications = publicationInvocations.filter(span => generations.some(generation => (span.jobId && generation.jobId === span.jobId) || (generation.start >= span.start && generation.end <= span.end)));
  const worker = completeSpans(browser).filter(span => ['worker.parse', 'worker.graph'].includes(span.name));
  const loads = {
    publication: publications,
    generation: generations,
    db: spans.filter(span => span.lane === 'db'),
    validation: spans.filter(span => span.name === 'fs.validate' || span.name === 'fs.dirty'),
    hashing: spans.filter(span => span.name === 'projection.hash'),
  };
  const loadIndices = Object.fromEntries(Object.entries(loads).map(([name, values]) => [name, indexIntervals(values)]));
  const workerIndex = indexIntervals(worker);
  const ui = browser.filter(event => event.phase === 'end' && /^ui\.(?:(?:input|beforeinput|keydown|search|selection|click)\.raf|(?:note|mode|panel\.shell|panel\.content)\.intent)$/.test(event.name) && typeof event.durationMs === 'number');
  const direct = ui.map(event => {
    const interval = { start: event.at - event.durationMs!, end: event.at };
    const relatedOperation = relatedDriverOperation(event.name, interval, operations, (clock?.offsetMs ?? 0) - hostToRunnerOffsetMs, clock?.uncertaintyMs ?? 0);
    const matches = Object.fromEntries(Object.entries(loadIndices).map(([name, query]) => [name, clock ? query(interval, clock.offsetMs, clock.uncertaintyMs) : { count: 0, ids: [] as string[] }]));
    matches.graph = workerIndex(interval);
    const loadOverlap = Object.fromEntries(Object.entries(matches).map(([name, match]) => [name, match.ids]));
    return { id: event.id, name: event.name, at: event.at, durationMs: event.durationMs!, outcome: event.outcome ?? 'unknown', cell: relatedOperation?.cell ?? 'unattributed', operationId: relatedOperation?.id, operationKind: relatedOperation?.kind, loadOverlap,
      loadOverlapCounts: Object.fromEntries(Object.entries(matches).map(([name, match]) => [name, match.count])), overlapExampleIdsLimit: 16, publicationOverlap: loadOverlap.publication };
  });
  const overlapByCell = Object.fromEntries([...new Set(operations.map(operation => operation.cell))].map(cell => [cell,
    Object.fromEntries([...Object.keys(loads), 'graph'].map(load => [load, direct.filter(sample => sample.cell === cell && sample.loadOverlap[load]?.length).length]))]));
  const typingOverlapByCell = Object.fromEntries([...new Set(operations.map(operation => operation.cell))].map(cell => [cell,
    Object.fromEntries([...Object.keys(loads), 'graph'].map(load => [load, direct.filter(sample => sample.cell === cell && sample.name === 'ui.input.raf' && sample.operationKind?.includes('typing-') && sample.loadOverlap[load]?.length).length]))]));
  const driverActionEvidence = operations.filter(operation => operation.measurement === 'driver' && actionMetric(operation.kind)).map(operation => {
    const expectedMetric = actionMetric(operation.kind)!;
    const samples = direct.filter(sample => sample.operationId === operation.id && sample.name === expectedMetric);
    const starts = browser.filter(event => event.phase === 'start' && event.name === expectedMetric && relatedDriverOperation(event.name, { start: event.at, end: event.at }, [operation], (clock?.offsetMs ?? 0) - hostToRunnerOffsetMs, clock?.uncertaintyMs ?? 0));
    return { operationId: operation.id, cell: operation.cell, kind: operation.kind, driverOutcome: operation.outcome, expectedMetric,
      directTerminalSamples: samples.length, directOutcomes: samples.map(sample => sample.outcome),
      evidence: samples.length ? 'terminal-observed' : starts.length ? 'censored-no-terminal-observed' : operation.outcome === 'ok' ? 'missing-direct-observation' : 'driver-failure-before-observation' };
  });
  const browserApi = browser.filter(event => event.phase === 'end' && ['api.request', 'api.request_json', 'api.fetch', 'api.response_json'].includes(event.name)).map(event => {
    const route = tables.routes?.[Number(event.metrics?.routeCode)] ?? 'unavailable', method = tables.methods?.[Number(event.metrics?.methodCode)] ?? 'unavailable';
    const start = event.at - (event.durationMs ?? 0) + (clock?.offsetMs ?? 0) - hostToRunnerOffsetMs;
    const operation = operations.filter(item => item.start <= start && item.end >= start).sort((a, b) => b.start - a.start)[0];
    return { name: event.name, at: event.at, durationMs: event.durationMs, outcome: event.outcome, requestId: event.requestId, metrics: event.metrics, route, method,
      cell: operation?.cell ?? 'unattributed', scope: operation?.cell === 'stress' ? 'extreme-stress' : 'ordinary',
      acknowledgement: route === '/drafts/:id' && method === 'PUT' ? 'draft-save' : route === '/shared/commands' && method === 'POST' ? 'semantic-commit' : undefined };
  });
  const acknowledgementSummary = Object.fromEntries([...new Set(browserApi.filter(sample => sample.name === 'api.request' && sample.acknowledgement).map(sample => `${sample.scope}/${sample.acknowledgement}`))].map(key => {
    const samples = browserApi.filter(sample => sample.name === 'api.request' && `${sample.scope}/${sample.acknowledgement}` === key), values = samples.filter(sample => sample.outcome === 'ok' && sample.durationMs !== undefined).map(sample => sample.durationMs!);
    return [key, { attempted: samples.length, successful: values.length, nonSuccessful: samples.length - values.length,
      successfulOnly: { p50Ms: quantile(values, .5), p95Ms: quantile(values, .95), maxMs: values.length ? Math.max(...values) : null } }];
  }));
  const byDirectBrowserMetric = Object.fromEntries([...new Set(direct.map(sample => `${sample.cell}/${sample.name}`))].map(key => {
    const samples = direct.filter(sample => `${sample.cell}/${sample.name}` === key), values = samples.filter(sample => sample.outcome === 'ok').map(sample => sample.durationMs);
    return [key, { count: samples.length, successful: values.length, failedOrUnknown: samples.filter(sample => sample.outcome !== 'ok').length,
      successfulOnlyP50Ms: quantile(values, .5), successfulOnlyP95Ms: quantile(values, .95), successfulOnlyMaxMs: values.length ? Math.max(...values) : null,
      interpretation: 'Direct browser timing to next-rAF proxy. No Playwright driver time or failed/unknown outcome is treated as a successful UI latency.' }];
  }));
  const byKind = Object.fromEntries([...new Set(operations.map(sample => `${sample.cell}/${sample.measurement}/${sample.kind}`))].map(key => [key, summarizeOperations(operations.filter(sample => `${sample.cell}/${sample.measurement}/${sample.kind}` === key))]));
  const byStage = compact?.byStage ?? Object.fromEntries([...new Set(spans.map(span => `${span.lane}/${span.name}`))].map(key => {
    const selected = spans.filter(span => `${span.lane}/${span.name}` === key), values = selected.map(span => span.end - span.start), successful = selected.filter(span => span.outcome === 'ok').map(span => span.end - span.start);
    return [key, { count: values.length, outcomes: Object.fromEntries([...new Set(selected.map(span => span.outcome ?? 'unknown'))].map(outcome => [outcome, selected.filter(span => (span.outcome ?? 'unknown') === outcome).length])),
      allObserved: { totalElapsedMs: values.reduce((a, b) => a + b, 0), maxMs: values.reduce((max, value) => Math.max(max, value), 0) },
      successfulOnly: { p50Ms: quantile(successful, .5), p95Ms: quantile(successful, .95), maxMs: successful.reduce((max, value) => Math.max(max, value), 0) }, nestedDurationsNotAdditive: true }];
  }));
  return { byKind, byStage, byDirectBrowserMetric, publicationInvocationSpans: publicationInvocations, publicationSpans: publications, directBrowserSamples: direct, overlapByCell, typingOverlapByCell, driverActionEvidence,
    directBrowserApiSamples: browserApi, acknowledgementSummary,
    browserAcknowledgementInstants: browser.filter(event => event.phase === 'instant' && ['app.draft.ack', 'app.commit.ack'].includes(event.name)),
    genuinePublicationOverlapSamples: direct.filter(sample => sample.publicationOverlap.length).length,
    directTimingInterpretation: 'Handler-to-next-rAF proxy, separate from driver duration and physical input-to-paint. Missing overlap remains uncovered.',
    metricCoverage: {
      uiEventLatency: ui.length > 0, browserBlocking: browser.some(event => event.name.startsWith('browser.')),
      browserWorker: worker.length > 0,
      coordinatorLoop: host.some(event => event.name === 'coordinator.event-loop'),
      dbOperations: spans.some(span => span.lane === 'db'), dbQueue: 'N/A: current implementation has no dedicated DB queue; coordinator waiting and synchronous DB spans are measured separately.',
      projectionCpu: spans.some(span => ['projection.catalog', 'projection.render', 'projection.hash'].includes(span.name)),
      filesystemIo: spans.some(span => span.lane === 'filesystem'), checkpointEndToEnd: spans.some(span => span.name === 'projection.checkpoint'),
      uiDuringCheckpoint: direct.some(sample => sample.publicationOverlap.length > 0),
    } };
}

export function assertScratchWorkspace(input: string, scratchRoot = resolve(repositoryRoot, '..', 'Scratch')): string {
  if (!isAbsolute(input)) throw new Error('--workspace must be an explicit absolute Scratch DB path.');
  const database = realpathSync.native(input), scratch = realpathSync.native(scratchRoot);
  assertOutsideRepository(database);
  if (database.split(/[\\/]/).some(part => part.toLowerCase() === 'acceptance')) throw new Error('Acceptance is never a performance test target, even through an override.');
  if (!isWithin(scratch, database) || database === scratch || !/\.db$/i.test(database)) throw new Error('The workspace DB must be inside the approved Scratch root. Acceptance is never writable.');
  return database;
}
function epoch() { return performance.timeOrigin + performance.now(); }
function delay(ms: number) { return new Promise<void>(resolve => setTimeout(resolve, ms)); }
function digestOriginal(snapshot: WorkspaceSnapshot, ids: Set<string>): string {
  const notes = snapshot.notes.filter(note => ids.has(note.id)).sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify({ notes, folders: snapshot.folders, records: snapshot.records, attachments: snapshot.attachments })).digest('hex');
}
function git(command: string[]): string | null { try { return execFileSync('git', command, { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim(); } catch { return null; } }
function errorOutcome(error: unknown): Operation['outcome'] {
  const name = error instanceof Error ? error.name : '';
  return name === 'CheckpointNotReady' ? 'not-ready' : /timeout/i.test(name) ? 'timeout' : /abort/i.test(name) ? 'cancelled' : 'error';
}
function statusOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  return typeof obj.state === 'string' ? obj.state : statusOf(obj.status ?? obj.mirror);
}
async function readTrace(path: string): Promise<{ events: TraceEvent[]; malformed: number; totalEvents: number; openSpans: number } & CompactTrace> {
  if (!existsSync(path)) return { events: [], malformed: 0, totalEvents: 0, openSpans: 0, spans: [], byStage: {} };
  const events: TraceEvent[] = [], spans: TraceSpan[] = [], pending = new Map<string, TraceEvent>(); let malformed = 0, totalEvents = 0;
  const stages = new Map<string, { outcomes: Record<string, number>; successful: number[]; total: number; count: number; max: number }>();
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event: TraceEvent = JSON.parse(line); if (event.version !== 1 || !Number.isFinite(event.at) || typeof event.name !== 'string') { malformed++; continue; }
      totalEvents++;
      if (event.phase === 'start') pending.set(`${event.lane}:${event.id}`, event);
      else if (event.phase === 'end') {
        const key = `${event.lane}:${event.id}`, start = pending.get(key);
        if (start && start.name === event.name && event.at >= start.at) {
          pending.delete(key); const duration = event.at - start.at, stageKey = `${event.lane}/${event.name}`;
          const stage = stages.get(stageKey) ?? { outcomes: {}, successful: [], total: 0, count: 0, max: 0 };
          const outcome = event.outcome ?? 'unknown'; stage.outcomes[outcome] = (stage.outcomes[outcome] ?? 0) + 1; stage.count++; stage.total += duration; stage.max = Math.max(stage.max, duration);
          if (outcome === 'ok') stage.successful.push(duration); stages.set(stageKey, stage);
          if (event.lane === 'db' || ['projection.publish', 'projection.generation', 'projection.hash', 'projection.checkpoint', 'projection.catalog', 'projection.render', 'fs.validate', 'fs.dirty'].includes(event.name)) {
            spans.push({ lane: event.lane, name: event.name, id: event.id, start: start.at, end: event.at, outcome: event.outcome, jobId: event.jobId ?? start.jobId });
          }
        } else malformed++;
      } else if (event.name.startsWith('trace.') || event.name === 'coordinator.event-loop' || ['projection.stage', 'projection.status'].includes(event.name)) events.push(event);
    }
    catch { malformed++; }
  }
  const byStage = Object.fromEntries([...stages].map(([key, stage]) => [key, { count: stage.count, outcomes: stage.outcomes,
    allObserved: { totalElapsedMs: stage.total, maxMs: stage.max }, successfulOnly: { p50Ms: quantile(stage.successful, .5), p95Ms: quantile(stage.successful, .95), maxMs: stage.successful.reduce((max, value) => Math.max(max, value), 0) }, nestedDurationsNotAdditive: true }]));
  return { events, malformed, totalEvents, openSpans: pending.size, spans, byStage };
}
interface Options { workspace: string; outputRoot?: string; phases: Phase[]; counts: 'full' | 'smoke'; trial: string; timeoutMs: number }
function parseArgs(args: string[]): Options {
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--workspace', '--output-root', '--phases', '--counts', '--trial', '--timeout-ms'].includes(args[i]) || !args[i + 1]) throw new Error(`Invalid argument ${args[i] ?? ''}.`);
    options[args[i].slice(2)] = args[i + 1];
  }
  const selected = (options.phases ?? phases.join(',')).split(',');
  if (selected.some(phase => !phases.includes(phase as Phase)) || new Set(selected).size !== selected.length) throw new Error('Invalid or duplicate --phases.');
  const counts = options.counts ?? 'full', timeoutMs = Number(options['timeout-ms'] ?? 600000);
  if (!['full', 'smoke'].includes(counts) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw new Error('Invalid counts or timeout.');
  if (!options.workspace) throw new Error('Usage: node --import tsx scripts/performance-baseline.ts --workspace <absolute Scratch DB> [--counts full|smoke] [--phases idle,cold,warm,noop,validation,graph,stress] [--output-root <absolute Scratch directory>] [--trial label]');
  const trial = options.trial ?? 'trial'; if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trial)) throw new Error('Invalid --trial label.');
  return { workspace: assertScratchWorkspace(options.workspace), outputRoot: options['output-root'], phases: selected as Phase[], counts: counts as 'full' | 'smoke', trial, timeoutMs };
}

export async function runBaseline(options: Options): Promise<string> {
  const root = options.outputRoot ?? process.env.GRASP_EVIDENCE_ROOT ?? resolve(repositoryRoot, '..', 'Scratch', 'PerformanceEvidence');
  if (!isAbsolute(root)) throw new Error('The output root must be absolute.');
  const outputRoot = assertOutsideRepository(root);
  const approvedScratch = realpathSync.native(resolve(repositoryRoot, '..', 'Scratch'));
  if (!isWithin(approvedScratch, resolvePhysicalPath(outputRoot)) || outputRoot.split(/[\\/]/).some(part => part.toLowerCase() === 'acceptance')) throw new Error('Performance output must remain inside Scratch, never Acceptance.');
  await mkdir(outputRoot, { recursive: true });
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${options.trial}-${randomUUID().slice(0, 8)}`;
  const directory = resolve(outputRoot, runId); await mkdir(directory);
  const tracePath = resolve(directory, 'host.jsonl'), operations: Operation[] = [], browserEvents: TraceEvent[] = [];
  const cells: Array<{ name: string; start: number; end?: number; outcome: string; errorType?: string }> = [];
  const logs: string[] = [], clocks: Record<string, unknown> = {}, synthetic = new Map<string, string>();
  let child: ChildProcess | undefined, browser: Browser | undefined, page: Page | undefined;
  let cell = 'setup', workspaceId = '', browserDropped = 0, browserSessionDropped = 0, sequence = 0;
  let browserDroppedIntents = 0, browserSessionDroppedIntents = 0, browserActiveIntents = 0, browserSession = 0;
  const browserTransitions: Array<{ session: number; reason: string; activeIntents: number; boundaryAtRunnerMs: number; unclosedSpans: ReturnType<typeof browserScopeBoundary> }> = [];
  let originalIds = new Set<string>(), originalDigest = '', lastHostClock: Record<string, unknown> | null = null;
  let hostOffset: ClockSample | null = null, browserOffset: ClockSample | null = null;
  let combinedClock: ClockSample | null = null, hostExitObserved = false;
  let availabilityTimer: ReturnType<typeof setInterval> | undefined, availabilityPending: Promise<unknown> | undefined;
  let browserTables: BrowserTables = {};
  const build = JSON.parse(await readFile(resolve(repositoryRoot, 'dist/build-info.json'), 'utf8'));
  const report: Record<string, unknown> = {
    schemaVersion: 1, runId, runnerPid: process.pid, trial: options.trial, startedAt: new Date().toISOString(), status: 'running',
    workspace: options.workspace, evidenceDirectory: directory, build, commit: git(['rev-parse', 'HEAD']),
    workingTree: git(['status', '--porcelain']), configuredCounts: countPresets[options.counts], countsPreset: options.counts, phases: options.phases,
    environment: { node: process.version, platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpus: cpus().length, ramBytes: totalmem(), powerProfile: 'unavailable', storageDevice: 'Unknown', osDiskCache: 'uncontrolled' },
    fixture: { fullWorkspaceCopySuppliedByCaller: true, projectionTreePresentAtStart: existsSync(resolve(dirname(dirname(options.workspace)), 'Markdown')), applicationColdMeaning: 'Fresh owned host startup is traced. Cold cell is first deliberate full publication after fixture provisioning; existing generations are retained. Neither is a disk-cold claim.' },
    timing: { driver: 'Automation-inclusive elapsed, not direct browser UX latency.', browser: 'Handler-to-next-rAF proxy plus event/long-task diagnostics. Physical keyboard/IME-to-pixel latency is not measured.' },
    httpTransport: { measuredRequests: 'node:http with an explicit total request/body deadline', configuredDeadlineMs: options.timeoutMs, availabilityProbeDeadlineMs: 1500, startupProbe: 'fetch' },
    cells, operations, clocks,
  };
  const save = async () => { await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); };
  const recordError = (label: string, error: unknown) => logs.push(`${new Date().toISOString()} ${label}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`.slice(0, 12000));
  async function measure<T>(kind: string, action: () => Promise<T>, measurement: Operation['measurement'] = 'driver'): Promise<T | undefined> {
    const start = epoch(), started = performance.now();
    const sample: Operation = { id: `o${++sequence}`, cell, kind, measurement, start, end: start, durationMs: 0, outcome: 'ok' };
    operations.push(sample);
    try { return await action(); }
    catch (error) { sample.outcome = errorOutcome(error); sample.errorType = error instanceof Error ? error.name : 'Unknown'; recordError(kind, error); return undefined; }
    finally { sample.end = epoch(); sample.durationMs = performance.now() - started; }
  }
  const reserve = createServer();
  await new Promise<void>((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const address = reserve.address(); if (!address || typeof address === 'string') throw new Error('No available loopback port.');
  const port = address.port; await new Promise<void>((resolve, reject) => reserve.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`; report.origin = origin;
  async function request<T = any>(name: string, path: string, method = 'GET', body?: unknown, timeoutMs = options.timeoutMs): Promise<T> {
    const start = epoch(), started = performance.now();
    const sample: Operation = { id: `o${++sequence}`, cell, kind: name, measurement: 'http', start, end: start, durationMs: 0, outcome: 'ok' };
    operations.push(sample);
    try {
      const response = await measuredHttpJson(origin + path, method, { 'Content-Type': 'application/json', ...(workspaceId ? { 'X-Grasp-Workspace': workspaceId } : {}) }, body === undefined ? undefined : JSON.stringify(body), timeoutMs, (status, headers) => {
        sample.httpStatus = status; sample.requestId = typeof headers['x-grasp-perf-request'] === 'string' ? headers['x-grasp-perf-request'] : undefined;
      });
      const value = response.value; sample.applicationState = statusOf(value);
      if (responseFailed(response.status, value, path === '/api/projection/checkpoint')) {
        sample.errorStage = 'application';
        const error = new Error(`HTTP ${response.status}; application state ${sample.applicationState ?? 'unknown'} is not verified current-ready success.`);
        if (response.status >= 200 && response.status < 300 && path === '/api/projection/checkpoint' && sample.applicationState === 'pending') error.name = 'CheckpointNotReady';
        sample.outcome = errorOutcome(error); throw error;
      }
      return value as T;
    } catch (error) { sample.outcome = errorOutcome(error); sample.errorType = error instanceof Error ? error.name : 'Unknown';
      sample.errorStage ??= error instanceof SyntaxError ? 'decode' : 'transport';
      const code = (error as { code?: unknown; cause?: { code?: unknown } })?.code ?? (error as { cause?: { code?: unknown } })?.cause?.code;
      if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) sample.transportErrorCode = code;
      throw error; }
    finally { sample.end = epoch(); sample.durationMs = performance.now() - started; }
  }
  async function writeBrowserEvidence() {
    await writeFile(resolve(directory, 'browser.json'), JSON.stringify({ version: 1, events: browserEvents, dropped: browserDropped, droppedIntents: browserDroppedIntents, activeIntents: browserActiveIntents, transitions: browserTransitions, ...browserTables }));
  }
  function endBrowserScope(reason: string) {
    const boundaryAtRunnerMs = epoch(), offset = (browserOffset as ClockSample | null)?.offsetMs ?? 0, uncertainty = (browserOffset as ClockSample | null)?.uncertaintyMs ?? 0;
    browserTransitions.push({ session: browserSession, reason, activeIntents: browserActiveIntents, boundaryAtRunnerMs,
      unclosedSpans: browserScopeBoundary(browserEvents, browserSession, boundaryAtRunnerMs - offset, uncertainty) });
  }
  async function drainBrowser() {
    if (!page || page.isClosed()) return;
    try {
      const data = await page.evaluate(() => (window as unknown as { __GRASP_PERF__?: { drain(): { events: TraceEvent[]; dropped: number; droppedIntents?: number; activeIntents?: number; routes?: string[]; methods?: string[] } } }).__GRASP_PERF__?.drain());
      if (data) { browserEvents.push(...data.events.map(event => ({ ...event, id: `s${browserSession}:${event.id}`, ...(event.parentId ? { parentId: `s${browserSession}:${event.parentId}` } : {}), ...(event.jobId ? { jobId: `s${browserSession}:${event.jobId}` } : {}) }))); browserDropped += Math.max(0, data.dropped - browserSessionDropped); browserSessionDropped = data.dropped;
        browserDroppedIntents += Math.max(0, (data.droppedIntents ?? 0) - browserSessionDroppedIntents); browserSessionDroppedIntents = data.droppedIntents ?? 0;
        browserActiveIntents = data.activeIntents ?? 0; browserTables = { routes: data.routes, methods: data.methods }; }
      await writeBrowserEvidence();
    } catch (error) { recordError('browser-drain', error); }
  }
  async function calibrate() {
    const hostSamples: ClockSample[] = [], browserSamples: ClockSample[] = [];
    for (let i = 0; i < 5; i++) {
      const start = epoch();
      try { const data = await request<any>('diagnostic-clock', '/api/diagnostics/performance/clock', 'GET', undefined, 10000); const end = epoch();
        lastHostClock = data; if (data.enabled && typeof data.epochMs === 'number') hostSamples.push({ offsetMs: data.epochMs - (start + end) / 2, uncertaintyMs: (end - start) / 2, sampledAt: end }); }
      catch (error) { recordError('host-clock', error); }
      if (page) { const before = epoch(); const at = await page.evaluate(() => performance.timeOrigin + performance.now()); const after = epoch(); browserSamples.push({ offsetMs: (before + after) / 2 - at, uncertaintyMs: (after - before) / 2, sampledAt: after }); }
    }
    hostOffset = hostSamples.sort((a, b) => a.uncertaintyMs - b.uncertaintyMs)[0] ?? null;
    browserOffset = browserSamples.sort((a, b) => a.uncertaintyMs - b.uncertaintyMs)[0] ?? null;
    if (hostOffset && browserOffset) {
      const nextOffset = hostOffset.offsetMs + browserOffset.offsetMs;
      combinedClock = { offsetMs: nextOffset, uncertaintyMs: Math.max(hostOffset.uncertaintyMs + browserOffset.uncertaintyMs, combinedClock ? combinedClock.uncertaintyMs + Math.abs(nextOffset - combinedClock.offsetMs) : 0), sampledAt: epoch() };
    }
    clocks[cell] = { host: hostSamples, browser: browserSamples, combined: combinedClock };
  }
  async function guardSynthetic() {
    if (!page) throw new Error('Browser unavailable.');
    const selected = await page.locator('.note-item.active').getAttribute('data-note-id');
    if (!selected || !synthetic.has(selected)) throw new Error('Refusing to edit a note not created by this run.');
  }
  async function guardTyping() {
    await guardSynthetic();
    const writable = await page!.evaluate(() => {
      const editor = document.querySelector('#editor .cm-content'), active = document.activeElement;
      return Boolean(editor && (editor === active || editor.contains(active)) && !editor.closest('[inert]') && editor.getAttribute('contenteditable') === 'true');
    });
    if (!writable) throw new Error('Typing was not delivered: the synthetic editor is unfocused, inert, or read-only.');
  }
  async function waitBrowserHydrated() {
    const start = epoch();
    await page!.waitForFunction(() => {
      const diagnostics = (window as unknown as { __GRASP_PERF__?: { snapshot(): { events: TraceEvent[] } } }).__GRASP_PERF__;
      return diagnostics?.snapshot().events.some(event => event.name === 'app.snapshot.apply' && event.phase === 'end' && event.outcome === 'ok')
        && !(document.querySelector('#note-title') as HTMLInputElement | null)?.disabled
        && !document.querySelector('#navigation')?.hasAttribute('inert');
    }, undefined, { timeout: Math.min(options.timeoutMs, 60000) });
    const samples = (report.browserHydration as Array<{ session: number; start: number; end: number }> | undefined) ?? [];
    samples.push({ session: browserSession, start, end: epoch() }); report.browserHydration = samples;
  }
  async function reloadBrowser() {
    await page!.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await drainBrowser();
    endBrowserScope('intentional reload; open observations are censored, not silently completed'); await writeBrowserEvidence();
    browserSession++; browserSessionDropped = 0; browserSessionDroppedIntents = 0;
    await page!.reload({ waitUntil: 'domcontentloaded' });
    await waitBrowserHydrated();
  }
  async function selectNote(id: string) {
    const title = synthetic.get(id); if (!title || !page) throw new Error('Unknown synthetic target.');
    await page.getByLabel('搜尋筆記', { exact: true }).fill(title);
    await page.locator(`.note-item[data-note-id="${id}"]`).click();
    await page.waitForFunction(expected => (document.querySelector('#note-title') as HTMLInputElement | null)?.value === expected, title, { timeout: 10000 });
    await guardSynthetic();
  }
  async function settleEditor() {
    await page!.waitForFunction(() => document.querySelector('#save-status')?.textContent === '✓ 已儲存至 SQLite', undefined, { timeout: Math.min(options.timeoutMs, 30000) });
  }
  async function prepareCheckpointCell(name: 'idle' | 'noop') {
    const prepared = await measure(`${name}-precondition-save`, async () => {
      await guardSynthetic(); await page!.locator('#save').click(); await settleEditor();
      // The explicit Save is ordered behind earlier UI commands. Its visible queue must
      // also drain before a checkpoint can establish this cell's saved-state precondition.
      await page!.waitForFunction(() => (document.querySelector('#operation-status') as HTMLElement | null)?.hidden === true
        && document.querySelector('#save-status')?.textContent === '✓ 已儲存至 SQLite', undefined, { timeout: Math.min(options.timeoutMs, 30000) });
      return true;
    });
    if (prepared !== true) throw new Error(`${name} saved-state precondition was not verified; cell workload was not started.`);
  }
  async function exercise(fraction: number, burst = false, waitPanelContent = true) {
    if (!page || synthetic.size < 2) throw new Error('Synthetic fixture unavailable.');
    const ids = [...synthetic.keys()].slice(0, 2), count = (key: keyof Counts) => Math.max(1, Math.ceil(countPresets[options.counts][key] * fraction));
    await selectNote(ids[0]);
    if (await page.locator('#reading').getAttribute('aria-pressed') === 'true') await page.locator('#reading').click();
    if (await page.locator('#mode').innerText() !== 'Source') await page.locator('#mode').click();
    for (const mode of ['source', 'live'] as const) {
      if (mode === 'live') await measure('mode', () => page!.locator('#mode').click());
      await guardSynthetic(); await page.locator('#editor .cm-content').focus(); await page.keyboard.press('ControlOrMeta+End');
      for (let i = 0; i < Math.ceil(count('typing') / 2); i++) { await measure(`typing-${mode}`, async () => { await guardTyping(); await page!.keyboard.insertText('x'); }); if (!burst) await delay(40); }
    }
    await measure('save', async () => { await guardSynthetic(); await page!.locator('#save').click(); await settleEditor(); });
    for (let i = 0; i < count('search'); i++) await measure('search', async () => { await page!.getByLabel('搜尋筆記', { exact: true }).fill(synthetic.get(ids[i % 2])!); await page!.locator(`.note-item[data-note-id="${ids[i % 2]}"]`).waitFor({ state: 'visible' }); });
    for (let i = 0; i < count('navigation'); i++) await measure('navigation', () => selectNote(ids[(i + 1) % 2]));
    for (let i = 0; i < count('mode'); i++) await measure('mode', () => page!.locator('#mode').click());
    await measure('selection-prepare', async () => {
      await selectNote(ids[0]);
      await page!.waitForFunction(() => {
        const editor = document.querySelector('#editor .cm-content');
        return Boolean(editor && !editor.closest('[inert]') && editor.getAttribute('contenteditable') === 'true');
      }, undefined, { timeout: 10000 });
      await page!.locator('#editor .cm-content').focus(); await page!.keyboard.press('ControlOrMeta+End'); await guardTyping();
      await page!.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    });
    for (let i = 0; i < count('selection'); i++) await measure('selection', async () => {
      await guardTyping();
      const boundary = await page!.evaluate(() => performance.timeOrigin + performance.now());
      await page!.keyboard.press(i % 2 ? 'ArrowRight' : 'Shift+ArrowLeft');
      await page!.waitForFunction(since => {
        const diagnostics = (window as unknown as { __GRASP_PERF__?: { snapshot(): { events: TraceEvent[] } } }).__GRASP_PERF__;
        return diagnostics?.snapshot().events.some(event => event.name === 'ui.selection.raf' && event.phase === 'end'
          && typeof event.durationMs === 'number' && event.at - event.durationMs >= since);
      }, boundary, { timeout: 10000 });
    });
    const panelExercises = (report.panelExercises as Array<{ cell: string; shellAttempts: number; waitForUsefulContent: boolean }> | undefined) ?? [];
    panelExercises.push({ cell, shellAttempts: count('panel'), waitForUsefulContent: waitPanelContent }); report.panelExercises = panelExercises;
    for (let i = 0; i < count('panel'); i++) {
      const projection = i % 2 === 1;
      await measure('panel-shell', async () => { await page!.locator(i % 2 ? '#projection' : '#files').click(); await page!.locator('#modal-body').waitFor({ state: 'visible' });
        await page!.waitForFunction(() => Boolean(document.querySelector('#modal-body')?.textContent?.trim())); });
      // Idle and warm exercises measure useful content. Other loaded exercises close the
      // measured shell promptly so a blocked panel cannot consume the remaining job interval.
      if (waitPanelContent && (i === 0 || (i === 1 && fraction >= .5))) await measure('panel-content', async () => {
        await page!.waitForFunction(isProjection => {
          const body = document.querySelector('#modal-body');
          if (body?.querySelector('.validation-error, .gp-files-error')) return true;
          return Boolean(body?.querySelector(isProjection ? '.gp-projection-unit, .gp-projection-panel input' : '.gp-files-count'));
        }, projection, { timeout: Math.min(options.timeoutMs, 310000) });
        if (await page!.locator('#modal-body .validation-error, #modal-body .gp-files-error').count()) throw new Error('Panel showed an explicit load error.');
      });
      await measure('panel-close', () => page!.locator('#modal-close').click());
    }
    for (let i = 0; i < count('save'); i++) await measure('save', async () => {
      await guardSynthetic(); await page!.locator('#editor .cm-content').focus(); await page!.keyboard.press('ControlOrMeta+End'); await guardTyping(); await page!.keyboard.insertText('s');
      const response = page!.waitForResponse(item => item.url().endsWith('/api/shared/commands') && item.request().method() === 'POST', { timeout: Math.min(options.timeoutMs, 30000) });
      await page!.locator('#save').click(); const saved = await response; if (!saved.ok()) throw new Error(`Save HTTP ${saved.status()}.`); await settleEditor();
    });
    await drainBrowser();
  }
  async function updateSynthetic(id: string, markdown?: string) {
    if (!synthetic.has(id)) throw new Error('Refusing to mutate a pre-existing note.');
    const snapshot = await request<WorkspaceSnapshot>('fixture-read', '/api/workspace'); const note = snapshot.notes.find(note => note.id === id);
    if (!note || note.title !== synthetic.get(id)) throw new Error('Synthetic fixture identity changed.');
    return request<WorkspaceSnapshot>('synthetic-note-update', `/api/notes/${id}`, 'PUT', { title: note.title, markdown: markdown ?? `${note.markdown}\nP0 checkpoint ${sequence}`, revision: note.revision, folderId: note.folderId, syntaxVersion: 'grasp-v1' });
  }
  async function typeDuringLoad(samples: number) {
    // Caller focuses a run-owned note before starting the load. No navigation/settings wait hides a DB stall.
    for (let i = 0; i < samples; i++) await measure('typing-source', async () => { await guardTyping(); await page!.keyboard.insertText('l'); });
  }
  async function prepareLoadTyping() {
    await selectNote([...synthetic.keys()][0]);
    if (await page!.locator('#mode').innerText() !== 'Source') await page!.locator('#mode').click();
    await page!.locator('#editor .cm-content').focus(); await page!.keyboard.press('ControlOrMeta+End'); await guardSynthetic();
  }
  async function exerciseAlongside(background: Promise<unknown>, fraction: number, burst = false, waitPanelContent = false) {
    let terminal = false;
    const observed = background.finally(() => { terminal = true; }), deadline = performance.now() + options.timeoutMs;
    try { await exercise(fraction, burst, waitPanelContent); }
    finally {
      try {
        if (!terminal) {
          await measure('sustained-typing-prepare', prepareLoadTyping);
          let pulses = 0;
          while (!terminal && performance.now() < deadline) {
            await measure('typing-background-source', async () => { await guardTyping(); await page!.keyboard.insertText('p'); });
            if (++pulses % 20 === 0) await drainBrowser();
            if (!terminal) await delay(250);
          }
        }
      } finally { await observed; }
    }
  }
  async function extremeTyping(id: string) {
    await selectNote(id);
    if (await page!.locator('#mode').innerText() !== 'Source') await page!.locator('#mode').click();
    for (const mode of ['source', 'live'] as const) {
      if (mode === 'live') await measure('extreme-mode', () => page!.locator('#mode').click());
      await guardSynthetic(); await page!.locator('#editor .cm-content').focus(); await page!.keyboard.press('ControlOrMeta+End');
      for (let i = 0; i < (options.counts === 'full' ? mode === 'source' ? 30 : 20 : 2); i++) await measure(`extreme-typing-${mode}`, async () => { await guardTyping(); await page!.keyboard.insertText('e'); });
      await measure('extreme-save-ack', async () => {
        await guardSynthetic(); const response = page!.waitForResponse(item => item.url().endsWith('/api/shared/commands') && item.request().method() === 'POST', { timeout: Math.min(options.timeoutMs, 60000) });
        await page!.locator('#save').click(); const saved = await response; if (!saved.ok()) throw new Error(`Extreme save HTTP ${saved.status()}.`); await settleEditor();
      });
    }
  }
  async function runCell(name: Phase, action: () => Promise<void>) {
    cell = name; report.activeCell = name; report.activeCellEnteredAt = epoch(); await save();
    const entry = { name, start: epoch(), end: undefined as number | undefined, outcome: 'running', errorType: undefined as string | undefined }; cells.push(entry);
    const before = operations.length;
    try { await action(); const current = operations.slice(before); entry.outcome = current.some(operation => !['ok', 'not-ready'].includes(operation.outcome)) ? 'measured-failures' : current.some(operation => operation.outcome === 'not-ready') ? 'measured-non-ready' : 'ok'; }
    catch (error) { entry.outcome = 'incomplete'; entry.errorType = error instanceof Error ? error.name : 'Unknown'; recordError(name, error); }
    finally { entry.end = epoch(); report.activeCell = null; await drainBrowser(); await save(); console.log(JSON.stringify({ runId, cell: name, outcome: entry.outcome, elapsedMs: entry.end - entry.start })); }
  }
  await save();
  try {
    const wrapper = "await import(process.env.GRASP_PERF_HOST_URL); process.on('message', message => { if (message?.type === 'performance-shutdown') process.emit('SIGTERM'); });";
    child = spawn(process.execPath, ['--input-type=module', '--eval', wrapper], { cwd: repositoryRoot, env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: options.workspace, GRASP_PERF_TRACE: tracePath, GRASP_PERF_MAX_EVENTS: '10000000', GRASP_PERF_HOST_URL: pathToFileURL(resolve(repositoryRoot, 'dist/server.mjs')).href }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    report.hostPid = child.pid; child.on('exit', () => { hostExitObserved = true; });
    child.on('error', error => { report.hostProcessError = error.name; recordError('host-process', error); });
    child.stdout?.on('data', data => logs.push(`host stdout: ${String(data)}`)); child.stderr?.on('data', data => logs.push(`host stderr: ${String(data)}`));
    await save(); const startup = performance.now(); let ready = false;
    while (performance.now() - startup < options.timeoutMs) {
      if (child.exitCode !== null || report.hostProcessError) throw new Error('Owned host exited or failed during startup.');
      try {
        const response = await fetch(`${origin}/api/host`, { signal: AbortSignal.timeout(3000) });
        if (response.ok) {
          const host = await response.json() as { path: string; error?: string };
          if (resolvePhysicalPath(host.path) !== options.workspace || response.headers.get('X-GraspPortable-Build') !== build.buildId) throw new Error('Build/workspace identity mismatch on reserved port.');
          if (host.error) throw new Error('Host cannot open the supplied workspace.');
          ready = true; break;
        }
      } catch (error) { if (error instanceof Error && /identity mismatch|cannot open/.test(error.message)) throw error; }
      await delay(200);
    }
    report.startupReadyMs = performance.now() - startup; if (!ready) throw new Error('Owned host readiness timed out.');
    report.hostIdentityVerified = true; await save();
    const initial = await request<WorkspaceSnapshot>('initial-workspace', '/api/workspace'); workspaceId = initial.id;
    originalIds = new Set(initial.notes.map(note => note.id)); originalDigest = digestOriginal(initial, originalIds);
    report.corpus = { notes: initial.notes.length, noteBytes: initial.notes.reduce((sum, note) => sum + Buffer.byteLength(note.markdown), 0), folders: initial.folders.length, records: initial.records.length, attachments: initial.attachments.length, attachmentBytes: initial.attachments.reduce((sum, asset) => sum + asset.size, 0), revision: initial.revision, databaseBytes: (await stat(options.workspace)).size, originalDigest };
    const prefix = `P0_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    let graphPrefix = ''; do { graphPrefix = `P${randomUUID().replaceAll('-', '').slice(0, 5)}`; } while (initial.notes.some(note => note.markdown.includes(`@${graphPrefix}`)));
    let current = initial;
    for (const label of ['Typing', 'Navigation', 'Graph']) {
      const title = `${prefix} ${label}`, before = new Set(current.notes.map(note => note.id));
      current = await request<WorkspaceSnapshot>('fixture-create', '/api/notes', 'POST', { title, markdown: `# ${title}\n\nSynthetic P0 measurement area.\n`, folderId: null, syntaxVersion: 'grasp-v1' });
      const note = current.notes.find(note => !before.has(note.id)); if (!note || note.title !== title) throw new Error('Fixture creation did not return the expected new note.');
      synthetic.set(note.id, title);
    }
    report.fixture = { ...report.fixture as object, syntheticNotesCreated: synthetic.size, syntheticPrefix: prefix };
    const { chromium } = await import('@playwright/test');
    const useEdge = platform() === 'win32' && existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
    browser = await chromium.launch({ ...(useEdge ? { channel: 'msedge' } : {}), headless: true }); report.browser = { version: browser.version(), channel: useEdge ? 'msedge' : 'chromium', headless: true, viewport: { width: 1440, height: 1000 } };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => { (globalThis as unknown as { __GRASP_PERF_ENABLED__: boolean }).__GRASP_PERF_ENABLED__ = true; });
    page = await context.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(60000);
    page.on('pageerror', error => { recordError('pageerror', error); (report.pageErrorCount as number | undefined) === undefined ? report.pageErrorCount = 1 : report.pageErrorCount = Number(report.pageErrorCount) + 1; });
    const pendingNetwork = new Map<any, { start: number; kind: string; cell: string }>();
    page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) pendingNetwork.set(req, { start: epoch(), kind: `browser-${req.method()}-${new URL(req.url()).pathname.replace(/\/[0-9a-f-]{20,}/gi, '/:id')}`, cell }); });
    const networkResults: any[] = []; report.browserNetwork = networkResults;
    page.on('requestfinished', async req => { const active = pendingNetwork.get(req); if (!active) return; pendingNetwork.delete(req); const response = await req.response(); networkResults.push({ ...active, end: epoch(), outcome: response?.ok() ? 'http-ok-unverified-application-state' : 'error', httpStatus: response?.status(), requestId: response?.headers()['x-grasp-perf-request'] }); });
    page.on('requestfailed', req => { const active = pendingNetwork.get(req); if (!active) return; pendingNetwork.delete(req); networkResults.push({ ...active, end: epoch(), outcome: 'cancelled-or-failed', error: req.failure()?.errorText }); });
    await page.goto(origin, { waitUntil: 'domcontentloaded' }); await waitBrowserHydrated(); await selectNote([...synthetic.keys()][0]); await calibrate();
    report.browserDiagnosticsAvailable = await page.evaluate(() => Boolean((window as unknown as { __GRASP_PERF__?: unknown }).__GRASP_PERF__));
    report.setupComplete = true; await save();
    report.sustainedInputProtocol = { cadenceMs: 250, scope: 'After each initial exercise, while its real background request remains pending.', target: 'Run-owned light note in Source mode', actionKind: 'typing-background-source', maximumLoopDurationMs: options.timeoutMs,
      interpretation: 'Pacing is user-input cadence, not simulated job duration. Actual trace intervals alone establish load overlap; failures and blocked input attempts remain evidence.' };
    report.panelContentPolicy = { idle: 'wait for useful content after measured shell', warm: 'wait for useful content under publication load',
      cold: 'measure shell and close promptly, then sustain typing', validation: 'measure shell and close promptly, then sustain typing',
      graph: 'measure shell and close promptly; preload typing starts immediately with the DB operation', stress: 'measure shell and close promptly, then sustain typing', noop: 'no panel exercise' };
    report.preparationProtocol = { idleAndNoop: 'Recorded explicit UI Save, verified saved status and drained UI command queue, then at most three checkpoint attempts. Only CheckpointNotReady is retried, without delay; every response is retained. Any other failure or three pending responses prevents cell workload.',
      selection: 'Recorded selection-prepare waits at most 10 s for a writable non-inert editor, focuses and moves to the end, then drains preparation selection over two rAFs. Each measured selection checks delivery readiness and waits at most 10 s for its new timestamped ui.selection.raf terminal; driver time includes that wait, direct latency remains the browser event duration.',
      graphReload: 'After hydrated reload with the light note already selected in Source mode, immediately focus and type before any new note-search/navigation/settings action; trace intervals must still prove worker overlap.' };
    availabilityTimer = setInterval(() => { if (!availabilityPending) { availabilityPending = request('availability-probe', '/api/diagnostics/performance/clock', 'GET', undefined, 1500).catch(error => recordError('availability-probe', error)).finally(() => { availabilityPending = undefined; }); } }, 250);
    for (const name of options.phases) await runCell(name, async () => {
      const ids = [...synthetic.keys()];
      if (name === 'idle') { await prepareCheckpointCell('idle'); await verifyReadyCheckpoint(() => request('checkpoint-before-idle', '/api/projection/checkpoint', 'POST', {})); await exercise(.5); }
      if (name === 'cold' || name === 'warm') {
        await updateSynthetic(ids[2]);
        const publication = measure(`${name}-checkpoint`, () => request(`${name}-checkpoint`, '/api/projection/checkpoint', 'POST', {}));
        await exerciseAlongside(publication, .2, false, name === 'warm');
      }
      if (name === 'noop') { await prepareCheckpointCell('noop'); await verifyReadyCheckpoint(() => request('checkpoint-before-noop', '/api/projection/checkpoint', 'POST', {})); await measure('noop-checkpoint', () => request('noop-checkpoint', '/api/projection/checkpoint', 'POST', {})); }
      if (name === 'validation') { const validation = measure('filesystem-validation', () => request('filesystem-validation', '/api/files/status')); await exerciseAlongside(validation, .1); }
      if (name === 'graph') {
        const size = options.counts === 'full' ? 1000 : 40, references = options.counts === 'full' ? 5000 : 50;
        const source = syntheticGraph(graphPrefix, size, references);
        await prepareLoadTyping();
        const mutation = measure('large-synthetic-db-operation', () => updateSynthetic(ids[2], source));
        try { await typeDuringLoad(options.counts === 'full' ? 30 : 4); await exerciseAlongside(mutation, .1, true); } finally { await mutation; }
        const settingsState = await request<WorkspaceSnapshot>('settings-before-reload', '/api/workspace');
        await request('select-light-note-before-reload', '/api/settings', 'PUT', { settings: { ...settingsState.settings, activeNoteId: ids[0], mode: 'source' } });
        await reloadBrowser();
        await measure('graph-typing-prepare', () => page!.locator('#editor .cm-content').focus());
        await typeDuringLoad(options.counts === 'full' ? 30 : 4);
        await exercise(.1, true, false); report.graphFixture = { additionalDefinitions: size, additionalReferences: references, bytes: Buffer.byteLength(source), editsOnlyRunOwnedNote: true };
      }
      if (name === 'stress') {
        const source = syntheticGraph(graphPrefix, options.counts === 'full' ? 10000 : 60, options.counts === 'full' ? 50000 : 100, options.counts === 'full' ? 1750000 : undefined);
        await prepareLoadTyping();
        const large = measure('extreme-synthetic-db-operation', () => updateSynthetic(ids[2], source));
        try { await typeDuringLoad(options.counts === 'full' ? 30 : 4); await exerciseAlongside(large, .1, true); } finally { await large; }
        await reloadBrowser();
        await extremeTyping(ids[2]);
        report.extremeFixture = { definitions: options.counts === 'full' ? 10000 : 60, references: options.counts === 'full' ? 50000 : 100, bytes: Buffer.byteLength(source), editsOnlyRunOwnedNote: true };
        await updateSynthetic(ids[2]);
        const first = measure('stress-checkpoint-a', () => request('stress-checkpoint-a', '/api/projection/checkpoint', 'POST', {}));
        const second = measure('stress-checkpoint-b', () => request('stress-checkpoint-b', '/api/projection/checkpoint', 'POST', {}));
        await exerciseAlongside(Promise.all([first, second]), .2, true);
      }
    });
    cell = 'verification'; await calibrate();
    const final = await request<WorkspaceSnapshot>('final-workspace', '/api/workspace');
    report.originalDataUnchanged = digestOriginal(final, originalIds) === originalDigest;
    report.finalCorpus = { notes: final.notes.length, revision: final.revision, syntheticNotes: synthetic.size };
    if (!report.originalDataUnchanged) throw new Error('Original note/folder/record/attachment metadata changed; preserve this run for inspection.');
  } catch (error) { report.fatalErrorType = error instanceof Error ? error.name : 'Unknown'; recordError('fatal', error); }
  finally {
    clearInterval(availabilityTimer); await availabilityPending;
    cell = 'cleanup'; await drainBrowser();
    if (page) { endBrowserScope('owned browser close; open observations are censored at measurement-scope termination'); await writeBrowserEvidence(); }
    try { lastHostClock = await request('final-diagnostic-clock', '/api/diagnostics/performance/clock', 'GET', undefined, 10000); } catch (error) { recordError('final-clock', error); }
    await browser?.close().catch(error => recordError('browser-close', error));
    if (child && child.exitCode === null) {
      if (child.connected) child.send?.({ type: 'performance-shutdown' }, error => { if (error) recordError('host-shutdown-ipc', error); });
      const deadline = performance.now() + options.timeoutMs;
      while (!hostExitObserved && performance.now() < deadline) await delay(50);
      if (!hostExitObserved) { report.hostForceStopRequired = true; child.kill('SIGKILL'); await delay(100); }
    }
    report.hostStop = { exitObserved: hostExitObserved, exitCode: child?.exitCode, signal: child?.signalCode, semantics: 'IPC asks the owned child to emit SIGTERM internally, invoking the existing host shutdown handler. Hard termination, if required, invalidates complete evidence.' };
    const trace = await readTrace(tracePath);
    const footer = trace.events.findLast(event => event.name === 'trace.summary');
    const summary = summarizeTrace(trace.events, browserEvents, operations, combinedClock, (hostOffset as ClockSample | null)?.offsetMs ?? 0, trace, browserTables);
    report.summary = summary; report.hostClock = lastHostClock; report.browserDropped = browserDropped; report.hostMalformedLines = trace.malformed;
    report.nonReadyCheckpoints = operations.filter(sample => sample.applicationState === 'pending').map(sample => ({ operationId: sample.id, cell: sample.cell, elapsedMs: sample.durationMs, applicationState: sample.applicationState,
      publicationInvocations: summary.publicationInvocationSpans.filter(span => overlaps(sample, span, (hostOffset as ClockSample | null)?.offsetMs ?? 0)).map(span => ({ id: span.id, jobId: span.jobId, outcome: span.outcome })),
      interpretation: 'Latest requested state is pending. A completed captured revision may have published successfully; actual publication outcomes are listed separately.' }));
    report.traceIntegrity = { rawHostEvents: trace.totalEvents, compactStructuralSpans: trace.spans.length, unclosedHostSpans: trace.openSpans, hostFooter: footer?.metrics ?? null, hostDroppedEvents: footer?.metrics?.droppedEvents ?? lastHostClock?.droppedEvents ?? null, hostSinkErrors: footer?.metrics?.sinkErrors ?? lastHostClock?.sinkErrors ?? null, hostBufferedEventsAtLastClock: lastHostClock?.bufferedEvents ?? null, browserDropped, browserDroppedIntents, browserActiveIntents, malformedLines: trace.malformed,
      orderlyExitObserved: hostExitObserved && child?.exitCode === 0 && !report.hostForceStopRequired };
    const matchesKind = (operation: Operation, kind: string) => operation.measurement === 'driver' && (operation.kind === kind || (kind === 'typing' && operation.kind.startsWith('typing-')) || (kind === 'panel' && operation.kind === 'panel-shell'));
    const countCoverage = Object.fromEntries(Object.keys(countPresets[options.counts]).map(kind => [kind, operations.filter(operation => matchesKind(operation, kind) && operation.outcome === 'ok').length]));
    const attemptedCounts = Object.fromEntries(Object.keys(countPresets[options.counts]).map(kind => [kind, operations.filter(operation => matchesKind(operation, kind)).length]));
    report.successfulActionCounts = countCoverage;
    report.attemptedActionCounts = attemptedCounts;
    const coverageMissing: string[] = [];
    if (options.counts === 'full') {
      for (const [kind, count] of Object.entries(countPresets.full)) if (attemptedCounts[kind] < count) coverageMissing.push(`sample-count:${kind}`);
      for (const [metric, available] of Object.entries(summary.metricCoverage)) if (available === false) coverageMissing.push(`metric:${metric}`);
      for (const [phase, load] of [['cold', 'publication'], ['warm', 'publication'], ['validation', 'validation'], ['graph', 'db'], ['graph', 'graph'], ['stress', 'generation'], ['stress', 'hashing']] as const)
        if (options.phases.includes(phase) && !(summary.overlapByCell[phase]?.[load] > 0)) coverageMissing.push(`overlap:${phase}/${load}`);
      for (const [phase, load] of [['graph', 'db'], ['graph', 'graph']] as const)
        if (options.phases.includes(phase) && !(summary.typingOverlapByCell[phase]?.[load] > 0)) coverageMissing.push(`typing-overlap:${phase}/${load}`);
      for (const kind of ['typing', 'search', 'navigation', 'mode', 'selection', 'panel']) {
        const evidence = summary.driverActionEvidence.filter(item => item.kind === kind || (kind === 'typing' && item.kind.startsWith('typing-')) || (kind === 'panel' && item.kind === 'panel-shell'));
        if (!evidence.some(item => item.directTerminalSamples > 0)) coverageMissing.push(`direct-action:${kind}`);
        if (evidence.some(item => item.evidence === 'missing-direct-observation')) coverageMissing.push(`missing-direct-actions:${kind}`);
      }
      if (!operations.some(operation => operation.kind === 'panel-content' && operation.outcome === 'ok')) coverageMissing.push('panel-useful-content');
      if (options.phases.includes('stress') && !report.extremeFixture) coverageMissing.push('extreme-fixture');
    }
    report.coverageMissing = coverageMissing;
    report.browserSessionTransitions = browserTransitions;
    const complete = !report.fatalErrorType && report.originalDataUnchanged === true && cells.length === options.phases.length && cells.every(item => item.outcome !== 'incomplete')
      && browserDropped === 0 && browserDroppedIntents === 0 && browserActiveIntents === 0 && trace.malformed === 0 && footer?.metrics?.droppedEvents === 0 && footer?.metrics?.sinkErrors === 0
      && footer.metrics.bufferedEvents === 0 && Number(footer.metrics.writtenEvents) + 1 === trace.totalEvents && trace.openSpans === 0
      && summary.genuinePublicationOverlapSamples > 0 && Boolean(report.browserDiagnosticsAvailable) && child?.exitCode === 0 && !report.hostForceStopRequired
      && coverageMissing.length === 0;
    report.measurementCoverageComplete = complete;
    report.status = complete ? (operations.some(sample => !['ok', 'not-ready'].includes(sample.outcome)) ? 'complete-with-measured-failures' : operations.some(sample => sample.outcome === 'not-ready') ? 'complete-with-measured-non-ready' : 'complete') : 'incomplete';
    report.finishedAt = new Date().toISOString();
    await writeFile(resolve(directory, 'private-errors.log'), logs.join('\n'));
    await save(); await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({ runId, directory, status: report.status, genuinePublicationOverlapSamples: summary.genuinePublicationOverlapSamples, originalDataUnchanged: report.originalDataUnchanged ?? null }));
  }
  return directory;
}

async function main() {
  if (process.argv[2] === '--summarize') {
    const directory = process.argv[3]; if (!directory || !isAbsolute(directory) || process.argv.length !== 4) throw new Error('--summarize requires an absolute existing run directory.');
    const report = JSON.parse(await readFile(resolve(directory, 'report.json'), 'utf8'));
    const browser = JSON.parse(await readFile(resolve(directory, 'browser.json'), 'utf8'));
    const host = await readTrace(resolve(directory, 'host.jsonl'));
    const calibrations = Object.values(report.clocks) as Array<{ combined: ClockSample | null }>;
    const finalCalibration = Object.values(report.clocks).at(-1) as { host?: ClockSample[] } | undefined;
    const hostOffset = finalCalibration?.host ? [...finalCalibration.host].sort((a, b) => a.uncertaintyMs - b.uncertaintyMs)[0]?.offsetMs ?? 0 : 0;
    console.log(JSON.stringify(summarizeTrace(host.events, browser.events, report.operations, calibrations.at(-1)?.combined ?? null, hostOffset, host, browser), null, 2));
    return;
  }
  const directory = await runBaseline(parseArgs(process.argv.slice(2)));
  const report = JSON.parse(await readFile(resolve(directory, 'report.json'), 'utf8'));
  if (!report.measurementCoverageComplete) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
