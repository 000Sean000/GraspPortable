import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/store.js';
import { ExchangeService, exportMarkdown, parseExchange } from '../server/exchange.js';
import { createV1Workspace } from './fixtures/v1-workspace.js';

const dirs: string[] = [];
const stores: WorkspaceStore[] = [];
function file(): string { const dir = mkdtempSync(join(tmpdir(), 'grasp-hierarchy-')); dirs.push(dir); return join(dir, 'workspace.db'); }
function open(path = ':memory:'): WorkspaceStore { const store = new WorkspaceStore(path, { create: true }); stores.push(store); return store; }
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* explicitly reopened */ } }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('schema 2 and durable note hierarchy', () => {
  it('backs up and validates a v1 workspace before upgrading; old history remains restorable', () => {
    const path = file(); const legacy = createV1Workspace(path); const s = open(path);
    expect(s.snapshot()).toEqual({ ...legacy, folders: [], notes: legacy.notes.map(n => ({ ...n, folderId: null })) });
    expect(s.migrationBackupPath).toBeTruthy(); expect(existsSync(s.migrationBackupPath!)).toBe(true);
    const backup = new DatabaseSync(s.migrationBackupPath!, { readOnly: true });
    try {
      expect(backup.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok');
      expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
      expect(backup.prepare('SELECT markdown FROM notes').get()?.markdown).toBe(legacy.notes[0]!.markdown);
      expect(JSON.parse(String(backup.prepare('SELECT snapshot_json FROM history').get()?.snapshot_json))).toEqual(legacy);
      expect(backup.prepare("SELECT name FROM sqlite_schema WHERE name='folders'").get()).toBeUndefined();
    } finally { backup.close(); }
    const withFolder = s.createFolder('研究', null); const folder = withFolder.folders[0]!;
    const moved = s.moveNote(legacy.notes[0]!.id, folder.id, legacy.notes[0]!.revision);
    const restored = s.restore(s.history()[0]!.id, moved.revision);
    expect(restored.folders).toEqual([]); expect(restored.notes[0]?.folderId).toBeNull();
    expect(restored.notes[0]?.markdown).toBe(legacy.notes[0]!.markdown);
    expect(restored.notes[0]!.revision).toBeGreaterThan(moved.notes[0]!.revision);
    s.close(); const reopened = open(path);
    expect(reopened.snapshot()).toEqual(restored); expect(reopened.migrationBackupPath).toBeUndefined();
  });

  it('leaves v1 bytes unchanged on failed migration and preserves a readable v1 backup', () => {
    const path = file(); createV1Workspace(path);
    const db = new DatabaseSync(path); db.exec('CREATE TABLE folders (unexpected TEXT)'); db.close();
    const bytes = readFileSync(path);
    expect(() => open(path)).toThrow(/already exists/);
    expect(readFileSync(path)).toEqual(bytes);
    const backups = readdirSync(dirs.at(-1)!).filter(n => n.includes('schema1-backup'));
    expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(join(dirs.at(-1)!, backups[0]!), { readOnly: true });
    try { expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1); expect(backup.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok'); } finally { backup.close(); }
  });

  it('keeps stable note IDs, source and records through nested moves, rename and restart', () => {
    const path = file(); const s = open(path); const note = s.snapshot().notes[0]!;
    const root = s.createFolder('研究', null).folders[0]!;
    const nested = s.createFolder('資料 😀', root.id).folders.find(f => f.parentId === root.id)!;
    const moved = s.moveNote(note.id, nested.id, note.revision);
    expect(moved.notes[0]?.id).toBe(note.id); expect(moved.notes[0]?.markdown).toBe(note.markdown);
    expect(moved.notes[0]?.folderId).toBe(nested.id);
    const renamed = s.updateFolder(root.id, '工作', null, root.revision);
    expect(renamed.notes).toEqual(moved.notes); expect(renamed.records).toEqual(moved.records);
    const edited = s.updateNote(note.id, '新標題', note.markdown, moved.notes[0]!.revision);
    expect(edited.notes[0]?.folderId).toBe(nested.id);
    const other = s.createNote('新標題', 'Duplicate note titles are legal', nested.id);
    expect(other.notes.filter(n => n.title === '新標題')).toHaveLength(2);
    s.close(); expect(open(path).snapshot()).toEqual(other);
  });

  it('rejects cycles, sibling collisions, invalid names, missing parents and stale entity changes atomically', () => {
    const s = open(); const a = s.createFolder('Alpha', null).folders[0]!;
    const b = s.createFolder('Beta', a.id).folders.find(f => f.parentId === a.id)!;
    const before = s.snapshot();
    for (const act of [
      () => s.createFolder('alpha', null), () => s.createFolder('x', 'absent'),
      () => s.createFolder('../invalid', null), () => s.createFolder('..', null),
      () => s.updateFolder(a.id, a.name, b.id, a.revision),
      () => s.updateFolder(a.id, a.name, a.id, a.revision),
      () => s.moveNote(before.notes[0]!.id, 'absent', before.notes[0]!.revision),
    ]) { expect(act).toThrow(); expect(s.snapshot()).toEqual(before); }
    s.createFolder('Café', null);
    expect(() => s.createFolder('Cafe\u0301', null)).toThrow(/重複/);
    const changed = s.updateFolder(b.id, 'Changed', a.id, b.revision);
    expect(() => s.updateFolder(b.id, 'stale', null, b.revision)).toThrow(/更新/);
    expect(s.snapshot()).toEqual(changed);
  });

  it('requires explicit subtree deletion with current workspace revision and recovers relationships without ABA', () => {
    const s = open(); const first = s.snapshot().notes[0]!;
    const a = s.createFolder('Root', null).folders[0]!;
    const b = s.createFolder('Child', a.id).folders.find(f => f.parentId === a.id)!;
    const before = s.moveNote(first.id, b.id, first.revision);
    expect(() => s.deleteFolder(a.id, a.revision, before.revision)).toThrow(/不是空/);
    s.createNote('Concurrent root note', 'survives'); const current = s.snapshot();
    expect(() => s.deleteFolder(a.id, a.revision, before.revision, true)).toThrow(/已變更/);
    expect(s.snapshot()).toEqual(current); expect(s.history()).toEqual([]);
    const deleted = s.deleteFolder(a.id, a.revision, current.revision, true);
    expect(deleted.folders).toEqual([]); expect(deleted.notes.map(n => n.title)).toEqual(['Concurrent root note']);
    const restored = s.restore(s.history()[0]!.id, deleted.revision);
    expect(restored.folders.map(f => ({ ...f, revision: 0 }))).toEqual(current.folders.map(f => ({ ...f, revision: 0 })));
    expect(restored.notes.find(n => n.id === first.id)?.folderId).toBe(b.id);
    expect(() => s.updateFolder(a.id, 'stale', null, a.revision)).toThrow(/更新/);
    expect(() => s.moveNote(first.id, null, before.notes[0]!.revision)).toThrow(/更新/);
  });

  it('reviews folder-only exchange changes and applies validated sibling swaps and note moves atomically', () => {
    const s = open(); const a = s.createFolder('Alpha', null).folders[0]!;
    const b = s.createFolder('Beta', null).folders.find(f => f.id !== a.id)!;
    const current = s.snapshot(); const service = new ExchangeService();
    const proposal = { ...current, folders: current.folders.map(f => ({ ...f, name: f.id === a.id ? 'Beta' : 'Alpha' })), notes: current.notes.map(n => ({ ...n, folderId: a.id })) };
    const text = exportMarkdown(proposal); const parsed = parseExchange(text, current);
    expect(parsed.folders).toEqual(proposal.folders);
    const plan = service.plan(text, current);
    expect(plan.canApply).toBe(true); expect(plan.changes[0]).toMatchObject({ kind: 'update', beforeFolderId: null, afterFolderId: a.id });
    expect(plan.folders).toEqual(proposal.folders); expect(s.snapshot()).toEqual(current);
    const applied = s.applyImport(service.take(plan.token, plan.workspaceRevision, current), current.revision);
    expect(applied.folders.find(f => f.id === a.id)?.name).toBe('Beta'); expect(applied.folders.find(f => f.id === b.id)?.name).toBe('Alpha');
    expect(applied.notes[0]?.folderId).toBe(a.id);
    const invalid = exportMarkdown({ ...applied, folders: applied.folders.map(f => ({ ...f, parentId: f.id === a.id ? b.id : a.id })) });
    expect(service.plan(invalid, applied).canApply).toBe(false); expect(s.snapshot()).toEqual(applied);
  });

  it('accepts historical exchange v1 without silently moving current notes to root', () => {
    const s = open(); const original = s.snapshot();
    const v1 = exportMarkdown(original).replace(/<!-- grasp-workspace (\{[^\n]*\}) -->/, (_all, json: string) => {
      const h = JSON.parse(json); delete h.folders; h.version = 1; return `<!-- grasp-workspace ${JSON.stringify(h)} -->`;
    }).replace(/<!-- grasp-note (\{[^\n]*\}) -->/g, (_all, json: string) => {
      const n = JSON.parse(json); delete n.folderId; return `<!-- grasp-note ${JSON.stringify(n)} -->`;
    });
    const folder = s.createFolder('After export', null).folders[0]!;
    const current = s.moveNote(original.notes[0]!.id, folder.id, original.notes[0]!.revision);
    const service = new ExchangeService(); const plan = service.plan(v1, current);
    expect(plan.canApply).toBe(true); expect(plan.changes[0]?.kind).toBe('unchanged');
    const imported = s.applyImport(service.take(plan.token, plan.workspaceRevision, current), current.revision);
    expect(imported.notes[0]?.folderId).toBe(folder.id); expect(imported.folders).toEqual(current.folders);
  });

  it('rolls back an entire hierarchy import after a later note write fails', () => {
    const path = file(); const s = open(path); const folder = s.createFolder('Before', null).folders[0]!;
    const before = s.snapshot();
    const injector = new DatabaseSync(path);
    try { injector.exec("CREATE TRIGGER hierarchy_reject BEFORE INSERT ON notes WHEN NEW.id='reject' BEGIN SELECT RAISE(ABORT, 'hierarchy rollback'); END"); } finally { injector.close(); }
    expect(() => s.applyImport({
      folders: [{ ...folder, name: 'Changed' }, { id: 'new-child', parentId: folder.id, name: 'Child', revision: 0 }],
      notes: [{ id: 'reject', title: 'Failure after folder writes', markdown: '', folderId: 'new-child' }],
    }, before.revision)).toThrow(/hierarchy rollback/);
    expect(s.snapshot()).toEqual(before); expect(s.history()).toEqual([]);
    s.close(); expect(open(path).snapshot()).toEqual(before);
  });

  it('rejects malformed hierarchy metadata and corrupt hierarchy recovery without partial changes', () => {
    const path = file(); const s = open(path); const a = s.createFolder('Parent', null).folders[0]!;
    const b = s.createFolder('Child', a.id).folders.find(f => f.parentId === a.id)!;
    const before = s.snapshot(); const text = exportMarkdown(before); const service = new ExchangeService();
    for (const malformed of [
      text.replace('"folderId":null,', ''),
      text.replace('"folderId":null', '"folderId":"missing"'),
      text.replace('"parentId":null', '"parentId":"missing"'),
      text.replace('"parentId":null', '"extra":"hidden data","parentId":null'),
    ]) { expect(service.plan(malformed, before).canApply).toBe(false); expect(s.snapshot()).toEqual(before); }
    const deleted = s.deleteFolder(a.id, a.revision, before.revision, true); const history = s.history();
    const corrupted = { ...before, folders: before.folders.map(f => ({ ...f, parentId: f.id === a.id ? b.id : a.id })) };
    const injector = new DatabaseSync(path);
    try { injector.prepare('UPDATE history SET snapshot_json=? WHERE id=?').run(JSON.stringify(corrupted), history[0]!.id); } finally { injector.close(); }
    expect(() => s.restore(history[0]!.id, deleted.revision)).toThrow(/循環/);
    expect(s.snapshot()).toEqual(deleted); expect(s.history()).toEqual(history);
  });
});
