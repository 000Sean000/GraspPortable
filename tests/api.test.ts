import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImportPlan, WorkspaceSnapshot } from '../src/domain/model.js';
import { createApi } from '../server/api.js';
import { WorkspaceStore, type RecoveryPreview } from '../server/store.js';
import type { RenamePreview } from '../server/rename.js';
import { DatabaseSync } from 'node:sqlite';
import { createV1Workspace } from './fixtures/v1-workspace.js';

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
  const stop = async () => { if (stopped) return; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await api.close(); stopped = true; };
  cleanups.push(async () => { await stop(); if (!options.dir) rmSync(dir, { recursive: true, force: true }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected TCP host');
  return { base: `http://127.0.0.1:${address.port}`, dir, stop };
}
function request(base: string, path: string, method: string, value: unknown, headers?: Record<string, string>): Promise<Response> {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
}

describe('HTTP authoritative workflow', () => {
  it('previews semantic rename, applies only the reviewed payload, and reviews full recovery scope through HTTP', async () => {
    const { base } = await host(); const before = await (await fetch(base + '/api/workspace')).json() as WorkspaceSnapshot;
    const headers = { 'x-grasp-workspace': before.id };
    const response = await request(base, '/api/rename/plan', 'POST', { from: 'first_name', to: 'given_name', mode: 'identifier' }, headers);
    expect(response.status).toBe(200); const plan = await response.json() as RenamePreview;
    expect(plan.canApply).toBe(true); expect(plan.recordChanges.length).toBeGreaterThan(0);
    expect(await (await fetch(base + '/api/workspace')).json()).toEqual(before);
    const applied = await request(base, '/api/rename/apply', 'POST', { token: plan.token, workspaceRevision: plan.workspaceRevision, notes: [{ id: 'malicious', markdown: 'unreviewed' }], records: [] }, headers);
    expect(applied.status).toBe(200); const changed = await applied.json() as WorkspaceSnapshot;
    expect(changed.notes.some(n => n.id === 'malicious')).toBe(false); expect(changed.records).toHaveLength(before.records.length);
    expect(changed.notes[0]?.markdown).toContain('@given_name = "Sean"');
    expect((await request(base, '/api/rename/apply', 'POST', { token: plan.token, workspaceRevision: changed.revision }, headers)).status).toBe(409);
    const history = await (await fetch(base + '/api/history')).json() as { id: number; reason: string }[];
    expect(history[0]?.reason).toContain('重新命名 Identifier');
    const preview = await (await fetch(base + `/api/history/${history[0]!.id}/preview`, { headers })).json() as RecoveryPreview;
    expect(preview.scope).toBe('workspace'); expect(preview.workspaceRevision).toBe(changed.revision);
    expect(preview.changes.records.find(r => r.id === 'record-flame')?.changedFields).toContain('description');
    const restored = await (await request(base, `/api/history/${preview.id}/restore`, 'POST', { workspaceRevision: preview.workspaceRevision }, headers)).json() as WorkspaceSnapshot;
    expect(restored.notes.map(n => n.markdown)).toEqual(before.notes.map(n => n.markdown));
  });

  it('refuses collision approval, stale rename plans and plans carried across a workspace switch', async () => {
    const { base, dir } = await host();
    const collision = await (await request(base, '/api/rename/plan', 'POST', { from: 'first_name', to: 'last_name', mode: 'identifier' })).json() as RenamePreview;
    expect(collision.canApply).toBe(false);
    expect((await request(base, '/api/rename/apply', 'POST', { token: collision.token, workspaceRevision: collision.workspaceRevision })).status).toBe(409);
    expect((await request(base, '/api/rename/plan', 'POST', { from: 'first_name', to: 'x', mode: 'replace' })).status).toBe(400);
    const plan = await (await request(base, '/api/rename/plan', 'POST', { from: 'first_name', to: 'given_name', mode: 'identifier' })).json() as RenamePreview;
    await request(base, '/api/settings', 'PUT', { settings: { mode: 'source' } });
    expect((await request(base, '/api/rename/apply', 'POST', { token: plan.token, workspaceRevision: plan.workspaceRevision })).status).toBe(409);
    const next = await (await request(base, '/api/rename/plan', 'POST', { from: 'first_name', to: 'given_name', mode: 'identifier' })).json() as RenamePreview;
    const other = await (await request(base, '/api/workspace/open', 'POST', { path: join(dir, 'rename-other.db'), create: true })).json() as WorkspaceSnapshot;
    expect((await request(base, '/api/rename/apply', 'POST', { token: next.token, workspaceRevision: other.revision }, { 'x-grasp-workspace': other.id })).status).toBe(409);
  });

  it('creates and moves a hierarchy with optimistic revisions, explicit subtree deletion and recovery over HTTP', async () => {
    const { base } = await host();
    const first = await (await fetch(base + '/api/workspace')).json() as WorkspaceSnapshot;
    const headers = { 'x-grasp-workspace': first.id };
    const created = await (await request(base, '/api/folders', 'POST', { name: '研究', parentId: null }, headers)).json() as WorkspaceSnapshot;
    const folder = created.folders[0]!; const note = first.notes[0]!;
    const moved = await (await request(base, `/api/notes/${note.id}/move`, 'PUT', { folderId: folder.id, revision: note.revision }, headers)).json() as WorkspaceSnapshot;
    expect(moved.notes.find(n => n.id === note.id)?.folderId).toBe(folder.id);
    expect((await request(base, `/api/notes/${note.id}/move`, 'PUT', { folderId: null, revision: note.revision }, headers)).status).toBe(409);
    const renamed = await (await request(base, `/api/folders/${folder.id}`, 'PUT', { name: '資料', parentId: null, revision: folder.revision }, headers)).json() as WorkspaceSnapshot;
    const updatedFolder = renamed.folders[0]!;
    expect(renamed.notes).toEqual(moved.notes);
    expect((await request(base, `/api/folders/${folder.id}`, 'DELETE', { revision: updatedFolder.revision, workspaceRevision: renamed.revision }, headers)).status).toBe(409);
    expect((await request(base, `/api/folders/${folder.id}`, 'DELETE', { revision: updatedFolder.revision, workspaceRevision: renamed.revision, recursive: 'yes' }, headers)).status).toBe(400);
    const deleted = await (await request(base, `/api/folders/${folder.id}`, 'DELETE', { revision: updatedFolder.revision, workspaceRevision: renamed.revision, recursive: true }, headers)).json() as WorkspaceSnapshot;
    expect(deleted.folders).toEqual([]); expect(deleted.notes.some(n => n.id === note.id)).toBe(false);
    const history = await (await fetch(base + '/api/history')).json() as { id: number }[];
    const restored = await (await request(base, `/api/history/${history[0]!.id}/restore`, 'POST', { workspaceRevision: deleted.revision }, headers)).json() as WorkspaceSnapshot;
    expect(restored.notes.find(n => n.id === note.id)?.folderId).toBe(folder.id); expect(restored.folders[0]?.name).toBe('資料');
  });

  it('opens a historical database through the host and exposes its validated upgrade backup', async () => {
    const { base, dir } = await host(); const path = join(dir, 'historical.db'); const legacy = createV1Workspace(path);
    const response = await request(base, '/api/workspace/open', 'POST', { path });
    expect(response.status).toBe(200); const opened = await response.json() as WorkspaceSnapshot;
    expect(opened.id).toBe(legacy.id); expect(opened.notes[0]?.folderId).toBeNull(); expect(opened.folders).toEqual([]);
    const info = await (await fetch(base + '/api/host')).json() as { path: string; migrationBackupPath?: string };
    expect(info.path).toBe(path); expect(info.migrationBackupPath).toContain('schema1-backup'); expect(existsSync(info.migrationBackupPath!)).toBe(true);
    const backup = new DatabaseSync(info.migrationBackupPath!, { readOnly: true });
    try { expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1); } finally { backup.close(); }
  });

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
    expect((await request(base, '/api/folders', 'POST', { name: 'stale', parentId: null }, staleHeaders)).status).toBe(409);
    expect((await request(base, `/api/notes/${first.notes[0]!.id}/move`, 'PUT', { folderId: null, revision: first.notes[0]!.revision }, staleHeaders)).status).toBe(409);
    expect((await fetch(base + '/api/export', { headers: staleHeaders })).status).toBe(409);
    expect((await fetch(base + '/api/workspace', { headers: staleHeaders })).status).toBe(409);
    expect(await (await fetch(base + '/api/workspace')).json()).toEqual(second);
    expect(await (await fetch(base + '/api/host', { headers: { 'x-grasp-workspace': second.id } })).json()).toEqual({ path: secondPath, recoveredDraftsManual: false, recoveredDraftIds: [] });
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
    expect(await (await fetch(reopened.base + '/api/host')).json()).toEqual({ path: nextPath, recoveredDraftsManual: false, recoveredDraftIds: [] });
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
