import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { WorkspaceFiles, readMirrorManifest } from '../server/files.js';
import type { Attachment, WorkspaceSnapshot } from '../src/domain/model';

const base = resolve('.cache/files-tests'); mkdirSync(base, { recursive: true });
const dirs: string[] = [], services: WorkspaceFiles[] = [];
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from([1, 2, 3, 4, 5]);
const asset: Attachment = { id: 'asset', name: 'image.png', path: 'images/image.png', mimeType: 'image/png', size: bytes.length, sha256: hash(bytes), revision: 1, createdAt: '2026-01-01T00:00:00Z' };
function source(): WorkspaceSnapshot {
  return { id: 'workspace', name: 'Example', revision: 1, settings: { mode: 'live' },
    folders: [{ id: 'f', name: 'Folder', parentId: null, revision: 1 }],
    notes: [{ id: 'n', title: 'Note', markdown: '# 原文\r\n\n@name = "same"\n{{name}}', folderId: 'f', revision: 1, updatedAt: '2026-01-01T00:00:00Z' }],
    records: [{ id: 'r', collection: 'aura', name: 'fire', fields: { label: '{name}' }, revision: 1 }], attachments: [asset] };
}
function service(): WorkspaceFiles {
  const dir = mkdtempSync(join(base, 'case-')); dirs.push(dir); const files = new WorkspaceFiles(join(dir, 'example.db')); services.push(files); return files;
}
function manifest(files: WorkspaceFiles) { return JSON.parse(readFileSync(join(files.root, files.status().mirror.manifestPath!), 'utf8')); }
afterEach(async () => {
  for (const files of services.splice(0)) await files.close();
  for (const dir of dirs.splice(0)) { if (!resolve(dir).startsWith(base + sep)) throw new Error('Unsafe test cleanup.'); rmSync(dir, { recursive: true, force: true }); }
});

describe('immutable workspace file projection', () => {
  it('publishes readable entrypoints and reconstructs source IDs, hierarchy, records and attachment bytes', async () => {
    const files = service(), snapshot = source(); files.schedule(snapshot, () => bytes);
    const status = await files.flush(); expect(status.mirror.state).toBe('ready'); expect(status.mirror.writtenFiles).toBe(2);
    expect(readFileSync(join(files.root, 'README.md'), 'utf8')).toContain('exchange/inbox');
    expect(readFileSync(join(files.root, status.mirror.indexPath!), 'utf8')).toContain('Note');
    const rebuilt = await readMirrorManifest(join(files.root, status.mirror.manifestPath!));
    expect(rebuilt.snapshot).toEqual(snapshot); expect(Buffer.from(rebuilt.blobs[0].bytes)).toEqual(bytes);
  });

  it('writes only changed note content, reuses immutable asset/note revisions and coalesces pending snapshots', async () => {
    const files = service(), snapshot = source(); files.schedule(snapshot, () => bytes); await files.flush();
    const first = manifest(files), originalFile = first.payload.notes[0].file;
    files.schedule({ ...snapshot, revision: 2, name: 'metadata' }, () => bytes);
    files.schedule({ ...snapshot, revision: 3, notes: [{ ...snapshot.notes[0], markdown: 'updated', revision: 3 }] }, () => bytes);
    const status = await files.flush(); expect(status.mirror.revision).toBe(3); expect(status.mirror.writtenFiles).toBe(1); expect(status.mirror.reusedFiles).toBe(1);
    expect(readFileSync(join(files.root, originalFile), 'utf8')).toBe(snapshot.notes[0].markdown);
    expect(readdirSync(join(files.root, 'mirror/manifests'))).toHaveLength(2);
    expect((await readMirrorManifest(join(files.root, status.mirror.manifestPath!))).snapshot.notes[0].markdown).toBe('updated');
  });

  it('never overwrites externally edited projection bytes and marks the old path dirty', async () => {
    const files = service(), snapshot = source(); files.schedule(snapshot, () => bytes); await files.flush();
    const old = manifest(files), path = old.payload.notes[0].file, oldManifest = files.status().mirror.manifestPath!;
    writeFileSync(join(files.root, path), 'EXTERNAL AI EDIT');
    await expect(readMirrorManifest(join(files.root, oldManifest))).rejects.toThrow('hash mismatch');
    files.schedule(snapshot, () => bytes); const status = await files.flush();
    expect(status.mirror.dirtyPaths).toContain(path); expect(status.mirror.state).toBe('ready');
    expect(readFileSync(join(files.root, path), 'utf8')).toBe('EXTERNAL AI EDIT');
    expect(manifest(files).payload.notes[0].file).not.toBe(path);
    expect((await readMirrorManifest(join(files.root, status.mirror.manifestPath!))).snapshot.notes[0].markdown).toBe(snapshot.notes[0].markdown);
    expect(snapshot.notes[0].markdown).not.toContain('EXTERNAL');
  });

  it('preserves changed attachment projections and recreates their bytes only from the DB provider', async () => {
    const files = service(); files.schedule(source(), () => bytes); await files.flush();
    const oldPath = manifest(files).payload.attachments[0].file;
    writeFileSync(join(files.root, oldPath), Buffer.from('external attachment'));
    files.schedule(source(), () => bytes); const status = await files.flush();
    expect(status.mirror.dirtyPaths).toContain(oldPath);
    expect(readFileSync(join(files.root, oldPath), 'utf8')).toBe('external attachment');
    expect(readFileSync(join(files.root, manifest(files).payload.attachments[0].file))).toEqual(bytes);
  });

  it('keeps DB saves valid when projection fails, publishes no partial manifest and retries safely', async () => {
    const files = service(), snapshot = source(); files.schedule(snapshot, () => { throw new Error('simulated blob read failure'); });
    const failed = await files.flush(); expect(failed.mirror.state).toBe('error'); expect(failed.mirror.error).toContain('simulated');
    expect(readdirSync(join(files.root, 'mirror/manifests'))).toEqual([]);
    expect(snapshot.revision).toBe(1);
    files.schedule(snapshot, () => bytes); const ready = await files.flush(); expect(ready.mirror.state).toBe('ready');
    expect(readdirSync(join(files.root, 'mirror/manifests'))).toHaveLength(1);
    expect((await readMirrorManifest(join(files.root, ready.mirror.manifestPath!))).snapshot).toEqual(snapshot);
  });

  it('discovers the last published manifest on reopen and rejects stale or wrong-workspace projections', async () => {
    const files = service(), snapshot = source(); files.schedule({ ...snapshot, revision: 3 }, () => bytes); await files.flush(); await files.close();
    const reopen = new WorkspaceFiles(files.root.slice(0, -6)); services.push(reopen); await reopen.list();
    expect(reopen.status().mirror.revision).toBe(3);
    reopen.schedule(snapshot, () => bytes); expect((await reopen.flush()).mirror.state).toBe('error');
    reopen.schedule({ ...snapshot, id: 'other', revision: 4 }, () => bytes); expect((await reopen.flush()).mirror.error).toContain('different workspace');
  });

  it('rejects traversal, absolute, reserved, symlink and out-of-area paths', async () => {
    const files = service(); await files.list();
    for (const path of ['../outside', '/absolute', 'C:/absolute', 'exchange/inbox/../outbox', 'exchange/inbox/CON.md', 'exchange/inbox/trailing.', 'other/file.md', 'exchange\\inbox\\file.md']) await expect(files.read(path)).rejects.toThrow();
    const outside = join(dirs.at(-1)!, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'secret.md'), 'untouched');
    symlinkSync(outside, join(files.root, 'exchange/inbox/junction'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(files.read('exchange/inbox/junction/secret.md')).rejects.toThrow('Symlinks');
    expect((await files.list('exchange/inbox')).some(entry => entry.name === 'junction')).toBe(false);
    expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('untouched');
  });

  it('rejects modified manifest metadata and forged traversal metadata even with recomputed envelope hash', async () => {
    const files = service(); files.schedule(source(), () => bytes); await files.flush();
    const file = join(files.root, files.status().mirror.manifestPath!), value = manifest(files);
    value.payload.workspace.name = 'tampered'; writeFileSync(file, JSON.stringify(value));
    await expect(readMirrorManifest(file)).rejects.toThrow('checksum');
    value.payload.notes[0].file = 'mirror/notes/../../../outside.md'; value.sha256 = hash(JSON.stringify(value.payload)); writeFileSync(file, JSON.stringify(value));
    await expect(readMirrorManifest(file)).rejects.toThrow('Unsafe');
  });

  it('creates a fresh conventional AI folder, includes original relative attachment paths and preserves edited exports', async () => {
    const files = service(), snapshot = source(); const exported = await files.buildAiFolder(snapshot, () => bytes);
    expect(readFileSync(join(exported.absolutePath, 'notes/Folder/Note.md'), 'utf8')).toBe(snapshot.notes[0].markdown);
    expect(readFileSync(join(exported.absolutePath, 'notes/images/image.png'))).toEqual(bytes);
    expect((await readMirrorManifest(join(files.root, exported.manifestPath))).snapshot).toEqual(snapshot);
    writeFileSync(join(exported.absolutePath, 'notes/Folder/Note.md'), 'AI changed');
    const another = await files.buildAiFolder(snapshot, () => bytes); expect(another.path).not.toBe(exported.path);
    expect(readFileSync(join(exported.absolutePath, 'notes/Folder/Note.md'), 'utf8')).toBe('AI changed');
    const inbox = await files.saveInbox('AI return.md', Buffer.from('review me'));
    expect(Buffer.from((await files.read(inbox.path)).bytes).toString()).toBe('review me');
    const exchange = await files.saveExchange(snapshot, 'exchange text'); expect(exchange.path).toMatch(/^exchange\/outbox\//);
  });

  it('keeps duplicate titles, invalid physical characters and deep hierarchy reconstructable', async () => {
    const files = service(), snapshot = source(); snapshot.attachments = [];
    snapshot.folders = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, name: 'Long folder name '.repeat(4).trim(), parentId: i ? `f${i - 1}` : null, revision: 1 }));
    snapshot.notes = ['a', 'b'].map(id => ({ ...snapshot.notes[0], id, title: 'CON:duplicate/name', folderId: 'f39' }));
    files.schedule(snapshot, () => bytes); const status = await files.flush(); expect(status.mirror.state).toBe('ready');
    const output = manifest(files); expect(new Set(output.payload.notes.map((note: { file: string }) => note.file)).size).toBe(2);
    expect((await readMirrorManifest(join(files.root, status.mirror.manifestPath!))).snapshot).toEqual(snapshot);
  });
});
