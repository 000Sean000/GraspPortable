import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/store.js';
import { RenameService } from '../server/rename.js';

const stores: WorkspaceStore[] = [];
const dirs: string[] = [];
function workspace(file = ':memory:') { const s = new WorkspaceStore(file, { create: true, seed: true }); stores.push(s); return s; }
afterEach(() => { vi.restoreAllMocks(); for (const s of stores.splice(0)) s.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('reviewed semantic rename service', () => {
  it('previews without mutation, atomically commits source and records with recovery, and preserves hierarchy', () => {
    const s = workspace(); const folder = s.createFolder('Values', null).folders[0]!;
    const currentNote = s.snapshot().notes[0]!; const before = s.moveNote(currentNote.id, folder.id, currentNote.revision);
    const service = new RenameService(); const plan = service.plan({ from: 'first_name', to: 'given_name', mode: 'identifier' }, before);
    expect(plan.canApply).toBe(true); expect(plan.token).toBeTruthy();
    expect(plan.renames).toContainEqual(expect.objectContaining({ from: 'first_name', to: 'given_name' }));
    expect(plan.changes.some(c => c.id === currentNote.id)).toBe(true); expect(plan.recordChanges.some(c => c.id === 'record-flame')).toBe(true);
    expect(Object.hasOwn(plan, 'notes')).toBe(false); expect(Object.hasOwn(plan, 'records')).toBe(false);
    expect(s.snapshot()).toEqual(before); expect(s.history()).toEqual([]);
    const reviewed = service.take(plan.token, plan.workspaceRevision, before);
    const after = s.applyImport(reviewed.payload, plan.workspaceRevision, reviewed.reason);
    expect(after.notes.find(n => n.id === currentNote.id)?.folderId).toBe(folder.id); expect(after.folders).toEqual(before.folders);
    expect(after.notes.find(n => n.id === currentNote.id)?.markdown).toContain('@given_name = "Sean"');
    expect(after.records.find(r => r.id === 'record-flame')?.fields.description).toContain('{given_name}');
    expect(s.history()[0]?.reason).toBe('重新命名 Identifier：first_name → given_name');
    expect(() => service.take(plan.token, after.revision, after)).toThrow(/失效/);
    const preview = s.historyPreview(s.history()[0]!.id);
    expect(preview.scope).toBe('workspace'); expect(preview.changes.notes.some(n => n.contentChanged)).toBe(true);
    expect(preview.changes.records.find(r => r.id === 'record-flame')?.changedFields).toContain('description');
    const restored = s.restore(preview.id, preview.workspaceRevision);
    expect(restored.notes.map(n => n.markdown)).toEqual(before.notes.map(n => n.markdown));
    expect(restored.records.map(r => r.fields)).toEqual(before.records.map(r => r.fields));
  });

  it('rejects collisions, malformed requests, stale revisions, foreign workspaces and expired plans', () => {
    const s = workspace(); const before = s.snapshot(); const service = new RenameService();
    const collision = service.plan({ from: 'first_name', to: 'last_name', mode: 'identifier' }, before);
    expect(collision.canApply).toBe(false); expect(collision.token).toBe('');
    expect(() => service.take(collision.token, before.revision, before)).toThrow(/失效/);
    expect(() => service.plan({ from: 'first_name', to: 'given', mode: 'raw-replace' }, before)).toThrow(/mode/);
    const plan = service.plan({ from: 'first_name', to: 'given_name', mode: 'identifier' }, before);
    expect(() => service.take(plan.token, before.revision, { ...before, id: 'foreign' })).toThrow(/已變更/);
    const changed = s.updateSettings({ mode: 'source' });
    expect(() => service.take(plan.token, before.revision, changed)).toThrow(/已變更/);
    const next = service.plan({ from: 'first_name', to: 'given_name', mode: 'identifier' }, changed);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000);
    expect(() => service.take(next.token, next.workspaceRevision, changed)).toThrow(/過期/);
    expect(s.snapshot()).toEqual(changed); expect(s.history()).toEqual([]);
  });

  it('commits a structured-record namespace move with stable IDs and leaves unrelated query source intact', () => {
    const s = workspace(); const before = s.snapshot(); const service = new RenameService();
    const plan = service.plan({ from: 'aura.flame', to: 'aura.phoenix', mode: 'namespace' }, before);
    expect(plan.canApply).toBe(true); expect(plan.renames.length).toBeGreaterThan(1);
    const reviewed = service.take(plan.token, plan.workspaceRevision, before);
    const after = s.applyImport(reviewed.payload, plan.workspaceRevision, reviewed.reason);
    expect(after.records.find(r => r.id === 'record-flame')?.name).toBe('phoenix');
    expect(after.notes.find(n => n.id === 'guide')?.markdown).toContain('{{aura.phoenix.description}}');
    expect(after.notes.find(n => n.id === 'guide')?.markdown).toContain('{"collection":"aura","where":{"field":"element","equals":"fire"}}');
    const recovery = s.historyPreview(s.history()[0]!.id);
    expect(recovery.changes.records.find(r => r.id === 'record-flame')).toMatchObject({ kind: 'update', before: { name: 'phoenix' }, after: { name: 'flame' }, changedFields: [] });
  });

  it('refuses tokens when projected values or record keys exceed persistence limits', () => {
    const s = workspace(); const service = new RenameService();
    const template = 'a'.repeat(100_000 - '{first_name}'.length) + '{first_name}';
    const before = s.updateRecord({ id: 'limit', collection: 'limits', name: 'one', fields: { value: template }, revision: 0 }, 0);
    const plan = service.plan({ from: 'first_name', to: 'expanded_first_name', mode: 'identifier' }, before);
    expect(plan.canApply).toBe(false); expect(plan.token).toBe('');
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', kind: 'storage-limit' }));
    expect(() => service.take(plan.token, plan.workspaceRevision, before)).toThrow(/失效/);
    const longField = service.plan({ from: 'aura.flame.description', to: `aura.flame.${'x'.repeat(101)}`, mode: 'identifier' }, before);
    expect(longField.canApply).toBe(false); expect(longField.token).toBe('');
    expect(s.snapshot()).toEqual(before); expect(s.history()).toEqual([]);
  });

  it('rolls back note rewrites, records and recovery together when a later record write fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grasp-rename-')); dirs.push(dir); const path = join(dir, 'workspace.db');
    const s = workspace(path); const before = s.snapshot(); const service = new RenameService();
    const plan = service.plan({ from: 'first_name', to: 'given_name', mode: 'identifier' }, before);
    const reviewed = service.take(plan.token, plan.workspaceRevision, before);
    const injector = new DatabaseSync(path);
    try { injector.exec("CREATE TRIGGER fail_rename BEFORE INSERT ON records WHEN NEW.id='record-flame' BEGIN SELECT RAISE(ABORT, 'rename rollback'); END"); } finally { injector.close(); }
    expect(() => s.applyImport(reviewed.payload, plan.workspaceRevision, reviewed.reason)).toThrow(/rename rollback/);
    expect(s.snapshot()).toEqual(before); expect(s.history()).toEqual([]);
    expect(() => service.take(plan.token, plan.workspaceRevision, before)).toThrow(/失效/);
  });
});
