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
const scale = Number(process.env.GRASP_PERF_SCALE ?? '1');
if (!Number.isSafeInteger(scale) || scale < 1 || scale > 10) throw new Error('GRASP_PERF_SCALE must be an integer from 1 to 10.');
const bindingCount = 1000 * scale, referenceCount = 5000 * scale;
const profiling = process.env.GRASP_PERF_PROFILE === '1';
const readinessTimeout = Math.min(90_000, 15_000 + scale * 7500);
const testTimeout = Math.min(360_000, 90_000 + scale * 27_000);
let server: ChildProcess;
let serverLogs = '';
let initial: SharedStateResponse;
const outcomes: Array<{ title: string; status: string | undefined; durationMs: number; errors: string[] }> = [];
const evidence: Record<string, unknown> = {
  syntaxVersion: 'grasp-v1', scale, bindingCount, referenceCount, profiling, browser: 'Chromium/Edge', status: 'initializing', database,
  limits: { readinessTimeoutMs: readinessTimeout, testTimeoutMs: testTimeout, typingP95LimitMs: 500 },
  note: 'Synthetic production-browser workload. Input completion includes automation overhead; insertText is not native IME evidence. Long tasks include rendering and save work. Explorer/Obsidian are not exercised.',
};
function saveEvidence() { mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, 'performance.json'), JSON.stringify({ ...evidence, tests: outcomes, serverLogs, timestamp: new Date().toISOString() }, null, 2)); }
function phase(name: string) { evidence.phase = name; saveEvidence(); }
async function state(): Promise<SharedStateResponse> {
  const response = await fetch(origin + '/api/shared/state', { signal: AbortSignal.timeout(readinessTimeout) });
  if (!response.ok) throw new Error(`Read shared state failed (${response.status}): ${await response.text()}`);
  return response.json();
}
async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: database }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const log = (data: Buffer) => serverLogs = (serverLogs + data.toString()).slice(-16_384);
  server.stdout!.on('data', log); server.stderr!.on('data', log);
  const deadline = performance.now() + readinessTimeout;
  while (performance.now() < deadline) {
    if (server.exitCode !== null) throw new Error(serverLogs);
    const response = await fetch(origin + '/api/host', { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
    if (response?.ok) {
      const host = await response.json() as { path: string; error?: string };
      if (resolve(host.path) !== database) throw new Error(`Performance port ${port} belongs to a different workspace.`);
      if (host.error) throw new Error(host.error);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Shared performance host startup timeout: ${serverLogs}`);
}
async function stop() { if (server?.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
async function saved(page: Page) {
  await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite', { timeout: readinessTimeout });
  await expect(page.locator('#runtime-status')).toContainText(`${bindingCount} 個值`, { timeout: readinessTimeout });
}
function metrics(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples, p50Ms: sorted[Math.floor(sorted.length * .5)] ?? null, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? null, maxMs: sorted.length ? Math.max(...sorted) : null };
}
async function typeSamples(page: Page, count: number, text: string, mode: 'source' | 'live') {
  const measurements: number[] = [];
  const cdp = profiling ? await page.context().newCDPSession(page) : undefined;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  phase(`typing-${mode}`);
  try {
    for (let i = 0; i < count; i++) {
      const start = performance.now(); await page.keyboard.insertText(text); measurements.push(performance.now() - start);
      evidence[`${mode}Typing`] = { ...metrics(measurements), expectedSamples: count, complete: measurements.length === count }; saveEvidence();
    }
  } finally {
    if (cdp) {
      try { const result = await cdp.send('Profiler.stop'); writeFileSync(resolve(directory, `${mode}.cpuprofile`), JSON.stringify(result.profile)); }
      catch (error) { evidence[`${mode}ProfileError`] = String(error); }
      await cdp.detach().catch(() => {});
    }
    evidence[`${mode}Typing`] = { ...metrics(measurements), expectedSamples: count, complete: measurements.length === count }; saveEvidence();
  }
  return metrics(measurements);
}
function identities(data: SharedStateResponse) {
  return { identifiers: data.semantic.identifiers.map(item => item.id), bindings: data.semantic.bindings.map(item => item.id), occurrences: data.semantic.occurrences.map(item => item.id) };
}

test.describe.serial(`Production v1 workload (${bindingCount} identifiers / ${referenceCount} references)`, () => {
  test.setTimeout(testTimeout);
  test.beforeAll(async () => {
    phase('fixture-start'); const began = performance.now();
    try {
      const store = new WorkspaceStore(database, { create: true, name: 'V1 performance', seed: false });
      try {
        const fixture = store.createNote('V1 performance', '', null, 'grasp-v1');
        store.updateSettings({ activeNoteId: fixture.notes[0].id, mode: 'live' });
      } finally { store.close(); }
      await start();
      const before = await state(), note = before.snapshot.notes[0];
      const bindings = ['@PerfRoot = <|A|>', ...Array.from({ length: bindingCount - 1 }, (_, i) => `@PerfValue${i} = PerfRoot + <|:${i}|>`)];
      const references = Array.from({ length: referenceCount - 1 }, (_, i) => i % 2 ? `[old](:ref:PerfValue${i % (bindingCount - 1)})` : `[[@PerfValue${i % (bindingCount - 1)}|old]]`);
      const paragraphs = Array.from({ length: Math.ceil(references.length / 10) }, (_, i) => references.slice(i * 10, i * 10 + 10).join(' '));
      const markdown = '# Modern reference workload\n\n[old](:ref:PerfRoot)\n\n' + bindings.join('\n') + '\n\n' + paragraphs.join('\n\n') + '\n\nTyping area: ';
      phase('fixture-populate'); evidence.inputCharacters = markdown.length; saveEvidence();
      const response = await fetch(`${origin}/api/notes/${note.id}`, { method: 'PUT', signal: AbortSignal.timeout(readinessTimeout), headers: { 'Content-Type': 'application/json', 'X-Grasp-Workspace': before.snapshot.id }, body: JSON.stringify({ title: 'V1 performance', markdown, revision: note.revision, syntaxVersion: 'grasp-v1' }) });
      if (!response.ok) throw new Error(await response.text());
      initial = await state(); expect(initial.semantic.bindings).toHaveLength(bindingCount); expect(initial.semantic.occurrences).toHaveLength(referenceCount);
      evidence.sourceCharacters = initial.snapshot.notes[0].markdown.length; evidence.fixtureSetupMs = performance.now() - began; evidence.status = 'running'; phase('fixture-ready');
    } catch (error) { evidence.status = 'initialization-failed'; evidence.initializationError = error instanceof Error ? error.stack : String(error); saveEvidence(); throw error; }
  });
  test.afterEach(async ({}, info) => {
    outcomes.push({ title: info.title, status: info.status, durationMs: info.duration, errors: info.errors.map(error => error.stack ?? error.message ?? String(error)) });
    saveEvidence(); await info.attach('v1-performance', { path: resolve(directory, 'performance.json'), contentType: 'application/json' });
  });
  test.afterAll(async () => {
    if (evidence.status !== 'initialization-failed') evidence.status = outcomes.length === 2 && outcomes.every(item => item.status === 'passed') ? 'passed' : 'failed-or-incomplete';
    saveEvidence(); try { await stop(); } finally { saveEvidence(); }
  });

  test('source and Live Preview stay editable without changing existing identities', async ({ page }) => {
    const errors: string[] = []; evidence.typingPageErrors = errors; page.on('pageerror', error => { errors.push(error.message); saveEvidence(); }); phase('typing-open');
    await page.goto(origin); await saved(page);
    if (await page.locator('#mode').innerText() !== 'Source') await page.locator('#mode').click();
    await expect(page.locator('#mode')).toHaveText('Source'); await saved(page);
    await page.evaluate(() => {
      (window as unknown as { performanceLongTasks: number[] }).performanceLongTasks = [];
      new PerformanceObserver(list => { (window as unknown as { performanceLongTasks: number[] }).performanceLongTasks.push(...list.getEntries().map(entry => entry.duration)); }).observe({ type: 'longtask', buffered: false });
    });
    const content = page.locator('#editor .cm-content'); await content.focus(); await page.keyboard.press('ControlOrMeta+End');
    const source = await typeSamples(page, 30, '中', 'source');
    phase('source-save');
    await page.locator('#save').click(); await saved(page);
    await page.locator('#mode').click(); await expect(page.locator('#mode')).toHaveText('Live Preview'); await saved(page);
    await content.focus(); await page.keyboard.press('ControlOrMeta+End');
    const live = await typeSamples(page, 20, '即', 'live');
    phase('live-save');
    await page.locator('#save').click(); await saved(page);
    const after = await state(); expect(after.snapshot.notes[0].markdown).toContain('Typing area: ' + '中'.repeat(30) + '即'.repeat(20));
    expect(identities(after)).toEqual(identities(initial));
    evidence.typing = { source, live, longTasksMs: await page.evaluate(() => (window as unknown as { performanceLongTasks: number[] }).performanceLongTasks) };
    evidence.typingIdentityPreserved = true; saveEvidence();
    expect(source.p95Ms).toBeLessThan(500); expect(live.p95Ms).toBeLessThan(500); expect(errors).toEqual([]);
  });

  test(`reference editing updates ${bindingCount} values and ${referenceCount} persistent caches, then survives a real restart`, async ({ page }) => {
    const errors: string[] = []; evidence.cascadePageErrors = errors; page.on('pageerror', error => { errors.push(error.message); saveEvidence(); }); phase('cascade-open');
    await page.goto(origin); await saved(page);
    await page.locator('#editor .cm-content').focus(); await page.keyboard.press('ControlOrMeta+Home');
    await page.getByRole('button', { name: '修改共享值 PerfRoot', exact: true }).first().click();
    await page.getByRole('button', { name: '編輯第 1 段文字', exact: true }).click();
    await page.locator('#modal .cm-content').click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText('B **bold**');
    phase('cascade-submit'); const began = performance.now(); await page.getByRole('button', { name: '提交共享修改', exact: true }).click();
    await expect(page.locator('#modal')).not.toBeVisible({ timeout: readinessTimeout }); await saved(page);
    const changed = await state(); evidence.cascadeCommitAndBrowserReadyMs = performance.now() - began; phase('cascade-validate');
    expect(changed.semantic.results).toHaveLength(bindingCount);
    const validationStart = performance.now(), failures: string[] = [];
    const fail = (message: string) => { if (failures.length < 20) failures.push(message); };
    for (const item of changed.semantic.results) {
      const expected = item.name === 'PerfRoot' ? 'B **bold**' : `B **bold**:${item.name.slice('PerfValue'.length)}`;
      if (item.current.status !== 'ok' || item.current.value !== expected || item.current.message !== undefined) fail(`Incorrect result ${item.name}`);
    }
    expect(changed.semantic.occurrences).toHaveLength(referenceCount);
    const results = new Map(changed.semantic.results.map(item => [item.identifierId, item.current]));
    let checked = 0;
    for (const occurrence of changed.semantic.occurrences) {
      const expected = results.get(occurrence.identifierId), actual = occurrence.cache.current;
      if (!expected || actual.status !== expected.status || actual.value !== expected.value || actual.message !== expected.message) fail(`Incorrect cache ${occurrence.id}`);
      if (occurrence.cache.source !== 'computed' || occurrence.cache.semanticRevision !== changed.semantic.revision) fail(`Stale cache ${occurrence.id}`);
      if (!changed.snapshot.notes[0].markdown.slice(occurrence.location.from, occurrence.location.to).includes('B **bold**')) fail(`Incorrect source cache ${occurrence.id}`);
      checked++;
    }
    // Every value/cache is checked. Only the assertion is aggregated: creating
    // 200,000 Playwright reporting steps would dominate this product benchmark.
    evidence.cascadeValidation = { results: changed.semantic.results.length, occurrences: checked, elapsedMs: performance.now() - validationStart, failures }; saveEvidence();
    expect(failures).toEqual([]);
    expect(identities(changed)).toEqual(identities(initial));
    phase('restart'); const restart = performance.now(); await stop(); await start(); expect(await state()).toEqual(changed);
    evidence.restartAndReadbackMs = performance.now() - restart; evidence.cascadeAndRestartVerified = true; saveEvidence();
    await page.reload(); await saved(page); await expect(page.getByRole('button', { name: '修改共享值 PerfRoot', exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
    phase('complete');
  });
});
