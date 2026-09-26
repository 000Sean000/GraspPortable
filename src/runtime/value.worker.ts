import { buildKnowledge } from '../domain/knowledge';
import { ValueGraph } from '../domain/graph';
import type { WorkspaceSnapshot } from '../domain/model';
let graph = new ValueGraph();
let workspaceId = '';
self.onmessage = (event: MessageEvent<{ job: number; snapshot: WorkspaceSnapshot }>) => {
  const { job, snapshot } = event.data;
  try {
    if (workspaceId !== snapshot.id) { graph = new ValueGraph(); workspaceId = snapshot.id; }
    const result = graph.update(buildKnowledge(snapshot.notes, snapshot.records), snapshot.revision);
    self.postMessage({ job, workspaceId, result });
  } catch (error) { self.postMessage({ job, error: error instanceof Error ? error.message : String(error) }); }
};
