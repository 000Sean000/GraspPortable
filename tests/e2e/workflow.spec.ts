import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';

const port = 43829;
const url = `http://127.0.0.1:${port}`;
const folder = resolve('.cache/e2e', String(Date.now()));
const database = resolve(folder, 'test.grasp.db');
let server: ChildProcess;
let workspacePath = database;
const sample = '# 實際使用驗證\n\n中文 Markdown，**粗體**與 *斜體*。\n\n@first = "Sean"\n@last = "Wu"\n@full = "{first} {last}"\n@greeting = "你好，{full}！"\n@unrelated = "unchanged"\n\n今天：{{greeting}}\n\nEnd';
async function start() {
  server = spawn(process.execPath, ['dist/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GRASP_WORKSPACE: workspacePath }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; server.stdout!.on('data', data => logs += data); server.stderr!.on('data', data => logs += data);
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { if ((await fetch(url + '/api/workspace')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Startup timeout: ${logs}`);
}
async function stop() { if (server && server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
async function snapshot() { return await (await fetch(url + '/api/workspace')).json(); }
async function saved(page: Page) { await expect(page.locator('#save-status')).toHaveText('✓ 已儲存至 SQLite'); await expect(page.locator('#runtime-status')).toContainText('個值'); }
async function source(page: Page, markdown: string) {
  if ((await page.locator('#mode').innerText()) === 'Live Preview') await page.locator('#mode').click();
  const content = page.locator('.cm-content'); await content.click(); await page.keyboard.press('ControlOrMeta+a');
  if (markdown.length > 20000) {
    // Large real user edits arrive through paste; CDP insertText synthesizes a
    // single IME event and makes Chromium construct thousands of DOM lines first.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    try { await page.evaluate(text => navigator.clipboard.writeText(text), markdown); await page.keyboard.press('ControlOrMeta+v'); }
    finally { await page.evaluate(text => navigator.clipboard.writeText(text), clipboard); }
  } else await page.keyboard.insertText(markdown);
  await page.locator('#save').click(); await saved(page);
}
function value(page: Page, name: string) { return page.locator('.value-card').filter({ has: page.getByRole('button', { name, exact: true }) }).locator('.value-text'); }

test.describe.serial('production build complete workflow', () => {
  test.beforeAll(async () => { mkdirSync(folder, { recursive: true }); mkdirSync('docs/benchmarks', { recursive: true }); await start(); });
  test.afterAll(stop);

  test('create workspace, write Markdown, reactive nested values, definition/references, cycle recovery, undo', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await saved(page);
    await page.locator('#workspace-open').click();
    workspacePath = resolve(folder, 'created.grasp.db');
    await page.getByLabel('資料庫路徑').fill(workspacePath); await page.getByLabel('新 workspace 名稱').fill('驗證工作區'); await page.getByRole('button', { name: '建立新 workspace', exact: true }).click();
    await expect(page.locator('#workspace-name')).toHaveText('驗證工作區');
    await page.getByLabel('筆記標題', { exact: true }).fill('我的測試筆記'); await source(page, sample);
    await expect(value(page, 'greeting')).toHaveText('你好，Sean Wu！');
    await source(page, sample.replace('"Sean"', '"小明"'));
    await expect(value(page, 'greeting')).toHaveText('你好，小明 Wu！');
    await expect(page.locator('#runtime-status')).toContainText('重算 3');
    const committed = await snapshot(); expect(committed.notes[0].markdown).toContain('{{greeting}}'); expect(committed.notes[0].markdown).not.toContain('你好，小明');
    await page.locator('#mode').click();
    await expect(page.locator('.gp-strong')).toHaveText('粗體'); await expect(page.locator('.cm-editor')).toHaveCount(1);
    await page.locator('.gp-value[data-identifier="greeting"] .gp-value-text').last().click();
    await expect(page.locator('.cm-content')).toContainText('@greeting =');
    await page.locator('.value-card').filter({ has: page.getByRole('button', { name: 'full', exact: true }) }).getByRole('button', { name: 'References', exact: true }).click();
    await expect(page.locator('.reference-detail')).toContainText('第 8 行');
    await source(page, sample + '\n@cycle_a = "{cycle_b}"\n@cycle_b = "{cycle_a}"\n{{missing}}');
    await page.locator('#tab-issues').click(); await expect(page.locator('.issue-card').filter({ hasText: 'cycle' }).first()).toBeVisible(); await expect(page.locator('.issue-card').filter({ hasText: 'missing' }).first()).toBeVisible();
    await source(page, sample); await page.locator('#tab-values').click(); await expect(value(page, 'greeting')).toHaveText('你好，Sean Wu！');
    await page.locator('.cm-content').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n中文補充'); await page.locator('#save').click(); await saved(page);
    await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+z'); await page.locator('#save').click(); await saved(page); expect((await snapshot()).notes[0].markdown).toBe(sample);
    await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+Shift+z'); await page.locator('#save').click(); await saved(page); expect((await snapshot()).notes[0].markdown).toBe(sample + '\n中文補充');
    expect(errors).toEqual([]);
  });

  test('structured records, reactive table and safe controlled Markdown export/import with recovery', async ({ page }) => {
    await page.goto(url); await saved(page);
    await page.locator('#tab-records').click(); await page.getByRole('button', { name: '＋ 新增 record' }).click();
    await page.getByLabel('Record 名稱').fill('flame');
    const values = page.getByLabel('欄位值', { exact: true }); await values.nth(0).fill('{first} 的 Aura'); await values.nth(1).fill('fire');
    await page.getByRole('button', { name: '儲存 record', exact: true }).click(); await expect(page.locator('.record-card')).toContainText('Sean 的 Aura');
    await page.getByRole('button', { name: '建立 table 筆記', exact: true }).click(); await saved(page);
    if ((await page.locator('#mode').innerText()) === 'Source') await page.locator('#mode').click();
    await expect(page.locator('.gp-query')).toContainText('Sean 的 Aura');
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadPromise; const downloaded = await download.path(); const exported = readFileSync(downloaded!, 'utf8');
    expect(exported).toContain('grasp-workspace'); expect(exported).toContain('{{greeting}}'); expect(exported).toContain('aura');
    const external = exported.replace('@first = "Sean"', '@first = "AI 修改"');
    expect((await snapshot()).notes[0].markdown).toContain('"Sean"');
    await page.locator('#import').click(); await page.getByLabel('匯入 Markdown', { exact: true }).fill(external); await page.getByRole('button', { name: '驗證並檢視差異' }).click();
    await expect(page.locator('.diff-before')).toContainText('@first = "Sean"'); await expect(page.locator('.diff-after')).toContainText('@first = "AI 修改"');
    expect((await snapshot()).notes[0].markdown).toContain('"Sean"');
    await page.getByRole('button', { name: '確認套用至資料庫' }).click(); await expect(page.locator('#modal')).not.toBeVisible(); await expect(page.locator('.gp-query')).toContainText('AI 修改 的 Aura');
    await page.locator('#history').click(); await page.getByRole('button', { name: '檢查復原' }).first().click(); await page.getByRole('button', { name: '確認復原', exact: true }).click();
    await expect(page.locator('.gp-query')).toContainText('Sean 的 Aura');
    await page.locator('#import').click(); await page.getByLabel('匯入 Markdown', { exact: true }).fill(exported.replace('grasp-end ', 'BROKEN ')); await page.getByRole('button', { name: '驗證並檢視差異' }).click(); await expect(page.getByRole('button', { name: '確認套用至資料庫' })).toBeDisabled();
    expect((await snapshot()).notes[0].markdown).toContain('"Sean"'); await page.locator('#modal-close').click();
  });

  test('actual host stop and restart preserves DB authority, records, values and selected note', async ({ page }) => {
    const before = await snapshot(); await stop(); await start(); const after = await snapshot(); expect(after).toEqual(before);
    await page.goto(url); await saved(page); await expect(page.locator('#workspace-name')).toHaveText('驗證工作區');
    await page.locator('.note-item').filter({ hasText: 'aura' }).click();
    if ((await page.locator('#mode').innerText()) === 'Source') await page.locator('#mode').click();
    await expect(page.locator('.gp-query')).toContainText('Sean 的 Aura');
    await page.screenshot({ path: 'docs/benchmarks/product-table.png', fullPage: true });
  });

  test('large reference workload remains editable while worker recalculates', async ({ page }) => {
    await page.goto(url); await saved(page); await page.locator('#new-note').click(); await page.getByLabel('筆記標題', { exact: true }).fill('Performance workload');
    const size = 12000;
    const markdown = '# Workload\n\n@root_value = "A"\n' + Array.from({ length: size }, (_, i) => `@v${i} = "{root_value}:${i}"`).join('\n') + '\n\n' + Array.from({ length: 1000 }, (_, i) => `{{v${i}}}`).join(' ') + '\n';
    await source(page, markdown); await expect(page.locator('#runtime-status')).toContainText('12008 個值');
    const measurements: number[] = [];
    const content = page.locator('.cm-content'); await content.focus(); await page.keyboard.press('ControlOrMeta+End');
    await page.evaluate(() => {
      (window as any).__longTasks = []; (window as any).__backgroundInputs = [];
      document.addEventListener('beforeinput', () => { (window as any).__backgroundInputs.push({ time: performance.now(), status: document.querySelector('#runtime-status')!.textContent }); }, true);
      try { new PerformanceObserver(list => { for (const item of list.getEntries()) (window as any).__longTasks.push(item.duration); }).observe({ type: 'longtask', buffered: false }); } catch {}
    });
    for (let i = 0; i < 25; i++) { const t = performance.now(); await page.keyboard.insertText('中'); measurements.push(performance.now() - t); }
    await page.locator('#save').click(); await saved(page); expect((await snapshot()).notes.find((n: any) => n.title === 'Performance workload').markdown).toContain('中'.repeat(25));
    await page.locator('#mode').click(); await saved(page);
    await content.focus(); await page.keyboard.press('ControlOrMeta+End');
    const liveInputs: number[] = [];
    for (let i = 0; i < 12; i++) { const t = performance.now(); await page.keyboard.insertText('即'); liveInputs.push(performance.now() - t); }
    await page.locator('#save').click(); await saved(page);
    // Schedule a 12k-node recalculation, then send genuine input while the committed snapshot is dispatched to the worker.
    const state = await snapshot(); const heavy = state.notes.find((n: any) => n.title === 'Performance workload');
    await content.focus(); await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ControlOrMeta+f'); await page.getByPlaceholder('Find').fill(''); await page.getByPlaceholder('Find').pressSequentially('"A"'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('"A"');
    // Search commands preserve a real editor selection; replacing its short value
    // triggers a large dependency cascade without replacing the whole document.
    await page.keyboard.insertText('"B"');
    const response = page.waitForResponse(r => r.url().includes('/api/notes/') && r.request().method() === 'PUT');
    await page.keyboard.press('ControlOrMeta+s'); await response;
    const duringRecalculation: number[] = [];
    // Keep focus at the declaration: no locator/focus/scroll roundtrip can hide
    // a fast calculation before the first input. Trailing spaces keep grammar valid.
    for (let i = 0; i < 12; i++) { const t = performance.now(); await page.keyboard.press('Space'); duringRecalculation.push(performance.now() - t); }
    await page.locator('#save').click(); await saved(page);
    const final = (await snapshot()).notes.find((n: any) => n.id === heavy.id);
    expect(final.markdown.slice(0, 80)).toContain('@root_value = "B"' + ' '.repeat(12));
    await page.getByLabel('搜尋 identifier', { exact: true }).fill('v0'); await expect(value(page, 'v0')).toHaveText('B:0');
    const longTasks = await page.evaluate(() => (window as any).__longTasks as number[]);
    measurements.sort((a, b) => a - b);
    const inputs = await page.evaluate(() => (window as any).__backgroundInputs as Array<{ time: number; status: string }>);
    const evidence = { timestamp: new Date().toISOString(), browser: 'Chromium/Edge', definitionCount: size + 1, inlineReferences: 1000, typingSamples: measurements.length, sourceInputP50Ms: measurements[Math.floor(measurements.length * .5)], sourceInputP95Ms: measurements[Math.floor(measurements.length * .95)], sourceInputMaxMs: Math.max(...measurements), liveInputMs: liveInputs, inputDuringCascadeMs: duringRecalculation, inputsObservedWhileCalculating: inputs.filter(input => input.status === '背景計算中…').length, longTasksMs: longTasks, note: 'Automation-to-browser input completion includes driver overhead. Browser beforeinput records explicitly count overlap with pending background calculation. Remaining cascade samples may immediately follow computation. Long-task observation includes save/sidebar/input, not a physical IME latency claim.' };
    writeFileSync('docs/benchmarks/editor-responsiveness.json', JSON.stringify(evidence, null, 2));
    expect(measurements[Math.floor(measurements.length * .95)]).toBeLessThan(500);
    expect(Math.max(...liveInputs)).toBeLessThan(500); expect(Math.max(...duringRecalculation)).toBeLessThan(500);
    expect(evidence.inputsObservedWhileCalculating).toBeGreaterThan(0);
  });
});
