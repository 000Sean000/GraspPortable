import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve, toNamespacedPath } from 'node:path';
import { SafeTree } from './files.js';
import { sourceHash, type DurableDraft } from './semantic.js';
import { validateRecoveryDrafts, validateSnapshot } from './store.js';
import { validateFullProjectionBundle, compileProjectionPlan, projectionJson, type FullProjectionBundle, type ProjectionPlan } from '../src/domain/projection.js';
import { renderProjection } from '../src/domain/projection-renderer.js';

export const byteHash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export interface GenerationEntry { path: string; sha256: string; size: number }
export interface GenerationManifest {
  format: 'grasp-generation'; version: 1; kind: 'full' | 'partial'; id: string; fingerprint: string;
  workspaceId: string; workspaceRevision: number; semanticRevision: number; strategyRevision: number; createdAt: string; stamp: string;
  files: GenerationEntry[]; plan: ProjectionPlan;
}
export const MANIFEST = '.grasp-export/manifest.json', COMPLETE = '.grasp-export/complete.json';
export interface FullRecovery { bundle: FullProjectionBundle; drafts: DurableDraft[]; historyIncluded: false; operationsIncluded: false }
const path = (value: string): string => toNamespacedPath(value);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Root-confined, no symlink traversal. Every generation is ordinary independent files. */
export class GenerationTree {
  readonly tree: SafeTree;
  constructor(readonly root: string) { this.tree = new SafeTree(resolve(root), ['Markdown', '.grasp'], true); }
  async exists(relative: string): Promise<boolean> { try { await lstat(path(this.tree.absolute(relative))); return true; } catch (error) { if (missing(error)) return false; throw error; } }
  async directory(relative: string): Promise<void> { await this.tree.checked(relative, true, true); }
  async read(relative: string, max = 256 * 1024 * 1024): Promise<Buffer> { return Buffer.from(await this.tree.read(relative, max)); }
  async write(relative: string, bytes: Uint8Array | string): Promise<void> { await this.tree.writeNew(relative, typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes); }
  async move(source: string, target: string): Promise<void> {
    const info = await lstat(path(this.tree.absolute(source))); const from = await this.tree.checked(source, info.isDirectory());
    const to = this.tree.absolute(target); const parent = dirname(target).replace(/\\/g, '/'); await this.tree.checked(parent === '.' ? '' : parent, true, true);
    if (await this.exists(target)) throw new Error(`Publication destination already exists: ${target}`);
    await rename(path(from), path(to));
  }
  async atomicJson(relative: string, value: unknown): Promise<void> {
    const staging = `${relative}.${randomUUID()}.staging`;
    await this.write(staging, JSON.stringify(value)); await this.move(staging, relative);
  }
  async files(relative: string, ignoreObsidian = true): Promise<string[]> {
    const results: string[] = [];
    const walk = async (directory: string) => {
      await this.tree.checked(directory, true);
      for (const entry of await readdir(path(this.tree.absolute(directory)), { withFileTypes: true })) {
        if (ignoreObsidian && directory === relative && entry.name === '.obsidian') continue;
        const child = `${directory}/${entry.name}`;
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error(`Unsafe projection entry: ${child}`);
        if (entry.isDirectory()) await walk(child); else results.push(child.slice(relative.length + 1));
        if (results.length > 100_000) throw new Error('Projection exceeds the bounded file inventory.');
      }
    };
    if (await this.exists(relative)) await walk(relative);
    return results.sort();
  }
  async removeVerified(relative: string): Promise<void> {
    // Callers first validate the complete generation and its hashes. Enforce the
    // managed internal target here as a second boundary; never remove Markdown.
    if (!/^\.grasp\/(?:recovery|internal\/projection)\/[A-Za-z0-9-]+$/.test(relative)) throw new Error('Invalid cleanup target.');
    const absolute = await this.tree.checked(relative, true);
    await rm(path(absolute), { recursive: true, force: false });
  }
  async manifest(directory: string): Promise<GenerationManifest> {
    const bytes = await this.read(`${directory}/${MANIFEST}`);
    const complete = JSON.parse((await this.read(`${directory}/${COMPLETE}`, 4096)).toString('utf8'));
    const value = JSON.parse(bytes.toString('utf8')) as GenerationManifest;
    if (complete.format !== 'grasp-generation-complete' || complete.version !== 1 || complete.sha256 !== byteHash(bytes)
      || value.format !== 'grasp-generation' || value.version !== 1 || !['full', 'partial'].includes(value.kind) || !Array.isArray(value.files) || value.files.length > 100_000) throw new Error('Incomplete or invalid generation metadata.');
    const occupied = new Set<string>();
    for (const file of value.files) {
      if (typeof file.path !== 'string' || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Invalid generation file entry.');
      this.tree.absolute(`${directory}/${file.path}`);
      const key = file.path.normalize('NFC').toLowerCase();
      if (occupied.has(key) || file.path === MANIFEST || file.path === COMPLETE) throw new Error('Duplicate/reserved generation path.'); occupied.add(key);
    }
    return value;
  }
  async dirty(directory: string, manifest: GenerationManifest): Promise<string[]> {
    const dirty: string[] = [];
    for (const item of manifest.files) {
      try { const bytes = await this.read(`${directory}/${item.path}`); if (bytes.byteLength !== item.size || byteHash(bytes) !== item.sha256) dirty.push(item.path); }
      catch { dirty.push(item.path); }
    }
    // Metadata integrity matters as much as readable content.
    try { const actual = await this.manifest(directory); if (JSON.stringify(actual) !== JSON.stringify(manifest)) dirty.push(MANIFEST); } catch { dirty.push(MANIFEST); }
    const known = new Set([...manifest.files.map(item => item.path), MANIFEST, COMPLETE]);
    try { for (const item of await this.files(directory)) if (!known.has(item)) dirty.push(item); } catch { dirty.push('[unsafe-directory]'); }
    return [...new Set(dirty)].sort();
  }
  async validate(directory: string): Promise<GenerationManifest> {
    const manifest = await this.manifest(directory), dirty = await this.dirty(directory, manifest);
    if (dirty.length) throw new Error(`Generation verification failed: ${dirty.join(', ')}`);
    return manifest;
  }
  async copy(source: string, target: string, includeObsidian = false): Promise<void> {
    await this.directory(target);
    for (const file of await this.files(source, !includeObsidian)) await this.write(`${target}/${file}`, await this.read(`${source}/${file}`));
  }
}

export async function readFullGenerationStreaming(manifestPath: string): Promise<{ snapshot: FullProjectionBundle['snapshot']; readBlob: (sha256: string) => Promise<Uint8Array>; recovery: FullRecovery }> {
  const absolute = resolve(manifestPath);
  if (basename(absolute) !== 'manifest.json' || basename(dirname(absolute)) !== '.grasp-export') throw new Error('Select the complete Markdown/.grasp-export/manifest.json.');
  const generationRoot = dirname(dirname(absolute)), parent = dirname(generationRoot), name = basename(generationRoot);
  // A standalone copied folder need not have a special name. SafeTree's allowed
  // area is its literal basename, not any original machine path in metadata.
  const tree = new GenerationTree(parent);
  (tree as { tree: SafeTree }).tree = new SafeTree(parent, [name], false);
  const manifest = await tree.validate(name);
  if (manifest.kind !== 'full') throw new Error('A selected export cannot rebuild a full workspace.');
  const recoveryBytes = await tree.read(`${name}/.grasp-export/recovery.json`), recoveryEntry = manifest.files.find(file => file.path === '.grasp-export/recovery.json');
  if (!recoveryEntry || recoveryEntry.size !== recoveryBytes.length || recoveryEntry.sha256 !== byteHash(recoveryBytes)) throw new Error('Fallback metadata changed after validation.');
  const recovery = JSON.parse(recoveryBytes.toString('utf8')) as FullRecovery;
  const { bundle, catalog } = validateFullProjectionBundle(recovery.bundle, { hash: sourceHash });
  const snapshot = validateSnapshot(bundle.snapshot); recovery.drafts = validateRecoveryDrafts(recovery.drafts);
  if (bundle.snapshot.id !== manifest.workspaceId || bundle.snapshot.revision !== manifest.workspaceRevision || bundle.semantic.revision !== manifest.semanticRevision || bundle.strategy.revision !== manifest.strategyRevision || recovery.historyIncluded !== false || recovery.operationsIncluded !== false) throw new Error('Fallback metadata scope/revision mismatch.');
  const expectedPlan = compileProjectionPlan(catalog, bundle.strategy, { mode: 'full' });
  if (projectionJson(expectedPlan) !== projectionJson(manifest.plan)) throw new Error('Full generation plan does not cover the complete semantic catalog.');
  const rendered = renderProjection(expectedPlan), entries = new Map(manifest.files.map(file => [file.path, file]));
  const expectedFiles = new Set([...rendered.files.map(file => file.path), ...expectedPlan.attachments.map(asset => asset.file), '.grasp-export/rendered.json', '.grasp-export/recovery.json']);
  if (expectedFiles.size !== entries.size || [...expectedFiles].some(file => !entries.has(file))) throw new Error('Full generation file coverage is incomplete.');
  for (const file of rendered.files) if (entries.get(file.path)?.sha256 !== byteHash(file.text)) throw new Error('Readable projection does not match its canonical fallback.');
  if (entries.get('.grasp-export/rendered.json')?.sha256 !== byteHash(JSON.stringify(rendered))) throw new Error('Reading baseline does not match canonical fallback.');
  const assets = new Map<string, { file: string; size: number }>();
  for (const asset of snapshot.attachments) {
    const mapping = manifest.plan.attachments.find(item => item.id === asset.id);
    if (!mapping || mapping.sha256 !== asset.sha256) throw new Error('Fallback is missing attachment identity.');
    const bytes = await tree.read(`${name}/${mapping.file}`);
    if (bytes.byteLength !== asset.size || byteHash(bytes) !== asset.sha256) throw new Error('Fallback asset hash mismatch.');
    assets.set(asset.sha256, { file: mapping.file, size: asset.size });
  }
  const readBlob = async (sha256: string): Promise<Uint8Array> => { const asset = assets.get(sha256); if (!asset) throw new Error('Unknown fallback blob.'); const bytes = await tree.read(`${name}/${asset.file}`); if (bytes.length !== asset.size || byteHash(bytes) !== sha256) throw new Error('Fallback asset changed after validation.'); return bytes; };
  return { snapshot, readBlob, recovery };
}

/** Compatibility helper for small existing tests/callers; production rebuild uses the bounded reader. */
export async function readFullGeneration(manifestPath: string): Promise<{ snapshot: FullProjectionBundle['snapshot']; blobs: Array<{ sha256: string; bytes: Uint8Array }>; recovery: FullRecovery }> {
  const data = await readFullGenerationStreaming(manifestPath), blobs: Array<{ sha256: string; bytes: Uint8Array }> = [];
  for (const sha256 of new Set(data.snapshot.attachments.map(asset => asset.sha256))) blobs.push({ sha256, bytes: await data.readBlob(sha256) });
  return { snapshot: data.snapshot, blobs, recovery: data.recovery };
}
