import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../../server/store';
import { testDirectory } from './fixtures';

const origin = 'http://127.0.0.1:43841';
const folder = testDirectory('navigation');
const database = resolve(folder, 'large.grasp.db');
let server: ChildProcess;
async function snapshot() { return (await fetch(origin + '/api/workspace')).json(); }
async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: '43841', GRASP_WORKSPACE: database }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; server.stdout!.on('data', b => log += b); server.stderr!.on('data', b => log += b);
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(log);
    try { if ((await fetch(origin + '/api/workspace')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(log);
}
async function stop() { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }

test.describe.serial('large logical workspace navigation', () => {
  test.beforeAll(async () => {
    mkdirSync(folder, { recursive: true });
    const store = new WorkspaceStore(database, { create: true, name: 'Navigation scale' });
    const folders = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, parentId: i ? `f${i - 1}` : null, name: `主題${i}`, revision: 0 }));
    const notes = Array.from({ length: 3000 }, (_, i) => ({ id: `n${i}`, title: `筆記 ${String(i).padStart(4, '0')}`, folderId: i < 2275 ? 'f0' : 'f5', markdown: `# 內容 ${i}\n\n可搜尋的中文編號 ${i}\n\n[[筆記 0000#內容 0|返回]]\n\n@value${i} = "${i}"\n{{value${i}}}\n` }));
    store.applyImport({ notes: notes.map(note => ({ ...note, syntaxVersion: 'legacy-v0.2' as const })), folders }, store.snapshot().revision);
    store.updateSettings({ activeNoteId: 'n0', mode: 'source' }); store.close(); await start();
  });
  test.afterAll(stop);

  test('searches 3000 notes, navigates anchors, moves with identity, and restores editor history', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin); await expect(page.locator('#runtime-status')).toContainText('3000 個值');
    expect(await page.locator('.note-item').count()).toBeLessThanOrEqual(80);
    const samples: number[] = [];
    for (const value of ['2999', '2900', '2274', '1024', '2999']) {
      const t = performance.now(); await page.getByLabel('搜尋筆記', { exact: true }).fill(value);
      await expect(page.locator('.note-item')).toContainText(`筆記 ${value}`); samples.push(performance.now() - t);
    }
    await page.locator('.note-item[data-note-id="n2999"]').click();
    await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('筆記 2999');
    await expect(page.locator('#breadcrumb')).toContainText('主題5');
    await expect(page.locator('#runtime-status')).toContainText('重算 0');
    await page.locator('#tab-links').click(); await page.getByRole('button', { name: '前往目標 ↗', exact: true }).click();
    await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('筆記 0000');
    await expect(page.locator('.cm-content')).toBeFocused();
    await page.getByRole('button', { name: '返回上一份筆記', exact: true }).click();
    await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('筆記 2999');
    await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n持續編輯');
    await page.locator('#save').click(); await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
    await page.keyboard.press('ControlOrMeta+p'); await page.getByLabel('快速切換搜尋').fill('筆記 0000'); await page.getByLabel('快速切換搜尋').press('Enter');
    await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('筆記 0000');
    await page.getByRole('button', { name: '返回上一份筆記', exact: true }).click(); await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('筆記 2999'); await expect(page.locator('.main-pane')).not.toHaveAttribute('inert', ''); await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+z');
    await page.locator('#save').click(); await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
    expect((await snapshot()).notes.find((n: any) => n.id === 'n2999').markdown).not.toContain('持續編輯');
    await page.getByRole('button', { name: '筆記操作 筆記 2999', exact: true }).click(); await page.getByRole('button', { name: '移動筆記', exact: true }).click(); await page.getByRole('button', { name: '⌂ 根資料夾', exact: true }).click();
    await expect(page.locator('#breadcrumb')).toHaveText('Navigation scale / 筆記 2999');
    expect((await snapshot()).notes.find((n: any) => n.id === 'n2999').folderId).toBeNull();
    await page.getByLabel('搜尋筆記', { exact: true }).fill('no match'); await page.locator('#new-note').click();
    await expect(page.getByLabel('搜尋筆記', { exact: true })).toHaveValue(''); await expect(page.locator('.note-item.active')).toContainText('未命名筆記');
    await page.getByRole('button', { name: '新增資料夾', exact: true }).click(); await page.getByRole('textbox', { name: '新增資料夾', exact: true }).fill('新主題'); await page.locator('.gp-nav-dialog').getByRole('button', { name: '儲存', exact: true }).click();
    await page.getByRole('button', { name: '開啟資料夾 新主題', exact: true }).click(); await page.locator('#new-note').click();
    await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('未命名筆記');
    await expect(page.locator('#breadcrumb')).toContainText('新主題 / 未命名筆記');
    await expect(page.locator('#navigation')).not.toHaveAttribute('aria-busy', 'true');
    await page.getByLabel('筆記標題', { exact: true }).fill('我的新筆記'); await page.locator('#save').click(); await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
    await expect(page.locator('.gp-nav-breadcrumb')).toContainText('新主題');
    await page.getByRole('button', { name: '筆記操作 我的新筆記', exact: true }).click(); await page.getByRole('button', { name: '刪除筆記…', exact: true }).click(); await page.locator('.gp-nav-dialog').getByRole('button', { name: '刪除並保存復原點', exact: true }).click();
    expect((await snapshot()).notes.some((n: any) => n.title === '我的新筆記')).toBe(false);
    expect(errors).toEqual([]);
    mkdirSync('docs/benchmarks', { recursive: true });
    writeFileSync('docs/benchmarks/navigation-browser.json', JSON.stringify({ notes: 3000, widestFolderNotes: 2275, maxDepth: 6, mountedNotesAtMost: 80, searchInputToVisibleResultMs: samples, platform: process.platform, includesAutomationOverhead: true }, null, 2));
  });

  test('restarts with folder structure, selection and recent notes intact', async ({ page }) => {
    await page.goto(origin); await expect(page.locator('#runtime-status')).toContainText('個值');
    // Let the real navigation preference request complete before taking the restart snapshot.
    await page.getByRole('button', { name: '最近', exact: true }).click();
    await expect.poll(async () => (await snapshot()).settings['navigation.recent']).toBeTruthy();
    const before = await snapshot(); await stop(); await start(); expect(await snapshot()).toEqual(before);
    await page.reload(); await expect(page.locator('#workspace-name')).toHaveText('Navigation scale');
    await page.getByRole('button', { name: '最近', exact: true }).click(); await expect(page.locator('.note-item')).not.toHaveCount(0);
  });
});
