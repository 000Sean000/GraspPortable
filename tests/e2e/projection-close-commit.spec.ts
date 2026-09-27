import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SharedStateResponse } from '../../server/semantic';
import type { ProjectionApiState } from '../../server/projection';
import type { WorkspaceSnapshot } from '../../src/domain/model';
import { testDirectory } from './fixtures';

const port = 43865, origin = `http://127.0.0.1:${port}`;
const directory = testDirectory('projection-close-commit');
let server: ChildProcess;
let workspaceSequence = 0;

async function state(): Promise<SharedStateResponse> { return (await fetch(origin + '/api/shared/state')).json(); }
async function projection(): Promise<ProjectionApiState> { return (await fetch(origin + '/api/projection/state')).json(); }

async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: resolve(directory, 'host', '.grasp', 'workspace.grasp.db') }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; server.stdout!.on('data', data => logs += data); server.stderr!.on('data', data => logs += data);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(origin + '/api/host')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Projection host startup timeout: ${logs}`);
}

async function stop() { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }

async function createWorkspace(name: string): Promise<WorkspaceSnapshot> {
  const path = resolve(directory, `workspace-${++workspaceSequence}`, '.grasp', 'workspace.grasp.db');
  mkdirSync(dirname(path), { recursive: true });
  const opened = await fetch(origin + '/api/workspace/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, create: true, name }) });
  if (!opened.ok) throw new Error(await opened.text());
  const created = await opened.json() as WorkspaceSnapshot;
  const response = await fetch(origin + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Grasp-Workspace': created.id }, body: JSON.stringify({ title: 'Daily', markdown: '# Daily\n\n@Fruit = <|Apple|>\n\n[Apple](:ref:Fruit)', syntaxVersion: 'grasp-v1' }) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<WorkspaceSnapshot>;
}

async function holdStrategyApply(page: Page) {
  let release!: () => void, committed!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const reachedHost = new Promise<void>(resolve => { committed = resolve; });
  await page.route('**/api/projection/strategy/apply', async route => {
    const response = await route.fetch();
    committed();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '確認保存分組策略', exact: true }).click();
  await reachedHost;
  return { release };
}

async function prepareStrategy(page: Page, path: string) {
  await page.goto(origin); await expect(page.locator('#runtime-status')).toContainText('個值');
  await page.locator('#projection').click();
  await page.getByLabel('選取 共享定義 Fruit', { exact: true }).check();
  await page.getByLabel('輸出 Markdown 相對路徑').fill(path);
  await page.getByRole('button', { name: '預覽分組策略', exact: true }).click();
  await expect(page.locator('.gp-projection-review')).toContainText(path);
}

test.describe.serial('late strategy commit after the projection panel closes', () => {
  test.beforeAll(start);
  test.afterAll(stop);

  test('keeps the committed strategy visible after closing and reopening the panel', async ({ page }) => {
    await createWorkspace('Close-safe strategy');
    await prepareStrategy(page, 'Food/Fruit.md');
    const response = page.waitForResponse(item => item.url().endsWith('/api/projection/strategy/apply'));
    const held = await holdStrategyApply(page);
    const committed = await projection();
    expect(committed.strategy.groups.some(group => group.path === 'Food/Fruit.md')).toBe(true);
    await page.locator('#modal-close').click();
    try {
      held.release(); await (await response).finished(); await page.unrouteAll({ behavior: 'wait' });
      await page.locator('#projection').click();
      await expect(page.locator('.gp-projection-panel')).toContainText('Food/Fruit.md');
      await expect(page.locator('.gp-projection-panel')).toContainText(`目前分組策略 · 修訂 ${committed.strategy.revision}`);
    } finally { held.release(); }
  });

  test('ignores the late old-workspace snapshot after switching databases', async ({ page }) => {
    await createWorkspace('Original workspace');
    await prepareStrategy(page, 'Food/Old-workspace.md');
    const response = page.waitForResponse(item => item.url().endsWith('/api/projection/strategy/apply'));
    const held = await holdStrategyApply(page);
    expect((await projection()).strategy.groups.some(group => group.path === 'Food/Old-workspace.md')).toBe(true);
    await page.locator('#modal-close').click(); await page.locator('#workspace-open').click();
    await page.getByLabel('資料庫路徑', { exact: true }).fill(resolve(directory, 'switched', '.grasp', 'workspace.grasp.db'));
    await page.getByLabel('新 workspace 名稱', { exact: true }).fill('Switched workspace');
    await page.getByRole('button', { name: '建立新 workspace', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    const switched = await state(), switchedProjection = await projection();
    try {
      await page.locator('#projection').click();
      await expect(page.locator('.gp-projection-panel')).toContainText(`目前分組策略 · 修訂 ${switchedProjection.strategy.revision}`);
      await expect(page.locator('.gp-projection-panel')).not.toContainText('Food/Old-workspace.md');
      held.release(); await (await response).finished(); await page.unrouteAll({ behavior: 'wait' });
      await expect(page.locator('#workspace-name')).toHaveText('Switched workspace');
      await expect(page.locator('.gp-projection-panel')).not.toContainText('Food/Old-workspace.md');
      expect((await state()).snapshot.id).toBe(switched.snapshot.id);
      expect((await projection()).strategy).toEqual(switchedProjection.strategy);
    } finally { held.release(); }
  });
});
