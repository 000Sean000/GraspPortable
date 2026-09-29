import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { applicationFailure, assertScratchWorkspace, browserScopeBoundary, completeSpans, measuredHttpJson, overlaps, quantile, relatedDriverOperation, responseFailed, summarizeOperations, summarizeTrace, syntheticGraph, verifyReadyCheckpoint, type Operation, type TraceEvent } from '../scripts/performance-baseline';
import { assertOutsideRepository, isWithin, repositoryRoot } from '../scripts/evidence-path';

const event = (name: string, phase: string, id: string, at: number, lane = 'projection', extra: Partial<TraceEvent> = {}): TraceEvent => ({ version: 1, name, phase, id, at, lane, ...extra });
const operation = (outcome: Operation['outcome'], durationMs: number): Operation => ({ id: 'o1', cell: 'cold', kind: 'typing-source', measurement: 'driver', start: 100, end: 100 + durationMs, durationMs, outcome });

describe('P0 baseline evidence interpretation', () => {
  it('uses nearest-rank quantiles, rejects malformed observations, and does not invent empty values', () => {
    expect(quantile([40, 10, 30, 20], .5)).toBe(20);
    expect(quantile([40, 10, 30, 20], .95)).toBe(40);
    expect(quantile([], .95)).toBeNull();
    expect(() => quantile([NaN], .95)).toThrow();
    expect(() => quantile([1], 0)).toThrow();
  });
  it('keeps failed and censored attempts in the denominator without claiming completion percentiles', () => {
    const summary = summarizeOperations([operation('ok', 10), operation('error', 20), operation('timeout', 30000), operation('cancelled', 500)]);
    expect(summary).toMatchObject({ attempted: 4, successful: 1, errors: 1, timeouts: 1, cancelled: 1 });
    expect(summary.successfulOnly.p95Ms).toBe(10);
    expect(summary.allObserved.completionP95Ms).toBeNull();
    expect(summary.allObserved.censoredLowerBoundsMs).toEqual([30000, 500]);
  });
  it('rejects HTTP200 application failures and unknown/pending checkpoint outcomes', () => {
    expect(applicationFailure({ mirror: { state: 'error' } })).toBe(true);
    expect(applicationFailure({ status: { state: 'dirty' } })).toBe(true);
    expect(responseFailed(200, { state: 'error' }, true)).toBe(true);
    expect(responseFailed(200, { state: 'pending' }, true)).toBe(true);
    expect(responseFailed(200, {}, true)).toBe(true);
    expect(responseFailed(503, { state: 'ready' }, true)).toBe(true);
    expect(responseFailed(200, { state: 'ready' }, true)).toBe(false);
  });
  it('bounds preparation retries to three pending checkpoints and never retries other failures', async () => {
    const pending = new Error('Pending'); pending.name = 'CheckpointNotReady';
    const retained: string[] = [];
    await verifyReadyCheckpoint(async () => { retained.push(retained.length < 2 ? 'pending' : 'ready'); if (retained.length < 3) throw pending; });
    expect(retained).toEqual(['pending', 'pending', 'ready']);
    let pendingAttempts = 0;
    await expect(verifyReadyCheckpoint(async () => { pendingAttempts++; throw pending; })).rejects.toBe(pending);
    expect(pendingAttempts).toBe(3);
    let failedAttempts = 0; const dirty = new Error('Dirty');
    await expect(verifyReadyCheckpoint(async () => { failedAttempts++; throw dirty; })).rejects.toBe(dirty);
    expect(failedAttempts).toBe(1);
  });
  it('requires complete matching execution spans and excludes boundary-touch or uncertain overlap', () => {
    const spans = completeSpans([event('projection.publish', 'start', 'p', 100), event('projection.wait', 'start', 'w', 90), event('projection.publish', 'end', 'p', 200)]);
    expect(spans).toHaveLength(1);
    expect(overlaps({ start: 120, end: 130 }, spans[0])).toBe(true);
    expect(overlaps({ start: 90, end: 100 }, spans[0])).toBe(false);
    expect(overlaps({ start: 100, end: 101 }, spans[0], 0, 2)).toBe(false);
    expect(overlaps({ start: 20, end: 30 }, spans[0], 100, 1)).toBe(true);
  });
  it('classifies actual publication, DB and worker overlap separately from caller waiting', () => {
    const host = [event('projection.wait', 'start', 'w', 0), event('projection.wait', 'end', 'w', 500),
      event('projection.publish', 'start', 'p', 100), event('projection.generation', 'start', 'g', 105), event('db.semantic', 'start', 'd', 110, 'db'), event('db.semantic', 'end', 'd', 140, 'db'), event('projection.generation', 'end', 'g', 195), event('projection.publish', 'end', 'p', 200)];
    const browser = [event('worker.graph', 'start', 'v1', 100, 'worker'), event('worker.graph', 'end', 'v1', 140, 'worker'), event('ui.input.raf', 'end', 'u1', 125, 'browser', { durationMs: 10, outcome: 'ok' }), event('ui.input.raf', 'end', 'u2', 300, 'browser', { durationMs: 10, outcome: 'ok' })];
    const summary = summarizeTrace(host, browser, [operation('ok', 50)], { offsetMs: 0, uncertaintyMs: 0, sampledAt: 0 });
    expect(summary.genuinePublicationOverlapSamples).toBe(1);
    expect(summary.overlapByCell.cold).toMatchObject({ publication: 1, db: 1, graph: 1 });
    expect(summary.directBrowserSamples[1].publicationOverlap).toEqual([]);
    expect(summary.byDirectBrowserMetric['cold/ui.input.raf'].successfulOnlyP95Ms).toBe(10);
  });
  it('does not certify cross-process overlap without clock evidence', () => {
    const summary = summarizeTrace([event('projection.publish', 'start', 'p', 0), event('projection.publish', 'end', 'p', 100)],
      [event('ui.input.raf', 'end', 'u', 50, 'browser', { durationMs: 10, outcome: 'ok' })], [], null);
    expect(summary.genuinePublicationOverlapSamples).toBe(0);
  });
  it('does not call no-op publisher validation a full generation overlap', () => {
    const summary = summarizeTrace([event('projection.publish', 'start', 'p', 0), event('projection.publish', 'end', 'p', 100)],
      [event('ui.input.raf', 'end', 'u', 50, 'browser', { durationMs: 10, outcome: 'ok' })], [], { offsetMs: 0, uncertaintyMs: 0, sampledAt: 0 });
    expect(summary.publicationInvocationSpans).toHaveLength(1);
    expect(summary.publicationSpans).toHaveLength(0);
    expect(summary.genuinePublicationOverlapSamples).toBe(0);
  });
  it('attributes a slow useful-content span to its initiating navigation, not a later save', () => {
    const navigation = { ...operation('ok', 20), id: 'nav', kind: 'navigation' };
    const laterSave = { ...operation('ok', 150), id: 'save', kind: 'save', start: 200, end: 350 };
    expect(relatedDriverOperation('ui.note.intent', { start: 110, end: 300 }, [navigation, laterSave])?.id).toBe('nav');
    const summary = summarizeTrace([], [event('ui.note.intent', 'end', 'u', 300, 'browser', { durationMs: 190, outcome: 'ok' })], [navigation, laterSave], { offsetMs: 0, uncertaintyMs: 0, sampledAt: 0 });
    expect(summary.driverActionEvidence[0]).toMatchObject({ operationId: 'nav', evidence: 'terminal-observed', directTerminalSamples: 1 });
    expect(summary.typingOverlapByCell.cold.graph).toBe(0);
  });
  it('preserves missing and censored observations and namespaces each browser session', () => {
    const events = [event('ui.input.raf', 'start', 's0:b1', 110, 'browser'), event('ui.input.raf', 'start', 's1:b1', 200, 'browser'), event('ui.input.raf', 'end', 's1:b1', 210, 'browser', { durationMs: 10, outcome: 'ok' })];
    expect(browserScopeBoundary(events, 0, 160, 2)).toEqual([{ id: 's0:b1', name: 'ui.input.raf', lane: 'browser', start: 110, outcome: 'censored-at-scope-boundary', observedLowerBoundMs: 48 }]);
    expect(browserScopeBoundary(events, 1, 220)).toEqual([]);
    const clock = { offsetMs: 0, uncertaintyMs: 0, sampledAt: 0 };
    expect(summarizeTrace([], events, [operation('ok', 20)], clock).driverActionEvidence[0].evidence).toBe('censored-no-terminal-observed');
    expect(summarizeTrace([], [], [operation('ok', 20)], clock).driverActionEvidence[0].evidence).toBe('missing-direct-observation');
  });
  it('keeps preparation delays separate from intended typing and selection samples', () => {
    const preparations = ['sustained-typing-prepare', 'selection-prepare'].map((kind, index) => ({ ...operation('ok', 20), kind, id: `prepare-${index}` }));
    const summary = summarizeTrace([], [], [...preparations, operation('ok', 20)], { offsetMs: 0, uncertaintyMs: 0, sampledAt: 0 });
    expect(summary.driverActionEvidence.map(sample => sample.kind)).toEqual(['typing-source']);
    expect(summary.byKind['cold/driver/sustained-typing-prepare'].attempted).toBe(1);
  });
  it('decodes direct draft and semantic ACK timing separately from acknowledgement instants', () => {
    const browser = [event('api.request', 'end', 'a', 120, 'browser', { durationMs: 10, outcome: 'ok', metrics: { routeCode: 0, methodCode: 0 } }),
      event('api.request', 'end', 'b', 130, 'browser', { durationMs: 20, outcome: 'error', metrics: { routeCode: 1, methodCode: 1 } }), event('app.draft.ack', 'instant', 'c', 121, 'browser')];
    const summary = summarizeTrace([], browser, [operation('ok', 50)], { offsetMs: 0, uncertaintyMs: 0, sampledAt: 0 }, 0, undefined, { routes: ['/drafts/:id', '/shared/commands'], methods: ['PUT', 'POST'] });
    expect(summary.acknowledgementSummary['ordinary/draft-save']).toMatchObject({ attempted: 1, successful: 1 });
    expect(summary.acknowledgementSummary['ordinary/semantic-commit']).toMatchObject({ attempted: 1, successful: 0, nonSuccessful: 1 });
    expect(summary.browserAcknowledgementInstants).toHaveLength(1);
  });
  it('honors the harness total HTTP deadline and retains response metadata', async () => {
    const server = createServer((request, response) => { if (request.url === '/ready') { response.setHeader('x-grasp-perf-request', 'r1'); response.end('{"state":"ready"}'); } });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback port.');
    try {
      const result = await measuredHttpJson(`http://127.0.0.1:${address.port}/ready`, 'GET', {}, undefined, 1000);
      expect(result).toMatchObject({ status: 200, value: { state: 'ready' }, headers: { 'x-grasp-perf-request': 'r1' } });
      await expect(measuredHttpJson(`http://127.0.0.1:${address.port}/blocked`, 'GET', {}, undefined, 20)).rejects.toMatchObject({ name: 'TimeoutError' });
    } finally { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); }
  });
  it('creates the explicit extreme workload dimensions without private source', () => {
    const source = syntheticGraph('P12345', 10000, 50000, 1750000);
    expect(Buffer.byteLength(source)).toBe(1750000);
    expect(source.match(/^@/gm)).toHaveLength(10000);
    expect((source.match(/:ref:/g)?.length ?? 0) + (source.match(/\[\[@/g)?.length ?? 0)).toBe(50000);
    expect(() => syntheticGraph('bad prefix', 10, 10)).toThrow();
  });
});

describe('P0 filesystem confinement', () => {
  it('requires an explicit existing database inside Scratch and forbids Acceptance even through override', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'grasp-perf-path-')), scratch = resolve(root, 'Scratch');
    mkdirSync(scratch); const db = resolve(scratch, 'fixture.db'); writeFileSync(db, 'synthetic');
    expect(assertScratchWorkspace(db, scratch)).toBe(db);
    expect(() => assertScratchWorkspace('relative.db', scratch)).toThrow();
    const acceptance = resolve(root, 'Acceptance'); mkdirSync(acceptance); const original = resolve(acceptance, 'original.db'); writeFileSync(original, 'synthetic');
    expect(() => assertScratchWorkspace(original, acceptance)).toThrow(/Acceptance/);
    expect(() => assertScratchWorkspace(original, scratch)).toThrow();
  });
  it('rejects generated evidence under the repository, including not-yet-created children', () => {
    expect(() => assertOutsideRepository(resolve(repositoryRoot, 'docs', 'benchmarks', 'new', 'report.json'))).toThrow();
    expect(isWithin(resolve(tmpdir(), 'one'), resolve(tmpdir(), 'one-more'))).toBe(false);
    expect(isWithin(resolve(tmpdir(), 'one'), resolve(tmpdir(), 'one', 'nested'))).toBe(true);
  });
});
