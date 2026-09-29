import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { PerformanceRecorder, type PerformanceEvent } from '../server/performance.js';

const directories: string[] = [], recorders: PerformanceRecorder[] = [], servers: Server[] = [];
async function fixture(options: ConstructorParameters<typeof PerformanceRecorder>[0] = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'grasp-host-performance-')); directories.push(dir);
  const path = join(dir, 'trace.jsonl'); const recorder = new PerformanceRecorder({ path, ...options }); recorders.push(recorder);
  const events = async () => { await recorder.finish(); return (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as PerformanceEvent); };
  return { dir, path, recorder, events };
}
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  for (const recorder of recorders.splice(0)) await recorder.finish();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('opt-in host performance observer', () => {
  it('is inert by default and preserves synchronous results, errors and promise identity', async () => {
    const recorder = new PerformanceRecorder(); recorders.push(recorder);
    const object = {}, pending = Promise.resolve(object), error = new Error('private failure');
    expect(recorder.enabled).toBe(false);
    expect(recorder.measure('db', 'db.snapshot', {}, () => object)).toBe(object);
    expect(recorder.measure('db', 'db.snapshot', {}, () => pending)).toBe(pending);
    expect(() => recorder.measure('db', 'db.transaction', {}, () => { throw error; })).toThrow(error);
    recorder.instant('db', 'db.commit', { notes: 3 }); await recorder.finish();
    expect(recorder.clock()).toMatchObject({ enabled: false, droppedEvents: 0, sinkErrors: 0, writtenEvents: 0 });
  });

  it('buffers early spans, links nested asynchronous work and emits success/error terminals', async () => {
    const f = await fixture(); const error = new Error('SECRET error and C:/private/path');
    await f.recorder.measure('projection', 'projection.publish', {}, async () => {
      await Promise.resolve();
      f.recorder.measure('db', 'db.capture', { workspaceRevision: 7 }, () => 7);
      await expect(f.recorder.measure('filesystem', 'fs.read', {}, async () => { throw error; })).rejects.toBe(error);
    }, true);
    expect(() => f.recorder.measure('db', 'db.transaction', {}, () => { throw error; })).toThrow(error);
    const events = await f.events(), publication = events.find(e => e.name === 'projection.publish' && e.phase === 'start')!;
    const capture = events.find(e => e.name === 'db.capture' && e.phase === 'start')!;
    expect(capture.parentId).toBe(publication.id); expect(capture.jobId).toBe(publication.jobId);
    expect(publication.jobId).toMatch(/^j[1-9][0-9]*$/);
    for (const start of events.filter(e => e.phase === 'start')) {
      const ends = events.filter(e => e.phase === 'end' && e.id === start.id);
      expect(ends).toHaveLength(1); expect(ends[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(ends[0].at).toBeGreaterThanOrEqual(start.at);
    }
    expect(events.find(e => e.name === 'fs.read' && e.phase === 'end')?.outcome).toBe('error');
    expect(events.find(e => e.name === 'db.transaction' && e.phase === 'end')?.outcome).toBe('error');
    expect(JSON.stringify(events)).not.toContain('SECRET');
    expect(events.at(-1)).toMatchObject({ name: 'trace.summary', metrics: { droppedEvents: 0, sinkErrors: 0 } });
  });

  it('drops unknown event names and filters arbitrary string values and keys', async () => {
    const f = await fixture();
    f.recorder.instant('coordinator', 'http.receive', {
      route: '/api/notes/SECRET?query=PRIVATE', method: 'GET', notes: 3, bytes: Number.POSITIVE_INFINITY,
      path: 'C:/private/SECRET', title: 'PRIVATE TITLE', error: 'PRIVATE ERROR', state: 'dirty', pid: -1,
    });
    f.recorder.instant('db', 'SECRET arbitrary event' as never, {});
    const events = await f.events(); const event = events.find(e => e.name === 'http.receive')!;
    expect(event.metrics).toEqual({ method: 'GET', notes: 3, state: 'dirty' });
    expect(JSON.stringify(events)).not.toMatch(/SECRET|PRIVATE|C:\//);
    expect(f.recorder.clock().droppedEvents).toBe(1);
  });

  it('measures JSON separately while preserving conversion order, exact bytes, parse errors and privacy', async () => {
    const f = await fixture(), order: string[] = [];
    f.recorder.measure('db', 'db.capture', {}, () => {
      const serialized = f.recorder.serializeJson('db', { toJSON() { order.push('toJSON'); return { private: 'SECRET', count: 3 }; } }, null, 2);
      expect(serialized).toBe('{\n  "private": "SECRET",\n  "count": 3\n}');
      const parsed = f.recorder.parseJson('db', serialized, (key, value) => { order.push(key); return value; });
      expect(parsed).toEqual({ private: 'SECRET', count: 3 });
      expect(f.recorder.serializeJson('projection', parsed)).toBe('{"private":"SECRET","count":3}');
      expect(f.recorder.parseJson('projection', '{"private":"SECRET"}')).toEqual({ private: 'SECRET' });
      expect(() => f.recorder.parseJson('projection', 'SECRET invalid JSON')).toThrow(SyntaxError);
    });
    expect(order).toEqual(['toJSON', 'private', 'count', '']);
    const events = await f.events(), parent = events.find(e => e.name === 'db.capture' && e.phase === 'start')!;
    for (const name of ['db.parse', 'db.serialize', 'projection.parse', 'projection.serialize']) {
      const starts = events.filter(e => e.name === name && e.phase === 'start');
      expect(starts.length).toBeGreaterThan(0);
      for (const start of starts) {
        expect(start.parentId).toBe(parent.id);
        expect(events.filter(e => e.phase === 'end' && e.id === start.id)).toHaveLength(1);
      }
    }
    expect(events.some(e => e.name === 'projection.parse' && e.phase === 'end' && e.outcome === 'error')).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/SECRET|private|invalid JSON/);
  });

  it('bounds memory and total events, reporting overflow in the final summary', async () => {
    const f = await fixture({ maxBufferedEvents: 4, maxEvents: 7, flushIntervalMs: 60_000, sampleIntervalMs: 60_000 });
    for (let at = 0; at < 40; at++) f.recorder.instant('db', 'db.commit', { count: at });
    expect(f.recorder.clock().bufferedEvents).toBeLessThanOrEqual(4);
    await f.recorder.flush();
    for (let at = 0; at < 40; at++) f.recorder.instant('db', 'db.commit', { count: at });
    const events = await f.events();
    expect(events.length).toBeLessThanOrEqual(8); // One reserved final counter summary.
    expect(Number(events.at(-1)!.metrics!.droppedEvents)).toBeGreaterThan(0);
    expect(f.recorder.clock().bufferedEvents).toBe(0);
  });

  it('never overwrites an existing sink and sink failure cannot change product success', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'grasp-host-performance-')); directories.push(dir);
    const path = join(dir, 'existing.jsonl'); await writeFile(path, 'private original');
    const recorder = new PerformanceRecorder({ path }); recorders.push(recorder);
    expect(recorder.measure('db', 'db.commit', {}, () => 'committed')).toBe('committed');
    await recorder.finish();
    expect(await readFile(path, 'utf8')).toBe('private original');
    expect(recorder.clock().sinkErrors).toBe(1);
    const failed = new PerformanceRecorder({ path: join(dir, 'missing-parent', 'trace.jsonl') }); recorders.push(failed);
    await expect(failed.measure('db', 'db.commit', {}, async () => 'committed')).resolves.toBe('committed');
    await failed.finish(); expect(failed.clock().sinkErrors).toBe(1);
    const relative = new PerformanceRecorder({ path: 'relative-trace.jsonl' }); recorders.push(relative);
    expect(relative.clock()).toMatchObject({ enabled: false, sinkErrors: 1 });
  });

  it('reports finite event-loop p99 and process CPU deltas without inventing unavailable delay samples', async () => {
    const f = await fixture({ sampleIntervalMs: 20 });
    await new Promise(resolve => setTimeout(resolve, 65));
    const events = await f.events(), samples = events.filter(e => e.name === 'coordinator.event-loop');
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.metrics!.processCpuUserMs).toBeGreaterThanOrEqual(0);
      expect(sample.metrics!.processCpuSystemMs).toBeGreaterThanOrEqual(0);
      for (const value of Object.values(sample.metrics!)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      if (sample.metrics!.eventLoopDelayAvailable) expect(sample.metrics!.eventLoopP99Ms).toBeGreaterThanOrEqual(0);
      else expect(sample.metrics).not.toHaveProperty('eventLoopP99Ms');
    }
  });

  it('generates opaque request correlation and records disconnected requests without request content', async () => {
    const f = await fixture(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const server = createServer((req, res) => f.recorder.request(req, res, () => {
      if (req.url?.startsWith('/hold')) { entered(); return; }
      f.recorder.measure('db', 'db.snapshot', {}, () => {}); res.end('ok');
    })); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + '/api/notes/SECRET?q=PRIVATE', { headers: { 'x-grasp-perf-request': 'SECRET' } });
    expect(response.headers.get('x-grasp-perf-request')).toMatch(/^r[1-9][0-9]*$/); await response.text();
    const held = httpRequest(base + '/hold/SECRET', () => {}); held.on('error', () => {}); held.end();
    await started; held.destroy(); await new Promise(resolve => setTimeout(resolve, 20));
    const events = await f.events(), requestId = response.headers.get('x-grasp-perf-request');
    expect(events.find(e => e.name === 'db.snapshot' && e.phase === 'start')?.requestId).toBe(requestId);
    expect(events.some(e => e.name === 'http.request' && e.phase === 'end' && e.outcome === 'cancelled')).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/SECRET|PRIVATE/);
  });

  it('exposes clock diagnostics only in the opt-in host and preserves normal DB save behavior', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'grasp-host-performance-')); directories.push(dir);
    const script = `
      import { createServer } from 'node:http';
      import { createApi } from './server/api.ts';
      import { hostPerformance } from './server/performance.ts';
      const api = createApi({defaultPath:process.env.PERF_TEST_DB});
      const server = createServer((req,res) => hostPerformance.request(req,res,()=>api.handle(req,res)));
      await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
      const base='http://127.0.0.1:'+server.address().port;
      try {
        const clock=await fetch(base+'/api/diagnostics/performance/clock');
        const clockData=await clock.json();
        const before=await (await fetch(base+'/api/workspace')).json();
        const saved=await fetch(base+'/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings:{...before.settings,mode:'source'}})});
        const after=await saved.json();
        const checkpoint=await (await fetch(base+'/api/projection/checkpoint',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
        await (await fetch(base+'/api/files/status')).json();
        console.log(JSON.stringify({status:clock.status,clock:clockData,revisionAdvanced:after.revision===before.revision+1,saved:saved.status,checkpointState:checkpoint.state}));
      } finally { await new Promise(resolve=>server.close(resolve)); await api.close(); await hostPerformance.finish(); }
    `;
    for (const enabled of [false, true]) {
      const workspace = join(dir, enabled ? 'enabled' : 'disabled'); await mkdir(workspace);
      const result = await new Promise<{ code: number | null; output: string; error: string }>(resolve => {
        const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
          cwd: process.cwd(), windowsHide: true, env: { ...process.env, GRASP_PERF_TRACE: enabled ? join(dir, 'enabled.jsonl') : '', PERF_TEST_DB: join(workspace, 'workspace.db') },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '', error = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { error += data; });
        child.on('close', code => resolve({ code, output, error }));
      });
      expect(result.code, result.error).toBe(0);
      const resultData = JSON.parse(result.output.trim());
      expect(resultData).toMatchObject({ status: enabled ? 200 : 404, revisionAdvanced: true, saved: 200, checkpointState: 'ready' });
      if (enabled) expect(resultData.clock).toMatchObject({ enabled: true, droppedEvents: 0, sinkErrors: 0 });
    }
    const events = (await readFile(join(dir, 'enabled.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as PerformanceEvent);
    expect(events.some(e => e.name === 'db.transaction' && e.phase === 'end' && e.outcome === 'ok')).toBe(true);
    expect(events.some(e => e.name === 'db.commit' && e.phase === 'end')).toBe(true);
    for (const name of ['db.parse', 'db.serialize', 'projection.parse', 'projection.serialize']) {
      expect(events.some(e => e.name === name && e.phase === 'end' && e.outcome === 'ok'), name).toBe(true);
    }
    expect(JSON.stringify(events)).not.toContain(dir);
  });
});
