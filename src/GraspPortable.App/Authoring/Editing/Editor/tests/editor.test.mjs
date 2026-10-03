import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('real CodeMirror: raw deltas, stale patch, transition lock, multiline rendering', async () => {
  const source = await readFile(new URL('../../../../wwwroot/editor.js', import.meta.url));
  const server = createServer((request, response) => {
    if(request.url === '/editor.js') { response.setHeader('content-type','text/javascript'); response.end(source); }
    else { response.setHeader('content-type','text/html'); response.end('<html><body><input class="note-title"><div id="editor"></div><div id="reading"></div><script type="module">window.events=[];window.editor=await import("/editor.js");window.editor.mount("editor",{invokeMethodAsync:async (...args)=>window.events.push(args)});window.ready=true;</script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage(); const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port); await page.waitForFunction(()=>window.ready);
    const initial='甲\r\n乙\r丙\n😀';
    await page.evaluate(async raw=>{await window.editor.setDocument('n1',raw,0,[],false);window.editor.focusAt(raw.length);window.editor.insertText('新');},initial);
    let snapshot=await page.evaluate(()=>window.editor.snapshot()); assert.equal(snapshot.source,initial+'新');
    const events=await page.evaluate(()=>window.events.filter(event=>event[0]==='OnEditorChanged'));
    let reconstructed=initial;
    for(const event of events)for(const delta of event[3])reconstructed=reconstructed.slice(0,delta.from)+delta.insert+reconstructed.slice(delta.to);
    assert.equal(reconstructed,snapshot.source,'batched raw UTF-16 deltas preserve untouched EOL');
    assert.equal(await page.evaluate(()=>window.editor.applyCommitted('wrong','LOST',[])),false);
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,initial+'新');

    // An edit already in flight is included, then the transition lock prevents
    // further keyboard and toolbar insertion before the final durable snapshot.
    await page.evaluate(()=>{window.editor.insertText('末');window.editor.freeze(true);window.editor.insertText('不能插入');});
    await page.locator('.cm-content').press('x');
    snapshot=await page.evaluate(()=>window.editor.snapshot()); assert.equal(snapshot.source,initial+'新末');
    assert.equal(await page.locator('.note-title').isDisabled(),true);
    await page.evaluate(()=>window.editor.freeze(false));
    assert.equal(await page.locator('.note-title').isDisabled(),false);

    const carrier='前文 [第一段。\n\n第二段。](:ref:Description) 後文';
    const reference={name:'Description',cachedValue:'第一段。\n\n第二段。',start:3,length:carrier.indexOf(' 後文')-3};
    await page.evaluate(async ({carrier,reference})=>{await window.editor.setDocument('n2',carrier,0,[reference],true);window.editor.renderReading('reading',carrier,[reference]);},{carrier,reference});
    assert.equal(await page.locator('#editor .managed-reference').count(),1);
    assert.equal(await page.locator('#reading .managed-reference p').count(),2);
    assert.match(await page.locator('#reading').innerText(),/前文/);assert.match(await page.locator('#reading').innerText(),/後文/);
    await page.locator('#reading .managed-reference').click();
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnReferenceClicked'&&e[1]==='Description'));

    await page.evaluate(async ()=>{await window.editor.setDocument('n3','plain',0,[],false);window.editor.focusAt(5);});
    await page.locator('.cm-content').dispatchEvent('compositionstart',{data:''});
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).composing,true,'synthetic IME guard, not native IME acceptance');
    assert.equal(await page.evaluate(()=>window.editor.applyCommitted('plain','REPLACED',[])),false);
    await page.locator('.cm-content').dispatchEvent('compositionend',{data:''});
    await page.evaluate(()=>window.editor.renderReading('reading','<script>window.bad=true</script>',[]));
    assert.equal(await page.evaluate(()=>window.bad),undefined);
    await page.evaluate(()=>window.editor.dispose());
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
