import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { existsSync } from 'node:fs';
import { serializeBinding } from '../src/domain/binding-language';
import { serializeReference } from '../src/domain/reference-language';

const hasChromium = existsSync(chromium.executablePath());
const hasEdge = process.platform === 'win32' && existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const runtime = { revision: 1, values: { X: { value: '**bold**\n\n- first\n- second\n\n[web](https://example.com)', status: 'ok' } },
  definitions: [], references: [], diagnostics: [], metrics: { elapsedMs: 0, recalculated: 1, total: 1, affected: 1 } };

describe.skipIf(!hasChromium && !hasEdge)('v1 editor in a real headless browser', () => {
  let server: ViteDevServer, browser: Browser, page: Page;
  const errors: string[] = [];
  beforeAll(async () => {
    server = await createServer({ configFile: false, cacheDir: `.cache/vite-tests/editor-v1-${process.pid}-${Date.now()}`,
      server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'editor-v1-harness', configureServer(server) {
        server.middlewares.use('/__editor-v1', async (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml('/__editor-v1', '<!doctype html><button id="other">Other focus</button><div id="editor"></div><script type="module">import {createEditor} from "/src/editor/editor.ts"; window.changes=[];window.navigation=[];window.references=[];window.shared=[];window.editor=createEditor(document.querySelector("#editor"),{onChange:s=>window.changes.push(s),onNavigate:s=>window.navigation.push(s),onFindReferences:s=>window.references.push(s),onEditShared:s=>window.shared.push(s)});</script>'));
        });
      } }] });
    await server.listen(); browser = await chromium.launch({ headless: true, ...(!hasChromium ? { channel: 'msedge' } : {}) });
    page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}__editor-v1`); await page.waitForFunction(() => Boolean((window as any).editor));
  }, 30000);
  afterAll(async () => { await browser?.close(); await server?.close(); });

  it('renders both multiline forms and raw bindings without nested fake semantics or layout exceptions', async () => {
    const value = '**bold**\n\n```grasp-query\n{"collection":"Fake"}\n```\n@Fake = <|hidden|>\n[[@Fake|hidden]]';
    const source = '# Edit\n\n' + serializeBinding('X', [{ kind: 'literal', value }]) + '\n\n'
      + serializeReference({ kind: 'pure', identifier: 'X', value }) + '\n\n'
      + serializeReference({ kind: 'wiki', identifier: 'X', value }) + '\n\nTail';
    await page.evaluate(({ source, runtime }) => {
      const e = (window as any).editor; e.setDocument(source, 'v1:preview', 1, 'grasp-v1'); e.setRuntime(runtime); e.setMode('live'); e.focusRange(0, 0);
    }, { source, runtime });
    expect(await page.locator('.gp-formatted-value').count()).toBe(3);
    expect(await page.locator('.gp-formatted-value strong').count()).toBe(3);
    expect(await page.locator('.gp-formatted-value li').count()).toBe(6);
    expect(await page.locator('.gp-query').count()).toBe(0);
    expect(await page.locator('.gp-value[data-identifier="Fake"]').count()).toBe(0);
    await page.getByRole('button', { name: '修改共享值 X', exact: true }).last().click();
    await page.getByRole('button', { name: '尋找引用 X', exact: true }).last().click();
    await page.getByRole('button', { name: '前往定義 X', exact: true }).last().click();
    expect(await page.evaluate(() => (window as any).shared.at(-1))).toBe('X');
    expect(await page.evaluate(() => (window as any).references.at(-1))).toBe('X');
    expect(await page.evaluate(() => (window as any).navigation.at(-1))).toBe('X');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source);
    expect(errors).toEqual([]);
  });

  it('does not reinterpret absent/legacy syntax and preserves source during version refresh', async () => {
    const source = '# Editing\n\n@X = <|new syntax|>\n\n[new syntax](:ref:X)\n\n{{X}}';
    await page.evaluate(({ source, runtime }) => { const e = (window as any).editor; e.setDocument(source, 'legacy'); e.setRuntime(runtime); e.setMode('live'); e.focusRange(0, 0); }, { source, runtime });
    expect(await page.locator('.gp-formatted-value').count()).toBe(0);
    expect(await page.locator('.gp-value').count()).toBe(1);
    await page.evaluate(source => (window as any).editor.setDocument(source, 'legacy', 4, 'grasp-v1'), source);
    expect(await page.locator('.gp-formatted-value').count()).toBe(2);
    expect(await page.evaluate(() => (window as any).editor.getDocumentVersion())).toEqual({ key: 'legacy', revision: 4, syntaxVersion: 'grasp-v1' });
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source);
  });

  it('withdraws an old query decoration when an explicit syntax-version change makes it opaque', async () => {
    const source = '# Editing\n\n' + serializeBinding('X', [{ kind: 'literal', value: '```grasp-query\n{"collection":"Fake"}\n```' }]);
    await page.evaluate(source => { const e = (window as any).editor; e.setDocument(source, 'scope:query', 1, 'legacy-v0.2'); e.setMode('live'); e.focusRange(0, 0); }, source);
    expect(await page.locator('.gp-query').count()).toBe(1);
    await page.evaluate(source => (window as any).editor.setDocument(source, 'scope:query', 2, 'grasp-v1'), source);
    expect(await page.locator('.gp-query').count()).toBe(0);
    expect(await page.locator('.gp-formatted-value').count()).toBe(1);
    expect(errors).toEqual([]);
  });

  it('reads normal Markdown and opaque formatted values safely, retaining editor history when switching back', async () => {
    const source = '# Heading\n\n**Strong** and *emphasis*.\n\n- first\n- second\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n```js\nconst x = "<script>";\n```\n\n[Site](https://example.com)\n\n<div onclick="alert(1)">literal HTML</div>\n\n[value](:ref:X)\n\nTail';
    await page.evaluate(({ source, runtime }) => { const e = (window as any).editor; e.setDocument(source, 'v1:reading', 2, 'grasp-v1'); e.setMode('source'); e.setRuntime(runtime); e.focusRange(source.length, source.length); }, { source, runtime });
    await page.keyboard.insertText(' edited');
    await page.evaluate(() => (window as any).editor.setMode('reading'));
    expect(await page.locator('.cm-editor').isVisible()).toBe(false);
    expect(await page.locator('.gp-reading h1').innerText()).toBe('Heading');
    expect(await page.locator('.gp-reading table th').allTextContents()).toEqual(['Name', 'Value']);
    expect(await page.locator('.gp-reading table td').allTextContents()).toEqual(['A', 'B']);
    expect(await page.locator('.gp-reading pre code').innerText()).toBe('const x = "<script>";');
    expect(await page.locator('.gp-reading [onclick],.gp-reading script').count()).toBe(0);
    expect(await page.locator('.gp-reading').innerText()).toContain('<div onclick="alert(1)">literal HTML</div>');
    expect(await page.locator('.gp-reading a', { hasText: 'Site' }).getAttribute('href')).toBe('https://example.com');
    expect(await page.locator('.gp-reading .gp-formatted-value strong').innerText()).toBe('bold');
    await page.evaluate(() => (window as any).editor.setPendingValues(['X']));
    expect(await page.locator('.gp-reading .gp-value-state').innerText()).toBe('已提交值／草稿未套用');
    await page.evaluate(() => { const e = (window as any).editor; e.setMode('source'); e.setPendingValues([]); });
    await page.locator('.cm-content').focus(); await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source + ' edited');
    expect(errors).toEqual([]);
  });

  it('maintains only editor-owned marker pairs, level changes and empty deletion through undo/redo', async () => {
    await page.evaluate(() => { const e = (window as any).editor; e.setDocument('@X = ', 'v1:markers', 1, 'grasp-v1'); e.setMode('source'); e.focusRange(5, 5); });
    await page.keyboard.type('<|');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <||>');
    await page.keyboard.type('|');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <||||>');
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <||>');
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <||>');
    await page.keyboard.type('|');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <||||>');
    await page.keyboard.type('text||>');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <||text||>');
    await page.evaluate(() => { const e = (window as any).editor; e.setDocument('@X = <||>', 'v1:handwritten', 1, 'grasp-v1'); e.focusRange(7, 7); });
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <|>');
    expect(errors).toEqual([]);
  });

  it('does not auto-pair paste, code, legacy owners or synthetic IME composition', async () => {
    await page.evaluate(() => { const e = (window as any).editor; e.setDocument('@X = ', 'v1:paste', 1, 'grasp-v1'); e.setMode('source'); e.focusRange(5, 5); });
    await page.evaluate(() => navigator.clipboard.writeText('<|'));
    await page.keyboard.press('ControlOrMeta+v');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <|');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = ');
    await page.locator('.cm-content').dispatchEvent('compositionstart', { data: '' });
    await page.keyboard.type('<|');
    await page.locator('.cm-content').dispatchEvent('compositionend', { data: '<|' });
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <|');
    await page.evaluate(() => { const e = (window as any).editor; e.setDocument('```\n\n```', 'v1:code', 1, 'grasp-v1'); e.focusRange(4, 4); });
    await page.keyboard.type('<|');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('```\n<|\n```');
    await page.evaluate(() => { const e = (window as any).editor; e.setDocument('@X = ', 'legacy:markers'); e.focusRange(5, 5); });
    await page.keyboard.type('<|');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('@X = <|');
    expect(errors).toEqual([]);
  });

  it('applies narrow guarded raw patches without resetting selection, EOL metadata or local undo', async () => {
    const source = '\ufeffTitle\r\n\r\n@X = <|old|>\n[old](:ref:X)\r\nTail';
    const binding = serializeBinding('X', [{ kind: 'literal', value: 'new\r\nline' }]);
    const reference = serializeReference({ kind: 'pure', identifier: 'X', value: 'new\r\nline' });
    await page.evaluate(source => { const e = (window as any).editor; e.setDocument(source, 'v1:patch', 3, 'grasp-v1'); e.setMode('source'); e.focusRange(source.length, source.length); }, source);
    await page.keyboard.insertText(' local');
    const base = source + ' local';
    await page.evaluate(base => (window as any).editor.focusRange(base.indexOf('Tail'), base.indexOf('Tail') + 4), base);
    const beforeChanges = await page.evaluate(() => (window as any).changes.length);
    const patch = { expectedKey: 'v1:patch', expectedRevision: 3, nextRevision: 4, expectedSource: base,
      changes: [{ from: base.indexOf('@X'), to: base.indexOf('@X') + '@X = <|old|>'.length, expected: '@X = <|old|>', insert: binding },
        { from: base.indexOf('[old]'), to: base.indexOf('[old]') + '[old](:ref:X)'.length, expected: '[old](:ref:X)', insert: reference }] };
    expect(await page.evaluate(patch => (window as any).editor.applySemanticPatch(patch), patch)).toEqual({ status: 'applied' });
    const expected = base.replace('@X = <|old|>', binding).replace('[old](:ref:X)', reference);
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(expected);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Tail');
    expect(await page.evaluate(() => (window as any).changes.length)).toBe(beforeChanges);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(expected.replace(' local', ''));
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(expected);
    expect(await page.evaluate(patch => (window as any).editor.applySemanticPatch(patch).status, patch)).toBe('stale');
    const acknowledge = { expectedKey: 'v1:patch', expectedRevision: 4, nextRevision: 5, expectedSource: expected, changes: [] };
    expect(await page.evaluate(patch => (window as any).editor.applySemanticPatch(patch).status, acknowledge)).toBe('applied');
    expect(await page.evaluate(() => (window as any).editor.getDocumentVersion().revision)).toBe(5);
    expect(errors).toEqual([]);
  });

  it('retains drafts on stale source and defers semantic patches during composition', async () => {
    await page.evaluate(() => { const e = (window as any).editor; e.setDocument('draft', 'v1:guards', 1, 'grasp-v1'); e.setMode('source'); e.focusRange(5, 5); });
    const patch = { expectedKey: 'v1:guards', expectedRevision: 1, nextRevision: 2, expectedSource: 'other', changes: [] };
    expect(await page.evaluate(patch => (window as any).editor.applySemanticPatch(patch).status, patch)).toBe('stale');
    await page.locator('.cm-content').dispatchEvent('compositionstart', { data: '' });
    expect(await page.evaluate(patch => (window as any).editor.applySemanticPatch(patch).status, { ...patch, expectedSource: 'draft', changes: [{ from: 0, to: 5, expected: 'draft', insert: 'next' }] })).toBe('composing');
    expect(await page.evaluate(patch => (window as any).editor.applySemanticPatch(patch).status, { ...patch, expectedSource: 'draft' })).toBe('applied');
    expect(await page.evaluate(() => (window as any).editor.getDocumentVersion().revision)).toBe(2);
    await page.locator('.cm-content').dispatchEvent('compositionend', { data: '' });
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe('draft');
  });

  it('keeps cached failure values complete and renders nested code without extra lines', async () => {
    const value = '<img src=x onerror="alert(1)">\n\n' + '完整'.repeat(900);
    const source = '# Edit\n\n' + serializeReference({ kind: 'pure', identifier: 'Missing', value })
      + '\n\n> ```\n> quoted code\n> second line\n> ```\n\n- item\n\n  ```\n  list code\n  second line\n  ```';
    await page.evaluate(source => {
      const e = (window as any).editor; e.setDocument(source, 'v1:failure', 1, 'grasp-v1'); e.setRuntime({ revision: 1, values: {}, definitions: [], references: [], diagnostics: [], metrics: { elapsedMs: 0, recalculated: 0, total: 0, affected: 0 } }); e.setMode('reading');
    }, source);
    expect(await page.locator('.gp-reading .gp-value-text').innerText()).toContain('完整'.repeat(900));
    expect(await page.locator('.gp-reading .gp-value-state').innerText()).toBe('快取值／尚未解析');
    expect(await page.locator('.gp-reading img,[onerror]').count()).toBe(0);
    expect(await page.locator('.gp-reading pre code').allTextContents()).toEqual(['quoted code\nsecond line', 'list code\nsecond line']);
    expect(await page.evaluate(() => (window as any).editor.getDocument())).toBe(source);
    expect(errors).toEqual([]);
  });
});
