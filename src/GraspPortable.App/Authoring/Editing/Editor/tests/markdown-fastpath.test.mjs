import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('unmanaged Markdown fast path preserves exact HTML and managed fallback', async () => {
  const entry = fileURLToPath(new URL('../src/editor.ts', import.meta.url));
  const source = (await readFile(entry, 'utf8')).replace(/\r\n/g, '\n');
  const fastPath = '  if(references.length===0 && regions.length===0 && !source.includes(":ref:") && !source.includes("[[@"))\n    return html(source).replace(/\\r/g,"&#13;");';
  assert.ok(source.includes(fastPath));
  const compile = text => build({ stdin: { contents: text, resolveDir: dirname(entry), loader: 'ts' }, bundle: true, format: 'esm', target: 'es2022', write: false });
  const [current, baseline] = await Promise.all([compile(source), compile(source.replace(fastPath, ''))]);
  const server = createServer((request, response) => {
    response.setHeader('content-type', request.url.endsWith('.js') ? 'text/javascript' : 'text/html');
    if (request.url === '/current.js') response.end(current.outputFiles[0].text);
    else if (request.url === '/baseline.js') response.end(baseline.outputFiles[0].text);
    else response.end('<html><body><script type="module">window.current=await import("/current.js");window.baseline=await import("/baseline.js");window.ready=true;</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => window.ready);
    const result = await page.evaluate(() => {
      const plain = ['', '中文 😀 **bold** & < >', '# Title\r\n\r\nparagraph\r\nnext',
        '[[Target|維基]] [local](target.md) [external](https://example.invalid)',
        '![image](picture.png) ![[Image.png|圖片]]', '<script>bad()</script>\r\n<div onclick="bad()">raw</div>',
        '```json\r\n{"x":"中文😀"}\r\n```', '\\[\\[escaped\\]\\] \\*plain\\* &#13; &amp; &quot;',
        '| A | B |\n|---|---|\n| x | y |', '- first\n  - nested\n\n> quote',
        '[record](record.md) <!-- grasp:record 11111111111111111111111111111111 -->'];
      const slow = [
        ['[cached](:ref:Value)', [{ name: 'Value', cachedValue: '[[Target|Wiki]]', originNoteId: 'definition-origin', start: 0, length: 20 }], []],
        ['raw\r\n中文', [], [{ start: 0, length: 7, isComplete: true }]],
        ['ordinary', [{ name: 'OutOfRange', cachedValue: 'ignored', start: 100, length: 1 }], []],
        ['ordinary', [], [{ start: 100, length: 1, isComplete: false }]],
        ...['[cached](:ref:Missing)', '[cached](:ref:unfinished', '[[@Missing|cached]]', '[[@Missing|unfinished',
          '```\n[cached](:ref:Missing)\n```', '`[[@Missing|literal]]`', '\\[[@Missing|escaped]]', ':ref:literal'].map(text => [text, [], []])
      ];
      const originalUUID = crypto.randomUUID.bind(crypto); let nonces = 0;
      crypto.randomUUID = () => { nonces++; return originalUUID(); };
      const mismatches = [];
      for (const [index, text] of plain.entries()) {
        const expected = window.baseline.renderManagedMarkdown(text); const before = nonces;
        const actual = window.current.renderManagedMarkdown(text);
        if (actual !== expected || nonces !== before) mismatches.push('plain-' + index);
      }
      for (const [index, args] of slow.entries()) {
        const expected = window.baseline.renderManagedMarkdown(...args); const before = nonces;
        const actual = window.current.renderManagedMarkdown(...args);
        if (actual !== expected || nonces !== before + 1) mismatches.push('fallback-' + index);
      }
      return { mismatches, plain: plain.length, slow: slow.length };
    });
    assert.deepEqual(result.mismatches, []);
    assert.equal(result.plain, 11); assert.equal(result.slow, 12);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
