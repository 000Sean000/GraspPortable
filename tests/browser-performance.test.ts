import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiMetrics, createPerformanceCollector, PERF_ROUTES } from '../src/diagnostics/performance';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

async function enabledApi() {
  vi.stubGlobal('__GRASP_PERF_ENABLED__', true); vi.stubGlobal('__GRASP_PERF__', undefined); vi.resetModules();
  const api = await import('../src/app/api');
  const { browserPerformance } = await import('../src/diagnostics/performance');
  return { ...api, collector: browserPerformance };
}

describe('opt-in browser performance observations', () => {
  it('does no clock reads or recording when disabled and preserves default worker messages', async () => {
    const now = vi.fn(() => 5), collector = createPerformanceCollector(false, { now });
    expect(collector.start('api.request')).toBeUndefined(); collector.mark('scenario.start', { iteration: 1 });
    expect(collector.intent('ui.note.intent')).toBeUndefined();
    collector.emit('browser.frame_gap', 'sample', {}, { durationMs: 100 });
    expect(collector.snapshot().events).toEqual([]); expect(now).not.toHaveBeenCalled();
    vi.stubGlobal('__GRASP_PERF_ENABLED__', false); vi.stubGlobal('__GRASP_PERF__', undefined); vi.resetModules();
    const postMessage = vi.fn(); vi.stubGlobal('self', { postMessage });
    await import('../src/runtime/value.worker');
    const worker = self as unknown as { onmessage(event: unknown): void };
    worker.onmessage({ data: { job: 1, snapshot: { id: 'private-workspace', revision: 1, notes: [], records: [] } } });
    expect(Object.keys(postMessage.mock.calls[0][0]).sort()).toEqual(['job', 'result', 'workspaceId']);
    expect((globalThis as { __GRASP_PERF__?: unknown }).__GRASP_PERF__).toBeUndefined();
  });

  it('bounds retained events, reports overflow, and drains without resetting cumulative loss', () => {
    const collector = createPerformanceCollector(true, { capacity: 3, now: () => 100 });
    for (let iteration = 0; iteration < 8; iteration++) collector.mark('scenario.start', { iteration });
    const snapshot = collector.snapshot();
    expect(snapshot.events.map(event => event.metrics.iteration)).toEqual([5, 6, 7]); expect(snapshot.dropped).toBe(5);
    snapshot.events[0].metrics.iteration = 999;
    expect(collector.drain().events[0].metrics.iteration).toBe(5);
    expect(collector.snapshot()).toMatchObject({ events: [], dropped: 5, cap: 3 });
  });

  it('allows only fixed telemetry vocabulary, numeric metrics and generated correlation IDs', () => {
    const collector = createPerformanceCollector(true, { now: () => 100 });
    collector.mark('private title', { iteration: 1 });
    collector.emit('api.request', 'instant', { revision: 2, path: 123, query: 789, status: Number.NaN, notes: 'private text' } as never,
      { requestId: 'C:/private/path', jobId: 'private-note', parentId: 'private title' });
    collector.ingestWorker([{ version: 1, lane: 'browser-worker', name: 'worker.parse', phase: 'end', id: 'w2-1', jobId: 'v2', at: 90,
      durationMs: 5, outcome: 'ok', metrics: { revision: 2, markdown: 'private source' }, error: 'private failure' }], 2);
    const data = collector.snapshot();
    expect(data.events).toHaveLength(2); expect(data.events[0].metrics).toEqual({ revision: 2 });
    expect(JSON.stringify(data)).not.toMatch(/private|C:\//);
    expect(apiMetrics('/drafts/private-id?query=private-text', 'PUT').routeCode).toBe(PERF_ROUTES.indexOf('/drafts/:id'));
    expect(apiMetrics('/private/path', 'GET').routeCode).toBe(0);
  });

  it('emits one terminal span outcome even if cleanup ends it again', () => {
    let at = 100; const collector = createPerformanceCollector(true, { now: () => at });
    const span = collector.start('api.request')!; at = 125; span.end('timeout'); span.end('ok');
    expect(collector.snapshot().events).toMatchObject([{ phase: 'start', id: span.id }, { phase: 'end', id: span.id, outcome: 'timeout', durationMs: 25 }]);
  });

  it('includes queue time in first-useful rAF proxies and rejects stale or cancelled completions', () => {
    let at = 100; const frames: Array<() => void> = [];
    const collector = createPerformanceCollector(true, { now: () => at, requestFrame: callback => frames.push(callback) });
    const navigation = collector.intent('ui.note.intent')!;
    at = 130; navigation.useful(() => true); expect(collector.snapshot().events).toHaveLength(1);
    at = 148; frames.shift()!(); navigation.finish('error');
    expect(collector.snapshot().events.at(-1)).toMatchObject({ name: 'ui.note.intent', phase: 'end', outcome: 'ok', durationMs: 48 });
    const stale = collector.intent('ui.mode.intent')!; stale.useful(() => false); frames.shift()!();
    const closed = collector.intent('ui.panel.content.intent', { panelCode: 1 })!; closed.useful(); closed.finish('cancelled'); frames.shift()!();
    expect(collector.snapshot().events.filter(event => event.phase === 'end').map(event => event.outcome)).toEqual(['ok', 'cancelled', 'cancelled']);
    expect(collector.snapshot().activeIntents).toBe(0);
  });

  it('bounds unfinished UI intents and cancels their terminal observations at teardown', () => {
    const collector = createPerformanceCollector(true, { now: () => 100, requestFrame: () => {} });
    for (let i = 0; i < 65; i++) collector.intent('ui.panel.content.intent');
    expect(collector.snapshot()).toMatchObject({ activeIntents: 64, droppedIntents: 1 });
    collector.cancelIntents();
    expect(collector.snapshot().activeIntents).toBe(0);
    expect(collector.snapshot().events.filter(event => event.phase === 'end' && event.outcome === 'cancelled')).toHaveLength(64);
  });

  it('correlates fetch and response JSON with the host without recording payloads', async () => {
    const { request, collector } = await enabledApi();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ markdown: 'private returned source' }), { headers: { 'x-grasp-perf-request': 'r12', 'content-length': '38' } })));
    await expect(request('/drafts/private-id?name=private-name', 'PUT', { markdown: 'private source' })).resolves.toEqual({ markdown: 'private returned source' });
    const events = collector.snapshot().events;
    for (const name of ['api.request', 'api.fetch', 'api.response_json']) {
      expect(events.filter(event => event.name === name && event.phase === 'end')).toMatchObject([{ outcome: 'ok', requestId: 'r12' }]);
    }
    expect(events.find(event => event.name === 'api.fetch' && event.phase === 'end')?.metrics.responseContentLength).toBe(38);
    expect(events.filter(event => event.name === 'api.request_json' && event.phase === 'end')).toMatchObject([{ outcome: 'ok' }]);
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it.each(['http', 'encode', 'decode', 'fetch', 'caller', 'timeout'] as const)('records a terminal %s failure without recording its error text', async kind => {
    const { request, collector } = await enabledApi(); const controller = new AbortController();
    if (kind === 'timeout') vi.useFakeTimers();
    const response = { ok: kind !== 'http', status: kind === 'http' ? 409 : 200, headers: new Headers({ 'x-grasp-perf-request': 'private header' }),
      json: kind === 'decode' ? () => Promise.reject(new Error('private JSON failure')) : () => Promise.resolve({ error: 'private server failure' }) };
    vi.stubGlobal('fetch', kind === 'fetch' ? vi.fn().mockRejectedValue(new Error('private fetch failure')) : kind === 'caller' || kind === 'timeout' ? vi.fn(() => new Promise(() => {})) : vi.fn().mockResolvedValue(response));
    const payload = kind === 'encode' ? { toJSON() { throw new Error('private encoding failure'); } } : undefined;
    const pending = request('/files/status?path=private', payload ? 'POST' : 'GET', payload, { signal: controller.signal, timeoutMs: kind === 'timeout' ? 10 : 0 });
    const rejected = expect(pending).rejects.toBeInstanceOf(Error);
    if (kind === 'caller') controller.abort();
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(10);
    await rejected;
    const events = collector.snapshot().events;
    const expected = kind === 'http' ? 'http_error' : kind === 'caller' ? 'cancelled' : kind === 'timeout' ? 'timeout' : 'error';
    expect(events.filter(event => event.name === 'api.request' && event.phase === 'end')).toMatchObject([{ outcome: expected }]);
    for (const start of events.filter(event => event.phase === 'start')) expect(events.filter(event => event.phase === 'end' && event.id === start.id)).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it('reports worker parse/graph phases as bounded plain observations', async () => {
    vi.stubGlobal('__GRASP_PERF_ENABLED__', false); vi.resetModules(); const postMessage = vi.fn(); vi.stubGlobal('self', { postMessage });
    await import('../src/runtime/value.worker');
    (self as unknown as { onmessage(event: unknown): void }).onmessage({ data: { job: 3, perf: true,
      snapshot: { id: 'private workspace', revision: 7, notes: [{ id: 'private note', markdown: 'private source', syntaxVersion: 'grasp-v1' }], records: [] } } });
    const { perfEvents } = postMessage.mock.calls[0][0];
    expect(perfEvents.map((event: { name: string; phase: string }) => `${event.name}:${event.phase}`)).toEqual(['worker.receive:instant', 'worker.parse:start', 'worker.parse:end', 'worker.graph:start', 'worker.graph:end']);
    expect(perfEvents.every((event: { lane: string; jobId: string }) => event.lane === 'browser-worker' && event.jobId === 'v3')).toBe(true);
    expect(JSON.stringify(perfEvents)).not.toContain('private');
  });

  it('terminates observed runtime jobs once on supersession, timeout and destruction, ignoring late results', async () => {
    const { collector } = await enabledApi(); vi.useFakeTimers();
    class FakeWorker {
      static instances: FakeWorker[] = [];
      onmessage?: (event: { data: unknown }) => void;
      onerror?: (event: { message: string }) => void;
      messages: unknown[] = [];
      constructor() { FakeWorker.instances.push(this); }
      postMessage(message: unknown) { this.messages.push(message); }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const { RuntimeClient } = await import('../src/runtime/client'); const result = vi.fn(), error = vi.fn();
    const client = new RuntimeClient(result, error);
    const snapshot = { id: 'private workspace', name: 'private name', revision: 1, notes: [], records: [], folders: [], attachments: [], settings: {} };
    client.update(snapshot);
    client.update({ ...snapshot, revision: 2, records: [{ id: 'private record', collection: 'private collection', name: 'private record name', fields: {}, revision: 2 }] });
    FakeWorker.instances[0].onmessage?.({ data: { job: 1, result: { revision: 1 }, error: 'private late error' } });
    await vi.advanceTimersByTimeAsync(15000); client.retry(); client.destroy();
    expect(result).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledOnce();
    expect(collector.snapshot().events.filter(event => event.name === 'runtime.job' && event.phase === 'end').map(event => event.outcome)).toEqual(['superseded', 'timeout', 'destroyed']);
    expect(JSON.stringify(collector.snapshot().events)).not.toContain('private');
  });
});
