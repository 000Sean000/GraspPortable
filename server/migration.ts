import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, realpath, rename, statfs, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep, toNamespacedPath } from 'node:path';
import { canonicalPayload } from './semantic.js';
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
  memory: { chunkBytes: number; markdownBytes: number; maxMarkdownBytes: number; retainedAssetBytes: 0 };
}
/** Asset bodies are deliberately absent; the reviewed source manifest locates them. */
export interface VaultPlan { sourceRoot: string; snapshot: WorkspaceSnapshot; report: VaultReport }
interface ScannedFile extends VaultSourceFile { markdown?: string }
interface Inventory { sourceRoot: string; files: ScannedFile[]; directories: string[]; excludedDirectories: string[]; fingerprint: string }
export const MIGRATION_LIMITS = { chunkBytes: 1024 * 1024, markdownBytes: 128 * 1024 * 1024, noteBytes: 10 * 1024 * 1024, assetBytes: 64 * 1024 * 1024, entries: 20_000 } as const;
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
async function checkedSource(root: string, path: string): Promise<string> {
  const full = sourcePath(root, path); let cursor = root;
  for (const component of path.split('/')) {
    cursor = resolve(cursor, component); const info = await lstat(native(cursor));
    if (info.isSymbolicLink()) throw new MigrationError('symlink', 'A source or checkpoint path became a symlink; nothing was published.');
  }
  if (!inside(root, await realpath(native(full)))) throw new MigrationError('symlink', 'A source path escaped its selected root.');
  return full;
}
/** One reusable read buffer; only Markdown content is retained during preview. */
async function readStable(root: string, path: string, kind: 'note' | 'asset', retainMarkdown = false, output?: FileHandle,
  maxBytes: number = kind === 'note' ? MIGRATION_LIMITS.noteBytes : MIGRATION_LIMITS.assetBytes): Promise<ScannedFile> {
  const full = await checkedSource(root, path), handle = await open(native(full), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) throw new MigrationError('limit', 'Source exceeds the per-file migration limit (10 MiB Markdown / 64 MiB asset).');
    const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(MIGRATION_LIMITS.chunkBytes), parts: Buffer[] = [];
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > before.size) throw new MigrationError('source-changed', 'Source grew while it was being read.');
      const chunk = buffer.subarray(0, bytesRead); digest.update(chunk);
      if (kind === 'note' && retainMarkdown) parts.push(Buffer.from(chunk));
      if (output) {
        let written = 0;
        while (written < bytesRead) { const result = await output.write(chunk, written, bytesRead - written, null); if (!result.bytesWritten) throw new Error('No copy progress'); written += result.bytesWritten; }
      }
    }
    const after = await handle.stat(), current = await lstat(native(await checkedSource(root, path)));
    if (size !== before.size || after.size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.ino !== before.ino
      || current.size !== before.size || current.mtimeMs !== before.mtimeMs) throw new MigrationError('source-changed', 'Source changed while being read; use a stable copy before retrying.');
    let markdown: string | undefined;
    if (kind === 'note' && retainMarkdown) {
      const bytes = Buffer.concat(parts); markdown = bytes.toString('utf8');
      if (!Buffer.from(markdown, 'utf8').equals(bytes) || markdown.includes('\0')) throw new MigrationError('encoding', 'Markdown must be valid UTF-8 without NUL; source bytes were not changed.');
    }
    return { path, kind, id: stableId(kind, path), sha256: digest.digest('hex'), size, mtimeMs: before.mtimeMs, ...(markdown === undefined ? {} : { markdown }) };
  } finally { await handle.close(); }
}
async function inventory(sourceRoot: string, retainMarkdown: boolean, maxMarkdownBytes = MIGRATION_LIMITS.markdownBytes): Promise<Inventory> {
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
        if (candidates.length + directories.length > MIGRATION_LIMITS.entries) throw new MigrationError('limit', 'Migration preview is bounded to 20,000 included filesystem entries.');
      }
    }
    const files: ScannedFile[] = []; let markdownBytes = 0;
    for (const path of candidates.sort()) {
      const kind = /\.md$/i.test(path) ? 'note' : 'asset';
      let budgetedSize = 0;
      if (kind === 'note') {
        budgetedSize = (await lstat(native(await checkedSource(root, path)))).size;
        markdownBytes += budgetedSize;
        if (markdownBytes > maxMarkdownBytes) throw new MigrationError('markdown-memory-limit', 'Markdown aggregate exceeds the explicit preview memory budget; asset bytes are streamed independently.');
      }
      const scanned = await readStable(root, path, kind, retainMarkdown);
      if (kind === 'note') {
        markdownBytes += scanned.size - budgetedSize;
        if (markdownBytes > maxMarkdownBytes) throw new MigrationError('markdown-memory-limit', 'Markdown changed beyond the explicit preview memory budget.');
      }
      files.push(scanned);
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
export async function planVault(sourceRoot: string, options: { maxMarkdownBytes?: number } = {}): Promise<VaultPlan> {
  const maxMarkdownBytes = options.maxMarkdownBytes ?? MIGRATION_LIMITS.markdownBytes;
  if (!Number.isSafeInteger(maxMarkdownBytes) || maxMarkdownBytes < 1 || maxMarkdownBytes > MIGRATION_LIMITS.markdownBytes) throw new MigrationError('limit', 'Markdown memory budget must be within the supported 128 MiB ceiling.');
  const scan = await inventory(sourceRoot, true, maxMarkdownBytes);
  const folders: Folder[] = scan.directories.map(path => ({ id: stableId('folder', path), name: path.split('/').at(-1)!, parentId: path.includes('/') ? stableId('folder', path.slice(0, path.lastIndexOf('/'))) : null, revision: 1 }));
  const notes: Note[] = [], attachments: Attachment[] = [];
  const unsupported: VaultReport['unsupported'] = [];
  for (const file of scan.files) {
    if (file.kind === 'note') {
      const markdown = file.markdown!;
        notes.push({ id: file.id, title: basename(file.path).slice(0, -3), markdown, syntaxVersion: 'legacy-v0.2', folderId: file.path.includes('/') ? stableId('folder', file.path.slice(0, file.path.lastIndexOf('/'))) : null, revision: 1, updatedAt: new Date(file.mtimeMs).toISOString() });
      if (/\.excalidraw\.md$/i.test(file.path) || /^excalidraw-plugin\s*:/m.test(markdown)) unsupported.push({ path: file.path, kind: 'excalidraw' });
      if (/^[ \t>]*(?:`{3,}|~{3,})[ \t]*mermaid\b/m.test(markdown)) unsupported.push({ path: file.path, kind: 'mermaid' });
      if (/(?:^|[^\\])\$\$?[\s\S]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(markdown)) unsupported.push({ path: file.path, kind: 'math' });
    } else {
      const extension = extname(file.path).toLowerCase();
      attachments.push({ id: file.id, name: basename(file.path), path: file.path, mimeType: mimeTypes[extension] ?? 'application/octet-stream', sha256: file.sha256, size: file.size, revision: 1, createdAt: new Date(file.mtimeMs).toISOString() });
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
    files: scan.files.map(({ markdown: _markdown, ...file }) => file), directories: scan.directories, excludedDirectories: scan.excludedDirectories, unsupported, links,
    linkIssues: index.links.filter(link => !['resolved', 'external'].includes(link.status)).map(link => ({ noteId: link.location.noteId, from: link.location.from, to: link.location.to, target: link.target, status: link.status, ...(link.candidates ? { candidates: link.candidates.map(candidate => candidate.path) } : {}) })),
    limitations: ['Raw UTF-8 Markdown, BOM, frontmatter and line endings are preserved; frontmatter is not converted into records.', 'Plugin/tool configuration directories are excluded without loading their contents. Loose executable/tool configuration files are rejected.', 'Unsupported feature detection is static and bounded; it does not claim plugin or Obsidian rendering compatibility.', 'Note links are evaluated by the current Grasp resolver; unresolved/ambiguous links are retained without guesses or source rewriting.', 'The migration manifest covers included files and directory names; excluded directory contents are outside this preview.', 'Limits: 20,000 included entries, 128 MiB aggregate Markdown memory budget, 10 MiB per Markdown file, 64 MiB per asset; assets have no aggregate size cap and are streamed with a 1 MiB read buffer. SQLite insertion retains at most one 64 MiB asset at a time.'],
    memory: { chunkBytes: MIGRATION_LIMITS.chunkBytes, markdownBytes: scan.files.filter(file => file.kind === 'note').reduce((sum, file) => sum + file.size, 0), maxMarkdownBytes, retainedAssetBytes: 0 },
  };
  return { sourceRoot: scan.sourceRoot, snapshot, report };
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

export interface VaultProgress { phase: 'asset-copied' | 'sources-rechecked' | 'candidate-ready' | 'published'; copiedAssets: number; resumedAssets: number; totalAssets: number }
export interface VaultApplyResult { snapshot: WorkspaceSnapshot; databasePath: string; checkpointPath: string; copiedAssets: number; resumedAssets: number; sourceFingerprint: string }
interface MigrationCheckpoint { format: 'grasp-vault-checkpoint'; version: 1; sourceFingerprint: string; planHash: string; target: string; files: VaultSourceFile[] }
interface CandidateReceipt { format: 'grasp-vault-candidate'; version: 1; file: string; sha256: string; size: number; planHash: string }
async function exists(path: string): Promise<boolean> { try { await lstat(native(path)); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function writePrivate(path: string, data: unknown): Promise<void> {
  const handle = await open(native(path), 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(data) + '\n'); await handle.sync(); } finally { await handle.close(); }
}
async function readPrivate(root: string, relativePath: string): Promise<unknown> {
  const full = await checkedSource(root, relativePath), handle = await open(native(full), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new MigrationError('checkpoint-invalid', 'Checkpoint metadata is oversized or invalid.'); return JSON.parse(await handle.readFile('utf8')); }
  finally { await handle.close(); }
}
async function requireUnchangedSource(plan: VaultPlan): Promise<void> {
  const scan = await inventory(plan.sourceRoot, false, plan.report.memory.maxMarkdownBytes);
  if (scan.fingerprint !== plan.report.sourceFingerprint || JSON.stringify(scan.files) !== JSON.stringify(plan.report.files)
    || JSON.stringify(scan.directories) !== JSON.stringify(plan.report.directories) || JSON.stringify(scan.excludedDirectories) !== JSON.stringify(plan.report.excludedDirectories)) {
    throw new MigrationError('source-changed', 'Source differs from the reviewed preview; regenerate the plan before applying.');
  }
}
function sameSnapshot(actual: WorkspaceSnapshot, expected: WorkspaceSnapshot): boolean {
  return canonicalPayload({ ...actual, id: expected.id }) === canonicalPayload(expected);
}
function verifyDatabase(path: string, plan: VaultPlan): WorkspaceSnapshot {
  const store = new WorkspaceStore(path);
  try {
    const snapshot = store.snapshot();
    if (!sameSnapshot(snapshot, plan.snapshot)) throw new MigrationError('checkpoint-invalid', 'Candidate database metadata or exact source differs from the reviewed plan.');
    const seen = new Set<string>();
    for (const asset of snapshot.attachments) if (!seen.has(asset.sha256)) {
      const bytes = store.readBlob(asset.sha256);
      if (bytes.byteLength !== asset.size || hash(bytes) !== asset.sha256) throw new MigrationError('checkpoint-invalid', 'Candidate attachment bytes failed verification.');
      seen.add(asset.sha256);
    }
    return snapshot;
  } finally { store.close(); }
}

/** Recoverable bounded-memory import. A checkpoint never changes source data. */
export async function applyVault(plan: VaultPlan, newDbPath: string, options: {
  onProgress?: (progress: VaultProgress) => void;
  /** Injectable host capacity probe; defaults to the filesystem's available bytes. */
  availableBytes?: (parent: string) => Promise<bigint>;
} = {}): Promise<VaultApplyResult> {
  const databasePath = await outputPath(plan.sourceRoot, newDbPath);
  await requireUnchangedSource(plan);
  // Validate that a caller has not accidentally changed the reviewed Markdown or asset payload.
  const notes = new Map(plan.snapshot.notes.map(note => [note.id, note]));
  const assets = new Map(plan.snapshot.attachments.map(asset => [asset.id, asset]));
  if (notes.size !== plan.report.counts.notes || assets.size !== plan.report.counts.attachments) throw new MigrationError('plan-changed', 'Preview entity counts changed.');
  for (const file of plan.report.files) {
    if (file.kind === 'note') { const note = notes.get(file.id); if (!note || hash(Buffer.from(note.markdown, 'utf8')) !== file.sha256) throw new MigrationError('plan-changed', 'Preview Markdown changed; no database was created.'); }
    else { const asset = assets.get(file.id); if (!asset || asset.sha256 !== file.sha256 || asset.path !== file.path) throw new MigrationError('plan-changed', 'Preview attachment mapping changed.'); }
  }
  const parent = dirname(databasePath);
  await mkdir(native(parent), { recursive: true });
  const checkpointPath = await outputPath(plan.sourceRoot, databasePath + '.migration');
  const planHash = hash(JSON.stringify({ snapshot: plan.snapshot, fingerprint: plan.report.sourceFingerprint, files: plan.report.files, directories: plan.report.directories, excludedDirectories: plan.report.excludedDirectories }));
  const checkpoint: MigrationCheckpoint = { format: 'grasp-vault-checkpoint', version: 1, sourceFingerprint: plan.report.sourceFingerprint, planHash, target: basename(databasePath), files: plan.report.files };
  const assetFiles = [...new Map(plan.report.files.filter(file => file.kind === 'asset').map(file => [file.sha256, file])).values()];
  let copiedAssets = 0, resumedAssets = 0;
  const progress = (phase: VaultProgress['phase']) => options.onProgress?.({ phase, copiedAssets, resumedAssets, totalAssets: assetFiles.length });
  try {
    if (await exists(checkpointPath)) {
      const info = await lstat(native(checkpointPath));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new MigrationError('checkpoint-invalid', 'Checkpoint is not a real private directory.');
      if (JSON.stringify(await readPrivate(checkpointPath, 'manifest.json')) !== JSON.stringify(checkpoint)) throw new MigrationError('checkpoint-mismatch', 'Checkpoint belongs to a different source, reviewed plan or target; it was preserved.');
    } else {
      if (await exists(databasePath)) throw new Error('Existing target');
      await mkdir(native(checkpointPath)); await writePrivate(resolve(checkpointPath, 'manifest.json'), checkpoint);
    }
    const receipts = (await readdir(native(checkpointPath))).filter(name => /^ready-[a-f0-9-]{36}\.json$/.test(name)).sort();
    const candidates: CandidateReceipt[] = [];
    for (const file of receipts) {
      const receipt = await readPrivate(checkpointPath, file) as CandidateReceipt;
      if (receipt?.format !== 'grasp-vault-candidate' || receipt.version !== 1 || receipt.planHash !== planHash || !/^candidate-[a-f0-9-]{36}\.db$/.test(receipt.file)
        || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.size) || receipt.size < 0) throw new MigrationError('checkpoint-invalid', 'Candidate receipt is invalid.');
      candidates.push(receipt);
    }
    if (await exists(databasePath)) {
      const existing = await readStable(parent, basename(databasePath), 'asset', false, undefined, Number.MAX_SAFE_INTEGER);
      const receipt = candidates.find(candidate => candidate.sha256 === existing.sha256 && candidate.size === existing.size);
      if (!receipt) throw new Error('Existing target is not this completed migration');
      return { snapshot: verifyDatabase(databasePath, plan), databasePath, checkpointPath, copiedAssets: 0, resumedAssets: assetFiles.length, sourceFingerprint: plan.report.sourceFingerprint };
    }
    const required = BigInt(assetFiles.reduce((sum, file) => sum + file.size, 0)) * 4n + BigInt(plan.report.memory.markdownBytes) * 8n + 16n * 1024n * 1024n;
    const available = options.availableBytes ? await options.availableBytes(parent) : await statfs(native(parent), { bigint: true }).then(info => info.bavail * info.bsize);
    if (available < required) throw new MigrationError('disk-space', `Not enough available disk space for independent staging, SQLite and final database copies (need ${required.toString()} bytes).`);
    const objectRoot = resolve(checkpointPath, 'objects');
    if (!(await exists(objectRoot))) await mkdir(native(objectRoot));
    const objectInfo = await lstat(native(objectRoot));
    if (!objectInfo.isDirectory() || objectInfo.isSymbolicLink()) throw new MigrationError('checkpoint-invalid', 'Checkpoint objects directory is unsafe.');
    for (const file of assetFiles) {
      const name = file.sha256 + '.blob', destination = resolve(objectRoot, name);
      if (await exists(destination)) {
        const staged = await readStable(objectRoot, name, 'asset');
        if (staged.sha256 !== file.sha256 || staged.size !== file.size) throw new MigrationError('checkpoint-invalid', 'Previously staged attachment was externally changed; it was preserved.');
        resumedAssets++;
      } else {
        const temporary = resolve(objectRoot, `pending-${randomUUID()}.blob`), handle = await open(native(temporary), 'wx', 0o600);
        try {
          const copied = await readStable(plan.sourceRoot, file.path, 'asset', false, handle);
          if (copied.sha256 !== file.sha256 || copied.size !== file.size || copied.mtimeMs !== file.mtimeMs) throw new MigrationError('source-changed', 'Source attachment changed after review; no database was published.');
          await handle.sync();
        } finally { await handle.close(); }
        if (await exists(destination)) {
          const staged = await readStable(objectRoot, name, 'asset');
          if (staged.sha256 !== file.sha256 || staged.size !== file.size) throw new MigrationError('checkpoint-invalid', 'Concurrent checkpoint data does not match.');
        } else await rename(native(temporary), native(destination));
        copiedAssets++;
      }
      progress('asset-copied');
    }
    await requireUnchangedSource(plan); progress('sources-rechecked');
    let candidate = candidates[0];
    if (candidate) {
      const staged = await readStable(checkpointPath, candidate.file, 'asset', false, undefined, Number.MAX_SAFE_INTEGER);
      if (staged.sha256 !== candidate.sha256 || staged.size !== candidate.size) throw new MigrationError('checkpoint-invalid', 'Completed candidate database was externally changed.');
      verifyDatabase(resolve(checkpointPath, candidate.file), plan);
    } else {
      const id = randomUUID(), file = `candidate-${id}.db`, candidatePath = resolve(checkpointPath, file);
      const store = await WorkspaceStore.rebuildStreaming(candidatePath, plan.snapshot, async sha256 => {
        const full = await checkedSource(objectRoot, sha256 + '.blob'), handle = await open(native(full), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try { const info = await handle.stat(); if (info.size > MIGRATION_LIMITS.assetBytes) throw new MigrationError('limit', 'Staged asset exceeds the database insertion limit.'); return await handle.readFile(); }
        finally { await handle.close(); }
      }, undefined, undefined, { format: 'grasp-vault-provenance', version: 1, sourceFingerprint: plan.report.sourceFingerprint,
        files: plan.report.files, directories: plan.report.directories, excludedDirectories: plan.report.excludedDirectories });
      store.close();
      verifyDatabase(candidatePath, plan);
      const checked = await readStable(checkpointPath, file, 'asset', false, undefined, Number.MAX_SAFE_INTEGER);
      candidate = { format: 'grasp-vault-candidate', version: 1, file, sha256: checked.sha256, size: checked.size, planHash };
      await writePrivate(resolve(checkpointPath, `ready-${id}.json`), candidate);
    }
    progress('candidate-ready');
    await requireUnchangedSource(plan);
    // COPYFILE_EXCL never overwrites a target created by another process. A
    // failed copy is not reported as success; its verified candidate survives.
    await copyFile(native(resolve(checkpointPath, candidate.file)), native(databasePath), constants.COPYFILE_EXCL);
    const target = await open(native(databasePath), 'r+'); try { await target.sync(); } finally { await target.close(); }
    const published = await readStable(parent, basename(databasePath), 'asset', false, undefined, Number.MAX_SAFE_INTEGER);
    if (published.sha256 !== candidate.sha256 || published.size !== candidate.size) throw new MigrationError('publish-invalid', 'Published database failed verification; the complete candidate was preserved.');
    const snapshot = verifyDatabase(databasePath, plan);
    await writePrivate(resolve(checkpointPath, `complete-${randomUUID()}.json`), { format: 'grasp-vault-complete', version: 1, planHash, candidate, workspaceId: snapshot.id });
    progress('published');
    return { snapshot, databasePath, checkpointPath, copiedAssets, resumedAssets, sourceFingerprint: plan.report.sourceFingerprint };
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError('apply-failed', 'New database creation failed (existing target, interrupted copy, or filesystem failure). Verified private checkpoint data was preserved for retry; the source was not changed.');
  }
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
