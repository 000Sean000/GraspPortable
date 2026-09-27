import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceStore } from '../server/store.js';

const dirs: string[] = [];
const stores: WorkspaceStore[] = [];
function path(): string { const dir = mkdtempSync(join(tmpdir(), 'grasp-store-')); dirs.push(dir); return join(dir, 'test.db'); }
function open(file = ':memory:', seed = false): WorkspaceStore { const s = new WorkspaceStore(file, { create: true, seed }); stores.push(s); return s; }
afterEach(() => { for (const s of stores.splice(0)) { try { s.close(); } catch { /* already closed in reopen checks */ } } for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('authoritative SQLite workspace', () => {
  it('persists notes, records, settings and identities across a real close/reopen', () => {
    const file = path(); const s = open(file, true); const start = s.snapshot();
    const edited = s.updateNote(start.notes[0]!.id, '重新開啟', '@name = "存活"\n\n{{name}}', start.notes[0]!.revision);
    s.updateRecord({ id: 'record-one', collection: 'people', name: 'sean', fields: { label: '{name}' }, revision: 0 }, 0);
    const committed = s.updateSettings({ mode: 'live', activeNote: edited.notes[0]!.id });
    s.close(); const reopened = new WorkspaceStore(file); stores.push(reopened);
    expect(reopened.snapshot()).toEqual(committed);
    const probe = new DatabaseSync(file, { readOnly: true });
    try { expect(probe.prepare('PRAGMA user_version').get()?.user_version).toBe(3); } finally { probe.close(); }
  });

  it('rejects stale note and record mutations without partial writes or advancing authority', () => {
    const s = open(); const first = s.snapshot().notes[0]!;
    const committed = s.updateNote(first.id, 'First edit', 'one', first.revision);
    expect(() => s.updateNote(first.id, 'Lost edit', 'two', first.revision)).toThrow(/更新/);
    expect(s.snapshot()).toEqual(committed);
    const withRecord = s.updateRecord({ id: 'r', collection: 'c', name: 'n', fields: { f: 'x' }, revision: 0 }, 0);
    expect(() => s.updateRecord({ id: 'r', collection: 'c', name: 'n', fields: { f: 'lost' }, revision: 0 }, 0)).toThrow(/更新/);
    expect(s.snapshot()).toEqual(withRecord);
  });

  it('refuses foreign/corrupted/unsupported files without changing bytes', () => {
    const file = path(); const foreign = new DatabaseSync(file); foreign.exec('CREATE TABLE important (value TEXT); INSERT INTO important VALUES (\'do not touch\')'); foreign.close();
    const before = readFileSync(file);
    expect(() => new WorkspaceStore(file, { create: true })).toThrow(/不是 GraspPortable/);
    expect(readFileSync(file)).toEqual(before);
    const valid = path(); open(valid).close();
    const version = new DatabaseSync(valid); version.exec('PRAGMA user_version=500'); version.close();
    const original = readFileSync(valid);
    expect(() => new WorkspaceStore(valid)).toThrow(/schema/);
    expect(readFileSync(valid)).toEqual(original);
  });

  it('validates a whole import before writing and rolls back a failed transaction', () => {
    const file = path(); const s = open(file, true); const before = s.snapshot();
    expect(() => s.applyImport({ notes: [{ id: before.notes[0]!.id, title: 'Changed', markdown: 'should not write' }], records: [{ id: 'bad', collection: 'bad space', name: 'n', fields: {}, revision: 0 }] }, before.revision)).toThrow();
    expect(s.snapshot()).toEqual(before); expect(s.history()).toEqual([]);
    // A real SQLite write failure after recovery capture and the first note write must roll back both.
    const injector = new DatabaseSync(file);
    injector.exec("CREATE TRIGGER reject_test BEFORE INSERT ON notes WHEN NEW.id='reject' BEGIN SELECT RAISE(ABORT, 'test write failure'); END"); injector.close();
    expect(() => s.applyImport({ notes: [{ id: before.notes[0]!.id, title: 'Changed', markdown: 'also roll back' }, { id: 'reject', title: 'Rejected', markdown: '' }] }, before.revision)).toThrow(/test write failure/);
    expect(s.snapshot()).toEqual(before); expect(s.history()).toEqual([]);
  });

  it('recovers deleted data and imports atomically with fresh monotonic revisions', () => {
    const s = open(':memory:', true); const original = s.snapshot();
    const deleted = s.deleteNote(original.notes[0]!.id, original.notes[0]!.revision);
    expect(deleted.notes).toHaveLength(original.notes.length - 1);
    const history = s.history(); expect(history).toHaveLength(1);
    const restored = s.restore(history[0]!.id, deleted.revision);
    expect(restored.notes.map(n => n.markdown)).toEqual(original.notes.map(n => n.markdown));
    expect(restored.notes[0]!.revision).toBeGreaterThan(original.notes[0]!.revision);
    expect(() => s.updateNote(original.notes[0]!.id, 'stale', 'stale', original.notes[0]!.revision)).toThrow();
    const imported = s.applyImport({ notes: [{ ...original.notes[0]!, markdown: 'AI edited' }], records: [] }, restored.revision);
    expect(imported.records).toEqual([]); expect(imported.notes[0]!.markdown).toBe('AI edited');
    const recovered = s.restore(s.history()[0]!.id, imported.revision);
    expect(recovered.records.map(r => r.fields)).toEqual(original.records.map(r => r.fields));
    expect(recovered.notes[0]!.markdown).toBe(original.notes[0]!.markdown);
  });

  it('prevents stale revision reuse when deleted note and record IDs are reintroduced', () => {
    const s = open(':memory:', true); const original = s.snapshot(); const note = original.notes[0]!; const record = original.records[0]!;
    s.deleteNote(note.id, note.revision);
    const afterDeletion = s.deleteRecord(record.id, record.revision);
    const reintroduced = s.applyImport({ notes: [{ id: note.id, title: note.title, markdown: 'Recovered through Markdown' }], records: original.records }, afterDeletion.revision);
    expect(reintroduced.notes.find(n => n.id === note.id)!.revision).toBeGreaterThan(note.revision);
    expect(reintroduced.records.find(r => r.id === record.id)!.revision).toBeGreaterThan(record.revision);
    expect(() => s.updateNote(note.id, 'Old tab', 'Would overwrite recovered text', note.revision)).toThrow(/更新/);
    expect(() => s.updateRecord({ ...record, fields: { label: 'Old tab' } }, record.revision)).toThrow(/更新/);
    const current = reintroduced.records.find(r => r.id === record.id)!;
    s.deleteRecord(current.id, current.revision);
    const recreated = s.updateRecord({ ...record, revision: 0 }, 0);
    expect(recreated.records.find(r => r.id === record.id)!.revision).toBeGreaterThan(current.revision);
    expect(() => s.updateRecord({ ...current, fields: { label: 'Stale again' } }, current.revision)).toThrow(/更新/);
  });

  it('rejects malformed Grasp metadata before opening writable and malformed recovery before mutation', () => {
    const file = path(); const s = open(file, true); const original = s.snapshot();
    s.deleteNote(original.notes[0]!.id, original.notes[0]!.revision);
    const current = s.snapshot(); const recovery = s.history();
    const injector = new DatabaseSync(file);
    injector.prepare('UPDATE history SET snapshot_json=? WHERE id=?').run(JSON.stringify({ ...original, id: 'foreign-workspace' }), recovery[0]!.id);
    expect(() => s.restore(recovery[0]!.id, current.revision)).toThrow(/workspace 不符/);
    expect(s.snapshot()).toEqual(current); expect(s.history()).toEqual(recovery);
    injector.exec("UPDATE workspace SET settings_json='not-json'"); injector.close(); s.close();
    const bytes = readFileSync(file);
    expect(() => new WorkspaceStore(file)).toThrow(/無法辨識或讀取/);
    expect(readFileSync(file)).toEqual(bytes);
  });

  it('previews the complete recovery scope without source dumps or mutations and rejects stale restore', () => {
    const s = open(':memory:', true); const folder = s.createFolder('Saved folder', null).folders[0]!;
    const originalNote = s.snapshot().notes[0]!; const before = s.moveNote(originalNote.id, folder.id, originalNote.revision);
    const removed = s.deleteFolder(folder.id, folder.revision, before.revision, true);
    const history = s.history(); const preview = s.historyPreview(history[0]!.id);
    expect(preview).toMatchObject({ scope: 'workspace', workspaceRevision: removed.revision, snapshotRevision: before.revision, current: { notes: 1, folders: 0, records: 2 }, target: { notes: 2, folders: 1, records: 2 }, settingsChanged: false });
    expect(preview.changes.notes).toEqual([{ id: originalNote.id, kind: 'create', before: null, after: { title: originalNote.title, folderId: folder.id }, contentChanged: true }]);
    expect(preview.changes.folders).toEqual([{ id: folder.id, kind: 'create', before: null, after: { name: folder.name, parentId: null } }]);
    expect(preview.changes.records).toEqual([]); expect(JSON.stringify(preview)).not.toContain(originalNote.markdown);
    expect(s.snapshot()).toEqual(removed); expect(s.history()).toEqual(history);
    const changed = s.updateSettings({ mode: 'source' });
    expect(() => s.restore(preview.id, preview.workspaceRevision)).toThrow(/已變更/);
    expect(s.historyPreview(preview.id).settingsChanged).toBe(true); expect(s.snapshot()).toEqual(changed);
    expect(() => s.historyPreview(999999)).toThrow(/找不到/);
  });
});
