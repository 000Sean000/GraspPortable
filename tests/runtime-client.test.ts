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
const snapshot = (revision: number): WorkspaceSnapshot => ({ id: 'workspace', name: 'Test', revision, folders: [], notes: [], records: [], settings: {} });
describe('worker lifecycle and stale result rejection', () => {
  beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('terminates superseded work and rejects late results without losing newest snapshot', () => {
    const result = vi.fn(); const error = vi.fn(); const client = new RuntimeClient(result, error);
    client.update(snapshot(1)); const old = FakeWorker.instances[0];
    client.update({ ...snapshot(2), notes: [{ id: 'changed', title: '', folderId: null, markdown: '@a = "new"', revision: 2, updatedAt: '' }] }); expect(old.terminated).toBe(true);
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
  it('keeps in-flight content work through navigation and publishes the newest revision', () => {
    const result = vi.fn(); const client = new RuntimeClient(result, vi.fn());
    client.update(snapshot(1)); const worker = FakeWorker.instances[0];
    client.update({ ...snapshot(2), settings: { activeNoteId: 'another' } });
    expect(worker.terminated).toBe(false); expect(worker.messages).toHaveLength(1);
    worker.reply({ job: 1, result: { revision: 1, values: { a: { value: 'ok' } }, metrics: { recalculated: 4 } } });
    expect(result.mock.lastCall?.[0].revision).toBe(2);
    client.update({ ...snapshot(3), name: 'renamed', settings: { mode: 'source' } });
    expect(worker.messages).toHaveLength(1); expect(result.mock.lastCall?.[0].metrics.recalculated).toBe(0);
    expect(result.mock.lastCall?.[0].values.a.value).toBe('ok'); client.destroy();
  });
  it('reuses title-only edits but recalculates changed fields and another workspace', () => {
    const result = vi.fn(); const client = new RuntimeClient(result, vi.fn());
    const original = { ...snapshot(1), notes: [{ id: 'n', title: 'before', folderId: null, markdown: '@a = "x"', revision: 1, updatedAt: '' }], records: [{ id: 'r', collection: 'c', name: 'n', fields: { a: '{a}' }, revision: 1 }] };
    client.update(original); const worker = FakeWorker.instances[0];
    worker.reply({ job: 1, result: { revision: 1, metrics: { recalculated: 2 } } });
    client.update({ ...original, revision: 2, notes: [{ ...original.notes[0], title: 'after', revision: 2 }] });
    expect(worker.messages).toHaveLength(1);
    const changed = { ...original, revision: 3, records: [{ ...original.records[0], fields: { a: 'new' } }] };
    client.update(changed); expect(worker.messages).toHaveLength(2);
    client.update({ ...changed, id: 'another-workspace' }); expect(worker.terminated).toBe(true);
    expect(FakeWorker.instances[1].messages).toHaveLength(1); client.destroy();
  });
});
