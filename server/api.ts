import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore, StoreError, requireRevision, requireString } from './store.js';
import { ExchangeService, exportMarkdown } from './exchange.js';
import { RenameService } from './rename.js';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new StoreError('此操作需要 application/json。', 415);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk);
    if (length > 34 * 1024 * 1024) throw new StoreError('請求內容超過 34 MB 上限。', 413);
    chunks.push(Buffer.from(chunk));
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new StoreError('請求不是有效的 JSON。'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new StoreError('請求內容必須是 JSON object。');
  return parsed as Record<string, unknown>;
}
function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
export function createApi(options: { defaultPath?: string } = {}): { handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>; close(): void } {
  const defaultPath = options.defaultPath ?? resolve('workspaces/Welcome.grasp.db');
  // This file is only a host launcher pointer. Notes/settings/records remain solely in SQLite.
  // Explicit defaultPath is used by isolated tests/CLI hosts and never reads or writes the pointer.
  const hostStatePath = options.defaultPath === undefined ? resolve('workspaces/host-state.json') : undefined;
  let warning: string | undefined;
  let store: WorkspaceStore | undefined;
  if (hostStatePath && existsSync(hostStatePath)) {
    try {
      const pointer = JSON.parse(readFileSync(hostStatePath, 'utf8')) as { version?: unknown; path?: unknown };
      if (pointer.version !== 1 || typeof pointer.path !== 'string') throw new Error('Invalid host pointer');
      store = new WorkspaceStore(pointer.path);
    } catch { warning = '上次的 workspace 無法開啟，已開啟預設 workspace。請從「開啟 Workspace」重新選擇原 .db。'; }
  }
  store ??= new WorkspaceStore(defaultPath, { create: true, name: 'GraspPortable', seed: !existsSync(defaultPath) });
  // Narrow once after fallback initialization; all closures use a live, opened store.
  let currentStore: WorkspaceStore = store;
  function remember(): void {
    if (!hostStatePath) return;
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
  async function read(req: IncomingMessage): Promise<Record<string, unknown>> {
    const target = currentStore;
    const value = await body(req);
    if (target !== currentStore) throw new StoreError('請求傳送期間 workspace 已切換；請重新載入後操作。', 409);
    return value;
  }
  return {
    async handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return false;
      try {
        const method = req.method ?? 'GET';
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new StoreError('不支援此 HTTP method。', 405);
        const expectedWorkspace = req.headers['x-grasp-workspace'];
        if (expectedWorkspace !== undefined && expectedWorkspace !== currentStore.id) throw new StoreError('其他分頁已切換 Workspace；請重新載入，避免修改錯誤的資料庫。', 409);
        // The host enforces loopback/Host; this also blocks cross-origin writes in alternate hosts/tests.
        if (method !== 'GET') {
          const origin = req.headers.origin;
          if (origin && origin !== `http://${req.headers.host}`) throw new StoreError('拒絕跨來源的 workspace 修改。', 403);
          if (req.headers['sec-fetch-site'] === 'cross-site') throw new StoreError('拒絕跨網站的 workspace 修改。', 403);
        }
        const path = url.pathname;
        if (method === 'GET' && path === '/api/host') { json(res, { path: currentStore.path, warning, migrationBackupPath: currentStore.migrationBackupPath }); return true; }
        if (method === 'GET' && path === '/api/workspace') { json(res, currentStore.snapshot()); return true; }
        if (method === 'POST' && path === '/api/workspace/open') {
          const b = await read(req);
          const requested = requireString(b.path, 'Workspace 路徑', 4000).trim();
          if (!requested) throw new StoreError('請輸入 workspace .db 路徑。');
          if (resolve(requested) === currentStore.path) { warning = undefined; remember(); json(res, currentStore.snapshot()); return true; }
          if (b.create !== undefined && typeof b.create !== 'boolean') throw new StoreError('create 必須是 boolean。');
          const next = new WorkspaceStore(requested, { create: b.create === true, name: b.name === undefined ? basename(requested, '.db') : requireString(b.name, 'Workspace 名稱') });
          currentStore.close(); currentStore = next; exchange.clear(); rename.clear(); warning = undefined; remember();
          json(res, currentStore.snapshot()); return true;
        }
        if (method === 'POST' && path === '/api/notes') {
          const b = await read(req); json(res, currentStore.createNote(b.title, b.markdown, b.folderId)); return true;
        }
        const noteMove = /^\/api\/notes\/([^/]+)\/move$/.exec(path);
        if (noteMove && method === 'PUT') { const b = await read(req); json(res, currentStore.moveNote(decodeURIComponent(noteMove[1]!), b.folderId, requireRevision(b.revision))); return true; }
        const note = /^\/api\/notes\/([^/]+)$/.exec(path);
        if (note && method === 'PUT') { const b = await read(req); json(res, currentStore.updateNote(decodeURIComponent(note[1]!), b.title, b.markdown, requireRevision(b.revision), b.folderId)); return true; }
        if (note && method === 'DELETE') { const b = await read(req); json(res, currentStore.deleteNote(decodeURIComponent(note[1]!), requireRevision(b.revision))); return true; }
        if (method === 'POST' && path === '/api/folders') { const b = await read(req); json(res, currentStore.createFolder(b.name, b.parentId)); return true; }
        const folder = /^\/api\/folders\/([^/]+)$/.exec(path);
        if (folder && method === 'PUT') { const b = await read(req); json(res, currentStore.updateFolder(decodeURIComponent(folder[1]!), b.name, b.parentId, requireRevision(b.revision))); return true; }
        if (folder && method === 'DELETE') {
          const b = await read(req);
          if (b.recursive !== undefined && typeof b.recursive !== 'boolean') throw new StoreError('recursive 必須是 boolean。');
          json(res, currentStore.deleteFolder(decodeURIComponent(folder[1]!), requireRevision(b.revision), requireRevision(b.workspaceRevision), b.recursive === true)); return true;
        }
        const record = /^\/api\/records\/([^/]+)$/.exec(path);
        if (record && method === 'PUT') {
          const b = await read(req);
          if (!b.record || typeof b.record !== 'object' || (b.record as Record<string, unknown>).id !== decodeURIComponent(record[1]!)) throw new StoreError('URL 與 record ID 不一致。');
          json(res, currentStore.updateRecord(b.record, requireRevision(b.revision))); return true;
        }
        if (record && method === 'DELETE') { const b = await read(req); json(res, currentStore.deleteRecord(decodeURIComponent(record[1]!), requireRevision(b.revision))); return true; }
        if (method === 'PUT' && path === '/api/settings') { const b = await read(req); json(res, currentStore.updateSettings(b.settings)); return true; }
        if (method === 'GET' && path === '/api/export') {
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="GraspPortable-export.md"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(exportMarkdown(currentStore.snapshot())); return true;
        }
        if (method === 'POST' && path === '/api/import/plan') { const b = await read(req); json(res, exchange.plan(requireString(b.markdown, 'Markdown', 32 * 1024 * 1024), currentStore.snapshot())); return true; }
        if (method === 'POST' && path === '/api/import/apply') {
          const b = await read(req); const revision = requireRevision(b.workspaceRevision);
          const payload = exchange.take(requireString(b.token, 'Import token', 100), revision, currentStore.snapshot());
          json(res, currentStore.applyImport(payload, revision)); return true;
        }
        if (method === 'POST' && path === '/api/rename/plan') { const b = await read(req); json(res, rename.plan(b, currentStore.snapshot())); return true; }
        if (method === 'POST' && path === '/api/rename/apply') {
          const b = await read(req); const revision = requireRevision(b.workspaceRevision);
          const reviewed = rename.take(requireString(b.token, 'Rename token', 100), revision, currentStore.snapshot());
          json(res, currentStore.applyImport(reviewed.payload, revision, reviewed.reason)); return true;
        }
        if (method === 'GET' && path === '/api/history') { json(res, currentStore.history()); return true; }
        const historyPreview = /^\/api\/history\/(\d+)\/preview$/.exec(path);
        if (method === 'GET' && historyPreview) { json(res, currentStore.historyPreview(Number(historyPreview[1]))); return true; }
        const history = /^\/api\/history\/(\d+)\/restore$/.exec(path);
        if (method === 'POST' && history) { const b = await read(req); json(res, currentStore.restore(Number(history[1]), requireRevision(b.workspaceRevision))); return true; }
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
    close() { exchange.clear(); rename.clear(); currentStore.close(); },
  };
}
