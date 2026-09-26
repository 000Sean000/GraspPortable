import type { RuntimeResult, WorkspaceSnapshot } from '../domain/model';

/** Worker scheduling is a host seam. Only committed snapshots enter this runtime. */
export class RuntimeClient {
  private worker?: Worker;
  private timer?: ReturnType<typeof setTimeout>;
  private job = 0;
  private busy = false;
  private latest?: WorkspaceSnapshot;
  constructor(private onResult: (result: RuntimeResult) => void, private onError: (message: string) => void) { this.spawn(); }
  private spawn() {
    const worker = new Worker(new URL('./value.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = event => {
      const { job, result, error } = event.data;
      if (job !== this.job || this.worker !== worker) return;
      clearTimeout(this.timer); this.busy = false;
      if (error) this.onError(error); else this.onResult(result);
    };
    worker.onerror = event => { if (this.worker !== worker) return; clearTimeout(this.timer); this.busy = false; this.onError(event.message || '計算 worker 無法啟動'); };
  }
  update(snapshot: WorkspaceSnapshot) {
    this.latest = snapshot;
    // Cancel superseded CPU work instead of queuing obsolete snapshots.
    if (this.busy) { this.worker?.terminate(); this.spawn(); }
    clearTimeout(this.timer); this.busy = true;
    const job = ++this.job;
    this.worker!.postMessage({ job, snapshot });
    this.timer = setTimeout(() => {
      if (job !== this.job) return;
      this.job++; this.worker?.terminate(); this.spawn(); this.busy = false;
      this.onError('計算超過 15 秒，已取消。筆記仍已保存在資料庫，可縮小依賴或重新計算。');
    }, 15000);
  }
  retry() { if (this.latest) this.update(this.latest); }
  destroy() { this.job++; clearTimeout(this.timer); this.worker?.terminate(); this.worker = undefined; }
}
