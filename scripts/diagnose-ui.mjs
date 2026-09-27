import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(repo, '..', 'Scratch', 'UI-Repair-20260928-0423', 'Workspace');
const database = resolve(workspace, '.grasp', 'workspace.grasp.db');
const evidenceDir = resolve(workspace, '..', 'Evidence', `diagnose-ui-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}`);
const port = 43862;
const origin = `http://127.0.0.1:${port}`;
const acceptanceTitle = 'Grasp acceptance shared workflow';
const draftRecoveryOnly = process.env.UI_DIAG_PHASE === 'draft-recovery-only';
const buildInfo = JSON.parse(await readFile(resolve(repo, 'dist', 'build-info.json'), 'utf8'));
let child;
let serverLog = '';
let browser;
const evidence = {
  startedAt: new Date().toISOString(), origin, database, workspace, expectedBuildId: buildInfo.buildId,
  browser: 'Microsoft Edge headless', explorerOpened: false, steps: [], requests: [], responses: [], failures: [],
  consoleErrors: [], pageErrors: [], revealRequests: [], deliveredClicks: [],
};
const requestStarted = new Map();

process.on('unhandledRejection', reason => {
  evidence.unhandledRejections ??= [];
  evidence.unhandledRejections.push(reason instanceof Error ? reason.stack ?? reason.message : String(reason));
  evidence.error ??= 'Unhandled promise rejection';
  void saveEvidence().finally(() => { process.exitCode = 1; });
});

function recordStep(name, startedAt, ok, detail = undefined) {
  evidence.steps.push({ name, elapsedMs: Date.now() - startedAt, ok, ...(detail === undefined ? {} : { detail }) });
}

async function step(name, action) {
  const startedAt = Date.now();
  try {
    const result = await action(); recordStep(name, startedAt, true, result); await saveEvidence(); return result;
  } catch (error) {
    recordStep(name, startedAt, false, error instanceof Error ? error.message : String(error)); await saveEvidence(); throw error;
  }
}

async function skipStep(name, reason) {
  evidence.steps.push({ name, skipped: true, reason });
  await saveEvidence();
}

async function currentHost() {
  try {
    const response = await fetch(`${origin}/api/host`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok || response.headers.get('x-graspportable') !== '1') throw new Error(`43862 is occupied by an unverifiable service (HTTP ${response.status}).`);
    return { response, info: await response.json() };
  } catch (error) {
    if (error?.cause?.code === 'ECONNREFUSED' || error?.name === 'TimeoutError' || /fetch failed/i.test(String(error))) return undefined;
    throw error;
  }
}

async function ensureHost() {
  let host = await currentHost();
  if (!host) {
    child = spawn(process.execPath, ['dist/server.mjs'], {
      cwd: repo,
      env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: database },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    child.stdout.on('data', data => { serverLog += String(data); });
    child.stderr.on('data', data => { serverLog += String(data); });
    for (let attempt = 0; attempt < 300; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`The isolated 43862 host exited before ready: ${serverLog}`);
      host = await currentHost();
      if (host) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (!host) throw new Error(`Timed out starting the 43862 host: ${serverLog}`);
  const pathEqual = resolve(host.info.path).toLowerCase() === resolve(database).toLowerCase();
  const buildId = host.response.headers.get('x-graspportable-build');
  if (!pathEqual) throw new Error(`43862 points at a different workspace: ${host.info.path}`);
  if (buildId !== buildInfo.buildId) throw new Error(`43862 uses build ${buildId}; expected ${buildInfo.buildId}. I will not stop a host I did not start.`);
  evidence.hostPath = host.info.path; evidence.buildId = buildId; evidence.serverStartedByThisScript = !!child;
}

function observe(page) {
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('request', request => {
    requestStarted.set(request, Date.now()); evidence.requests.push({ url: request.url(), method: request.method(), at: Date.now() });
  });
  page.on('requestfinished', async request => {
    evidence.responses.push({ url: request.url(), method: request.method(), elapsedMs: Date.now() - (requestStarted.get(request) ?? Date.now()), status: (await request.response())?.status() ?? null });
  });
  page.on('requestfailed', request => {
    evidence.failures.push({ url: request.url(), method: request.method(), elapsedMs: Date.now() - (requestStarted.get(request) ?? Date.now()), error: request.failure()?.errorText ?? null });
  });
}

async function selectAcceptanceNote(page) {
  const search = page.getByLabel('搜尋筆記', { exact: true });
  await search.fill(acceptanceTitle);
  const note = page.locator('.note-item').filter({ hasText: acceptanceTitle });
  await note.waitFor({ state: 'visible', timeout: 30_000 });
  await note.click();
  await page.getByLabel('筆記標題', { exact: true }).waitFor({ state: 'visible' });
  await page.getByLabel('筆記標題', { exact: true }).evaluate((node, title) => {
    if (node.value !== title) throw new Error(`Selected unexpected note title: ${node.value}`);
  }, acceptanceTitle);
}

async function captureClicks(page) {
  evidence.deliveredClicks = await page.evaluate(() => (window.__uiDeliveredClicks ?? []));
}

async function saveEvidence() {
  await mkdir(evidenceDir, { recursive: true });
  evidence.finishedAt = new Date().toISOString(); evidence.serverLog = serverLog;
  await writeFile(resolve(evidenceDir, 'ui-diagnosis.json'), JSON.stringify(evidence, null, 2));
}

try {
  await ensureHost();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  browser.on('disconnected', () => { evidence.browserDisconnectedAt = new Date().toISOString(); void saveEvidence(); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage(); observe(page);
  await page.addInitScript(() => {
    window.__uiDeliveredClicks = [];
    document.addEventListener('click', event => {
      const target = (event.target instanceof HTMLElement ? event.target : null)?.closest('button,[role="button"],a,input');
      if (target) window.__uiDeliveredClicks.push({ id: target.id, label: target.getAttribute('aria-label') ?? target.textContent?.trim() ?? '', at: performance.now() });
    }, true);
  });
  await page.route('**/api/files/reveal', async route => {
    evidence.revealRequests.push({ method: route.request().method(), body: route.request().postData(), workspace: route.request().headers()['x-grasp-workspace'], at: Date.now() });
    await route.fulfill({ status: 200, json: { path: 'Markdown/Acceptance note.md' } });
  });

  await step('open copied workspace and wait for runtime', async () => {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#workspace-name').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#runtime-status').getByText('個值', { exact: false }).waitFor({ state: 'visible', timeout: 120_000 });
  });

  if (draftRecoveryOnly) await skipStep('search and select the synthetic acceptance workflow note', 'Draft-only confirmation reuses the already-selected synthetic note and persisted draft.');
  else await step('search and select the synthetic acceptance workflow note', () => selectAcceptanceNote(page));

  const exerciseModes = async () => {
    const mode = page.locator('#mode'), reading = page.locator('#reading');
    const waitMode = label => page.waitForFunction(expected => document.querySelector('#mode')?.textContent?.trim() === expected, label, { timeout: 15_000 });
    if (await reading.getAttribute('aria-pressed') === 'true') {
      await reading.click();
      await page.waitForFunction(() => document.querySelector('#reading')?.getAttribute('aria-pressed') === 'false', null, { timeout: 15_000 });
    }
    if ((await mode.innerText()).trim() !== 'Source') {
      await mode.click(); await waitMode('Source');
    }
    await mode.click(); await waitMode('Live Preview');
    await mode.click(); await waitMode('Source');
    await mode.click(); await waitMode('Live Preview');
    const stateBeforeReading = await reading.getAttribute('aria-pressed');
    await reading.click();
    await page.waitForFunction(() => document.querySelector('#reading')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10_000 });
    await reading.click();
    await page.waitForFunction(() => document.querySelector('#reading')?.getAttribute('aria-pressed') === 'false', null, { timeout: 10_000 });
    return { modeLabelAfterToggle: await mode.innerText(), initialReadingPressed: stateBeforeReading };
  };
  if (draftRecoveryOnly) await skipStep('exercise Live Preview, Source and Reading mode transitions', 'Draft-only confirmation skips unrelated mode transitions.');
  else await step('exercise Live Preview, Source and Reading mode transitions', exerciseModes);

  const navigateReference = async () => {
    const card = page.locator('.value-card').filter({ has: page.getByRole('button', { name: 'M4.Root', exact: true }) });
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    await card.getByRole('button', { name: 'References', exact: true }).click();
    await page.locator('.reference-detail').filter({ has: page.getByRole('heading', { name: 'M4.Root', exact: true }) }).waitFor({ state: 'visible' });
    const references = page.locator('.reference-detail .reference-link');
    const count = await references.count();
    if (!count) throw new Error('M4.Root has no navigable references in the acceptance note.');
    await references.first().click();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.cm-content'), null, { timeout: 15_000 });
    return { referencesFound: count, activeTitle: await page.getByLabel('筆記標題', { exact: true }).inputValue() };
  };
  if (draftRecoveryOnly) await skipStep('navigate to a M4.Root reference and back to its definition', 'Draft-only confirmation skips unrelated reference navigation.');
  else await step('navigate to a M4.Root reference and back to its definition', navigateReference);

  const sharedEdit = async () => {
    const card = page.locator('.value-card').filter({ has: page.getByRole('button', { name: 'M4.Root', exact: true }) });
    const value = card.locator('.value-text');
    const oldValue = (await value.innerText()).trim();
    const nestedBefore = await (await fetch(`${origin}/api/shared/state`)).json();
    const nestedInitial = nestedBefore.semantic.results.find(item => item.name === 'M4.Nested')?.current;
    const changedValue = `${oldValue} · UI diagnosis`;
    await card.getByRole('button', { name: '編輯共享值', exact: true }).click();
    await page.getByRole('button', { name: '編輯第 1 段文字', exact: true }).click();
    const editor = page.locator('#modal .cm-content');
    await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(changedValue);
    await page.getByRole('button', { name: '提交共享修改', exact: true }).click();
    await page.locator('#modal').waitFor({ state: 'hidden' });
    await page.locator('.value-card').filter({ has: page.getByRole('button', { name: 'M4.Root', exact: true }) }).locator('.value-text').getByText(changedValue, { exact: true }).waitFor({ state: 'visible' });
    const nestedAfterEditState = await (await fetch(`${origin}/api/shared/state`)).json();
    const nestedAfterEdit = nestedAfterEditState.semantic.results.find(item => item.name === 'M4.Nested')?.current;
    if (JSON.stringify(nestedInitial) === JSON.stringify(nestedAfterEdit)) throw new Error('M4.Nested did not change after editing its M4.Root dependency.');
    await page.getByRole('button', { name: '撤銷共享修改', exact: true }).click();
    const restored = page.locator('.value-card').filter({ has: page.getByRole('button', { name: 'M4.Root', exact: true }) }).locator('.value-text');
    await restored.getByText(oldValue, { exact: true }).waitFor({ state: 'visible' });
    const nestedAfterUndoState = await (await fetch(`${origin}/api/shared/state`)).json();
    const nestedAfterUndo = nestedAfterUndoState.semantic.results.find(item => item.name === 'M4.Nested')?.current;
    if (JSON.stringify(nestedInitial) !== JSON.stringify(nestedAfterUndo)) throw new Error('Shared undo did not restore M4.Nested.');
    return { before: oldValue, temporaryValue: changedValue, restored: (await restored.innerText()).trim(), nestedBefore: nestedInitial, nestedAfterEdit, nestedAfterUndo };
  };
  if (draftRecoveryOnly || process.env.UI_DIAG_PHASE === 'files-draft') {
    await skipStep('edit M4.Root, verify shared update, and undo it', 'Bounded diagnostic phase skips the already-verified shared edit/undo to avoid creating another large-corpus checkpoint.');
  } else await step('edit M4.Root, verify shared update, and undo it', sharedEdit);

  const inspectProjection = async () => {
    await page.locator('#projection').click();
    await page.waitForFunction(() => {
      const body = document.querySelector('#modal-body');
      return !!body?.querySelector('.gp-projection-panel, .validation-error');
    }, null, { timeout: 320_000 });
    const loadError = await page.locator('#modal-body .validation-error').first().textContent().catch(() => null);
    if (loadError) throw new Error(`Projection panel failed to load: ${loadError}`);
    await page.locator('.gp-projection-panel').waitFor({ state: 'visible' });
    const search = page.getByLabel('搜尋分組資料'); await search.fill('M4.Root');
    await page.locator('.gp-projection-unit').filter({ hasText: 'M4.Root' }).first().waitFor({ state: 'visible' });
    const matchingUnits = await page.locator('.gp-projection-unit').count();
    await page.locator('#modal-close').click();
    return { matchingUnits };
  };
  if (draftRecoveryOnly) await skipStep('inspect projection grouping search without applying a strategy', 'Draft-only confirmation reuses the already-recorded Projection evidence.');
  else await step('inspect projection grouping search without applying a strategy', inspectProjection);

  const inspectFiles = async () => {
    const statusResponse = page.waitForResponse(response => response.url().includes('/api/files/status') && response.request().method() === 'GET', { timeout: 320_000 });
    const hostResponse = page.waitForResponse(response => response.url().endsWith('/api/host') && response.request().method() === 'GET', { timeout: 320_000 });
    const listResponse = page.waitForResponse(response => response.url().includes('/api/files?') && response.request().method() === 'GET', { timeout: 320_000 });
    await page.locator('#files').click();
    await page.locator('.gp-files-panel').waitFor({ state: 'visible', timeout: 320_000 });
    const [status, host, listing] = await Promise.all([statusResponse, hostResponse, listResponse]);
    for (const [name, response] of [['status', status], ['host', host], ['file listing', listing]]) {
      if (!response.ok()) throw new Error(`Files ${name} request failed with HTTP ${response.status()}.`);
    }
    await page.locator('.gp-files-count').first().waitFor({ state: 'visible', timeout: 320_000 });
    if (await page.locator('.gp-files-error').count()) throw new Error(`Files panel reported an error: ${await page.locator('.gp-files-error').first().innerText()}`);
    const fileCount = (await page.locator('.gp-files-count').first().innerText()).trim();
    await page.getByLabel('搜尋檔案或附件', { exact: true }).waitFor({ state: 'visible' });
    await page.locator('#modal-close').click();
    return { fileCount, statusHttp: status.status(), hostHttp: host.status(), listingHttp: listing.status() };
  };
  if (draftRecoveryOnly) await skipStep('open Files panel and load full workspace file status', 'Draft-only confirmation reuses the already-recorded Files evidence.');
  else await step('open Files panel and load full workspace file status', inspectFiles);

  const locateNote = async () => {
    const locate = page.waitForResponse(response => response.url().includes('/api/files/locate') && response.request().method() === 'POST', { timeout: 310_000 });
    const reveal = page.waitForResponse(response => response.url().includes('/api/files/reveal') && response.request().method() === 'POST', { timeout: 330_000 })
      .then(response => ({ response }), error => ({ error }));
    const operationStatus = page.locator('#operation-status');
    await page.locator('#reveal-note').click();
    const statusVisible = await operationStatus.isVisible().catch(() => false);
    const statusText = statusVisible ? await operationStatus.textContent() : null;
    const response = await locate;
    if (!response.ok()) throw new Error(`Locate failed with HTTP ${response.status()}.`);
    const entry = await response.json();
    if (!entry.path || !entry.absolutePath) throw new Error(`Locate response omitted its file path: ${JSON.stringify(entry)}`);
    const locatedFile = await stat(entry.absolutePath);
    if (!locatedFile.isFile()) throw new Error(`Located note path is not a file: ${entry.absolutePath}`);
    const revealResult = await reveal;
    if (revealResult.error) throw new Error(`Explorer reveal request was not sent after locate: ${revealResult.error.message}`);
    const revealBody = JSON.parse(evidence.revealRequests.at(-1)?.body ?? 'null');
    if (revealBody?.path !== entry.path) throw new Error(`Reveal request path did not match located file: ${entry.path}`);
    return { elapsedMs: evidence.responses.find(item => item.url.includes('/api/files/locate'))?.elapsedMs, statusVisible, statusText, locatedRelativePath: entry.path, locatedAbsolutePath: entry.absolutePath, locatedFileExists: true, locatedFileBytes: locatedFile.size, revealIntercepted: evidence.revealRequests.length };
  };
  if (draftRecoveryOnly) await skipStep('locate current note and intercept Explorer reveal', 'Draft-only confirmation reuses the already-recorded file-location evidence.');
  else await step('locate current note and intercept Explorer reveal', locateNote);

  if (draftRecoveryOnly) {
    await step('recover the persisted incomplete synthetic draft', async () => {
      const restoreDrafts = page.getByRole('button', { name: /恢復草稿/ });
      await restoreDrafts.waitFor({ state: 'visible', timeout: 30_000 });
      await restoreDrafts.click();
      await page.locator('#modal').waitFor({ state: 'visible' });
      const recover = page.locator('#modal-body').getByRole('button', { name: '恢復', exact: true });
      if (await recover.count() !== 1) throw new Error(`Expected one recoverable synthetic draft, found ${await recover.count()}.`);
      await recover.click();
      await page.locator('#modal').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('#draft-status')?.textContent?.includes('已恢復保存的草稿'), null, { timeout: 30_000 });
      const recoveredSource = page.locator('.cm-content');
      await recoveredSource.getByText('recovered without commit', { exact: false }).waitFor({ state: 'visible', timeout: 15_000 });
      return { recovered: true, title: await page.getByLabel('筆記標題', { exact: true }).inputValue(), sourceContainsIncompleteSyntax: true };
    });
  } else await step('persist and recover an incomplete draft in a new synthetic note', async () => {
    const before = await (await fetch(`${origin}/api/workspace`)).json();
    const create = page.waitForResponse(response => response.url().endsWith('/api/notes') && response.request().method() === 'POST', { timeout: 30_000 });
    await page.locator('#new-note').click();
    const title = page.getByLabel('筆記標題', { exact: true });
    await title.waitFor({ state: 'visible' });
    const createResponse = await create;
    if (!createResponse.ok()) throw new Error(`Synthetic note creation failed with HTTP ${createResponse.status()}.`);
    const created = await createResponse.json();
    const createdNote = created.notes.find(note => !before.notes.some(previous => previous.id === note.id));
    if (!createdNote) throw new Error('The create response did not include a new synthetic note.');
    await page.locator('#operation-status').waitFor({ state: 'hidden', timeout: 30_000 });
    const activeWorkspace = await (await fetch(`${origin}/api/workspace`)).json();
    if (activeWorkspace.settings.activeNoteId !== createdNote.id) throw new Error(`Create transition did not activate its new note (${createdNote.id}).`);
    await page.waitForFunction(() => document.querySelector('#note-title')?.value === '未命名筆記', null, { timeout: 15_000 });
    const syntheticTitle = `UI Recovery Probe ${Date.now()}`;
    await title.fill(syntheticTitle);
    const mode = page.locator('#mode');
    if ((await mode.innerText()).trim() === 'Live Preview') await mode.click();
    const source = '# Synthetic recovery probe\n\n@Incomplete = <|recovered without commit';
    const editor = page.locator('.cm-content');
    await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(source);
    await page.locator('#save').click();
    await page.locator('#save-status').getByText('草稿已保存', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 });
    const persistedDrafts = await (await fetch(`${origin}/api/drafts`)).json();
    const persistedDraft = persistedDrafts.find(draft => draft.noteId === createdNote.id);
    if (persistedDraft?.title !== syntheticTitle || persistedDraft?.markdown !== source) throw new Error(`Persisted draft title/source differ: ${JSON.stringify({ title: persistedDraft?.title, markdownMatches: persistedDraft?.markdown === source })}`);
    await page.reload();
    await page.locator('#draft-status').getByText('已恢復保存的草稿', { exact: false }).waitFor({ state: 'visible', timeout: 60_000 });
    await editor.getByText('recovered without commit', { exact: false }).waitFor({ state: 'visible' });
    if (await title.inputValue() !== syntheticTitle) throw new Error(`Reload restored title ${await title.inputValue()} instead of ${syntheticTitle}.`);
    return { syntheticTitle, recoveredTitle: await title.inputValue(), persistedDraftTitle: persistedDraft.title, createdNoteId: createdNote.id, draftRecovered: true, retainedAsDraft: true };
  });

  await captureClicks(page);
  if (evidence.pageErrors.length) throw new Error(`Browser page errors: ${evidence.pageErrors.join(' | ')}`);
  if (evidence.failures.length) throw new Error(`Browser requests failed: ${JSON.stringify(evidence.failures)}`);
  await page.screenshot({ path: resolve(evidenceDir, 'full-corpus-1440x1000.png'), fullPage: false });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: resolve(evidenceDir, 'full-corpus-1024x768.png'), fullPage: false });
  await page.screenshot({ path: resolve(evidenceDir, 'synthetic-draft-recovered.png'), fullPage: false });
  evidence.finishedAt = new Date().toISOString();
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, 'ui-diagnosis.json'), JSON.stringify({ ...evidence, serverLog }, null, 2));
  console.log(JSON.stringify({ evidenceDir, buildId: evidence.buildId, steps: evidence.steps, revealRequests: evidence.revealRequests.length, explorerOpened: false }, null, 2));
} catch (error) {
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  try {
    if (browser) {
      const contexts = browser.contexts();
      const page = contexts[0]?.pages()[0];
      if (page) await page.screenshot({ path: resolve(evidenceDir, 'failure.png'), fullPage: false });
    }
  } catch { /* Preserve the original diagnostic failure. */ }
  await saveEvidence();
  console.error(JSON.stringify({ evidenceDir, error: evidence.error, steps: evidence.steps }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  }
}
