import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { existsSync } from 'node:fs';
import type { RuntimeResult } from '../src/domain/model';

const hasChromium = existsSync(chromium.executablePath());
const hasEdge = process.platform === 'win32' && existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const runtime: RuntimeResult = { revision: 1, values: { name: { value: 'Sean', status: 'ok' }, 'aura.bright.element': { value: 'fire', status: 'ok' } }, definitions: [], references: [], diagnostics: [], metrics: { elapsedMs: 1, recalculated: 1, total: 1, affected: 1 } };
const sample = '# 編輯中\n\n## Preview\n\n**Bold** and *italic* and `{{name}}`.\n\n@name = "Sean"\n\nHello {{name}}\n\n[Profile {{name}}](https://example.com/{{name}})\n\n- [ ] Read\n\n```grasp-query\n{"collection":"aura"}\n```\n\nEnd';

describe.skipIf(!hasChromium && !hasEdge)('real browser editor adapter', () => {
  let server: ViteDevServer; let browser: Browser; let page: Page;
  const errors: string[] = [];
  beforeAll(async () => {
    server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'editor-test-harness', configureServer(server) {
      server.middlewares.use('/__editor-test', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__editor-test', '<!doctype html><button id="save">Save</button><div id="editor"></div><script type="module">import {createEditor} from "/src/editor/editor.ts"; window.changes=[]; window.navigation=[]; window.references=[]; window.editor=createEditor(document.querySelector("#editor"),{onChange:s=>window.changes.push(s),onNavigate:s=>{window.navigation.push(s);window.testNavigate?.(s)},onFindReferences:s=>window.references.push(s)});</script>'));
      });
    } }] });
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(!hasChromium ? { channel: 'msedge' } : {}) });
    page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}__editor-test`);
    await page.waitForFunction(() => Boolean((window as any).editor));
  }, 30000);
  afterAll(async () => { await browser?.close(); await server?.close(); });

  it('renders in one surface, excludes code references, and presents reactive query values', async () => {
    await page.evaluate(({ sample, runtime }) => {
      (window as any).editor.setDocument(sample);
      (window as any).editor.setRuntime(runtime, [{ id: '1', collection: 'aura', name: 'bright', fields: { element: '{name}' }, revision: 1 }]);
    }, { sample, runtime });
    await page.waitForSelector('.gp-query td');
    expect(await page.locator('.gp-value[data-identifier="name"]').count()).toBe(2);
    expect(await page.locator('.gp-query').innerText()).toContain('fire');
    expect(await page.locator('.gp-strong').innerText()).toBe('Bold');
    expect(await page.locator('.gp-emphasis').innerText()).toBe('italic');
    expect(await page.locator('.gp-task').count()).toBe(1);
    expect(await page.locator('.gp-link').innerText()).toBe('Profile Sean');
    expect(await page.locator('.gp-link').getAttribute('href')).toBe('https://example.com/Sean');
    expect(await page.evaluate(() => (window as any).changes)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('supports definition, references, query editing and source reveal', async () => {
    await page.locator('.gp-value-text').last().click();
    await page.locator('.gp-value-references').last().click();
    expect(await page.evaluate(() => (window as any).navigation)).toEqual(['name']);
    expect(await page.evaluate(() => (window as any).references)).toEqual(['name']);
    await page.getByRole('button', { name: '編輯查詢' }).click();
    expect(await page.locator('.gp-query').count()).toBe(0);
    expect(await page.locator('.cm-content').innerText()).toContain('grasp-query');
    await page.evaluate(() => (window as any).editor.setMode('source'));
    expect(await page.locator('.gp-value').count()).toBe(0);
    expect(await page.locator('.cm-content').innerText()).toContain('**Bold**');
    // Mouse navigation must reveal/select a live declaration, not merely log a callback.
    const source = '# Welcome\n\n## Values\n\n@name = "Sean"\n\nHello {{name}}\n';
    const declaration = '@name = "Sean"';
    await page.evaluate(({ source, declaration, runtime }) => {
      const e = (window as any).editor; e.setMode('live'); e.setDocument(source); e.setRuntime(runtime); e.focusRange(0, 0);
      (window as any).testNavigate = async () => { await Promise.resolve(); const from = source.indexOf(declaration); e.focusRange(from, from + declaration.length); };
    }, { source, declaration, runtime });
    await page.locator('.gp-value:not(.gp-declaration) .gp-value-text').click();
    await page.waitForFunction(declaration => window.getSelection()?.toString() === declaration, declaration);
    expect(await page.locator('.cm-content').innerText()).toContain(declaration);
    expect(await page.locator('.gp-declaration').count()).toBe(0);
    await page.keyboard.insertText('@name = "小明"');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source.replace(declaration, '@name = "小明"'));
    await page.evaluate(() => { (window as any).testNavigate = undefined; });
    expect(errors).toEqual([]);
  });

  it('preserves undo and selection across a background runtime update', async () => {
    await page.evaluate(() => { const e = (window as any).editor; e.setDocument('中文開始'); e.focusRange(4, 4); });
    await page.keyboard.insertText(' English');
    await page.evaluate(runtime => (window as any).editor.setRuntime({ ...runtime, revision: 2 }), runtime);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('中文開始');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('中文開始 English');
    expect(errors).toEqual([]);
  });

  it('keeps browser composition state while runtime changes', async () => {
    await page.evaluate(() => { const e = (window as any).editor; e.setMode('live'); e.setDocument('中文\n\n{{name}}'); e.focusRange(2, 2); });
    await page.locator('.cm-content').dispatchEvent('compositionstart', { data: '' });
    await page.evaluate(runtime => (window as any).editor.setRuntime({ ...runtime, revision: 3, values: { name: { value: '更新', status: 'ok' } } }), runtime);
    await page.keyboard.insertText('輸入');
    await page.locator('.cm-content').dispatchEvent('compositionend', { data: '輸入' });
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('中文輸入\n\n{{name}}');
    expect(await page.locator('.gp-value-text').innerText()).toBe('更新');
    expect(errors).toEqual([]);
  });

  it('does not turn redo into another undo after multiple edits and save-button focus transitions', async () => {
    await page.evaluate(() => { const e = (window as any).editor; e.setDocument('initial'); e.setMode('source'); e.focusRange(0, 0); });
    for (const text of ['old cycle', 'current']) {
      await page.locator('.cm-content').focus();
      await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(text);
      await page.locator('#save').click();
      await page.evaluate(runtime => (window as any).editor.setRuntime(runtime), runtime);
    }
    await page.locator('.cm-content').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n中文補充');
    await page.locator('#save').click(); await page.evaluate(runtime => (window as any).editor.setRuntime(runtime), runtime);
    await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+z');
    await page.locator('#save').click(); await page.evaluate(runtime => (window as any).editor.setRuntime(runtime), runtime);
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('current');
    await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.locator('#save').click(); await page.evaluate(runtime => (window as any).editor.setRuntime(runtime), runtime);
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('current\n中文補充');
  });

  it('keeps escaped references literal and exposes missing/cycle states without HTML execution', async () => {
    await page.evaluate(runtime => {
      const e = (window as any).editor;
      e.setMode('live');
      e.setDocument('Edit\n\n\\{{name}}\n\n{{constructor}}\n\n{{cycle}}\n\n{{name}}');
      e.setRuntime({ ...runtime, revision: 4, values: { name: { value: '<img src=x onerror=alert(1)>', status: 'ok' }, cycle: { value: '', status: 'cycle' } } });
    }, runtime);
    expect(await page.locator('.gp-value').count()).toBe(3);
    expect(await page.locator('.gp-value-cycle').innerText()).toContain('循環依賴');
    expect(await page.locator('.gp-value-missing').innerText()).toContain('constructor');
    expect(await page.locator('.gp-value img').count()).toBe(0);
    expect(await page.locator('.gp-value-ok').innerText()).toContain('<img src=x onerror=alert(1)>');
    expect(errors).toEqual([]);
  });

  it('virtualizes a large reference note while keeping editing and background updates usable', async () => {
    await page.evaluate(runtime => {
      const e = (window as any).editor;
      e.setDocument('Start\n\n' + Array.from({ length: 10_000 }, (_, i) => `Row ${i}: {{name}}`).join('\n'));
      e.setRuntime(runtime);
      e.focusRange(5, 5);
    }, runtime);
    const started = Date.now();
    await page.keyboard.insertText(' 中文輸入');
    await page.evaluate(runtime => (window as any).editor.setRuntime({ ...runtime, revision: 5 }), runtime);
    expect(await page.evaluate(() => (window as any).editor.getDocument().startsWith('Start 中文輸入'))).toBe(true);
    expect(await page.locator('.gp-value').count()).toBeLessThan(300);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(errors).toEqual([]);
  });

  it('round-trips source through the real clipboard and pastes a 12k-definition note', async () => {
    await page.evaluate(sample => { const e = (window as any).editor; e.setMode('source'); e.setDocument(sample); e.focusRange(0, 0); }, sample);
    await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ControlOrMeta+c');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sample);
    const size = 12_000;
    const large = '# Workload\n\n@root_value = "A"\n' + Array.from({ length: size }, (_, i) => `@v${i} = "{root_value}:${i}"`).join('\n') + '\n\n' + Array.from({ length: 1000 }, (_, i) => `{{v${i}}}`).join(' ') + '\n';
    await page.evaluate(text => navigator.clipboard.writeText(text), large);
    const start = Date.now();
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForFunction(length => (window as any).editor.getDocument().length === length, large.length);
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(large);
    const elapsed = Date.now() - start;
    console.info(`Editor real clipboard paste: ${large.length} characters / ${size} declarations in ${elapsed} ms`);
    expect(elapsed).toBeLessThan(5000);
    expect(await page.locator('.cm-line').count()).toBeLessThan(500);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(sample);
    expect(errors).toEqual([]);
  }, 15000);

});
