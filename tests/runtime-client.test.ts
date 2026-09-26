import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../src/runtime/client';
import type { WorkspaceSnapshot } from '../src/domain/model';
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  terminated = false;
  messages: any[] = [];
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.onmessage?.({ data }); }
}
const snapshot = (revision: number): WorkspaceSnapshot => ({ id: 'workspace', name: 'Test', revision, notes: [], records: [], settings: {} });
describe('worker lifecycle and stale result rejection', () => {
  beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('terminates superseded work and rejects late results without losing newest snapshot', () => {
    const result = vi.fn(); const error = vi.fn(); const client = new RuntimeClient(result, error);
    client.update(snapshot(1)); const old = FakeWorker.instances[0];
    client.update(snapshot(2)); expect(old.terminated).toBe(true);
    old.reply({ job: 1, result: { revision: 1 } }); expect(result).not.toHaveBeenCalled();
    old.onerror?.({ message: 'late error from terminated worker' }); expect(error).not.toHaveBeenCalled();
    FakeWorker.instances[1].reply({ job: 2, result: { revision: 2 } }); expect(result).toHaveBeenCalledExactlyOnceWith({ revision: 2 }); expect(error).not.toHaveBeenCalled();
    client.destroy();
  });
  it('cancels runaway calculation and retries latest committed state', () => {
    const error = vi.fn(); const result = vi.fn(); const client = new RuntimeClient(result, error); client.update(snapshot(7)); const old = FakeWorker.instances[0];
    vi.advanceTimersByTime(15000); expect(old.terminated).toBe(true); expect(error).toHaveBeenCalledOnce();
    old.reply({ job: 1, result: { revision: 7 } }); expect(result).not.toHaveBeenCalled();
    client.retry(); expect(FakeWorker.instances[1].messages[0].snapshot.revision).toBe(7); client.destroy();
  });
});
