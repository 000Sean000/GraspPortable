import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
async function snapshot() { return (await fetch(origin + '/api/workspace')).json(); }
async function saved(page: Page) { await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite'); await expect(page.locator('#runtime-status')).toContainText('個值'); }
async function source(page: Page, text: string) {
  if (await page.locator('#mode').innerText() === 'Live Preview') await page.locator('#mode').click();
  await page.locator('.cm-content').click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(text); await page.locator('#save').click(); await saved(page);
}

test.describe.serial('visible files, attachment authority, mirror fallback', () => {
  test.beforeAll(async () => { mkdirSync(folder, { recursive: true }); await start(); });
  test.afterAll(stop);
  test('upload assets, insert image, outbox download, inbox review and AI folder export', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await saved(page);
    await source(page, '# File workflow\n\n@name = "Before AI"\n\n{{name}}\n\nEnd');
    await page.locator('#files').click(); await expect(page.locator('.gp-files-panel')).toBeVisible();
    await page.getByLabel('加入 Markdown 或附件（可多選）').setInputFiles([{ name: 'pixel.png', mimeType: 'image/png', buffer: png }, { name: 'guide.txt', mimeType: 'text/plain', buffer: Buffer.from('Attachment text') }]);
    await expect(page.locator('.gp-file-row[data-attachment-id]')).toHaveCount(2);
    const asset = (await snapshot()).attachments.find((a: any) => a.name === 'pixel.png'); expect(asset.size).toBe(png.length);
    await page.getByRole('button', { name: '插入圖片', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    await page.locator('#save').click(); await saved(page);
    expect((await snapshot()).notes[0].markdown).toContain(`grasp-asset:${asset.id}`);
    await source(page, `# Files\n\n@name = "Before AI"\n\n![pixel](grasp-asset:${asset.id})\n\n{{name}}\n\nEnd`);
    await page.locator('#mode').click(); await expect(page.locator(`img[src*="${asset.id}"]`)).toBeVisible();
    expect(await page.locator(`img[src*="${asset.id}"]`).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    const downloaded = page.waitForEvent('download'); await page.locator('#export').click();
    const exported = readFileSync((await (await downloaded).path())!, 'utf8'); expect(exported).toContain('grasp-workspace');
    const outbox = await (await fetch(origin + '/api/files?path=exchange/outbox')).json(); expect(outbox.length).toBeGreaterThan(0); expect(existsSync(outbox[0].absolutePath)).toBe(true);
    await page.locator('#files').click(); await page.getByText('貼上 AI 回傳的 Markdown', { exact: true }).click();
    await page.getByLabel('AI 回傳 Markdown', { exact: true }).fill(exported.replace('Before AI', 'After AI'));
    await page.getByRole('button', { name: '保存並審查匯入', exact: true }).click();
    await expect(page.locator('#modal-title')).toHaveText('審查匯入計畫'); expect((await snapshot()).notes[0].markdown).toContain('Before AI');
    await page.getByRole('button', { name: '確認套用至資料庫', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    await expect(page.locator('.gp-value-text').filter({ hasText: 'After AI' }).last()).toBeVisible();
    const after = await snapshot(); expect(after.attachments).toHaveLength(2);
    await page.locator('#files').click(); await page.getByRole('button', { name: '建立給 AI 的資料夾匯出', exact: true }).click();
    await expect(page.getByRole('button', { name: '開啟剛匯出的資料夾', exact: true })).toBeVisible();
    const entries = await (await fetch(origin + '/api/files?path=exchange/outbox')).json(); const directory = entries.find((e: any) => e.kind === 'directory'); expect(directory).toBeDefined();
    expect(existsSync(resolve(directory.absolutePath, 'README.md'))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('external mirror edits never change DB, repair preserves edits, rebuild survives real restart', async ({ page }) => {
    await page.goto(origin); await saved(page); const before = await snapshot();
    await page.locator('#files').click(); await page.getByRole('button', { name: '重新建立／重試鏡像', exact: true }).click();
    await expect(page.locator('.gp-files-mirror')).toContainText('已更新');
    let status = await (await fetch(origin + '/api/files/status')).json();
    const envelope = JSON.parse(readFileSync(resolve(status.root, status.mirror.manifestPath), 'utf8'));
    const editedPath = resolve(status.root, envelope.payload.notes[0].file); writeFileSync(editedPath, 'External AI edit — not canonical');
    expect((await snapshot()).notes).toEqual(before.notes);
    await page.getByRole('button', { name: '重新建立／重試鏡像', exact: true }).click();
    await expect(page.locator('.gp-files-mirror')).toContainText('外部變更');
    expect(readFileSync(editedPath, 'utf8')).toBe('External AI edit — not canonical');
    status = await (await fetch(origin + '/api/files/status')).json(); const manifest = resolve(status.root, status.mirror.manifestPath);
    await page.locator('#modal-close').click(); await page.locator('#workspace-open').click();
    await page.getByText('從 Markdown mirror 重建到新的資料庫', { exact: true }).click();
    database = resolve(folder, 'rebuilt.grasp.db');
    await page.getByLabel('Mirror manifest 路徑', { exact: true }).fill(manifest); await page.getByLabel('重建的新資料庫路徑', { exact: true }).fill(database);
    await page.getByRole('button', { name: '驗證並重建新 workspace', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    const rebuilt = await snapshot(); expect(rebuilt.id).not.toBe(before.id); expect(rebuilt.notes).toEqual(before.notes); expect(rebuilt.attachments).toEqual(before.attachments);
    for (const asset of rebuilt.attachments) { const body = Buffer.from(await (await fetch(`${origin}/api/assets/${asset.id}?workspace=${rebuilt.id}`)).arrayBuffer()); if (asset.name === 'pixel.png') expect(body).toEqual(png); }
    expect((await fetch(`${origin}/api/assets/${rebuilt.attachments[0].id}?workspace=${before.id}`)).status).toBe(409);
    await stop(); await start(); expect(await snapshot()).toEqual(rebuilt);
    await page.goto(origin); await saved(page); await expect(page.locator('img[src*="/api/assets/"]')).toBeVisible();
    expect(readFileSync(editedPath, 'utf8')).toBe('External AI edit — not canonical');
  });
});
