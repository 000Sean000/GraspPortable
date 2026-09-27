import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import type { SharedStateResponse } from '../../server/semantic';

const port = 43848, url = `http://127.0.0.1:${port}`;
const folder = resolve('..', 'Scratch', 'AutomatedTests', `shared-${Date.now()}`);
const database = resolve(folder, 'workspace.grasp.db');
let server: ChildProcess;
async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: database }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; server.stdout!.on('data', data => logs += data); server.stderr!.on('data', data => logs += data);
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(url + '/api/shared/state')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Startup timeout: ${logs}`);
}
async function stop() { if (server && server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
async function state(): Promise<SharedStateResponse> { return (await fetch(url + '/api/shared/state')).json(); }
async function source(page: Page, text: string, commit = true) {
  if (await page.locator('#mode').innerText() === 'Live Preview') await page.locator('#mode').click();
  const editor = page.locator('#editor .cm-content'); await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(text);
  await page.locator('#save').click();
  await expect(page.locator('#save-status')).toHaveText(commit ? '✓ 已儲存至 SQLite' : '✓ 草稿已保存 · 共享值使用已提交版本');
}
const sample = '# Shared acceptance\n\n@Fruit = <|Apple|>\n@Slogan = <|Try **|> + Fruit + <|** today|>\n\nFirst: [old](:ref:Fruit)\n\nSecond: [[@Slogan|old]]\n\n| Name | Value |\n| --- | --- |\n| Fruit | Apple |\n\n```text\n@not_binding = <|code|>\n```';
function current(data: SharedStateResponse, name: string) { return data.semantic.results.find(item => item.name === name)!.current; }

test.describe.serial('M2 production shared editing and durable drafts', () => {
  test.beforeAll(async () => { mkdirSync(folder, { recursive: true }); await start(); });
  test.afterAll(stop);
  test('reference → literal edit → nested persistent caches → shared undo → reading', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await expect(page.locator('#workspace-name')).not.toHaveText('');
    await page.locator('#new-note').click(); await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('未命名筆記');
    await page.getByLabel('筆記標題', { exact: true }).fill('Shared acceptance');
    await source(page, sample);
    const before = await state(); const note = before.snapshot.notes.find(item => item.title === 'Shared acceptance')!;
    expect(note.syntaxVersion).toBe('grasp-v1'); expect(note.markdown).toContain('[Apple](:ref:Fruit)');
    expect(current(before, 'Slogan')).toEqual({ status: 'ok', value: 'Try **Apple** today' });
    await page.locator('#mode').click();
    await page.getByRole('button', { name: '修改共享值 Fruit', exact: true }).first().click();
    await page.getByRole('button', { name: '編輯第 1 段文字', exact: true }).click();
    await page.locator('#modal .cm-content').click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText('Pear\n\n**fresh**');
    await page.getByRole('button', { name: '提交共享修改', exact: true }).click(); await expect(page.locator('#modal')).not.toBeVisible();
    const changed = await state(); expect(current(changed, 'Fruit')).toEqual({ status: 'ok', value: 'Pear\n\n**fresh**' });
    expect(current(changed, 'Slogan')).toEqual({ status: 'ok', value: 'Try **Pear\n\n**fresh**** today' });
    expect(changed.semantic.identifiers.find(item => item.name === 'Fruit')!.id).toBe(before.semantic.identifiers.find(item => item.name === 'Fruit')!.id);
    expect(changed.semantic.occurrences.filter(item => item.owner.kind === 'note' && item.owner.noteId === note.id).every(item => item.cache.source === 'computed')).toBe(true);
    expect(changed.snapshot.notes.find(item => item.id === note.id)!.markdown).toContain('[Pear\n\n**fresh**](:ref:Fruit)');
    await page.locator('#shared-undo').click(); await expect(page.locator('#shared-status')).not.toBeVisible();
    expect((await state()).snapshot.notes.find(item => item.id === note.id)!.markdown).toBe(note.markdown);
    await page.locator('#reading').click();
    await expect(page.locator('#editor .gp-reading table')).toHaveCount(1); await expect(page.locator('#editor .gp-reading pre')).toContainText('@not_binding');
    await expect(page.locator('#editor .gp-reading')).toContainText('Try Apple today');
    await page.screenshot({ path: resolve(folder, 'shared-reading.png'), fullPage: true });
    expect(errors).toEqual([]);
  });
  test('incomplete source survives a real restart without changing committed values; missing and cycle remain recoverable', async ({ page }) => {
    await page.goto(url); await page.locator('#reading').click();
    await source(page, sample + '\n\n@Unfinished = <|unfinished', false);
    await expect(page.locator('#draft-status')).toContainText('草稿'); expect(current(await state(), 'Fruit')).toEqual({ status: 'ok', value: 'Apple' });
    const before = await state(); await stop(); await start(); expect(await state()).toEqual(before);
    await page.reload(); await expect(page.locator('#editor .cm-content')).toContainText('@Unfinished');
    await expect(page.locator('#draft-status')).toContainText('草稿');
    await source(page, sample + '\n\n@Broken = Missing\n@LoopA = LoopB\n@LoopB = LoopA\n\n[observation](:ref:Broken)');
    const failed = await state(); expect(current(failed, 'Broken').status).toBe('missing'); expect(current(failed, 'LoopA').status).toBe('cycle');
    expect(failed.snapshot.notes.find(item => item.title === 'Shared acceptance')!.markdown).toContain('[observation](:ref:Broken)');
    await source(page, sample); expect(current(await state(), 'Fruit')).toEqual({ status: 'ok', value: 'Apple' });
    expect((await (await fetch(url + '/api/drafts')).json())).toEqual([]);
  });
  test('lost draft and shared-command responses reconcile persisted requests without duplicate edits', async ({ page }) => {
    await page.goto(url);
    let droppedDraft = false, droppedCommand = false;
    await page.route('**/api/drafts/*', async route => {
      if (route.request().method() === 'PUT' && !droppedDraft) { droppedDraft = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await page.route('**/api/shared/commands', async route => {
      if (!droppedCommand) { droppedCommand = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await source(page, sample.replace('Apple', 'Peach'));
    expect(droppedDraft).toBe(true); expect(droppedCommand).toBe(true);
    expect(current(await state(), 'Fruit')).toEqual({ status: 'ok', value: 'Peach' });
    expect(await (await fetch(url + '/api/drafts')).json()).toEqual([]);
    await expect(page.locator('#shared-status')).not.toBeVisible();
  });
  test('ordinary prepend and append of identical references preserve existing occurrence identities', async ({ page }) => {
    await page.goto(url); await source(page, '@Repeat = <|same|>\n\n[same](:ref:Repeat)\n');
    const before = await state(); const first = before.semantic.occurrences.find(item => item.name === 'Repeat')!;
    const content = page.locator('#editor .cm-content'); await content.focus(); await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('[same](:ref:Repeat)\n'); await page.locator('#save').click();
    await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
    const appended = (await state()).semantic.occurrences.filter(item => item.name === 'Repeat');
    expect(appended).toHaveLength(2); expect(appended[0].id).toBe(first.id);
    await content.focus(); await page.keyboard.press('ControlOrMeta+Home'); await page.keyboard.insertText('[same](:ref:Repeat)\n\n'); await page.locator('#save').click();
    await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
    const prepended = (await state()).semantic.occurrences.filter(item => item.name === 'Repeat');
    expect(prepended).toHaveLength(3); expect(prepended.slice(1).map(item => item.id)).toEqual(appended.map(item => item.id));
  });
  test('typing during a cache-changing commit is rebased with original occurrence identities', async ({ page }) => {
    await page.goto(url);
    const before = await state(); const originalIds = before.semantic.occurrences.filter(item => item.name === 'Repeat').map(item => item.id);
    let release!: () => void, committed!: () => void;
    const gate = new Promise<void>(resolve => release = resolve), committedSignal = new Promise<void>(resolve => committed = resolve);
    let held = false;
    await page.route('**/api/shared/commands', async route => {
      if (held) { await route.continue(); return; }
      held = true; const response = await route.fetch(); committed(); await gate; await route.fulfill({ response });
    });
    const content = page.locator('#editor .cm-content'); await content.focus(); await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ControlOrMeta+f'); await page.getByPlaceholder('Find').fill(''); await page.getByPlaceholder('Find').pressSequentially('<|same|>'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('<|same|>');
    await page.keyboard.insertText('<|new value|>'); await page.locator('#save').click(); await committedSignal;
    await content.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('Continued while saving'); release();
    await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
    const after = await state(); expect(current(after, 'Repeat')).toEqual({ status: 'ok', value: 'new value' });
    expect(after.snapshot.notes.find(item => item.title === 'Shared acceptance')!.markdown).toContain('Continued while saving');
    expect(after.semantic.occurrences.filter(item => item.name === 'Repeat').map(item => item.id)).toEqual(originalIds);
    expect(after.semantic.occurrences.filter(item => item.name === 'Repeat').every(item => item.cache.renderedValue === 'new value')).toBe(true);
  });
});
