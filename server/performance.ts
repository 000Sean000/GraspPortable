import { AsyncLocalStorage } from 'node:async_hooks';
import { open, type FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { threadId } from 'node:worker_threads';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type PerformanceLane = 'coordinator' | 'db' | 'projection' | 'filesystem';
const eventNames = [
  'trace.config', 'trace.summary', 'coordinator.event-loop',
  'http.request', 'http.receive', 'http.body', 'http.parse', 'http.serialize', 'http.finish', 'http.cancel',
  'db.open', 'db.snapshot', 'db.snapshot.size', 'db.capture', 'db.transaction', 'db.commit', 'db.semantic',
  'db.shared-state', 'db.draft-save', 'db.draft.parse', 'db.blob', 'db.parse', 'db.serialize',
  'projection.checkpoint', 'projection.publish', 'projection.wait', 'projection.capture', 'projection.catalog',
  'projection.plan', 'projection.render', 'projection.hash', 'projection.generation', 'projection.recovery',
  'projection.retention', 'projection.status', 'projection.stage', 'projection.inspect', 'projection.locate',
  'projection.parse', 'projection.serialize',
  'fs.read', 'fs.write', 'fs.check', 'fs.rename', 'fs.inventory', 'fs.validate', 'fs.dirty', 'fs.copy', 'fs.cleanup',
] as const;
export type PerformanceEventName = typeof eventNames[number];
export type PerformanceMetrics = Record<string, number | boolean | string | undefined>;
export interface PerformanceEvent {
  version: 1; lane: PerformanceLane; name: PerformanceEventName;
  phase: 'start' | 'end' | 'instant' | 'sample'; id: string;
  parentId?: string; requestId?: string; jobId?: string;
  at: number; durationMs?: number; outcome?: 'ok' | 'error' | 'cancelled';
  metrics?: Record<string, number | boolean | string>;
}
const numericKeys = new Set([
  'bytes', 'characters', 'notes', 'records', 'folders', 'attachments', 'drafts', 'files', 'dirtyFiles',
  'workspaceRevision', 'semanticRevision', 'strategyRevision', 'revision', 'lastSuccessRevision', 'count',
  'statusCode', 'pid', 'threadId', 'droppedEvents', 'sinkErrors', 'bufferedEvents', 'writtenEvents',
  'maxBufferedEvents', 'maxEvents', 'elapsedMs', 'eventLoopP50Ms', 'eventLoopP95Ms', 'eventLoopP99Ms', 'eventLoopMaxMs',
  'eventLoopUtilization', 'eventLoopActiveMs', 'eventLoopIdleMs', 'rssBytes', 'heapUsedBytes',
  'processCpuUserMs', 'processCpuSystemMs',
]);
const stringValues: Record<string, ReadonlySet<string>> = {
  method: new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OTHER']),
  route: new Set(['host', 'workspace', 'workspace-open', 'workspace-rebuild', 'settings', 'shared-state', 'shared-command',
    'shared-operation', 'draft', 'notes', 'files', 'files-status', 'files-locate', 'files-reveal', 'projection-state',
    'projection-checkpoint', 'projection-strategy', 'projection-export', 'performance-clock', 'other']),
  waitReason: new Set(['inspect-running', 'checkpoint-running', 'locate-running', 'locate-checkpoint', 'shutdown-running']),
  scope: new Set(['full', 'partial']), state: new Set(['idle', 'pending', 'ready', 'dirty', 'error']),
  transactionKind: new Set(['read', 'write']),
  stage: new Set(['captured', 'generation-complete', 'journal-durable', 'old-renamed', 'new-renamed', 'published']),
};
function safeMetrics(input: PerformanceMetrics): Record<string, number | boolean | string> {
  const output: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (numericKeys.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0) output[key] = value;
    else if (['enabled', 'eventLoopDelayAvailable'].includes(key) && typeof value === 'boolean') output[key] = value;
    else if (typeof value === 'string' && stringValues[key]?.has(value)) output[key] = value;
  }
  return output;
}
function routeCode(url: string | undefined): string {
  const path = (url ?? '').split('?', 1)[0];
  const routes: Record<string, string> = {
    '/api/host': 'host', '/api/workspace': 'workspace', '/api/workspace/open': 'workspace-open',
    '/api/workspace/rebuild': 'workspace-rebuild', '/api/settings': 'settings', '/api/shared/state': 'shared-state',
    '/api/shared/commands': 'shared-command', '/api/files': 'files', '/api/files/status': 'files-status',
    '/api/files/locate': 'files-locate', '/api/files/reveal': 'files-reveal', '/api/projection/state': 'projection-state',
    '/api/projection/checkpoint': 'projection-checkpoint', '/api/projection/export': 'projection-export',
    '/api/diagnostics/performance/clock': 'performance-clock',
  };
  if (routes[path]) return routes[path];
  if (/^\/api\/drafts(?:\/|$)/.test(path)) return 'draft';
  if (/^\/api\/notes(?:\/|$)/.test(path)) return 'notes';
  if (/^\/api\/shared\/operations\//.test(path)) return 'shared-operation';
  if (/^\/api\/projection\/strategy\//.test(path)) return 'projection-strategy';
  return 'other';
}
interface Context { parentId?: string; requestId?: string; jobId?: string }
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(min, Math.min(max, Math.floor(value)));
}
export interface PerformanceRecorderOptions {
  /** Only a new absolute filename is accepted. Its parent must already exist. */
  path?: string; maxBufferedEvents?: number; maxEvents?: number; flushIntervalMs?: number; sampleIntervalMs?: number;
}

/** Logical lanes describe work, not isolated threads. P0 still executes all host work on thread 0.
 * No supplied paths, content, IDs, errors, or unrestricted string values enter the trace.
 * The observer never throws into product work, including after a durable SQLite commit. */
export class PerformanceRecorder {
  readonly enabled: boolean;
  private readonly context = new AsyncLocalStorage<Context>();
  private readonly queue: string[] = [];
  private readonly maxBufferedEvents: number;
  private readonly maxEvents: number;
  private readonly sink: Promise<FileHandle | undefined>;
  private pendingWrite?: Promise<void>;
  private inFlight = 0;
  private accepted = 0;
  private written = 0;
  private dropped = 0;
  private sinkErrors = 0;
  private failed = false;
  private closed = false;
  private finishing?: Promise<void>;
  private sequence = 0;
  private requestSequence = 0;
  private jobSequence = 0;
  private flushTimer?: ReturnType<typeof setInterval>;
  private sampleTimer?: ReturnType<typeof setInterval>;
  private histogram?: ReturnType<typeof monitorEventLoopDelay>;
  private lastUtilization = performance.eventLoopUtilization();
  private lastCpu = process.cpuUsage();

  constructor(options: PerformanceRecorderOptions = {}) {
    this.maxBufferedEvents = bounded(options.maxBufferedEvents, 8192, 1, 65_536);
    this.maxEvents = bounded(options.maxEvents, 2_000_000, 1, 10_000_000);
    this.enabled = !!options.path && isAbsolute(options.path);
    if (options.path && !this.enabled) this.sinkErrors++;
    this.sink = this.enabled ? open(options.path!, 'wx', 0o600).catch(() => {
      this.failed = true; this.sinkErrors++; this.dropped += this.queue.length; this.queue.length = 0;
      return undefined;
    }) : Promise.resolve(undefined);
    if (!this.enabled) return;
    this.flushTimer = setInterval(() => { void this.flush(); }, bounded(options.flushIntervalMs, 100, 10, 60_000));
    this.flushTimer.unref();
    try {
      this.histogram = monitorEventLoopDelay({ resolution: 10 }); this.histogram.enable();
      this.sampleTimer = setInterval(() => this.sample(), bounded(options.sampleIntervalMs, 1000, 20, 60_000));
      this.sampleTimer.unref();
    } catch { this.sinkErrors++; }
    this.instant('coordinator', 'trace.config', { enabled: true, pid: process.pid, threadId,
      maxBufferedEvents: this.maxBufferedEvents, maxEvents: this.maxEvents });
  }
  clock() {
    return { epochMs: performance.timeOrigin + performance.now(), pid: process.pid, enabled: this.enabled,
      droppedEvents: this.dropped, sinkErrors: this.sinkErrors, bufferedEvents: this.queue.length + this.inFlight, writtenEvents: this.written };
  }
  private emit(event: Omit<PerformanceEvent, 'version' | 'at' | 'metrics'>, metrics: PerformanceMetrics = {}): void {
    if (!this.enabled || this.closed) return;
    try {
      if (!eventNames.includes(event.name) || !['coordinator', 'db', 'projection', 'filesystem'].includes(event.lane)
        || this.failed || this.accepted >= this.maxEvents || this.queue.length + this.inFlight >= this.maxBufferedEvents) { this.dropped++; return; }
      const clean = safeMetrics(metrics);
      this.queue.push(JSON.stringify({ version: 1, ...event, at: performance.timeOrigin + performance.now(),
        ...(Object.keys(clean).length ? { metrics: clean } : {}) }) + '\n');
      this.accepted++;
      if (this.queue.length >= 256) void this.flush();
    } catch { this.dropped++; }
  }
  instant(lane: PerformanceLane, name: PerformanceEventName, metrics: PerformanceMetrics = {}): void {
    if (!this.enabled) return;
    this.emit({ lane, name, phase: 'instant', id: `p${++this.sequence}`, ...this.context.getStore() }, metrics);
  }
  measure<T>(lane: PerformanceLane, name: PerformanceEventName, metrics: PerformanceMetrics, action: () => T, job = false): T {
    if (!this.enabled || this.closed) return action();
    const parent = this.context.getStore(), id = `p${++this.sequence}`, start = performance.now();
    const context = { ...parent, ...(job ? { jobId: `j${++this.jobSequence}` } : {}) };
    this.emit({ lane, name, phase: 'start', id, ...context }, metrics);
    const end = (outcome: 'ok' | 'error') => this.emit({ lane, name, phase: 'end', id, ...context,
      durationMs: performance.now() - start, outcome }, metrics);
    return this.context.run({ ...context, parentId: id }, () => {
      try {
        const value = action();
        if (value instanceof Promise) return value.then(result => { end('ok'); return result; }, error => { end('error'); throw error; }) as T;
        end('ok'); return value;
      } catch (error) { end('error'); throw error; }
    });
  }
  /** Forward the original arguments once; neither payloads nor parser errors enter telemetry. */
  parseJson(lane: 'db' | 'projection', ...args: Parameters<typeof JSON.parse>): ReturnType<typeof JSON.parse> {
    return this.measure(lane, lane === 'db' ? 'db.parse' : 'projection.parse', { characters: args[0].length }, () => JSON.parse(...args));
  }
  serializeJson(lane: 'db' | 'projection', ...args: Parameters<typeof JSON.stringify>): ReturnType<typeof JSON.stringify> {
    return this.measure(lane, lane === 'db' ? 'db.serialize' : 'projection.serialize', {}, () => JSON.stringify(...args));
  }
  request<T>(req: IncomingMessage, res: ServerResponse, action: () => T): T {
    if (!this.enabled || this.closed) return action();
    const requestId = `r${++this.requestSequence}`, id = `p${++this.sequence}`, started = performance.now();
    const metrics = { method: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(req.method ?? '') ? req.method! : 'OTHER', route: routeCode(req.url) };
    try { res.setHeader('X-Grasp-Perf-Request', requestId); } catch { /* Observation cannot reject a request. */ }
    this.emit({ lane: 'coordinator', name: 'http.request', phase: 'start', id, requestId }, metrics);
    let ended = false;
    const end = (cancelled = false) => {
      if (ended) return; ended = true;
      req.off('aborted', aborted); res.off('finish', finished); res.off('close', disconnected);
      const outcome = cancelled ? 'cancelled' : res.statusCode >= 400 ? 'error' : 'ok';
      this.emit({ lane: 'coordinator', name: cancelled ? 'http.cancel' : 'http.finish', phase: 'instant',
        id: `p${++this.sequence}`, parentId: id, requestId, outcome }, { ...metrics, statusCode: res.statusCode });
      this.emit({ lane: 'coordinator', name: 'http.request', phase: 'end', id, requestId,
        durationMs: performance.now() - started, outcome }, { ...metrics, statusCode: res.statusCode });
    };
    const aborted = () => end(true), finished = () => end(), disconnected = () => end(!res.writableFinished);
    req.once('aborted', aborted); res.once('finish', finished); res.once('close', disconnected);
    return this.context.run({ requestId, parentId: id }, () => {
      this.instant('coordinator', 'http.receive', metrics);
      return action();
    });
  }
  private sample(): void {
    if (!this.enabled || this.closed) return;
    try {
      const utilization = performance.eventLoopUtilization(), delta = performance.eventLoopUtilization(utilization, this.lastUtilization);
      this.lastUtilization = utilization;
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage(), processCpuUserMs = (cpu.user - this.lastCpu.user) / 1000,
        processCpuSystemMs = (cpu.system - this.lastCpu.system) / 1000;
      this.lastCpu = cpu;
      const eventLoopDelayAvailable = !!this.histogram && this.histogram.count > 0;
      this.emit({ lane: 'coordinator', name: 'coordinator.event-loop', phase: 'sample', id: `p${++this.sequence}` }, {
        threadId, eventLoopDelayAvailable,
        eventLoopP50Ms: eventLoopDelayAvailable ? this.histogram!.percentile(50) / 1e6 : undefined,
        eventLoopP95Ms: eventLoopDelayAvailable ? this.histogram!.percentile(95) / 1e6 : undefined,
        eventLoopP99Ms: eventLoopDelayAvailable ? this.histogram!.percentile(99) / 1e6 : undefined,
        eventLoopMaxMs: eventLoopDelayAvailable ? this.histogram!.max / 1e6 : undefined,
        eventLoopUtilization: delta.utilization, eventLoopActiveMs: delta.active, eventLoopIdleMs: delta.idle,
        rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, droppedEvents: this.dropped, sinkErrors: this.sinkErrors,
        // CPU deltas are process-wide samples; nested span wall time is not attributed CPU time.
        processCpuUserMs, processCpuSystemMs,
      });
      this.histogram?.reset();
    } catch { this.sinkErrors++; }
  }
  flush(): Promise<void> {
    if (this.pendingWrite) return this.pendingWrite;
    this.pendingWrite = (async () => {
      const sink = await this.sink;
      if (!sink || this.failed) return;
      while (this.queue.length && !this.failed) {
        const batch = this.queue.splice(0, 256); this.inFlight = batch.length;
        try { await sink.writeFile(batch.join('')); this.written += batch.length; }
        catch { this.failed = true; this.sinkErrors++; this.dropped += batch.length + this.queue.length; this.queue.length = 0; }
        finally { this.inFlight = 0; }
      }
    })().catch(() => { this.failed = true; this.sinkErrors++; }).finally(() => { this.pendingWrite = undefined; });
    return this.pendingWrite;
  }
  finish(): Promise<void> {
    if (this.finishing) return this.finishing;
    this.finishing = (async () => {
      clearInterval(this.flushTimer); clearInterval(this.sampleTimer);
      this.sample(); this.histogram?.disable();
      await this.flush(); this.closed = true;
      const sink = await this.sink;
      if (!sink) return;
      try {
        if (!this.failed) {
          const summary: PerformanceEvent = { version: 1, lane: 'coordinator', name: 'trace.summary', phase: 'instant',
            id: `p${++this.sequence}`, at: performance.timeOrigin + performance.now(), metrics: {
              droppedEvents: this.dropped, sinkErrors: this.sinkErrors, writtenEvents: this.written, bufferedEvents: this.queue.length } };
          await sink.writeFile(JSON.stringify(summary) + '\n'); this.written++;
          await sink.sync();
        }
      } catch { this.sinkErrors++; }
      finally { try { await sink.close(); } catch { this.sinkErrors++; } }
    })().catch(() => { this.sinkErrors++; this.closed = true; });
    return this.finishing;
  }
}

const eventLimit = process.env.GRASP_PERF_MAX_EVENTS;
export const hostPerformance = new PerformanceRecorder({ path: process.env.GRASP_PERF_TRACE,
  maxEvents: eventLimit && /^[1-9][0-9]*$/.test(eventLimit) ? Number(eventLimit) : undefined });
