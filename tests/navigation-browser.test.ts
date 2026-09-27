import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expect as pwExpect, chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { existsSync } from 'node:fs';

const hasChromium = existsSync(chromium.executablePath());
const hasEdge = process.platform === 'win32' && existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const harness = `<!doctype html><div id="navigation" style="width:290px;height:850px"></div><script type="module">
import {createNavigator} from '/src/app/navigation.ts';
window.errors=[];window.patches=[];window.fileCalls=[];window.active='n0';window.lastRange=null;
window.data={id:'w1',name:'Test',settings:{},folders:Array.from({length:6},(_,i)=>({id:'f'+i,name:'層 '+i,parentId:i?'f'+(i-1):null,revision:1})),notes:Array.from({length:3000},(_,i)=>({id:'n'+i,title:'Note '+i,folderId:i<2275?'f0':'f5',markdown:'# '+i+'\\n\\nbody '+i,revision:1,updatedAt:''}))};
window.data.notes[2999].title='測試筆記';window.data.notes[2999].markdown='前言\\n關鍵搜尋測試 <script>malicious</'+'script>';
window.sync=()=>window.nav.setWorkspace(window.data,window.active);
window.select=async(id,range)=>{window.active=id;window.lastRange=range;window.sync()};
window.nav=createNavigator(document.querySelector('#navigation'),{
 onSelect:window.select,
 onRevealNote:id=>window.fileCalls.push(['note',id]),onOpenFolder:id=>window.fileCalls.push(['folder',id]),
 onCreateNote:folderId=>{window.data.notes.push({id:'created',title:'New note',folderId,markdown:'',revision:1,updatedAt:''});window.active='created';window.sync()},
 onRenameNote:(id,title)=>{window.data.notes=window.data.notes.map(n=>n.id===id?{...n,title}:n);window.sync()},
 onMoveNote:(id,folderId)=>{window.data.notes=window.data.notes.map(n=>n.id===id?{...n,folderId}:n);window.sync()},
 onDeleteNote:id=>{window.data.notes=window.data.notes.filter(n=>n.id!==id);if(window.active===id)window.active='n0';window.sync()},
 onCreateFolder:(parentId,name)=>{if(name==='collision')throw Error('名稱重複');window.data.folders.push({id:'created-folder',name,parentId,revision:1});window.sync()},
 onRenameFolder:(id,name)=>{window.data.folders=window.data.folders.map(f=>f.id===id?{...f,name}:f);window.sync()},
 onMoveFolder:(id,parentId)=>{window.data.folders=window.data.folders.map(f=>f.id===id?{...f,parentId}:f);window.sync()},
 onDeleteFolder:id=>{const ids=window.nav.index.descendants(id);window.data.folders=window.data.folders.filter(f=>!ids.has(f.id));window.data.notes=window.data.notes.filter(n=>!ids.has(n.folderId));if(!window.data.notes.some(n=>n.id===window.active))window.active='';window.sync()},
 onPersistSettings:patch=>{window.patches.push(patch);Object.assign(window.data.settings,patch)},onError:message=>window.errors.push(message)
});window.sync();
</script>`;

describe.skipIf(!hasChromium && !hasEdge)('bounded note navigator in real browser', () => {
  let server: ViteDevServer; let browser: Browser; let page: Page;
  const errors: string[] = [];
  beforeAll(async () => {
    server = await createServer({ configFile: false, cacheDir: '.cache/vite-tests/navigation-' + process.pid + '-' + Date.now(), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'navigation-harness', configureServer(server) {
      server.middlewares.use('/__navigation-test', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__navigation-test', harness)); });
    } }] });
    await server.listen(); browser = await chromium.launch({ headless: true, ...(!hasChromium ? { channel: 'msedge' } : {}) });
    page = await browser.newPage({ viewport: { width: 1000, height: 1000 } }); page.on('pageerror', error => errors.push(error.message));
  }, 30000);
  beforeEach(async () => { await page.goto(`${server.resolvedUrls!.local[0]}__navigation-test`); await page.waitForFunction(() => Boolean((window as any).nav)); });
  afterAll(async () => { await browser?.close(); await server?.close(); });

  it('reveals note files and opens the current or selected folder without changing navigation', async () => {
    await page.getByRole('button', { name: '筆記操作 Note 0', exact: true }).click();
    await page.getByRole('button', { name: '在檔案總管顯示筆記', exact: true }).click();
    await page.getByRole('button', { name: '在檔案總管開啟所在資料夾', exact: true }).click();
    await page.getByRole('button', { name: '關閉導航對話框', exact: true }).click();
    await page.getByRole('button', { name: '在檔案總管開啟目前資料夾', exact: true }).click();
    await page.getByRole('button', { name: '目前資料夾操作', exact: true }).click();
    await page.getByRole('button', { name: '在檔案總管開啟資料夾', exact: true }).click();
    expect(await page.evaluate(() => (window as any).fileCalls)).toEqual([['note', 'n0'], ['folder', 'f0'], ['folder', 'f0'], ['folder', 'f0']]);
    expect(await page.evaluate(() => (window as any).active)).toBe('n0');
    expect(await page.evaluate(() => (window as any).data.notes.length)).toBe(3000);
    expect(errors).toEqual([]);
  });

  it('pages through 2275 siblings and finds late Unicode content with precise source range', async () => {
    expect(await page.locator('#note-list .gp-nav-row').count()).toBe(80);
    await pwExpect(page.locator('.gp-nav-caption')).toContainText('2,276');
    await page.getByRole('button', { name: '下一頁', exact: true }).click();
    await pwExpect(page.locator('.gp-nav-pager')).toContainText('81–160 / 2276');
    await page.getByRole('searchbox', { name: '搜尋筆記', exact: true }).fill('關鍵搜尋測試');
    expect(await page.locator('#note-list .note-item').count()).toBe(1);
    await pwExpect(page.locator('.gp-nav-path')).toContainText('層 0 / 層 1 / 層 2 / 層 3 / 層 4 / 層 5');
    await pwExpect(page.locator('.gp-nav-snippet')).toContainText('<script>malicious</script>');
    await page.locator('.note-item').click();
    expect(await page.evaluate(() => ({ active: (window as any).active, range: (window as any).lastRange }))).toEqual({ active: 'n2999', range: { from: 3, to: 9 } });
    await page.getByRole('button', { name: '新增筆記', exact: true }).click();
    await pwExpect(page.locator('#note-search')).toHaveValue('');
    await pwExpect(page.locator('.note-item.active')).toContainText('New note');
    expect(await page.evaluate(() => (window as any).data.notes.at(-1).folderId)).toBe('f0');
    expect(errors).toEqual([]);
  });

  it('supports keyboard quick switch, session history, persisted recent20 and workspace reset', async () => {
    await page.keyboard.press('ControlOrMeta+p');
    await page.getByRole('searchbox', { name: '快速切換搜尋' }).fill('測試筆記');
    await page.getByRole('searchbox', { name: '快速切換搜尋' }).press('Enter');
    await pwExpect(page.locator('.note-item.active')).toContainText('測試筆記');
    await page.getByRole('button', { name: '返回上一份筆記' }).click();
    await pwExpect(page.locator('.note-item.active')).toContainText('Note 0');
    await page.getByRole('button', { name: '前往下一份筆記' }).click();
    await pwExpect(page.locator('.note-item.active')).toContainText('測試筆記');
    await page.evaluate(async () => { for (let i = 1; i <= 25; i++) await (window as any).select(`n${i}`); });
    await page.getByRole('button', { name: '最近', exact: true }).click();
    expect(await page.locator('#note-list .note-item').count()).toBe(20);
    await expect.poll(() => page.evaluate(() => (window as any).patches.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => JSON.parse((window as any).patches.at(-1)['navigation.recent']).length)).toBe(20);
    await page.locator('#note-search').fill('nevermatch');
    await page.evaluate(() => { (window as any).data = { ...(window as any).data, id: 'w2', settings: {} }; (window as any).sync(); });
    await pwExpect(page.locator('#note-search')).toHaveValue('');
    await pwExpect(page.getByRole('button', { name: '返回上一份筆記' })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  it('keeps failed naming dialog, excludes descendant move targets, reveals moved note and confirms delete scope', async () => {
    await page.getByRole('button', { name: '新增資料夾', exact: true }).click();
    await page.getByRole('textbox', { name: '新增資料夾', exact: true }).fill('collision');
    await page.getByRole('button', { name: '儲存', exact: true }).click();
    await pwExpect(page.locator('dialog[open] [role=alert]')).toHaveText('名稱重複');
    await page.getByRole('textbox', { name: '新增資料夾', exact: true }).fill('New folder');
    await page.getByRole('button', { name: '儲存', exact: true }).click();
    await pwExpect(page.locator('dialog[open]')).toHaveCount(0);
    await page.getByRole('button', { name: '目前資料夾操作', exact: true }).click();
    await page.getByRole('button', { name: '移動資料夾', exact: true }).click();
    expect(await page.locator('.gp-nav-picker-results button').count()).toBe(1); // only root; every folder is a descendant of f0
    await page.getByRole('button', { name: '關閉導航對話框' }).click();
    await page.getByRole('button', { name: '筆記操作 Note 0', exact: true }).click();
    await page.getByRole('button', { name: '移動筆記', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜尋目標資料夾' }).fill('層 5');
    await page.locator('.gp-nav-picker-results button').filter({ hasText: '層 5' }).click();
    await pwExpect(page.locator('.note-item.active')).toContainText('Note 0');
    expect(await page.evaluate(() => (window as any).nav.currentFolderId())).toBe('f5');
    await page.getByRole('button', { name: '目前資料夾操作', exact: true }).click();
    await page.getByRole('button', { name: '刪除資料夾…', exact: true }).click();
    await pwExpect(page.locator('.gp-nav-dialog-body p')).toContainText('726 份筆記');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect(await page.evaluate(() => (window as any).data.notes.length)).toBe(3000);
    expect(errors).toEqual([]);
  });
});
