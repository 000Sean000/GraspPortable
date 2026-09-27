// Private-corpus browser acceptance. Reports/screenshots stay beside the Scratch DB.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { chromium, expect } from '@playwright/test';

const database = await realpath(process.argv[2]);
const scratch = await realpath(resolve('..', 'Scratch'));
const contained = relative(scratch, database);
assert(contained && !contained.startsWith('..') && !isAbsolute(contained), 'Use an independent Scratch DB only.');
const reportRoot = resolve(dirname(dirname(database)), 'Browser-verification-' + Date.now());
await mkdir(reportRoot);
const origin = 'http://127.0.0.1:43857';
assert(!await fetch(origin + '/api/host').then(() => true, () => false), 'Acceptance browser port is already occupied.');
const host = spawn(process.execPath, ['dist/server.mjs'], { cwd: process.cwd(),
  env: { ...process.env, PORT: '43857', GRASP_WORKSPACE: database }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; host.stdout.on('data', data => logs += data); host.stderr.on('data', data => logs += data);
let browser;
const report = { startedAt: new Date().toISOString(), browser: 'Edge headless production', desktopGuiVerified: false };
const errors = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    assert.equal(host.exitCode, null, 'Host exited during startup.');
    const response = await fetch(origin + '/api/host').catch(() => undefined);
    if (response?.ok) { const info = await response.json(); assert.equal(resolve(info.path), resolve(database)); assert(!info.error); ready = true; break; }
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready, 'Host startup timeout.');
  browser = await chromium.launch({ channel: existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe') ? 'msedge' : undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  const started = performance.now();
  await page.goto(origin);
  await expect(page.locator('#runtime-status')).toContainText('個值', { timeout: 90_000 });
  report.openAndReadyMs = performance.now() - started;
  const state = await (await fetch(origin + '/api/shared/state')).json();
  report.counts = { notes: state.snapshot.notes.length, folders: state.snapshot.folders.length, attachments: state.snapshot.attachments.length, bindings: state.semantic.bindings.length, occurrences: state.semantic.occurrences.length };
  await page.locator('#note-search').fill('Grasp acceptance shared workflow');
  await page.locator('.note-item').filter({ hasText: 'Grasp acceptance shared workflow' }).click();
  await expect(page.locator('#note-title')).toHaveValue('Grasp acceptance shared workflow');
  await page.locator('#reading').click();
  await expect(page.locator('#editor')).toContainText('After', { timeout: 15_000 });
  await page.screenshot({ path: resolve(reportRoot, 'reading-private.png') });
  await page.locator('#projection').click();
  await expect(page.locator('.gp-projection-panel')).toContainText('Markdown', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: '建立完整 checkpoint', exact: true })).toBeVisible();
  report.catalogDomRows = await page.locator('.gp-projection-panel input[type=checkbox]').count();
  await page.screenshot({ path: resolve(reportRoot, 'strategy-private.png') });
  await page.locator('#modal-close').click();
  await page.locator('#files').click();
  await expect(page.locator('.gp-files-panel')).toContainText(database, { timeout: 60_000 });
  await page.screenshot({ path: resolve(reportRoot, 'files-private.png') });
  await page.locator('#modal-close').click();
  // Resolve real paths but do not claim native Explorer launch or desktop evidence.
  const selected = state.snapshot.notes.find(note => note.title === 'Grasp acceptance shared workflow');
  const beforeLocate = await (await fetch(origin + '/api/projection/state')).json();
  const locateStarted = performance.now();
  const located = await fetch(origin + '/api/files/locate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Grasp-Workspace': state.snapshot.id }, body: JSON.stringify({ kind: 'note', id: selected.id }) });
  assert(located.ok); const file = await located.json(); assert(existsSync(file.absolutePath));
  report.locateMs = performance.now() - locateStarted;
  const afterLocate = await (await fetch(origin + '/api/projection/state')).json();
  assert.equal(afterLocate.status.lastSuccessFingerprint, beforeLocate.status.lastSuccessFingerprint, 'Unchanged reading content must not rebuild the entire fallback just to locate a note.');
  report.locateKeptPublishedGeneration = true;
  report.notePathExists = true;
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator('#projection').click();
  await expect(page.locator('.gp-projection-panel')).toContainText('Markdown', { timeout: 60_000 });
  const dimensions = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth, panel: document.querySelector('.gp-projection-panel').getBoundingClientRect().width }));
  assert(dimensions.body <= dimensions.width + 1, 'Narrow viewport has horizontal overflow.');
  report.narrowViewport = dimensions;
  await page.screenshot({ path: resolve(reportRoot, 'narrow-private.png') });
  assert.deepEqual(errors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  await writeFile(resolve(reportRoot, 'failure-private.txt'), String(error.stack ?? error) + '\n' + logs);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (host.exitCode === null) { const stopped = once(host, 'exit'); host.kill(); await stopped; }
  report.completedAt = new Date().toISOString();
  report.pageErrors = errors.length;
  await writeFile(resolve(reportRoot, 'aggregate-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
