import { test, expect, type Page, type Route } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import type { WorkspaceSnapshot } from '../../src/domain/model';

const port = 43830;
const origin = `http://127.0.0.1:${port}`;
const folder = resolve('.cache/concurrency', `${Date.now()}-${process.pid}`);
let server: ChildProcess;
let fixture: { path: string; workspace: WorkspaceSnapshot; originalId: string; otherId: string };
let caseNumber = 0;

async function snapshot(): Promise<WorkspaceSnapshot> { return await (await fetch(origin + '/api/workspace')).json(); }
async function api(path: string, method: string, body: unknown): Promise<WorkspaceSnapshot> {
  const response = await fetch(origin + '/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}
async function start() {
  mkdirSync(folder, { recursive: true });
  server = spawn(process.execPath, ['dist/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: resolve(folder, 'boot.grasp.db') }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; server.stdout!.on('data', data => logs += data); server.stderr!.on('data', data => logs += data);
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Concurrency host exited: ${logs}`);
    try { if ((await fetch(origin + '/api/workspace')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Concurrency host startup timeout: ${logs}`);
}
async function stop() { if (server && server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
async function saved(page: Page) {
  await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
  await expect(page.locator('#runtime-status')).toContainText('個值');
}
async function openSource(page: Page) {
  await page.goto(origin); await saved(page);
  if ((await page.locator('#mode').innerText()) === 'Live Preview') {
    const setting = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
    await page.locator('#mode').click(); await setting; await saved(page);
  }
}
async function edit(page: Page, markdown: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(markdown);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function holdFirstSaveResponse(page: Page) {
  const received = deferred(), release = deferred();
  let intercepted = false;
  const pattern = `**/api/notes/${fixture.originalId}`;
  const handler = async (route: Route) => {
    if (route.request().method() !== 'PUT' || intercepted) { await route.continue(); return; }
    intercepted = true;
    // Commit to the real SQLite host, but hold the HTTP response while the user
    // keeps editing. This reproduces the difficult commit/acknowledgement gap.
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    received.resolve(); await release.promise; await route.fulfill({ response });
  };
  await page.route(pattern, handler);
  return { received: received.promise, release: release.resolve, remove: () => page.unroute(pattern, handler) };
}
function readMarkdown(path: string, id: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return String(db.prepare('SELECT markdown FROM notes WHERE id=?').get(id)?.markdown); }
  finally { db.close(); }
}

test.describe.serial('production concurrency and draft safety', () => {
  test.beforeAll(start);
  test.afterAll(stop);
  test.beforeEach(async () => {
    const path = resolve(folder, `case-${++caseNumber}.grasp.db`);
    let workspace = await api('/workspace/open', 'POST', { path, create: true, name: `Concurrency ${caseNumber}` });
    const originalId = workspace.notes[0].id;
    workspace = await api(`/notes/${originalId}`, 'PUT', { title: 'Original note', markdown: '# Original\n\nBaseline original.', revision: workspace.notes[0].revision });
    workspace = await api('/notes', 'POST', { title: 'Other note', markdown: '# Other\n\nUntouched other.' });
    fixture = { path, workspace, originalId, otherId: workspace.notes.find(note => note.id !== originalId)!.id };
  });

  test('late autosave acknowledgement plus further input and create preserves both documents', async ({ page }) => {
    await openSource(page);
    const held = await holdFirstSaveResponse(page);
    const firstDraft = '# Original\n\nFirst autosaved draft.';
    const latestDraft = '# Original\n\nLatest input while saving — 中文不可遺失。';
    try {
      await edit(page, firstDraft); await held.received;
      expect((await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown).toBe(firstDraft);
      await edit(page, latestDraft);
      await page.locator('#new-note').click();
      expect((await snapshot()).notes).toHaveLength(2);
      held.release();
      await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('未命名筆記');
      await saved(page);
      let committed = await snapshot();
      expect(committed.notes).toHaveLength(3);
      expect(committed.notes.find(note => note.id === fixture.originalId)!.markdown).toBe(latestDraft);
      expect(committed.notes.find(note => note.id === fixture.otherId)!.markdown).toBe('# Other\n\nUntouched other.');
      const created = committed.notes.find(note => note.id !== fixture.originalId && note.id !== fixture.otherId)!;
      expect(created.markdown).toBe('');
      await page.getByLabel('筆記標題', { exact: true }).fill('Created after delayed save');
      await edit(page, '# New\n\nNew document content only.');
      await page.locator('#save').click(); await saved(page);
      committed = await snapshot();
      expect(committed.notes.find(note => note.id === fixture.originalId)!.markdown).toBe(latestDraft);
      expect(committed.notes.find(note => note.id === created.id)!.markdown).toBe('# New\n\nNew document content only.');
    } finally { held.release(); await held.remove(); }
  });

  test('selecting another note during delayed autosave cannot cross-write the newest draft', async ({ page }) => {
    await openSource(page);
    const held = await holdFirstSaveResponse(page);
    const latest = '# Original\n\nSecond draft entered before note switch.';
    try {
      await edit(page, '# Original\n\nFirst draft.'); await held.received;
      await edit(page, latest);
      await page.locator(`.note-item[data-note-id="${fixture.otherId}"]`).click();
      held.release();
      await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('Other note');
      await expect(page.locator('.cm-content')).toContainText('Untouched other.'); await saved(page);
      expect((await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown).toBe(latest);
      await edit(page, '# Other\n\nOnly the selected note changes.'); await page.locator('#save').click(); await saved(page);
      const committed = await snapshot();
      expect(committed.notes.find(note => note.id === fixture.originalId)!.markdown).toBe(latest);
      expect(committed.notes.find(note => note.id === fixture.otherId)!.markdown).toBe('# Other\n\nOnly the selected note changes.');
    } finally { held.release(); await held.remove(); }
  });

  test('an already-rendered References result flushes shifted draft text and selects its current occurrence', async ({ page }) => {
    const original = '# Reference navigation\n\n@name = "Sean"\n\nFirst {{name}}.\nSecond {{name}}.\n';
    const current = (await snapshot()).notes.find(note => note.id === fixture.originalId)!;
    await api(`/notes/${fixture.originalId}`, 'PUT', { title: current.title, markdown: original, revision: current.revision });
    await openSource(page);
    const valueCard = page.locator('.value-card').filter({ has: page.getByRole('button', { name: 'name', exact: true }) });
    await valueCard.getByRole('button', { name: 'References', exact: true }).click();
    const referenceLinks = page.locator('.reference-detail .reference-link');
    await expect(referenceLinks).toHaveCount(2);
    await expect(referenceLinks.nth(1)).toContainText('第 6 行');
    // Keep the actual rendered button: a later locator lookup might silently
    // resolve a fresh row and therefore miss the stale-navigation regression.
    const alreadyRendered = await referenceLinks.nth(1).elementHandle();
    const held = await holdFirstSaveResponse(page);
    const prefix = '# Newly inserted section\n\nThis pending draft shifts every reference.\n\n';
    try {
      await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.insertText(prefix);
      await alreadyRendered!.click();
      await held.received;
      await expect(referenceLinks.nth(1)).toContainText('第 6 行');
      held.release();
      await saved(page);
      await expect(referenceLinks.nth(1)).toContainText('第 10 行');
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('{{name}}');
      await expect.poll(() => page.evaluate(() => {
        const anchor = window.getSelection()?.anchorNode;
        const element = anchor instanceof Element ? anchor : anchor?.parentElement;
        return element?.closest('.cm-line')?.textContent;
      })).toBe('Second {{name}}.');
      expect((await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown).toBe(prefix + original);
      // A real edit of the selected occurrence proves both exact selection and
      // focus restoration after nested navigation/save transitions.
      await page.keyboard.insertText('Updated occurrence');
      await page.locator('#save').click(); await saved(page);
      const committed = (await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown;
      expect(committed).toBe(prefix + original.replace('Second {{name}}.', 'Second Updated occurrence.'));
      expect(committed).toContain('First {{name}}.');
      await page.locator('.reference-detail').getByRole('button', { name: '前往定義 ↗', exact: true }).click();
      await expect(page.locator('.cm-content')).toBeFocused();
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('@name = "Sean"');
      await page.keyboard.insertText('@name = "Updated definition"');
      await page.locator('#save').click(); await saved(page);
      expect((await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown).toBe(committed.replace('@name = "Sean"', '@name = "Updated definition"'));
    } finally { held.release(); await held.remove(); }
  });

  test('failed save retains draft, blocks replacement commands, guards reload, and can retry', async ({ page }) => {
    await openSource(page);
    const pattern = `**/api/notes/${fixture.originalId}`;
    let failures = 0;
    const fail = async (route: Route) => { failures++; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Injected SQLite storage outage' }) }); };
    await page.route(pattern, fail);
    const draft = '# Original\n\nUnsaved draft must survive — 尚未保存。';
    await edit(page, draft);
    await expect(page.locator('#save-status')).toHaveText('儲存失敗 · 草稿仍保留');
    expect((await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown).toBe('# Original\n\nBaseline original.');
    const beforeCreate = failures;
    await page.locator('#new-note').click(); await expect.poll(() => failures).toBeGreaterThan(beforeCreate);
    await expect(page.locator('#save-status')).toHaveText('儲存失敗 · 草稿仍保留');
    await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('Original note');
    expect((await snapshot()).notes).toHaveLength(2);
    const beforeSelect = failures;
    await page.locator(`.note-item[data-note-id="${fixture.otherId}"]`).click(); await expect.poll(() => failures).toBeGreaterThan(beforeSelect);
    await expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('Original note');
    await expect(page.locator('.cm-content')).toContainText('尚未保存。');
    // Dismiss the browser's real beforeunload prompt; never confirm discard.
    const prompt = page.waitForEvent('dialog');
    const reload = page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => null);
    const dialog = await prompt; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); await reload;
    await expect(page.locator('.cm-content')).toContainText('尚未保存。');
    await expect(page.locator('#save-status')).toHaveText('儲存失敗 · 草稿仍保留');
    await page.unroute(pattern, fail); await page.locator('#save').click(); await saved(page);
    expect((await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown).toBe(draft);
    await page.reload(); await saved(page); await expect(page.locator('.cm-content')).toContainText('尚未保存。');
  });

  test('a workspace switched in another tab rejects the old tab with 409 and leaves both databases intact', async ({ page, context }) => {
    await openSource(page);
    const oldWorkspaceId = (await snapshot()).id;
    const otherTab = await context.newPage();
    await otherTab.goto(origin); await saved(otherTab);
    await otherTab.locator('#workspace-open').click();
    const secondPath = resolve(folder, `other-tab-${caseNumber}.grasp.db`);
    await otherTab.getByLabel('資料庫路徑').fill(secondPath);
    await otherTab.getByLabel('新 workspace 名稱').fill('Workspace from another tab');
    await otherTab.getByRole('button', { name: '建立新 workspace', exact: true }).click();
    await expect(otherTab.locator('#workspace-name')).toHaveText('Workspace from another tab'); await saved(otherTab);
    const secondBefore = await snapshot();
    const rejection = page.waitForResponse(response => response.url().endsWith(`/api/notes/${fixture.originalId}`) && response.request().method() === 'PUT');
    await edit(page, '# Old tab\n\nMust never reach the other workspace.');
    const response = await rejection;
    expect(response.status()).toBe(409);
    expect(response.request().headers()['x-grasp-workspace']).toBe(oldWorkspaceId);
    await expect(page.locator('#save-status')).toHaveText('儲存失敗 · 草稿仍保留');
    await expect(page.locator('.cm-content')).toContainText('Must never reach the other workspace.');
    expect(await snapshot()).toEqual(secondBefore);
    expect(readMarkdown(fixture.path, fixture.originalId)).toBe('# Original\n\nBaseline original.');
    expect(readMarkdown(secondPath, secondBefore.notes[0].id)).toBe(secondBefore.notes[0].markdown);
  });

  test('a same-database settings response refreshes a clean editor before its next edit', async ({ page, context }) => {
    await openSource(page);
    const received = deferred(), release = deferred(); let intercepted = false;
    const pattern = '**/api/settings';
    const handler = async (route: Route) => {
      if (route.request().method() !== 'PUT' || intercepted) { await route.continue(); return; }
      intercepted = true; received.resolve(); await release.promise;
      await route.fulfill({ response: await route.fetch() });
    };
    await page.route(pattern, handler);
    try {
      await page.locator('#mode').click(); await received.promise;
      const otherTab = await context.newPage(); await openSource(otherTab);
      const newer = '# Original\n\nText saved by tab B — 必須保留。';
      await edit(otherTab, newer); await otherTab.locator('#save').click(); await saved(otherTab);
      await expect(page.locator('.cm-content')).toContainText('Baseline original.');
      release.resolve();
      await expect(page.locator('.cm-content')).toContainText('Text saved by tab B — 必須保留。');
      await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.insertText('\nAdded by tab A.'); await page.locator('#save').click(); await saved(page);
      expect((await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown).toBe(newer + '\nAdded by tab A.');
    } finally { release.resolve(); await page.unroute(pattern, handler); }
  });

  test('a same-database external edit rejects a dirty stale base with 409 and retains its draft', async ({ page, context }) => {
    await openSource(page);
    const otherTab = await context.newPage(); await openSource(otherTab);
    const received = deferred(), release = deferred(); let intercepted = false;
    const pattern = `**/api/notes/${fixture.originalId}`;
    const handler = async (route: Route) => {
      if (route.request().method() !== 'PUT' || intercepted) { await route.continue(); return; }
      intercepted = true; received.resolve(); await release.promise;
      await route.fulfill({ response: await route.fetch() });
    };
    await page.route(pattern, handler);
    try {
      const draft = '# Original\n\nTab A unsaved conflicting draft — 不可丟失。';
      await edit(page, draft); await received.promise;
      const newer = '# Original\n\nTab B independently committed text.';
      await edit(otherTab, newer); await otherTab.locator('#save').click(); await saved(otherTab);
      const rejected = page.waitForResponse(response => response.url().endsWith(`/api/notes/${fixture.originalId}`) && response.request().method() === 'PUT');
      release.resolve(); expect((await rejected).status()).toBe(409);
      await expect(page.locator('#save-status')).toHaveText('儲存失敗 · 草稿仍保留');
      await expect(page.locator('.cm-content')).toContainText('Tab A unsaved conflicting draft — 不可丟失。');
      expect((await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown).toBe(newer);
      expect(readMarkdown(fixture.path, fixture.originalId)).toBe(newer);
    } finally { release.resolve(); await page.unroute(pattern, handler); }
  });

  test('an already-rendered search result rejects an offset invalidated by its pending draft', async ({ page }) => {
    await openSource(page); await page.locator('#note-search').fill('Baseline');
    const result = await page.locator(`.note-item[data-note-id="${fixture.originalId}"]`).elementHandle();
    const held = await holdFirstSaveResponse(page);
    const prefix = '# Pending inserted heading\n\n';
    try {
      await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+Home'); await page.keyboard.insertText(prefix);
      await result!.click(); await held.received; held.release();
      await expect(page.locator('#toast')).toContainText('文字已變更，搜尋結果已更新');
      await saved(page);
      expect((await snapshot()).notes.find(note => note.id === fixture.originalId)!.markdown).toBe(prefix + '# Original\n\nBaseline original.');
      expect(await page.evaluate(() => window.getSelection()?.toString())).not.toBe('Baseline');
      await page.locator(`.note-item[data-note-id="${fixture.originalId}"]`).click();
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Baseline');
    } finally { held.release(); await held.remove(); }
  });
});
