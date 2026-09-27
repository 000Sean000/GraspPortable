import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import type { Folder, Note, StructuredRecord, WorkspaceSnapshot } from '../src/domain/model.js';

// All persisted objects crossing this boundary are Grasp-owned plain data.
const APPLICATION_ID = 0x47525031;
const SCHEMA_VERSION = 2;
const MAX_MARKDOWN = 10 * 1024 * 1024;
const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export class StoreError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export interface RecoveryEntry { id: number; createdAt: string; reason: string; workspaceRevision: number }
type RecoveryChange<T> = { id: string; kind: 'create' | 'update' | 'delete'; before: T | null; after: T | null };
export interface RecoveryPreview {
  id: number; createdAt: string; reason: string; scope: 'workspace'; workspaceRevision: number; snapshotRevision: number;
  current: { notes: number; folders: number; records: number }; target: { notes: number; folders: number; records: number };
  changes: {
    notes: (RecoveryChange<{ title: string; folderId: string | null }> & { contentChanged: boolean })[];
    folders: RecoveryChange<{ name: string; parentId: string | null }>[];
    records: (RecoveryChange<{ collection: string; name: string; fieldCount: number }> & { changedFields: string[] })[];
  };
  settingsChanged: boolean; nameBefore: string; nameAfter: string;
}
export type ImportNote = Pick<Note, 'id' | 'title' | 'markdown'> & { folderId?: string | null };
export interface ImportPayload { notes: ImportNote[]; records?: StructuredRecord[]; folders?: Folder[] }
type Row = Record<string, unknown>;

export function requireString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new StoreError(`${field} 必須是有效文字（最多 ${max} 字元）。`);
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
export function validateNote(input: { id: unknown; title: unknown; markdown: unknown; folderId?: unknown }): ImportNote {
  const id = requireString(input.id, '筆記 ID', 128);
  const title = requireString(input.title, '標題', 500).trim();
  if (!id || !title) throw new StoreError('筆記 ID 與標題不得為空。');
  return { id, title, markdown: requireString(input.markdown, 'Markdown', MAX_MARKDOWN), ...(input.folderId === undefined ? {} : { folderId: requireFolderId(input.folderId) }) };
}
function folderNameKey(name: string): string { return name.normalize('NFC').toLowerCase(); }
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
function validateSnapshot(input: unknown): WorkspaceSnapshot {
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
  const records = value.records.map(validateRecord);
  if ([...notes, ...folders, ...records].some(n => n.revision === 0 || n.revision > revision)) throw new StoreError('Workspace snapshot revision 不一致。');
  if (new Set(notes.map(n => n.id)).size !== notes.length || new Set(records.map(r => r.id)).size !== records.length || new Set(records.map(r => `${r.collection}\0${r.name}`)).size !== records.length) throw new StoreError('Workspace snapshot 有重複資料。');
  validateHierarchy(folders, notes);
  return { id, name, revision, notes, folders, records, settings: validateSettings(value.settings) };
}
function welcomeNotes(): Pick<Note, 'id' | 'title' | 'markdown'>[] {
  return [
    { id: 'welcome', title: '從這裡開始', markdown: '# 歡迎使用 GraspPortable\n\n這是一份可以直接編輯的筆記。點一下文字開始寫；游標離開後，同一編輯區會顯示 Markdown 與 identifier 的結果。\n\n## 一個小小的自我介紹\n\n@first_name = "Sean"\n@last_name = "Wu"\n@full_name = "{first_name} {last_name}"\n@greeting = "你好，{full_name}！"\n\n今天想說的話：{{greeting}}\n\n試著修改 `@first_name` 的字串。姓名與問候會一起更新，原始筆記仍保留 reference。\n\n- **自然寫作**：標題、粗體、斜體、清單、引用、連結都能直接寫。\n- **找來源**：點選顯示值可前往 definition；在右側 identifier 清單可以找 references。\n- **資料保存**：變更提交後會顯示「已儲存」。SQLite workspace 是唯一資料來源。\n- **與 AI 協作**：匯出 Markdown → 外部修改 → 匯入預覽 → 確認套用。\n\n> 完整語法與資料表範例在左側的「語法與資料表」。\n' },
    { id: 'guide', title: '語法與資料表', markdown: '# 語法與資料表\n\n## Identifier\n\n獨立一行的 `@name = "字串"` 建立全 workspace 共用值。字串使用 JSON 跳脫規則；`{name}` 在字串中組合其他值。正文的 `{{name}}` 顯示值。\n\n@project = "GraspPortable"\n@signature = "{full_name} · {project}"\n\n這份筆記來自 {{signature}}。\n\n名稱可以包含英文字母、數字、底線、點與連字號；第一個字元必須是英文字母或底線。程式碼區塊與行內程式碼不會解析 identifier。\n\n## 一份資料，多個 view\n\nRecords 集中存於資料庫。右側資料面板可以建立與修改，欄位也能引用 identifier。\n\n```grasp-query\n{"collection":"aura"}\n```\n\n只有火屬性的資料：\n\n```grasp-query\n{"collection":"aura","where":{"field":"element","equals":"fire"}}\n```\n\n炎羽的說明：{{aura.flame.description}}\n\n## 匯出與回復\n\n匯出的 Markdown 內含可讀筆記與 versioned metadata。請保留 metadata 與 note 邊界；修改內容後先看匯入差異，再確認。一般 Markdown 也能匯入為新筆記。\n\n匯入或刪除前會在資料庫內建立 recovery snapshot。回復也會先保存當前 workspace，避免覆蓋後無法再找回。\n' },
  ];
}

const FOLDER_SCHEMA = `CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id) DEFERRABLE INITIALLY DEFERRED, name TEXT NOT NULL, name_key TEXT NOT NULL, revision INTEGER NOT NULL);
  CREATE UNIQUE INDEX folders_siblings ON folders(COALESCE(parent_id, ''), name_key);`;
function readSnapshot(db: DatabaseSync, version = SCHEMA_VERSION): WorkspaceSnapshot {
  const w = db.prepare('SELECT id, name, revision, settings_json FROM workspace').get()!;
  const notes = db.prepare(`SELECT id, title, markdown, revision, updated_at AS updatedAt, ${version === 1 ? 'NULL' : 'folder_id'} AS folderId FROM notes ORDER BY rowid`).all() as unknown as Note[];
  const folders = version === 1 ? [] : db.prepare('SELECT id, parent_id AS parentId, name, revision FROM folders ORDER BY rowid').all() as unknown as Folder[];
  const records = db.prepare('SELECT id, collection, name, fields_json, revision FROM records ORDER BY collection, name').all().map(r => ({ id: String(r.id), collection: String(r.collection), name: String(r.name), fields: JSON.parse(String(r.fields_json)), revision: Number(r.revision) }));
  return { id: String(w.id), name: String(w.name), revision: Number(w.revision), settings: JSON.parse(String(w.settings_json)), notes, folders, records };
}
function inspectDatabase(db: DatabaseSync): number {
  const app = Number(db.prepare('PRAGMA application_id').get()?.application_id);
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (app !== APPLICATION_ID) throw new StoreError('這不是 GraspPortable workspace；原檔未變更。');
  if (version !== 1 && version !== SCHEMA_VERSION) throw new StoreError(`此 workspace schema 為 ${version}；本版支援 1–${SCHEMA_VERSION}，原檔未變更。`);
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new StoreError('Workspace 完整性檢查失敗，原檔未變更。');
  if (db.prepare('SELECT COUNT(*) AS count FROM workspace').get()!.count !== 1) throw new StoreError('Workspace metadata 不完整，原檔未變更。');
  validateSnapshot(readSnapshot(db, version));
  db.prepare('SELECT id, created_at, reason, workspace_revision, snapshot_json FROM history LIMIT 1').get();
  if (version === 2) {
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new StoreError('Workspace 資料夾關聯不完整，原檔未變更。');
    for (const f of db.prepare('SELECT name, name_key FROM folders').all()) if (f.name_key !== folderNameKey(String(f.name))) throw new StoreError('Workspace 資料夾名稱索引不一致，原檔未變更。');
  }
  return version;
}
function migrationFingerprint(db: DatabaseSync): string {
  const snapshot = readSnapshot(db, 1);
  snapshot.notes.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify([snapshot, db.prepare('SELECT * FROM history ORDER BY id').all()]);
}

export class WorkspaceStore {
  readonly path: string;
  readonly migrationBackupPath?: string;
  private db: DatabaseSync;
  get id(): string { return String(this.db.prepare('SELECT id FROM workspace').get()!.id); }

  constructor(path: string, options: { create?: boolean; name?: string; seed?: boolean } = {}) {
    requireString(options.name ?? '我的 Workspace', 'Workspace 名稱');
    this.path = path === ':memory:' ? path : resolve(path);
    if (path !== ':memory:' && extname(path).toLowerCase() !== '.db') throw new StoreError('請選擇 .db workspace 檔案。');
    const exists = path !== ':memory:' && existsSync(this.path);
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
      if (exists && existingVersion === 1) this.migrationBackupPath = this.upgradeV1();
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      if (!exists) this.initialize(options.name ?? '我的 Workspace', options.seed ?? false);
    } catch (error) { this.db.close(); throw error; }
  }

  private upgradeV1(): string {
    const backupPath = `${this.path}.schema1-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.db`;
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
      if (inspectDatabase(backup) !== 1) throw new StoreError('升級備份的 schema 不符，已停止升級。');
      fingerprint = migrationFingerprint(backup);
    } finally { backup?.close(); }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (inspectDatabase(this.db) !== 1 || migrationFingerprint(this.db) !== fingerprint) throw new StoreError('備份後 workspace 已變更，請關閉其他 GraspPortable 程序再重新開啟；尚未升級。', 409);
      this.db.exec(`${FOLDER_SCHEMA}
        ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES folders(id);
        CREATE INDEX notes_folder ON notes(folder_id);
        PRAGMA user_version=${SCHEMA_VERSION};`);
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
      CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, folder_id TEXT REFERENCES folders(id));
      CREATE INDEX notes_folder ON notes(folder_id);
      CREATE TABLE records (id TEXT PRIMARY KEY, collection TEXT NOT NULL, name TEXT NOT NULL, fields_json TEXT NOT NULL, revision INTEGER NOT NULL, UNIQUE(collection, name));
      CREATE INDEX records_collection ON records(collection);
      CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, reason TEXT NOT NULL, workspace_revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL);
      PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};`);
    try {
      this.db.prepare('INSERT INTO workspace VALUES (?, ?, 1, ?)').run(randomUUID(), name.trim() || '我的 Workspace', '{}');
      const notes = seed ? welcomeNotes() : [{ id: randomUUID(), title: '第一份筆記', markdown: '# 第一份筆記\n\n從這裡開始寫。\n' }];
      for (const n of notes) this.db.prepare('INSERT INTO notes (id, title, markdown, revision, updated_at, folder_id) VALUES (?, ?, ?, 1, ?, NULL)').run(n.id, n.title, n.markdown, new Date().toISOString());
      if (seed) {
        this.writeRecord({ id: 'record-flame', collection: 'aura', name: 'flame', fields: { label: '炎羽', element: 'fire', description: '{first_name} 收藏的火屬性 Aura' }, revision: 1 });
        this.writeRecord({ id: 'record-tide', collection: 'aura', name: 'tide', fields: { label: '潮音', element: 'water', description: '安靜的水屬性 Aura' }, revision: 1 });
      }
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

  private transaction(action: () => void): WorkspaceSnapshot {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      action();
      this.db.exec('UPDATE workspace SET revision=revision+1');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.snapshot();
  }
  private expectWorkspace(revision: number): void {
    requireRevision(revision);
    if (Number(this.db.prepare('SELECT revision FROM workspace').get()?.revision) !== revision) throw new StoreError('Workspace 已變更，請重新預覽後再套用。', 409);
  }
  private nextRevision(): number { return Number(this.db.prepare('SELECT revision FROM workspace').get()!.revision) + 1; }
  private expectEntity(table: 'notes' | 'records' | 'folders', id: string, revision: number, allowCreate = false): boolean {
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
    this.db.prepare('INSERT INTO history (created_at, reason, workspace_revision, snapshot_json) VALUES (?, ?, ?, ?)').run(new Date().toISOString(), reason, snapshot.revision, JSON.stringify(snapshot));
  }
  private expectFolder(id: string | null): void {
    if (id !== null && !this.db.prepare('SELECT id FROM folders WHERE id=?').get(id)) throw new StoreError('找不到目標資料夾。');
  }
  private writeNote(note: Pick<Note, 'id' | 'title' | 'markdown' | 'folderId' | 'revision'>): void {
    this.db.prepare('INSERT INTO notes (id, title, markdown, revision, updated_at, folder_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, markdown=excluded.markdown, revision=excluded.revision, updated_at=excluded.updated_at, folder_id=excluded.folder_id').run(note.id, note.title, note.markdown, note.revision, new Date().toISOString(), note.folderId);
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
  createNote(title: unknown, markdown: unknown, folderId: unknown = null): WorkspaceSnapshot {
    const n = validateNote({ id: randomUUID(), title, markdown, folderId });
    return this.transaction(() => { this.expectFolder(n.folderId!); this.writeNote({ ...n, folderId: n.folderId!, revision: this.nextRevision() }); });
  }
  updateNote(id: string, title: unknown, markdown: unknown, revision: number, folderId?: unknown): WorkspaceSnapshot {
    const n = validateNote({ id, title, markdown, folderId });
    return this.transaction(() => {
      this.expectEntity('notes', id, revision);
      const target = n.folderId === undefined ? this.db.prepare('SELECT folder_id FROM notes WHERE id=?').get(id)!.folder_id as string | null : n.folderId;
      this.expectFolder(target);
      this.writeNote({ ...n, folderId: target, revision: revision + 1 });
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
  applyImport(payload: ImportPayload, workspaceRevision: number, recoveryReason = '匯入 Markdown'): WorkspaceSnapshot {
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
      const incomingNotes = notes.map(n => ({ ...n, folderId: n.folderId === undefined ? existingNotes.get(n.id)?.folderId ?? null : n.folderId }));
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
        if (old && old.title === n.title && old.markdown === n.markdown && old.folderId === n.folderId) continue;
        this.writeNote({ ...n, revision: Math.max((old?.revision ?? 0) + 1, mutationRevision) });
      }
      if (records) {
        const old = new Map(current.records.map(r => [r.id, r]));
        this.db.exec('DELETE FROM records');
        for (const r of records) this.writeRecord({ ...r, revision: Math.max((old.get(r.id)?.revision ?? 0) + 1, mutationRevision) });
      }
    });
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
      const counts = (s: WorkspaceSnapshot) => ({ notes: s.notes.length, folders: s.folders.length, records: s.records.length });
      const result: RecoveryPreview = { id, createdAt: String(entry.created_at), reason: String(entry.reason), scope: 'workspace', workspaceRevision: current.revision, snapshotRevision: snapshot.revision, current: counts(current), target: counts(snapshot), changes: { notes, folders, records }, settingsChanged: JSON.stringify(current.settings) !== JSON.stringify(snapshot.settings), nameBefore: current.name, nameAfter: snapshot.name };
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  restore(id: number, workspaceRevision: number): WorkspaceSnapshot {
    return this.transaction(() => {
      this.expectWorkspace(workspaceRevision);
      const entry = this.db.prepare('SELECT snapshot_json FROM history WHERE id=?').get(id);
      if (!entry) throw new StoreError('找不到 recovery snapshot。', 404);
      const snapshot = validateSnapshot(JSON.parse(String(entry.snapshot_json)));
      const current = this.snapshot();
      if (snapshot.id !== current.id) throw new StoreError('Recovery snapshot 與目前 workspace 不符，未變更資料。');
      const noteRevisions = new Map(current.notes.map(n => [n.id, n.revision]));
      const folderRevisions = new Map(current.folders.map(f => [f.id, f.revision]));
      const recordRevisions = new Map(current.records.map(r => [r.id, r.revision]));
      this.recover('回復前的 Workspace');
      this.db.exec('DELETE FROM notes; DELETE FROM records; DELETE FROM folders;');
      for (const f of snapshot.folders) this.writeFolder({ ...f, revision: Math.max(f.revision, folderRevisions.get(f.id) ?? 0, current.revision) + 1 });
      for (const n of snapshot.notes) {
        const revision = Math.max(n.revision, noteRevisions.get(n.id) ?? 0, current.revision) + 1;
        this.writeNote({ ...n, revision });
      }
      for (const r of snapshot.records) this.writeRecord({ ...r, revision: Math.max(r.revision, recordRevisions.get(r.id) ?? 0, current.revision) + 1 });
      this.db.prepare('UPDATE workspace SET name=?, settings_json=?').run(snapshot.name, JSON.stringify(snapshot.settings));
    });
  }
  close(): void { this.db.close(); }
}
