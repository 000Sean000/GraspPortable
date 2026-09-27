import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planVault, applyVault } from '../../server/migration';
import { testDirectory } from './fixtures';
const origin = 'http://127.0.0.1:43847';
const root = testDirectory('migration');
const sourceRoot = resolve(root, 'copied-source');
const database = resolve(root, 'migrated.grasp.db');
const original = '---\r\ntags: [sample]\r\n---\r\n# 圖片筆記\r\n\r\n![[pixel.png]]\r\n\r\n[[Target#Heading|Next topic]]\r\n\r\nEnd';
const target = '# Target\r\n\r\nBefore the heading.\r\n\r\n## Heading\r\n\r\nAfter the heading.';
let server: ChildProcess;
let noteId: string;
async function snapshot() { return (await fetch(origin + '/api/workspace')).json(); }
async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: '43847', GRASP_WORKSPACE: database }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; server.stdout!.on('data', b => log += b); server.stderr!.on('data', b => log += b);
  for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(log); try { if ((await fetch(origin + '/api/workspace')).ok) return; } catch {} await new Promise(r => setTimeout(r, 50)); }
  throw new Error(log);
}
async function stop() { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
test.beforeAll(async () => {
  mkdirSync(resolve(sourceRoot, 'Notes'), { recursive: true }); mkdirSync(resolve(sourceRoot, 'assets'));
  writeFileSync(resolve(sourceRoot, 'Notes/圖片筆記.md'), original); writeFileSync(resolve(sourceRoot, 'Notes/Target.md'), target);
  writeFileSync(resolve(sourceRoot, 'assets/pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCNkAAAAASUVORK5CYII=', 'base64'));
  const plan = await planVault(sourceRoot); const migrated = await applyVault(plan, database); noteId = migrated.snapshot.notes.find(n => n.title === '圖片筆記')!.id; await start();
});
test.afterAll(stop);
test('a copied CRLF vault keeps raw source through title edits, image preview, heading navigation and restart', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await expect(page.locator('#runtime-status')).toContainText('個值');
  await page.getByLabel('搜尋筆記', { exact: true }).fill('圖片筆記'); await page.locator(`.note-item[data-note-id="${noteId}"]`).click();
  await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('圖片筆記');
  await expect(page.locator('img[src*="/api/assets/"]')).toBeVisible();
  await page.getByLabel('筆記標題', { exact: true }).fill('圖片筆記 renamed'); await page.locator('#save').click();
  await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite'); expect((await snapshot()).notes.find((n: any) => n.id === noteId).markdown).toBe(original);
  await page.locator('#tab-links').click(); await page.getByRole('button', { name: '前往目標 ↗', exact: true }).click();
  await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('Target'); await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.insertText('## Replaced'); await page.locator('#save').click(); await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
  expect((await snapshot()).notes.find((n: any) => n.title === 'Target').markdown).toBe(target.replace('## Heading', '## Replaced'));
  await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+z'); await page.locator('#save').click(); await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
  expect((await snapshot()).notes.find((n: any) => n.title === 'Target').markdown).toBe(target);
  const saved = await snapshot(); await stop(); await start(); expect(await snapshot()).toEqual(saved);
  await page.reload(); await expect(page.locator('#runtime-status')).toContainText('個值');
  const exported = await (await fetch(origin + '/api/export')).text();
  await page.locator('#import').click(); await page.getByLabel('選取 Markdown 匯入檔案', { exact: true }).setInputFiles({ name: 'unchanged.grasp.md', mimeType: 'text/markdown', buffer: Buffer.from(exported) });
  await expect(page.getByLabel('匯入 Markdown', { exact: true })).toHaveValue(/grasp-workspace/);
  await page.getByRole('button', { name: '驗證並檢視差異', exact: true }).click(); await expect(page.locator('#modal-body')).toContainText('影響 0 份筆記');
  await page.locator('#modal-close').click();
  expect(readFileSync(resolve(sourceRoot, 'Notes/圖片筆記.md'), 'utf8')).toBe(original); expect(readFileSync(resolve(sourceRoot, 'Notes/Target.md'), 'utf8')).toBe(target);
  expect(errors).toEqual([]);
});
