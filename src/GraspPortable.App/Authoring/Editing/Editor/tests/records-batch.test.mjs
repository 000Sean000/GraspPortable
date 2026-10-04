import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

test('Records batches preserve per-cell generation, navigation, disposal and lazy-image guards', async () => {
  const editor = await readFile(new URL('../../../../wwwroot/editor.js', import.meta.url), 'utf8');
  const records = await readFile(new URL('../../../../Records/RecordsPanel.razor.js', import.meta.url), 'utf8');
  const server = createServer((request, response) => {
    response.setHeader('content-type', request.url.endsWith('.js') ? 'text/javascript' : 'text/html');
    if (request.url === '/editor.js') response.end(editor);
    else if (request.url === '/Records/RecordsPanel.razor.js') response.end(records);
    else response.end('<html><body><script type="module">window.records=await import("/Records/RecordsPanel.razor.js");window.ready=true;</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => window.ready);
    const result = await page.evaluate(async () => {
      const create = expected => {
        const element = document.createElement('div'); element.className = 'records-markdown';
        element.dataset.recordsRenderExpected = element.dataset.recordsPaintExpected = String(expected);
        document.body.append(element); return element;
      };
      const events = []; const receiver = { invokeMethodAsync: async (...args) => { events.push(args); return null; } };
      const markdown = '[[Target|Wiki]] [go](target.md) [computed](:ref:Value)';
      const reference = { name: 'Value', kind: 'Pure', cachedValue: 'computed', originNoteId: 'definition-source',
        start: markdown.indexOf('[computed]'), length: '[computed](:ref:Value)'.length };
      const command = (element, generation = 1) => ({ operation: 'render', element, markdown,
        origin: 'owner', receiver, generation, references: [reference], regions: [] });
      const broken = create(1), good = create(1), stale = create(2), removed = create(1); removed.remove();
      const accepted = window.records.applyMarkdownBatch([{ ...command(broken), markdown: null }, command(good), command(stale), command(removed)]);
      document.addEventListener('click', event => event.preventDefault(), { capture: true });
      const wiki = good.querySelector('a[data-wiki="true"]'), plain = good.querySelector('a[href="target.md"]');
      const definition = good.querySelector('[data-grasp-definition]');
      wiki.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      plain.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      definition.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const navigation = events.slice();
      const beforeDispose = events.length;
      window.records.applyMarkdownBatch([{ operation: 'dispose', element: good }]);
      wiki.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      definition.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const image = create(1); let completeImage;
      const pendingImage = new Promise(resolve => { completeImage = resolve; });
      const imageReceiver = { invokeMethodAsync: (...args) => { events.push(args); return pendingImage; } };
      window.records.applyMarkdownBatch([{ ...command(image), markdown: '![image](picture.png)', references: [], receiver: imageReceiver }]);
      const imageRequested = events.at(-1)?.[0] === 'ResolveImage';
      window.records.applyMarkdownBatch([{ operation: 'dispose', element: image }]);
      completeImage('data:image/png;base64,AAAA'); await pendingImage; await new Promise(resolve => setTimeout(resolve, 0));
      return { accepted, failed: broken.dataset.recordsPaintFailed, ready: good.dataset.recordsPaintReady,
        staleReady: stale.dataset.recordsPaintReady ?? null, removedReady: removed.dataset.recordsPaintReady ?? null,
        navigation, oldCallbacks: events.slice(beforeDispose).filter(event => event[0].startsWith('Navigate')).length,
        imageRequested, lateImages: image.querySelectorAll('img').length };
    });
    assert.deepEqual(result.accepted, [false, true, true, true]);
    assert.equal(result.failed, '1'); assert.equal(result.ready, '1');
    assert.equal(result.staleReady, null); assert.equal(result.removedReady, null);
    assert.deepEqual(result.navigation, [['Navigate', 'owner', 'Target', true, 1], ['Navigate', 'owner', 'target.md', false, 1], ['NavigateDefinition', 'Value', 1]]);
    assert.equal(result.oldCallbacks, 0); assert.equal(result.imageRequested, true); assert.equal(result.lateImages, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
