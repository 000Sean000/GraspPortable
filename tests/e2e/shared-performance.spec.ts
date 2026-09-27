import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SharedStateResponse } from '../../server/semantic';
import { WorkspaceStore } from '../../server/store';
import { testDirectory } from './fixtures';

const port = 43849, origin = `http://127.0.0.1:${port}`;
const directory = testDirectory('shared-performance');
const database = resolve(directory, 'workspace.grasp.db');
const bindingCount = 1000, referenceCount = 5000;
let server: ChildProcess;
let initial: SharedStateResponse;
const evidence: Record<string, unknown> = {
  syntaxVersion: 'grasp-v1', bindingCount, referenceCount, browser: 'Chromium/Edge',
  note: 'Synthetic production-browser workload. Input completion includes automation overhead; insertText is not native IME evidence. Long tasks include rendering and save work. Explorer/Obsidian are not exercised.',
};
function saveEvidence() { writeFileSync(resolve(directory, 'performance.json'), JSON.stringify({ ...evidence, timestamp: new Date().toISOString() }, null, 2)); }
async function state(): Promise<SharedStateResponse> { return (await fetch(origin + '/api/shared/state')).json(); }
async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: database }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; server.stdout!.on('data', data => logs += data); server.stderr!.on('data', data => logs += data);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(origin + '/api/shared/state')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Shared performance host startup timeout: ${logs}`);
}
async function stop() { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
async function saved(page: Page) {
  await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite');
  await expect(page.locator('#runtime-status')).toContainText('1000 個值');
}
function metrics(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples, p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: Math.max(...sorted) };
}
async function typeSamples(page: Page, count: number, text: string) {
  const measurements: number[] = [];
  for (let i = 0; i < count; i++) { const start = performance.now(); await page.keyboard.insertText(text); measurements.push(performance.now() - start); }
  return metrics(measurements);
}
function identities(data: SharedStateResponse) {
  return { identifiers: data.semantic.identifiers.map(item => item.id), bindings: data.semantic.bindings.map(item => item.id), occurrences: data.semantic.occurrences.map(item => item.id) };
}

test.describe.serial('M2 production v1 high-interaction reference workload', () => {
  test.setTimeout(120_000);
  test.beforeAll(async () => {
    mkdirSync(directory, { recursive: true });
    const store = new WorkspaceStore(database, { create: true, name: 'V1 performance', seed: false });
    const fixture = store.createNote('V1 performance', '', null, 'grasp-v1');
    store.updateSettings({ activeNoteId: fixture.notes[0].id, mode: 'live' }); store.close();
    await start();
    const before = await state(), note = before.snapshot.notes[0];
    const bindings = ['@PerfRoot = <|A|>', ...Array.from({ length: bindingCount - 1 }, (_, i) => `@PerfValue${i} = PerfRoot + <|:${i}|>`)];
    const references = Array.from({ length: referenceCount - 1 }, (_, i) => i % 2 ? `[old](:ref:PerfValue${i % (bindingCount - 1)})` : `[[@PerfValue${i % (bindingCount - 1)}|old]]`);
    const paragraphs = Array.from({ length: Math.ceil(references.length / 10) }, (_, i) => references.slice(i * 10, i * 10 + 10).join(' '));
    const markdown = '# Modern reference workload\n\n[old](:ref:PerfRoot)\n\n' + bindings.join('\n') + '\n\n' + paragraphs.join('\n\n') + '\n\nTyping area: ';
    const response = await fetch(`${origin}/api/notes/${note.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Grasp-Workspace': before.snapshot.id }, body: JSON.stringify({ title: 'V1 performance', markdown, revision: note.revision, syntaxVersion: 'grasp-v1' }) });
    if (!response.ok) throw new Error(await response.text());
    initial = await state(); expect(initial.semantic.bindings).toHaveLength(bindingCount); expect(initial.semantic.occurrences).toHaveLength(referenceCount);
    evidence.sourceCharacters = initial.snapshot.notes[0].markdown.length;
  });
  test.afterAll(stop);

  test('source and Live Preview stay editable without changing existing identities', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await saved(page);
    if (await page.locator('#mode').innerText() !== 'Source') await page.locator('#mode').click();
    await expect(page.locator('#mode')).toHaveText('Source'); await saved(page);
    await page.evaluate(() => {
      (window as unknown as { performanceLongTasks: number[] }).performanceLongTasks = [];
      new PerformanceObserver(list => { (window as unknown as { performanceLongTasks: number[] }).performanceLongTasks.push(...list.getEntries().map(entry => entry.duration)); }).observe({ type: 'longtask', buffered: false });
    });
    const content = page.locator('#editor .cm-content'); await content.focus(); await page.keyboard.press('ControlOrMeta+End');
    const source = await typeSamples(page, 30, '中');
    await page.locator('#save').click(); await saved(page);
    await page.locator('#mode').click(); await expect(page.locator('#mode')).toHaveText('Live Preview'); await saved(page);
    await content.focus(); await page.keyboard.press('ControlOrMeta+End');
    const live = await typeSamples(page, 20, '即');
    await page.locator('#save').click(); await saved(page);
    const after = await state(); expect(after.snapshot.notes[0].markdown).toContain('Typing area: ' + '中'.repeat(30) + '即'.repeat(20));
    expect(identities(after)).toEqual(identities(initial));
    evidence.typing = { source, live, longTasksMs: await page.evaluate(() => (window as unknown as { performanceLongTasks: number[] }).performanceLongTasks) };
    evidence.typingIdentityPreserved = true; saveEvidence();
    expect(source.p95Ms).toBeLessThan(500); expect(live.p95Ms).toBeLessThan(500); expect(errors).toEqual([]);
  });

  test('reference editing updates 1000 values and 5000 persistent caches, then survives a real restart', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await saved(page);
    await page.locator('#editor .cm-content').focus(); await page.keyboard.press('ControlOrMeta+Home');
    await page.getByRole('button', { name: '修改共享值 PerfRoot', exact: true }).first().click();
    await page.getByRole('button', { name: '編輯第 1 段文字', exact: true }).click();
    await page.locator('#modal .cm-content').click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText('B **bold**');
    const began = performance.now(); await page.getByRole('button', { name: '提交共享修改', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible(); await saved(page);
    const changed = await state(); evidence.cascadeCommitAndBrowserReadyMs = performance.now() - began;
    expect(changed.semantic.results).toHaveLength(bindingCount);
    for (const item of changed.semantic.results) expect(item.current).toEqual({ status: 'ok', value: item.name === 'PerfRoot' ? 'B **bold**' : `B **bold**:${item.name.slice('PerfValue'.length)}` });
    expect(changed.semantic.occurrences).toHaveLength(referenceCount);
    const results = new Map(changed.semantic.results.map(item => [item.identifierId, item.current]));
    for (const occurrence of changed.semantic.occurrences) {
      expect(occurrence.cache.current).toEqual(results.get(occurrence.identifierId));
      expect(occurrence.cache.source).toBe('computed'); expect(occurrence.cache.semanticRevision).toBe(changed.semantic.revision);
      expect(changed.snapshot.notes[0].markdown.slice(occurrence.location.from, occurrence.location.to)).toContain('B **bold**');
    }
    expect(identities(changed)).toEqual(identities(initial));
    const restart = performance.now(); await stop(); await start(); expect(await state()).toEqual(changed);
    evidence.restartAndReadbackMs = performance.now() - restart; evidence.cascadeAndRestartVerified = true; saveEvidence();
    await page.reload(); await saved(page); await expect(page.getByRole('button', { name: '修改共享值 PerfRoot', exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
    await test.info().attach('v1-performance', { path: resolve(directory, 'performance.json'), contentType: 'application/json' });
  });
});
