import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApi } from '../server/api.js';
import { WorkspaceFiles } from '../server/files.js';
import type { WorkspaceSnapshot, ImportPlan } from '../src/domain/model.js';
import type { FileEntry, FilesStatus } from '../src/domain/files.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function host(options: { dir?: string; prepare?: (path: string) => void } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'grasp-files-api-')); const path = join(dir, 'workspace.db'); options.prepare?.(path);
  const opened: string[] = []; const revealed: string[] = [];
  const api = createApi({ defaultPath: path, openDirectory: async directory => { opened.push(directory); }, revealFile: async file => { revealed.push(file); } });
  const server = createServer((req, res) => { void api.handle(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('TCP address missing');
  let stopped = false;
  const stop = async () => { if (stopped) return; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await api.close(); stopped = true; };
  cleanups.push(async () => { await stop(); if (!options.dir) rmSync(dir, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, dir, path, opened, revealed, stop };
}
const request = (base: string, path: string, value: unknown = {}, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const getSnapshot = async (base: string) => await (await fetch(base + '/api/workspace')).json() as WorkspaceSnapshot;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKVsAAAAASUVORK5CYII=', 'base64');

describe('managed files and startup recovery HTTP workflows', () => {
  it('uploads immutable assets, serves only safe MIME inline, binds browser image URLs to workspace and recovers deletion', async () => {
    const h = await host(); const initial = await getSnapshot(h.base);
    const uploaded = await fetch(h.base + '/api/assets?name=pixel.png&path=images%2Fpixel.png', { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-grasp-workspace': initial.id }, body: png });
    expect(uploaded.status).toBe(200); const saved = await uploaded.json() as WorkspaceSnapshot; const asset = saved.attachments[0]!;
    const image = await fetch(h.base + `/api/assets/${asset.id}?workspace=${saved.id}`);
    expect(image.status).toBe(200); expect(image.headers.get('content-disposition')).toMatch(/^inline/); expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    expect((await fetch(h.base + `/api/assets/${asset.id}?workspace=stale`)).status).toBe(409);
    const svgResponse = await fetch(h.base + '/api/assets?name=unsafe.svg', { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg onload="alert(1)"></svg>' });
    const svg = (await svgResponse.json() as WorkspaceSnapshot).attachments.find(a => a.name === 'unsafe.svg')!;
    const svgDownload = await fetch(h.base + `/api/assets/${svg.id}?workspace=${saved.id}`);
    expect(svgDownload.headers.get('content-disposition')).toMatch(/^attachment/); expect(svgDownload.headers.get('content-security-policy')).toContain('sandbox');
    const deleted = await (await request(h.base, `/api/assets/${asset.id}`, { revision: asset.revision }, 'DELETE')).json() as WorkspaceSnapshot;
    expect((await fetch(h.base + `/api/assets/${asset.id}?workspace=${saved.id}`)).status).toBe(404);
    const history = await (await fetch(h.base + '/api/history')).json() as { id: number }[];
    const restored = await (await request(h.base, `/api/history/${history[0]!.id}/restore`, { workspaceRevision: deleted.revision })).json() as WorkspaceSnapshot;
    expect(restored.attachments.some(a => a.id === asset.id)).toBe(true);
    expect(Buffer.from(await (await fetch(h.base + `/api/assets/${asset.id}?workspace=${saved.id}`)).arrayBuffer())).toEqual(png);
  });

  it('saves visible outbox/inbox files and applies edited Markdown only after review', async () => {
    const h = await host(); const before = await getSnapshot(h.base);
    const entry = await (await request(h.base, '/api/files/exchange')).json() as FileEntry;
    expect(entry.path).toMatch(/^\.grasp\/exchange\/outbox\//); expect(existsSync(entry.absolutePath)).toBe(true);
    const exported = await (await fetch(h.base + `/api/files/download?path=${encodeURIComponent(entry.path)}&workspace=${before.id}`)).text();
    const edited = exported.replace('@first_name = "Sean"', '@first_name = "Inbox"');
    const inbox = await (await fetch(h.base + '/api/files/inbox?name=AI.md', { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: edited })).json() as FileEntry;
    const plan = await (await request(h.base, '/api/files/import/plan', { path: inbox.path })).json() as ImportPlan;
    expect(plan.canApply).toBe(true); expect(await getSnapshot(h.base)).toEqual(before);
    const applied = await (await request(h.base, '/api/import/apply', { token: plan.token, workspaceRevision: plan.workspaceRevision })).json() as WorkspaceSnapshot;
    expect(applied.notes[0]?.markdown).toContain('"Inbox"');
    const status = await (await request(h.base, '/api/files/mirror/refresh')).json() as FilesStatus;
    expect(status.mirror.state).toBe('ready'); expect(status.mirror.revision).toBe(applied.revision);
    const listed = await (await fetch(h.base + '/api/files?path=.grasp%2Fexchange%2Finbox')).json() as FileEntry[];
    expect(listed.some(file => file.path === inbox.path)).toBe(true);
    expect((await request(h.base, '/api/files/open-folder', { path: '.grasp/exchange/inbox' })).status).toBe(200);
    expect(h.opened).toEqual([resolve(`${h.path}.files`, '.grasp/exchange/inbox')]);
    expect((await fetch(h.base + '/api/files/download?path=..%2Fworkspace.db')).status).toBe(400);
    expect((await request(h.base, '/api/files/open-folder', { path: '../' })).status).toBe(400); expect(h.opened).toHaveLength(1);
    const bad = await (await fetch(h.base + '/api/files/inbox?name=invalid.md', { method: 'POST', body: Buffer.from([0xff, 0xfe]) })).json() as FileEntry;
    expect((await request(h.base, '/api/files/import/plan', { path: bad.path })).status).toBe(400); expect(await getSnapshot(h.base)).toEqual(applied);
  });

  it('preserves BOM and CRLF bytes when reviewing and applying a plain Markdown inbox file', async () => {
    const h = await host(); const before = await getSnapshot(h.base);
    const raw = '\uFEFF# 中文\r\n\r\nPlain Markdown\r\n';
    const inbox = await (await fetch(h.base + '/api/files/inbox?name=raw.md', { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: Buffer.from(raw, 'utf8') })).json() as FileEntry;
    expect(readFileSync(inbox.absolutePath)).toEqual(Buffer.from(raw, 'utf8'));
    const plan = await (await request(h.base, '/api/files/import/plan', { path: inbox.path })).json() as ImportPlan;
    expect(plan.canApply).toBe(true); expect(await getSnapshot(h.base)).toEqual(before);
    const applied = await (await request(h.base, '/api/import/apply', { token: plan.token, workspaceRevision: plan.workspaceRevision })).json() as WorkspaceSnapshot;
    const added = applied.notes.filter(note => !before.notes.some(previous => previous.id === note.id));
    expect(added).toHaveLength(1); expect(Buffer.from(added[0]!.markdown, 'utf8')).toEqual(Buffer.from(raw, 'utf8'));
  });

  it('reveals current projection files and reviews external edits into the same identity without silent overwrite', async () => {
    const h = await host(); let snapshot = await getSnapshot(h.base); const original = snapshot.notes[0]!;
    snapshot = await (await request(h.base, `/notes/${original.id}`.replace('/notes/', '/api/notes/'), { title: 'Readable note', markdown: '# Raw\r\n\r\nOriginal', revision: original.revision }, 'PUT')).json() as WorkspaceSnapshot;
    const status = await (await request(h.base, '/api/files/mirror/refresh')).json() as FilesStatus;
    expect(status.mirror.state).toBe('ready'); expect(status.directories.mirror).toBe(resolve(status.root, 'Markdown'));
    const located = await (await request(h.base, '/api/files/locate', { kind: 'note', id: original.id })).json() as FileEntry;
    expect(located.name).toBe('Readable note.md'); expect(located.path).toBe('Markdown/Readable note.md');
    expect((await request(h.base, '/api/files/reveal', { path: located.path })).status).toBe(200); expect(h.revealed).toEqual([located.absolutePath]);
    expect((await request(h.base, '/api/files/reveal', { path: '../workspace.db' })).status).toBe(400); expect(h.revealed).toHaveLength(1);
    const external = '# Raw\r\n\r\nHuman changed this'; writeFileSync(located.absolutePath, external);
    const dirty = await (await fetch(h.base + '/api/files/status')).json() as FilesStatus;
    expect(dirty.mirror.state).toBe('dirty'); expect(dirty.mirror.dirtyPaths).toContain(located.path); expect(await getSnapshot(h.base)).toEqual(snapshot);
    const blocked = await (await request(h.base, '/api/files/mirror/refresh')).json() as FilesStatus;
    expect(blocked.mirror.state).toBe('dirty'); expect(readFileSync(located.absolutePath, 'utf8')).toBe(external);
    const preview = await (await request(h.base, '/api/files/external/plan', { path: located.path })).json() as ImportPlan;
    expect(preview.canApply).toBe(true); expect(preview.changes.filter(c => c.kind === 'update')).toHaveLength(1);
    expect(preview.changes.find(c => c.kind === 'update')!.id).toBe(original.id);
    writeFileSync(located.absolutePath, external + ' again');
    expect((await request(h.base, '/api/import/apply', { token: preview.token, workspaceRevision: preview.workspaceRevision })).status).toBe(409); expect(await getSnapshot(h.base)).toEqual(snapshot);
    const fresh = await (await request(h.base, '/api/files/external/plan', { path: located.path })).json() as ImportPlan;
    const applied = await (await request(h.base, '/api/import/apply', { token: fresh.token, workspaceRevision: fresh.workspaceRevision })).json() as WorkspaceSnapshot;
    expect(applied.notes).toHaveLength(snapshot.notes.length); expect(applied.notes.find(n => n.id === original.id)!.markdown).toBe(external + ' again');
    const clean = await (await request(h.base, '/api/files/mirror/refresh')).json() as FilesStatus;
    expect(clean.mirror.state).toBe('ready'); expect(clean.mirror.dirtyPaths).toEqual([]); expect(readFileSync(located.absolutePath, 'utf8')).toBe(external + ' again');
  });

  it('keeps host recovery alive for a corrupt default database and never overwrites it while opening another DB', async () => {
    const corrupt = Buffer.from('This is not a SQLite database.'); const h = await host({ prepare: path => writeFileSync(path, corrupt) });
    const info = await (await fetch(h.base + '/api/host')).json() as { error: string; unavailablePath: string };
    expect(info.error).toContain('無法開啟'); expect(info.unavailablePath).toBe(h.path);
    expect((await fetch(h.base + '/api/workspace')).status).toBe(503); expect((await request(h.base, '/api/notes', { title: 'unsafe', markdown: '' })).status).toBe(503);
    expect(readFileSync(h.path)).toEqual(corrupt);
    const opened = await request(h.base, '/api/workspace/open', { path: join(h.dir, 'fresh.db'), create: true });
    expect(opened.status).toBe(200); expect((await getSnapshot(h.base)).notes).toHaveLength(1); expect(readFileSync(h.path)).toEqual(corrupt);
  });

  it('keeps committed DB edits durable when mirror writes fail and retries after filesystem repair', async () => {
    const h = await host({ prepare: path => writeFileSync(`${path}.files`, 'A file blocks the managed directory.') });
    const initial = await getSnapshot(h.base); const note = initial.notes[0]!;
    const response = await request(h.base, `/api/notes/${note.id}`, { title: note.title, markdown: '@name = "DB survived"', revision: note.revision }, 'PUT');
    expect(response.status).toBe(200); const saved = await response.json() as WorkspaceSnapshot;
    const failed = await (await request(h.base, '/api/files/mirror/refresh')).json() as FilesStatus;
    expect(failed.mirror.state).toBe('error'); expect(failed.mirror.error).toBeTruthy(); expect(await getSnapshot(h.base)).toEqual(saved);
    rmSync(`${h.path}.files`);
    const retried = await (await request(h.base, '/api/files/mirror/refresh')).json() as FilesStatus;
    expect(retried.mirror.state).toBe('ready'); expect(retried.mirror.revision).toBe(saved.revision);
    await h.stop(); const restarted = await host({ dir: h.dir }); expect(await getSnapshot(restarted.base)).toEqual(saved);
  });

  it('rebuilds from a validated mirror after DB corruption into an exclusive fresh identity and retains attachment bytes', async () => {
    const original = await host();
    await fetch(original.base + '/api/assets?name=pixel.png', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    const before = await getSnapshot(original.base);
    const status = await (await request(original.base, '/api/files/mirror/refresh')).json() as FilesStatus;
    const manifestPath = resolve(status.root, status.mirror.manifestPath!); expect(existsSync(manifestPath)).toBe(true);
    await original.stop(); const corrupt = Buffer.from('fixture corruption'); writeFileSync(original.path, corrupt);
    const recovery = await host({ dir: original.dir }); const newPath = join(original.dir, 'rebuilt.db');
    expect((await fetch(recovery.base + '/api/workspace')).status).toBe(503);
    const response = await request(recovery.base, '/api/workspace/rebuild', { manifestPath, newPath });
    expect(response.status).toBe(200); const rebuilt = await response.json() as WorkspaceSnapshot;
    expect(rebuilt.id).not.toBe(before.id); expect(rebuilt.notes).toEqual(before.notes); expect(rebuilt.attachments).toEqual(before.attachments);
    expect(readFileSync(original.path)).toEqual(corrupt);
    const asset = rebuilt.attachments[0]!; expect(Buffer.from(await (await fetch(recovery.base + `/api/assets/${asset.id}?workspace=${rebuilt.id}`)).arrayBuffer())).toEqual(png);
    expect((await fetch(recovery.base + `/api/assets/${asset.id}?workspace=${before.id}`)).status).toBe(409);
    const bytes = readFileSync(newPath); expect((await request(recovery.base, '/api/workspace/rebuild', { manifestPath, newPath })).status).toBe(409); expect(readFileSync(newPath)).toEqual(bytes);
  });

  it('keeps an old DB leased until an in-flight asynchronous export finishes reading attachment blobs', async () => {
    const h = await host(); await fetch(h.base + '/api/assets?name=pixel.png', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let blobRead = false;
    vi.spyOn(WorkspaceFiles.prototype, 'buildAiFolder').mockImplementationOnce(async function (snapshot, readBlob) {
      entered(); await gate; const bytes = await readBlob(snapshot.attachments[0]!.sha256); blobRead = bytes.length === png.length;
      return { path: 'exchange/outbox/test', absolutePath: 'unused', manifestPath: 'unused', indexPath: 'unused', files: 1, bytes: bytes.length };
    });
    const exporting = request(h.base, '/api/files/export'); await started;
    const switching = request(h.base, '/api/workspace/open', { path: join(h.dir, 'next.db'), create: true });
    await new Promise(resolve => setTimeout(resolve, 30)); release();
    const [exported, switched] = await Promise.all([exporting, switching]);
    expect(blobRead).toBe(true); expect(switched.status).toBe(200); expect([200, 409]).toContain(exported.status);
  });
});
