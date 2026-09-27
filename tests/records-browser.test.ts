import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expect as pwExpect, chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { existsSync } from 'node:fs';
const hasChromium = existsSync(chromium.executablePath());
const hasEdge = process.platform === 'win32' && existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const harness = `<!doctype html><div id="records" style="width:320px;height:950px;overflow:auto"></div><script type="module">
import {RecordsPanel} from '/src/app/records-panel.ts';
window.calls=[];window.panel=new RecordsPanel();
window.data={id:'w1',name:'Records',revision:1,notes:[],folders:[],settings:{},records:Array.from({length:10000},(_,i)=>({id:'r'+i,collection:i<9800?'bulk':'extra'+i,name:'record'+i,fields:{element:'{shared}',label:i===9999?'最後 中文 <script>literal</'+'script>':'Label '+i},revision:1}))};
window.runtime={revision:1,values:Object.fromEntries(window.data.records.flatMap((r,i)=>[[r.collection+'.'+r.name+'.element',{status:'ok',value:i%2?'fire':'water'}],[r.collection+'.'+r.name+'.label',{status:'ok',value:r.fields.label}]])),definitions:[],references:[],diagnostics:[],metrics:{total:20000,recalculated:20000,affected:20000,elapsedMs:1}};
window.draw=()=>window.panel.render(document.querySelector('#records'),window.data,window.runtime,{onEdit:r=>window.calls.push(['edit',r?.id]),onCreateQuery:q=>window.calls.push(['query',q]),onReferences:n=>window.calls.push(['references',n]),onInsertReference:n=>window.calls.push(['insert',n]),onRename:r=>window.calls.push(['rename',r.id])});window.draw();
</script>`;
describe.skipIf(!hasChromium && !hasEdge)('record browser at 10000 records', () => {
  let server: ViteDevServer; let browser: Browser; let page: Page; const errors: string[] = [];
  beforeAll(async () => {
    server = await createServer({ configFile: false, cacheDir: '.cache/vite-tests/records-' + process.pid + '-' + Date.now(), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'records-harness', configureServer(server) { server.middlewares.use('/__records-test', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__records-test', harness)); }); } }] });
    await server.listen(); browser = await chromium.launch({ headless: true, ...(!hasChromium ? { channel: 'msedge' } : {}) }); page = await browser.newPage({ viewport: { width: 1000, height: 1000 } }); page.on('pageerror', error => errors.push(error.message));
  }, 30000);
  beforeEach(async () => { await page.goto(`${server.resolvedUrls!.local[0]}__records-test`); await page.waitForFunction(() => Boolean((window as any).panel)); });
  afterAll(async () => { await browser?.close(); await server?.close(); });
  it('pages, searches and opens a late record with qualified references and insertion', async () => {
    expect(await page.locator('.record-card').count()).toBe(40);
    await page.getByRole('button', { name: 'records 下一頁', exact: true }).click(); await pwExpect(page.locator('.gp-record-pager')).toContainText('41–80 / 10000');
    await page.getByRole('textbox', { name: '搜尋 records', exact: true }).fill('最後 中文');
    await pwExpect(page.locator('.record-card')).toHaveCount(1); await pwExpect(page.locator('.record-field').last()).toContainText('<script>literal</script>');
    await page.getByRole('button', { name: '編輯', exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['edit', 'r9999']);
    await page.getByRole('button', { name: '欄位與引用', exact: true }).click();
    await page.getByRole('button', { name: 'extra9999.record9999.label', exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['references', 'extra9999.record9999.label']);
    await page.locator('.gp-record-field').last().getByRole('button', { name: '插入引用', exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['insert', 'extra9999.record9999.label']);
    await page.getByRole('button', { name: '重新命名／移動 namespace…', exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['rename', 'r9999']); expect(errors).toEqual([]);
  });
  it('opens an entire query, edits exact resolved filters, sorts, and preserves query when creating note', async () => {
    await page.evaluate(() => { (window as any).panel.setQuery({ collection: 'bulk', where: { field: 'element', equals: 'fire' } }); (window as any).draw(); });
    await pwExpect(page.locator('#records > .section-caption')).toHaveText('4,900 / 10,000 筆資料'); expect(await page.locator('.record-card').count()).toBe(40);
    await page.getByRole('button', { name: '建立目前篩選的 table 筆記', exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['query', { collection: 'bulk', where: { field: 'element', equals: 'fire' } }]);
    await page.getByRole('textbox', { name: '欄位計算值完全等於' }).fill('Fire'); await pwExpect(page.locator('.record-card')).toHaveCount(0);
    await page.getByRole('checkbox', { name: '啟用精確欄位篩選' }).uncheck();
    await page.getByRole('combobox', { name: 'Record 排序方向' }).selectOption('descending');
    await pwExpect(page.locator('.record-card h3').first()).toHaveText('record9799');
    await page.evaluate(() => { (window as any).panel.revealRecord('r9999'); (window as any).draw(); });
    await pwExpect(page.locator('.gp-record-detail h3')).toHaveText('extra9999.record9999'); expect(errors).toEqual([]);
  });
  it('browses every collection through bounded pages and resets on workspace change', async () => {
    await page.getByRole('button', { name: '全部 collections · 201', exact: true }).click();
    expect(await page.locator('.gp-record-collections button').count()).toBe(40);
    await page.getByRole('button', { name: 'collections 下一頁', exact: true }).click();
    await pwExpect(page.locator('.gp-record-pager').first()).toContainText('41–80 / 201');
    await page.getByRole('textbox', { name: '搜尋 collections', exact: true }).fill('extra9999');
    await page.getByRole('button', { name: 'extra9999 · 1', exact: true }).click(); await pwExpect(page.locator('.record-card')).toHaveCount(1);
    await page.evaluate(() => { (window as any).data = { ...(window as any).data, id: 'w2' }; (window as any).draw(); });
    await pwExpect(page.getByRole('button', { name: '全部 collections · 201', exact: true })).toBeVisible(); expect(await page.locator('.record-card').count()).toBe(40); expect(errors).toEqual([]);
  });
});
