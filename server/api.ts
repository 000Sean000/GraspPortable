import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { WorkspaceStore, StoreError, requireRevision, requireString, MAX_ATTACHMENT_BYTES } from './store.js';
import { ExchangeService, exportMarkdown } from './exchange.js';
import { RenameService } from './rename.js';
import { WorkspaceFiles, readMirrorManifest } from './files.js';
import type { WorkspaceSnapshot } from '../src/domain/model.js';

async function rawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new StoreError('請求內容超過大小上限。', 413);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk);
    if (length > limit) throw new StoreError('請求內容超過大小上限。', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new StoreError('此操作需要 application/json。', 415);
  let parsed: unknown;
  const bytes = await rawBody(req, 34 * 1024 * 1024);
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new StoreError('請求不是有效的 JSON。'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new StoreError('請求內容必須是 JSON object。');
  return parsed as Record<string, unknown>;
}
function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function download(res: ServerResponse, name: string, mimeType: string, bytes: Uint8Array | string, inline = false): void {
  const encodedName = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
  res.writeHead(200, { 'Content-Type': mimeType, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodedName}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.end(bytes);
}
async function fileTask<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) { if (error instanceof StoreError) throw error; throw new StoreError(`檔案操作未完成：${error instanceof Error ? error.message : '無法讀寫檔案。'}`); }
}
async function openDirectory(path: string): Promise<void> {
  const child = spawn(process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open', [path], { windowsHide: true, detached: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); }); child.unref();
}
export function createApi(options: { defaultPath?: string; openDirectory?: (path: string) => Promise<void> } = {}): { handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>; close(): Promise<void> } {
  const defaultPath = options.defaultPath ?? resolve('workspaces/Welcome.grasp.db');
  // This file is only a host launcher pointer. Notes/settings/records remain solely in SQLite.
  // Explicit defaultPath is used by isolated tests/CLI hosts and never reads or writes the pointer.
  const hostStatePath = options.defaultPath === undefined ? resolve('workspaces/host-state.json') : undefined;
  let warning: string | undefined;
  let store: WorkspaceStore | undefined;
  let unavailablePath: string | undefined;
  let startupError: string | undefined;
  const unavailable = (path: string, error: unknown) => { unavailablePath = path; startupError = `無法開啟 Workspace：${error instanceof Error ? error.message : '資料庫無法讀取。'} 請開啟另一個 .db，或使用驗證過的 mirror 重建新資料庫。`; };
  if (hostStatePath && existsSync(hostStatePath)) {
    try {
      const pointer = JSON.parse(readFileSync(hostStatePath, 'utf8')) as { version?: unknown; path?: unknown };
      if (pointer.version !== 1 || typeof pointer.path !== 'string') throw new Error('Invalid host pointer');
      if (existsSync(pointer.path)) { try { store = new WorkspaceStore(pointer.path); } catch (error) { unavailable(pointer.path, error); } }
      else throw new Error('Remembered database missing');
    } catch { warning = '上次的 workspace 無法開啟，已開啟預設 workspace。請從「開啟 Workspace」重新選擇原 .db。'; }
  }
  if (!store && !unavailablePath) { try { store = new WorkspaceStore(defaultPath, { create: true, name: 'GraspPortable', seed: !existsSync(defaultPath) }); } catch (error) { unavailable(defaultPath, error); } }
  let currentStore = store;
  let files = store ? new WorkspaceFiles(store.path) : undefined;
  let changing = false;
  let closed = false;
  const fileOperations = new Set<Promise<unknown>>();
  async function withFiles<T>(action: () => Promise<T>): Promise<T> {
    const operation = fileTask(action); fileOperations.add(operation);
    try { return await operation; } finally { fileOperations.delete(operation); }
  }
  if (store && files) files.schedule(store.snapshot(), sha => store!.readBlob(sha));
  function remember(): void {
    if (!hostStatePath || !currentStore) return;
    try {
      mkdirSync(dirname(hostStatePath), { recursive: true });
      const temporary = `${hostStatePath}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, path: currentStore.path }, null, 2), 'utf8');
      renameSync(temporary, hostStatePath);
    } catch { warning = 'Workspace 已開啟，但無法記住路徑。下次啟動請手動開啟目前的 .db。'; }
  }
  // Preserve a failed pointer until an explicit successful switch, to avoid losing its recovery hint.
  if (!warning) remember();
  const exchange = new ExchangeService();
  const rename = new RenameService();
  const checkTarget = (target: WorkspaceStore | undefined) => { if (changing || closed || target !== currentStore) throw new StoreError('請求期間 workspace 已切換或正在切換；請重新載入後操作。', 409); };
  async function read(req: IncomingMessage): Promise<Record<string, unknown>> {
    const target = currentStore;
    const value = await body(req);
    checkTarget(target);
    return value;
  }
  async function replaceStore(next: WorkspaceStore): Promise<void> {
    // Explicit exports may still need immutable DB blobs after an async file
    // write. Keep the old DB alive until those operations and mirror work drain.
    await Promise.allSettled([...fileOperations]);
    await files?.close();
    currentStore?.close(); currentStore = next; store = next;
    files = new WorkspaceFiles(next.path); files.schedule(next.snapshot(), sha => next.readBlob(sha));
    exchange.clear(); rename.clear(); warning = undefined; unavailablePath = undefined; startupError = undefined; remember();
  }
  return {
    async handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return false;
      try {
        const method = req.method ?? 'GET';
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new StoreError('不支援此 HTTP method。', 405);
        for (const expectedWorkspace of [req.headers['x-grasp-workspace'], url.searchParams.get('workspace') ?? undefined]) if (expectedWorkspace !== undefined && currentStore && expectedWorkspace !== currentStore.id) throw new StoreError('其他分頁已切換 Workspace；請重新載入，避免修改錯誤的資料庫。', 409);
        // The host enforces loopback/Host; this also blocks cross-origin writes in alternate hosts/tests.
        if (method !== 'GET') {
          const origin = req.headers.origin;
          if (origin && origin !== `http://${req.headers.host}`) throw new StoreError('拒絕跨來源的 workspace 修改。', 403);
          if (req.headers['sec-fetch-site'] === 'cross-site') throw new StoreError('拒絕跨網站的 workspace 修改。', 403);
        }
        const path = url.pathname;
        if (method === 'GET' && path === '/api/host') { json(res, { path: currentStore?.path ?? unavailablePath ?? defaultPath, warning, migrationBackupPath: currentStore?.migrationBackupPath, unavailablePath, error: startupError }); return true; }
        checkTarget(currentStore);
        if (method === 'POST' && path === '/api/workspace/open') {
          const b = await read(req);
          const requested = requireString(b.path, 'Workspace 路徑', 4000).trim();
          if (!requested) throw new StoreError('請輸入 workspace .db 路徑。');
          if (resolve(requested) === currentStore?.path) { warning = undefined; remember(); json(res, currentStore.snapshot()); return true; }
          if (b.create !== undefined && typeof b.create !== 'boolean') throw new StoreError('create 必須是 boolean。');
          changing = true;
          try { const next = new WorkspaceStore(requested, { create: b.create === true, name: b.name === undefined ? basename(requested, '.db') : requireString(b.name, 'Workspace 名稱') }); await replaceStore(next); json(res, next.snapshot()); }
          finally { changing = false; }
          return true;
        }
        if (method === 'POST' && path === '/api/workspace/rebuild') {
          const b = await read(req); const manifestPath = requireString(b.manifestPath, 'Manifest 路徑', 4000); const newPath = requireString(b.newPath, '新 Workspace 路徑', 4000);
          if (!manifestPath.trim() || !newPath.trim()) throw new StoreError('請指定 manifest 與全新的 .db 路徑。');
          changing = true;
          try {
            const data = await fileTask(() => readMirrorManifest(manifestPath));
            const next = WorkspaceStore.rebuild(newPath, data.snapshot, data.blobs, b.name === undefined ? undefined : requireString(b.name, 'Workspace 名稱'));
            await replaceStore(next); json(res, next.snapshot());
          } finally { changing = false; }
          return true;
        }
        if (!currentStore || !files) throw new StoreError(startupError ?? 'Workspace 尚未開啟。', 503);
        const activeStore = currentStore; const activeFiles = files;
        const reply = (snapshot: WorkspaceSnapshot) => { activeFiles.schedule(snapshot, sha => activeStore.readBlob(sha)); json(res, snapshot); };
        if (method === 'GET' && path === '/api/workspace') { json(res, activeStore.snapshot()); return true; }
        if (method === 'POST' && path === '/api/notes') {
          const b = await read(req); reply(activeStore.createNote(b.title, b.markdown, b.folderId)); return true;
        }
        const noteMove = /^\/api\/notes\/([^/]+)\/move$/.exec(path);
        if (noteMove && method === 'PUT') { const b = await read(req); reply(activeStore.moveNote(decodeURIComponent(noteMove[1]!), b.folderId, requireRevision(b.revision))); return true; }
        const note = /^\/api\/notes\/([^/]+)$/.exec(path);
        if (note && method === 'PUT') { const b = await read(req); reply(activeStore.updateNote(decodeURIComponent(note[1]!), b.title, b.markdown, requireRevision(b.revision), b.folderId)); return true; }
        if (note && method === 'DELETE') { const b = await read(req); reply(activeStore.deleteNote(decodeURIComponent(note[1]!), requireRevision(b.revision))); return true; }
        if (method === 'POST' && path === '/api/folders') { const b = await read(req); reply(activeStore.createFolder(b.name, b.parentId)); return true; }
        const folder = /^\/api\/folders\/([^/]+)$/.exec(path);
        if (folder && method === 'PUT') { const b = await read(req); reply(activeStore.updateFolder(decodeURIComponent(folder[1]!), b.name, b.parentId, requireRevision(b.revision))); return true; }
        if (folder && method === 'DELETE') {
          const b = await read(req);
          if (b.recursive !== undefined && typeof b.recursive !== 'boolean') throw new StoreError('recursive 必須是 boolean。');
          reply(activeStore.deleteFolder(decodeURIComponent(folder[1]!), requireRevision(b.revision), requireRevision(b.workspaceRevision), b.recursive === true)); return true;
        }
        const record = /^\/api\/records\/([^/]+)$/.exec(path);
        if (record && method === 'PUT') {
          const b = await read(req);
          if (!b.record || typeof b.record !== 'object' || (b.record as Record<string, unknown>).id !== decodeURIComponent(record[1]!)) throw new StoreError('URL 與 record ID 不一致。');
          reply(activeStore.updateRecord(b.record, requireRevision(b.revision))); return true;
        }
        if (record && method === 'DELETE') { const b = await read(req); reply(activeStore.deleteRecord(decodeURIComponent(record[1]!), requireRevision(b.revision))); return true; }
        if (method === 'PUT' && path === '/api/settings') { const b = await read(req); reply(activeStore.updateSettings(b.settings)); return true; }
        if (method === 'POST' && path === '/api/assets') {
          const bytes = await rawBody(req, MAX_ATTACHMENT_BYTES); checkTarget(activeStore);
          reply(activeStore.createAttachment(requireString(url.searchParams.get('name'), '附件名稱', 255), req.headers['content-type']?.split(';')[0].trim() || 'application/octet-stream', bytes, url.searchParams.get('path') ?? undefined)); return true;
        }
        const attachment = /^\/api\/assets\/([^/]+)$/.exec(path);
        if (attachment && method === 'GET') {
          const { attachment: metadata, bytes } = activeStore.readAttachment(decodeURIComponent(attachment[1]!));
          download(res, metadata.name, metadata.mimeType, bytes, ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(metadata.mimeType)); return true;
        }
        if (attachment && method === 'DELETE') { const b = await read(req); reply(activeStore.deleteAttachment(decodeURIComponent(attachment[1]!), requireRevision(b.revision))); return true; }
        if (method === 'GET' && path === '/api/files/status') { json(res, activeFiles.status()); return true; }
        if (method === 'GET' && path === '/api/files') { const entries = await withFiles(() => activeFiles.list(url.searchParams.get('path') ?? '')); checkTarget(activeStore); json(res, entries); return true; }
        if (method === 'GET' && path === '/api/files/download') {
          const file = await withFiles(() => activeFiles.read(requireString(url.searchParams.get('path'), '相對檔案路徑', 4096))); checkTarget(activeStore);
          download(res, file.name, file.mimeType, file.bytes); return true;
        }
        if (method === 'POST' && path === '/api/files/inbox') {
          const bytes = await rawBody(req, 32 * 1024 * 1024); checkTarget(activeStore);
          const entry = await withFiles(() => activeFiles.saveInbox(requireString(url.searchParams.get('name'), '檔名', 255), bytes)); checkTarget(activeStore); json(res, entry); return true;
        }
        if (method === 'POST' && path === '/api/files/exchange') {
          await read(req); const snapshot = activeStore.snapshot(); const entry = await withFiles(() => activeFiles.saveExchange(snapshot, exportMarkdown(snapshot))); checkTarget(activeStore); json(res, entry); return true;
        }
        if (method === 'POST' && path === '/api/files/export') {
          await read(req); const exported = await withFiles(() => activeFiles.buildAiFolder(activeStore.snapshot(), sha => activeStore.readBlob(sha))); checkTarget(activeStore); json(res, exported); return true;
        }
        if (method === 'POST' && path === '/api/files/import/plan') {
          const b = await read(req); const file = await withFiles(() => activeFiles.read(requireString(b.path, '相對檔案路徑', 4096), 32 * 1024 * 1024)); checkTarget(activeStore);
          if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new StoreError('請選擇 Markdown 或文字檔進行匯入預覽。');
          let markdown: string; try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); } catch { throw new StoreError('匯入檔案不是完整 UTF-8 文字，未變更資料庫。'); }
          json(res, exchange.plan(markdown, activeStore.snapshot())); return true;
        }
        if (method === 'POST' && path === '/api/files/mirror/refresh') {
          await read(req); activeFiles.schedule(activeStore.snapshot(), sha => activeStore.readBlob(sha)); const status = await activeFiles.flush(); checkTarget(activeStore); json(res, status); return true;
        }
        if (method === 'POST' && path === '/api/files/open-folder') {
          const b = await read(req); const directory = await withFiles(() => activeFiles.directoryPath(requireString(b.path, '相對資料夾路徑', 4096))); checkTarget(activeStore);
          await withFiles(() => (options.openDirectory ?? openDirectory)(directory)); json(res, { path: directory }); return true;
        }
        if (method === 'GET' && path === '/api/export') {
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="GraspPortable-export.md"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(exportMarkdown(currentStore.snapshot())); return true;
        }
        if (method === 'POST' && path === '/api/import/plan') { const b = await read(req); json(res, exchange.plan(requireString(b.markdown, 'Markdown', 32 * 1024 * 1024), currentStore.snapshot())); return true; }
        if (method === 'POST' && path === '/api/import/apply') {
          const b = await read(req); const revision = requireRevision(b.workspaceRevision);
          const payload = exchange.take(requireString(b.token, 'Import token', 100), revision, currentStore.snapshot());
          reply(activeStore.applyImport(payload, revision)); return true;
        }
        if (method === 'POST' && path === '/api/rename/plan') { const b = await read(req); json(res, rename.plan(b, currentStore.snapshot())); return true; }
        if (method === 'POST' && path === '/api/rename/apply') {
          const b = await read(req); const revision = requireRevision(b.workspaceRevision);
          const reviewed = rename.take(requireString(b.token, 'Rename token', 100), revision, currentStore.snapshot());
          reply(activeStore.applyImport(reviewed.payload, revision, reviewed.reason)); return true;
        }
        if (method === 'GET' && path === '/api/history') { json(res, currentStore.history()); return true; }
        const historyPreview = /^\/api\/history\/(\d+)\/preview$/.exec(path);
        if (method === 'GET' && historyPreview) { json(res, currentStore.historyPreview(Number(historyPreview[1]))); return true; }
        const history = /^\/api\/history\/(\d+)\/restore$/.exec(path);
        if (method === 'POST' && history) { const b = await read(req); reply(activeStore.restore(Number(history[1]), requireRevision(b.workspaceRevision))); return true; }
        throw new StoreError('找不到這個 API。', 404);
      } catch (error) {
        if (error instanceof StoreError) json(res, { error: error.message }, error.status);
        else {
          console.error('[GraspPortable API]', error);
          json(res, { error: '操作未完成，資料庫交易已回復。請查看伺服器訊息後重試。' }, 500);
        }
      }
      return true;
    },
    async close() { if (closed) return; closed = true; exchange.clear(); rename.clear(); await Promise.allSettled([...fileOperations]); await files?.close(); currentStore?.close(); },
  };
}
