import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep, toNamespacedPath } from 'node:path';
import { buildLinkIndex, type LinkStatus } from '../src/domain/links.js';
import type { Attachment, Folder, Note, WorkspaceSnapshot } from '../src/domain/model.js';
import { normalizeAttachmentPath, validateSnapshot, WorkspaceStore } from './store.js';

export class MigrationError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'MigrationError'; } }
export interface VaultSourceFile { path: string; kind: 'note' | 'asset'; id: string; sha256: string; size: number; mtimeMs: number }
export interface VaultReport {
  format: 'grasp-vault-migration'; version: 1; createdAt: string; sourceFingerprint: string;
  counts: { notes: number; folders: number; attachments: number; bytes: number; excludedDirectories: number };
  files: VaultSourceFile[]; directories: string[]; excludedDirectories: string[];
  unsupported: Array<{ path: string; kind: 'mermaid' | 'math' | 'excalidraw' | 'obsidian-base' | 'download-only-asset' }>;
  links: Record<LinkStatus | 'total', number>;
  linkIssues: Array<{ noteId: string; from: number; to: number; target: string; status: LinkStatus; candidates?: string[] }>;
  limitations: string[];
}
export interface VaultPlan { sourceRoot: string; snapshot: WorkspaceSnapshot; blobs: Array<{ sha256: string; bytes: Uint8Array }>; report: VaultReport }
interface ScannedFile extends VaultSourceFile { bytes?: Buffer }
interface Inventory { sourceRoot: string; files: ScannedFile[]; directories: string[]; excludedDirectories: string[]; fingerprint: string }
const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const stableId = (kind: string, path: string): string => `${kind}-${hash(`${kind}\0${path}`)}`;
const native = (path: string): string => toNamespacedPath(path);
const excluded = new Set(['.obsidian', '.git', '.codex', '.agents', 'node_modules']);
const executable = /\.(?:exe|com|dll|msi|bat|cmd|ps1|psm1|vbs|vbe|js|mjs|cjs|ts|py|pyc|sh|bash|zsh|jar|wasm|lnk|url|reg)$/i;
const mimeTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json', '.base': 'application/json', '.excalidraw': 'application/json', '.txt': 'text/plain' };

function inside(root: string, path: string): boolean {
  const result = relative(root, path); return result === '' || (result !== '..' && !result.startsWith(`..${sep}`) && !isAbsolute(result));
}
function sourcePath(root: string, path: string): string {
  if (path.includes('\\') || path.length > 4000) throw new MigrationError('unsafe-path', 'Source contains an unsupported path.');
  try { if (normalizeAttachmentPath(path) !== path) throw new Error(); }
  catch { throw new MigrationError('unsafe-path', 'Source contains an unsafe, reserved, or non-portable path.'); }
  const full = resolve(root, path); if (!inside(root, full)) throw new MigrationError('unsafe-path', 'Source path escapes the selected root.');
  return full;
}
async function inventory(sourceRoot: string, includeBytes: boolean): Promise<Inventory> {
  try {
    const requested = resolve(sourceRoot), rootInfo = await lstat(native(requested));
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new MigrationError('source-root', 'Source must be a real directory, not a symlink.');
    const root = await realpath(native(requested));
    const directories: string[] = [], excludedDirectories: string[] = [], candidates: string[] = [], stack = [''];
    while (stack.length) {
      const current = stack.pop()!;
      const directory = current ? sourcePath(root, current) : root;
      const info = await lstat(native(directory));
      if (info.isSymbolicLink() || !info.isDirectory() || !inside(root, await realpath(native(directory)))) throw new MigrationError('symlink', 'Source contains a symlink or changed directory.');
      for (const name of (await readdir(native(directory))).sort()) {
        const path = current ? `${current}/${name}` : name, full = sourcePath(root, path), entry = await lstat(native(full));
        if (entry.isSymbolicLink()) throw new MigrationError('symlink', 'Source contains a symlink; nothing was imported.');
        if (entry.isDirectory()) {
          if (excluded.has(name.toLowerCase())) excludedDirectories.push(path);
          else { directories.push(path); stack.push(path); }
        } else if (entry.isFile()) {
          if (executable.test(name) || name === '.env' || /^(?:package(?:-lock)?\.json|tsconfig\.json)$/i.test(name)) throw new MigrationError('executable', 'Executable or tool configuration files outside excluded directories are not migration input.');
          candidates.push(path);
        } else throw new MigrationError('special-file', 'Source contains a non-regular file.');
        if (candidates.length + directories.length > 20_000) throw new MigrationError('limit', 'Migration preview is bounded to 20,000 included filesystem entries.');
      }
    }
    const files: ScannedFile[] = []; let total = 0;
    for (const path of candidates.sort()) {
      const full = sourcePath(root, path), kind = /\.md$/i.test(path) ? 'note' : 'asset';
      if (!inside(root, await realpath(native(full)))) throw new MigrationError('symlink', 'A source path changed outside the selected root.');
      const handle = await open(native(full), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > (kind === 'note' ? 10 : 64) * 1024 * 1024) throw new MigrationError('limit', 'Source exceeds the per-file migration limit (10 MiB Markdown / 64 MiB asset).');
        total += before.size; if (total > 512 * 1024 * 1024) throw new MigrationError('limit', 'This bounded preview accepts at most 512 MiB of included source files.');
        const bytes = await handle.readFile(), after = await handle.stat(), pathInfo = await lstat(native(full));
        if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || pathInfo.isSymbolicLink() || pathInfo.ino !== before.ino || !inside(root, await realpath(native(full)))) throw new MigrationError('source-changed', 'Source changed while being read; create a stable scratch copy before retrying.');
        if (kind === 'note') {
          const text = bytes.toString('utf8');
          if (!Buffer.from(text, 'utf8').equals(bytes) || text.includes('\0')) throw new MigrationError('encoding', 'Markdown must be valid UTF-8 without NUL; source bytes were not changed.');
        }
        files.push({ path, kind, id: stableId(kind, path), sha256: hash(bytes), size: bytes.length, mtimeMs: before.mtimeMs, ...(includeBytes ? { bytes } : {}) });
      } finally { await handle.close(); }
    }
    directories.sort(); excludedDirectories.sort();
    const fingerprint = hash(JSON.stringify({ files: files.map(({ path, kind, sha256, size }) => ({ path, kind, sha256, size })), directories, excludedDirectories }));
    return { sourceRoot: root, files, directories, excludedDirectories, fingerprint };
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    // Native filesystem errors may contain private titles. Keep terminal errors aggregate-only.
    throw new MigrationError('read-failed', 'Source could not be read safely; no import was performed.');
  }
}

/** Read-only, deterministic mapping of a copied Markdown vault. No plugin/config code is loaded. */
export async function planVault(sourceRoot: string): Promise<VaultPlan> {
  const scan = await inventory(sourceRoot, true);
  const folders: Folder[] = scan.directories.map(path => ({ id: stableId('folder', path), name: path.split('/').at(-1)!, parentId: path.includes('/') ? stableId('folder', path.slice(0, path.lastIndexOf('/'))) : null, revision: 1 }));
  const notes: Note[] = [], attachments: Attachment[] = [], blobs = new Map<string, Uint8Array>();
  const unsupported: VaultReport['unsupported'] = [];
  for (const file of scan.files) {
    if (file.kind === 'note') {
      const markdown = file.bytes!.toString('utf8');
        notes.push({ id: file.id, title: basename(file.path).slice(0, -3), markdown, syntaxVersion: 'legacy-v0.2', folderId: file.path.includes('/') ? stableId('folder', file.path.slice(0, file.path.lastIndexOf('/'))) : null, revision: 1, updatedAt: new Date(file.mtimeMs).toISOString() });
      if (/\.excalidraw\.md$/i.test(file.path) || /^excalidraw-plugin\s*:/m.test(markdown)) unsupported.push({ path: file.path, kind: 'excalidraw' });
      if (/^[ \t>]*(?:`{3,}|~{3,})[ \t]*mermaid\b/m.test(markdown)) unsupported.push({ path: file.path, kind: 'mermaid' });
      if (/(?:^|[^\\])\$\$?[\s\S]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(markdown)) unsupported.push({ path: file.path, kind: 'math' });
    } else {
      const extension = extname(file.path).toLowerCase();
      attachments.push({ id: file.id, name: basename(file.path), path: file.path, mimeType: mimeTypes[extension] ?? 'application/octet-stream', sha256: file.sha256, size: file.size, revision: 1, createdAt: new Date(file.mtimeMs).toISOString() });
      blobs.set(file.sha256, file.bytes!);
      if (extension === '.base') unsupported.push({ path: file.path, kind: 'obsidian-base' });
      else if (extension === '.excalidraw') unsupported.push({ path: file.path, kind: 'excalidraw' });
      else if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) unsupported.push({ path: file.path, kind: 'download-only-asset' });
    }
  }
  let snapshot: WorkspaceSnapshot;
  try {
    snapshot = validateSnapshot({ id: `vault-${scan.fingerprint}`, name: 'Imported Markdown Vault', revision: 1, notes, folders, attachments, records: [], settings: { 'migration.format': 'markdown-vault-v1', 'migration.fingerprint': scan.fingerprint, 'migration.files': String(scan.files.length) } });
    if (snapshot.notes.some((note, i) => note.title !== notes[i].title) || snapshot.folders.some((folder, i) => folder.name !== folders[i].name)) throw new Error('Name normalization would lose source identity.');
  } catch { throw new MigrationError('unsupported-structure', 'Source names/hierarchy are not losslessly representable in this workspace (including name normalization or case collisions); no content was imported.'); }
  const index = buildLinkIndex(snapshot.notes, snapshot.folders, snapshot.attachments.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mimeType })));
  const links: VaultReport['links'] = { total: index.links.length, resolved: 0, missing: 0, ambiguous: 0, external: 0, unsafe: 0, unsupported: 0 };
  for (const link of index.links) links[link.status]++;
  const report: VaultReport = {
    format: 'grasp-vault-migration', version: 1, createdAt: new Date().toISOString(), sourceFingerprint: scan.fingerprint,
    counts: { notes: notes.length, folders: folders.length, attachments: attachments.length, bytes: scan.files.reduce((total, file) => total + file.size, 0), excludedDirectories: scan.excludedDirectories.length },
    files: scan.files.map(({ bytes: _bytes, ...file }) => file), directories: scan.directories, excludedDirectories: scan.excludedDirectories, unsupported, links,
    linkIssues: index.links.filter(link => !['resolved', 'external'].includes(link.status)).map(link => ({ noteId: link.location.noteId, from: link.location.from, to: link.location.to, target: link.target, status: link.status, ...(link.candidates ? { candidates: link.candidates.map(candidate => candidate.path) } : {}) })),
    limitations: ['Raw UTF-8 Markdown, BOM, frontmatter and line endings are preserved; frontmatter is not converted into records.', 'Plugin/tool configuration directories are excluded without loading their contents. Loose executable/tool configuration files are rejected.', 'Unsupported feature detection is static and bounded; it does not claim plugin or Obsidian rendering compatibility.', 'Note links are evaluated by the current Grasp resolver; unresolved/ambiguous links are retained without guesses or source rewriting.', 'The migration manifest covers included files and directory names; excluded directory contents are outside this preview.', 'Limits: 20,000 included filesystem entries, 512 MiB aggregate, 10 MiB per Markdown file, 64 MiB per asset.'],
  };
  return { sourceRoot: scan.sourceRoot, snapshot, blobs: [...blobs].map(([sha256, bytes]) => ({ sha256, bytes })), report };
}

async function outputPath(sourceRoot: string, target: string): Promise<string> {
  const full = resolve(target); let existing = full; const missing: string[] = [];
  for (;;) {
    try { await lstat(native(existing)); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new MigrationError('output-path', 'Output path could not be verified.'); const parent = dirname(existing); if (parent === existing) throw new MigrationError('output-path', 'Output path has no existing ancestor.'); missing.unshift(basename(existing)); existing = parent; }
  }
  const actual = resolve(await realpath(native(existing)), ...missing);
  if (inside(sourceRoot, actual)) throw new MigrationError('output-source', 'Output must be outside the source tree; no source files may be created or changed.');
  return full;
}

/** Recheck the source immediately before exclusively creating a new authoritative database. */
export async function applyVault(plan: VaultPlan, newDbPath: string): Promise<{ snapshot: WorkspaceSnapshot; databasePath: string }> {
  const databasePath = await outputPath(plan.sourceRoot, newDbPath);
  const scan = await inventory(plan.sourceRoot, false);
  if (scan.fingerprint !== plan.report.sourceFingerprint || JSON.stringify(scan.files) !== JSON.stringify(plan.report.files)) throw new MigrationError('source-changed', 'Source differs from the reviewed preview; regenerate the plan before applying.');
  // Validate that a caller has not accidentally changed the reviewed Markdown or asset payload.
  const notes = new Map(plan.snapshot.notes.map(note => [note.id, note]));
  const assets = new Map(plan.snapshot.attachments.map(asset => [asset.id, asset]));
  if (notes.size !== plan.report.counts.notes || assets.size !== plan.report.counts.attachments) throw new MigrationError('plan-changed', 'Preview entity counts changed.');
  for (const file of plan.report.files) {
    if (file.kind === 'note') { const note = notes.get(file.id); if (!note || hash(Buffer.from(note.markdown, 'utf8')) !== file.sha256) throw new MigrationError('plan-changed', 'Preview Markdown changed; no database was created.'); }
    else { const asset = assets.get(file.id); if (!asset || asset.sha256 !== file.sha256 || asset.path !== file.path) throw new MigrationError('plan-changed', 'Preview attachment mapping changed.'); }
  }
  try {
    const store = WorkspaceStore.rebuild(databasePath, plan.snapshot, plan.blobs);
    try { return { snapshot: store.snapshot(), databasePath }; } finally { store.close(); }
  } catch { throw new MigrationError('apply-failed', 'New database creation failed (existing target, invalid payload, or filesystem failure). The source was not changed.'); }
}

/** Reports contain private source paths; callers must use an ignored/private output directory. */
export async function writeVaultReport(plan: VaultPlan, outputDirectory: string): Promise<string> {
  const directory = await outputPath(plan.sourceRoot, outputDirectory);
  await mkdir(native(directory), { recursive: true });
  const file = resolve(directory, `migration-preview-${Date.now()}-${randomUUID()}.json`);
  const handle = await open(native(file), 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(plan.report, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
  return file;
}
