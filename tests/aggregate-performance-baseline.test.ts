import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { aggregateReports, emptyHostSamples, main, parseArguments, readHostSamples, renderMarkdown, summarizeSamples } from '../scripts/aggregate-performance-baseline';
import { isWithin, repositoryRoot } from '../scripts/evidence-path';

const scratch = resolve(repositoryRoot, '..', 'Scratch'), directories: string[] = [];
async function fixture() { const path = await mkdtemp(join(scratch, 'aggregate-test-')); directories.push(path); return path; }
afterEach(async () => { for (const path of directories.splice(0)) { if (!isWithin(scratch, path) || path === scratch) throw Error('Unsafe test cleanup.'); await rm(path, { recursive: true, force: true }); } });
function report(index = 1) {
  const phases = ['cold', 'idle', 'warm', 'noop', 'validation', 'graph', 'stress'];
  return { schemaVersion: 1, runId: `private-${index}`, trial: 'SECRET title', workspace: `C:/SECRET/${index}/workspace.db`, status: 'complete-with-measured-failures',
    countsPreset: 'full', phases, cells: phases.map(name => ({ name, start: 1, end: 2, outcome: 'measured-non-ready' })),
    commit: 'a'.repeat(40), build: { buildId: '12345678-1234-1234-1234-123456789abc' }, workingTree: '',
    corpus: { notes: 2821, noteBytes: 12345, originalDigest: 'b'.repeat(64) },
    attemptedActionCounts: { typing: 100, search: 30, navigation: 30, mode: 30, selection: 30, panel: 10, save: 10 },
    measurementCoverageComplete: true, coverageMissing: [], originalDataUnchanged: true,
    traceIntegrity: { rawHostEvents: 100, compactStructuralSpans: 20, unclosedHostSpans: 0, hostDroppedEvents: 0, hostSinkErrors: 0,
      browserDropped: 0, browserDroppedIntents: 0, browserActiveIntents: 0, malformedLines: 0, orderlyExitObserved: true },
    summary: { directBrowserSamples: [{ cell: 'idle', name: 'ui.input.raf', outcome: 'ok', durationMs: 70, title: 'SECRET', publicationOverlap: [] },
      { cell: 'stress', name: 'ui.input.raf', operationKind: 'extreme-typing-source', outcome: 'ok', durationMs: 70 },
      { cell: 'stress', name: 'ui.input.raf', operationKind: 'typing-source', outcome: 'ok', durationMs: 70 }, { cell: 'idle', name: 'ui.input.raf', outcome: 'timeout', durationMs: 10000 },
      { cell: 'SECRET', name: 'SECRET', outcome: 'SECRET', durationMs: 10000 }],
    directBrowserApiSamples: [{ name: 'api.request', scope: 'ordinary', acknowledgement: 'draft-save', outcome: 'ok', durationMs: 210 },
      { name: 'api.request', scope: 'extreme-stress', acknowledgement: 'draft-save', outcome: 'error', durationMs: 123 }],
    byStage: { 'db/db.parse': { count: 2, outcomes: { ok: 1, error: 1, SECRET: 'SECRET' }, successfulOnly: { p95Ms: 20 }, private: 'SECRET' }, 'db/SECRET': { count: 3 } },
    publicationSpans: [{ private: 'SECRET' }], publicationInvocationSpans: [{}, {}], genuinePublicationOverlapSamples: 1 },
    operations: [{ cell: 'cold', kind: 'cold-checkpoint', measurement: 'http', outcome: 'timeout', durationMs: 600000, error: 'SECRET error', applicationState: 'pending' },
      { cell: 'idle', kind: 'availability-probe', measurement: 'http', outcome: 'ok', durationMs: 101 }] };
}
const correctness = (index = 1) => ({ status: 'passed', baselineRunId: `private-${index}`, originalNotesVerified: 2821, originalNotesVerifiedAfter: 2821, failure: 'SECRET error' });

describe('sanitized baseline aggregation', () => {
  it('keeps failure/censored denominators and separates daily, extreme, ACK and checkpoint budgets', () => {
    const result = aggregateReports([{ report: report(), correctness: correctness() }]), trial = result.trials[0];
    expect(trial.ui.find(row => row.cell === 'idle')).toMatchObject({ attempted: 2, censoredLowerBounds: { count: 1, maxMs: 10000 }, completionP95Ms: null, budget: { limitMs: 50, assessment: 'exceeded' } });
    expect(trial.ui.find(row => row.scope === 'extreme-note')?.budget).toMatchObject({ limitMs: 100, assessment: 'within-observed-successes' });
    expect(trial.ui.find(row => row.scope === 'ordinary-under-stress')?.budget).toMatchObject({ limitMs: 50, assessment: 'exceeded' });
    expect(trial.acknowledgement[0].budget.assessment).toBe('exceeded');
    expect(trial.acknowledgement.find(row => row.scope === 'mixed-stress-unclassified' && row.kind === 'draft-save')).toMatchObject({ attempted: 1, budget: { assessment: 'separate-no-fixed-budget' } });
    expect(trial.checkpointAttempts).toMatchObject([{ outcome: 'timeout', durationMs: 600000, applicationState: 'pending' }]);
    expect(trial.unclassifiedDirectSamples.outcomes.unknown).toBe(1);
    expect(result.checkpointRanges[0]).toMatchObject({ attempts: 1, successful: 0, successfulIndividualMs: [] });
    expect(summarizeSamples([{ outcome: 'error', durationMs: 5 }]).successfulOnly.p95Ms).toBeNull();
  });
  it('allowlists all emitted names/strings in JSON and markdown', () => {
    const privateReport = report(); privateReport.coverageMissing = ['SECRET title/path/error'] as never;
    const result = aggregateReports([{ report: privateReport, correctness: correctness() }]);
    const output = JSON.stringify(result) + renderMarkdown(result);
    expect(output).not.toContain('SECRET'); expect(output).not.toContain('private-1'); expect(output).not.toContain('C:/');
    expect(result.trials[0].coverageMissing).toEqual(['unrecognized-coverage-item']);
    expect(result.trials[0].stages).toHaveProperty('db/db.parse'); expect(result.trials[0].stages).not.toHaveProperty('db/SECRET');
  });
  it('certifies only three distinct, compatible full trials with corresponding correctness', () => {
    const inputs = [1, 2, 3].map(index => ({ report: report(index), correctness: correctness(index), independentWorkspace: `private-${index}` }));
    expect(aggregateReports(inputs).status).toBe('3-trial-complete');
    expect(aggregateReports(inputs.slice(0, 1)).status).toBe('single-trial-review');
    expect(aggregateReports(inputs.map(value => ({ ...value, independentWorkspace: 'same' }))).status).toBe('3-trial-incomplete');
    inputs[1].correctness.baselineRunId = 'wrong'; expect(aggregateReports(inputs).status).toBe('3-trial-incomplete'); inputs[1].correctness = correctness(2);
    inputs[1].report.countsPreset = 'smoke'; expect(aggregateReports(inputs).status).toBe('3-trial-incomplete'); inputs[1].report.countsPreset = 'full';
    inputs[1].report.cells.pop(); expect(aggregateReports(inputs).status).toBe('3-trial-incomplete');
    expect(() => aggregateReports(inputs.slice(0, 2))).toThrow();
  });
  it('streams sample metrics without inventing unavailable delay or leaking arbitrary strings', async () => {
    const directory = await fixture(), path = join(directory, 'host.jsonl');
    await writeFile(path, [
      { version: 1, name: 'http.receive', phase: 'instant', metrics: { path: 'SECRET' } },
      { version: 1, name: 'coordinator.event-loop', phase: 'sample', metrics: { eventLoopDelayAvailable: false, eventLoopP99Ms: 0, processCpuUserMs: 2, rssBytes: 100, private: 'SECRET' } },
      { version: 1, name: 'coordinator.event-loop', phase: 'sample', metrics: { eventLoopDelayAvailable: true, eventLoopP99Ms: 30, eventLoopMaxMs: 100, processCpuUserMs: 3, processCpuSystemMs: 1, rssBytes: 90 } },
    ].map(value => JSON.stringify(value)).join('\n') + '\nnot JSON\n');
    const samples = await readHostSamples(path);
    expect(samples).toMatchObject({ samples: 2, availableDelaySamples: 1, unavailableDelaySamples: 1, malformedLines: 1, worstSampledP99Ms: 30, maxDelayMs: 100, processCpuUserMs: 5, peakRssBytes: 100 });
    expect(JSON.stringify(samples)).not.toContain('SECRET');
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
