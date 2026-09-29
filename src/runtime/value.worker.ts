import { buildKnowledge } from '../domain/knowledge';
import { ValueGraph } from '../domain/graph';
import type { WorkspaceSnapshot } from '../domain/model';
import { createPerformanceCollector, type PerfSpan } from '../diagnostics/performance';
let graph = new ValueGraph();
let workspaceId = '';
self.onmessage = (event: MessageEvent<{ job: number; snapshot: WorkspaceSnapshot; perf?: boolean }>) => {
  const { job, snapshot } = event.data;
  const diagnostics = event.data.perf === true ? createPerformanceCollector(true, { lane: 'browser-worker', workerJob: job, capacity: 64 }) : undefined;
  diagnostics?.emit('worker.receive', 'instant', { revision: snapshot.revision }, { jobId: `v${job}` });
  let parsing: PerfSpan | undefined, calculating: PerfSpan | undefined;
  const telemetry = () => diagnostics ? { perfEvents: diagnostics.drain().events } : {};
  try {
    if (workspaceId !== snapshot.id) { graph = new ValueGraph(); workspaceId = snapshot.id; }
    parsing = diagnostics?.start('worker.parse', { revision: snapshot.revision, notes: snapshot.notes.length, records: snapshot.records.length }, { jobId: `v${job}` });
    const knowledge = buildKnowledge(snapshot.notes, snapshot.records); parsing?.end();
    calculating = diagnostics?.start('worker.graph', { revision: snapshot.revision }, { jobId: `v${job}` });
    const result = graph.update(knowledge, snapshot.revision);
    calculating?.end('ok', { total: result.metrics.total, recalculated: result.metrics.recalculated, affected: result.metrics.affected, indexMs: result.metrics.indexMs ?? 0, dirtyMs: result.metrics.dirtyMs ?? 0, calculationMs: result.metrics.calculationMs ?? 0 });
    self.postMessage({ job, workspaceId, result, ...telemetry() });
  } catch (error) { parsing?.end('error'); calculating?.end('error'); self.postMessage({ job, error: error instanceof Error ? error.message : String(error), ...telemetry() }); }
};
