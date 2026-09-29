import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { aggregateReports, classifyAcknowledgements, emptyHostSamples, extremeInputEvidence, main, parseArguments, readHostSamples, renderMarkdown, summarizeSamples, verifiedFixture } from '../scripts/aggregate-performance-baseline';
import { isWithin, repositoryRoot } from '../scripts/evidence-path';

const scratch = resolve(repositoryRoot, '..', 'Scratch'), directories: string[] = [];
async function fixture() { const path = await mkdtemp(join(scratch, 'aggregate-test-')); directories.push(path); return path; }
afterEach(async () => { for (const path of directories.splice(0)) { if (!isWithin(scratch, path) || path === scratch) throw Error('Unsafe test cleanup.'); await rm(path, { recursive: true, force: true }); } });
function proof(kind: 'graph' | 'extreme') {
  const expected = { bytes: kind === 'graph' ? 150000 : 1750000, definitions: kind === 'graph' ? 1000 : 10000, references: kind === 'graph' ? 5000 : 50000, sourceHash: 'c'.repeat(64) };
  const stored = { ...expected, dependencyReferences: expected.definitions - 1, noteRevision: 2, workspaceRevision: 5 };
  return { verificationVersion: 1, verified: true, requiredMutationSucceeded: true, expected, returned: { ...stored }, readback: { ...stored } };
}
function hostFixture() { return { ...emptyHostSamples(), requestSizes: { r1: { characters: 300, bodyBytes: 700, parseObservations: 1, ambiguous: false } } }; }
function browserFixture() {
  return { version: 1, dropped: 0, droppedIntents: 0, activeIntents: 0, events: [
    { version: 1, lane: 'browser-main', name: 'browser.observers', phase: 'instant', id: 's0:b1', at: 1,
      metrics: { longtaskSupported: true, eventTimingSupported: true, frameGapThresholdMs: 50 } },
    { version: 1, lane: 'browser-main', name: 'browser.longtask', phase: 'sample', id: 's0:b2', at: 2, durationMs: 250, metrics: {} },
  ] };
}
function report(index = 1) {
  const phases = ['cold', 'idle', 'warm', 'noop', 'validation', 'graph', 'stress'];
  const extremeOperations = (['source', 'live'] as const).flatMap(mode => Array.from({ length: mode === 'source' ? 30 : 20 }, (_, at) => ({
    id: `o${(mode === 'source' ? 1 : 31) + at}`, cell: 'stress', kind: `extreme-typing-${mode}`, measurement: 'driver', outcome: 'ok', durationMs: 75 })));
  const extremeDirect = extremeOperations.map(operation => ({ cell: 'stress', name: 'ui.input.raf', operationId: operation.id, operationKind: operation.kind, outcome: 'ok', durationMs: 70 }));
  const extremeCoverage = (attempted: number) => ({ attempted, driverSuccessful: attempted, driverFailed: 0, directTerminalAttempts: attempted, deliveredAttempts: attempted, missingDirectSuccessfulAttempts: 0 });
  return { schemaVersion: 1, runId: `private-${index}`, trial: 'SECRET title', workspace: `C:/SECRET/${index}/workspace.db`, status: 'complete-with-measured-failures',
    countsPreset: 'full', phases, cells: phases.map(name => ({ name, start: 1, end: 2, outcome: 'measured-non-ready' })),
    commit: 'a'.repeat(40), build: { buildId: '12345678-1234-1234-1234-123456789abc' }, workingTree: '',
    httpTransport: { configuredDeadlineMs: 1800000, availabilityProbeDeadlineMs: 1500 },
    corpus: { notes: 2821, noteBytes: 12345, originalDigest: 'b'.repeat(64) },
    attemptedActionCounts: { typing: 100, search: 30, navigation: 30, mode: 30, selection: 30, panel: 10, save: 10 },
    measurementCoverageComplete: true, coverageMissing: [], originalDataUnchanged: true,
    graphFixture: proof('graph'), extremeFixture: proof('extreme'),
    extremeInputCoverage: { source: extremeCoverage(30), live: extremeCoverage(20) },
    traceIntegrity: { rawHostEvents: 100, compactStructuralSpans: 20, unclosedHostSpans: 0, hostDroppedEvents: 0, hostSinkErrors: 0,
      browserDropped: 0, browserDroppedIntents: 0, browserActiveIntents: 0, malformedLines: 0, orderlyExitObserved: true },
    summary: { directBrowserSamples: [{ cell: 'idle', name: 'ui.input.raf', outcome: 'ok', durationMs: 70, title: 'SECRET', publicationOverlap: [] },
      ...extremeDirect,
      { cell: 'stress', name: 'ui.input.raf', operationKind: 'typing-source', outcome: 'ok', durationMs: 70 }, { cell: 'idle', name: 'ui.input.raf', outcome: 'timeout', durationMs: 10000 },
      { cell: 'SECRET', name: 'SECRET', outcome: 'SECRET', durationMs: 10000 }],
    directBrowserApiSamples: [{ name: 'api.request', requestId: 'r1', scope: 'ordinary', acknowledgement: 'draft-save', outcome: 'ok', durationMs: 210 },
      { name: 'api.request', scope: 'extreme-stress', acknowledgement: 'draft-save', outcome: 'error', durationMs: 123 }],
    byStage: { 'db/db.parse': { count: 2, outcomes: { ok: 1, error: 1, SECRET: 'SECRET' }, successfulOnly: { p95Ms: 20 }, private: 'SECRET' }, 'db/SECRET': { count: 3 } },
    publicationSpans: [{ private: 'SECRET' }], publicationInvocationSpans: [{}, {}], genuinePublicationOverlapSamples: 1 },
    operations: [{ cell: 'cold', kind: 'cold-checkpoint', measurement: 'http', outcome: 'timeout', durationMs: 600000, error: 'SECRET error', applicationState: 'pending' },
      { cell: 'idle', kind: 'availability-probe', measurement: 'http', outcome: 'ok', durationMs: 101 }, ...extremeOperations] };
}
const correctness = (index = 1) => ({ status: 'passed', baselineRunId: `private-${index}`, originalNotesVerified: 2821, originalNotesVerifiedAfter: 2821, failure: 'SECRET error' });

describe('sanitized baseline aggregation', () => {
  it('keeps failure/censored denominators and separates daily, extreme, ACK and checkpoint budgets', () => {
    const result = aggregateReports([{ report: report(), correctness: correctness(), host: hostFixture() }]), trial = result.trials[0];
    expect(trial.ui.find(row => row.cell === 'idle')).toMatchObject({ attempted: 2, censoredLowerBounds: { count: 1, maxMs: 10000 }, completionP95Ms: null, budget: { limitMs: 50, assessment: 'exceeded' } });
    expect(trial.ui.find(row => row.scope === 'extreme-note')?.budget).toMatchObject({ limitMs: 100, assessment: 'within-observed-successes' });
    expect(trial.ui.find(row => row.scope === 'ordinary-under-stress')?.budget).toMatchObject({ limitMs: 50, assessment: 'exceeded' });
    expect(trial.acknowledgement[0].budget.assessment).toBe('exceeded');
    expect(trial.acknowledgement.find(row => row.scope === 'unclassified' && row.kind === 'draft-save')).toMatchObject({ attempted: 1, budget: { assessment: 'separate-no-fixed-budget' } });
    expect(trial.checkpointAttempts).toMatchObject([{ outcome: 'timeout', durationMs: 600000, applicationState: 'pending' }]);
    expect(trial.unclassifiedDirectSamples.outcomes.unknown).toBe(1);
    expect(result.checkpointRanges[0]).toMatchObject({ attempts: 1, successful: 0, successfulIndividualMs: [] });
    expect(summarizeSamples([{ outcome: 'error', durationMs: 5 }]).successfulOnly.p95Ms).toBeNull();
  });
  it('allowlists all emitted names/strings in JSON and markdown', () => {
    const privateReport = report(); privateReport.coverageMissing = ['SECRET title/path/error'] as never;
    const browser = { ...browserFixture(), private: 'SECRET title/path/error' };
    browser.events.push({ ...browser.events[1], name: 'SECRET', metrics: { private: 'SECRET' } } as never);
    const result = aggregateReports([{ report: privateReport, correctness: correctness(), browser }]);
    const output = JSON.stringify(result) + renderMarkdown(result);
    expect(output).not.toContain('SECRET'); expect(output).not.toContain('private-1'); expect(output).not.toContain('C:/');
    expect(result.trials[0].coverageMissing).toEqual(['unrecognized-coverage-item']);
    expect(result.trials[0].stages).toHaveProperty('db/db.parse'); expect(result.trials[0].stages).not.toHaveProperty('db/SECRET');
    expect(result.trials[0].browserPerformance.availability).toBe('observed');
    expect(output).toContain('browser.longtask');
  });
  it('certifies only three distinct, compatible full trials with corresponding correctness', () => {
    const inputs = [1, 2, 3].map(index => ({ report: report(index), correctness: correctness(index), browser: browserFixture(), independentWorkspace: `private-${index}` }));
    expect(aggregateReports(inputs).status).toBe('3-trial-complete');
    const missingBrowser = aggregateReports(inputs.map(input => ({ ...input, browser: undefined })));
    expect(missingBrowser.status).toBe('3-trial-incomplete');
    expect(missingBrowser.trials[0].formalIneligibility).toContain('browser-evidence-unavailable');
    expect(aggregateReports(inputs.slice(0, 1)).status).toBe('single-trial-review');
    expect(aggregateReports(inputs.map(value => ({ ...value, independentWorkspace: 'same' }))).status).toBe('3-trial-incomplete');
    inputs[1].report.httpTransport.configuredDeadlineMs = 600000;
    expect(aggregateReports(inputs)).toMatchObject({ status: '3-trial-incomplete', matchingDeadlineProtocol: false });
    inputs[1].report.httpTransport.configuredDeadlineMs = 1800000;
    inputs[1].correctness.baselineRunId = 'wrong'; expect(aggregateReports(inputs).status).toBe('3-trial-incomplete'); inputs[1].correctness = correctness(2);
    inputs[1].report.countsPreset = 'smoke'; expect(aggregateReports(inputs).status).toBe('3-trial-incomplete'); inputs[1].report.countsPreset = 'full';
    inputs[1].report.cells.pop(); expect(aggregateReports(inputs).status).toBe('3-trial-incomplete');
    expect(() => aggregateReports(inputs.slice(0, 2))).toThrow();
  });
  it('requires stored source hashes and parsed dimensions, rejecting old declarations and failed application', () => {
    expect(verifiedFixture({ definitions: 10000, references: 50000, bytes: 1750000 }, 'extreme').verified).toBe(false);
    const value = proof('extreme'); expect(verifiedFixture(value, 'extreme').verified).toBe(true);
    value.requiredMutationSucceeded = false; expect(verifiedFixture(value, 'extreme').verified).toBe(false); value.requiredMutationSucceeded = true;
    value.readback.sourceHash = 'd'.repeat(64); expect(verifiedFixture(value, 'extreme').verified).toBe(false); value.readback.sourceHash = value.expected.sourceHash;
    value.readback.references--; expect(verifiedFixture(value, 'extreme').verified).toBe(false);
    const input = report(); input.extremeFixture = {} as never;
    expect(aggregateReports([{ report: input }]).trials[0].formalIneligibility).toContain('stored-extreme-fixture-not-proved');
  });
  it('proves both extreme modes from distinct delivered operations, preserves preparation stalls, and rejects inflated counters', () => {
    const input = report(); expect(extremeInputEvidence(input).source.formalDeliveryVerified).toBe(true); expect(extremeInputEvidence(input).live.formalDeliveryVerified).toBe(true);
    input.operations.push({ id: 'o99', cell: 'stress', kind: 'extreme-live-prepare', measurement: 'driver', outcome: 'timeout', durationMs: 10000 });
    const aggregate = aggregateReports([{ report: input }]);
    expect(aggregate.trials[0].actions.find(action => action.kind === 'extreme-live-prepare')).toMatchObject({ purpose: 'preparation', attempted: 1, outcomes: { timeout: 1 } });
    expect(aggregate.trials[0].extremeInputCoverage.live.attempted).toBe(20);
    input.summary.directBrowserSamples = input.summary.directBrowserSamples.filter(sample => sample.operationKind !== 'extreme-typing-live');
    const missing = extremeInputEvidence(input).live;
    expect(missing).toMatchObject({ attempted: 20, deliveredAttempts: 0, missingDirectSuccessfulAttempts: 20, reportedCountsMatch: false, formalDeliveryVerified: false });
    expect(aggregateReports([{ report: input }]).trials[0].formalIneligibility).toContain('extreme-live-input-not-proved');
    input.coverageMissing = ['sample-count:extreme-typing-source', 'direct-action:extreme-typing-live', 'missing-direct-actions:extreme-typing-live'] as never;
    expect(aggregateReports([{ report: input }]).trials[0].coverageMissing).toEqual(input.coverageMissing);
  });
  it('joins initial-session s0 draft sizes to semantic ACKs in each serial flush without using command body size', () => {
    const host = hostFixture(); Object.assign(host.requestSizes, { r3: { characters: 1750010, bodyBytes: 2000000, parseObservations: 1, ambiguous: false } });
    const sample = (requestId: string, kind: string, at: number, durationMs: number, outcome = 'ok') => ({ name: 'api.request', requestId, acknowledgement: kind, at, durationMs, outcome, cell: 'stress' });
    const instant = (name: string, at: number, parentId = 's0:b1') => ({ name, at, parentId });
    const input = { summary: { directBrowserApiSamples: [sample('r1', 'draft-save', 100, 20), sample('r2', 'semantic-commit', 400, 299),
      sample('r3', 'draft-save', 500, 20), sample('r4', 'semantic-commit', 800, 299), sample('r5', 'semantic-commit', 1000, 30, 'timeout')],
      browserAcknowledgementInstants: [instant('app.draft.ack', 100), instant('app.commit.ack', 400), instant('app.draft.ack', 500), instant('app.commit.ack', 800)] } };
    const samples = classifyAcknowledgements(input, host);
    expect(samples.map(sample => sample.scope)).toEqual(['ordinary-small', 'ordinary-small', 'giant-source', 'giant-source', 'unclassified']);
    expect(samples[1]).toMatchObject({ sourceCharacters: 300, evidence: 'preceding-draft-in-same-flush' });
    expect(samples[3].sourceCharacters).toBe(1750010);
    expect(samples[4]).toMatchObject({ outcome: 'timeout', reason: 'non-success-retained-unclassified' });
    input.summary.browserAcknowledgementInstants[1].parentId = 's2:b1';
    expect(classifyAcknowledgements(input, host)[1].scope).toBe('unclassified');
    input.summary.directBrowserApiSamples.push(sample('r6', 'draft-save', 500, 5));
    expect(classifyAcknowledgements(input, host)[3].scope).toBe('unclassified');
    const comparison = aggregateReports([{ report: input, host }]).trials[0].acknowledgement.find(row => row.scope === 'ordinary-small' && row.kind === 'draft-save')!;
    expect(comparison.budget.assessment).toBe('incomplete-attribution');
  });
  it('streams sample metrics without inventing unavailable delay or leaking arbitrary strings', async () => {
    const directory = await fixture(), path = join(directory, 'host.jsonl');
    await writeFile(path, [
      { version: 1, name: 'http.receive', phase: 'instant', metrics: { path: 'SECRET' } },
      { version: 1, name: 'coordinator.event-loop', phase: 'sample', metrics: { eventLoopDelayAvailable: false, eventLoopP99Ms: 0, processCpuUserMs: 2, rssBytes: 100, private: 'SECRET' } },
      { version: 1, name: 'coordinator.event-loop', phase: 'sample', metrics: { eventLoopDelayAvailable: true, eventLoopP99Ms: 30, eventLoopMaxMs: 100, processCpuUserMs: 3, processCpuSystemMs: 1, rssBytes: 90 } },
      { version: 1, lane: 'db', name: 'db.draft.parse', phase: 'start', requestId: 'r1', metrics: { characters: 300, private: 'SECRET' } },
      { version: 1, lane: 'db', name: 'db.draft.parse', phase: 'end', requestId: 'r1', metrics: { characters: 300 } },
      { version: 1, lane: 'coordinator', name: 'http.body', phase: 'instant', requestId: 'r1', metrics: { bytes: 600 } },
      { version: 1, lane: 'db', name: 'db.draft.parse', phase: 'start', requestId: 'r9', metrics: { characters: 1750000 } },
    ].map(value => JSON.stringify(value)).join('\n') + '\nnot JSON\n');
    const samples = await readHostSamples(path, ['r1']);
    expect(samples).toMatchObject({ samples: 2, availableDelaySamples: 1, unavailableDelaySamples: 1, malformedLines: 1, worstSampledP99Ms: 30, maxDelayMs: 100, processCpuUserMs: 5, peakRssBytes: 100 });
    expect(JSON.stringify(samples)).not.toContain('SECRET');
    expect(samples.requestSizes).toEqual({ r1: { characters: 300, bodyBytes: 600, parseObservations: 1, ambiguous: false } });
    expect(await readHostSamples(join(directory, 'missing.jsonl'))).toEqual(emptyHostSamples());
  });
  it('requires explicit absolute inputs and never overwrites an aggregate evidence directory', async () => {
    expect(() => parseArguments(['--report', 'relative.json', '--output-root', 'relative'])).toThrow();
    const directory = await fixture(), input = join(directory, 'input'); await mkdir(input);
    const path = join(input, 'report.json'), output = join(directory, 'aggregate');
    await writeFile(path, JSON.stringify(report()));
    // The report identity is private and need not name an existing DB for this review.
    const data = report(); data.workspace = join(directory, 'workspace', 'workspace.db'); await writeFile(path, JSON.stringify(data));
    await main(['--report', path, '--output-root', output]);
    const before = await readFile(join(output, 'aggregate.json'), 'utf8');
    await expect(main(['--report', path, '--output-root', output])).rejects.toThrow();
    expect(await readFile(join(output, 'aggregate.json'), 'utf8')).toBe(before);
    expect(before).not.toContain(directory); expect(before).not.toContain('SECRET');
  });
});
