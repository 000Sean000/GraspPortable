/** Opt-in, bounded observations. Never pass source text, paths, DOM labels or errors here. */
export type PerfLane = 'browser-main' | 'browser-worker';
export type PerfOutcome = 'ok' | 'error' | 'http_error' | 'cancelled' | 'timeout' | 'superseded' | 'destroyed' | 'stale';
export type PerfMetrics = Record<string, number | boolean>;
export interface PerfEvent {
  version: 1; lane: PerfLane; name: string; phase: 'start' | 'end' | 'instant' | 'sample';
  id: string; parentId?: string; requestId?: string; jobId?: string; at: number;
  durationMs?: number; outcome?: PerfOutcome; metrics: PerfMetrics;
}
interface Links { parentId?: string; requestId?: string; jobId?: string }
export interface PerfSpan { id: string; end(outcome?: PerfOutcome, metrics?: PerfMetrics, links?: Links): void }
export interface PerfIntent { useful(isCurrent?: () => boolean): void; finish(outcome: PerfOutcome): void }
export const PERF_ROUTES = ['other', '/host', '/workspace', '/settings', '/drafts', '/drafts/:id', '/shared/state', '/shared/commands', '/shared/operations/:id', '/files/status', '/files', '/files/locate', '/files/reveal', '/files/mirror/refresh', '/projection/state', '/projection/checkpoint', '/projection/package', '/projection/strategy/plan', '/projection/strategy/apply', '/projection/export', '/projection/locate', '/notes', '/notes/:id', '/records/:id', '/assets', '/assets/:id', '/workspace/open', '/workspace/rebuild', '/history', '/import/plan', '/import/apply'] as const;
export const PERF_METHODS = ['other', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] as const;
const names = new Set([
  'scenario.start', 'scenario.end', 'browser.observers', 'browser.longtask', 'browser.frame_gap', 'browser.event',
  'ui.input.raf', 'ui.beforeinput.raf', 'ui.keydown.raf', 'ui.selection.raf', 'ui.click.raf', 'ui.search.raf', 'ui.note.useful', 'ui.mode.useful', 'ui.panel.shell', 'ui.panel.settled',
  'ui.note.intent', 'ui.mode.intent', 'ui.panel.shell.intent', 'ui.panel.content.intent',
  'app.queue.wait', 'app.action', 'app.flush', 'app.draft.ack', 'app.commit.ack', 'app.snapshot.apply', 'app.runtime.apply', 'app.note.render', 'app.mode.render',
  'api.request', 'api.request_json', 'api.fetch', 'api.response_json', 'api.cancel', 'runtime.update', 'runtime.job', 'runtime.post', 'runtime.receive', 'runtime.reuse',
  'worker.receive', 'worker.parse', 'worker.graph',
]);
const metricKeys = new Set(['scenario', 'iteration', 'revision', 'notes', 'records', 'drafts', 'queueDepth', 'waiting', 'busy', 'modeCode', 'panelCode', 'routeCode', 'methodCode', 'status', 'responseContentLength', 'hidden', 'trusted', 'typeCode', 'processingDelayMs', 'processingMs', 'interactionId', 'longtaskSupported', 'eventTimingSupported', 'frameGapThresholdMs', 'total', 'recalculated', 'affected', 'indexMs', 'dirtyMs', 'calculationMs']);
const outcomes = new Set<PerfOutcome>(['ok', 'error', 'http_error', 'cancelled', 'timeout', 'superseded', 'destroyed', 'stale']);
const spanId = (value: unknown): value is string => typeof value === 'string' && /^(?:b[1-9]\d*|w[1-9]\d*-[1-9]\d*)$/.test(value);
export const safeRequestId = (value: unknown): string | undefined => typeof value === 'string' && /^r[1-9]\d*$/.test(value) ? value : undefined;
function safeMetrics(input: PerfMetrics = {}): PerfMetrics {
  const result: PerfMetrics = {};
  if (!input || typeof input !== 'object') return result;
  for (const key of metricKeys) {
    const value = input[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) result[key] = value;
  }
  return result;
}
function safeLinks(input: Links): Links {
  return { ...(spanId(input.parentId) ? { parentId: input.parentId } : {}), ...(safeRequestId(input.requestId) ? { requestId: input.requestId } : {}),
    ...(typeof input.jobId === 'string' && /^v[1-9]\d*$/.test(input.jobId) ? { jobId: input.jobId } : {}) };
}
export function apiMetrics(path: string, method: string): PerfMetrics {
  const route = path.split('?', 1)[0];
  const fixed = PERF_ROUTES.indexOf(route as typeof PERF_ROUTES[number]);
  const template = fixed >= 0 ? route : /^\/shared\/operations\/[^/]+$/.test(route) ? '/shared/operations/:id'
    : /^\/(drafts|notes|records|assets)\/[^/]+$/.test(route) ? route.slice(0, route.indexOf('/', 1)) + '/:id' : 'other';
  return { routeCode: Math.max(0, PERF_ROUTES.indexOf(template as typeof PERF_ROUTES[number])), methodCode: Math.max(0, PERF_METHODS.indexOf(method.toUpperCase() as typeof PERF_METHODS[number])) };
}

/** The exported factory keeps ring-buffer/privacy behavior testable without a browser. */
export function createPerformanceCollector(enabled: boolean, options: { capacity?: number; lane?: PerfLane; workerJob?: number; now?: () => number; requestFrame?: (callback: () => void) => unknown } = {}) {
  const capacity = Math.max(1, Math.min(20_000, Math.floor(options.capacity ?? 20_000)) || 20_000);
  const lane = options.lane ?? 'browser-main';
  const now = options.now ?? (() => performance.timeOrigin + performance.now());
  let ring: PerfEvent[] = [], head = 0, sequence = 0, dropped = 0;
  const intents = new Set<PerfIntent>(); let droppedIntents = 0;
  const nextId = () => lane === 'browser-worker' ? `w${options.workerJob ?? 1}-${++sequence}` : `b${++sequence}`;
  const append = (event: PerfEvent) => {
    if (ring.length < capacity) ring.push(event);
    else { ring[head] = event; head = (head + 1) % capacity; dropped++; }
  };
  function emit(name: string, phase: PerfEvent['phase'], metrics: PerfMetrics = {}, fields: Links & { id?: string; at?: number; durationMs?: number; outcome?: PerfOutcome } = {}) {
    if (!enabled || !names.has(name)) return;
    const at = fields.at ?? now(); if (!Number.isFinite(at)) return;
    append({ version: 1, lane, name, phase, id: spanId(fields.id) ? fields.id : nextId(), at, ...safeLinks(fields),
      ...(typeof fields.durationMs === 'number' && Number.isFinite(fields.durationMs) ? { durationMs: Math.max(0, fields.durationMs) } : {}),
      ...(fields.outcome && outcomes.has(fields.outcome) ? { outcome: fields.outcome } : {}), metrics: safeMetrics(metrics) });
  }
  function start(name: string, metrics: PerfMetrics = {}, links: Links = {}): PerfSpan | undefined {
    if (!enabled || !names.has(name)) return;
    const id = nextId(), at = now(); let ended = false;
    emit(name, 'start', metrics, { ...links, id, at });
    return { id, end(outcome = 'ok', endMetrics = {}, endLinks = {}) {
      if (ended) return; ended = true;
      emit(name, 'end', { ...metrics, ...endMetrics }, { ...links, ...endLinks, id, durationMs: now() - at, outcome });
    } };
  }
  function snapshot() {
    const ordered = head ? [...ring.slice(head), ...ring.slice(0, head)] : ring;
    return { version: 1 as const, enabled, cap: capacity, dropped, droppedIntents, activeIntents: intents.size, routes: [...PERF_ROUTES], methods: [...PERF_METHODS], events: ordered.map(event => ({ ...event, metrics: { ...event.metrics } })) };
  }
  function drain() { const result = snapshot(); ring = []; head = 0; return result; }
  function ingestWorker(input: unknown, job: number) {
    if (!enabled || !Array.isArray(input)) return;
    for (const item of input.slice(0, 64)) {
      if (!item || item.version !== 1 || item.lane !== 'browser-worker' || !['worker.receive', 'worker.parse', 'worker.graph'].includes(item.name)
        || !['start', 'end', 'instant'].includes(item.phase) || item.jobId !== `v${job}` || !spanId(item.id) || !item.id.startsWith(`w${job}-`) || !Number.isFinite(item.at)) continue;
      const clean: PerfEvent = { version: 1, lane: 'browser-worker', name: item.name, phase: item.phase, id: item.id, at: item.at, jobId: `v${job}`, metrics: safeMetrics(item.metrics),
        ...(Number.isFinite(item.durationMs) ? { durationMs: Math.max(0, item.durationMs) } : {}), ...(outcomes.has(item.outcome) ? { outcome: item.outcome } : {}) };
      append(clean);
    }
  }
  function intent(name: string, metrics: PerfMetrics = {}): PerfIntent | undefined {
    if (!enabled || !['ui.note.intent', 'ui.mode.intent', 'ui.panel.shell.intent', 'ui.panel.content.intent'].includes(name)) return;
    if (intents.size >= 64) { droppedIntents++; return; }
    const span = start(name, metrics)!; let finished = false, scheduled = false;
    const observation: PerfIntent = {
      finish(outcome) { if (finished) return; finished = true; intents.delete(observation); span.end(outcome); },
      useful(isCurrent = () => true) {
        if (finished || scheduled) return; scheduled = true;
        const schedule = options.requestFrame ?? (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined);
        if (!schedule) { observation.finish('error'); return; }
        schedule(() => { if (finished) return; try { observation.finish(isCurrent() ? 'ok' : 'cancelled'); } catch { observation.finish('error'); } });
      },
    };
    intents.add(observation); return observation;
  }
  const cancelIntents = () => { for (const observation of intents) observation.finish('cancelled'); };
  return { enabled, start, emit, snapshot, drain, ingestWorker, intent, cancelIntents, mark: (name: string, metrics?: PerfMetrics) => { if (name === 'scenario.start' || name === 'scenario.end') emit(name, 'instant', metrics); } };
}

type PerfGlobal = typeof globalThis & { __GRASP_PERF_ENABLED__?: boolean; __GRASP_PERF__?: Pick<ReturnType<typeof createPerformanceCollector>, 'snapshot' | 'drain' | 'mark'> };
export const browserPerformance = createPerformanceCollector((globalThis as PerfGlobal).__GRASP_PERF_ENABLED__ === true);

function installObservers() {
  (globalThis as PerfGlobal).__GRASP_PERF__ = { snapshot: browserPerformance.snapshot, drain: browserPerformance.drain, mark: browserPerformance.mark };
  if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  globalThis.addEventListener('pagehide', browserPerformance.cancelIntents, { once: true });
  // This is handler-to-next-rAF, not OS input latency or a confirmed painted frame.
  for (const [type, name] of [['beforeinput', 'ui.beforeinput.raf'], ['input', 'ui.input.raf'], ['keydown', 'ui.keydown.raf'], ['selectionchange', 'ui.selection.raf'], ['click', 'ui.click.raf']] as const) {
    document.addEventListener(type, event => {
      const measured = type === 'input' && (event.target as Element | null)?.id === 'note-search' ? 'ui.search.raf' : name;
      const span = browserPerformance.start(measured, { trusted: event.isTrusted, hidden: document.hidden });
      requestAnimationFrame(() => span?.end('ok', { hidden: document.hidden }));
    }, { capture: true, passive: true });
  }
  let previous: number | undefined;
  const frame = (at: number) => {
    if (!document.hidden && previous !== undefined && at - previous > 50) browserPerformance.emit('browser.frame_gap', 'sample', { hidden: false }, { durationMs: at - previous });
    previous = document.hidden ? undefined : at; requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', () => { previous = undefined; }, { passive: true });
  requestAnimationFrame(frame);
  const supported = typeof PerformanceObserver === 'function' ? PerformanceObserver.supportedEntryTypes ?? [] : [];
  browserPerformance.emit('browser.observers', 'instant', { longtaskSupported: supported.includes('longtask'), eventTimingSupported: supported.includes('event'), frameGapThresholdMs: 50 });
  if (supported.includes('longtask')) {
    try { new PerformanceObserver(list => { for (const entry of list.getEntries()) browserPerformance.emit('browser.longtask', 'sample', {}, { at: performance.timeOrigin + entry.startTime, durationMs: entry.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* Unsupported diagnostics must not affect the application. */ }
  }
  if (supported.includes('event')) {
    try { new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const timed = entry as PerformanceEntry & { processingStart: number; processingEnd: number; interactionId?: number };
        const typeCode = ['other', 'click', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'input', 'beforeinput'].indexOf(entry.name);
        browserPerformance.emit('browser.event', 'sample', { typeCode: Math.max(0, typeCode), processingDelayMs: timed.processingStart - entry.startTime, processingMs: timed.processingEnd - timed.processingStart, interactionId: timed.interactionId ?? 0 }, { at: performance.timeOrigin + entry.startTime, durationMs: entry.duration });
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit); } catch { /* Availability is browser-specific. */ }
  }
}
if (browserPerformance.enabled) installObservers();
