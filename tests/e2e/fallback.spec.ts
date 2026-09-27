import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = 'http://127.0.0.1:43844';
const folder = resolve('.cache/fallback-e2e', `${Date.now()}-${process.pid}`);
const broken = resolve(folder, 'damaged.grasp.db');
const bytes = Buffer.from('Synthetic damaged database. Preserve these exact bytes.');
let server: ChildProcess;
test.beforeAll(async () => {
  mkdirSync(folder, { recursive: true }); writeFileSync(broken, bytes);
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: '43844', GRASP_WORKSPACE: broken }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; server.stdout!.on('data', b => log += b); server.stderr!.on('data', b => log += b);
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(log);
    try { if ((await fetch(origin + '/api/host')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(log);
});
test.afterAll(async () => { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } });

test('a damaged DB leaves the launcher and recovery UI usable without modifying its source', async ({ page }) => {
  expect((await fetch(origin + '/api/workspace')).status).toBe(503);
  const launcher = spawn(process.execPath, ['scripts/launch.mjs'], { env: { ...process.env, PORT: '43844', GRASP_NO_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; launcher.stdout!.on('data', b => log += b); launcher.stderr!.on('data', b => log += b);
  const [code] = await once(launcher, 'exit'); expect(code).toBe(0); expect(log).toContain('already running');
  await page.goto(origin); await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#modal-body')).toContainText(broken);
  expect(readFileSync(broken)).toEqual(bytes);
  await page.getByLabel('資料庫路徑', { exact: true }).fill(resolve(folder, 'fresh.grasp.db'));
  await page.getByLabel('新 workspace 名稱', { exact: true }).fill('從錯誤中繼續');
  await page.getByRole('button', { name: '建立新 workspace', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible(); await expect(page.locator('#workspace-name')).toHaveText('從錯誤中繼續');
  await expect(page.locator('#save')).toBeEnabled(); await expect(page.locator('#runtime-status')).toContainText('個值');
  expect(readFileSync(broken)).toEqual(bytes);
  await page.getByLabel('筆記標題', { exact: true }).fill('可以繼續寫作'); await page.locator('#save').click();
  await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
  const snapshot = await (await fetch(origin + '/api/workspace')).json(); expect(snapshot.notes[0].title).toBe('可以繼續寫作');
});
