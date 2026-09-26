import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImportPlan, WorkspaceSnapshot } from '../src/domain/model.js';
import { createApi } from '../server/api.js';
import { WorkspaceStore } from '../server/store.js';
import { DatabaseSync } from 'node:sqlite';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function host(options: { dir?: string; remember?: boolean } = {}): Promise<{ base: string; dir: string; stop: () => Promise<void> }> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'grasp-api-'));
  // Isolate default host state without changing process cwd or polluting the real workspace.
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  let api: ReturnType<typeof createApi>;
  try { api = options.remember ? createApi() : createApi({ defaultPath: join(dir, 'default.db') }); }
  finally { cwd.mockRestore(); }
  const server: Server = createServer((req, res) => { void api.handle(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let stopped = false;
  const stop = async () => { if (stopped) return; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); api.close(); stopped = true; };
  cleanups.push(async () => { await stop(); if (!options.dir) rmSync(dir, { recursive: true, force: true }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected TCP host');
  return { base: `http://127.0.0.1:${address.port}`, dir, stop };
}
function request(base: string, path: string, method: string, value: unknown, headers?: Record<string, string>): Promise<Response> {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
}

describe('HTTP authoritative workflow', () => {
  it('edits, exports, previews, commits, recovers and opens a portable workspace through real HTTP', async () => {
    const { base, dir } = await host();
    const first = await (await fetch(base + '/api/workspace')).json() as WorkspaceSnapshot;
    const note = first.notes[0]!;
    const savedResponse = await request(base, `/api/notes/${note.id}`, 'PUT', { title: note.title, markdown: note.markdown.replace('"Sean"', '"HTTP"'), revision: note.revision });
    expect(savedResponse.status).toBe(200); const saved = await savedResponse.json() as WorkspaceSnapshot;
    const stale = await request(base, `/api/notes/${note.id}`, 'PUT', { title: 'stale', markdown: 'lost', revision: note.revision }); expect(stale.status).toBe(409);
    const exported = await (await fetch(base + '/api/export')).text(); expect(exported).toContain('"HTTP"');
    const plan = await (await request(base, '/api/import/plan', 'POST', { markdown: exported.replace('"HTTP"', '"AI"') })).json() as ImportPlan;
    expect(plan.canApply).toBe(true);
    const unchanged = await (await fetch(base + '/api/workspace')).json() as WorkspaceSnapshot; expect(unchanged).toEqual(saved);
    const applied = await (await request(base, '/api/import/apply', 'POST', { token: plan.token, workspaceRevision: plan.workspaceRevision })).json() as WorkspaceSnapshot;
    expect(applied.notes[0]!.markdown).toContain('"AI"');
    const history = await (await fetch(base + '/api/history')).json() as { id: number }[];
    const restored = await (await request(base, `/api/history/${history[0]!.id}/restore`, 'POST', { workspaceRevision: applied.revision })).json() as WorkspaceSnapshot;
    expect(restored.notes[0]!.markdown).toContain('"HTTP"');
    const opened = await request(base, '/api/workspace/open', 'POST', { path: join(dir, 'second.db'), create: true, name: '第二個' });
    expect(opened.status).toBe(200); expect((await opened.json() as WorkspaceSnapshot).name).toBe('第二個');
    const original = await (await request(base, '/api/workspace/open', 'POST', { path: join(dir, 'default.db') })).json() as WorkspaceSnapshot;
    expect(original).toEqual(restored);
  });

  it('rejects cross-origin writes, bad content types, malformed input and stale import approvals', async () => {
    const { base } = await host();
    expect((await request(base, '/api/notes', 'POST', { title: 'evil', markdown: '' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await fetch(base + '/api/notes', { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await request(base, '/api/notes', 'POST', { title: '', markdown: '' })).status).toBe(400);
    const plan = await (await request(base, '/api/import/plan', 'POST', { markdown: '# New' })).json() as ImportPlan;
    await request(base, '/api/notes', 'POST', { title: 'intervening', markdown: 'change' });
    expect((await request(base, '/api/import/apply', 'POST', { token: plan.token, workspaceRevision: plan.workspaceRevision })).status).toBe(409);
    const snapshot = await (await fetch(base + '/api/workspace')).json() as WorkspaceSnapshot;
    expect(snapshot.notes.some(n => n.title === 'New')).toBe(false);
  });

  it('rejects stale browser workspace headers even when note IDs and revisions coincide', async () => {
    const { base, dir } = await host();
    const first = await (await fetch(base + '/api/workspace')).json() as WorkspaceSnapshot;
    const secondPath = join(dir, 'second.db'); new WorkspaceStore(secondPath, { create: true, seed: true }).close();
    const second = await (await request(base, '/api/workspace/open', 'POST', { path: secondPath }, { 'x-grasp-workspace': first.id })).json() as WorkspaceSnapshot;
    expect(second.notes[0]?.id).toBe(first.notes[0]?.id); expect(second.notes[0]?.revision).toBe(first.notes[0]?.revision);
    const staleHeaders = { 'x-grasp-workspace': first.id };
    const write = await request(base, `/api/notes/${first.notes[0]!.id}`, 'PUT', { title: 'stale', markdown: 'wrong DB', revision: first.notes[0]!.revision }, staleHeaders);
    expect(write.status).toBe(409); expect((await write.json() as { error: string }).error).toContain('其他分頁');
    expect((await request(base, '/api/notes', 'POST', { title: 'stale', markdown: '' }, staleHeaders)).status).toBe(409);
    expect((await fetch(base + '/api/export', { headers: staleHeaders })).status).toBe(409);
    expect((await fetch(base + '/api/workspace', { headers: staleHeaders })).status).toBe(409);
    expect(await (await fetch(base + '/api/workspace')).json()).toEqual(second);
    expect(await (await fetch(base + '/api/host', { headers: { 'x-grasp-workspace': second.id } })).json()).toEqual({ path: secondPath });
    expect(existsSync(join(dir, 'workspaces', 'host-state.json'))).toBe(false);
  });

  it('remembers the last opened workspace across host restart using only a path pointer', async () => {
    const firstHost = await host({ remember: true });
    const nextPath = join(firstHost.dir, 'Personal.db');
    const opened = await (await request(firstHost.base, '/api/workspace/open', 'POST', { path: nextPath, create: true, name: '個人' })).json() as WorkspaceSnapshot;
    const saved = await (await request(firstHost.base, '/api/notes', 'POST', { title: '重新啟動仍在', markdown: '權威在 DB。' })).json() as WorkspaceSnapshot;
    expect(opened.id).toBe(saved.id);
    const pointer = JSON.parse(readFileSync(join(firstHost.dir, 'workspaces', 'host-state.json'), 'utf8')) as unknown;
    expect(pointer).toEqual({ version: 1, path: nextPath });
    await firstHost.stop();
    const reopened = await host({ dir: firstHost.dir, remember: true });
    expect(await (await fetch(reopened.base + '/api/workspace')).json()).toEqual(saved);
    expect(await (await fetch(reopened.base + '/api/host')).json()).toEqual({ path: nextPath });
  });

  it('surfaces an unavailable remembered path and preserves the pointer for recovery', async () => {
    const firstHost = await host({ remember: true });
    const missingPath = join(firstHost.dir, 'removable.db');
    await request(firstHost.base, '/api/workspace/open', 'POST', { path: missingPath, create: true });
    await firstHost.stop(); rmSync(missingPath);
    const reopened = await host({ dir: firstHost.dir, remember: true });
    const info = await (await fetch(reopened.base + '/api/host')).json() as { path: string; warning: string };
    expect(info.path).toBe(join(firstHost.dir, 'workspaces', 'Welcome.grasp.db')); expect(info.warning).toContain('上次的 workspace 無法開啟');
    expect(JSON.parse(readFileSync(join(firstHost.dir, 'workspaces', 'host-state.json'), 'utf8'))).toEqual({ version: 1, path: missingPath });
  });

  it('keeps the current workspace open if another Grasp database has malformed metadata', async () => {
    const { base, dir } = await host(); const current = await (await fetch(base + '/api/workspace')).json() as WorkspaceSnapshot;
    const malformed = join(dir, 'malformed.db'); new WorkspaceStore(malformed, { create: true }).close();
    const injector = new DatabaseSync(malformed); injector.exec('DELETE FROM workspace'); injector.close();
    const bytes = readFileSync(malformed);
    const attempt = await request(base, '/api/workspace/open', 'POST', { path: malformed }, { 'x-grasp-workspace': current.id });
    expect(attempt.status).toBe(400);
    expect(readFileSync(malformed)).toEqual(bytes);
    expect(await (await fetch(base + '/api/workspace')).json()).toEqual(current);
    const saved = await request(base, '/api/notes', 'POST', { title: 'Still usable', markdown: 'Current workspace remains open.' });
    expect(saved.status).toBe(200);
  });
});
