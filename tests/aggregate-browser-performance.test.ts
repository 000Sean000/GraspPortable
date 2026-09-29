import { describe, expect, it } from 'vitest';
import { aggregateBrowserPerformance, renderBrowserPerformanceMarkdown } from '../scripts/aggregate-browser-performance';

const event = (name: string, phase: string, at: number, extra: Record<string, unknown> = {}) => ({
  version: 1, lane: name.startsWith('worker.') ? 'browser-worker' : 'browser-main', name, phase,
  id: 's0:b1', at, metrics: {}, ...extra,
});
const browser = (events: unknown[]) => ({ version: 1, events, dropped: 0, droppedIntents: 0, activeIntents: 0 });
const report = { cells: [{ name: 'cold', start: 100, end: 200 }, { name: 'idle', start: 200, end: 400 }],
  clocks: { setup: { browser: [{ offsetMs: 0, uncertaintyMs: 0 }] } } };

describe('browser performance evidence aggregation', () => {
  it('uses start-based observer timestamps and end-based frame gaps and span terminals', () => {
    const result = aggregateBrowserPerformance(report, browser([
      event('browser.longtask', 'sample', 150, { durationMs: 30 }),
      event('browser.frame_gap', 'sample', 210, { durationMs: 60, id: 's0:b2' }),
      event('app.snapshot.apply', 'start', 210, { id: 's0:b3' }),
      event('app.snapshot.apply', 'end', 220, { id: 's0:b3', durationMs: 10, outcome: 'ok' }),
    ]));
    expect(result.byCell.cold.metrics['browser.longtask'].observedSamples.p95Ms).toBe(30);
    expect(result.byCell.unattributed.metrics['browser.frame_gap'].observations).toBe(1);
    expect(result.byCell.idle.metrics['app.snapshot.apply'].successfulOnly.p95Ms).toBe(10);
    expect(result.global.metrics['browser.longtask'].successfulOnly.p95Ms).toBeNull();
    expect(result.attribution.boundaryUncertain).toBe(1);
  });

  it('keeps EventTiming total, processing delay and execution separate by fixed event type', () => {
    const result = aggregateBrowserPerformance(report, browser([
      event('browser.event', 'sample', 180, { durationMs: 40, metrics: { typeCode: 2, processingDelayMs: 5, processingMs: 10, interactionId: 987 } }),
      event('browser.longtask', 'sample', 210, { id: 's0:b2', durationMs: 200 }),
      event('browser.longtask', 'sample', 210, { id: 's0:b3', durationMs: 199 }),
    ]));
    const typed = result.global.eventTimingByType.keydown;
    expect(typed['browser.event.duration'].observedSamples.p95Ms).toBe(40);
    expect(typed['browser.event.processing_delay'].observedSamples.p95Ms).toBe(5);
    expect(typed['browser.event.processing'].observedSamples.p95Ms).toBe(10);
    expect(result.byCell.cold.metrics['browser.event.processing'].observations).toBe(1);
    expect(result.byCell.unattributed.metrics['browser.event.duration'].observations).toBe(1);
    expect(result.global.longTasksAtLeast200Ms).toBe(1);
    expect(JSON.stringify(result)).not.toContain('987');
  });

  it('derives combined worker boundaries by unique session-qualified job and preserves missing cancelled telemetry', () => {
    const result = aggregateBrowserPerformance(report, browser([
      event('runtime.post', 'start', 110, { id: 's0:b1', jobId: 's0:v1' }),
      event('runtime.post', 'end', 112, { id: 's0:b1', jobId: 's0:v1', durationMs: 2, outcome: 'ok' }),
      event('worker.receive', 'instant', 115, { id: 's0:w1-1', jobId: 's0:v1' }),
      event('worker.parse', 'start', 116, { id: 's0:w1-2', jobId: 's0:v1' }),
      event('worker.parse', 'end', 120, { id: 's0:w1-2', jobId: 's0:v1', durationMs: 4, outcome: 'ok' }),
      event('worker.graph', 'start', 120, { id: 's0:w1-3', jobId: 's0:v1' }),
      event('worker.graph', 'end', 130, { id: 's0:w1-3', jobId: 's0:v1', durationMs: 10, outcome: 'ok', metrics: { indexMs: 1, dirtyMs: 2, calculationMs: 6 } }),
      event('runtime.receive', 'instant', 134, { id: 's0:b2', jobId: 's0:v1' }),
      event('runtime.post', 'start', 210, { id: 's1:b1', jobId: 's1:v1' }),
      event('runtime.post', 'end', 211, { id: 's1:b1', jobId: 's1:v1', outcome: 'ok' }),
      event('runtime.job', 'start', 210, { id: 's1:b2', jobId: 's1:v1' }),
      event('runtime.job', 'end', 215, { id: 's1:b2', jobId: 's1:v1', outcome: 'superseded' }),
    ]));
    const metrics = result.global.metrics;
    expect(metrics['runtime.post_to_worker_receive'].observedSamples.p95Ms).toBe(5);
    expect(metrics['runtime.worker_complete_to_receive'].observedSamples.p95Ms).toBe(4);
    expect(metrics['runtime.post_to_receive'].observedSamples.p95Ms).toBe(24);
    expect(metrics['runtime.post_to_receive']).toMatchObject({ observations: 2, missingDuration: 1, censored: 1 });
    expect(metrics['worker.graph.calculation'].successfulOnly.p95Ms).toBe(6);
    expect(JSON.stringify(result)).not.toContain('s0:v1');
  });

  it('preserves errors and open-span censoring without substituting lower bounds for completed durations', () => {
    const data = { ...browser([
      event('api.response_json', 'start', 110, { id: 's0:b1' }),
      event('api.response_json', 'end', 120, { id: 's0:b1', durationMs: 10, outcome: 'error' }),
      event('app.runtime.apply', 'start', 130, { id: 's0:b2' }),
    ]), transitions: [{ unclosedSpans: [{ id: 's0:b2', observedLowerBoundMs: 30 }] }] };
    const result = aggregateBrowserPerformance(report, data);
    expect(result.global.metrics['api.response_json'].outcomes.error).toBe(1);
    expect(result.global.metrics['api.response_json'].successfulOnly.p95Ms).toBeNull();
    expect(result.global.metrics['app.runtime.apply']).toMatchObject({ censored: 1, missingDuration: 1 });
    expect(result.global.metrics['app.runtime.apply'].censoredLowerBounds.p95Ms).toBe(30);
    expect(result.global.metrics['app.runtime.apply'].allObserved.p95Ms).toBeNull();
    expect(result.integrity.missingTerminals).toBe(1);
  });

  it('distinguishes unavailable, unsupported and supported-with-no-samples without zero latency claims', () => {
    const absent = aggregateBrowserPerformance(report, undefined);
    expect(absent.availability).toBe('unavailable');
    expect(absent.rawEventCount).toBeNull();
    expect(absent.global.metrics['browser.longtask'].allObserved.p95Ms).toBeNull();
    const supported = aggregateBrowserPerformance(report, browser([
      event('browser.observers', 'instant', 100, { metrics: { longtaskSupported: false, eventTimingSupported: true } }),
    ]));
    expect(supported.global.metrics['browser.longtask'].availability).toBe('unsupported');
    expect(supported.global.metrics['browser.event.duration'].availability).toBe('supported-no-samples');
    expect(supported.global.longTasksAtLeast200Ms).toBeNull();
  });

  it('uses an envelope across calibrations and keeps boundary-uncertain or uncalibrated samples unattributed', () => {
    const input = browser([event('browser.longtask', 'sample', 188, { durationMs: 1 })]);
    const calibrated = aggregateBrowserPerformance({ ...report, clocks: {
      setup: { browser: [{ offsetMs: 10, uncertaintyMs: 1 }, { offsetMs: 50, uncertaintyMs: 30 }] },
      verification: { browser: [{ offsetMs: 12, uncertaintyMs: 1 }] },
    } }, input);
    expect(calibrated.clock).toMatchObject({ calibrationGroups: 2, browserToRunnerOffsetMs: 11, uncertaintyMs: 2 });
    expect(calibrated.byCell.unattributed.metrics['browser.longtask'].observations).toBe(1);
    const unknown = aggregateBrowserPerformance({ cells: report.cells }, input);
    expect(unknown.global.metrics['browser.longtask'].observedSamples.p95Ms).toBe(1);
    expect(unknown.attribution.noClock).toBe(1);
  });

  it('rejects malformed intervals and strips arbitrary names, IDs, errors, paths and source strings from both outputs', () => {
    const secret = 'PRIVATE-CONTENT-C:\\secret\\note.md';
    const result = aggregateBrowserPerformance({ ...report, title: secret }, browser([
      event(secret, 'sample', 120), event('browser.longtask', 'sample', NaN),
      event('app.flush', 'start', 140, { id: 's0:b2', error: secret, metrics: { text: secret } }),
      event('app.flush', 'end', 130, { id: 's0:b2', outcome: secret, durationMs: 10 }),
      event('api.request_json', 'start', 150, { id: 's0:b3' }), event('api.request_json', 'start', 151, { id: 's0:b3' }),
    ]));
    expect(result).toMatchObject({ ignoredEvents: 1, malformedEvents: 1 });
    expect(result.integrity).toMatchObject({ duplicateSpans: 1, invalidIntervals: 1 });
    expect(result.global.metrics['app.flush'].missingDuration).toBe(1);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(renderBrowserPerformanceMarkdown(result).join('\n')).not.toContain(secret);
  });
});
