import { test, expect, type Page, type Route } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WorkspaceStore } from '../../server/store';

const port = 43863;
const origin = `http://127.0.0.1:${port}`;
const packageRoot = resolve(process.env.GRASP_TEST_APP_ROOT ?? process.cwd());
const buildInfo = JSON.parse(readFileSync(resolve(packageRoot, 'dist', 'build-info.json'), 'utf8')) as { buildId: string };
const scratch = resolve(process.cwd(), '..', 'Scratch', 'UI-Repair-Synthetic', `${Date.now()}-${process.pid}`);
const database = join(scratch, 'Workspace', 'first.grasp.db');
const secondDatabase = join(scratch, 'Workspace', 'second.grasp.db');
const evidenceRoot = join(scratch, 'Evidence');
let server: ChildProcess | undefined;
let serverLog = '';

function createWorkspace(path: string, name: string, notes: { id: string; title: string; markdown: string }[]) {
  const store = new WorkspaceStore(path, { create: true, name });
  store.applyImport({ notes: notes.map(note => ({ ...note, syntaxVersion: 'grasp-v1' as const })), folders: [] }, store.snapshot().revision);
  store.updateSettings({ activeNoteId: notes[0].id, mode: 'live' });
  store.close();
}

async function startServer() {
  server = spawn(process.execPath, ['dist/server.mjs'], {
    cwd: packageRoot,
    env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: database, GRASP_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server.stdout!.on('data', chunk => { serverLog += String(chunk); });
  server.stderr!.on('data', chunk => { serverLog += String(chunk); });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Packaged v0.3 server exited early: ${serverLog}`);
    try {
      const response = await fetch(`${origin}/api/host`);
      if (response.ok) {
        expect(response.headers.get('x-graspportable-build')).toBe(buildInfo.buildId);
        expect((await response.json()).path).toBe(database);
        return;
      }
    } catch { /* Wait for the child started by this test. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out starting packaged v0.3 server: ${serverLog}`);
}

async function stopServer() {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit'); server.kill(); await exited;
  }
}

async function resetPrimaryWorkspace() {
  let snapshot = await (await fetch(`${origin}/api/workspace`)).json() as { id: string };
  let host = await (await fetch(`${origin}/api/host`)).json() as { path: string };
  if (host.path !== database) {
    const response = await fetch(`${origin}/api/workspace/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Grasp-Workspace': snapshot.id },
      body: JSON.stringify({ path: database, create: false }),
    });
    if (!response.ok) throw new Error(`Could not reset synthetic workspace: ${await response.text()}`);
    snapshot = await response.json() as { id: string };
  }
  const response = await fetch(`${origin}/api/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Grasp-Workspace': snapshot.id },
    body: JSON.stringify({ settings: { activeNoteId: 'note-a', mode: 'live' } }),
  });
  if (!response.ok) throw new Error(`Could not reset synthetic settings: ${await response.text()}`);
}

async function observe(page: Page) {
  const started = new Map<import('@playwright/test').Request, number>();
  const evidence: { consoleErrors: string[]; pageErrors: string[]; requests: Array<{ url: string; method: string; startedAt: number }>; responses: Array<{ url: string; elapsedMs: number; status: number | null }>; failures: Array<{ url: string; elapsedMs: number; error: string | null }> } = {
    consoleErrors: [], pageErrors: [], requests: [], responses: [], failures: [],
  };
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('request', request => {
    started.set(request, Date.now()); evidence.requests.push({ url: request.url(), method: request.method(), startedAt: Date.now() });
  });
  page.on('requestfinished', async request => evidence.responses.push({ url: request.url(), elapsedMs: Date.now() - (started.get(request) ?? Date.now()), status: (await request.response())?.status() ?? null }));
  page.on('requestfailed', request => evidence.failures.push({ url: request.url(), elapsedMs: Date.now() - (started.get(request) ?? Date.now()), error: request.failure()?.errorText ?? null }));
  await page.addInitScript(() => {
    (window as typeof window & { __uiDeliveredClicks?: Array<{ id: string; label: string; at: number }> }).__uiDeliveredClicks = [];
    document.addEventListener('click', event => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('button,[role="button"],a,input');
      if (!target) return;
      (window as typeof window & { __uiDeliveredClicks: Array<{ id: string; label: string; at: number }> }).__uiDeliveredClicks.push({
        id: target.id, label: target.getAttribute('aria-label') ?? target.textContent?.trim() ?? '', at: performance.now(),
      });
    }, true);
  });
  return { ...evidence, clicks: () => page.evaluate(() => (window as typeof window & { __uiDeliveredClicks?: Array<{ id: string; label: string; at: number }> }).__uiDeliveredClicks ?? []) };
}

async function holdResponse(page: Page, routePattern: string) {
  let release!: () => void;
  let announce!: () => void;
  let done!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { announce = resolve; });
  const finished = new Promise<void>(resolve => { done = resolve; });
  const routeErrors: string[] = [];
  await page.route(routePattern, async (route: Route) => {
    try {
      announce();
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      routeErrors.push(String(error));
      try { await route.fulfill({ status: 503, body: 'Synthetic held request was cancelled.' }); } catch { /* The browser may already have closed the request. */ }
    } finally { done(); }
  });
  return { started, finished, release, routeErrors };
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<{ settled: boolean; elapsedMs: number }> {
  const start = Date.now();
  const settled = await Promise.race([
    promise.then(() => true, () => false),
    new Promise<false>(resolve => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  return { settled, elapsedMs: Date.now() - start };
}

async function writeEvidence(name: string, value: unknown) {
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, `${name}.json`), JSON.stringify({
    buildId: buildInfo.buildId, packageRoot, origin, database, secondDatabase, ...value as object,
  }, null, 2));
}

test.describe('v0.3 UI responsiveness under a held read request', () => {
  test.beforeAll(async () => {
    mkdirSync(join(scratch, 'Workspace'), { recursive: true });
    createWorkspace(database, 'UI Synthetic One', [
      { id: 'note-a', title: 'First Note', markdown: '# First\n\n@name = <|Ada|>\n\nHello [Ada](:ref:name)' },
      { id: 'note-b', title: 'Second Note', markdown: '# Second\n\nA second synthetic note.' },
    ]);
    createWorkspace(secondDatabase, 'UI Synthetic Two', [
      { id: 'note-c', title: 'Other Workspace Note', markdown: '# Other workspace' },
    ]);
    await startServer();
  });
  test.afterAll(stopServer);
  test.beforeEach(resetPrimaryWorkspace);

  test('closing a slow projection panel leaves Reading responsive within 2 seconds', async ({ page }) => {
    const observed = await observe(page);
    await page.goto(origin);
    await expect(page.locator('#workspace-name')).toHaveText('UI Synthetic One');
    await expect(page.locator('#runtime-status')).toContainText('個值');
    const hold = await holdResponse(page, '**/api/projection/state');
    let result: { settled: boolean; elapsedMs: number } | undefined;
    try {
      await page.locator('#projection').click();
      await hold.started;
      await expect(page.locator('#modal')).toBeVisible();
      await page.locator('#modal-close').click();
      const click = page.locator('#reading').click();
      result = await settleWithin(Promise.all([click, expect(page.locator('#reading')).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 })]), 2200);
    } finally {
      hold.release(); await hold.finished;
      await writeEvidence('projection-close-reading', { result, observed, clicks: await observed.clicks(), serverLog });
    }
    expect(result?.settled, `Reading should settle within 2 seconds after closing a held projection request; observed ${result?.elapsedMs}ms`).toBe(true);
  });

  test('closing a slow Files panel leaves search and note selection responsive within 2 seconds', async ({ page }) => {
    const observed = await observe(page);
    await page.goto(origin);
    await expect(page.locator('#workspace-name')).toHaveText('UI Synthetic One');
    await expect(page.locator('#runtime-status')).toContainText('個值');
    const hold = await holdResponse(page, '**/api/files/status');
    let result: { settled: boolean; elapsedMs: number } | undefined;
    try {
      await page.locator('#files').click();
      await hold.started;
      await expect(page.locator('#modal')).toBeVisible();
      await page.locator('#modal-close').click();
      await page.getByLabel('搜尋筆記', { exact: true }).fill('Second Note');
      const click = page.locator('.note-item[data-note-id="note-b"]').click();
      result = await settleWithin(Promise.all([click, expect(page.getByLabel('筆記標題', { exact: true })).toHaveValue('Second Note', { timeout: 2000 })]), 2200);
    } finally {
      hold.release(); await hold.finished;
      await writeEvidence('files-close-search-select', { result, observed, clicks: await observed.clicks(), serverLog });
    }
    expect(result?.settled, `Search result selection should settle within 2 seconds after closing held Files status; observed ${result?.elapsedMs}ms`).toBe(true);
  });

  test('closing Files while Markdown projection refresh is pending leaves Reading responsive', async ({ page }) => {
    const observed = await observe(page);
    await page.goto(origin);
    await expect(page.locator('#workspace-name')).toHaveText('UI Synthetic One');
    await expect(page.locator('#runtime-status')).toContainText('個值');
    const hold = await holdResponse(page, '**/api/files/mirror/refresh');
    let result: { settled: boolean; elapsedMs: number } | undefined;
    try {
      await page.locator('#files').click();
      await expect(page.locator('#modal')).toBeVisible();
      await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click();
      await hold.started;
      await page.locator('#modal-close').click();
      const click = page.locator('#reading').click();
      result = await settleWithin(Promise.all([click, expect(page.locator('#reading')).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 })]), 2200);
    } finally {
      hold.release(); await hold.finished;
      await writeEvidence('files-close-mirror-refresh-reading', { result, routeErrors: hold.routeErrors, observed, clicks: await observed.clicks(), serverLog });
    }
    expect(result?.settled, `Reading should settle while a Files mirror refresh is pending; observed ${result?.elapsedMs}ms`).toBe(true);
  });

  test('a held note-file locate shows progress, keeps navigation usable, and never reveals into a switched workspace', async ({ page }) => {
    const observed = await observe(page);
    await page.goto(origin);
    await expect(page.locator('#workspace-name')).toHaveText('UI Synthetic One');
    await expect(page.locator('#runtime-status')).toContainText('個值');
    const revealRequests: Array<{ body: string; workspace: string | undefined }> = [];
    await page.route('**/api/files/reveal', async route => {
      revealRequests.push({ body: route.request().postData() ?? '', workspace: route.request().headers()['x-grasp-workspace'] });
      await route.fulfill({ status: 200, json: { path: 'Markdown/First Note.md' } });
    });
    const hold = await holdResponse(page, '**/api/files/locate');
    const observations: Record<string, unknown> = {};
    try {
      await page.locator('#reveal-note').click();
      await hold.started;
      const operationStatus = page.locator('#operation-status');
      observations.operationStatus = await operationStatus.isVisible().catch(() => false);
      observations.operationStatusText = observations.operationStatus ? await operationStatus.textContent() : null;
      const readingClick = page.locator('#reading').click();
      observations.readingWithin2Seconds = (await settleWithin(Promise.all([readingClick, expect(page.locator('#reading')).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 })]), 2200)).settled;

      await page.locator('#workspace-open').click();
      await page.getByLabel('資料庫路徑', { exact: true }).fill(secondDatabase);
      const switchClick = page.getByRole('button', { name: '開啟既有資料庫', exact: true }).click();
      observations.workspaceSwitchedWhileLocateHeld = (await settleWithin(Promise.all([switchClick, expect(page.locator('#workspace-name')).toHaveText('UI Synthetic Two', { timeout: 2000 })]), 2200)).settled;
    } finally {
      hold.release(); await hold.finished;
      await page.waitForTimeout(250);
      observations.revealRequests = revealRequests;
      observations.observed = observed;
      observations.clicks = await observed.clicks();
      observations.serverLog = serverLog;
      await writeEvidence('locate-progress-switch-guard', observations);
    }
    expect(observations.operationStatus, 'A pending locate should show the operation status').toBe(true);
    expect(observations.operationStatusText).toContain('定位筆記檔');
    expect(observations.readingWithin2Seconds).toBe(true);
    expect(observations.workspaceSwitchedWhileLocateHeld).toBe(true);
    expect(revealRequests, 'A stale locate result must not POST /files/reveal after switching workspace').toHaveLength(0);
  });

  test('a modal validation error stays visible in its dialog and preserves the form', async ({ page }) => {
    const observed = await observe(page);
    await page.goto(origin);
    await expect(page.locator('#workspace-name')).toHaveText('UI Synthetic One');
    await page.locator('#workspace-open').click();
    const path = page.getByLabel('資料庫路徑', { exact: true });
    await expect(path).toHaveValue('');
    await page.getByRole('button', { name: '開啟既有資料庫', exact: true }).click();
    await expect(page.locator('#modal')).toBeVisible();
    const notice = page.locator('#modal-notice, .modal-notice[role="alert"]');
    const visible = await notice.isVisible().catch(() => false);
    await writeEvidence('modal-validation-notice', { visible, text: visible ? await notice.textContent() : null, pathValue: await path.inputValue(), observed, clicks: await observed.clicks(), serverLog });
    expect(visible, 'Validation feedback must be visible inside the open modal').toBe(true);
    expect(await notice.textContent()).toContain('資料庫路徑');
    await expect(path).toHaveValue('');
  });

  test('a rejected shared-value command keeps its modal editor and shows the server error', async ({ page }) => {
    const observed = await observe(page);
    await page.goto(origin);
    await expect(page.locator('#workspace-name')).toHaveText('UI Synthetic One');
    await expect(page.locator('#runtime-status')).toContainText('個值');
    await page.getByRole('button', { name: '編輯共享值', exact: true }).first().click();
    await page.getByRole('button', { name: '編輯第 1 段文字', exact: true }).click();
    const commandBodies: string[] = [];
    await page.route('**/api/shared/commands', async route => {
      commandBodies.push(route.request().postData() ?? '');
      await route.fulfill({ status: 409, json: { error: 'Synthetic semantic conflict' } });
    });
    await page.getByRole('button', { name: '提交共享修改', exact: true }).click();
    const modal = page.locator('#modal');
    const notice = modal.locator('.modal-notice[role="alert"]');
    const visible = await notice.isVisible().catch(() => false);
    await writeEvidence('shared-command-conflict', {
      visible, text: visible ? await notice.textContent() : null, modalOpen: await modal.evaluate(node => (node as HTMLDialogElement).open),
      editorPresent: await modal.locator('.cm-content').count(), commandBodies, observed, clicks: await observed.clicks(), serverLog,
    });
    expect(commandBodies).toHaveLength(1);
    await expect(modal).toBeVisible();
    expect(visible, 'Rejected shared writes must explain the failure inside the modal').toBe(true);
    await expect(notice).toContainText('Synthetic semantic conflict');
    await expect(modal.locator('.cm-content')).toHaveCount(1);
  });

  test('a new note title survives the completed create transition and incomplete-draft recovery', async ({ page }) => {
    const observed = await observe(page);
    await page.goto(origin);
    await expect(page.locator('#workspace-name')).toHaveText('UI Synthetic One');
    await expect(page.locator('#runtime-status')).toContainText('個值');

    const createResponse = page.waitForResponse(response => response.url().endsWith('/api/notes') && response.request().method() === 'POST');
    const activateResponse = page.waitForResponse(response => {
      if (!response.url().endsWith('/api/settings') || response.request().method() !== 'PUT') return false;
      try { return JSON.parse(response.request().postData() ?? '{}').settings?.activeNoteId !== 'note-a'; } catch { return false; }
    });
    await page.locator('#new-note').click();
    expect((await createResponse).ok()).toBe(true);
    expect((await activateResponse).ok()).toBe(true);
    await expect(page.locator('#operation-status')).toBeHidden();
    const title = page.getByLabel('筆記標題', { exact: true });
    await expect(title).toHaveValue('未命名筆記');

    const syntheticTitle = `UI Recovery Probe ${Date.now()}`;
    await title.fill(syntheticTitle);
    await expect(title).toHaveValue(syntheticTitle);
    const mode = page.locator('#mode');
    if ((await mode.innerText()).trim() === 'Live Preview') {
      await mode.click();
      await expect(mode).toHaveText('Source');
      await expect(page.locator('#operation-status')).toBeHidden();
    }
    const source = '# Synthetic recovery probe\n\n@Incomplete = <|recovered without commit';
    const editor = page.locator('.cm-content');
    await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(source);
    await page.locator('#save').click();
    await expect(page.locator('#save-status')).toContainText('草稿已保存');
    const drafts = await (await fetch(`${origin}/api/drafts`)).json() as Array<{ title: string; markdown: string }>;
    expect(drafts).toContainEqual(expect.objectContaining({ title: syntheticTitle, markdown: source }));

    await page.reload();
    await expect(title).toHaveValue(syntheticTitle);
    await expect(page.locator('#draft-status')).toContainText('已恢復保存的草稿');
    await expect(editor).toContainText('recovered without commit');
    await page.screenshot({ path: join(evidenceRoot, 'new-note-title-draft-recovered.png'), fullPage: false });
    await writeEvidence('new-note-title-draft-recovery', { syntheticTitle, draftStored: true, titleAfterReload: await title.inputValue(), observed, clicks: await observed.clicks() });
  });
});
