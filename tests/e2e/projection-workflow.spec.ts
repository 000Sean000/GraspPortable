import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../../server/store';
import type { SharedStateResponse } from '../../server/semantic';
import type { ProjectionApiState } from '../../server/projection';
import type { FileExportResult } from '../../src/domain/files';
import { testDirectory } from './fixtures';

const port = 43854, origin = `http://127.0.0.1:${port}`;
const directory = testDirectory('projection-workflow');
let database = resolve(directory, 'original', '.grasp', 'workspace.grasp.db');
let server: ChildProcess;
const originalSource = '\ufeff# Daily\r\n\r\nBefore.\r\n@Fruit = <|Apple|>\r\nMiddle.\r\n@Person.Job = <|Private job detail|>\r\nAfter.\r\n\r\n[Apple](:ref:Fruit)\r\n';
async function state(): Promise<SharedStateResponse> { return (await fetch(origin + '/api/shared/state')).json(); }
async function projection(): Promise<ProjectionApiState> { return (await fetch(origin + '/api/projection/state')).json(); }
async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: database }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; server.stdout!.on('data', data => logs += data); server.stderr!.on('data', data => logs += data);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(origin + '/api/projection/state')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Projection startup timeout: ${logs}`);
}
async function stop() { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
async function group(page: Page, kind: string, label: string, path: string) {
  await page.getByRole('button', { name: '清除選取', exact: true }).click();
  await page.getByLabel(`選取 ${kind} ${label}`, { exact: true }).check();
  await page.getByLabel('輸出 Markdown 相對路徑').fill(path); await page.getByRole('button', { name: '預覽分組策略', exact: true }).click();
  await expect(page.locator('.gp-projection-review')).toContainText(path);
  await page.getByRole('button', { name: '確認保存分組策略', exact: true }).click();
  await expect(page.locator('.gp-projection-message')).toContainText('已保存');
}
function textTree(root: string): string {
  let text = '';
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    text += entry.isDirectory() ? textTree(path) : readFileSync(path, 'utf8');
  }
  return text;
}

test.describe.serial('M3 semantic grouping and portable fallback workflow', () => {
  test.beforeAll(async () => {
    mkdirSync(resolve(directory, 'original', '.grasp'), { recursive: true });
    const store = new WorkspaceStore(database, { create: true, name: 'Projection acceptance', seed: false });
    store.createNote('Daily', originalSource, null, 'grasp-v1'); store.close(); await start();
  });
  test.afterAll(stop);

  test('groups two definitions independently, preserves source ownership and exports only the selected unit', async ({ page }) => {
    await page.goto(origin); await expect(page.locator('#runtime-status')).toContainText('個值');
    const before = await state(); await page.locator('#projection').click();
    await group(page, '共享定義', 'Fruit', 'Food/Fruit.md');
    await group(page, '共享定義', 'Person.Job', 'People/Jobs.md');
    await group(page, '筆記正文', 'Daily', 'Notes/Daily.md');
    await page.getByRole('button', { name: '建立完整 checkpoint', exact: true }).click();
    await expect(page.locator('.gp-projection-panel')).toContainText('已發布');
    const plan = await projection(), after = await state();
    expect(after.snapshot.notes).toEqual(before.snapshot.notes);
    expect(after.semantic.bindings.map(item => [item.id, item.identifierId, item.owner])).toEqual(before.semantic.bindings.map(item => [item.id, item.identifierId, item.owner]));
    for (const path of ['Food/Fruit.md', 'People/Jobs.md', 'Notes/Daily.md']) expect(existsSync(resolve(plan.status.projectionRoot, path))).toBe(true);
    expect(readFileSync(resolve(plan.status.projectionRoot, 'Food/Fruit.md'), 'utf8')).toContain('Apple');
    expect(readFileSync(resolve(plan.status.projectionRoot, 'Food/Fruit.md'), 'utf8')).not.toContain('Private job detail');
    expect(readFileSync(resolve(plan.status.projectionRoot, 'Notes/Daily.md'), 'utf8')).not.toContain('@Person.Job =');
    await page.getByRole('button', { name: '清除選取', exact: true }).click(); await page.getByLabel('選取 共享定義 Fruit', { exact: true }).check();
    const exporting = page.waitForResponse(response => response.url().endsWith('/api/projection/export'));
    await page.getByRole('button', { name: '匯出選取 Markdown', exact: true }).click();
    const exported = await (await exporting).json() as FileExportResult;
    expect(textTree(exported.absolutePath)).not.toContain('Private job detail');
    expect(textTree(exported.absolutePath)).not.toContain('Before.');
    await expect(page.locator('.gp-projection-panel')).toContainText(exported.absolutePath);
    await page.screenshot({ path: resolve(directory, 'strategy-review.png'), fullPage: true });
  });

  test('reviews a grouped canonical binding, blocks cache-only edits and preserves owner identity', async ({ page }) => {
    await page.goto(origin); await expect(page.locator('#runtime-status')).toContainText('個值');
    const before = await state(), projected = await projection();
    const file = resolve(projected.status.projectionRoot, 'Food/Fruit.md'), baseline = readFileSync(file, 'utf8');
    const changed = baseline.replace('@Fruit = <|Apple|>', '@Fruit = <|Pear|>');
    expect(changed).not.toBe(baseline); writeFileSync(file, changed, 'utf8');
    expect((await state()).snapshot.notes).toEqual(before.snapshot.notes);
    await page.locator('#files').click(); await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click();
    await expect(page.locator('.gp-files-mirror')).toContainText('有外部變更待審查');
    const row = page.locator('.gp-files-dirty-row').filter({ hasText: 'Food' });
    await row.getByRole('button', { name: '審查外部修改', exact: true }).click();
    await expect(page.locator('.diff-after')).toContainText('@Fruit = <|Pear|>');
    expect((await state()).snapshot.notes).toEqual(before.snapshot.notes);
    await page.getByRole('button', { name: '確認套用至資料庫', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    const after = await state();
    const originalNote = before.snapshot.notes.find(note => note.title === 'Daily')!;
    expect(after.snapshot.notes.find(note => note.id === originalNote.id)?.markdown).toBe(originalNote.markdown.replace('@Fruit = <|Apple|>', '@Fruit = <|Pear|>').replace('[Apple](:ref:Fruit)', '[Pear](:ref:Fruit)'));
    expect(after.semantic.bindings.map(binding => [binding.id, binding.identifierId, binding.owner])).toEqual(before.semantic.bindings.map(binding => [binding.id, binding.identifierId, binding.owner]));
    await page.locator('#files').click(); await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click(); await expect(page.locator('.gp-files-mirror')).toContainText('已更新');
    const approved = readFileSync(file, 'utf8');
    const cacheOnly = approved.replace('> Pear', '> Unapproved observation'); expect(cacheOnly).not.toBe(approved); writeFileSync(file, cacheOnly, 'utf8');
    await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click();
    await page.locator('.gp-files-dirty-row').filter({ hasText: 'Food' }).getByRole('button', { name: '審查外部修改', exact: true }).click();
    await expect(page.getByRole('button', { name: '確認套用至資料庫', exact: true })).toBeDisabled();
    expect((await state()).snapshot.notes).toEqual(after.snapshot.notes);
    // Restore this synthetic external observation to its exact approved baseline.
    writeFileSync(file, approved, 'utf8');
  });

  test('rejects a stale reviewed strategy and reconstructs a fresh DB with identities and exact current source', async ({ page }) => {
    await page.goto(origin); await expect(page.locator('#runtime-status')).toContainText('個值'); await page.locator('#projection').click();
    await page.getByLabel('選取 共享定義 Fruit', { exact: true }).check(); await page.getByLabel('輸出 Markdown 相對路徑').fill('Food/Moved.md');
    await page.getByRole('button', { name: '預覽分組策略', exact: true }).click(); await expect(page.locator('.gp-projection-review')).toBeVisible();
    const adding = await fetch(origin + '/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Later', markdown: 'Later data', syntaxVersion: 'grasp-v1' }) }); expect(adding.ok).toBe(true);
    await page.getByRole('button', { name: '確認保存分組策略', exact: true }).click(); await expect(page.locator('.gp-projection-panel [role=alert]')).toBeVisible();
    expect((await projection()).strategy.groups.some(group => group.path === 'Food/Moved.md')).toBe(false);
    await page.getByRole('button', { name: '建立完整 checkpoint', exact: true }).click();
    const current = await projection(); expect(current.status.state).toBe('ready');
    const before = await state(), strategyBefore = current.strategy;
    expect(current.status.manifestPath).toBeTruthy();
    await page.locator('#modal-close').click(); await page.locator('#workspace-open').click(); await page.getByText('從 Markdown 投影重建到新的資料庫', { exact: true }).click();
    database = resolve(directory, 'rebuilt', '.grasp', 'workspace.grasp.db');
    await page.getByLabel('重建 manifest 路徑', { exact: true }).fill(current.status.manifestPath!);
    await page.getByLabel('重建的新資料庫路徑', { exact: true }).fill(database); await page.getByRole('button', { name: '驗證並重建新 workspace', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible();
    const rebuilt = await state(); expect(rebuilt.snapshot.id).not.toBe(before.snapshot.id);
    expect(rebuilt.snapshot.notes).toEqual(before.snapshot.notes);
    expect(rebuilt.semantic.identifiers).toEqual(before.semantic.identifiers); expect(rebuilt.semantic.bindings).toEqual(before.semantic.bindings);
    expect(rebuilt.semantic.occurrences).toEqual(before.semantic.occurrences); expect(rebuilt.semantic.results).toEqual(before.semantic.results);
    expect((await projection()).strategy.groups).toEqual(strategyBefore.groups);
    await stop(); await start(); expect(await state()).toEqual(rebuilt);
    await page.reload(); await expect(page.locator('#runtime-status')).toContainText('個值');
  });

  test('a delayed strategy response cannot replace a different workspace after the panel is closed', async ({ page }) => {
    await page.goto(origin); await expect(page.locator('#runtime-status')).toContainText('個值'); await page.locator('#projection').click();
    await page.getByLabel('選取 共享定義 Fruit', { exact: true }).check(); await page.getByLabel('輸出 Markdown 相對路徑').fill('Food/Delayed.md');
    await page.getByRole('button', { name: '預覽分組策略', exact: true }).click();
    let release!: () => void, committed!: () => void;
    const held = new Promise<void>(resolve => release = resolve), seen = new Promise<void>(resolve => committed = resolve);
    await page.route('**/api/projection/strategy/apply', async route => {
      const response = await route.fetch(); committed(); await held; await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '確認保存分組策略', exact: true }).click(); await seen;
    await page.locator('#modal-close').click(); await page.locator('#workspace-open').click();
    await page.getByLabel('資料庫路徑', { exact: true }).fill(resolve(directory, 'other', '.grasp', 'workspace.grasp.db'));
    await page.getByLabel('新 workspace 名稱', { exact: true }).fill('Other workspace');
    await page.getByRole('button', { name: '建立新 workspace', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    const other = await state(); await page.locator('#projection').click();
    await expect(page.locator('.gp-projection-panel')).toBeVisible(); release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(page.locator('#workspace-name')).toHaveText('Other workspace');
    await expect(page.getByLabel('選取 共享定義 Fruit', { exact: true })).toHaveCount(0);
    expect((await state()).snapshot.id).toBe(other.snapshot.id);
  });
});
