import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expect as pwExpect, chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { existsSync } from 'node:fs';
const hasChromium = existsSync(chromium.executablePath());
const hasEdge = process.platform === 'win32' && existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const harness = `<!doctype html><div id="files" style="width:760px"></div><script type="module">
import {FilesPanel} from '/src/app/files-panel.ts';
window.calls=[];window.panel=new FilesPanel();window.data={id:'w1',name:'Files',revision:2,notes:[],folders:[],records:[],settings:{},attachments:Array.from({length:500},(_,i)=>({id:'a'+i,name:'asset'+i+'.png',path:'images/asset'+i+'.png',mimeType:'image/png',sha256:'test',size:100,revision:1,createdAt:''}))};
window.fileStatus={root:'C:/test/Workspace',directories:{inbox:'C:/test/Workspace/.grasp/exchange/inbox',outbox:'C:/test/Workspace/.grasp/exchange/outbox',mirror:'C:/test/Workspace/Markdown',markdown:'C:/test/Workspace/Markdown',attachments:'C:/test/Workspace/Markdown',internal:'C:/test/Workspace/.grasp',manifests:'C:/test/Workspace/.grasp/manifests'},projection:{path:'Markdown',absolutePath:'C:/test/Workspace/Markdown',notes:Array.from({length:500},(_,i)=>({id:'n'+i,path:'Markdown/note'+String(i).padStart(4,'0')+'.md'})),folders:[],attachments:Array.from({length:500},(_,i)=>({id:'a'+i,path:'Markdown/images/asset'+i+'.png'}))},mirror:{state:'ready',revision:2,manifestPath:'.grasp/manifests/latest.json',indexPath:'.grasp/index.md',dirtyPaths:[],writtenFiles:1,reusedFiles:499,elapsedMs:5}};
window.entries=Array.from({length:500},(_,i)=>({name:'note'+String(i).padStart(4,'0')+'.md',path:'Markdown/note'+String(i).padStart(4,'0')+'.md',absolutePath:'C:/test/Workspace/Markdown/note'+String(i).padStart(4,'0')+'.md',kind:'file',size:150,modifiedAt:''}));window.inbox=[];
window.entry=name=>({name,path:'.grasp/exchange/inbox/'+name,absolutePath:'C:/test/Workspace/.grasp/exchange/inbox/'+name,kind:'file',size:10,modifiedAt:''});
window.ready=window.panel.show(document.querySelector('#files'),{getSnapshot:()=>window.data,getDatabasePath:async()=>'C:/test/Workspace/.grasp/workspace.db',getStatus:async()=>window.fileStatus,list:async path=>{window.calls.push(['list',path]);return path==='Markdown'?window.entries:path==='.grasp/exchange/inbox'?window.inbox:[]},retryMirror:async()=>{window.calls.push(['retry']);window.fileStatus={...window.fileStatus,mirror:{...window.fileStatus.mirror,state:window.fileStatus.mirror.dirtyPaths.length?'dirty':'ready',error:undefined}};return window.fileStatus},revealFile:async path=>window.calls.push(['reveal',path]),reviewExternal:path=>window.calls.push(['external-review',path]),openFolder:async path=>window.calls.push(['open',path]),downloadFile:entry=>window.calls.push(['download',entry.path]),stageMarkdown:async files=>{window.calls.push(['markdown',files.map(f=>f.name)]);window.inbox.push(...files.map(f=>window.entry(f.name)))},saveInbox:async(name,text)=>{window.calls.push(['save-inbox',name,text]);const entry=window.entry(name);window.inbox.push(entry);return entry},reviewInbox:entry=>window.calls.push(['review',entry.path]),uploadAttachments:async files=>{window.calls.push(['upload',files.map(f=>f.name)]);window.data.attachments.push(...files.map((f,i)=>({id:'uploaded'+i,name:f.name,path:f.name,mimeType:f.type,sha256:'test',size:f.size,revision:1,createdAt:''})));window.fileStatus.projection.attachments.push(...files.map((f,i)=>({id:'uploaded'+i,path:'Markdown/'+f.name})))},deleteAttachment:async asset=>{window.calls.push(['delete',asset.id]);window.data.attachments=window.data.attachments.filter(a=>a.id!==asset.id)},insertAttachment:(asset,embed)=>window.calls.push(['insert',asset.id,embed])});
</script>`;
describe.skipIf(!hasChromium && !hasEdge)('files and assets browser controls', () => {
  let server: ViteDevServer; let browser: Browser; let page: Page; const errors: string[] = [];
  beforeAll(async () => {
    server = await createServer({ configFile: false, cacheDir: '.cache/vite-tests/files-' + process.pid + '-' + Date.now(), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'files-harness', configureServer(server) { server.middlewares.use('/__files-test', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__files-test', harness)); }); } }] });
    await server.listen(); browser = await chromium.launch({ headless: true, ...(!hasChromium ? { channel: 'msedge' } : {}) }); page = await browser.newPage({ viewport: { width: 1100, height: 1100 } }); await page.context().grantPermissions(['clipboard-read', 'clipboard-write']); page.on('pageerror', error => errors.push(error.message));
  }, 30000);
  beforeEach(async () => { await page.goto(`${server.resolvedUrls!.local[0]}__files-test`); await page.waitForFunction(() => Boolean((window as any).ready)); await page.evaluate(() => (window as any).ready); });
  afterAll(async () => { await browser?.close(); await server?.close(); });
  it('browses the single 500-file projection with real paths and stages returned text for controlled review', async () => {
    expect(await page.getByRole('button', { name: '建立給 AI 的資料夾匯出', exact: true }).count()).toBe(0);
    await pwExpect(page.locator('.gp-files-locations')).toContainText('C:/test/Workspace/Markdown');
    await pwExpect(page.locator('.gp-files-advanced')).not.toHaveAttribute('open');
    expect(await page.evaluate(() => (window as any).calls[0])).toEqual(['list', 'Markdown']);
    expect(await page.locator('.gp-file-row').count()).toBe(50);
    await page.getByRole('button', { name: '檔案下一頁', exact: true }).click(); await pwExpect(page.locator('.gp-files-pager')).toContainText('51–100 / 500');
    await page.getByRole('searchbox', { name: '搜尋檔案或附件' }).fill('note0499'); await pwExpect(page.locator('.gp-file-row')).toHaveCount(1);
    await page.getByRole('button', { name: '在檔案總管顯示', exact: true }).click(); expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['reveal', 'Markdown/note0499.md']);
    await page.getByRole('button', { name: '下載', exact: true }).click(); expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['download', 'Markdown/note0499.md']);
    await page.getByRole('button', { name: '複製路徑', exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('C:/test/Workspace/Markdown/note0499.md');
    await page.locator('.gp-files-ai summary').click(); await page.getByLabel('AI 回傳檔名').fill('review.md'); await page.getByLabel('AI 回傳 Markdown').fill('# AI\n\nPending review only.');
    await page.getByRole('button', { name: '保存並審查匯入', exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls.filter((call: string[]) => ['save-inbox', 'review'].includes(call[0])))).toEqual([['save-inbox', 'review.md', '# AI\n\nPending review only.'], ['review', '.grasp/exchange/inbox/review.md']]);
    expect(errors).toEqual([]);
  });
  it('routes a multi-file drop to inbox and attachments, then inserts and confirms deletion', async () => {
    const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['# A'], 'A.md', { type: 'text/markdown' })); data.items.add(new File(['# B'], 'B.markdown', { type: 'text/markdown' })); data.items.add(new File(['image'], 'small.png', { type: 'image/png' })); return data; });
    await page.getByLabel('拖曳 Markdown 或附件').dispatchEvent('drop', { dataTransfer: transfer });
    await pwExpect(page.locator('.gp-files-message')).toContainText('2 份 Markdown');
    expect(await page.evaluate(() => (window as any).calls.filter((call: string[]) => ['markdown', 'upload'].includes(call[0])))).toEqual([['markdown', ['A.md', 'B.markdown']], ['upload', ['small.png']]]);
    await page.getByRole('button', { name: '附件', exact: true }).click(); expect(await page.locator('.gp-file-row').count()).toBe(50);
    await page.getByRole('searchbox', { name: '搜尋檔案或附件' }).fill('small.png'); await page.getByRole('button', { name: '插入圖片', exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['insert', 'uploaded0', true]);
    await pwExpect(page.locator('.gp-file-row')).toContainText('C:/test/Workspace/Markdown/small.png');
    await page.getByRole('button', { name: '在檔案總管顯示', exact: true }).click(); expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['reveal', 'Markdown/small.png']);
    await pwExpect(page.getByRole('link', { name: '下載附件' })).toHaveAttribute('href', '/api/assets/uploaded0?workspace=w1');
    await page.getByRole('button', { name: '刪除附件…', exact: true }).click(); expect(await page.evaluate(() => (window as any).data.attachments.length)).toBe(501);
    await page.getByRole('button', { name: '確認刪除並保存復原點', exact: true }).click(); await pwExpect(page.locator('.gp-file-row')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).data.attachments.length)).toBe(500); expect(errors).toEqual([]);
  });
  it('finds late external changes, routes review and keeps dirty evidence after an update attempt', async () => {
    await page.evaluate(() => { (window as any).fileStatus.mirror = { ...(window as any).fileStatus.mirror, state: 'dirty', dirtyPaths: [...(window as any).entries.map((entry: any) => entry.path), 'Markdown/unknown.bin'] }; });
    await page.getByRole('button', { name: '重新整理檔案狀態', exact: true }).click();
    await pwExpect(page.locator('.gp-files-mirror')).toContainText('有外部變更待審查');
    expect(await page.locator('.gp-files-dirty-row').count()).toBe(50);
    await page.getByRole('searchbox', { name: '搜尋外部變更路徑' }).fill('note0499');
    await pwExpect(page.locator('.gp-files-dirty-row')).toHaveCount(1);
    await pwExpect(page.locator('.gp-files-dirty-row')).toContainText('C:/test/Workspace/Markdown/note0499.md');
    await page.locator('.gp-files-dirty-row').getByRole('button', { name: '審查外部修改', exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['external-review', 'Markdown/note0499.md']);
    expect(await page.evaluate(() => (window as any).data.revision)).toBe(2);
    await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click();
    await pwExpect(page.locator('.gp-files-mirror')).toContainText('有外部變更待審查');
    await page.getByRole('searchbox', { name: '搜尋外部變更路徑' }).fill('unknown.bin');
    expect(await page.locator('.gp-files-dirty-row').getByRole('button', { name: '審查外部修改', exact: true }).count()).toBe(0);
    await page.locator('.gp-files-dirty-row').getByRole('button', { name: '在檔案總管顯示', exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['reveal', 'Markdown/unknown.bin']);
    await page.getByRole('button', { name: '開啟 Workspace 資料夾', exact: true }).click(); expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['open', '']);
    await page.getByRole('button', { name: '在檔案總管開啟 Markdown', exact: true }).click(); expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['open', 'Markdown']);
    expect(errors).toEqual([]);
  });
  it('ignores a late failed load after reopening and retains separate unsent AI drafts per workspace', async () => {
    await page.evaluate(async () => {
      const panel = (window as any).panel, callbacks = panel.callbacks, container = document.querySelector<HTMLElement>('#files')!;
      let reject!: (error: Error) => void;
      const pending = panel.show(container, { ...callbacks, getStatus: () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }) });
      await panel.show(container, callbacks); reject(new Error('Old closed request')); await pending;
    });
    await pwExpect(page.locator('.gp-files-panel')).not.toContainText('Old closed request'); expect(await page.locator('.gp-file-row').count()).toBe(50);
    await page.locator('.gp-files-ai summary').click(); await page.getByLabel('AI 回傳 Markdown').fill('Draft for workspace one');
    await page.evaluate(async () => { const panel = (window as any).panel; (window as any).data = { ...(window as any).data, id: 'w2' }; await panel.show(document.querySelector('#files'), panel.callbacks); });
    await page.locator('.gp-files-ai summary').click(); await pwExpect(page.getByLabel('AI 回傳 Markdown')).toHaveValue('');
    await page.getByLabel('AI 回傳 Markdown').fill('Draft for workspace two');
    await page.evaluate(async () => { const panel = (window as any).panel; (window as any).data = { ...(window as any).data, id: 'w1' }; await panel.show(document.querySelector('#files'), panel.callbacks); });
    await page.locator('.gp-files-ai summary').click(); await pwExpect(page.getByLabel('AI 回傳 Markdown')).toHaveValue('Draft for workspace one'); expect(errors).toEqual([]);
  });
  it('aborts view-owned reads when the file panel closes or is reopened', async () => {
    await page.evaluate(async () => {
      const panel = (window as any).panel, callbacks = panel.callbacks, container = document.querySelector<HTMLElement>('#files')!;
      const signals: AbortSignal[] = [];
      const slow = {
        ...callbacks,
        getStatus: (signal?: AbortSignal) => {
          signals.push(signal!);
          return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
        },
      };
      const pending = panel.show(container, slow); panel.destroy(); await pending;
      const reopened = { ...callbacks, getStatus: (signal?: AbortSignal) => { signals.push(signal!); return callbacks.getStatus(); } };
      await panel.show(container, reopened); panel.destroy();
      (window as any).readSignalsAborted = signals.map(signal => signal.aborted);
    });
    expect(await page.evaluate(() => (window as any).readSignalsAborted)).toEqual([true, true]);
    expect(errors).toEqual([]);
  });
  it('announces a running projection update outside inert controls and safely ignores failure after close', async () => {
    await page.evaluate(() => { (window as any).panel.callbacks.retryMirror = () => new Promise((_resolve, reject) => { (window as any).rejectUpdate = reject; }); });
    await page.getByRole('button', { name: '更新 Markdown 投影', exact: true }).click();
    await pwExpect(page.getByRole('status')).toHaveText('◌ 更新 Markdown 投影…');
    await pwExpect(page.locator('.gp-files-panel')).toHaveAttribute('inert', '');
    await page.evaluate(() => { (window as any).panel.destroy(); (window as any).rejectUpdate(new Error('Closed operation')); });
    await pwExpect(page.locator('.gp-files-busy')).toHaveCount(0); expect(errors).toEqual([]);
  });
});
