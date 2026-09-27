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
    server = await createServer({ configFile: false, cacheDir: '.cache/vite-tests/editor-' + process.pid + '-' + Date.now(), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'editor-test-harness', configureServer(server) {
      server.middlewares.use('/__editor-test', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__editor-test', '<!doctype html><button id="save">Save</button><div id="editor"></div><script type="module">import {createEditor} from "/src/editor/editor.ts"; window.changes=[]; window.navigation=[]; window.references=[]; window.editor=createEditor(document.querySelector("#editor"),{onChange:s=>window.changes.push(s),onNavigate:s=>{window.navigation.push(s);window.testNavigate?.(s)},onFindReferences:s=>window.references.push(s),onOpenRecord:s=>(window.openedRecords??=[]).push(s),onOpenQuery:q=>(window.openedQueries??=[]).push(q)});</script>'));
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

  it('preserves per-note undo and selection while invalidating externally changed content', async () => {
    await page.evaluate(() => { const e = (window as any).editor; e.setMode('source'); e.setDocument('note A', 'workspace:A'); e.focusRange(6, 6); });
    await page.keyboard.insertText(' edited');
    await page.evaluate(() => { const e = (window as any).editor; e.setDocument('note B', 'workspace:B'); e.focusRange(6, 6); });
    await page.keyboard.insertText(' changed');
    await page.evaluate(() => (window as any).editor.setDocument('note A edited', 'workspace:A'));
    await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('note A');
    await page.evaluate(() => (window as any).editor.setDocument('note B changed', 'workspace:B'));
    await page.locator('.cm-content').focus(); await page.keyboard.insertText('!');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('note B changed!');
    await page.evaluate(() => (window as any).editor.setDocument('external replacement', 'workspace:B'));
    await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('external replacement');
  });

  it('opens record identity and every result from a bounded reactive query table', async () => {
    const query = { collection: 'aura', where: { field: 'element', equals: 'fire' } };
    await page.evaluate(({ query, runtime }) => {
      const records = Array.from({ length: 250 }, (_, i) => ({ id: `record-${i}`, collection: 'aura', name: `item${i}`, fields: { element: '{base}' }, revision: 1 }));
      const values = Object.fromEntries(records.map(record => [`aura.${record.name}.element`, { status: 'ok', value: 'fire' }]));
      const e = (window as any).editor; e.setMode('live'); e.setDocument('# Query\n\n```grasp-query\n' + JSON.stringify(query) + '\n```\n\nEnd'); e.setRuntime({ ...runtime, values }, records); e.focusRange(0, 0);
    }, { query, runtime });
    await page.waitForSelector('.gp-query-record');
    expect(await page.locator('.gp-query tbody tr').count()).toBe(200);
    expect(await page.locator('.gp-query').innerText()).toContain('250 筆');
    await page.getByRole('button', { name: '開啟資料 item199', exact: true }).click();
    expect(await page.evaluate(() => (window as any).openedRecords.at(-1))).toBe('record-199');
    await page.getByRole('button', { name: '開啟全部查詢結果', exact: true }).click();
    expect(await page.evaluate(() => (window as any).openedQueries.at(-1))).toEqual(query);
    expect(errors).toEqual([]);
  });

  it('inserts text at the retained selection as a separate undoable transaction', async () => {
    await page.evaluate(() => { const e = (window as any).editor; e.setMode('source'); e.setDocument('Before value after'); e.focusRange(7, 12); });
    await page.locator('#save').click(); // A toolbar/inspector action does not discard editor selection.
    await page.evaluate(() => (window as any).editor.insertText('{{aura.item.label}}'));
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('Before {{aura.item.label}} after');
    expect(await page.locator('.cm-content').evaluate(node => node === document.activeElement)).toBe(true);
    await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('Before value after');
    await page.keyboard.press('ControlOrMeta+Shift+z'); expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('Before {{aura.item.label}} after');
    await page.keyboard.insertText('!'); await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('Before {{aura.item.label}} after');
    expect(errors).toEqual([]);
  });

  it('renders known raster assets with workspace guard, downloads unsafe types and maps original embeds safely', async () => {
    const requests: string[] = [];
    const assetRoute = '**/api/assets/**';
    await page.route(assetRoute, async route => { requests.push(route.request().url()); await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }); });
    const wiki = '![[pictures/photo.png|Original photo]]', relative = '![Original relative](../pictures/photo.png)';
    const source = '# Assets\n\n![PNG](grasp-asset:png)\n\n![SVG](grasp-asset:svg)\n\n[HTML](grasp-asset:html)\n\n![Unknown](grasp-asset:unknown)\n\n' + wiki + '\n\n' + relative + '\n';
    const attachments = [{ id: 'png', name: 'photo.png', mimeType: 'image/png' }, { id: 'svg', name: 'unsafe.svg', mimeType: 'image/svg+xml' }, { id: 'html', name: 'unsafe.html', mimeType: 'text/html' }];
    const links = [wiki, relative].map(raw => ({ from: source.indexOf(raw), to: source.indexOf(raw) + raw.length, id: 'png', raw, embed: true, label: 'Original asset' }));
    try {
      await page.evaluate(({ source, attachments, links }) => { const e = (window as any).editor; e.setMode('live'); e.setDocument(source); e.setAssets('workspace&guard', attachments, links); e.focusRange(0, 0); }, { source, attachments, links });
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.gp-asset img')].length === 3 && [...document.querySelectorAll<HTMLImageElement>('.gp-asset img')].every(image => image.complete && image.naturalWidth > 0));
      expect(await page.locator('.gp-asset[download]').count()).toBe(2);
      expect(await page.locator('.gp-asset[data-asset-id="svg"]').getAttribute('download')).toBe('unsafe.svg');
      expect(await page.locator('.gp-asset[data-asset-id="html"]').getAttribute('download')).toBe('unsafe.html');
      expect(await page.locator('iframe,object,embed').count()).toBe(0);
      expect(await page.locator('.gp-asset[data-asset-id="unknown"]').count()).toBe(0);
      expect(requests.every(url => url.includes('/api/assets/png?workspace=workspace%26guard'))).toBe(true);
      expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source);
      await page.keyboard.insertText('Prefix\n');
      expect(await page.locator('.gp-asset img').count()).toBe(3); // Source spans follow ordinary preceding edits.
      await page.evaluate(({ attachments, links }) => (window as any).editor.setAssets('workspace&guard', attachments, links), { attachments, links });
      expect(await page.locator('.gp-asset img').count()).toBe(1); // Stale source offsets never replace unrelated text.
      await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source);
      expect(errors).toEqual([]);
    } finally { await page.unroute(assetRoute); await page.evaluate(() => (window as any).editor.setAssets('', [])); }
  });

  it('preserves mixed original line endings through navigation, source edits, assets and undo', async () => {
    const declaration = '@name = "Sean"', wiki = '![[images/photo.png]]';
    const source = '# Welcome\r\n\r\n' + declaration + '\n\n' + wiki + '\r\n\r\nHello {{name}}\r\nEnd';
    const attachments = [{ id: 'mixed-photo', name: 'photo.png', mimeType: 'image/png' }];
    const links = [{ from: source.indexOf(wiki), to: source.indexOf(wiki) + wiki.length, id: 'mixed-photo', raw: wiki, embed: true }];
    const route = '**/api/assets/mixed-photo**';
    await page.route(route, value => value.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));
    try {
      await page.evaluate(({ source, declaration, attachments, links, runtime }) => {
        const e = (window as any).editor; e.setMode('live'); e.setDocument(source, 'mixed:eol'); e.setAssets('mixed-workspace', attachments, links); e.setRuntime(runtime); e.focusRange(0, 0);
        (window as any).testNavigate = () => e.focusRange(source.indexOf(declaration), source.indexOf(declaration) + declaration.length);
      }, { source, declaration, attachments, links, runtime });
      expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source);
      await page.waitForSelector('.gp-asset img');
      await page.locator('.gp-value:not(.gp-declaration) .gp-value-text').click();
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(declaration);
      await page.keyboard.insertText('@name = "小明"');
      const edited = source.replace(declaration, '@name = "小明"');
      expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(edited);
      expect(await page.evaluate(() => (window as any).changes.at(-1))).toBe(edited);
      expect(await page.locator('.gp-asset img').count()).toBe(1);
      // A metadata save roundtrip must not replace the state and silently clear undo.
      await page.evaluate(edited => (window as any).editor.setDocument(edited, 'mixed:eol'), edited);
      await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source);
      await page.keyboard.press('ControlOrMeta+Shift+z'); expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(edited);
      await page.evaluate(edited => { const e = (window as any).editor; e.focusRange(edited.indexOf('Hello'), edited.indexOf('Hello') + 5); }, edited);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Hello');
      await page.evaluate(() => (window as any).editor.insertText('Hello\r\nInserted\n'));
      expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(edited.replace('Hello', 'Hello\r\nInserted\n'));
      await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(edited);
      await page.evaluate(edited => { const e = (window as any).editor; e.focusRange(edited.length, edited.length); }, edited);
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(edited + '\r\n');
      await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(edited);
      expect(errors).toEqual([]);
    } finally { await page.unroute(route); await page.evaluate(() => { (window as any).testNavigate = undefined; (window as any).editor.setAssets('', []); }); }
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
