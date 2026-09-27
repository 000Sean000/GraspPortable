import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  vi.restoreAllMocks();
  for (const files of services.splice(0)) await files.close();
  for (const dir of dirs.splice(0)) { if (!resolve(dir).startsWith(base + sep)) throw new Error('Unsafe test cleanup.'); rmSync(dir, { recursive: true, force: true }); }
});

describe('single readable workspace projection', () => {
  it('publishes readable entrypoints and reconstructs source IDs, hierarchy, records and attachment bytes', async () => {
    const files = service(), snapshot = source(); files.schedule(snapshot, () => bytes);
    const status = await files.flush(); expect(status.mirror.state).toBe('ready'); expect(status.mirror.writtenFiles).toBe(2);
    expect(readFileSync(join(files.root, 'README.md'), 'utf8')).toContain('exchange/inbox');
    expect(readFileSync(join(files.root, status.mirror.indexPath!), 'utf8')).toContain('Note');
    const rebuilt = await readMirrorManifest(join(files.root, status.mirror.manifestPath!));
    expect(rebuilt.snapshot).toEqual(snapshot); expect(Buffer.from(rebuilt.blobs[0].bytes)).toEqual(bytes);
  });

  it('updates one readable filename, retains internal recovery, and coalesces pending snapshots', async () => {
    const files = service(), snapshot = source(); files.schedule(snapshot, () => bytes); await files.flush();
    const first = manifest(files), originalFile = first.payload.notes[0].file;
    files.schedule({ ...snapshot, revision: 2, name: 'metadata' }, () => bytes);
    files.schedule({ ...snapshot, revision: 3, notes: [{ ...snapshot.notes[0], markdown: 'updated', revision: 3 }] }, () => bytes);
    const status = await files.flush(); expect(status.mirror.revision).toBe(3); expect(status.mirror.writtenFiles).toBe(1); expect(status.mirror.reusedFiles).toBe(1);
    expect(readFileSync(join(files.root, originalFile), 'utf8')).toBe('updated');
    expect(readdirSync(join(files.root, '.grasp/manifests')).filter(name => name.endsWith('.json'))).toHaveLength(2);
    const recovery = readdirSync(join(files.root, '.grasp/internal/manifests')).sort()[0];
    expect((await readMirrorManifest(join(files.root, '.grasp/internal/manifests', recovery))).snapshot).toEqual(snapshot);
    expect((await readMirrorManifest(join(files.root, status.mirror.manifestPath!))).snapshot.notes[0].markdown).toBe('updated');
  });

  it('never overwrites externally edited projection bytes and marks the old path dirty', async () => {
    const files = service(), snapshot = source(); files.schedule(snapshot, () => bytes); await files.flush();
    const old = manifest(files), path = old.payload.notes[0].file, oldManifest = files.status().mirror.manifestPath!;
    writeFileSync(join(files.root, path), 'EXTERNAL AI EDIT');
    await expect(readMirrorManifest(join(files.root, oldManifest))).rejects.toThrow('hash mismatch');
    files.schedule(snapshot, () => bytes); const status = await files.flush();
    expect(status.mirror.dirtyPaths).toContain(path); expect(status.mirror.state).toBe('dirty');
    expect(readFileSync(join(files.root, path), 'utf8')).toBe('EXTERNAL AI EDIT');
    expect(manifest(files).payload.notes[0].file).toBe(path); expect(status.mirror.manifestPath).toBe(oldManifest);
    expect(snapshot.notes[0].markdown).not.toContain('EXTERNAL');
  });

  it('preserves changed attachment projections without silently recreating their bytes', async () => {
    const files = service(); files.schedule(source(), () => bytes); await files.flush();
    const oldPath = manifest(files).payload.attachments[0].file;
    writeFileSync(join(files.root, oldPath), Buffer.from('external attachment'));
    files.schedule(source(), () => bytes); const status = await files.flush();
    expect(status.mirror.dirtyPaths).toContain(oldPath);
    expect(readFileSync(join(files.root, oldPath), 'utf8')).toBe('external attachment');
    expect(status.mirror.state).toBe('dirty'); expect(manifest(files).payload.attachments[0].file).toBe(oldPath);
  });

  it('keeps DB saves valid when projection fails, publishes no partial manifest and retries safely', async () => {
    const files = service(), snapshot = source(); files.schedule(snapshot, () => { throw new Error('simulated blob read failure'); });
    const failed = await files.flush(); expect(failed.mirror.state).toBe('error'); expect(failed.mirror.error).toContain('simulated');
    expect(readdirSync(join(files.root, '.grasp/manifests'))).toEqual([]);
    expect(snapshot.revision).toBe(1);
    files.schedule(snapshot, () => bytes); const ready = await files.flush(); expect(ready.mirror.state).toBe('ready');
    expect(readdirSync(join(files.root, '.grasp/manifests')).filter(name => name.endsWith('.json'))).toHaveLength(1);
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
    symlinkSync(outside, join(files.root, '.grasp/exchange/inbox/junction'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(files.read('.grasp/exchange/inbox/junction/secret.md')).rejects.toThrow('Symlinks');
    expect((await files.list('.grasp/exchange/inbox')).some(entry => entry.name === 'junction')).toBe(false);
    expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('untouched');
  });

  it('rejects modified manifest metadata and forged traversal metadata even with recomputed envelope hash', async () => {
    const files = service(); files.schedule(source(), () => bytes); await files.flush();
    const file = join(files.root, files.status().mirror.manifestPath!), value = manifest(files);
    value.payload.workspace.name = 'tampered'; writeFileSync(file, JSON.stringify(value));
    await expect(readMirrorManifest(file)).rejects.toThrow('checksum');
    value.payload.notes[0].file = 'Markdown/../../outside.md'; value.sha256 = hash(JSON.stringify(value.payload)); writeFileSync(file, JSON.stringify(value));
    await expect(readMirrorManifest(file)).rejects.toThrow('Unsafe');
  });

  it('returns the same current readable tree for AI without creating a second copy', async () => {
    const files = service(), snapshot = source(); const exported = await files.buildAiFolder(snapshot, () => bytes);
    expect(readFileSync(join(exported.absolutePath, 'Folder/Note.md'), 'utf8')).toBe(snapshot.notes[0].markdown);
    expect(readFileSync(join(exported.absolutePath, 'images/image.png'))).toEqual(bytes);
    expect((await readMirrorManifest(join(files.root, exported.manifestPath))).snapshot).toEqual(snapshot);
    const another = await files.buildAiFolder(snapshot, () => bytes); expect(another).toEqual(exported);
    writeFileSync(join(exported.absolutePath, 'Folder/Note.md'), 'AI changed');
    await expect(files.buildAiFolder(snapshot, () => bytes)).rejects.toThrow();
    expect(readFileSync(join(exported.absolutePath, 'Folder/Note.md'), 'utf8')).toBe('AI changed');
    const inbox = await files.saveInbox('AI return.md', Buffer.from('review me'));
    expect(Buffer.from((await files.read(inbox.path)).bytes).toString()).toBe('review me');
    const exchange = await files.saveExchange(snapshot, 'exchange text'); expect(exchange.path).toMatch(/^\.grasp\/exchange\/outbox\//);
  });

  it('keeps duplicate titles, invalid physical characters and deep hierarchy reconstructable', async () => {
    const files = service(), snapshot = source(); snapshot.attachments = [];
    snapshot.folders = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, name: 'Long folder name '.repeat(4).trim(), parentId: i ? `f${i - 1}` : null, revision: 1 }));
    snapshot.notes = ['a', 'b'].map(id => ({ ...snapshot.notes[0], id, title: 'CON:duplicate/name', folderId: 'f39' }));
    files.schedule(snapshot, () => bytes); const status = await files.flush(); expect(status.mirror.state).toBe('ready');
    const output = manifest(files); expect(new Set(output.payload.notes.map((note: { file: string }) => note.file)).size).toBe(2);
    expect((await readMirrorManifest(join(files.root, status.mirror.manifestPath!))).snapshot).toEqual(snapshot);
  });

  it('rebuilds legal Unicode notes larger than 10 MiB in UTF-8 while preserving the store character limit', async () => {
    const files = service(), snapshot = source();
    snapshot.attachments = []; snapshot.notes[0].markdown = '中'.repeat(3_500_000);
    expect(Buffer.byteLength(snapshot.notes[0].markdown)).toBeGreaterThan(10 * 1024 * 1024);
    files.schedule(snapshot, () => bytes); const status = await files.flush();
    expect(status.mirror.state).toBe('ready');
    const rebuilt = await readMirrorManifest(join(files.root, status.mirror.manifestPath!));
    expect(rebuilt.snapshot.notes[0].markdown).toBe(snapshot.notes[0].markdown);
  });

  it('uses the Workspace parent of .grasp DB and exposes checked entity paths without publishing another tree', async () => {
    const dir = mkdtempSync(join(base, 'case-')); dirs.push(dir); mkdirSync(join(dir, '.grasp'));
    const files = new WorkspaceFiles(join(dir, '.grasp/workspace.grasp.db')); services.push(files);
    files.schedule(source(), () => bytes); expect((await files.flush()).mirror.state).toBe('ready');
    expect(files.root).toBe(dir); expect((await files.locate('note', 'n')).path).toBe('Markdown/Folder/Note.md');
    expect((await files.locate('folder', 'f')).path).toBe('Markdown/Folder');
    expect((await files.locate('attachment', 'asset')).path).toBe('Markdown/images/image.png');
    await expect(files.revealPath('.grasp/workspace.grasp.db')).rejects.toThrow('outside');
  });

  it('detects external edits with no DB save, rejects simultaneous note changes, and adopts a reviewed identical DB import', async () => {
    const files = service(), original = source(); files.schedule(original, () => bytes); await files.flush();
    const path = (await files.locate('note', 'n')).path; writeFileSync(join(files.root, path), '\uFEFFexternal\r\n');
    expect((await files.inspect()).mirror.dirtyPaths).toEqual([path]);
    const review = await files.reviewExternalNote(path, original); expect(review).toMatchObject({ noteId: 'n', noteRevision: 1, markdown: '\uFEFFexternal\r\n' });
    const changed = { ...original, revision: 2, notes: [{ ...original.notes[0], revision: 2, markdown: 'DB edit' }] };
    await expect(files.reviewExternalNote(path, changed)).rejects.toThrow('Database note changed');
    files.schedule(changed, () => bytes); expect((await files.flush()).mirror.state).toBe('dirty');
    expect(readFileSync(join(files.root, path), 'utf8')).toBe(review.markdown);
    const accepted = { ...changed, notes: [{ ...changed.notes[0], markdown: review.markdown }] };
    files.schedule(accepted, () => bytes); expect((await files.flush()).mirror.state).toBe('ready');
    expect((await files.inspect()).mirror.dirtyPaths).toEqual([]);
    expect((await readMirrorManifest(join(files.root, files.status().mirror.manifestPath!))).snapshot).toEqual(accepted);
  });

  it('checks old files before DB deletion or move and leaves all public files unchanged when dirty', async () => {
    const files = service(), original = source(); files.schedule(original, () => bytes); await files.flush();
    const path = (await files.locate('note', 'n')).path; writeFileSync(join(files.root, path), 'external');
    files.schedule({ ...original, revision: 2, notes: [] }, () => bytes);
    expect((await files.flush()).mirror.state).toBe('dirty'); expect(readFileSync(join(files.root, path), 'utf8')).toBe('external');
    files.schedule({ ...original, revision: 3, notes: [{ ...original.notes[0], title: 'Moved', revision: 2, folderId: null }] }, () => bytes);
    expect((await files.flush()).mirror.state).toBe('dirty'); expect(existsSync(join(files.root, 'Markdown/Moved.md'))).toBe(false);
    writeFileSync(join(files.root, path), original.notes[0].markdown);
    rmSync(join(files.root, path)); expect((await files.inspect()).mirror.dirtyPaths).toContain(path);
    files.schedule(original, () => bytes); expect((await files.flush()).mirror.state).toBe('dirty'); expect(existsSync(join(files.root, path))).toBe(false);
  });

  it('preserves untracked content, ignores Obsidian settings, and detects deleted empty folders', async () => {
    const files = service(), original = source(); original.folders.push({ id: 'empty', name: 'Empty', parentId: null, revision: 1 });
    files.schedule(original, () => bytes); await files.flush();
    mkdirSync(join(files.root, 'Markdown/.obsidian')); writeFileSync(join(files.root, 'Markdown/.obsidian/app.json'), '{}');
    expect((await files.inspect()).mirror.state).toBe('ready');
    writeFileSync(join(files.root, 'Markdown/External.md'), 'external'); expect((await files.inspect()).mirror.dirtyPaths).toContain('Markdown/External.md');
    await expect(readMirrorManifest(join(files.root, files.status().mirror.manifestPath!))).rejects.toThrow('Unreviewed external');
    files.schedule({ ...original, revision: 2, name: 'metadata' }, () => bytes); expect((await files.flush()).mirror.revision).toBe(1);
    expect(readFileSync(join(files.root, 'Markdown/External.md'), 'utf8')).toBe('external');
    rmSync(join(files.root, 'Markdown/External.md')); rmSync(join(files.root, 'Markdown/Empty'), { recursive: true });
    expect((await files.inspect()).mirror.dirtyPaths).toContain('Markdown/Empty');
  });

  it('rolls back injected manifest publication failure and reopens the previous complete revision', async () => {
    const files = service(), original = source(); files.schedule(original, () => bytes); await files.flush(); const oldManifest = files.status().mirror.manifestPath;
    const tree = (files as unknown as { tree: { install(source: string, target: string): Promise<void> } }).tree, install = tree.install.bind(tree);
    vi.spyOn(tree, 'install').mockImplementation(async (source, target) => { if (target.startsWith('.grasp/manifests/') && target.endsWith('.json')) throw new Error('injected manifest publish failure'); await install(source, target); });
    files.schedule({ ...original, revision: 2, notes: [{ ...original.notes[0], revision: 2, markdown: 'changed' }] }, () => bytes);
    const failed = await files.flush(); expect(failed.mirror.state).toBe('error'); expect(failed.mirror.error).toContain('rolled back'); expect(failed.mirror.error).toContain('.grasp/internal/transactions/');
    expect(files.status().mirror.manifestPath).toBe(oldManifest); expect(readFileSync(join(files.root, 'Markdown/Folder/Note.md'), 'utf8')).toBe(original.notes[0].markdown);
    await files.close(); const reopened = new WorkspaceFiles(files.root.slice(0, -6)); services.push(reopened);
    expect((await reopened.inspect()).mirror.state).toBe('ready'); expect(reopened.status().mirror.revision).toBe(1);
  });

  it('restores an interrupted publication from its persisted journal before reading the last manifest', async () => {
    const files = service(), original = source(); files.schedule(original, () => bytes); await files.flush(); await files.close();
    const file = 'Markdown/Folder/Note.md', transaction = '.grasp/internal/transactions/crash-fixture', backup = transaction + '/old-0';
    mkdirSync(join(files.root, transaction)); renameSync(join(files.root, file), join(files.root, backup)); writeFileSync(join(files.root, file), 'partially published');
    writeFileSync(join(files.root, transaction, 'journal.json'), JSON.stringify({ format: 'grasp-publish', version: 1, manifestPath: '.grasp/manifests/not-published.json', manifestSha256: hash('absent'), manifestSize: 6,
      changes: [{ file, backup, old: { sha256: hash(original.notes[0].markdown), size: Buffer.byteLength(original.notes[0].markdown) }, next: { sha256: hash('partially published'), size: Buffer.byteLength('partially published') } }] }));
    const reopened = new WorkspaceFiles(files.root.slice(0, -6)); services.push(reopened);
    expect((await reopened.inspect()).mirror.state).toBe('ready'); expect(reopened.status().mirror.revision).toBe(1);
    expect(readFileSync(join(files.root, file), 'utf8')).toBe(original.notes[0].markdown);
    expect(existsSync(join(files.root, transaction, 'rolled-back.json'))).toBe(true);
  });

  it('keeps incomplete staged journals invisible to restart recovery', async () => {
    const files = service(); files.schedule(source(), () => bytes); await files.flush(); await files.close();
    const transaction = join(files.root, '.grasp/internal/transactions/partial-stage'); mkdirSync(transaction);
    writeFileSync(join(transaction, 'staged-journal.json'), '{partial write');
    const reopened = new WorkspaceFiles(files.root.slice(0, -6)); services.push(reopened);
    expect((await reopened.inspect()).mirror.state).toBe('ready'); expect(reopened.status().mirror.revision).toBe(1);
  });

  it('preserves literal title suffixes and publishes note-to-folder and empty-folder-to-note transitions', async () => {
    const files = service(), initial = source(); initial.attachments = []; initial.folders = [];
    initial.notes = [{ ...initial.notes[0], title: 'report.md', folderId: null }];
    files.schedule(initial, () => bytes); expect((await files.flush()).mirror.state).toBe('ready');
    expect((await files.locate('note', 'n')).path).toBe('Markdown/report.md.md');
    const nested = { ...initial, revision: 2, folders: [{ id: 'g', name: 'report.md.md', parentId: null, revision: 1 }], notes: [{ ...initial.notes[0], revision: 2, title: 'Child', folderId: 'g' }] };
    const tree = (files as unknown as { tree: { install(source: string, target: string): Promise<void> } }).tree, install = tree.install.bind(tree);
    const failure = vi.spyOn(tree, 'install').mockImplementation(async (source, target) => { if (target.startsWith('.grasp/manifests/') && target.endsWith('.json')) throw new Error('injected shape transition failure'); await install(source, target); });
    files.schedule(nested, () => bytes); expect((await files.flush()).mirror.state).toBe('error');
    expect(readFileSync(join(files.root, 'Markdown/report.md.md'), 'utf8')).toBe(initial.notes[0].markdown); failure.mockRestore();
    files.schedule(nested, () => bytes); expect((await files.flush()).mirror.state).toBe('ready');
    expect((await files.locate('note', 'n')).path).toBe('Markdown/report.md.md/Child.md');
    const empty = { ...nested, revision: 3, notes: [] }; files.schedule(empty, () => bytes); expect((await files.flush()).mirror.state).toBe('ready');
    files.schedule({ ...initial, revision: 4 }, () => bytes); expect((await files.flush()).mirror.state).toBe('ready');
    expect(readFileSync(join(files.root, 'Markdown/report.md.md'), 'utf8')).toBe(initial.notes[0].markdown);
  });
});
