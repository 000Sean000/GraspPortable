import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FileEntry, FilesStatus } from '../../src/domain/files';
import type { WorkspaceSnapshot } from '../../src/domain/model';

const origin = 'http://127.0.0.1:43845';
const folder = resolve('.cache/files-e2e', `${Date.now()}-${process.pid}`);
let database = resolve(folder, 'files.grasp.db');
let server: ChildProcess;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCNkAAAAASUVORK5CYII=', 'base64');
async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: '43845', GRASP_WORKSPACE: database }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; server.stdout!.on('data', b => log += b); server.stderr!.on('data', b => log += b);
  for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(log); try { if ((await fetch(origin + '/api/workspace')).ok) return; } catch {} await new Promise(r => setTimeout(r, 50)); }
  throw new Error(log);
}
async function stop() { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
async function snapshot(): Promise<WorkspaceSnapshot> { return (await fetch(origin + '/api/workspace')).json(); }
async function filesStatus(): Promise<FilesStatus> { return (await fetch(origin + '/api/files/status')).json(); }
async function post(path: string, body: unknown) {
  return fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Grasp-Workspace': (await snapshot()).id }, body: JSON.stringify(body) });
}
async function saved(page: Page) { await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite'); await expect(page.locator('#runtime-status')).toContainText('個值'); }
async function source(page: Page, text: string) {
  if (await page.locator('#mode').innerText() === 'Live Preview') await page.locator('#mode').click();
  await page.locator('.cm-content').click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(text); await page.locator('#save').click(); await saved(page);
}

test.describe.serial('one readable projection, attachment authority, and reviewed external edits', () => {
  test.beforeAll(async () => { mkdirSync(folder, { recursive: true }); await start(); });
  test.afterAll(stop);
  test('uploads assets, inserts an image, and reviews an inbox return into the same Markdown projection', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await saved(page);
    await source(page, '# File workflow\n\n@name = "Before AI"\n\n{{name}}\n\nEnd');
    await page.locator('#files').click(); await expect(page.locator('.gp-files-panel')).toBeVisible();
    await page.getByLabel('加入 Markdown 或附件（可多選）').setInputFiles([{ name: 'pixel.png', mimeType: 'image/png', buffer: png }, { name: 'guide.txt', mimeType: 'text/plain', buffer: Buffer.from('Attachment text') }]);
    await expect(page.locator('.gp-file-row[data-attachment-id]')).toHaveCount(2);
    const asset = (await snapshot()).attachments.find(a => a.name === 'pixel.png')!; expect(asset.size).toBe(png.length);
    await page.getByRole('button', { name: '插入圖片', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    await page.locator('#save').click(); await saved(page);
    expect((await snapshot()).notes[0].markdown).toContain(`grasp-asset:${asset.id}`);
    await source(page, `# Files\n\n@name = "Before AI"\n\n![pixel](grasp-asset:${asset.id})\n\n{{name}}\n\nEnd`);
    await page.locator('#mode').click(); await expect(page.locator(`img[src*="${asset.id}"]`)).toBeVisible();
    expect(await page.locator(`img[src*="${asset.id}"]`).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    const downloaded = page.waitForEvent('download'); await page.locator('#export').click();
    const exported = readFileSync((await (await downloaded).path())!, 'utf8'); expect(exported).toContain('grasp-workspace');
    const outbox: FileEntry[] = await (await fetch(origin + '/api/files?path=.grasp/exchange/outbox')).json();
    expect(outbox.length).toBeGreaterThan(0); expect(existsSync(outbox[0].absolutePath)).toBe(true);
    await page.locator('#files').click(); await page.getByText('貼上 AI 回傳的 Markdown', { exact: true }).click();
    await page.getByLabel('AI 回傳 Markdown', { exact: true }).fill(exported.replace('Before AI', 'After AI'));
    await page.getByRole('button', { name: '保存並審查匯入', exact: true }).click();
    await expect(page.locator('#modal-title')).toHaveText('審查匯入計畫'); expect((await snapshot()).notes[0].markdown).toContain('Before AI');
    await page.getByRole('button', { name: '確認套用至資料庫', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    await expect(page.locator('.gp-value-text').filter({ hasText: 'After AI' }).last()).toBeVisible();
    const after = await snapshot(); expect(after.attachments).toHaveLength(2);
    await page.locator('#files').click(); await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click();
    await expect(page.locator('.gp-files-mirror')).toContainText('已更新');
    const status = await filesStatus();
    expect(status.projection.path).toBe('Markdown'); expect(status.directories.mirror).toBe(resolve(status.root, 'Markdown'));
    expect(status.mirror.manifestPath).toMatch(/^\.grasp\/manifests\//);
    const projected = status.projection.notes.find(note => note.id === after.notes[0].id)!;
    expect(readFileSync(resolve(status.root, projected.path), 'utf8')).toBe(after.notes[0].markdown);
    await expect(page.getByRole('button', { name: '建立給 AI 的資料夾匯出', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('external edits block publication and rebuild until reviewed, then survive a real restart', async ({ page }) => {
    await page.goto(origin); await saved(page); const before = await snapshot(), original = before.notes[0];
    await page.locator('#files').click(); await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click();
    await expect(page.locator('.gp-files-mirror')).toContainText('已更新');
    const clean = await filesStatus(), oldManifest = resolve(clean.root, clean.mirror.manifestPath!);
    const relative = clean.projection.notes.find(note => note.id === original.id)!.path;
    const editedPath = resolve(clean.root, relative), editedSource = original.markdown.replace('After AI', 'Reviewed external AI');
    expect(editedSource).not.toBe(original.markdown); writeFileSync(editedPath, editedSource, 'utf8');
    expect((await snapshot()).notes).toEqual(before.notes);
    await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click();
    await expect(page.locator('.gp-files-mirror')).toContainText('有外部變更待審查');
    const dirty = await filesStatus();
    expect(dirty.mirror.state).toBe('dirty'); expect(dirty.mirror.dirtyPaths).toContain(relative);
    expect(dirty.mirror.manifestPath).toBe(clean.mirror.manifestPath); expect(readFileSync(editedPath, 'utf8')).toBe(editedSource);
    const blockedPath = resolve(folder, 'must-not-rebuild-dirty.grasp.db');
    const blocked = await post('/api/workspace/rebuild', { manifestPath: oldManifest, newPath: blockedPath });
    expect(blocked.ok).toBe(false); expect(existsSync(blockedPath)).toBe(false); expect((await snapshot()).notes).toEqual(before.notes);
    const reviewResponse = page.waitForResponse(response => response.url().endsWith('/api/files/external/plan'));
    await page.locator('.gp-files-dirty-row').getByRole('button', { name: '審查外部修改', exact: true }).click();
    const plan = await (await reviewResponse).json(); expect(plan.canApply).toBe(true);
    expect(plan.changes.filter((change: { kind: string }) => change.kind === 'update').map((change: { id: string }) => change.id)).toEqual([original.id]);
    await expect(page.locator('#modal-title')).toHaveText('審查匯入計畫'); expect((await snapshot()).notes).toEqual(before.notes);
    await page.getByRole('button', { name: '確認套用至資料庫', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    await expect(page.locator('.gp-value-text').filter({ hasText: 'Reviewed external AI' }).last()).toBeVisible();
    const approved = await snapshot(); expect(approved.notes).toHaveLength(before.notes.length);
    expect(approved.notes.find(note => note.id === original.id)?.markdown).toBe(editedSource); expect(approved.attachments).toEqual(before.attachments);
    await page.locator('#files').click(); await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click();
    await expect(page.locator('.gp-files-mirror')).toContainText('已更新');
    const status = await filesStatus(); expect(status.mirror.dirtyPaths).toEqual([]); expect(readFileSync(editedPath, 'utf8')).toBe(editedSource);
    const manifest = resolve(status.root, status.mirror.manifestPath!);
    const envelope = JSON.parse(readFileSync(manifest, 'utf8'));
    expect(envelope.payload.notes.every((note: { file: string }) => note.file.startsWith('Markdown/'))).toBe(true);
    await page.locator('#modal-close').click(); await page.locator('#workspace-open').click();
    await page.getByText('從 Markdown 投影重建到新的資料庫', { exact: true }).click();
    database = resolve(folder, 'rebuilt.grasp.db');
    await page.getByLabel('重建 manifest 路徑', { exact: true }).fill(manifest); await page.getByLabel('重建的新資料庫路徑', { exact: true }).fill(database);
    await page.getByRole('button', { name: '驗證並重建新 workspace', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    const rebuilt = await snapshot(); expect(rebuilt.id).not.toBe(approved.id); expect(rebuilt.notes).toEqual(approved.notes); expect(rebuilt.attachments).toEqual(approved.attachments);
    for (const asset of rebuilt.attachments) { const body = Buffer.from(await (await fetch(`${origin}/api/assets/${asset.id}?workspace=${rebuilt.id}`)).arrayBuffer()); if (asset.name === 'pixel.png') expect(body).toEqual(png); }
    expect((await fetch(`${origin}/api/assets/${rebuilt.attachments[0].id}?workspace=${before.id}`)).status).toBe(409);
    await stop(); await start(); expect(await snapshot()).toEqual(rebuilt);
    await page.goto(origin); await saved(page); await expect(page.locator('img[src*="/api/assets/"]')).toBeVisible();
    expect(readFileSync(editedPath, 'utf8')).toBe(editedSource);
  });

  test('note and folder Explorer actions resolve the current physical hierarchy without launching Explorer', async ({ page }) => {
    await page.goto(origin); await saved(page);
    await page.getByRole('button', { name: '新增資料夾', exact: true }).click();
    await page.getByRole('textbox', { name: '新增資料夾', exact: true }).fill('Explorer folder');
    await page.locator('.gp-nav-dialog').getByRole('button', { name: '儲存', exact: true }).click();
    await page.getByRole('button', { name: '開啟資料夾 Explorer folder', exact: true }).click(); await page.locator('#new-note').click();
    await page.getByLabel('筆記標題', { exact: true }).fill('Explorer note'); await source(page, '# Physical note\n\nPending draft is flushed.');
    const initial = await snapshot(), note = initial.notes.find(note => note.title === 'Explorer note')!, noteFolder = initial.folders.find(folder => folder.id === note.folderId)!;
    const revealed: string[] = [], opened: string[] = [];
    await page.route('**/api/files/reveal', route => { const path = route.request().postDataJSON().path; revealed.push(path); return route.fulfill({ json: { path } }); });
    await page.route('**/api/files/open-folder', route => { const path = route.request().postDataJSON().path; opened.push(path); return route.fulfill({ json: { path } }); });
    // The real locate route publishes and resolves current IDs. Only the OS-launch
    // routes are intercepted so automation never opens a desktop window.
    await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\nUncommitted before reveal');
    const noteLocation = page.waitForResponse(response => response.url().endsWith('/api/files/locate'));
    await page.locator('#reveal-note').click(); const locatedNote: FileEntry = await (await noteLocation).json();
    await expect.poll(() => revealed).toEqual(['Markdown/Explorer folder/Explorer note.md']);
    expect(locatedNote.path).toBe(revealed[0]); expect(readFileSync(locatedNote.absolutePath, 'utf8')).toContain('Uncommitted before reveal');
    expect((await snapshot()).notes.find(current => current.id === note.id)?.markdown).toBe(readFileSync(locatedNote.absolutePath, 'utf8'));
    const folderLocation = page.waitForResponse(response => response.url().endsWith('/api/files/locate'));
    await page.locator('#open-note-folder').click(); const locatedFolder: FileEntry = await (await folderLocation).json();
    await expect.poll(() => opened).toEqual(['Markdown/Explorer folder']);
    expect(locatedFolder.kind).toBe('directory'); expect(locatedFolder.path).toBe(opened[0]); expect(existsSync(locatedFolder.absolutePath)).toBe(true);
    const status = await filesStatus(); expect(status.projection.folders.find(folder => folder.id === noteFolder.id)?.path).toBe(locatedFolder.path);
  });
});
