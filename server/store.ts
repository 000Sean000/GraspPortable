import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import type { Attachment, Folder, Note, StructuredRecord, WorkspaceSnapshot } from '../src/domain/model.js';
import { applySharedIntent, prepareSharedWorkspace, type SharedSemanticState, type SemanticIdentityHints, type SemanticSourcePatch, type RawSourceChange } from '../src/domain/shared.js';
import { parseNoteLanguage } from '../src/domain/note-language.js';
import { buildKnowledge } from '../src/domain/knowledge.js';
import type { ValueGraph } from '../src/domain/graph.js';
import { canonicalPayload, sourceHash, semanticSourcePatch, type DraftAcknowledgement, type DurableDraft, type OperationReceipt, type SharedCommand, type SharedCommitResponse, type SharedStateResponse, type SourceSyntax } from './semantic.js';

// All persisted objects crossing this boundary are Grasp-owned plain data.
const APPLICATION_ID = 0x47525031;
const SCHEMA_VERSION = 4;
export const MAX_MARKDOWN_CHARACTERS = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export class StoreError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export interface RecoveryEntry { id: number; createdAt: string; reason: string; workspaceRevision: number }
type RecoveryChange<T> = { id: string; kind: 'create' | 'update' | 'delete'; before: T | null; after: T | null };
export interface RecoveryPreview {
  id: number; createdAt: string; reason: string; scope: 'workspace'; workspaceRevision: number; snapshotRevision: number;
  current: { notes: number; folders: number; records: number; attachments: number }; target: { notes: number; folders: number; records: number; attachments: number };
  changes: {
    notes: (RecoveryChange<{ title: string; folderId: string | null }> & { contentChanged: boolean })[];
    folders: RecoveryChange<{ name: string; parentId: string | null }>[];
    records: (RecoveryChange<{ collection: string; name: string; fieldCount: number }> & { changedFields: string[] })[];
    attachments: RecoveryChange<Pick<Attachment, 'name' | 'path' | 'size' | 'sha256'>>[];
  };
  settingsChanged: boolean; nameBefore: string; nameAfter: string;
}
export type ImportNote = Pick<Note, 'id' | 'title' | 'markdown'> & { folderId?: string | null; syntaxVersion?: SourceSyntax };
export interface ImportPayload { notes: ImportNote[]; records?: StructuredRecord[]; folders?: Folder[] }
type Row = Record<string, unknown>;

export function requireString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new StoreError(`${field} 必須是有效文字（最多 ${max} 字元）。`);
  // SQLite TEXT is Unicode text. Reject unpaired UTF-16 surrogates rather than
  // letting the driver silently replace the caller's exact source with U+FFFD.
  if (/[\ud800-\udfff]/u.test(value)) throw new StoreError(`${field} 含有不完整的 Unicode 字元；沒有改寫原文。`);
  return value;
}
export function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new StoreError('缺少有效的 revision。');
  return value as number;
}
export function requireFolderId(value: unknown): string | null {
  if (value === null) return null;
  const id = requireString(value, '資料夾 ID', 128);
  if (!id) throw new StoreError('資料夾 ID 不得為空。');
  return id;
}
export function requireSyntax(value: unknown): SourceSyntax {
  if (value !== 'legacy-v0.2' && value !== 'grasp-v1') throw new StoreError('不支援此筆記 syntaxVersion。');
  return value;
}
export function validateNote(input: { id: unknown; title: unknown; markdown: unknown; folderId?: unknown; syntaxVersion?: unknown }): ImportNote {
  const id = requireString(input.id, '筆記 ID', 128);
  const title = requireString(input.title, '標題', 500).trim();
  if (!id || !title) throw new StoreError('筆記 ID 與標題不得為空。');
  return { id, title, markdown: requireString(input.markdown, 'Markdown', MAX_MARKDOWN_CHARACTERS), ...(input.folderId === undefined ? {} : { folderId: requireFolderId(input.folderId) }), ...(input.syntaxVersion === undefined ? {} : { syntaxVersion: requireSyntax(input.syntaxVersion) }) };
}
function folderNameKey(name: string): string { return name.normalize('NFC').toLowerCase(); }
export function normalizeAttachmentPath(input: unknown): string {
  const path = requireString(input, '附件相對路徑', 4000).replaceAll('\\', '/');
  const parts = path.split('/');
  if (!path || parts.some(part => !part || part === '.' || part === '..' || part.length > 255 || /[<>:"|?*\u0000-\u001f\u007f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new StoreError('附件路徑必須是安全的相對路徑，不得含有絕對路徑、..、保留名稱或無效字元。');
  return path;
}
export function validateAttachment(input: unknown): Attachment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoreError('附件 metadata 格式錯誤。');
  const a = input as Record<string, unknown>;
  const id = requireString(a.id, '附件 ID', 128); const path = normalizeAttachmentPath(a.path);
  const name = requireString(a.name, '附件名稱', 255);
  const mimeType = requireString(a.mimeType, '附件 MIME type', 100).toLowerCase();
  const sha256 = requireString(a.sha256, '附件 SHA256', 64);
  if (!id || name !== path.split('/').at(-1) || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType) || !/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(a.size) || (a.size as number) < 0 || (a.size as number) > MAX_ATTACHMENT_BYTES) throw new StoreError('附件名稱、MIME type、雜湊或大小不合法（單檔最多 64 MiB）。');
  return { id, name, path, mimeType, sha256, size: a.size as number, revision: requireRevision(a.revision), createdAt: requireString(a.createdAt, '附件建立時間', 100) };
}
export function validateFolder(input: unknown): Folder {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoreError('資料夾格式錯誤。');
  const f = input as Record<string, unknown>;
  const id = requireString(f.id, '資料夾 ID', 128);
  const name = requireString(f.name, '資料夾名稱', 255).trim().normalize('NFC');
  if (!id || !name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)) throw new StoreError('資料夾名稱不得為空、.、..，或包含路徑分隔符與控制字元。');
  return { id, parentId: requireFolderId(f.parentId), name, revision: requireRevision(f.revision ?? 0) };
}
export function validateHierarchy(folders: Folder[], notes: { folderId?: string | null }[]): void {
  const byId = new Map(folders.map(f => [f.id, f]));
  if (byId.size !== folders.length) throw new StoreError('資料夾 ID 重複。');
  const siblings = new Set<string>();
  for (const f of folders) {
    if (f.parentId !== null && !byId.has(f.parentId)) throw new StoreError('找不到上層資料夾。');
    const key = JSON.stringify([f.parentId, folderNameKey(f.name)]);
    if (siblings.has(key)) throw new StoreError('同一資料夾下不可有重複資料夾名稱（不區分大小寫）。');
    siblings.add(key);
  }
  // Mark completed chains once: a deep tree remains O(folders), without recursion.
  const done = new Set<string>();
  for (const f of folders) {
    const chain = new Set<string>();
    let cursor: string | null = f.id;
    while (cursor !== null && !done.has(cursor)) {
      if (chain.has(cursor)) throw new StoreError('資料夾不可移入自己或子資料夾，會造成循環。');
      chain.add(cursor); cursor = byId.get(cursor)!.parentId;
    }
    for (const id of chain) done.add(id);
  }
  if (notes.some(n => n.folderId != null && !byId.has(n.folderId))) throw new StoreError('筆記指向不存在的資料夾。');
}
export function validateRecord(input: unknown): StructuredRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoreError('Record 格式錯誤。');
  const r = input as Record<string, unknown>;
  const id = requireString(r.id, 'Record ID', 128);
  const collection = requireString(r.collection, 'collection', 100);
  const name = requireString(r.name, 'name', 100);
  if (!id || !identifier.test(collection) || !identifier.test(name)) throw new StoreError('collection / name 必須符合 identifier 語法。');
  if (!r.fields || typeof r.fields !== 'object' || Array.isArray(r.fields)) throw new StoreError('fields 必須是字串欄位物件。');
  const fields: [string, string][] = [];
  for (const [key, value] of Object.entries(r.fields)) {
    if (!identifier.test(key) || key.length > 100) throw new StoreError(`無效的欄位名稱：${key}`);
    fields.push([key, requireString(value, `fields.${key}`, 100_000)]);
  }
  if (fields.length > 500) throw new StoreError('每筆 record 最多 500 個欄位。');
  return { id, collection, name, fields: Object.fromEntries(fields), revision: requireRevision(r.revision ?? 0) };
}
function validateSettings(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoreError('Settings 格式錯誤。');
  const settings = Object.fromEntries(Object.entries(input).map(([k, v]) => [requireString(k, 'Setting key', 100), requireString(v, 'Setting value', 10_000)]));
  if (Object.keys(settings).length > 200) throw new StoreError('Settings 超過上限。');
  return settings;
}
export function validateSnapshot(input: unknown): WorkspaceSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoreError('Workspace snapshot 格式錯誤。');
  const value = input as Record<string, unknown>;
  const id = requireString(value.id, 'Workspace ID', 128);
  const name = requireString(value.name, 'Workspace 名稱');
  const revision = requireRevision(value.revision);
  if (!id || !name || revision === 0 || !Array.isArray(value.notes) || !Array.isArray(value.records)) throw new StoreError('Workspace snapshot 缺少必要資料。');
  const notes = value.notes.map(n => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) throw new StoreError('Snapshot 筆記格式錯誤。');
    const note = n as Note;
    return { ...validateNote(note), folderId: note.folderId === undefined ? null : requireFolderId(note.folderId), revision: requireRevision(note.revision), updatedAt: requireString(note.updatedAt, 'Updated timestamp', 100) };
  });
  if (value.folders !== undefined && !Array.isArray(value.folders)) throw new StoreError('Snapshot 資料夾格式錯誤。');
  const folders = ((value.folders ?? []) as unknown[]).map(validateFolder);
  if (value.attachments !== undefined && !Array.isArray(value.attachments)) throw new StoreError('Snapshot 附件格式錯誤。');
  const attachments = ((value.attachments ?? []) as unknown[]).map(validateAttachment);
  const records = value.records.map(validateRecord);
  if ([...notes, ...folders, ...records, ...attachments].some(n => n.revision === 0 || n.revision > revision)) throw new StoreError('Workspace snapshot revision 不一致。');
  if (new Set(notes.map(n => n.id)).size !== notes.length || new Set(records.map(r => r.id)).size !== records.length || new Set(records.map(r => `${r.collection}\0${r.name}`)).size !== records.length) throw new StoreError('Workspace snapshot 有重複資料。');
  validateHierarchy(folders, notes);
  const attachmentPaths = attachments.map(a => folderNameKey(a.path)); const pathSet = new Set(attachmentPaths);
  if (new Set(attachments.map(a => a.id)).size !== attachments.length || pathSet.size !== attachments.length || attachmentPaths.some(path => { const parts = path.split('/'); return parts.some((_, i) => i > 0 && pathSet.has(parts.slice(0, i).join('/'))); })) throw new StoreError('Workspace snapshot 有重複附件 ID，或附件路徑互相衝突。');
  return { id, name, revision, notes, folders, attachments, records, settings: validateSettings(value.settings) };
}
function welcomeNotes(): Pick<Note, 'id' | 'title' | 'markdown'>[] {
  return [
    { id: 'welcome', title: '從這裡開始', markdown: '# 歡迎使用 GraspPortable\n\n這是一份可以直接編輯的筆記。點一下文字開始寫；游標離開後，同一編輯區會顯示 Markdown 與 identifier 的結果。\n\n## 一個小小的自我介紹\n\n@first_name = "Sean"\n@last_name = "Wu"\n@full_name = "{first_name} {last_name}"\n@greeting = "你好，{full_name}！"\n\n今天想說的話：{{greeting}}\n\n試著修改 `@first_name` 的字串。姓名與問候會一起更新，原始筆記仍保留 reference。\n\n- **自然寫作**：標題、粗體、斜體、清單、引用、連結都能直接寫。\n- **找來源**：點選顯示值可前往 definition；在右側 identifier 清單可以找 references。\n- **資料保存**：變更提交後會顯示「已儲存」。SQLite workspace 是唯一資料來源。\n- **與 AI 協作**：匯出 Markdown → 外部修改 → 匯入預覽 → 確認套用。\n\n> 完整語法與資料表範例在左側的「語法與資料表」。\n' },
    { id: 'guide', title: '語法與資料表', markdown: '# 語法與資料表\n\n## Identifier\n\n獨立一行的 `@name = "字串"` 建立全 workspace 共用值。字串使用 JSON 跳脫規則；`{name}` 在字串中組合其他值。正文的 `{{name}}` 顯示值。\n\n@project = "GraspPortable"\n@signature = "{full_name} · {project}"\n\n這份筆記來自 {{signature}}。\n\n名稱可以包含英文字母、數字、底線、點與連字號；第一個字元必須是英文字母或底線。程式碼區塊與行內程式碼不會解析 identifier。\n\n## 一份資料，多個 view\n\nRecords 集中存於資料庫。右側資料面板可以建立與修改，欄位也能引用 identifier。\n\n```grasp-query\n{"collection":"aura"}\n```\n\n只有火屬性的資料：\n\n```grasp-query\n{"collection":"aura","where":{"field":"element","equals":"fire"}}\n```\n\n炎羽的說明：{{aura.flame.description}}\n\n## 匯出與回復\n\n匯出的 Markdown 內含可讀筆記與 versioned metadata。請保留 metadata 與 note 邊界；修改內容後先看匯入差異，再確認。一般 Markdown 也能匯入為新筆記。\n\n匯入或刪除前會在資料庫內建立 recovery snapshot。回復也會先保存當前 workspace，避免覆蓋後無法再找回。\n' },
  ];
}

const FOLDER_SCHEMA = `CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id) DEFERRABLE INITIALLY DEFERRED, name TEXT NOT NULL, name_key TEXT NOT NULL, revision INTEGER NOT NULL);
  CREATE UNIQUE INDEX folders_siblings ON folders(COALESCE(parent_id, ''), name_key);`;
const ATTACHMENT_SCHEMA = `CREATE TABLE attachment_blobs (sha256 TEXT PRIMARY KEY, bytes BLOB NOT NULL);
  CREATE TABLE attachments (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, sha256 TEXT NOT NULL REFERENCES attachment_blobs(sha256), size INTEGER NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL);`;
const SHARED_SCHEMA = `CREATE TABLE semantic_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, state_json TEXT NOT NULL);
  CREATE TABLE drafts (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, note_id TEXT NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL, syntax_version TEXT NOT NULL, base_note_revision INTEGER NOT NULL, base_source_hash TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, source_edits_json TEXT);
  CREATE INDEX drafts_client ON drafts(client_id);
  CREATE TABLE operations (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, receipt_json TEXT NOT NULL, inverse_json TEXT NOT NULL);`;
function readSnapshot(db: DatabaseSync, version = SCHEMA_VERSION): WorkspaceSnapshot {
  const w = db.prepare('SELECT id, name, revision, settings_json FROM workspace').get()!;
  const notes = db.prepare(`SELECT id, title, markdown, revision, updated_at AS updatedAt, ${version === 1 ? 'NULL' : 'folder_id'} AS folderId${version >= 4 ? ', syntax_version AS syntaxVersion' : ''} FROM notes ORDER BY rowid`).all() as unknown as Note[];
  const folders = version === 1 ? [] : db.prepare('SELECT id, parent_id AS parentId, name, revision FROM folders ORDER BY rowid').all() as unknown as Folder[];
  const attachments = version < 3 ? [] : db.prepare('SELECT id, name, path, mime_type AS mimeType, sha256, size, revision, created_at AS createdAt FROM attachments ORDER BY rowid').all() as unknown as Attachment[];
  const records = db.prepare('SELECT id, collection, name, fields_json, revision FROM records ORDER BY collection, name').all().map(r => ({ id: String(r.id), collection: String(r.collection), name: String(r.name), fields: JSON.parse(String(r.fields_json)), revision: Number(r.revision) }));
  return { id: String(w.id), name: String(w.name), revision: Number(w.revision), settings: JSON.parse(String(w.settings_json)), notes, folders, attachments, records };
}
function inspectDatabase(db: DatabaseSync): number {
  const app = Number(db.prepare('PRAGMA application_id').get()?.application_id);
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (app !== APPLICATION_ID) throw new StoreError('這不是 GraspPortable workspace；原檔未變更。');
  if (version < 1 || version > SCHEMA_VERSION) throw new StoreError(`此 workspace schema 為 ${version}；本版支援 1–${SCHEMA_VERSION}，原檔未變更。`);
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new StoreError('Workspace 完整性檢查失敗，原檔未變更。');
  if (db.prepare('SELECT COUNT(*) AS count FROM workspace').get()!.count !== 1) throw new StoreError('Workspace metadata 不完整，原檔未變更。');
  validateSnapshot(readSnapshot(db, version));
  db.prepare('SELECT id, created_at, reason, workspace_revision, snapshot_json FROM history LIMIT 1').get();
  if (version >= 2) {
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new StoreError('Workspace 資料夾關聯不完整，原檔未變更。');
    for (const f of db.prepare('SELECT name, name_key FROM folders').all()) if (f.name_key !== folderNameKey(String(f.name))) throw new StoreError('Workspace 資料夾名稱索引不一致，原檔未變更。');
  }
  if (version >= 3) for (const a of db.prepare('SELECT a.path, a.path_key, a.size, length(b.bytes) AS byte_size FROM attachments a LEFT JOIN attachment_blobs b ON b.sha256=a.sha256').all()) {
    if (a.size !== a.byte_size || a.path_key !== folderNameKey(String(a.path))) throw new StoreError('Workspace 附件資料不完整或路徑索引不一致，原檔未變更。');
  }
  if (version >= 4) {
    const row = db.prepare('SELECT revision, state_json FROM semantic_state WHERE singleton=1').get();
    if (!row) throw new StoreError('Workspace semantic state 不完整，原檔未變更。');
    const state = JSON.parse(String(row.state_json)) as SharedSemanticState;
    if (state.revision !== row.revision || state.workspaceId !== readSnapshot(db, version).id || !Array.isArray(state.bindings) || !Array.isArray(state.results)) throw new StoreError('Workspace semantic state 與資料庫不符，原檔未變更。');
    db.prepare('SELECT id, revision FROM drafts LIMIT 1').get();
    db.prepare('SELECT id, payload_hash, receipt_json, inverse_json FROM operations LIMIT 1').get();
  }
  return version;
}
function migrationFingerprint(db: DatabaseSync, version: number): string {
  const snapshot = readSnapshot(db, version);
  snapshot.notes.sort((a, b) => a.id.localeCompare(b.id));
  snapshot.folders.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify([snapshot, db.prepare('SELECT * FROM history ORDER BY id').all(), ...(version < 4 ? [] : [
    db.prepare('SELECT * FROM semantic_state ORDER BY singleton').all(), db.prepare('SELECT * FROM drafts ORDER BY id').all(), db.prepare('SELECT * FROM operations ORDER BY id').all(),
  ])]);
}

function hasDraftSourceEdits(db: DatabaseSync): boolean { return db.prepare("PRAGMA table_info('drafts')").all().some(row => row.name === 'source_edits_json'); }
function validateSourceEdits(input: unknown): RawSourceChange[][] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 10_000) throw new StoreError('Draft sourceEdits 必須是有界的原始文字修改步驟。');
  let count = 0, size = 0;
  return input.map(step => {
    if (!Array.isArray(step)) throw new StoreError('Draft sourceEdits 每個 step 必須是陣列。');
    let end = 0;
    return step.map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new StoreError('Source edit 必須是物件。');
      if (Object.keys(raw).some(key => !['from', 'to', 'insert', 'expected'].includes(key))) throw new StoreError('Source edit 含有未知欄位。');
      const from = requireRevision(raw.from), to = requireRevision(raw.to);
      const insert = requireString(raw.insert, 'Source edit insert', MAX_MARKDOWN_CHARACTERS);
      const expected = raw.expected === undefined ? undefined : requireString(raw.expected, 'Source edit expected', MAX_MARKDOWN_CHARACTERS);
      if (from < end || to < from) throw new StoreError('同一 source edit step 必須依原始位置排序且不可重疊。');
      end = to; count++; size += insert.length + (expected?.length ?? 0);
      if (count > 50_000 || size > 2 * MAX_MARKDOWN_CHARACTERS) throw new StoreError('Source edit lineage 超過本次 draft 上限；原稿未被替換。');
      return { from, to, insert, ...(expected === undefined ? {} : { expected }) };
    });
  });
}
function readDraft(row: Row): DurableDraft {
  const { source_edits_json, ...draft } = row;
  return { ...draft, ...(source_edits_json == null ? {} : { sourceEdits: validateSourceEdits(JSON.parse(String(source_edits_json))) }) } as unknown as DurableDraft;
}

export class WorkspaceStore {
  readonly path: string;
  readonly migrationBackupPath?: string;
  private db: DatabaseSync;
  private graph?: ValueGraph;
  private graphRevision = 0;
  get id(): string { return String(this.db.prepare('SELECT id FROM workspace').get()!.id); }

  constructor(path: string, options: { create?: boolean; name?: string; seed?: boolean; exclusive?: boolean } = {}) {
    requireString(options.name ?? '我的 Workspace', 'Workspace 名稱');
    this.path = path === ':memory:' ? path : resolve(path);
    if (path !== ':memory:' && extname(path).toLowerCase() !== '.db') throw new StoreError('請選擇 .db workspace 檔案。');
    const exists = path !== ':memory:' && existsSync(this.path);
    if (exists && options.exclusive) throw new StoreError('目標 workspace 已存在；重建只允許建立全新的 .db，原檔未變更。', 409);
    if (!exists && !options.create && path !== ':memory:') throw new StoreError('Workspace 不存在；建立新 workspace 時請勾選建立。', 404);
    // Inspect existing databases read-only before issuing ANY pragma or schema mutation.
    let existingVersion = SCHEMA_VERSION;
    if (exists) {
      let probe: DatabaseSync | undefined;
      try {
        probe = new DatabaseSync(this.path, { readOnly: true });
        probe.exec('BEGIN');
        existingVersion = inspectDatabase(probe);
      } catch (error) {
        if (error instanceof StoreError) throw error;
        throw new StoreError('無法辨識或讀取這個 GraspPortable workspace，原檔未變更。');
      } finally { probe?.close(); }
    } else if (path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true });
      closeSync(openSync(this.path, 'wx'));
    }
    this.db = new DatabaseSync(this.path, { timeout: 1_500 });
    try {
      if (exists && (existingVersion < SCHEMA_VERSION || !hasDraftSourceEdits(this.db))) this.migrationBackupPath = this.upgradeLegacy(existingVersion);
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      if (!exists) this.initialize(options.name ?? '我的 Workspace', options.seed ?? false);
    } catch (error) { this.db.close(); throw error; }
  }

  static rebuild(path: string, input: unknown, blobs: { sha256: string; bytes: Uint8Array }[], name?: string): WorkspaceStore {
    if (path === ':memory:') throw new StoreError('重建需要全新的 .db 檔案路徑。');
    const source = validateSnapshot(input);
    if (name !== undefined && !requireString(name, 'Workspace 名稱').trim()) throw new StoreError('Workspace 名稱不得為空。');
    const supplied = new Map<string, Uint8Array>();
    for (const blob of blobs) {
      if (!(blob.bytes instanceof Uint8Array) || blob.bytes.byteLength > MAX_ATTACHMENT_BYTES || createHash('sha256').update(blob.bytes).digest('hex') !== blob.sha256) throw new StoreError('重建附件的 SHA256 或大小不符；尚未建立資料庫。');
      if (supplied.has(blob.sha256)) throw new StoreError('重建附件 blob 重複。');
      supplied.set(blob.sha256, blob.bytes);
    }
    for (const a of source.attachments) if (supplied.get(a.sha256)?.byteLength !== a.size) throw new StoreError('重建缺少完整附件 bytes；尚未建立資料庫。');
    // Exclusive creation happens only after complete data/hash validation. A fresh
    // workspace ID separates stale browser tabs from the source database identity.
    const store = new WorkspaceStore(path, { create: true, exclusive: true, name: name ?? source.name });
    try {
      store.transaction(() => {
        store.db.exec('DELETE FROM notes; DELETE FROM records; DELETE FROM folders;');
        for (const [sha256, bytes] of supplied) store.db.prepare('INSERT INTO attachment_blobs (sha256, bytes) VALUES (?, ?)').run(sha256, bytes);
        for (const f of source.folders) store.writeFolder(f);
        for (const n of source.notes) store.writeNote(n, n.updatedAt);
        for (const r of source.records) store.writeRecord(r);
        for (const a of source.attachments) store.writeAttachment(a);
        store.db.prepare('UPDATE workspace SET name=?, revision=?, settings_json=?').run(name?.trim() ?? source.name, source.revision, JSON.stringify(source.settings));
      });
      return store;
    } catch (error) { store.close(); throw error; }
  }

  private upgradeLegacy(version: number): string {
    const backupPath = `${this.path}.schema${version}-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.db`;
    // VACUUM INTO produces a consistent independent database, including history.
    // Reserve the destination exclusively, validate it, then compare under a write
    // lock before changing schema so a concurrent v1 edit cannot escape the backup.
    closeSync(openSync(backupPath, 'wx'));
    this.db.exec('PRAGMA synchronous=FULL');
    this.db.prepare('VACUUM INTO ?').run(backupPath);
    let backup: DatabaseSync | undefined;
    let fingerprint: string;
    try {
      backup = new DatabaseSync(backupPath, { readOnly: true });
      if (inspectDatabase(backup) !== version) throw new StoreError('升級備份的 schema 不符，已停止升級。');
      fingerprint = migrationFingerprint(backup, version);
    } finally { backup?.close(); }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (inspectDatabase(this.db) !== version || migrationFingerprint(this.db, version) !== fingerprint) throw new StoreError('備份後 workspace 已變更，請關閉其他 GraspPortable 程序再重新開啟；尚未升級。', 409);
      if (version === 1) this.db.exec(`${FOLDER_SCHEMA}
        ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES folders(id);
        CREATE INDEX notes_folder ON notes(folder_id);`);
      if (version < 3) this.db.exec(ATTACHMENT_SCHEMA);
      if (version < 4) {
        this.db.exec(`ALTER TABLE notes ADD COLUMN syntax_version TEXT NOT NULL DEFAULT 'legacy-v0.2'; ${SHARED_SCHEMA}`);
        this.initializeSemanticState();
      }
      // Early M2 schema4 synthetic workspaces already have durable drafts. Keep
      // their bytes and receipts in a verified backup before adding lineage.
      if (version === 4 && !hasDraftSourceEdits(this.db)) this.db.exec('ALTER TABLE drafts ADD COLUMN source_edits_json TEXT');
      this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION};`);
      inspectDatabase(this.db);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return backupPath;
  }

  private initialize(name: string, seed: boolean): void {
    requireString(name, 'Workspace 名稱');
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL, settings_json TEXT NOT NULL);
      ${FOLDER_SCHEMA}
      ${ATTACHMENT_SCHEMA}
      CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, folder_id TEXT REFERENCES folders(id), syntax_version TEXT NOT NULL DEFAULT 'legacy-v0.2');
      CREATE INDEX notes_folder ON notes(folder_id);
      CREATE TABLE records (id TEXT PRIMARY KEY, collection TEXT NOT NULL, name TEXT NOT NULL, fields_json TEXT NOT NULL, revision INTEGER NOT NULL, UNIQUE(collection, name));
      CREATE INDEX records_collection ON records(collection);
      CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, reason TEXT NOT NULL, workspace_revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL);
      ${SHARED_SCHEMA}
      PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};`);
    try {
      this.db.prepare('INSERT INTO workspace VALUES (?, ?, 1, ?)').run(randomUUID(), name.trim() || '我的 Workspace', '{}');
      const notes = seed ? welcomeNotes() : [{ id: randomUUID(), title: '第一份筆記', markdown: '# 第一份筆記\n\n從這裡開始寫。\n' }];
      for (const n of notes) this.db.prepare('INSERT INTO notes (id, title, markdown, revision, updated_at, folder_id, syntax_version) VALUES (?, ?, ?, 1, ?, NULL, ?)').run(n.id, n.title, n.markdown, new Date().toISOString(), seed ? 'legacy-v0.2' : 'grasp-v1');
      if (seed) {
        this.writeRecord({ id: 'record-flame', collection: 'aura', name: 'flame', fields: { label: '炎羽', element: 'fire', description: '{first_name} 收藏的火屬性 Aura' }, revision: 1 });
        this.writeRecord({ id: 'record-tide', collection: 'aura', name: 'tide', fields: { label: '潮音', element: 'water', description: '安靜的水屬性 Aura' }, revision: 1 });
      }
      this.initializeSemanticState();
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  snapshot(): WorkspaceSnapshot {
    const ownsReadTransaction = !this.db.isTransaction;
    if (ownsReadTransaction) this.db.exec('BEGIN');
    try {
      const snapshot = readSnapshot(this.db);
      if (ownsReadTransaction) this.db.exec('COMMIT');
      return snapshot;
    } catch (error) { if (ownsReadTransaction) this.db.exec('ROLLBACK'); throw error; }
  }

  semanticState(): SharedSemanticState {
    const row = this.db.prepare('SELECT state_json FROM semantic_state WHERE singleton=1').get();
    if (!row) throw new StoreError('Workspace semantic state 尚未建立。', 500);
    return JSON.parse(String(row.state_json)) as SharedSemanticState;
  }
  sharedState(): SharedStateResponse {
    const owns = !this.db.isTransaction;
    if (owns) this.db.exec('BEGIN');
    try {
      const snapshot = this.snapshot(); const semantic = this.semanticState();
      const response = { snapshot, semantic, noteSources: snapshot.notes.map(n => ({ noteId: n.id, revision: n.revision, sourceHash: sourceHash(n.markdown) })) };
      if (owns) this.db.exec('COMMIT');
      return response;
    } catch (error) { if (owns) this.db.exec('ROLLBACK'); throw error; }
  }
  private writeSemanticState(state: SharedSemanticState): void {
    this.db.prepare('INSERT INTO semantic_state (singleton, revision, state_json) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, state_json=excluded.state_json').run(state.revision, JSON.stringify(state));
  }
  private initializeSemanticState(): void {
    const snapshot = readSnapshot(this.db);
    const prepared = prepareSharedWorkspace({ ...snapshot, revision: 1 }, { hash: sourceHash, newId: () => randomUUID() });
    // Legacy documents may already contain unfinished text. The adapter preserves
    // their exact source and diagnostics; migration is never an implicit rewrite.
    if (prepared.notes.some((n, i) => n.markdown !== snapshot.notes[i]?.markdown)) throw new StoreError('升級不得改寫既有筆記原文；已停止並保留備份。');
    this.writeSemanticState(prepared.state);
    this.graph = prepared.graph; this.graphRevision = prepared.state.revision;
  }
  private reconcile(before: WorkspaceSnapshot, previous: SharedSemanticState, hints?: SemanticIdentityHints): { graph: ValueGraph; revision: number; patches: SemanticSourcePatch[] } {
    const after = this.snapshot();
    const priorRevision = this.semanticState().revision;
    let prepared: ReturnType<typeof prepareSharedWorkspace>;
    try {
      prepared = prepareSharedWorkspace({ ...after, revision: priorRevision + 1 }, {
        previous, previousSnapshot: before, identityHints: hints, hash: sourceHash, newId: () => randomUUID(),
        graph: this.graphRevision === priorRevision ? this.graph : undefined,
      });
    } catch (error) {
      if (!hints?.sourceEdits) throw error;
      throw new StoreError(`Draft source edit lineage 無法驗證；原稿保留：${error instanceof Error ? error.message : '來源不符。'}`, 422);
    }
    if (!prepared.canCommit) throw new StoreError(`共享內容尚未完整，請保留為 draft：${prepared.diagnostics.map(d => d.message).join('；')}`, 422);
    const oldNotes = new Map(after.notes.map(n => [n.id, n]));
    const now = new Date().toISOString();
    for (const note of prepared.notes) {
      validateNote(note);
      const old = oldNotes.get(note.id);
      if (!old) throw new StoreError('Semantic preparation 不得新增未授權筆記。', 500);
      if (note.markdown !== old.markdown || note.revision !== old.revision || note.syntaxVersion !== old.syntaxVersion) this.writeNote(note, now);
    }
    this.writeSemanticState(prepared.state);
    return { graph: prepared.graph, revision: prepared.state.revision, patches: prepared.patches };
  }
  private transaction(action: () => void, options: { previous?: () => SharedSemanticState | undefined; hints?: () => SemanticIdentityHints | undefined; operation?: { command: SharedCommand; payloadHash: string }; draft?: () => DurableDraft | undefined; after?: () => void } = {}): WorkspaceSnapshot {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const before = this.snapshot(); const previous = this.semanticState();
      action();
      this.db.exec('UPDATE workspace SET revision=revision+1');
      const candidate = this.snapshot();
      const contentChanged = JSON.stringify([before.notes, before.records]) !== JSON.stringify([candidate.notes, candidate.records]);
      const prepared = contentChanged || options.operation ? this.reconcile(before, options.previous?.() ?? previous, options.hints?.()) : undefined;
      const committed = this.snapshot();
      if (contentChanged || options.operation) {
        const command = options.operation?.command;
        const operationId = command?.operationId ?? randomUUID();
        const oldNotes = new Map(before.notes.map(n => [n.id, n]));
        const oldRecords = new Map(before.records.map(r => [r.id, r]));
        const changedNotes = committed.notes.filter(n => JSON.stringify(oldNotes.get(n.id)) !== JSON.stringify(n));
        const changedRecordIds = [...new Set([...before.records.map(r => r.id), ...committed.records.map(r => r.id)])].filter(id => JSON.stringify(oldRecords.get(id)) !== JSON.stringify(committed.records.find(r => r.id === id)));
        const changedNoteIds = [...new Set([...changedNotes.map(n => n.id), ...before.notes.filter(n => !committed.notes.some(c => c.id === n.id)).map(n => n.id)])];
        const submittedDraft = options.draft?.();
        let draftAcknowledgement: DraftAcknowledgement | undefined;
        if (submittedDraft) {
          const edits = (prepared?.patches ?? []).filter(p => p.noteId === submittedDraft.noteId).map(p => ({ from: p.from, to: p.to, insert: p.after })).sort((a, b) => a.from - b.from);
          let cursor = 0; const parts: string[] = [];
          for (const edit of edits) {
            if (edit.from < cursor || edit.to < edit.from || edit.to > submittedDraft.markdown.length) throw new StoreError('Draft acknowledgement cache patches 不一致；沒有提交。', 500);
            parts.push(submittedDraft.markdown.slice(cursor, edit.from), edit.insert); cursor = edit.to;
          }
          parts.push(submittedDraft.markdown.slice(cursor));
          if (parts.join('') !== committed.notes.find(n => n.id === submittedDraft.noteId)?.markdown) throw new StoreError('Draft acknowledgement 與已準備原文不符；沒有提交。', 500);
          draftAcknowledgement = { draftId: submittedDraft.id, draftRevision: submittedDraft.revision, noteId: submittedDraft.noteId, submittedSourceHash: sourceHash(submittedDraft.markdown), edits };
        }
        const receipt: OperationReceipt = { operationId, payloadHash: options.operation?.payloadHash ?? sourceHash(canonicalPayload({ changedNoteIds, changedRecordIds, revision: committed.revision })),
          workspaceId: committed.id, workspaceRevision: committed.revision, semanticRevision: this.semanticState().revision, createdAt: new Date().toISOString(),
          kind: command?.intent.kind ?? 'content-update', changedNoteIds, changedRecordIds,
          sourcePatches: changedNotes.filter(n => oldNotes.has(n.id)).map(n => semanticSourcePatch(oldNotes.get(n.id)!, candidate.notes.find(c => c.id === n.id)!, n, prepared?.patches ?? [])), undoable: !!command && command.intent.kind !== 'commit-draft',
          ...(command?.intent.kind === 'undo' ? { undoneOperationId: command.intent.operationId } : {}), ...(draftAcknowledgement ? { draftAcknowledgement } : {}) };
        // Inverse contains only affected owners. The previous semantic identity map
        // is lineage for reparse, never a replacement for recomputing current values.
        const inverse = receipt.undoable ? { notes: before.notes.filter(n => changedNoteIds.includes(n.id)), records: before.records.filter(r => changedRecordIds.includes(r.id)), changedNoteIds, changedRecordIds, previousSemantic: previous } : null;
        this.db.prepare('INSERT INTO operations (id, payload_hash, receipt_json, inverse_json) VALUES (?, ?, ?, ?)').run(operationId, receipt.payloadHash, JSON.stringify(receipt), JSON.stringify(inverse));
      }
      options.after?.();
      this.db.exec('COMMIT');
      if (prepared) { this.graph = prepared.graph; this.graphRevision = prepared.revision; }
      return committed;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private expectWorkspace(revision: number): void {
    requireRevision(revision);
    if (Number(this.db.prepare('SELECT revision FROM workspace').get()?.revision) !== revision) throw new StoreError('Workspace 已變更，請重新預覽後再套用。', 409);
  }
  private nextRevision(): number { return Number(this.db.prepare('SELECT revision FROM workspace').get()!.revision) + 1; }
  private expectEntity(table: 'notes' | 'records' | 'folders' | 'attachments', id: string, revision: number, allowCreate = false): boolean {
    requireRevision(revision);
    const current = this.db.prepare(`SELECT revision FROM ${table} WHERE id=?`).get(id);
    if (!current) {
      if (allowCreate && revision === 0) return false;
      throw new StoreError('資料已不存在，請重新載入。', 409);
    }
    if (Number(current.revision) !== revision) throw new StoreError('這筆資料已有更新，請重新載入，避免覆蓋較新的內容。', 409);
    return true;
  }
  private recover(reason: string): void {
    const snapshot = this.snapshot();
    this.db.prepare('INSERT INTO history (created_at, reason, workspace_revision, snapshot_json) VALUES (?, ?, ?, ?)').run(new Date().toISOString(), reason, snapshot.revision, JSON.stringify({ ...snapshot, semanticState: this.semanticState() }));
  }
  private writeAttachment(a: Attachment): void {
    this.db.prepare('INSERT INTO attachments (id, name, path, path_key, mime_type, sha256, size, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(a.id, a.name, a.path, folderNameKey(a.path), a.mimeType, a.sha256, a.size, a.revision, a.createdAt);
  }
  createAttachment(name: unknown, mimeType: unknown, bytes: Uint8Array, path: unknown = name): WorkspaceSnapshot {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new StoreError('附件單檔最多 64 MiB。', 413);
    const attachment = validateAttachment({ id: randomUUID(), name, path, mimeType, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.byteLength, revision: 0, createdAt: new Date().toISOString() });
    return this.transaction(() => {
      const key = folderNameKey(attachment.path);
      if (this.db.prepare('SELECT path_key FROM attachments').all().some(row => { const old = String(row.path_key); return old === key || old.startsWith(`${key}/`) || key.startsWith(`${old}/`); })) throw new StoreError('此附件路徑已存在或與現有附件路徑衝突；請使用不同名稱，現有 bytes 不會被覆蓋。', 409);
      const existing = this.db.prepare('SELECT sha256 FROM attachment_blobs WHERE sha256=?').get(attachment.sha256);
      if (existing) this.readBlob(attachment.sha256);
      else this.db.prepare('INSERT INTO attachment_blobs (sha256, bytes) VALUES (?, ?)').run(attachment.sha256, bytes);
      this.writeAttachment({ ...attachment, revision: this.nextRevision() });
    });
  }
  readBlob(sha256: string): Uint8Array {
    const result = this.db.prepare('SELECT bytes FROM attachment_blobs WHERE sha256=?').get(sha256);
    if (!result || !(result.bytes instanceof Uint8Array)) throw new StoreError('找不到附件內容；請使用完整備份回復。', 404);
    if (createHash('sha256').update(result.bytes).digest('hex') !== sha256) throw new StoreError('附件雜湊不符；拒絕傳送或匯出損壞內容。');
    return result.bytes;
  }
  readAttachment(id: string): { attachment: Attachment; bytes: Uint8Array } {
    const row = this.db.prepare('SELECT id, name, path, mime_type AS mimeType, sha256, size, revision, created_at AS createdAt FROM attachments WHERE id=?').get(id);
    if (!row) throw new StoreError('找不到附件。', 404);
    const attachment = validateAttachment(row); const bytes = this.readBlob(attachment.sha256);
    if (bytes.byteLength !== attachment.size) throw new StoreError('附件大小不符，拒絕傳送。');
    return { attachment, bytes };
  }
  deleteAttachment(id: string, revision: number): WorkspaceSnapshot {
    return this.transaction(() => { this.expectEntity('attachments', id, revision); this.recover('刪除附件'); this.db.prepare('DELETE FROM attachments WHERE id=?').run(id); });
  }
  private expectFolder(id: string | null): void {
    if (id !== null && !this.db.prepare('SELECT id FROM folders WHERE id=?').get(id)) throw new StoreError('找不到目標資料夾。');
  }
  private writeNote(note: Pick<Note, 'id' | 'title' | 'markdown' | 'folderId' | 'revision'> & { syntaxVersion?: SourceSyntax }, updatedAt = new Date().toISOString()): void {
    this.db.prepare('INSERT INTO notes (id, title, markdown, revision, updated_at, folder_id, syntax_version) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, markdown=excluded.markdown, revision=excluded.revision, updated_at=excluded.updated_at, folder_id=excluded.folder_id, syntax_version=excluded.syntax_version').run(note.id, note.title, note.markdown, note.revision, updatedAt, note.folderId, note.syntaxVersion ?? 'legacy-v0.2');
  }
  drafts(clientId?: string): DurableDraft[] {
    if (clientId !== undefined) requireString(clientId, 'Client ID', 128);
    const sql = 'SELECT id, client_id AS clientId, note_id AS noteId, title, markdown, syntax_version AS syntaxVersion, base_note_revision AS baseNoteRevision, base_source_hash AS baseSourceHash, revision, updated_at AS updatedAt, source_edits_json FROM drafts';
    return (clientId === undefined ? this.db.prepare(sql + ' ORDER BY updated_at DESC').all() : this.db.prepare(sql + ' WHERE client_id=? ORDER BY updated_at DESC').all(clientId)).map(readDraft);
  }
  private draft(id: string): DurableDraft {
    const row = this.db.prepare('SELECT id, client_id AS clientId, note_id AS noteId, title, markdown, syntax_version AS syntaxVersion, base_note_revision AS baseNoteRevision, base_source_hash AS baseSourceHash, revision, updated_at AS updatedAt, source_edits_json FROM drafts WHERE id=?').get(id);
    if (!row) throw new StoreError('找不到 draft；尚未提交共享修改。', 404);
    return readDraft(row);
  }
  saveDraft(id: string, input: Record<string, unknown>): { draft: DurableDraft; diagnostics: { message: string }[]; canCommit: boolean } {
    requireString(id, 'Draft ID', 128); if (!id) throw new StoreError('Draft ID 不得為空。');
    const clientId = requireString(input.clientId, 'Client ID', 128); if (!clientId) throw new StoreError('Client ID 不得為空。');
    const noteId = requireString(input.noteId, 'Note ID', 128);
    const title = requireString(input.title, '標題', 500);
    const markdown = requireString(input.markdown, 'Markdown', MAX_MARKDOWN_CHARACTERS);
    const syntaxVersion = requireSyntax(input.syntaxVersion);
    const sourceEdits = validateSourceEdits(input.sourceEdits);
    const revision = requireRevision(input.revision); const baseNoteRevision = requireRevision(input.baseNoteRevision);
    this.db.exec('BEGIN IMMEDIATE');
    let saved: DurableDraft;
    try {
      const existing = this.db.prepare('SELECT id FROM drafts WHERE id=?').get(id) ? this.draft(id) : undefined;
      if ((existing?.revision ?? 0) !== revision) throw new StoreError('Draft 已有更新，請保留本地內容並重新載入。', 409);
      const note = this.snapshot().notes.find(n => n.id === noteId);
      let baseSourceHash: string;
      if (existing) {
        if (existing.clientId !== clientId || existing.noteId !== noteId || existing.baseNoteRevision !== baseNoteRevision || (input.baseSourceHash !== undefined && input.baseSourceHash !== existing.baseSourceHash)) throw new StoreError('Draft 身分或基底不可默默替換；請保留內容後重新比較。', 409);
        baseSourceHash = existing.baseSourceHash;
      } else {
        if (input.baseSourceHash !== undefined) {
          baseSourceHash = requireString(input.baseSourceHash, 'Draft base hash', 64);
          if (!/^[0-9a-f]{64}$/.test(baseSourceHash)) throw new StoreError('Draft baseSourceHash 必須是完整 SHA256。');
          if (note?.revision === baseNoteRevision && sourceHash(note.markdown) !== baseSourceHash) throw new StoreError('Draft source hash 與指定基底不符。', 409);
        } else {
          if (!note || note.revision !== baseNoteRevision) throw new StoreError('筆記已有更新，缺少原始 source hash，無法猜測 draft 基底。', 409);
          baseSourceHash = sourceHash(note.markdown);
        }
      }
      saved = { id, clientId, noteId, title, markdown, syntaxVersion, baseNoteRevision, baseSourceHash, revision: revision + 1, updatedAt: new Date().toISOString(), ...(sourceEdits === undefined ? {} : { sourceEdits }) };
      this.db.prepare('INSERT INTO drafts (id, client_id, note_id, title, markdown, syntax_version, base_note_revision, base_source_hash, revision, updated_at, source_edits_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, markdown=excluded.markdown, syntax_version=excluded.syntax_version, revision=excluded.revision, updated_at=excluded.updated_at, source_edits_json=excluded.source_edits_json').run(id, clientId, noteId, title, markdown, syntaxVersion, baseNoteRevision, baseSourceHash, saved.revision, saved.updatedAt, sourceEdits === undefined ? null : JSON.stringify(sourceEdits));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const diagnostics = syntaxVersion === 'grasp-v1' ? parseNoteLanguage(markdown, saved.revision).diagnostics.filter(d => d.area !== 'context')
      : buildKnowledge([{ id: noteId, title, markdown, syntaxVersion, revision: saved.revision, folderId: null, updatedAt: saved.updatedAt }], []).diagnostics.filter(d => d.kind === 'syntax' || d.kind === 'limit');
    if (!title.trim()) diagnostics.push({ message: '提交前請輸入筆記標題。' } as never);
    return { draft: saved, diagnostics, canCommit: diagnostics.length === 0 };
  }
  deleteDraft(id: string, revision: number): void {
    requireRevision(revision);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.draft(id).revision !== revision) throw new StoreError('Draft 已有更新，不能刪除較新的內容。', 409);
      this.db.prepare('DELETE FROM drafts WHERE id=?').run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  operation(id: string): OperationReceipt {
    const row = this.db.prepare('SELECT receipt_json FROM operations WHERE id=?').get(requireString(id, 'Operation ID', 128));
    if (!row) throw new StoreError('找不到已提交的 operation receipt。', 404);
    return JSON.parse(String(row.receipt_json)) as OperationReceipt;
  }
  commitShared(input: unknown): SharedCommitResponse {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoreError('Shared command 必須是物件。');
    const value = input as Record<string, unknown>;
    const operationId = requireString(value.operationId, 'Operation ID', 128); if (!operationId) throw new StoreError('Operation ID 不得為空。');
    const workspaceId = requireString(value.workspaceId, 'Workspace ID', 128);
    const baseSemanticRevision = requireRevision(value.baseSemanticRevision);
    if (!value.intent || typeof value.intent !== 'object' || Array.isArray(value.intent)) throw new StoreError('缺少明確的 shared intent。');
    const raw = value.intent as Record<string, unknown>;
    let intent: SharedCommand['intent'];
    switch (raw.kind) {
      case 'commit-draft': intent = { kind: raw.kind, draftId: requireString(raw.draftId, 'Draft ID', 128), draftRevision: requireRevision(raw.draftRevision) }; break;
      case 'set-literal': intent = { kind: raw.kind, bindingId: requireString(raw.bindingId, 'Binding ID', 128), bindingRevision: requireRevision(raw.bindingRevision), partIndex: requireRevision(raw.partIndex), value: requireString(raw.value, 'Literal value', MAX_MARKDOWN_CHARACTERS) }; break;
      case 'set-dependency': intent = { kind: raw.kind, bindingId: requireString(raw.bindingId, 'Binding ID', 128), bindingRevision: requireRevision(raw.bindingRevision), partIndex: requireRevision(raw.partIndex), targetIdentifierId: requireString(raw.targetIdentifierId, 'Target Identifier ID', 128) }; break;
      case 'rename': intent = { kind: raw.kind, identifierId: requireString(raw.identifierId, 'Identifier ID', 128), identifierRevision: requireRevision(raw.identifierRevision), name: requireString(raw.name, 'Identifier name', 500) }; break;
      case 'rename-namespace': intent = { kind: raw.kind, from: requireString(raw.from, 'Namespace', 500), to: requireString(raw.to, 'New namespace', 500) }; break;
      case 'undo': intent = { kind: raw.kind, operationId: requireString(raw.operationId, 'Original operation ID', 128) }; break;
      default: throw new StoreError('不支援此 shared intent。');
    }
    const command: SharedCommand = { operationId, workspaceId, baseSemanticRevision, intent };
    const payloadHash = sourceHash(canonicalPayload(command));
    const existing = this.db.prepare('SELECT payload_hash FROM operations WHERE id=?').get(operationId);
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new StoreError('Operation ID 已用於不同內容；拒絕重複修改。', 409);
      const receipt = this.operation(operationId); return { ...this.sharedState(), receipt, sourcePatches: receipt.sourcePatches, ...(receipt.draftAcknowledgement ? { draftAcknowledgement: receipt.draftAcknowledgement } : {}) };
    }
    let hints: SemanticIdentityHints | undefined; let previousOverride: SharedSemanticState | undefined; let submittedDraft: DurableDraft | undefined;
    let response: SharedCommitResponse | undefined;
    this.transaction(() => {
      const current = this.snapshot(); const state = this.semanticState();
      if (workspaceId !== current.id || baseSemanticRevision !== state.revision) throw new StoreError('共享資料版本已變更；draft 保留，請重新審查。', 409);
      if (this.db.prepare('SELECT id FROM operations WHERE id=?').get(operationId)) throw new StoreError('Operation 已由另一個請求提交；請查詢 receipt。', 409);
      if (intent.kind === 'commit-draft') {
        const draft = this.draft(intent.draftId);
        if (draft.revision !== intent.draftRevision) throw new StoreError('Draft 已有較新版本，請重新提交。', 409);
        const note = current.notes.find(n => n.id === draft.noteId);
        if (!note || note.revision !== draft.baseNoteRevision || sourceHash(note.markdown) !== draft.baseSourceHash) throw new StoreError('Draft 基底已有更新；原稿保留，請比較後再提交。', 409);
        submittedDraft = draft;
        const validated = validateNote({ ...note, ...draft, id: note.id });
        if (draft.sourceEdits !== undefined) hints = { sourceEdits: [{ noteId: note.id, baseRevision: draft.baseNoteRevision, baseHash: draft.baseSourceHash, steps: draft.sourceEdits }] };
        this.writeNote({ ...note, ...validated, revision: this.nextRevision() });
        this.db.prepare('DELETE FROM drafts WHERE id=? AND revision=?').run(draft.id, draft.revision);
        return;
      }
      if (intent.kind === 'undo') {
        const receipt = this.operation(intent.operationId);
        if (!receipt.undoable || receipt.semanticRevision !== state.revision) throw new StoreError('共享操作後已有其他語義修改，無法安全撤銷；請重新審查。', 409);
        const row = this.db.prepare('SELECT inverse_json FROM operations WHERE id=?').get(intent.operationId)!;
        const inverse = JSON.parse(String(row.inverse_json)) as { notes: Note[]; records: StructuredRecord[]; changedNoteIds: string[]; changedRecordIds: string[]; previousSemantic: SharedSemanticState };
        const restoredNoteIds = new Set(inverse.notes.map(note => note.id));
        for (const id of inverse.changedNoteIds) if (!restoredNoteIds.has(id)) this.db.prepare('DELETE FROM notes WHERE id=?').run(id);
        for (const n of inverse.notes) this.writeNote({ ...n, revision: this.nextRevision() });
        for (const id of inverse.changedRecordIds) this.db.prepare('DELETE FROM records WHERE id=?').run(id);
        for (const r of inverse.records) this.writeRecord({ ...r, revision: this.nextRevision() });
        previousOverride = inverse.previousSemantic;
        return;
      }
      let edit: Parameters<typeof applySharedIntent>[2];
      if (intent.kind === 'rename-namespace') {
        edit = { kind: 'rename', from: intent.from, to: intent.to, mode: 'namespace' };
      } else if (intent.kind === 'rename') {
        const identifier = state.identifiers.find(i => i.id === intent.identifierId);
        if (!identifier || identifier.revision !== intent.identifierRevision) throw new StoreError('Identifier 已變更，請重新載入。', 409);
        edit = { kind: 'rename', from: identifier.name, to: intent.name, mode: 'identifier' };
      } else {
        const binding = state.bindings.find(b => b.id === intent.bindingId);
        if (!binding || binding.revision !== intent.bindingRevision) throw new StoreError('Binding 已變更，請重新載入。', 409);
        if (intent.kind === 'set-literal') edit = { kind: 'set-literal', bindingId: binding.id, partIndex: intent.partIndex, value: intent.value, expectedSourceHash: binding.sourceHash };
        else {
          const target = state.identifiers.find(i => i.id === intent.targetIdentifierId);
          if (!target) throw new StoreError('找不到 dependency target，請重新載入。', 409);
          edit = { kind: 'set-dependency', bindingId: binding.id, partIndex: intent.partIndex, identifier: target.name, expectedSourceHash: binding.sourceHash };
        }
      }
      let proposed: ReturnType<typeof applySharedIntent>;
      try { proposed = applySharedIntent(current, state, edit, { hash: sourceHash }); }
      catch (error) { throw new StoreError(error instanceof Error ? error.message : '共享修改無法套用。', 422); }
      hints = proposed.identityHints;
      const oldNotes = new Map(current.notes.map(n => [n.id, n]));
      for (const n of proposed.snapshot.notes) if (JSON.stringify(n) !== JSON.stringify(oldNotes.get(n.id))) { validateNote(n); this.writeNote({ ...n, revision: this.nextRevision() }); }
      // Rename may swap collection/name keys; validate the complete proposed set
      // before releasing the old rows within this transaction.
      if (JSON.stringify(current.records) !== JSON.stringify(proposed.snapshot.records)) {
        const records = proposed.snapshot.records.map(validateRecord);
        this.db.exec('DELETE FROM records');
        for (const r of records) this.writeRecord({ ...r, revision: JSON.stringify(current.records.find(old => old.id === r.id)) === JSON.stringify(r) ? r.revision : this.nextRevision() });
      }
    }, { operation: { command, payloadHash }, hints: () => hints, previous: () => previousOverride, draft: () => submittedDraft, after: () => {
      const receipt = this.operation(operationId);
      response = { ...this.sharedState(), receipt, sourcePatches: receipt.sourcePatches, ...(receipt.draftAcknowledgement ? { draftAcknowledgement: receipt.draftAcknowledgement } : {}) };
    } });
    return response!;
  }
  private writeFolder(folder: Folder): void {
    this.db.prepare('INSERT INTO folders (id, parent_id, name, name_key, revision) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id, name=excluded.name, name_key=excluded.name_key, revision=excluded.revision').run(folder.id, folder.parentId, folder.name, folderNameKey(folder.name), folder.revision);
  }
  createFolder(name: unknown, parentId: unknown): WorkspaceSnapshot {
    const folder = validateFolder({ id: randomUUID(), name, parentId });
    return this.transaction(() => {
      const current = this.snapshot();
      validateHierarchy([...current.folders, folder], current.notes);
      this.writeFolder({ ...folder, revision: this.nextRevision() });
    });
  }
  updateFolder(id: string, name: unknown, parentId: unknown, revision: number): WorkspaceSnapshot {
    const folder = validateFolder({ id, name, parentId, revision });
    return this.transaction(() => {
      this.expectEntity('folders', id, revision);
      const current = this.snapshot();
      validateHierarchy(current.folders.map(f => f.id === id ? folder : f), current.notes);
      this.writeFolder({ ...folder, revision: this.nextRevision() });
    });
  }
  deleteFolder(id: string, revision: number, workspaceRevision: number, recursive = false): WorkspaceSnapshot {
    return this.transaction(() => {
      this.expectWorkspace(workspaceRevision);
      this.expectEntity('folders', id, revision);
      const current = this.snapshot();
      const children = new Map<string, string[]>();
      for (const f of current.folders) if (f.parentId !== null) { const list = children.get(f.parentId) ?? []; list.push(f.id); children.set(f.parentId, list); }
      const removed = new Set<string>([id]);
      for (const parent of removed) for (const child of children.get(parent) ?? []) removed.add(child);
      const notes = current.notes.filter(n => n.folderId !== null && removed.has(n.folderId));
      if (!recursive && (removed.size > 1 || notes.length)) throw new StoreError('資料夾不是空的；請先移出內容，或明確確認連同子資料夾與筆記刪除。', 409);
      this.recover('刪除資料夾');
      for (const n of notes) this.db.prepare('DELETE FROM notes WHERE id=?').run(n.id);
      for (const folderId of removed) this.db.prepare('DELETE FROM folders WHERE id=?').run(folderId);
    });
  }
  createNote(title: unknown, markdown: unknown, folderId: unknown = null, syntaxVersion?: unknown): WorkspaceSnapshot {
    const n = validateNote({ id: randomUUID(), title, markdown, folderId, syntaxVersion });
    return this.transaction(() => { this.expectFolder(n.folderId!); this.writeNote({ ...n, folderId: n.folderId!, revision: this.nextRevision() }); });
  }
  updateNote(id: string, title: unknown, markdown: unknown, revision: number, folderId?: unknown, syntaxVersion?: unknown): WorkspaceSnapshot {
    const n = validateNote({ id, title, markdown, folderId, syntaxVersion });
    return this.transaction(() => {
      this.expectEntity('notes', id, revision);
      const target = n.folderId === undefined ? this.db.prepare('SELECT folder_id FROM notes WHERE id=?').get(id)!.folder_id as string | null : n.folderId;
      this.expectFolder(target);
      const sourceSyntax = n.syntaxVersion ?? this.db.prepare('SELECT syntax_version FROM notes WHERE id=?').get(id)!.syntax_version as SourceSyntax;
      this.writeNote({ ...n, syntaxVersion: sourceSyntax, folderId: target, revision: revision + 1 });
    });
  }
  moveNote(id: string, folderId: unknown, revision: number): WorkspaceSnapshot {
    const target = requireFolderId(folderId);
    return this.transaction(() => {
      this.expectEntity('notes', id, revision); this.expectFolder(target);
      this.db.prepare('UPDATE notes SET folder_id=?, revision=revision+1, updated_at=? WHERE id=?').run(target, new Date().toISOString(), id);
    });
  }
  deleteNote(id: string, revision: number): WorkspaceSnapshot {
    return this.transaction(() => { this.expectEntity('notes', id, revision); this.recover('刪除筆記'); this.db.prepare('DELETE FROM notes WHERE id=?').run(id); });
  }
  private writeRecord(record: StructuredRecord): void {
    this.db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET collection=excluded.collection, name=excluded.name, fields_json=excluded.fields_json, revision=excluded.revision').run(record.id, record.collection, record.name, JSON.stringify(record.fields), record.revision);
  }
  updateRecord(record: unknown, revision: number): WorkspaceSnapshot {
    const r = validateRecord(record);
    return this.transaction(() => {
      this.expectEntity('records', r.id, revision, true);
      const duplicate = this.db.prepare('SELECT id FROM records WHERE collection=? AND name=? AND id<>?').get(r.collection, r.name, r.id);
      if (duplicate) throw new StoreError('同一 collection 不可有重複 name。');
      this.writeRecord({ ...r, revision: Math.max(revision + 1, this.nextRevision()) });
    });
  }
  deleteRecord(id: string, revision: number): WorkspaceSnapshot {
    return this.transaction(() => { this.expectEntity('records', id, revision); this.recover('刪除資料記錄'); this.db.prepare('DELETE FROM records WHERE id=?').run(id); });
  }
  updateSettings(input: unknown): WorkspaceSnapshot {
    const settings = validateSettings(input);
    return this.transaction(() => this.db.prepare('UPDATE workspace SET settings_json=?').run(JSON.stringify(settings)));
  }
  applyImport(payload: ImportPayload, workspaceRevision: number, recoveryReason = '匯入 Markdown', identityHints?: SemanticIdentityHints): WorkspaceSnapshot {
    requireString(recoveryReason, 'Recovery reason', 1500);
    const notes = payload.notes.map(validateNote);
    const folders = payload.folders?.map(validateFolder);
    const records = payload.records?.map(validateRecord);
    if (new Set(notes.map(n => n.id)).size !== notes.length) throw new StoreError('匯入有重複筆記 ID。');
    if (records && (new Set(records.map(r => r.id)).size !== records.length || new Set(records.map(r => `${r.collection}\0${r.name}`)).size !== records.length)) throw new StoreError('匯入有重複 record ID 或 name。');
    return this.transaction(() => {
      this.expectWorkspace(workspaceRevision);
      const current = this.snapshot();
      const existingNotes = new Map(current.notes.map(n => [n.id, n]));
      const existingFolders = new Map(current.folders.map(f => [f.id, f]));
      const combinedFolders = new Map(existingFolders);
      if (folders && new Set(folders.map(f => f.id)).size !== folders.length) throw new StoreError('匯入有重複資料夾 ID。');
      for (const f of folders ?? []) combinedFolders.set(f.id, f);
      const incomingNotes = notes.map(n => ({ ...n, syntaxVersion: n.syntaxVersion ?? existingNotes.get(n.id)?.syntaxVersion ?? 'legacy-v0.2', folderId: n.folderId === undefined ? existingNotes.get(n.id)?.folderId ?? null : n.folderId }));
      const combinedNotes = new Map(existingNotes);
      for (const n of incomingNotes) combinedNotes.set(n.id, { ...n, revision: 0, updatedAt: '' });
      validateHierarchy([...combinedFolders.values()], [...combinedNotes.values()]);
      const mutationRevision = this.nextRevision();
      this.recover(recoveryReason);
      const changedFolders = (folders ?? []).filter(f => { const old = existingFolders.get(f.id); return !old || old.name !== f.name || old.parentId !== f.parentId; });
      // Release old unique name keys first so a validated batch can swap siblings.
      for (const f of changedFolders) this.db.prepare('UPDATE folders SET name_key=? WHERE id=?').run(`\0import-${randomUUID()}`, f.id);
      for (const f of changedFolders) this.writeFolder({ ...f, revision: Math.max((existingFolders.get(f.id)?.revision ?? 0) + 1, mutationRevision) });
      for (const n of incomingNotes) {
        const old = existingNotes.get(n.id);
        if (old && old.title === n.title && old.markdown === n.markdown && old.folderId === n.folderId && old.syntaxVersion === n.syntaxVersion) continue;
        this.writeNote({ ...n, revision: Math.max((old?.revision ?? 0) + 1, mutationRevision) });
      }
      if (records) {
        const old = new Map(current.records.map(r => [r.id, r]));
        this.db.exec('DELETE FROM records');
        for (const r of records) {
          const prior = old.get(r.id);
          const unchanged = prior && prior.collection === r.collection && prior.name === r.name && canonicalPayload(prior.fields) === canonicalPayload(r.fields);
          this.writeRecord({ ...r, revision: unchanged ? prior.revision : Math.max((prior?.revision ?? 0) + 1, mutationRevision) });
        }
      }
    }, { hints: () => identityHints });
  }
  history(): RecoveryEntry[] {
    return this.db.prepare('SELECT id, created_at, reason, workspace_revision FROM history ORDER BY id DESC LIMIT 100').all().map((r: Row) => ({ id: Number(r.id), createdAt: String(r.created_at), reason: String(r.reason), workspaceRevision: Number(r.workspace_revision) }));
  }
  historyPreview(id: number): RecoveryPreview {
    this.db.exec('BEGIN');
    try {
      const entry = this.db.prepare('SELECT created_at, reason, snapshot_json FROM history WHERE id=?').get(id);
      if (!entry) throw new StoreError('找不到 recovery snapshot。', 404);
      const snapshot = validateSnapshot(JSON.parse(String(entry.snapshot_json)));
      const current = this.snapshot();
      if (snapshot.id !== current.id) throw new StoreError('Recovery snapshot 與目前 workspace 不符，未變更資料。');
      const notes: RecoveryPreview['changes']['notes'] = [];
      const folders: RecoveryPreview['changes']['folders'] = [];
      const records: RecoveryPreview['changes']['records'] = [];
      const attachments: RecoveryPreview['changes']['attachments'] = [];
      const targetNotes = new Map(snapshot.notes.map(n => [n.id, n]));
      const currentNotes = new Map(current.notes.map(n => [n.id, n]));
      for (const noteId of new Set([...currentNotes.keys(), ...targetNotes.keys()])) {
        const before = currentNotes.get(noteId); const after = targetNotes.get(noteId);
        if (before && after && before.title === after.title && before.markdown === after.markdown && before.folderId === after.folderId) continue;
        notes.push({ id: noteId, kind: !before ? 'create' : !after ? 'delete' : 'update', before: before ? { title: before.title, folderId: before.folderId } : null, after: after ? { title: after.title, folderId: after.folderId } : null, contentChanged: before?.markdown !== after?.markdown });
      }
      const targetFolders = new Map(snapshot.folders.map(f => [f.id, f]));
      const currentFolders = new Map(current.folders.map(f => [f.id, f]));
      for (const folderId of new Set([...currentFolders.keys(), ...targetFolders.keys()])) {
        const before = currentFolders.get(folderId); const after = targetFolders.get(folderId);
        if (before && after && before.name === after.name && before.parentId === after.parentId) continue;
        folders.push({ id: folderId, kind: !before ? 'create' : !after ? 'delete' : 'update', before: before ? { name: before.name, parentId: before.parentId } : null, after: after ? { name: after.name, parentId: after.parentId } : null });
      }
      const targetRecords = new Map(snapshot.records.map(r => [r.id, r]));
      const currentRecords = new Map(current.records.map(r => [r.id, r]));
      for (const recordId of new Set([...currentRecords.keys(), ...targetRecords.keys()])) {
        const before = currentRecords.get(recordId); const after = targetRecords.get(recordId);
        const changedFields = [...new Set([...Object.keys(before?.fields ?? {}), ...Object.keys(after?.fields ?? {})])].filter(key => before?.fields[key] !== after?.fields[key]);
        if (before && after && before.collection === after.collection && before.name === after.name && changedFields.length === 0) continue;
        records.push({ id: recordId, kind: !before ? 'create' : !after ? 'delete' : 'update', before: before ? { collection: before.collection, name: before.name, fieldCount: Object.keys(before.fields).length } : null, after: after ? { collection: after.collection, name: after.name, fieldCount: Object.keys(after.fields).length } : null, changedFields });
      }
      const targetAttachments = new Map(snapshot.attachments.map(a => [a.id, a]));
      const currentAttachments = new Map(current.attachments.map(a => [a.id, a]));
      for (const attachmentId of new Set([...currentAttachments.keys(), ...targetAttachments.keys()])) {
        const before = currentAttachments.get(attachmentId); const after = targetAttachments.get(attachmentId);
        if (before && after && before.name === after.name && before.path === after.path && before.sha256 === after.sha256 && before.mimeType === after.mimeType && before.size === after.size) continue;
        const summary = (a: Attachment) => ({ name: a.name, path: a.path, size: a.size, sha256: a.sha256 });
        attachments.push({ id: attachmentId, kind: !before ? 'create' : !after ? 'delete' : 'update', before: before ? summary(before) : null, after: after ? summary(after) : null });
      }
      const counts = (s: WorkspaceSnapshot) => ({ notes: s.notes.length, folders: s.folders.length, records: s.records.length, attachments: s.attachments.length });
      const result: RecoveryPreview = { id, createdAt: String(entry.created_at), reason: String(entry.reason), scope: 'workspace', workspaceRevision: current.revision, snapshotRevision: snapshot.revision, current: counts(current), target: counts(snapshot), changes: { notes, folders, records, attachments }, settingsChanged: JSON.stringify(current.settings) !== JSON.stringify(snapshot.settings), nameBefore: current.name, nameAfter: snapshot.name };
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  restore(id: number, workspaceRevision: number): WorkspaceSnapshot {
    let semanticBase: SharedSemanticState | undefined;
    return this.transaction(() => {
      this.expectWorkspace(workspaceRevision);
      const entry = this.db.prepare('SELECT snapshot_json FROM history WHERE id=?').get(id);
      if (!entry) throw new StoreError('找不到 recovery snapshot。', 404);
      const original = JSON.parse(String(entry.snapshot_json)) as WorkspaceSnapshot & { semanticState?: SharedSemanticState };
      const snapshot = validateSnapshot(original);
      // Pre-v4 history has no occurrence lineage. Do not guess which repeated
      // old occurrence corresponds to a current one during an explicit restore.
      semanticBase = original.semanticState ?? { ...this.semanticState(), occurrences: [] };
      const current = this.snapshot();
      if (snapshot.id !== current.id) throw new StoreError('Recovery snapshot 與目前 workspace 不符，未變更資料。');
      const noteRevisions = new Map(current.notes.map(n => [n.id, n.revision]));
      const folderRevisions = new Map(current.folders.map(f => [f.id, f.revision]));
      const recordRevisions = new Map(current.records.map(r => [r.id, r.revision]));
      const attachmentRevisions = new Map(current.attachments.map(a => [a.id, a.revision]));
      for (const a of snapshot.attachments) if (this.readBlob(a.sha256).byteLength !== a.size) throw new StoreError('Recovery 附件 bytes 不完整，沒有套用任何內容。');
      this.recover('回復前的 Workspace');
      this.db.exec('DELETE FROM notes; DELETE FROM records; DELETE FROM folders; DELETE FROM attachments;');
      for (const f of snapshot.folders) this.writeFolder({ ...f, revision: Math.max(f.revision, folderRevisions.get(f.id) ?? 0, current.revision) + 1 });
      for (const n of snapshot.notes) {
        const revision = Math.max(n.revision, noteRevisions.get(n.id) ?? 0, current.revision) + 1;
        this.writeNote({ ...n, revision });
      }
      for (const r of snapshot.records) this.writeRecord({ ...r, revision: Math.max(r.revision, recordRevisions.get(r.id) ?? 0, current.revision) + 1 });
      for (const a of snapshot.attachments) this.writeAttachment({ ...a, revision: Math.max(a.revision, attachmentRevisions.get(a.id) ?? 0, current.revision) + 1 });
      this.db.prepare('UPDATE workspace SET name=?, settings_json=?').run(snapshot.name, JSON.stringify(snapshot.settings));
    }, { previous: () => semanticBase });
  }
  close(): void { this.db.close(); }
}
