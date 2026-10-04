import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

test('Records keyboard focus exposes a link beyond frozen columns and rows at enlarged scale', async () => {
  const app = new URL('../../../../', import.meta.url);
  const editor = await readFile(new URL('wwwroot/editor.js', app), 'utf8');
  const records = await readFile(new URL('Records/RecordsPanel.razor.js', app), 'utf8');
  const css = await readFile(new URL('wwwroot/app.css', app), 'utf8')
    + await readFile(new URL('Records/RecordsPanel.razor.css', app), 'utf8')
    + (await readFile(new URL('Records/RecordsMarkdown.razor.css', app), 'utf8')).replaceAll('::deep ', '');
  const server = createServer((request, response) => {
    response.setHeader('content-type', request.url.endsWith('.js') ? 'text/javascript' : 'text/html');
    if (request.url === '/editor.js') response.end(editor);
    else if (request.url === '/Records/RecordsPanel.razor.js') response.end(records);
    else response.end(`<html><head><style>${css}.records-scroll{width:720px;height:350px;flex:none;margin:20px;}</style></head><body><div class="records-scroll" tabindex="0"><table class="records-grid"><colgroup>${'<col style="width:220px">'.repeat(6)}</colgroup><thead><tr><th class="record-title-head">Record</th>${Array.from({length:5},(_,index)=>`<th${index===0?' style="left:220px"':''}><button class="field-heading">Field ${index}</button></th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const results = [];
    for (const zoom of [1.25, 1.5]) {
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.evaluate(async zoom => {
        document.body.style.zoom = zoom; window.records = await import('/Records/RecordsPanel.razor.js'); window.events = [];
        const receiver = { invokeMethodAsync: async (...args) => { window.events.push(args); return null; } };
        for (let row=0;row<12;row++) {
          const tr=document.createElement('tr'); if(row===0)tr.className='frozen-row'; rows.append(tr);
          const title=document.createElement('th'); title.className='record-title-cell'; if(row===0)title.style.top='44px';
          title.innerHTML=`<button class="record-title-button">Record ${row}</button>`;tr.append(title);
          for(let field=0;field<5;field++) {
            const td=document.createElement('td');
            if(field===0)Object.assign(td.style,{position:'sticky',left:'220px',zIndex:row===0?'5':'3',background:'#fafbf6'});
            if(row===0)Object.assign(td.style,{position:'sticky',top:'44px',zIndex:field===0?'5':'4',background:'#f2f5ed'});
            td.innerHTML='<div class="record-cell"><div class="record-cell-read"><div class="records-markdown compact"></div></div><button class="cell-edit">↗</button></div>';tr.append(td);
            const element=td.querySelector('.records-markdown');element.dataset.recordsRenderExpected=element.dataset.recordsPaintExpected='1';
            if(field===3){td.querySelector('button').id=`roleEdit${row}`;element.id=`roleMarkdown${row}`;}
            window.records.applyMarkdownBatch([{operation:'render',element,markdown:field===3?'[[Target|醫者]]':'Name',origin:'owner',receiver,generation:1,references:[],regions:[]}]);
          }
        }
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        const scroller=document.querySelector('.records-scroll');scroller.scrollLeft=480;scroller.scrollTop=364;
      }, zoom);
      for(const row of [0,6]) {
        await page.evaluate(() => { const scroller=document.querySelector('.records-scroll');scroller.scrollLeft=480;scroller.scrollTop=364;window.events=[]; });
        await page.locator('#roleEdit'+row).focus(); await page.keyboard.press('Shift+Tab');
        const focused = await page.evaluate(() => {
          const link=document.activeElement,rect=link.getBoundingClientRect(),cell=link.closest('.records-markdown').getBoundingClientRect();
          const hit=document.elementFromPoint((rect.left+rect.right)/2,(rect.top+rect.bottom)/2);
          const scroller=document.querySelector('.records-scroll');
          return {zoom:document.body.style.zoom,focused:link.textContent,ownCellIntersection:rect.right>cell.left&&rect.left<cell.right,
            unobscured:hit===link||link.contains(hit),hit:hit?.textContent,scrollLeft:scroller.scrollLeft,scrollTop:scroller.scrollTop};
        });
        focused.row=row;
        await page.keyboard.press('Enter'); focused.navigated=await page.evaluate(()=>window.events.filter(event=>event[0]==='Navigate'&&event[2]==='Target').length===1);
        results.push(focused);
      }
    }
    console.log('Frozen focus evidence:',JSON.stringify(results));
    for(const result of results){
      assert.equal(result.focused,'醫者');assert.equal(result.unobscured,true,'focus must pass actual hit-testing beyond sticky overlays');assert.equal(result.navigated,true);
      assert.ok(result.scrollLeft<480,'nonfrozen field must move beyond the frozen Name column');
      if(result.row===0)assert.equal(result.scrollTop,364,'already-frozen first row retains its vertical position');
      else assert.ok(result.scrollTop<364,'ordinary row must move beneath the header and frozen first row');
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
