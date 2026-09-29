import type { RuntimeResult, WorkspaceSnapshot } from '../domain/model';
import { browserPerformance, type PerfSpan } from '../diagnostics/performance';

/** Only content read by buildKnowledge participates; titles, paths and UI preferences do not. */
function sameKnowledge(a: WorkspaceSnapshot, b: WorkspaceSnapshot): boolean {
  if (a.id !== b.id || a.notes.length !== b.notes.length || a.records.length !== b.records.length) return false;
  if (!a.notes.every((note, i) => note.id === b.notes[i].id && note.markdown === b.notes[i].markdown
    && (note.syntaxVersion ?? 'legacy-v0.2') === (b.notes[i].syntaxVersion ?? 'legacy-v0.2'))) return false;
  return a.records.every((record, i) => {
    const other = b.records[i];
    if (record.id !== other.id || record.collection !== other.collection || record.name !== other.name) return false;
    const fields = Object.keys(record.fields);
    return fields.length === Object.keys(other.fields).length && fields.every(key => Object.hasOwn(other.fields, key) && record.fields[key] === other.fields[key]);
  });
}

/** Worker scheduling is a host seam. Only committed snapshots enter this runtime. */
export class RuntimeClient {
  private worker?: Worker;
  private timer?: ReturnType<typeof setTimeout>;
  private job = 0;
  private busy = false;
  private latest?: WorkspaceSnapshot;
  private knowledge?: WorkspaceSnapshot;
  private computed?: RuntimeResult;
  private observation?: PerfSpan;
  constructor(private onResult: (result: RuntimeResult) => void, private onError: (message: string) => void) { this.spawn(); }
  private spawn() {
    const worker = new Worker(new URL('./value.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = event => {
      const { job, result, error } = event.data;
      if (job !== this.job || this.worker !== worker) return;
      browserPerformance.ingestWorker(event.data.perfEvents, job);
      browserPerformance.emit('runtime.receive', 'instant', { revision: this.latest?.revision ?? 0 }, { jobId: `v${job}`, parentId: this.observation?.id });
      this.observation?.end(error ? 'error' : 'ok'); this.observation = undefined;
      clearTimeout(this.timer); this.busy = false;
      if (error) this.onError(error);
      else { this.computed = result; this.onResult({ ...result, revision: this.latest!.revision }); }
    };
    worker.onerror = event => { if (this.worker !== worker) return; this.observation?.end('error'); this.observation = undefined; clearTimeout(this.timer); this.busy = false; this.onError(event.message || '計算 worker 無法啟動'); };
  }
  update(snapshot: WorkspaceSnapshot) {
    const updating = browserPerformance.start('runtime.update', { revision: snapshot.revision, notes: snapshot.notes.length, records: snapshot.records.length });
    let succeeded = false;
    try {
    this.latest = snapshot;
    if (this.knowledge && sameKnowledge(this.knowledge, snapshot)) {
      // A navigation save can arrive while the same content is calculating. Keep
      // that job and publish it at the newest committed revision when it returns.
      if (this.busy) { browserPerformance.emit('runtime.reuse', 'instant', { revision: snapshot.revision, busy: true }); succeeded = true; return; }
      if (this.computed) {
        this.onResult({ ...this.computed, revision: snapshot.revision, metrics: { ...this.computed.metrics, elapsedMs: 0, recalculated: 0, affected: 0, indexMs: 0, dirtyMs: 0, calculationMs: 0 } });
        browserPerformance.emit('runtime.reuse', 'instant', { revision: snapshot.revision, busy: false }); succeeded = true;
        return;
      }
    }
    this.knowledge = snapshot; this.computed = undefined;
    // Cancel superseded CPU work instead of queuing obsolete snapshots.
    if (this.busy) { this.observation?.end('superseded'); this.observation = undefined; this.worker?.terminate(); this.spawn(); }
    clearTimeout(this.timer); this.busy = true;
    const job = ++this.job;
    this.observation = browserPerformance.start('runtime.job', { revision: snapshot.revision }, { jobId: `v${job}` });
    const posting = browserPerformance.start('runtime.post', { revision: snapshot.revision }, { jobId: `v${job}`, parentId: this.observation?.id });
    try { this.worker!.postMessage({ job, snapshot, ...(browserPerformance.enabled ? { perf: true } : {}) }); posting?.end(); }
    catch (error) { posting?.end('error'); this.observation?.end('error'); this.observation = undefined; throw error; }
    this.timer = setTimeout(() => {
      if (job !== this.job) return;
      this.observation?.end('timeout'); this.observation = undefined;
      this.job++; this.worker?.terminate(); this.spawn(); this.busy = false;
      this.onError('計算超過 15 秒，已取消。筆記仍已保存在資料庫，可縮小依賴或重新計算。');
    }, 15000);
    succeeded = true;
    } finally { updating?.end(succeeded ? 'ok' : 'error'); }
  }
  retry() { this.knowledge = undefined; this.computed = undefined; if (this.latest) this.update(this.latest); }
  destroy() { this.observation?.end('destroyed'); this.observation = undefined; this.job++; clearTimeout(this.timer); this.worker?.terminate(); this.worker = undefined; }
}
