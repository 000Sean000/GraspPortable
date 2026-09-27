import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkspaceSnapshot } from '../../src/domain/model';
import type { DurableDraft } from '../../server/semantic';
import { testDirectory } from './fixtures';

const origin = 'http://127.0.0.1:43850', directory = testDirectory('draft-recovery');
const original = '@Name = <|Base|>\n\n[Base](:ref:Name)\n';
let server: ChildProcess, caseNumber = 0;
async function snapshot(): Promise<WorkspaceSnapshot> { return (await fetch(origin + '/api/workspace')).json(); }
async function drafts(): Promise<DurableDraft[]> { return (await fetch(origin + '/api/drafts')).json(); }
async function mutate(path: string, method: string, body: unknown): Promise<WorkspaceSnapshot> {
  const response = await fetch(origin + '/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text()); return response.json();
}
async function ready(page: Page) {
  await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
  await expect(page.locator('#runtime-status')).toContainText('個值');
}
async function openSource(page: Page) {
  await page.goto(origin); await ready(page);
  if (await page.locator('#mode').innerText() !== 'Source') await page.locator('#mode').click();
  await expect(page.locator('#mode')).toHaveText('Source'); await ready(page);
}
async function edit(page: Page, markdown: string) {
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(markdown);
}
test.describe.serial('production draft review and discard safety', () => {
  test.beforeAll(async () => {
    mkdirSync(directory, { recursive: true });
    server = spawn(process.execPath, ['dist/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: '43850', GRASP_WORKSPACE: resolve(directory, 'boot.grasp.db') }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let logs = ''; server.stdout!.on('data', data => logs += data); server.stderr!.on('data', data => logs += data);
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(logs);
      try { if ((await fetch(origin + '/api/workspace')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(logs);
  });
  test.afterAll(async () => { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } });
  test.beforeEach(async () => {
    const workspace = await mutate('/workspace/open', 'POST', { path: resolve(directory, `case-${++caseNumber}.grasp.db`), create: true, name: 'Draft recovery' });
    const note = workspace.notes[0];
    await mutate(`/notes/${note.id}`, 'PUT', { title: 'Recovery note', markdown: original, revision: note.revision, syntaxVersion: 'grasp-v1' });
  });

  test('discard confirmation freezes autosave; cancel resumes, confirm does not commit', async ({ page }) => {
    await openSource(page);
    const first = original + '\nKeep after cancel';
    await edit(page, first); await page.getByRole('button', { name: '捨棄草稿', exact: true }).click();
    await expect(page.locator('#modal-title')).toHaveText('捨棄這份草稿');
    // Deliberately exceed the real 350ms debounce while the human reviews.
    await page.waitForTimeout(700); await page.keyboard.press('ControlOrMeta+s');
    expect((await snapshot()).notes[0].markdown).toBe(original);
    await page.getByRole('button', { name: '取消', exact: true }).click(); await ready(page);
    expect((await snapshot()).notes[0].markdown).toBe(first);
    await edit(page, first + '\nMust be discarded'); await page.getByRole('button', { name: '捨棄草稿', exact: true }).click();
    await expect(page.locator('#modal-title')).toHaveText('捨棄這份草稿'); await page.waitForTimeout(700);
    expect((await snapshot()).notes[0].markdown).toBe(first);
    await page.getByRole('button', { name: '確認捨棄草稿', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible(); await ready(page);
    expect((await snapshot()).notes[0].markdown).toBe(first); expect(await drafts()).toEqual([]);
    await expect(page.locator('#editor .cm-content')).not.toContainText('Must be discarded');
  });

  test('reviewed original remains manually recoverable without reopening itself after reload', async ({ page }) => {
    await openSource(page);
    const base = (await snapshot()).notes[0];
    await mutate(`/notes/${base.id}`, 'PUT', { title: base.title, markdown: original.replaceAll('Base', 'Remote'), revision: base.revision, syntaxVersion: 'grasp-v1' });
    const local = original.replace('<|Base|>', '<|Local|>');
    await edit(page, local); await page.locator('#save').click();
    await expect(page.locator('#save-status')).toHaveText('✓ 草稿已保存 · 共享值使用已提交版本');
    const oldDraft = (await drafts())[0]; expect(oldDraft.markdown).toBe(local);
    await page.getByRole('button', { name: '比較最新版本', exact: true }).click();
    await expect(page.locator('.diff-before')).toContainText('Remote'); await expect(page.locator('.diff-after')).toContainText('Local');
    await page.getByRole('button', { name: '以這份草稿重新審查', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible(); await ready(page);
    await expect(page.getByRole('button', { name: '恢復草稿（1）', exact: true })).toBeVisible();
    expect((await drafts()).map(item => item.id)).toEqual([oldDraft.id]);
    const committed = (await snapshot()).notes[0].markdown; expect(committed).toContain('[Local](:ref:Name)');
    await page.reload(); await ready(page);
    await expect(page.getByRole('button', { name: '恢復草稿（1）', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '捨棄草稿', exact: true })).toHaveCount(0);
    await expect(page.locator('#editor .cm-content')).toContainText('[Local](:ref:Name)');
    await page.getByRole('button', { name: '恢復草稿（1）', exact: true }).click();
    await page.getByRole('button', { name: '恢復', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible();
    await expect(page.locator('#editor .cm-content')).toContainText('[Base](:ref:Name)');
    expect((await snapshot()).notes[0].markdown).toBe(committed);
    await page.reload(); await expect(page.locator('#editor .cm-content')).toContainText('[Base](:ref:Name)');
    await expect(page.getByRole('button', { name: '捨棄草稿', exact: true })).toBeVisible();
  });

  test('a lost discard response reconciles the exact deletion and keeps committed content intact', async ({ page }) => {
    await openSource(page); await edit(page, original + '\n@Broken = <|unfinished'); await page.locator('#save').click();
    await expect(page.locator('#save-status')).toHaveText('✓ 草稿已保存 · 共享值使用已提交版本'); expect(await drafts()).toHaveLength(1);
    let dropped = false;
    await page.route('**/api/drafts/*', async route => {
      if (route.request().method() === 'DELETE' && !dropped) { dropped = true; expect((await route.fetch()).ok()).toBe(true); await route.abort('failed'); }
      else await route.continue();
    });
    await page.getByRole('button', { name: '捨棄草稿', exact: true }).click(); await page.getByRole('button', { name: '確認捨棄草稿', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible(); await ready(page); expect(dropped).toBe(true);
    expect(await drafts()).toEqual([]); expect((await snapshot()).notes[0].markdown).toBe(original);
    await page.reload(); await ready(page); await expect(page.locator('#draft-status')).not.toBeVisible();
  });

  test('a durable draft whose note was deleted remains downloadable after reload', async ({ page }) => {
    await openSource(page);
    const raw = original + '\n@Broken = <|保留未完成原文 😀';
    await edit(page, raw); await page.locator('#save').click();
    await expect(page.locator('#save-status')).toHaveText('✓ 草稿已保存 · 共享值使用已提交版本');
    const stored = (await drafts())[0]; expect(stored.markdown).toBe(raw);
    await page.locator('#delete-note').click(); await page.getByRole('button', { name: '刪除並保存復原點', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible();
    await expect.poll(async () => (await snapshot()).notes.some(note => note.id === stored.noteId)).toBe(false);
    await page.reload(); await ready(page);
    await expect(page.getByRole('button', { name: '恢復草稿（1）', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '捨棄草稿', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '恢復草稿（1）', exact: true }).click();
    await expect(page.locator('#modal-body')).toContainText('原筆記已刪除，下載草稿');
    await expect(page.getByRole('button', { name: '恢復', exact: true })).toHaveCount(0);
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '下載草稿', exact: true }).click();
    expect(readFileSync((await (await downloaded).path())!, 'utf8')).toBe(raw);
    expect((await drafts())[0]).toEqual(stored); expect((await snapshot()).notes).toHaveLength(0);
  });
});
