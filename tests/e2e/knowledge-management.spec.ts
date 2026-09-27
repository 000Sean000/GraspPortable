import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../../server/store';
import type { WorkspaceSnapshot } from '../../src/domain/model';

const origin = 'http://127.0.0.1:43843';
const directory = resolve('.cache/knowledge-e2e', `${Date.now()}-${process.pid}`);
const database = resolve(directory, 'knowledge.grasp.db');
let server: ChildProcess;
async function snapshot(): Promise<WorkspaceSnapshot> { return (await fetch(origin + '/api/workspace')).json(); }
async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: '43843', GRASP_WORKSPACE: database }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; server.stdout!.on('data', data => log += data); server.stderr!.on('data', data => log += data);
  for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(log); try { if ((await fetch(origin + '/api/workspace')).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Knowledge host failed: ${log}`);
}
async function stop() { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
async function ready(page: Page) { await expect(page.locator('#runtime-status')).toContainText('個值'); await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite'); }
async function previewRename(page: Page, target: string) { await page.getByLabel('新 identifier 或 Namespace').fill(target); await page.getByRole('button', { name: '預覽重新命名', exact: true }).click(); await expect(page.locator('#modal-title')).toHaveText('審查重新命名'); await expect(page.getByRole('button', { name: '確認重新命名', exact: true })).toBeEnabled(); }
async function applyRename(page: Page) { await page.getByRole('button', { name: '確認重新命名', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible(); await expect(page.locator('#runtime-status')).toContainText('個值'); }

test.describe.serial('production knowledge management', () => {
  test.beforeAll(async () => {
    mkdirSync(directory, { recursive: true });
    const store = new WorkspaceStore(database, { create: true, name: 'Knowledge management', seed: false });
    const records = Array.from({ length: 500 }, (_, i) => ({ id: `record-${i}`, collection: 'aura', name: `item${String(i).padStart(4, '0')}`, fields: { label: '{name}', element: i % 2 ? 'fire' : 'water' }, revision: 0 }));
    store.applyImport({ records, notes: [{ id: 'knowledge', folderId: null, title: 'Knowledge source', markdown: '# Knowledge\n\n@name = "Sean"\n@full = "{name} User"\n\nHello {{full}}. Late record: {{aura.item0499.label}}.\n\nLiteral code: `{{name}}`.\n' }] }, store.snapshot().revision);
    store.updateSettings({ activeNoteId: 'knowledge', mode: 'live' }); store.close(); await start();
  });
  test.afterAll(stop);

  test('searches and edits a late record, opens table rows and all filtered results', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await ready(page); await page.locator('#tab-records').click();
    expect(await page.locator('.record-card').count()).toBe(40);
    await page.getByLabel('搜尋 records', { exact: true }).fill('item0499'); await expect(page.locator('.record-card')).toHaveCount(1);
    await page.locator('.record-card').getByRole('button', { name: '編輯', exact: true }).click();
    await expect(page.getByLabel('Collection', { exact: true })).toHaveAttribute('readonly', ''); await expect(page.getByLabel('Record 名稱', { exact: true })).toHaveAttribute('readonly', '');
    await page.getByLabel('欄位值', { exact: true }).nth(0).fill('{name} updated');
    await page.getByRole('button', { name: '儲存 record', exact: true }).click(); await expect(page.locator('.record-card')).toContainText('Sean updated');
    expect((await snapshot()).records.find(record => record.id === 'record-499')!.fields.label).toBe('{name} updated');
    await page.getByRole('button', { name: '建立 table 筆記', exact: true }).click(); await ready(page);
    await expect(page.locator('.gp-query tbody tr')).toHaveCount(200); await expect(page.locator('.gp-query-header')).toContainText('500 筆');
    await page.getByRole('button', { name: '開啟資料 item0000', exact: true }).click();
    await expect(page.getByLabel('Record 名稱', { exact: true })).toHaveValue('item0000'); await page.locator('#modal-close').click();
    await page.getByRole('button', { name: '開啟全部查詢結果', exact: true }).click();
    await expect(page.getByLabel('搜尋 records', { exact: true })).toHaveValue(''); await expect(page.locator('#inspector-content > .section-caption')).toHaveText('500 / 500 筆資料');
    await page.locator('.gp-record-filters summary').click();
    await page.getByLabel('篩選欄位', { exact: true }).fill('element'); await page.getByLabel('欄位計算值完全等於', { exact: true }).fill('fire'); await page.getByLabel('啟用精確欄位篩選').check();
    await expect(page.locator('#inspector-content > .section-caption')).toHaveText('250 / 500 筆資料');
    await page.getByRole('button', { name: '建立目前篩選的 table 筆記', exact: true }).click(); await ready(page);
    await expect(page.locator('.gp-query-header')).toContainText('250 筆'); await expect(page.locator('.gp-query tbody tr')).toHaveCount(200);
    await page.getByRole('button', { name: '開啟全部查詢結果', exact: true }).click(); await page.getByLabel('搜尋 records', { exact: true }).fill('item0499');
    await page.getByRole('button', { name: '欄位與引用', exact: true }).click(); await page.getByRole('button', { name: 'aura.item0499.label', exact: true }).click();
    await expect(page.locator('.reference-detail h3')).toHaveText('aura.item0499.label'); await expect(page.locator('.reference-detail')).toContainText('Knowledge source'); expect(errors).toEqual([]);
  });

  test('previews identifier and record namespace changes, rewrites real dependencies and recovers', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await ready(page); await page.locator('.note-item[data-note-id="knowledge"]').click();
    await page.locator('#tab-values').click(); await page.getByLabel('搜尋 identifier', { exact: true }).fill('name');
    const nameCard = page.locator('.value-card').filter({ has: page.getByRole('button', { name: 'name', exact: true }) });
    await nameCard.getByRole('button', { name: 'References', exact: true }).click(); await expect(page.locator('.reference-detail')).toContainText('References · 501');
    await page.getByRole('button', { name: '重新命名／移動 Namespace', exact: true }).click(); await previewRename(page, 'display_name');
    await expect(page.locator('#modal-body')).toContainText('500 筆 records');
    await applyRename(page);
    const renamed = await snapshot();
    expect(renamed.notes.find(note => note.id === 'knowledge')!.markdown).toContain('@display_name = "Sean"');
    expect(renamed.notes.find(note => note.id === 'knowledge')!.markdown).toContain('@full = "{display_name} User"');
    expect(renamed.notes.find(note => note.id === 'knowledge')!.markdown).toContain('`{{name}}`');
    expect(renamed.records.every(record => record.fields.label.startsWith('{display_name}'))).toBe(true);
    await page.locator('#tab-records').click(); await page.getByLabel('搜尋 records', { exact: true }).fill('item0499');
    await page.locator('.record-card').getByRole('button', { name: '編輯', exact: true }).click();
    await page.getByRole('button', { name: '重新命名 record／collection', exact: true }).click();
    await expect(page.getByLabel('重新命名範圍')).toHaveValue('namespace'); await previewRename(page, 'aura.renamed0499'); await applyRename(page);
    const changed = await snapshot(); expect(changed.records.find(record => record.id === 'record-499')!.name).toBe('renamed0499');
    expect(changed.notes.find(note => note.id === 'knowledge')!.markdown).toContain('{{aura.renamed0499.label}}');
    await page.locator('#history').click(); const recovery = page.locator('.history-row').filter({ hasText: 'aura.item0499' }).first();
    await recovery.getByRole('button', { name: '檢查復原', exact: true }).click(); await expect(page.locator('#modal-body')).toContainText('aura.renamed0499 → aura.item0499');
    await page.getByRole('button', { name: '確認復原', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    const recovered = await snapshot(); expect(recovered.records.find(record => record.id === 'record-499')!.name).toBe('item0499');
    expect(recovered.notes.find(note => note.id === 'knowledge')!.markdown).toContain('{{aura.item0499.label}}'); expect(recovered.records[0].fields.label).toBe('{display_name}');
    await page.reload(); await ready(page); expect((await snapshot()).records.find(record => record.id === 'record-499')!.name).toBe('item0499'); expect(errors).toEqual([]);
  });
});
