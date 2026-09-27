import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep, toNamespacedPath } from 'node:path';
import type { Attachment, Folder, Note, WorkspaceSnapshot } from '../src/domain/model.js';
import type { FileEntry, FileExportResult, FilesStatus } from '../src/domain/files.js';
import { validateSnapshot } from './store.js';

type BlobReader = (sha256: string) => Uint8Array | Promise<Uint8Array>;
interface ProjectedNote extends Omit<Note, 'markdown'> { file: string; sha256: string; size: number }
interface ProjectedAsset extends Attachment { file: string }
interface MirrorManifest {
  format: 'grasp-mirror'; version: 1; kind: 'mirror' | 'ai'; createdAt: string;
  workspace: Pick<WorkspaceSnapshot, 'id' | 'name' | 'revision' | 'settings'>;
  notes: ProjectedNote[]; folders: WorkspaceSnapshot['folders']; records: WorkspaceSnapshot['records'];
  attachments: ProjectedAsset[]; dirtyPaths: string[];
}
interface Envelope { format: 'grasp-manifest'; version: 1; sha256: string; payload: MirrorManifest }
export interface RebuildData { snapshot: WorkspaceSnapshot; blobs: Array<{ sha256: string; bytes: Uint8Array }> }
const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const fsPath = (path: string): string => toNamespacedPath(path);
const idSuffix = (id: string): string => digest(id).slice(0, 12);
const reserved = /^(?:con(?:in\$|out\$)?|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const utf8 = (value: string): Buffer => Buffer.from(value, 'utf8');
const revisionName = (revision: number): string => `r${String(revision).padStart(16, '0')}-${Date.now()}-${randomUUID()}`;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const MAX_FILE = 128 * 1024 * 1024;
const mimeTypes: Record<string, string> = { '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

async function mapLimit<T, R>(items: readonly T[], operation: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length); let cursor = 0;
  const workers = Array.from({ length: Math.min(12, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; output[index] = await operation(items[index]); }
  });
  // Wait for all writers to close even when one fails; a retry cannot overlap them.
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find(outcome => outcome.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return output;
}

function safeName(value: string): string {
  let name = Array.from(value.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')).slice(0, 80).join('').replace(/[ .]+$/, '').replace(/^\.+/, '_');
  if (!name) name = 'untitled';
  if (reserved.test(name)) name = `_${name}`;
  return name;
}
function validateRelative(path: string, allowRoot = false): void {
  if (allowRoot && path === '') return;
  if (!path || isAbsolute(path) || path.includes('\\') || path.length > 4096) throw new Error('Only bounded forward-slash relative paths are allowed.');
  for (const part of path.split('/')) if (!part || part === '.' || part === '..' || part.length > 180 || /[<>:"|?*\u0000-\u001f\u007f]/.test(part) || /[ .]$/.test(part) || reserved.test(part)) throw new Error('Unsafe or reserved path component.');
}

/** All filesystem access passes this boundary; no caller supplies an absolute child path. */
class SafeTree {
  constructor(readonly root: string, private readonly areas = ['exchange', 'attachments', 'mirror', 'README.md'], private readonly createRoot = true) {}
  absolute(path: string, allowRoot = false): string {
    validateRelative(path, allowRoot);
    if (path && !this.areas.includes(path.split('/')[0])) throw new Error('Path is outside managed file areas.');
    const absolute = resolve(this.root, path);
    const inside = relative(this.root, absolute);
    if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) throw new Error('Path escapes the file root.');
    return absolute;
  }
  async ensureRoot(): Promise<void> {
    if (this.createRoot) { try { await mkdir(fsPath(this.root)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
    const info = await lstat(fsPath(this.root));
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Managed file root is not a real directory.');
  }
  async checked(path: string, directory = false, create = false): Promise<string> {
    const absolute = this.absolute(path, directory);
    await this.ensureRoot();
    const parts = path ? path.split('/') : [];
    let cursor = this.root;
    for (let at = 0; at < parts.length; at++) {
      cursor = resolve(cursor, parts[at]);
      const isDirectory = at < parts.length - 1 || directory;
      if (create && isDirectory) { try { await mkdir(fsPath(cursor)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
      let info;
      try { info = await lstat(fsPath(cursor)); }
      catch (error) { if (create && !isDirectory && (error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
      if (info.isSymbolicLink() || (isDirectory ? !info.isDirectory() : !info.isFile())) throw new Error('Symlinks and non-regular files are not allowed.');
    }
    const rootReal = await realpath(fsPath(this.root));
    const parentReal = await realpath(fsPath(directory ? absolute : dirname(absolute)));
    const between = relative(rootReal, parentReal);
    if (between === '..' || between.startsWith(`..${sep}`) || isAbsolute(between)) throw new Error('Resolved file parent escaped the managed root.');
    return absolute;
  }
  async writeNew(path: string, bytes: Uint8Array): Promise<void> {
    const absolute = await this.checked(path, false, true);
    // Exclusive creation is essential: no check-then-overwrite of user-edited files.
    const handle = await open(fsPath(absolute), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await this.checked(path);
  }
  async read(path: string, maxBytes = MAX_FILE): Promise<Buffer> {
    const absolute = await this.checked(path);
    const handle = await open(fsPath(absolute), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > maxBytes) throw new Error('File exceeds the allowed size or is not regular.');
      const bytes = await handle.readFile();
      if (bytes.length > maxBytes) throw new Error('File grew past the allowed size.');
      await this.checked(path);
      return bytes;
    } finally { await handle.close(); }
  }
  async entry(path: string): Promise<FileEntry> {
    const absolute = this.absolute(path), info = await lstat(fsPath(absolute));
    await this.checked(path, info.isDirectory());
    return { name: basename(path), path, absolutePath: absolute, kind: info.isDirectory() ? 'directory' : 'file', size: info.isDirectory() ? 0 : info.size, modifiedAt: info.mtime.toISOString() };
  }
}

/** Logical names stay in metadata. Sanitized/colliding/long physical paths never lose identity. */
function notePaths(snapshot: WorkspaceSnapshot): Map<string, string> {
  const folders = new Map(snapshot.folders.map(folder => [folder.id, folder]));
  const folderPaths = new Map<string, string>();
  const siblingNames = new Map<string, number>();
  for (const folder of snapshot.folders) { const key = JSON.stringify([folder.parentId, safeName(folder.name).toLowerCase()]); siblingNames.set(key, (siblingNames.get(key) ?? 0) + 1); }
  for (const folder of snapshot.folders) {
    const chain: typeof snapshot.folders = [], seen = new Set<string>(); let at: string | null = folder.id;
    while (at !== null && !folderPaths.has(at)) {
      if (seen.has(at) || !folders.has(at)) throw new Error('Invalid folder ancestry in projection.');
      seen.add(at); const current: Folder = folders.get(at)!; chain.push(current); at = current.parentId;
    }
    let prefix = at === null ? '' : folderPaths.get(at)!;
    for (let i = chain.length - 1; i >= 0; i--) {
      const item = chain[i]; let name = safeName(item.name);
      if (siblingNames.get(JSON.stringify([item.parentId, name.toLowerCase()]))! > 1) name += `--${idSuffix(item.id)}`;
      prefix = prefix ? `${prefix}/${name}` : name;
      if (prefix.length > 180) prefix = `_long-path/${idSuffix(item.id)}`;
      folderPaths.set(item.id, prefix);
    }
  }
  const duplicateNames = new Map<string, number>();
  for (const note of snapshot.notes) { const key = JSON.stringify([note.folderId, safeName(note.title.replace(/\.md$/i, '')).toLowerCase()]); duplicateNames.set(key, (duplicateNames.get(key) ?? 0) + 1); }
  const paths = new Map<string, string>();
  for (const note of snapshot.notes) {
    let title = safeName(note.title.replace(/\.md$/i, ''));
    if (duplicateNames.get(JSON.stringify([note.folderId, title.toLowerCase()]))! > 1) title += `--${idSuffix(note.id)}`;
    const prefix = note.folderId === null ? '' : folderPaths.get(note.folderId);
    if (prefix === undefined) throw new Error('Note references a missing folder.');
    let path = `${prefix ? prefix + '/' : ''}${title}.md`;
    if (path.length > 240) path = `_long-path/${idSuffix(note.id)}/${title}.md`;
    paths.set(note.id, path);
  }
  return paths;
}
function envelope(manifest: MirrorManifest): string {
  return JSON.stringify({ format: 'grasp-manifest', version: 1, sha256: digest(JSON.stringify(manifest)), payload: manifest } satisfies Envelope, null, 2);
}
function parseManifest(bytes: Uint8Array): MirrorManifest {
  const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as Envelope;
  if (value?.format !== 'grasp-manifest' || value.version !== 1 || !value.payload || !/^[a-f\d]{64}$/.test(value.sha256) || digest(JSON.stringify(value.payload)) !== value.sha256) throw new Error('Manifest metadata checksum or format is invalid.');
  const manifest = value.payload;
  if (manifest.format !== 'grasp-mirror' || manifest.version !== 1 || !['mirror', 'ai'].includes(manifest.kind) || !Array.isArray(manifest.notes) || !Array.isArray(manifest.attachments) || !Array.isArray(manifest.dirtyPaths)) throw new Error('Unsupported mirror manifest.');
  return manifest;
}
function indexText(manifest: MirrorManifest, manifestFile: string, indexFile: string): string {
  const link = (file: string) => relative(dirname(indexFile), file).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
  return `# ${manifest.workspace.name.replace(/[\r\n]/g, ' ')} · r${manifest.workspace.revision}\n\n資料庫是唯一即時來源。這些檔案是可讀取的修訂快照；外部修改不會自動匯入，也不會被覆寫。\n\n[重建 metadata](${link(manifestFile)}) · ${manifest.notes.length} notes · ${manifest.records.length} records · ${manifest.attachments.length} attachments\n\n` + manifest.notes.map(note => `- [${note.title.replace(/[\[\]\r\n]/g, '_')}](${link(note.file)})`).join('\n') + '\n\n## Attachments\n\n' + manifest.attachments.map(asset => `- [${asset.path.replace(/[\[\]\r\n]/g, '_')}](${link(asset.file)})`).join('\n') + '\n';
}

export class WorkspaceFiles {
  readonly root: string;
  private readonly tree: SafeTree;
  private current?: MirrorManifest;
  private initialized = false;
  private closing = false;
  private pending?: { snapshot: WorkspaceSnapshot; readBlob: BlobReader };
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private verified = new Map<string, { signature: string; sha256: string }>();
  private state: FilesStatus;
  constructor(dbPath: string) {
    this.root = resolve(`${dbPath}.files`); this.tree = new SafeTree(this.root);
    this.state = { root: this.root, directories: { inbox: resolve(this.root, 'exchange/inbox'), outbox: resolve(this.root, 'exchange/outbox'), attachments: resolve(this.root, 'attachments'), mirror: resolve(this.root, 'mirror') },
      mirror: { state: 'idle', revision: null, manifestPath: null, indexPath: null, dirtyPaths: [], writtenFiles: 0, reusedFiles: 0, elapsedMs: 0 } };
  }
  status(): FilesStatus { return { ...this.state, directories: { ...this.state.directories }, mirror: { ...this.state.mirror, dirtyPaths: [...this.state.mirror.dirtyPaths] } }; }
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.tree.ensureRoot();
    for (const directory of ['exchange/inbox', 'exchange/outbox', 'attachments', 'mirror/manifests', 'mirror/index', 'mirror/notes']) await this.tree.checked(directory, true, true);
    try { await this.tree.writeNew('README.md', utf8('# GraspPortable workspace files\n\nSQLite 資料庫是唯一即時來源。\n\n- exchange/inbox：放置 AI 回傳或外部 Markdown；必須由 App 預覽並確認匯入。\n- exchange/outbox：明確匯出的 Markdown 與完整 AI 資料夾。\n- attachments：DB 附件的可復原投影。\n- mirror/index：每次成功發佈的可讀索引；檔名 r 後數字最大的版本是最新修訂。\n- mirror/manifests：對應的重建 metadata。只發佈完整投影；復原必須指定新的 DB。\n\n修訂檔與 manifest 都以新檔建立，不會覆寫外部修改；不會自動清理舊修訂。修改後請回到 App 的匯入審查。\n')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const candidates = (await readdir(fsPath(this.tree.absolute('mirror/manifests')))).filter(name => /^r\d{16}-[\d-]+[a-f\d-]*\.json$/.test(name)).sort().reverse();
    for (const name of candidates) {
      try {
        const file = `mirror/manifests/${name}`, manifest = parseManifest(await this.tree.read(file));
        if (manifest.kind !== 'mirror') continue;
        this.current = manifest; this.state.mirror.revision = manifest.workspace.revision; this.state.mirror.manifestPath = file;
        this.state.mirror.indexPath = `mirror/index/${name.replace(/\.json$/, '.md')}`;
        this.state.mirror.dirtyPaths = [...manifest.dirtyPaths]; break;
      } catch { this.state.mirror.dirtyPaths.push(`mirror/manifests/${name}`); }
    }
    this.initialized = true;
  }
  schedule(snapshot: WorkspaceSnapshot, readBlob: BlobReader): void {
    if (this.closing) return;
    if (this.pending?.snapshot.id === snapshot.id && this.pending.snapshot.revision > snapshot.revision) return;
    this.pending = { snapshot, readBlob }; this.state.mirror.state = 'pending';
    if (!this.timer && !this.running) this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, 150);
  }
  private drain(): Promise<void> {
    if (this.running) return this.running;
    const work = async () => {
      while (this.pending) {
        const next = this.pending; this.pending = undefined;
        try { await this.project(next.snapshot, next.readBlob); }
        catch (error) { this.state.mirror.state = 'error'; this.state.mirror.error = errorMessage(error); }
      }
    };
    this.running = work().finally(() => {
      this.running = undefined;
      // A producer may enqueue in the microtask between the last loop check and
      // this finalizer. Do not strand that snapshot until another user edit.
      if (this.pending && !this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, 0);
    });
    return this.running;
  }
  async flush(): Promise<FilesStatus> {
    do { clearTimeout(this.timer); this.timer = undefined; await this.drain(); } while (this.pending);
    return this.status();
  }
  async close(): Promise<void> { this.closing = true; await this.flush(); }
  private async matches(file: string, sha256: string, size: number): Promise<boolean> {
    try {
      const path = await this.tree.checked(file), info = await stat(fsPath(path));
      const signature = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      const cached = this.verified.get(file);
      const actual = cached?.signature === signature ? cached.sha256 : digest(await this.tree.read(file));
      this.verified.set(file, { signature, sha256: actual });
      return info.size === size && actual === sha256;
    } catch { return false; }
  }
  private async project(snapshot: WorkspaceSnapshot, readBlob: BlobReader): Promise<void> {
    const started = performance.now(); await this.initialize();
    if (this.current && this.current.workspace.id !== snapshot.id) throw new Error('File root belongs to a different workspace.');
    if (this.current && this.current.workspace.revision > snapshot.revision) throw new Error('Refusing to publish an older database revision over a newer mirror.');
    const paths = notePaths(snapshot), previousNotes = new Map(this.current?.notes.map(note => [note.id, note]) ?? []), previousAssets = new Map(this.current?.attachments.map(asset => [asset.id, asset]) ?? []);
    let written = 0, reused = 0;
    const dirty = new Set(this.state.mirror.dirtyPaths);
    const notes = await mapLimit(snapshot.notes, async (note): Promise<ProjectedNote> => {
      const { markdown, ...metadata } = note, bytes = utf8(markdown), hash = digest(bytes), old = previousNotes.get(note.id);
      const logical = paths.get(note.id)!, prefix = `mirror/notes/${logical.replace(/\.md$/, '')}--${idSuffix(note.id)}`;
      let file: string;
      if (old && old.sha256 === hash && old.file.startsWith(prefix + '/') && await this.matches(old.file, hash, bytes.length)) { file = old.file; reused++; }
      else {
        if (old && !(await this.matches(old.file, old.sha256, old.size))) dirty.add(old.file);
        file = `${prefix}/${revisionName(note.revision)}.md`; await this.tree.writeNew(file, bytes); written++;
        await this.matches(file, hash, bytes.length);
      }
      return { ...metadata, file, sha256: hash, size: bytes.length };
    });
    const attachments: ProjectedAsset[] = [];
    for (const asset of snapshot.attachments) {
      const old = previousAssets.get(asset.id); let file: string;
      if (old && old.sha256 === asset.sha256 && await this.matches(old.file, asset.sha256, asset.size)) { file = old.file; reused++; }
      else {
        if (old && !(await this.matches(old.file, old.sha256, old.size))) dirty.add(old.file);
        const bytes = await readBlob(asset.sha256);
        if (bytes.length !== asset.size || digest(bytes) !== asset.sha256) throw new Error(`Attachment DB bytes do not match metadata: ${asset.id}`);
        file = `attachments/${idSuffix(asset.id)}/${revisionName(asset.revision)}-${safeName(asset.name)}`;
        await this.tree.writeNew(file, bytes); written++;
        await this.matches(file, asset.sha256, asset.size);
      }
      attachments.push({ ...asset, file });
    }
    const manifest: MirrorManifest = { format: 'grasp-mirror', version: 1, kind: 'mirror', createdAt: new Date().toISOString(), workspace: { id: snapshot.id, name: snapshot.name, revision: snapshot.revision, settings: snapshot.settings }, folders: snapshot.folders, records: snapshot.records, notes, attachments, dirtyPaths: [...dirty] };
    const version = revisionName(snapshot.revision), manifestPath = `mirror/manifests/${version}.json`, indexPath = `mirror/index/${version}.md`;
    // An index is not authoritative until its matching manifest is published last.
    await this.tree.writeNew(indexPath, utf8(indexText(manifest, manifestPath, indexPath)));
    await this.tree.writeNew(manifestPath, utf8(envelope(manifest)));
    this.current = manifest;
    this.state.mirror = { state: 'ready', revision: snapshot.revision, manifestPath, indexPath, dirtyPaths: [...dirty], writtenFiles: written, reusedFiles: reused, elapsedMs: performance.now() - started };
  }
  async directoryPath(path = ''): Promise<string> { await this.initialize(); return this.tree.checked(path, true); }
  async list(directory = ''): Promise<FileEntry[]> {
    await this.initialize(); const path = await this.tree.checked(directory, true);
    const names = await readdir(fsPath(path)); if (names.length > 10_000) throw new Error('Directory listing exceeds 10,000 entries; select a narrower directory.');
    const entries: FileEntry[] = [];
    for (const name of names.sort()) { try { entries.push(await this.tree.entry(directory ? `${directory}/${name}` : name)); } catch { /* Never advertise untrusted symlink/out-of-scope entries. */ } }
    return entries;
  }
  async read(path: string, maxBytes = MAX_FILE): Promise<{ bytes: Uint8Array; name: string; mimeType: string }> { await this.initialize(); return { bytes: await this.tree.read(path, maxBytes), name: basename(path), mimeType: mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream' }; }
  async saveInbox(name: string, bytes: Uint8Array): Promise<FileEntry> {
    await this.initialize(); if (bytes.length > 32 * 1024 * 1024 || !/\.(md|markdown|txt)$/i.test(name)) throw new Error('Inbox accepts Markdown/text up to 32 MiB.');
    const file = `exchange/inbox/${Date.now()}-${randomUUID()}-${safeName(name)}`; await this.tree.writeNew(file, bytes); return this.tree.entry(file);
  }
  async saveExchange(snapshot: WorkspaceSnapshot, markdown: string): Promise<FileEntry> {
    await this.initialize(); const file = `exchange/outbox/${revisionName(snapshot.revision)}-${safeName(snapshot.name)}.grasp.md`;
    await this.tree.writeNew(file, utf8(markdown)); return this.tree.entry(file);
  }
  async buildAiFolder(snapshot: WorkspaceSnapshot, readBlob: BlobReader): Promise<FileExportResult> {
    await this.initialize(); const base = `exchange/outbox/ai-${revisionName(snapshot.revision)}`;
    const paths = notePaths(snapshot), attachments: ProjectedAsset[] = [];
    let bytes = 0, files = 0;
    const occupied = new Set<string>();
    const notes = await mapLimit(snapshot.notes, async (note): Promise<ProjectedNote> => {
      const { markdown, ...metadata } = note, content = utf8(markdown), file = `notes/${paths.get(note.id)!}`;
      await this.tree.writeNew(`${base}/${file}`, content); bytes += content.length; files++;
      occupied.add(file.normalize('NFC').toLowerCase());
      return { ...metadata, file, sha256: digest(content), size: content.length };
    });
    for (const asset of snapshot.attachments) {
      const content = await readBlob(asset.sha256);
      if (content.length !== asset.size || digest(content) !== asset.sha256) throw new Error('Attachment DB bytes do not match metadata.');
      let file = `notes/${asset.path}`;
      try { validateRelative(file); if (file.length > 240 || occupied.has(file.normalize('NFC').toLowerCase())) throw new Error('Asset path needs disambiguation.'); }
      catch { file = `attachments/${idSuffix(asset.id)}/${safeName(asset.name)}`; }
      occupied.add(file.normalize('NFC').toLowerCase());
      await this.tree.writeNew(`${base}/${file}`, content); bytes += content.length; files++;
      attachments.push({ ...asset, file });
    }
    const manifest: MirrorManifest = { format: 'grasp-mirror', version: 1, kind: 'ai', createdAt: new Date().toISOString(), workspace: { id: snapshot.id, name: snapshot.name, revision: snapshot.revision, settings: snapshot.settings }, notes, folders: snapshot.folders, records: snapshot.records, attachments, dirtyPaths: [] };
    const manifestPath = `${base}/grasp-manifest.json`, indexPath = `${base}/README.md`;
    await this.tree.writeNew(indexPath, utf8(indexText(manifest, 'grasp-manifest.json', 'README.md') + '\nAI 修改回傳：請將需要的 Markdown 放入 exchange/inbox，再透過 App 預覽匯入。manifest 是原始快照 checksum，修改後不能直接當作可信重建來源。\n'));
    await this.tree.writeNew(manifestPath, utf8(envelope(manifest)));
    return { path: base, absolutePath: this.tree.absolute(base), manifestPath, indexPath, files: files + 2, bytes };
  }
}

/** Read-only validation for disaster recovery. The caller must create a NEW database. */
export async function readMirrorManifest(manifestAbsolutePath: string): Promise<RebuildData> {
  const manifestPath = resolve(manifestAbsolutePath);
  const parent = dirname(manifestPath);
  const mirror = basename(parent) === 'manifests' && basename(dirname(parent)) === 'mirror';
  if (!mirror && basename(manifestPath) !== 'grasp-manifest.json') throw new Error('Select a published mirror manifest or AI-folder grasp-manifest.json.');
  const root = mirror ? dirname(dirname(parent)) : parent;
  const tree = new SafeTree(root, mirror ? ['mirror', 'attachments'] : ['notes', 'attachments', 'grasp-manifest.json'], false);
  const localManifest = relative(root, manifestPath).replace(/\\/g, '/');
  const manifest = parseManifest(await tree.read(localManifest));
  if (manifest.kind !== (mirror ? 'mirror' : 'ai')) throw new Error('Manifest kind does not match its containing layout.');
  const notes: Note[] = [], attachments: Attachment[] = [], blobs = new Map<string, Uint8Array>();
  const usedPaths = new Set<string>();
  for (const entry of manifest.notes) {
    if (!entry || typeof entry.file !== 'string' || !/^[a-f\d]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Invalid note file metadata.');
    if (!(mirror ? entry.file.startsWith('mirror/notes/') : entry.file.startsWith('notes/'))) throw new Error('Note file is outside its designated area.');
    const pathKey = entry.file.normalize('NFC').toLowerCase(); if (usedPaths.has(pathKey)) throw new Error('Duplicate projected file path.'); usedPaths.add(pathKey);
    const bytes = await tree.read(entry.file, 10 * 1024 * 1024);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error(`Note hash mismatch: ${entry.id}`);
    const markdown = bytes.toString('utf8'); if (!utf8(markdown).equals(bytes)) throw new Error('Note is not valid UTF-8.');
    const { file: _file, sha256: _sha, size: _size, ...metadata } = entry; notes.push({ ...metadata, markdown });
  }
  for (const entry of manifest.attachments) {
    if (!entry || typeof entry.file !== 'string' || !(entry.file.startsWith('attachments/') || (!mirror && entry.file.startsWith('notes/'))) || !/^[a-f\d]{64}$/.test(entry.sha256)) throw new Error('Invalid attachment file metadata.');
    const pathKey = entry.file.normalize('NFC').toLowerCase(); if (usedPaths.has(pathKey)) throw new Error('Duplicate projected file path.'); usedPaths.add(pathKey);
    const bytes = await tree.read(entry.file, 64 * 1024 * 1024);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error(`Attachment hash mismatch: ${entry.id}`);
    blobs.set(entry.sha256, bytes); const { file: _file, ...metadata } = entry; attachments.push(metadata);
  }
  const snapshot = validateSnapshot({ ...manifest.workspace, notes, folders: manifest.folders, records: manifest.records, attachments });
  return { snapshot, blobs: [...blobs].map(([sha256, bytes]) => ({ sha256, bytes })) };
}
