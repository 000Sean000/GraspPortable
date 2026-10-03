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

    // Keep untouched reference widgets across ordinary edits. Raw offsets include
    // CRLF and an astral character; CodeMirror positions use normalized UTF-16.
    const stable='😀前文\r\n\r\n[第一段\r\n\r\n第二段](:ref:A)\r\n\r\n[另一值](:ref:B)\r\n\r\n後文';
    const ranges=source=>['A','B'].map(name=>{
      const end=source.indexOf('](:ref:'+name+')')+('](:ref:'+name+')').length;
      const start=source.lastIndexOf('[',end-1);
      return {name,cachedValue:name==='A'?'第一段\n\n第二段':'另一值',start,length:end-start};
    });
    await page.evaluate(async ({stable,references})=>{await window.editor.setDocument('mapped',stable,0,references,true);window.editor.focusAt(0);window.editor.insertText('新增\n');},{stable,references:ranges(stable)});
    assert.equal(await page.locator('#editor .managed-reference').count(),2,'editing before references preserves both widgets immediately');
    let mapped=(await page.evaluate(()=>window.editor.snapshot())).source;
    assert.equal(mapped,'新增\r\n'+stable);
    await page.evaluate(length=>{window.editor.focusAt(length);window.editor.insertText('\n末尾');},mapped.length);
    assert.equal(await page.locator('#editor .managed-reference').count(),2,'editing after references preserves both widgets');
    mapped=(await page.evaluate(()=>window.editor.snapshot())).source;
    assert.equal(await page.evaluate(({stable,references})=>window.editor.updateReferences(stable,references),{stable,references:ranges(stable)}),false,'stale result cannot replace mapped references');
    await page.evaluate(()=>{window.editor.setMode(false);window.editor.setMode(true);});
    assert.equal(await page.locator('#editor .managed-reference').count(),2,'mode changes retain current mapped ranges');
    await page.evaluate(position=>{window.editor.focusAt(position);window.editor.insertText('改');},mapped.indexOf('第一段')+1);
    mapped=(await page.evaluate(()=>window.editor.snapshot())).source;
    await page.evaluate(length=>window.editor.focusAt(length),mapped.length);
    assert.deepEqual(await page.locator('#editor .managed-reference').evaluateAll(nodes=>nodes.map(node=>node.dataset.identifier)),['B'],'editing inside A invalidates only A, even after moving the selection away');

    const committed=mapped.replace('另一值','新的值');
    const committedRefs=ranges(committed).map(r=>({...r,cachedValue:r.name==='B'?'新的值':'已解析的新值'}));
    const changeCount=await page.evaluate(()=>window.events.filter(e=>e[0]==='OnEditorChanged').length);
    assert.equal(await page.evaluate(({mapped,committed,committedRefs})=>window.editor.applyCommitted(mapped,committed,committedRefs),{mapped,committed,committedRefs}),true);
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,committed,'quiet committed patch retains raw CRLF');
    assert.equal(await page.locator('#editor .managed-reference').count(),2,'committed patch installs fresh ranges with its text');
    assert.match(await page.locator('#editor .managed-reference[data-identifier="B"]').innerText(),/新的值/);
    assert.equal(await page.evaluate(()=>window.events.filter(e=>e[0]==='OnEditorChanged').length),changeCount,'committed patch is not sent back as a user edit');
    await page.evaluate(()=>window.editor.insertText('終'));
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,committed+'終','selection maps across the committed patch');

    // Match native typing: the @code region itself is still open and the
    // character is produced by Shift + the physical bracket key.
    for(const before of ['@code{\n  @S1Native = ','@code{\r\n  @S1Native = ']) {
      await page.evaluate(async before=>{await window.editor.setDocument('open-region',before,0,[],false);window.editor.focusAt(before.length);},before);
      await page.keyboard.press('Shift+BracketLeft');
      assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,before+'{}','physical opening key pairs in an unfinished region');
      await page.keyboard.press('Control+z');
      assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,before,'one undo removes the paired edit');
    }
    const nativePrefix='@code{\n  @S1Native = ';
    await page.evaluate(async ()=>{await window.editor.setDocument('typed-open-region','',0,[],false);window.editor.focusAt(0);});
    await page.keyboard.type(nativePrefix);
    await page.keyboard.press('Shift+BracketLeft');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,nativePrefix+'{}','typing the unfinished prefix from an empty editor also pairs');
    await page.keyboard.press('Control+z');
    await page.locator('.cm-content').dispatchEvent('compositionstart',{data:''});
    await page.keyboard.press('Shift+BracketLeft');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,nativePrefix+'{','physical bracket key does not pair during composition');
    await page.locator('.cm-content').dispatchEvent('compositionend',{data:''});
    await page.waitForFunction(async ()=>!(await window.editor.snapshot()).composing);
    // Remove only the deliberately unpaired marker, without resetting editor
    // state, to verify the composition guard releases for subsequent typing.
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Shift+BracketLeft');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,nativePrefix+'{}','physical key pairing resumes after composition ends');
    const prefix='@code{\r\n  @Description = ';
    await page.evaluate(async prefix=>{await window.editor.setDocument('delimiters',prefix+'\r\n}',0,[],false);window.editor.focusAt(prefix.length);},prefix);
    await page.keyboard.type('{');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,prefix+'{}\r\n}','literal opening inserts its partner');
    await page.keyboard.type('{');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,prefix+'{{}}\r\n}','typing another opening marker grows both ends');
    await page.keyboard.type('{');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,prefix+'{{{}}}\r\n}');
    await page.keyboard.press('Control+z');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,prefix+'{{}}\r\n}','one undo reverts both sides of one marker increase');
    await page.keyboard.type('中文');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,prefix+'{{中文}}\r\n}','cursor remains inside markers');
    await page.evaluate(position=>window.editor.focusAt(position),prefix.length+2);
    await page.keyboard.type('{');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,prefix+'{{{中文}}}\r\n}','existing populated marker grows without changing its value');
    const block='@code{\n@A = {{\n{"x":1}\n}}\n}';
    await page.evaluate(async block=>{await window.editor.setDocument('block-markers',block,0,[],false);window.editor.focusAt(block.indexOf('{{')+2);},block);
    await page.keyboard.type('{');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,'@code{\n@A = {{{\n{"x":1}\n}}}\n}','block marker growth preserves raw JSON content');

    for(const before of ['ordinary @A = ','- @code{ @A = ','> @code{ @A = ','`@code{ @A = ','```json\n@code{\n@A = ','```grasp-demo\n@code{\n@A = ','```\n@code{\n@A = ','    @code{ @A = ']) {
      await page.evaluate(async before=>{await window.editor.setDocument('plain-context',before,0,[],false);window.editor.focusAt(before.length);},before);
      await page.keyboard.type('{');
      assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,before+'{','no Grasp pairing in ambiguous/Markdown context: '+JSON.stringify(before));
    }
    const opaque='@code{\n@A = {{\n@code{\n@B = ';
    await page.evaluate(async opaque=>{await window.editor.setDocument('opaque',opaque,0,[],false);window.editor.focusAt(opaque.length);},opaque);
    await page.keyboard.type('{');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,opaque+'{','literal content that resembles a region is opaque');
    const composition='@code{ @A = ';
    await page.evaluate(async source=>{await window.editor.setDocument('ime-delimiters',source,0,[],false);window.editor.focusAt(source.length);},composition);
    await page.locator('.cm-content').dispatchEvent('compositionstart',{data:''});
    await page.keyboard.type('{');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,composition+'{','IME never triggers marker rewrites');
    await page.locator('.cm-content').dispatchEvent('compositionend',{data:''});
    await page.evaluate(async source=>{await window.editor.setDocument('paste-delimiters',source,0,[],false);window.editor.focusAt(source.length);},composition);
    await page.locator('.cm-content').evaluate(element=>{
      const data=new DataTransfer();data.setData('text/plain','{');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    });
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,composition+'{','single-character paste stays literal');

    const definition='@code{\r\n  @A = {{\r\n{"name":"<script>"}\r\n  }}\r\n}';
    const reading='Before\r\n\r\n'+definition+'\r\n\r\nAfter';
    const regions=[{start:10,length:definition.length,isComplete:true}];
    await page.evaluate(({reading,regions})=>window.editor.renderReading('reading',reading,[],regions),{reading,regions});
    assert.equal(await page.locator('#reading pre.grasp-definition-region code').textContent(),definition,'authoritative region preserves raw lines, indentation and literal HTML');
    assert.equal(await page.locator('#reading script').count(),0);
    assert.equal(await page.locator('#reading p > pre').count(),0,'definition block is not nested in a Markdown paragraph');
    const fenced='```grasp\n'+definition+'\n```';
    await page.evaluate(({fenced,definition})=>window.editor.renderReading('reading',fenced,[],[{start:9,length:definition.length,isComplete:true}]),{fenced,definition});
    assert.equal(await page.locator('#reading pre').count(),1,'enabled fenced region keeps the existing Markdown code block');
    assert.equal(await page.locator('#reading pre code').textContent(),definition+'\n');
    await page.evaluate(reading=>window.editor.renderReading('reading',reading,[]),reading);
    assert.equal(await page.locator('#reading pre.grasp-definition-region').count(),0,'without matching authoritative regions Reading does not guess');

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
