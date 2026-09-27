import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/store.js';
import { createV1Workspace } from './fixtures/v1-workspace.js';

const dirs: string[] = []; const stores: WorkspaceStore[] = [];
function file(name = 'workspace.db'): string { const dir = mkdtempSync(join(tmpdir(), 'grasp-assets-')); dirs.push(dir); return join(dir, name); }
function open(path = ':memory:'): WorkspaceStore { const s = new WorkspaceStore(path, { create: true, seed: true }); stores.push(s); return s; }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKVsAAAAASUVORK5CYII=', 'base64');
afterEach(() => { for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed for restart */ } } for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('DB-authoritative immutable attachments', () => {
  it('stores bytes only in SQLite, persists Unicode paths and deduplicates immutable blobs through restart', () => {
    const path = file(); const s = open(path);
    const first = s.createAttachment('圖.png', 'image/png', png, '知識/圖片/圖.png'); const asset = first.attachments[0]!;
    expect(asset.sha256).toBe(createHash('sha256').update(png).digest('hex')); expect(asset.size).toBe(png.length);
    expect(Object.hasOwn(asset, 'bytes')).toBe(false); expect(s.readAttachment(asset.id).bytes).toEqual(new Uint8Array(png));
    const saved = s.createAttachment('copy.png', 'image/png', png);
    const db = new DatabaseSync(path, { readOnly: true });
    try { expect(db.prepare('SELECT COUNT(*) AS count FROM attachment_blobs').get()?.count).toBe(1); } finally { db.close(); }
    s.close(); const reopened = open(path); expect(reopened.snapshot()).toEqual(saved); expect(reopened.readAttachment(asset.id).bytes).toEqual(new Uint8Array(png));
  });

  it('rejects traversal, reserved paths and file/directory collisions without overwriting any bytes', () => {
    const s = open(); const before = s.createAttachment('Photo.png', 'image/png', png, 'Pics/Photo.png');
    for (const path of ['../lost.png', '/absolute.png', 'C:/absolute.png', 'bad/CON.png', 'bad./x.png', 'x/../lost.png', 'Pics/photo.png', 'Pics/Photo.png/child.png']) {
      expect(() => s.createAttachment(path.split('/').at(-1)!, 'image/png', png, path)).toThrow(); expect(s.snapshot()).toEqual(before);
    }
    expect(() => s.createAttachment('Pics', 'application/octet-stream', Buffer.from('parent'))).toThrow(/衝突/);
    expect(s.snapshot()).toEqual(before);
  });

  it('keeps deleted bytes for recovery, advances restored revisions and rolls back failed metadata writes', () => {
    const path = file(); const s = open(path); const before = s.createAttachment('pixel.png', 'image/png', png); const asset = before.attachments[0]!;
    const deleted = s.deleteAttachment(asset.id, asset.revision);
    expect(deleted.attachments).toEqual([]); expect(s.readBlob(asset.sha256)).toEqual(new Uint8Array(png));
    const preview = s.historyPreview(s.history()[0]!.id); expect(preview.changes.attachments[0]?.kind).toBe('create');
    const restored = s.restore(preview.id, deleted.revision); expect(restored.attachments[0]!.revision).toBeGreaterThan(asset.revision);
    expect(() => s.deleteAttachment(asset.id, asset.revision)).toThrow(/更新/);
    const history = s.history(); const injector = new DatabaseSync(path);
    try { injector.exec("CREATE TRIGGER reject_asset BEFORE INSERT ON attachments WHEN NEW.name='reject.txt' BEGIN SELECT RAISE(ABORT, 'asset rollback'); END"); } finally { injector.close(); }
    const bytes = Buffer.from('never committed'); const hash = createHash('sha256').update(bytes).digest('hex');
    expect(() => s.createAttachment('reject.txt', 'text/plain', bytes)).toThrow(/asset rollback/);
    expect(s.snapshot()).toEqual(restored); expect(s.history()).toEqual(history); expect(() => s.readBlob(hash)).toThrow(/找不到/);
  });

  it('upgrades schema 2 with a validated independent backup and preserves existing folders and source', () => {
    const path = file(); const legacy = createV1Workspace(path); const db = new DatabaseSync(path);
    try { db.exec(`CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id) DEFERRABLE INITIALLY DEFERRED, name TEXT NOT NULL, name_key TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE UNIQUE INDEX folders_siblings ON folders(COALESCE(parent_id, ''), name_key);
      ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES folders(id); CREATE INDEX notes_folder ON notes(folder_id);
      INSERT INTO folders VALUES ('folder', NULL, '研究', '研究', 3); UPDATE notes SET folder_id='folder'; PRAGMA user_version=2;`); } finally { db.close(); }
    const s = open(path); const snapshot = s.snapshot();
    expect(snapshot.attachments).toEqual([]); expect(snapshot.notes[0]?.folderId).toBe('folder'); expect(snapshot.notes[0]?.markdown).toBe(legacy.notes[0]!.markdown);
    expect(s.migrationBackupPath).toContain('schema2-backup'); const backup = new DatabaseSync(s.migrationBackupPath!, { readOnly: true });
    try { expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(2); expect(backup.prepare('SELECT folder_id FROM notes').get()?.folder_id).toBe('folder'); } finally { backup.close(); }
  });

  it('rebuilds only a new DB with fresh workspace identity and rejects invalid hashes before creating a file', () => {
    const sourcePath = file(); const s = open(sourcePath); const before = s.createAttachment('pixel.png', 'image/png', png, 'images/pixel.png'); const originalBytes = readFileSync(sourcePath);
    const target = join(dirs.at(-1)!, 'rebuilt.db'); const blobs = before.attachments.map(a => ({ sha256: a.sha256, bytes: s.readBlob(a.sha256) }));
    const rebuilt = WorkspaceStore.rebuild(target, before, blobs); stores.push(rebuilt);
    expect(rebuilt.id).not.toBe(before.id); expect(rebuilt.snapshot().notes).toEqual(before.notes); expect(rebuilt.snapshot().attachments).toEqual(before.attachments);
    expect(rebuilt.readAttachment(before.attachments[0]!.id).bytes).toEqual(new Uint8Array(png)); expect(readFileSync(sourcePath)).toEqual(originalBytes);
    const targetBytes = readFileSync(target); expect(() => WorkspaceStore.rebuild(target, before, blobs)).toThrow(/已存在/); expect(readFileSync(target)).toEqual(targetBytes);
    const invalidTarget = join(dirs.at(-1)!, 'bad.db');
    expect(() => WorkspaceStore.rebuild(invalidTarget, before, [{ sha256: blobs[0]!.sha256, bytes: Buffer.from('corrupt') }])).toThrow(/SHA256/);
    expect(existsSync(invalidTarget)).toBe(false); expect(() => WorkspaceStore.rebuild(invalidTarget, before, [])).toThrow(/缺少/); expect(existsSync(invalidTarget)).toBe(false);
  });

  it('does not serve corrupted blob bytes or partially restore corrupt attachment recovery', () => {
    const path = file(); const s = open(path); const before = s.createAttachment('pixel.png', 'image/png', png); const asset = before.attachments[0]!;
    const deleted = s.deleteAttachment(asset.id, asset.revision); const history = s.history();
    const injector = new DatabaseSync(path);
    try { injector.prepare('UPDATE attachment_blobs SET bytes=? WHERE sha256=?').run(Buffer.alloc(png.length, 0), asset.sha256); } finally { injector.close(); }
    expect(() => s.readBlob(asset.sha256)).toThrow(/雜湊/); expect(() => s.restore(history[0]!.id, deleted.revision)).toThrow(/雜湊/);
    expect(s.snapshot()).toEqual(deleted); expect(s.history()).toEqual(history);
  });
});
