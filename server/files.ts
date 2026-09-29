import { hostPerformance } from './performance.js';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rename, rmdir, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep, toNamespacedPath } from 'node:path';
import type { Attachment, Folder, Note, WorkspaceSnapshot } from '../src/domain/model.js';
import type { ExternalNoteReview, FileEntry, FileExportResult, FilesStatus } from '../src/domain/files.js';
import { MAX_MARKDOWN_CHARACTERS, validateSnapshot } from './store.js';

type BlobReader = (sha256: string) => Uint8Array | Promise<Uint8Array>;
interface ProjectedNote extends Omit<Note, 'markdown'> { file: string; sha256: string; size: number }
interface ProjectedAsset extends Attachment { file: string }
interface MirrorManifest {
  format: 'grasp-mirror'; version: 1; kind: 'mirror' | 'ai' | 'projection' | 'recovery'; createdAt: string;
  workspace: Pick<WorkspaceSnapshot, 'id' | 'name' | 'revision' | 'settings'>;
  notes: ProjectedNote[]; folders: WorkspaceSnapshot['folders']; records: WorkspaceSnapshot['records'];
  attachments: ProjectedAsset[]; dirtyPaths: string[];
  folderPaths?: Array<{ id: string; path: string }>;
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
  let name = value.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').slice(0, 240).replace(/[ .]+$/, '').replace(/^\.+/, '_');
  if (!name) name = 'untitled';
  if (reserved.test(name)) name = `_${name}`;
  return name;
}
function validateRelative(path: string, allowRoot = false): void {
  if (allowRoot && path === '') return;
  if (!path || isAbsolute(path) || path.includes('\\') || path.length > 4096) throw new Error('Only bounded forward-slash relative paths are allowed.');
  for (const part of path.split('/')) if (!part || part === '.' || part === '..' || part.length > 255 || /[<>:"|?*\u0000-\u001f\u007f]/.test(part) || /[ .]$/.test(part) || reserved.test(part)) throw new Error('Unsafe or reserved path component.');
}

/** All filesystem access passes this boundary; no caller supplies an absolute child path. */
export class SafeTree {
  constructor(readonly root: string, private readonly areas = ['exchange', 'attachments', 'mirror', 'README.md'], private readonly createRoot = true) {}
  absolute(path: string, allowRoot = false): string {
    validateRelative(path, allowRoot);
    if (path && !this.areas.some(area => path === area || path.startsWith(area + '/') || (allowRoot && area.startsWith(path + '/')))) throw new Error('Path is outside managed file areas.');
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
    return hostPerformance.measure('filesystem', 'fs.check', {}, async () => {
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
    });
  }
  async writeNew(path: string, bytes: Uint8Array): Promise<void> {
    return hostPerformance.measure('filesystem', 'fs.write', { bytes: bytes.byteLength }, async () => {
    const absolute = await this.checked(path, false, true);
    // Exclusive creation is essential: no check-then-overwrite of user-edited files.
    const handle = await open(fsPath(absolute), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await this.checked(path);
    });
  }
  async read(path: string, maxBytes = MAX_FILE): Promise<Buffer> {
    return hostPerformance.measure('filesystem', 'fs.read', {}, async () => {
    const absolute = await this.checked(path);
    const handle = await open(fsPath(absolute), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > maxBytes) throw new Error('File exceeds the allowed size or is not regular.');
      const bytes = await handle.readFile();
      if (bytes.length > maxBytes) throw new Error('File grew past the allowed size.');
      await this.checked(path);
      hostPerformance.instant('filesystem', 'fs.read', { bytes: bytes.length });
      return bytes;
    } finally { await handle.close(); }
    });
  }
  async entry(path: string): Promise<FileEntry> {
    const absolute = this.absolute(path), info = await lstat(fsPath(absolute));
    await this.checked(path, info.isDirectory());
    return { name: basename(path), path, absolutePath: absolute, kind: info.isDirectory() ? 'directory' : 'file', size: info.isDirectory() ? 0 : info.size, modifiedAt: info.mtime.toISOString() };
  }
  async moveTo(path: string, target: string): Promise<void> {
    return hostPerformance.measure('filesystem', 'fs.rename', {}, async () => {
    const source = await this.checked(path), destination = await this.checked(target, false, true);
    try { await lstat(fsPath(destination)); throw new Error('Move destination already exists.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rename(fsPath(source), fsPath(destination));
    });
  }
  async install(path: string, target: string): Promise<void> {
    return hostPerformance.measure('filesystem', 'fs.rename', {}, async () => {
    const source = await this.checked(path), destination = await this.checked(target, false, true);
    // A hard-link publication is atomic and fails if a competing writer created
    // the destination. Unlink staging immediately; public edits cannot alter it.
    await link(fsPath(source), fsPath(destination));
    // Publication already committed at link(). A cleanup failure must not turn
    // a valid published manifest into an apparent failed transaction.
    try { await unlink(fsPath(source)); } catch { /* Harmless internal extra link; recovery payloads are independent copies. */ }
    });
  }
}

/** Logical names stay in metadata. Sanitized/colliding/long physical paths never lose identity. */
function projectionPaths(snapshot: WorkspaceSnapshot): { notes: Map<string, string>; folders: Map<string, string> } {
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
      folderPaths.set(item.id, prefix);
    }
  }
  const duplicateNames = new Map<string, number>();
  for (const note of snapshot.notes) { const key = JSON.stringify([note.folderId, safeName(note.title).toLowerCase()]); duplicateNames.set(key, (duplicateNames.get(key) ?? 0) + 1); }
  const paths = new Map<string, string>();
  for (const note of snapshot.notes) {
    let title = safeName(note.title);
    if (duplicateNames.get(JSON.stringify([note.folderId, title.toLowerCase()]))! > 1) title += `--${idSuffix(note.id)}`;
    const prefix = note.folderId === null ? '' : folderPaths.get(note.folderId);
    if (prefix === undefined) throw new Error('Note references a missing folder.');
    let path = `${prefix ? prefix + '/' : ''}${title}.md`;
    paths.set(note.id, path);
  }
  return { notes: paths, folders: folderPaths };
}
function envelope(manifest: MirrorManifest): string {
  return hostPerformance.serializeJson('projection', { format: 'grasp-manifest', version: 1, sha256: digest(hostPerformance.serializeJson('projection', manifest)), payload: manifest } satisfies Envelope, null, 2);
}
function parseManifest(bytes: Uint8Array): MirrorManifest {
  const value = hostPerformance.parseJson('projection', Buffer.from(bytes).toString('utf8')) as Envelope;
  if (value?.format !== 'grasp-manifest' || value.version !== 1 || !value.payload || !/^[a-f\d]{64}$/.test(value.sha256) || digest(hostPerformance.serializeJson('projection', value.payload)) !== value.sha256) throw new Error('Manifest metadata checksum or format is invalid.');
  const manifest = value.payload;
  if (manifest.format !== 'grasp-mirror' || manifest.version !== 1 || !['mirror', 'ai', 'projection', 'recovery'].includes(manifest.kind) || !Array.isArray(manifest.notes) || !Array.isArray(manifest.attachments) || !Array.isArray(manifest.dirtyPaths)) throw new Error('Unsupported mirror manifest.');
  return manifest;
}
function indexText(manifest: MirrorManifest, manifestFile: string, indexFile: string): string {
  const link = (file: string) => relative(dirname(indexFile), file).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
  return `# ${manifest.workspace.name.replace(/[\r\n]/g, ' ')} · r${manifest.workspace.revision}\n\n資料庫是唯一即時來源。Markdown/ 是唯一目前可讀投影；外部修改必須在 App 審查後才匯入。\n\n[重建 metadata](${link(manifestFile)}) · ${manifest.notes.length} notes · ${manifest.records.length} records · ${manifest.attachments.length} attachments\n\n` + manifest.notes.map(note => `- [${note.title.replace(/[\[\]\r\n]/g, '_')}](${link(note.file)})`).join('\n') + '\n\n## Attachments\n\n' + manifest.attachments.map(asset => `- [${asset.path.replace(/[\[\]\r\n]/g, '_')}](${link(asset.file)})`).join('\n') + '\n';
}

interface DesiredFile { file: string; sha256: string; size: number; bytes: () => Promise<Uint8Array> }
interface PublishJournal {
  format: 'grasp-publish'; version: 1; manifestPath: string; manifestSha256: string; manifestSize: number;
  workspaceId?: string; revision?: number;
  previousFolders?: string[];
  changes: Array<{ file: string; backup?: string; stage?: string; old?: { sha256: string; size: number }; next?: { sha256: string; size: number } }>;
}
const pathKey = (path: string): string => path.normalize('NFC').toLowerCase();
const collision = (path: string, occupied: Iterable<string>): boolean => {
  const key = pathKey(path);
  for (const other of occupied) if (key === other || key.startsWith(other + '/') || other.startsWith(key + '/')) return true;
  return false;
};

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
  constructor(dbPath: string, private readonly passive = false) {
    const database = resolve(dbPath);
    this.root = basename(dirname(database)).toLowerCase() === '.grasp' ? dirname(dirname(database)) : resolve(database + '.files');
    this.tree = new SafeTree(this.root, ['Markdown', '.grasp/exchange', '.grasp/internal', '.grasp/manifests', 'README.md']);
    const markdown = resolve(this.root, 'Markdown');
    this.state = { root: this.root, directories: { inbox: resolve(this.root, '.grasp/exchange/inbox'), outbox: resolve(this.root, '.grasp/exchange/outbox'), attachments: markdown, mirror: markdown, markdown, internal: resolve(this.root, '.grasp/internal'), manifests: resolve(this.root, '.grasp/manifests') },
      projection: { path: 'Markdown', absolutePath: markdown, notes: [], folders: [], attachments: [] },
      mirror: { state: 'idle', revision: null, manifestPath: null, indexPath: null, dirtyPaths: [], writtenFiles: 0, reusedFiles: 0, elapsedMs: 0 } };
  }
  status(): FilesStatus { return structuredClone(this.state); }
  private updatePaths(): void {
    this.state.projection.notes = this.current?.notes.map(note => ({ id: note.id, path: note.file })) ?? [];
    this.state.projection.folders = this.current?.folderPaths?.map(folder => ({ ...folder })) ?? [];
    this.state.projection.attachments = this.current?.attachments.map(asset => ({ id: asset.id, path: asset.file })) ?? [];
  }
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.tree.ensureRoot();
    for (const directory of ['Markdown', '.grasp/exchange/inbox', '.grasp/exchange/outbox', '.grasp/internal/objects', '.grasp/internal/manifests', '.grasp/internal/transactions', '.grasp/manifests']) await this.tree.checked(directory, true, true);
    if (this.passive) { this.initialized = true; return; }
    await this.recoverInterrupted();
    try { await this.tree.writeNew('README.md', utf8('# GraspPortable Workspace\n\n- Markdown/：唯一目前可讀取的 Markdown vault，可用 Obsidian、檔案總管或 AI 開啟；筆記及附件保留一般檔名與資料夾。\n- .grasp/：SQLite authority、重建 metadata、內部回復資料與 exchange/inbox、exchange/outbox。\n\nSQLite 是唯一即時來源。外部修改、刪除及新增檔案會標示 dirty 並暫停發佈；請在 App 審查匯入，不會靜默覆寫。Obsidian 的 .obsidian 設定目錄保留但不作為筆記資料匯入。grasp-asset: links 由 App 處理；一般相對附件路徑可由外部 viewer 使用。\n')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const candidates = (await readdir(fsPath(this.tree.absolute('.grasp/manifests')))).filter(name => /^r\d{16}-[\d-]+[a-f\d-]*\.json$/.test(name)).sort().reverse();
    if (candidates.length) {
      const name = candidates[0], file = '.grasp/manifests/' + name;
      const manifest = parseManifest(await this.tree.read(file));
      if (manifest.kind !== 'projection') throw new Error('Unexpected public projection manifest kind.');
      this.current = manifest; this.state.mirror.revision = manifest.workspace.revision; this.state.mirror.manifestPath = file;
      this.state.mirror.indexPath = file.replace(/\.json$/, '.md'); this.state.mirror.state = 'ready'; this.updatePaths();
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
      const signature = [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');
      const cached = this.verified.get(file);
      const actual = cached?.signature === signature ? cached.sha256 : digest(await this.tree.read(file));
      this.verified.set(file, { signature, sha256: actual }); return info.size === size && actual === sha256;
    } catch { return false; }
  }
  private async publicFiles(): Promise<string[]> {
    const files: string[] = [], stack = ['Markdown']; let count = 0;
    while (stack.length) {
      const directory = stack.pop()!, absolute = await this.tree.checked(directory, true);
      for (const name of await readdir(fsPath(absolute))) {
        const file = directory + '/' + name;
        if (name === '.obsidian') continue;
        if (++count > 50_000) throw new Error('Projection scan exceeds 50,000 entries.');
        try { const entry = await this.tree.entry(file); if (entry.kind === 'directory') stack.push(file); else files.push(file); }
        catch { files.push(file); }
      }
    }
    return files;
  }
  private async findDirty(desired?: Map<string, DesiredFile>): Promise<string[]> {
    const dirty = new Set<string>(), previous = [...(this.current?.notes ?? []), ...(this.current?.attachments ?? [])];
    const tracked = new Set(previous.map(file => file.file));
    for (const entry of previous) {
      if (await this.matches(entry.file, entry.sha256, entry.size)) continue;
      const next = desired?.get(entry.file);
      // Reviewed DB imports may safely adopt already-identical external bytes.
      if (next && await this.matches(entry.file, next.sha256, next.size)) continue;
      dirty.add(entry.file);
    }
    for (const folder of this.current?.folderPaths ?? []) { try { await this.tree.checked(folder.path, true); } catch { dirty.add(folder.path); } }
    for (const file of await this.publicFiles()) if (!tracked.has(file)) dirty.add(file);
    return [...dirty].sort();
  }
  async inspect(): Promise<FilesStatus> {
    await this.initialize(); if (this.running) await this.running;
    const dirtyPaths = await this.findDirty(); this.state.mirror.dirtyPaths = dirtyPaths;
    if (dirtyPaths.length) { this.state.mirror.state = 'dirty'; this.state.mirror.error = '外部檔案已變更；尚未匯入資料庫。請先審查，投影不會覆寫。'; }
    else if (this.state.mirror.state === 'dirty') { this.state.mirror.state = this.current ? 'ready' : 'idle'; delete this.state.mirror.error; }
    return this.status();
  }
  private async immutable(bytes: Uint8Array, hash: string): Promise<string> {
    const file = '.grasp/internal/objects/' + hash;
    if (await this.matches(file, hash, bytes.length)) return file;
    try { await this.tree.writeNew(file, bytes); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (!(await this.matches(file, hash, bytes.length))) throw new Error('Internal recovery payload was externally changed.'); }
    return file;
  }
  private async exists(file: string): Promise<boolean> {
    try { await this.tree.checked(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
  private async recoverInterrupted(): Promise<void> {
    const publishedNames = (await readdir(fsPath(this.tree.absolute('.grasp/manifests')))).filter(name => /^r\d{16}-[\d-]+[a-f\d-]*\.json$/.test(name)).sort().reverse();
    const latestPath = publishedNames[0] ? '.grasp/manifests/' + publishedNames[0] : undefined;
    const latest = latestPath ? parseManifest(await this.tree.read(latestPath)) : undefined;
    for (const name of await readdir(fsPath(this.tree.absolute('.grasp/internal/transactions')))) {
      const transaction = '.grasp/internal/transactions/' + name;
      const journalPath = transaction + '/journal.json';
      if (!(await this.exists(journalPath)) || await this.exists(transaction + '/rolled-back.json')) continue;
      const journal = hostPerformance.parseJson('projection', (await this.tree.read(journalPath)).toString('utf8')) as PublishJournal;
      if (journal?.format !== 'grasp-publish' || journal.version !== 1 || !journal.manifestPath?.startsWith('.grasp/manifests/') || !Array.isArray(journal.changes)) throw new Error('Invalid pending projection journal: ' + transaction);
      if (await this.matches(journal.manifestPath, journal.manifestSha256, journal.manifestSize)) continue;
      // A reviewed edit/retry can publish a later complete snapshot after a
      // failed transaction. Never roll that newer successful state backwards.
      if (latest?.kind === 'projection' && latest.workspace.id === journal.workspaceId && latestPath! > journal.manifestPath && latest.workspace.revision >= journal.revision!) continue;
      await this.restoreJournal(journal, transaction);
    }
  }
  private async restoreJournal(journal: PublishJournal, transaction: string): Promise<void> {
    const conflicts: string[] = [];
    // First remove only known installed bytes, then restore old paths. Separate
    // phases also handle a filename becoming a directory (or the reverse).
    for (let i = journal.changes.length - 1; i >= 0; i--) {
      const change = journal.changes[i];
      if (!change.file.startsWith('Markdown/') || (change.backup && !change.backup.startsWith(transaction + '/')) || (change.stage && !change.stage.startsWith(transaction + '/'))) throw new Error('Unsafe projection journal paths.');
      let entry: FileEntry;
      try { entry = await this.tree.entry(change.file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      if (entry.kind === 'file') {
        const original = change.old && await this.matches(change.file, change.old.sha256, change.old.size);
        if (original) continue;
        const installed = change.next && await this.matches(change.file, change.next.sha256, change.next.size);
        if (!installed) { conflicts.push(change.file); continue; }
        await this.tree.moveTo(change.file, transaction + '/rollback-' + i + '-' + randomUUID());
      }
    }
    for (const change of journal.changes) if (change.old) {
      if (await this.matches(change.file, change.old.sha256, change.old.size)) continue;
      if (!change.backup || !(await this.exists(change.backup))) { conflicts.push(change.file); continue; }
      try {
        try { const entry = await this.tree.entry(change.file); if (entry.kind === 'directory') await rmdir(fsPath(entry.absolutePath)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await this.tree.install(change.backup, change.file);
      } catch { conflicts.push(change.file); }
    }
    for (const folder of journal.previousFolders ?? []) {
      if (!folder.startsWith('Markdown/')) throw new Error('Unsafe projection journal folder.');
      try { await this.tree.checked(folder, true, true); } catch { conflicts.push(folder); }
    }
    if (conflicts.length) throw new Error('Interrupted projection preserved external edits and recovery files in ' + transaction + '; manual review required: ' + conflicts.join(', '));
    await this.tree.writeNew(transaction + '/rolled-back.json', utf8(JSON.stringify({ restoredAt: new Date().toISOString() })));
  }
  private async project(snapshot: WorkspaceSnapshot, readBlob: BlobReader): Promise<void> {
    const started = performance.now(); await this.initialize();
    if (this.current && this.current.workspace.id !== snapshot.id) throw new Error('File root belongs to a different workspace.');
    if (this.current && this.current.workspace.revision > snapshot.revision) throw new Error('Refusing to publish an older database revision over a newer mirror.');
    const paths = projectionPaths(snapshot), occupied = new Set<string>(), desired = new Map<string, DesiredFile>();
    const directories = new Set([...paths.folders.values()].map(path => pathKey('Markdown/' + path)));
    const notes: ProjectedNote[] = snapshot.notes.map(note => {
      const { markdown, ...metadata } = note; let file = 'Markdown/' + paths.notes.get(note.id)!;
      if (directories.has(pathKey(file)) || collision(file, occupied)) file = file.replace(/\.md$/, '--' + idSuffix(note.id) + '.md');
      if (directories.has(pathKey(file)) || collision(file, occupied)) throw new Error('Projected note paths collide.');
      occupied.add(pathKey(file)); const bytes = utf8(markdown), sha256 = digest(bytes);
      desired.set(file, { file, sha256, size: bytes.length, bytes: async () => bytes }); return { ...metadata, file, sha256, size: bytes.length };
    });
    const attachments: ProjectedAsset[] = snapshot.attachments.map(asset => {
      let file = 'Markdown/' + asset.path;
      try { validateRelative(file); if (directories.has(pathKey(file)) || collision(file, occupied)) throw new Error('collision'); }
      catch { file = 'Markdown/_attachments/' + idSuffix(asset.id) + '/' + safeName(asset.name); }
      if (directories.has(pathKey(file)) || collision(file, occupied)) throw new Error('Projected attachment paths collide.');
      occupied.add(pathKey(file));
      desired.set(file, { file, sha256: asset.sha256, size: asset.size, bytes: async () => {
        const bytes = await readBlob(asset.sha256);
        if (bytes.length !== asset.size || digest(bytes) !== asset.sha256) throw new Error('Attachment DB bytes do not match metadata: ' + asset.id);
        return bytes;
      } }); return { ...asset, file };
    });
    const dirtyPaths = await this.findDirty(desired);
    if (dirtyPaths.length) { this.state.mirror = { ...this.state.mirror, state: 'dirty', dirtyPaths, writtenFiles: 0, reusedFiles: 0, elapsedMs: performance.now() - started, error: '外部變更尚未審查；保留目前 Markdown 檔案，未發佈新的投影。' }; return; }
    const manifest: MirrorManifest = { format: 'grasp-mirror', version: 1, kind: 'projection', createdAt: new Date().toISOString(), workspace: { id: snapshot.id, name: snapshot.name, revision: snapshot.revision, settings: snapshot.settings }, notes, folders: snapshot.folders, records: snapshot.records, attachments, folderPaths: [...paths.folders].map(([id, path]) => ({ id, path: 'Markdown/' + path })), dirtyPaths: [] };
    if (this.current && this.current.workspace.revision === snapshot.revision && hostPerformance.serializeJson('projection', { ...manifest, createdAt: '' }) === hostPerformance.serializeJson('projection', { ...this.current, createdAt: '' })) {
      this.state.mirror.state = 'ready'; this.state.mirror.dirtyPaths = []; delete this.state.mirror.error; return;
    }
    const version = revisionName(snapshot.revision), transaction = '.grasp/internal/transactions/' + version;
    const previous = new Map([...(this.current?.notes ?? []), ...(this.current?.attachments ?? [])].map(entry => [entry.file, entry]));
    const stages = new Map<string, string>(), recovery = new Map<string, string>(); let written = 0, reused = 0;
    // Stage all DB bytes and immutable recovery before touching public filenames.
    for (const entry of desired.values()) {
      const same = await this.matches(entry.file, entry.sha256, entry.size), object = '.grasp/internal/objects/' + entry.sha256;
      if (same && await this.matches(object, entry.sha256, entry.size)) { recovery.set(entry.file, object); reused++; continue; }
      const bytes = await entry.bytes();
      recovery.set(entry.file, await this.immutable(bytes, entry.sha256));
      if (same) { reused++; continue; }
      const stage = transaction + '/new-' + stages.size; await this.tree.writeNew(stage, bytes); stages.set(entry.file, stage); written++;
    }
    const recoveryManifest: MirrorManifest = { ...manifest, kind: 'recovery', notes: notes.map(note => ({ ...note, file: recovery.get(note.file)! })), attachments: attachments.map(asset => ({ ...asset, file: recovery.get(asset.file)! })) };
    await this.tree.writeNew('.grasp/internal/manifests/' + version + '.json', utf8(envelope(recoveryManifest)));
    const secondCheck = await this.findDirty(desired);
    if (secondCheck.length) { this.state.mirror.state = 'dirty'; this.state.mirror.dirtyPaths = secondCheck; this.state.mirror.error = '檔案在發佈前改變；未覆寫，請重新審查。'; return; }
    const changedPaths = [...new Set([...stages.keys(), ...[...previous.keys()].filter(file => !desired.has(file))])];
    const manifestPath = '.grasp/manifests/' + version + '.json', indexPath = manifestPath.replace(/\.json$/, '.md');
    const metadataBytes = utf8(envelope(manifest)); if (metadataBytes.length > MAX_FILE) throw new Error('Mirror metadata exceeds the supported rebuild limit.');
    // Complete metadata files before public mutations. Only atomic install may
    // publish a discoverable manifest; partial writes stay internal.
    await this.tree.writeNew(transaction + '/manifest.json', metadataBytes);
    await this.tree.writeNew(transaction + '/index.md', utf8(indexText(manifest, manifestPath, indexPath)));
    const journal: PublishJournal = { format: 'grasp-publish', version: 1, manifestPath, manifestSha256: digest(metadataBytes), manifestSize: metadataBytes.length, workspaceId: snapshot.id, revision: snapshot.revision, previousFolders: this.current?.folderPaths?.map(folder => folder.path) ?? [],
      changes: changedPaths.map((file, i) => { const old = previous.get(file), next = desired.get(file); return { file, ...(old ? { backup: transaction + '/old-' + i, old: { sha256: old.sha256, size: old.size } } : {}), ...(stages.has(file) ? { stage: stages.get(file)!, next: { sha256: next!.sha256, size: next!.size } } : {}) }; }) };
    await this.tree.writeNew(transaction + '/staged-journal.json', utf8(hostPerformance.serializeJson('projection', journal)));
    await this.tree.install(transaction + '/staged-journal.json', transaction + '/journal.json');
    try {
      for (const change of journal.changes) {
        const file = change.file, old = previous.get(file);
        if (old) {
          if (!(await this.matches(file, old.sha256, old.size))) throw new Error('External edit raced projection publication: ' + file);
          const backup = change.backup!; await this.tree.moveTo(file, backup);
          if (!(await this.matches(backup, old.sha256, old.size))) throw new Error('External edit raced projection publication: ' + file);
        }
      }
      // Moving every former filename first also supports a former note path
      // becoming a logical directory, without order-dependent failures.
      for (const folder of journal.previousFolders ?? []) if (desired.has(folder)) await rmdir(fsPath(await this.tree.checked(folder, true)));
      for (const change of journal.changes) if (change.stage) await this.tree.install(change.stage, change.file);
      for (const folder of manifest.folderPaths!) await this.tree.checked(folder.path, true, true);
      for (const entry of desired.values()) if (!(await this.matches(entry.file, entry.sha256, entry.size))) throw new Error('External edit raced final projection validation: ' + entry.file);
      for (const change of journal.changes) if (change.backup && change.old && !(await this.matches(change.backup, change.old.sha256, change.old.size))) throw new Error('External write continued during projection: ' + change.file);
      await this.tree.install(transaction + '/index.md', indexPath);
      await this.tree.install(transaction + '/manifest.json', manifestPath);
      this.current = manifest; this.updatePaths();
      this.state.mirror = { state: 'ready', revision: snapshot.revision, manifestPath, indexPath, dirtyPaths: [], writtenFiles: written, reusedFiles: reused, elapsedMs: performance.now() - started };
    } catch (error) { await this.restoreJournal(journal, transaction); throw new Error(errorMessage(error) + '; publication rolled back, preserved recovery files: ' + transaction); }
    const keep = new Set(manifest.folderPaths!.map(folder => folder.path));
    for (const file of previous.keys()) { let directory = file.slice(0, file.lastIndexOf('/')); while (directory !== 'Markdown') {
      if (keep.has(directory)) break;
      try { await rmdir(fsPath(await this.tree.checked(directory, true))); } catch { break; }
      directory = directory.slice(0, directory.lastIndexOf('/'));
    } }
  }
  async directoryPath(path = ''): Promise<string> { await this.initialize(); return this.tree.checked(path, true); }
  async revealPath(path: string): Promise<FileEntry> { await this.initialize(); return this.tree.entry(path); }
  async locate(kind: 'note' | 'folder' | 'attachment', id: string): Promise<FileEntry> {
    await this.initialize(); await this.flush(); const entries = kind === 'note' ? this.state.projection.notes : kind === 'folder' ? this.state.projection.folders : this.state.projection.attachments;
    const entry = entries.find(entry => entry.id === id); if (!entry) throw new Error('Entity has no published file mapping.'); return this.revealPath(entry.path);
  }
  async reviewExternalNote(path: string, snapshot: WorkspaceSnapshot): Promise<ExternalNoteReview> {
    await this.initialize(); await this.flush(); const baseline = this.current?.notes.find(note => note.file === path);
    if (!baseline || this.current!.workspace.id !== snapshot.id) throw new Error('File is not an identified note in this workspace projection.');
    const note = snapshot.notes.find(note => note.id === baseline.id);
    if (!note || note.revision !== baseline.revision || digest(utf8(note.markdown)) !== baseline.sha256) throw new Error('Database note changed after projection; compare the simultaneous edits before importing.');
    const bytes = await this.tree.read(path, MAX_MARKDOWN_CHARACTERS * 3), markdown = bytes.toString('utf8');
    if (!utf8(markdown).equals(bytes) || markdown.includes('\0') || markdown.length > MAX_MARKDOWN_CHARACTERS) throw new Error('External note is not valid supported UTF-8 Markdown.');
    return { path, noteId: note.id, workspaceId: snapshot.id, workspaceRevision: snapshot.revision, noteRevision: note.revision, baselineSha256: baseline.sha256, sha256: digest(bytes), markdown };
  }
  async list(directory = ''): Promise<FileEntry[]> {
    await this.initialize(); const path = await this.tree.checked(directory, true), names = await readdir(fsPath(path));
    if (names.length > 10_000) throw new Error('Directory listing exceeds 10,000 entries; select a narrower directory.');
    const entries: FileEntry[] = [];
    for (const name of names.sort()) { try { entries.push(await this.tree.entry(directory ? directory + '/' + name : name)); } catch { /* Do not advertise untrusted files or the live DB. */ } } return entries;
  }
  async read(path: string, maxBytes = MAX_FILE): Promise<{ bytes: Uint8Array; name: string; mimeType: string }> { await this.initialize(); return { bytes: await this.tree.read(path, maxBytes), name: basename(path), mimeType: mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream' }; }
  async saveInbox(name: string, bytes: Uint8Array): Promise<FileEntry> {
    await this.initialize(); if (bytes.length > 32 * 1024 * 1024 || !/\.(md|markdown|txt)$/i.test(name)) throw new Error('Inbox accepts Markdown/text up to 32 MiB.');
    const file = '.grasp/exchange/inbox/' + Date.now() + '-' + randomUUID() + '-' + safeName(name); await this.tree.writeNew(file, bytes); return this.tree.entry(file);
  }
  async saveExchange(snapshot: WorkspaceSnapshot, markdown: string): Promise<FileEntry> {
    await this.initialize(); const file = '.grasp/exchange/outbox/' + revisionName(snapshot.revision) + '-' + safeName(snapshot.name) + '.grasp.md';
    await this.tree.writeNew(file, utf8(markdown)); return this.tree.entry(file);
  }
  async buildAiFolder(snapshot: WorkspaceSnapshot, readBlob: BlobReader): Promise<FileExportResult> {
    this.schedule(snapshot, readBlob); const status = await this.flush();
    if (status.mirror.state !== 'ready' || status.mirror.revision !== snapshot.revision) throw new Error(status.mirror.error ?? 'Current readable projection is unavailable.');
    return { path: 'Markdown', absolutePath: status.directories.markdown, manifestPath: status.mirror.manifestPath!, indexPath: status.mirror.indexPath!, files: this.current!.notes.length + this.current!.attachments.length, bytes: [...this.current!.notes, ...this.current!.attachments].reduce((sum, file) => sum + file.size, 0) };
  }
}


/** Read-only validation for disaster recovery. The caller must create a NEW database. */
export async function readMirrorManifest(manifestAbsolutePath: string): Promise<RebuildData> {
  const manifestPath = resolve(manifestAbsolutePath);
  const parent = dirname(manifestPath);
  const mirror = basename(parent) === 'manifests' && basename(dirname(parent)) === 'mirror';
  const projection = basename(parent) === 'manifests' && basename(dirname(parent)) === '.grasp';
  const recovery = basename(parent) === 'manifests' && basename(dirname(parent)) === 'internal' && basename(dirname(dirname(parent))) === '.grasp';
  if (!mirror && !projection && !recovery && basename(manifestPath) !== 'grasp-manifest.json') throw new Error('Select a published projection/recovery manifest or legacy grasp-manifest.json.');
  const root = recovery ? dirname(dirname(dirname(parent))) : mirror || projection ? dirname(dirname(parent)) : parent;
  const tree = new SafeTree(root, projection ? ['Markdown', '.grasp/manifests'] : recovery ? ['.grasp/internal'] : mirror ? ['mirror', 'attachments'] : ['notes', 'attachments', 'grasp-manifest.json'], false);
  const localManifest = relative(root, manifestPath).replace(/\\/g, '/');
  const manifest = parseManifest(await tree.read(localManifest));
  if (manifest.kind !== (projection ? 'projection' : recovery ? 'recovery' : mirror ? 'mirror' : 'ai')) throw new Error('Manifest kind does not match its containing layout.');
  const notes: Note[] = [], attachments: Attachment[] = [], blobs = new Map<string, Uint8Array>();
  const usedPaths = new Set<string>();
  for (const entry of manifest.notes) {
    if (!entry || typeof entry.file !== 'string' || !/^[a-f\d]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Invalid note file metadata.');
    if (!(projection ? entry.file.startsWith('Markdown/') : recovery ? entry.file.startsWith('.grasp/internal/objects/') : mirror ? entry.file.startsWith('mirror/notes/') : entry.file.startsWith('notes/'))) throw new Error('Note file is outside its designated area.');
    const pathKey = entry.file.normalize('NFC').toLowerCase(); if (!recovery && usedPaths.has(pathKey)) throw new Error('Duplicate projected file path.'); usedPaths.add(pathKey);
    // SQLite's source limit counts UTF-16 code units; each can occupy up to
    // three UTF-8 bytes. validateSnapshot below enforces the original limit.
    const bytes = await tree.read(entry.file, MAX_MARKDOWN_CHARACTERS * 3);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error(`Note hash mismatch: ${entry.id}`);
    const markdown = bytes.toString('utf8'); if (!utf8(markdown).equals(bytes)) throw new Error('Note is not valid UTF-8.');
    const { file: _file, sha256: _sha, size: _size, ...metadata } = entry; notes.push({ ...metadata, markdown });
  }
  for (const entry of manifest.attachments) {
    if (!entry || typeof entry.file !== 'string' || !(projection ? entry.file.startsWith('Markdown/') : recovery ? entry.file.startsWith('.grasp/internal/objects/') : entry.file.startsWith('attachments/') || (!mirror && entry.file.startsWith('notes/'))) || !/^[a-f\d]{64}$/.test(entry.sha256)) throw new Error('Invalid attachment file metadata.');
    const pathKey = entry.file.normalize('NFC').toLowerCase(); if (!recovery && usedPaths.has(pathKey)) throw new Error('Duplicate projected file path.'); usedPaths.add(pathKey);
    const bytes = await tree.read(entry.file, 64 * 1024 * 1024);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error(`Attachment hash mismatch: ${entry.id}`);
    blobs.set(entry.sha256, bytes); const { file: _file, ...metadata } = entry; attachments.push(metadata);
  }
  if (projection) {
    const stack = ['Markdown']; let count = 0;
    while (stack.length) {
      const directory = stack.pop()!, absolute = await tree.checked(directory, true);
      for (const name of await readdir(fsPath(absolute))) {
        if (name === '.obsidian') continue;
        if (++count > 50_000) throw new Error('Projection scan exceeds 50,000 entries.');
        const file = directory + '/' + name, entry = await tree.entry(file);
        if (entry.kind === 'directory') stack.push(file);
        else if (!usedPaths.has(pathKey(file))) throw new Error('Unreviewed external file is not represented by this manifest: ' + file);
      }
    }
  }
  const snapshot = validateSnapshot({ ...manifest.workspace, notes, folders: manifest.folders, records: manifest.records, attachments });
  return { snapshot, blobs: [...blobs].map(([sha256, bytes]) => ({ sha256, bytes })) };
}
