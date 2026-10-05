import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('real CodeMirror: raw deltas, stale patch, transition lock, multiline rendering', async () => {
  // Compile source in memory: regression runs must not overwrite a concurrently published App bundle.
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/editor.ts',import.meta.url))],bundle:true,format:'esm',target:'es2022',write:false});
  const source=bundle.outputFiles[0].text;
  const server = createServer((request, response) => {
    if(request.url === '/editor.js') { response.setHeader('content-type','text/javascript'); response.end(source); }
    else { response.setHeader('content-type','text/html'); response.end('<html><body><input class="note-title"><div id="editor"></div><div id="reading"></div><script type="module">window.events=[];window.editor=await import("/editor.js");window.editor.mount("editor",{invokeMethodAsync:async (...args)=>{window.events.push(args);if(args[0]==="OnResolveImage")return window.imageResolver?.(...args.slice(1))??null;}});window.ready=true;</script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage(); const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port); await page.waitForFunction(()=>window.ready);
    await page.evaluate(()=>{window.editEvents=[];document.addEventListener('grasp-editor-edit',event=>window.editEvents.push(event.detail));});
    const initial='甲\r\n乙\r丙\n😀';
    await page.evaluate(async raw=>{await window.editor.setDocument('n1',raw,0,[],false);window.editor.focusAt(raw.length);window.editor.insertText('新');},initial);
    let snapshot=await page.evaluate(()=>window.editor.snapshot()); assert.equal(snapshot.source,initial+'新');
    assert.deepEqual(await page.evaluate(()=>window.editEvents),[{noteId:'n1',revision:1,composing:false}],
      'only the local edit emits correlation metadata; quiet setDocument emits none');
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
    await page.evaluate(()=>{window.events=[];});
    await page.locator('#editor .managed-reference').click();
    assert.equal(await page.locator('#editor .managed-reference').count(),1,'clicking the preview does not first expose its raw source');
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnReferenceClicked'&&e[1]==='Description'));
    await page.locator('#reading .managed-reference').press('Enter');
    assert.equal((await page.evaluate(()=>window.events)).filter(e=>e[0]==='OnReferenceClicked').length,2,'reference keyboard activation is a single navigation');
    await page.evaluate(position=>window.editor.focusAt(position),reference.start+1);
    assert.equal(await page.locator('#editor .managed-reference').count(),0,'active reference remains editable source');
    await page.evaluate(()=>window.editor.focusAt(0));
    assert.equal(await page.locator('#editor .managed-reference').count(),1);

    const pure=await page.evaluate(({carrier,reference})=>{
      const before=window.events.length;
      const container=document.createElement('div');
      container.innerHTML=window.editor.renderManagedMarkdown(carrier,[{...reference,originNoteId:'definition-source'}]);
      const wrapper=container.querySelector('[data-grasp-definition]');
      return {eventCount:window.events.length-before,paragraphs:wrapper.querySelectorAll('p').length,origin:wrapper.dataset.originNoteId,name:wrapper.dataset.graspDefinition,role:wrapper.getAttribute('role'),text:container.textContent};
    },{carrier,reference});
    assert.deepEqual({...pure,text:undefined},{eventCount:0,paragraphs:2,origin:'definition-source',name:'Description',role:'link',text:undefined});
    assert.ok(!pure.text.includes(':ref:'),'serialized shared renderer hides carrier syntax and retains both paragraphs');
    const opaqueCache=await page.evaluate(()=>{
      const source='[old](:ref:A)',target=document.createElement('div');
      target.innerHTML=window.editor.renderManagedMarkdown(source,[{name:'A',cachedValue:'[nested](:ref:B)\n\n[[@B|raw]]',start:0,length:source.length}]);
      const fenced=document.createElement('div');fenced.innerHTML=window.editor.renderManagedMarkdown('```json\n[old](:ref:A)\n```');
      return {names:Array.from(target.querySelectorAll('[data-grasp-definition]')).map(e=>e.dataset.graspDefinition),text:target.textContent,fenced:fenced.querySelectorAll('[data-grasp-definition]').length};
    });
    assert.deepEqual(opaqueCache.names,['A'],'cached source never recursively acquires Grasp semantics');
    assert.match(opaqueCache.text,/\[\[@B\|raw\]\]/);assert.equal(opaqueCache.fenced,0);
    const unacceptedCases=['[草稿](:ref:Draft)', '[😀第一段\r\n\r\n第二段](:ref:Draft)',
      '[[@Draft|https://example.invalid]]', '[[@Draft|第一段\r\n\r\nhttps://example.invalid]]',
      '[[@Draft|\\[link\\](Some.md)]]', '[[@Draft|`example` https://example.invalid]]',
      '[[@Draft|<em>https://example.invalid</em>]]'];
    for(const raw of unacceptedCases) {
      const displayed=await page.evaluate(raw=>{
        const container=document.createElement('div');container.innerHTML=window.editor.renderManagedMarkdown(raw);
        return {text:container.querySelector('.unaccepted-reference')?.textContent,links:container.querySelectorAll('a,[data-grasp-definition]').length,title:container.querySelector('.unaccepted-reference')?.title};
      },raw);
      assert.equal(displayed.text,raw,'unaccepted carrier preserves exact source, including CRLF/UTF-16');
      assert.equal(displayed.links,0,'unaccepted cache has no navigation or recursively rendered links');
      assert.match(displayed.title,/尚未取得/);
      const source=raw+'\n\nend';
      await page.evaluate(async source=>{window.events=[];await window.editor.setDocument('unaccepted',source,0,[],true);window.editor.focusAt(source.length);window.editor.renderReading('reading',source,[]);},source);
      assert.equal(await page.locator('#editor .content-preview,#editor .managed-reference').count(),0,'Live Preview keeps unaccepted reference syntax instead of a Markdown link widget');
      assert.match(await page.locator('#editor .cm-content').innerText(),/Draft/);
      await page.locator('#reading .unaccepted-reference').click();
      assert.equal((await page.evaluate(()=>window.events)).filter(e=>/On(?:LocalLink|ExternalLink|ReferenceClicked)/.test(e[0])).length,0,'unaccepted carrier clicks never navigate');
    }
    const fencedUnaccepted=await page.evaluate(()=>{
      const container=document.createElement('div');container.innerHTML=window.editor.renderManagedMarkdown('```json\n[cache](:ref:Draft)\n[[@Draft|https://example.invalid]]\n```\n\n`[cache](:ref:Draft)`');
      return {inert:container.querySelectorAll('.unaccepted-reference').length,links:container.querySelectorAll('a').length,code:container.querySelector('pre code').textContent};
    });
    assert.equal(fencedUnaccepted.inert,0,'disabled fences and inline code retain code presentation without Grasp interpretation');
    assert.equal(fencedUnaccepted.links,0);assert.match(fencedUnaccepted.code,/\[\[@Draft/);
    const metadata=await page.evaluate(()=>window.editor.renderManagedMarkdown('[Target](Target.md) <!-- grasp:record 11111111111111111111111111111111 -->\n\n`<!-- grasp:record 11111111111111111111111111111111 -->`\n\n<script>bad()</script>'));
    assert.equal((metadata.match(/grasp:record/g)??[]).length,1,'only the exact inert comment is hidden; code examples remain visible');
    assert.ok(!metadata.includes('<script>'));

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
    const editCount=await page.evaluate(()=>window.editEvents.length);
    assert.equal(await page.evaluate(({mapped,committed,committedRefs})=>window.editor.applyCommitted(mapped,committed,committedRefs),{mapped,committed,committedRefs}),true);
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,committed,'quiet committed patch retains raw CRLF');
    assert.equal(await page.locator('#editor .managed-reference').count(),2,'committed patch installs fresh ranges with its text');
    assert.match(await page.locator('#editor .managed-reference[data-identifier="B"]').innerText(),/新的值/);
    assert.equal(await page.evaluate(()=>window.events.filter(e=>e[0]==='OnEditorChanged').length),changeCount,'committed patch is not sent back as a user edit');
    assert.equal(await page.evaluate(()=>window.editEvents.length),editCount,'quiet committed patch emits no local-edit measurement');
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
    assert.equal(await page.evaluate(()=>window.editEvents.at(-1).composing),true,'composition edits are explicitly excluded from completed-edit candidates');
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

    // All Markdown image URLs are inert before the trusted .NET resolver returns data.
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=';
    const requests=[];page.on('request',request=>requests.push(request.url()));
    const localContent='![local](assets/photo.png) ![[assets/wiki.png]]\n\n[[Next#Heading|下一篇]] [Markdown](Other.md) [Web](https://example.invalid/)\n\n`[[Code]] ![[code.png]]`\n\n```md\n[[Fence]] ![[fence.png]]\n```\n\n![remote](https://example.invalid/remote.png)\n\n[[@Meaning|cached]]\n\n<img src="https://example.invalid/raw.png">';
    await page.evaluate(async ({png,source})=>{window.imageResolver=async()=>png;window.events=[];await window.editor.setDocument('images',source,0,[],false);window.editor.renderReading('reading',source,[]);},{png,source:localContent});
    await page.waitForFunction(()=>document.querySelectorAll('#reading img').length===2);
    assert.equal(await page.locator('#reading a[data-wiki]').count(),1,'wiki in code/fence and Grasp references stays opaque');
    assert.equal(await page.locator('#reading img').evaluateAll(images=>images.every(image=>image.src.startsWith('data:image/png;base64,'))),true);
    assert.equal(requests.some(url=>/photo\.png|wiki\.png|remote\.png|raw\.png|code\.png|fence\.png/.test(url)),false,'no browser image fetch before or after resolving');
    const imageCalls=await page.evaluate(()=>window.events.filter(e=>e[0]==='OnResolveImage'));
    assert.deepEqual(imageCalls.map(e=>e.slice(1)),[['images','assets/photo.png',false],['images','assets/wiki.png',true]]);
    await page.locator('#reading a[data-wiki]').click();
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnLocalLink'&&e[1]==='images'&&e[2]==='Next#Heading'&&e[3]===true));
    await page.locator('#reading a').filter({hasText:'Markdown'}).click();
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnLocalLink'&&e[2]==='Other.md'&&e[3]===false));
    await page.locator('#reading a').filter({hasText:'Web'}).click();
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnExternalLink'&&e[1]==='https://example.invalid/'));

    const referenceCarrier='[cache](:ref:Shared)';
    await page.evaluate(({png,source})=>{window.events=[];window.imageResolver=async()=>png;window.editor.renderReading('reading',source,[{name:'Shared',cachedValue:'![origin](shared.png) [[Other|來源連結]]',originNoteId:'source-note',start:0,length:source.length}]);},{png,source:referenceCarrier});
    await page.waitForFunction(()=>document.querySelectorAll('#reading .managed-reference img').length===1);
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnResolveImage'&&e[1]==='source-note'&&e[2]==='shared.png'));
    await page.locator('#reading .managed-reference a').click();
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnLocalLink'&&e[1]==='source-note'));
    assert.equal((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnReferenceClicked'),false,'nested link does not activate definition navigation');

    const missingRef={name:'MissingSource',cachedValue:'![lost](shared.png) [[Other|失去來源的連結]] [網站](https://example.invalid/)\n\n可點選引用查看缺失定義。',originNoteId:null,start:3,length:referenceCarrier.length};
    const missingCarrier='前文 '+referenceCarrier+' 後文';
    const missing=await page.evaluate(async({source,reference})=>{
      window.events=[];await window.editor.setDocument('missing-origin',source,0,[reference],true);
      window.editor.focusAt(source.length);window.editor.renderReading('reading',source,[reference]);
      const detached=document.createElement('div');detached.innerHTML=window.editor.renderManagedMarkdown(source,[reference]);
      return {origin:detached.querySelector('[data-origin-note-id]').dataset.originNoteId};
    },{source:missingCarrier,reference:missingRef});
    assert.equal(missing.origin,'','explicit null remains an unknown-origin marker in shared HTML');
    for(const surface of ['#editor','#reading']) {
      const link=page.locator(surface+' .managed-reference a[data-wiki]');
      assert.equal(await link.getAttribute('aria-disabled'),'true');
      await link.dispatchEvent('click');
      assert.match(await page.locator(surface+' .content-image-placeholder').innerText(),/來源筆記不存在/);
    }
    assert.equal((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnResolveImage'||e[0]==='OnLocalLink'),false,'unknown cache origins never resolve relative to the reader');
    await page.locator('#reading .managed-reference a').filter({hasText:'網站'}).click();
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnExternalLink'),'absolute web links remain available');
    await page.locator('#editor .managed-reference').press('Enter');
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnReferenceClicked'&&e[1]==='MissingSource'),'outer reference can still navigate to missing-definition feedback');

    const recordId='11111111111111111111111111111111';
    const relation='[關聯角色](Old/Path.md) <!-- grasp:record '+recordId+' -->';
    const relationSource='前文\n\n'+relation+'\n\nend';
    await page.evaluate(async source=>{window.events=[];await window.editor.setDocument('record-links',source,0,[],true);window.editor.focusAt(source.length);window.editor.renderReading('reading',source,[]);},relationSource);
    for(const surface of ['#editor','#reading']) {
      const link=page.locator(surface+' a[data-record-id]');
      assert.equal(await link.getAttribute('data-record-id'),recordId);
      assert.equal(await link.innerText(),'關聯角色');await link.click();await link.press('Enter');
    }
    assert.equal((await page.evaluate(()=>window.events)).filter(e=>e[0]==='OnRecordLink'&&e[1]===recordId).length,4,'click and Enter navigate by canonical ID on both surfaces');
    assert.equal((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnLocalLink'),false,'canonical ID never falls back to the readable path');
    await page.evaluate(position=>window.editor.focusAt(position),relationSource.indexOf('grasp:record')+2);
    assert.equal(await page.locator('#editor a[data-record-id]').count(),0,'editing the canonical comment reveals the complete carrier');
    const relationCache=await page.evaluate(({referenceCarrier,relation})=>{
      window.events=[];window.editor.renderReading('reading',referenceCarrier,[{name:'Gone',cachedValue:relation,originNoteId:null,start:0,length:referenceCarrier.length}]);
      return document.querySelector('#reading a[data-record-id]').getAttribute('aria-disabled');
    },{referenceCarrier,relation});
    assert.equal(relationCache,null,'stable record identity does not require the missing cache source path');
    await page.locator('#reading a[data-record-id]').click();
    assert.deepEqual((await page.evaluate(()=>window.events)).filter(e=>['OnRecordLink','OnLocalLink','OnReferenceClicked'].includes(e[0])),[['OnRecordLink',recordId]],'nested relation navigation wins over the surrounding Grasp reference');
    const guardedRelations='`'+relation+'`\n\n```md\n'+relation+'\n```\n\n[plain](Old.md) <!-- grasp:record invalid -->\n\n\\'+relation+'\n\n[zero](Old.md) <!-- grasp:record '+ '0'.repeat(32)+' -->';
    const guardedIds=await page.evaluate(source=>{
      const target=document.createElement('div');target.innerHTML=window.editor.renderManagedMarkdown(source);
      return target.querySelectorAll('[data-record-id]').length;
    },guardedRelations);
    assert.equal(guardedIds,0,'code, fence, escaped links and invalid IDs cannot create record navigation');

    await page.evaluate(async()=>{window.events=[];window.imageResolver=()=>new Promise(resolve=>window.finishOldImage=resolve);await window.editor.setDocument('old-images','![old](old.png)',0,[],false);window.editor.renderReading('reading','![old](old.png)',[]);});
    await page.waitForFunction(()=>typeof window.finishOldImage==='function');
    await page.evaluate(async png=>{await window.editor.setDocument('new-images','new note',0,[],false);window.editor.renderReading('reading','new note',[]);window.finishOldImage(png);},png);
    await page.waitForTimeout(30);
    assert.equal(await page.locator('#reading img').count(),0,'old image cannot appear in a different note');
    await page.evaluate(({png})=>{window.imageResolver=async()=>png;window.events=[];window.editor.renderReading('reading','![fresh](same.png)',[]);},{png});
    await page.waitForFunction(()=>document.querySelectorAll('#reading img').length===1);
    await page.evaluate(()=>window.editor.renderReading('reading','changed source ![fresh](same.png)',[]));
    await page.waitForFunction(()=>window.events.filter(e=>e[0]==='OnResolveImage'&&e[2]==='same.png').length===2);
    assert.equal(await page.locator('#reading img').count(),1,'same-note render refreshes image data');

    const liveContent='![preview](preview.png)\n\n[[Local|本機連結]]\n\n`[[Code]]`\n\n```md\n![[fence.png]]\n```\n\nend';
    await page.evaluate(async ({png,source})=>{window.events=[];window.imageResolver=async()=>png;await window.editor.setDocument('live-links',source,0,[],true);window.editor.focusAt(source.length);},{png,source:liveContent});
    await page.waitForFunction(()=>document.querySelectorAll('#editor .content-preview img').length===1);
    assert.equal(await page.locator('#editor .content-preview a[data-wiki]').count(),1,'live preview only decorates eligible ordinary Markdown');
    assert.equal((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnResolveImage'&&e[2]==='fence.png'),false);
    await page.locator('#editor .content-preview a').click();
    assert.ok((await page.evaluate(()=>window.events)).some(e=>e[0]==='OnLocalLink'&&e[1]==='live-links'&&e[2]==='Local'));
    assert.equal(await page.locator('#editor .content-preview .workspace-wiki-link').innerText(),'本機連結','wiki alias hides syntax and remains after pointer activation');
    await page.evaluate(position=>window.editor.focusAt(position),liveContent.indexOf('[[Local')+3);
    assert.equal(await page.locator('#editor .content-preview a').count(),0,'active wiki displays editable syntax');
    assert.match(await page.locator('#editor .cm-content').innerText(),/\[\[Local\|本機連結\]\]/);
    await page.evaluate(position=>window.editor.focusAt(position),liveContent.length);
    await page.locator('#editor .content-preview a').press('Enter');
    assert.equal((await page.evaluate(()=>window.events)).filter(e=>e[0]==='OnLocalLink'&&e[2]==='Local').length,2,'wiki Enter activates one navigation');
    assert.equal((await page.evaluate(()=>window.editor.snapshot())).source,liveContent,'preview navigation does not edit source');
    const opaqueRegion='@code{\n@Example = {![not-previewed](secret.png) [[Literal]]}\n}';
    const guardedContent=opaqueRegion+'\n\n\\[[Escaped]]\n\nend';
    await page.evaluate(async source=>{window.events=[];await window.editor.setDocument('guarded-images',source,0,[],true,[{start:0,length:source.indexOf('\n\n'),isComplete:true}]);window.editor.focusAt(source.length);},guardedContent);
    assert.equal(await page.locator('#editor .content-preview').count(),0,'Grasp literal regions and escaped wiki syntax remain source');
    await page.evaluate(()=>{window.imageResolver=async()=> 'https://example.invalid/unsafe.png';window.editor.renderReading('reading','![unsafe](local.png)',[]);});
    await page.waitForFunction(()=>document.querySelector('#reading .content-image-placeholder')?.textContent.includes('不支援'));
    assert.equal(await page.locator('#reading img').count(),0,'resolver cannot inject a remote URL as image data');
    await page.evaluate(()=>window.editor.dispose());
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
