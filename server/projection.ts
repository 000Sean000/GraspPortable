import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve, toNamespacedPath } from 'node:path';
import { createDefaultProjectionStrategy, createFullProjectionBundle, createProjectionCatalog, createProjectionPlanningPackage, reviewProjectionProposal, compileProjectionPlan, projectionJson, type ProjectionCatalog, type ProjectionReview, type ProjectionStrategy, type ProjectionUnit, type ProjectionProposal, type ProjectionPlanningPackage, type ProjectionScope, type ProjectionSelector } from '../src/domain/projection.js';
import { renderProjection, reviewProjectionFile, type RenderedProjection, type ProjectionReadingChange } from '../src/domain/projection-renderer.js';
import type { FileEntry, FileExportResult, FilesStatus } from '../src/domain/files.js';
import type { WorkspaceSnapshot } from '../src/domain/model.js';
import type { SemanticIdentityHints } from '../src/domain/shared.js';
import { WorkspaceFiles, readMirrorManifest } from './files.js';
import { WorkspaceStore, StoreError, type ExternalProjectionApproval } from './store.js';
import { sourceHash } from './semantic.js';
import { GenerationTree, byteHash, MANIFEST, COMPLETE, type GenerationManifest, type GenerationEntry, type FullRecovery } from './projection-generation.js';

export interface ProjectionStatus {
  state: 'idle' | 'pending' | 'ready' | 'dirty' | 'error';
  workspaceRevision: number; lastSuccessRevision: number | null; lastSuccessAt?: string;
  projectionRoot: string; dirtyPaths: string[]; error?: string; recoveryRevision?: number;
  fingerprint?: string; lastSuccessFingerprint?: string; manifestPath?: string;
}
export interface ProjectionApiState {
  strategy: ProjectionStrategy; status: ProjectionStatus;
  catalog: Pick<ProjectionCatalog, 'workspaceId' | 'workspaceRevision' | 'semanticRevision' | 'fingerprint'> & {
    units: Array<Pick<ProjectionUnit, 'id' | 'kind' | 'label' | 'owner' | 'revision' | 'hash'>>;
  };
}
export type ProjectionStrategyReview = ProjectionReview & { token: string | null };

type Capture = ReturnType<WorkspaceStore['projectionCapture']>;
interface PublicationJournal { version: 1; stage: string; previous: string; recovery: string; fingerprint: string; previousFiles: GenerationEntry[]; hadPrevious: boolean }
interface TrustedPublication { manifest: GenerationManifest; rendered: RenderedProjection; snapshot: WorkspaceSnapshot }
type FailurePoint = 'generation-complete' | 'journal-durable' | 'old-renamed' | 'new-renamed';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const fingerprint = (capture: Capture) => sourceHash(projectionJson(capture));

/** Sole active projection publisher. Legacy WorkspaceFiles supplies confined file
 * browsing/exchange only; its old timer/publisher is never scheduled here. */
export class ProjectionWorkspaceFiles extends WorkspaceFiles {
  private readonly generations: GenerationTree;
  private projectionInitialized?: Promise<void>;
  private projectionRunning?: Promise<void>;
  private projectionTimer?: ReturnType<typeof setTimeout>;
  private projectionClosing = false;
  private initialScheduled = false;
  private projectionCurrent?: GenerationManifest;
  private legacy?: GenerationEntry[];
  private lastFingerprint?: string;
  private statusValue: ProjectionStatus;
  private readonly reviews = new Map<string, { expires: number; fingerprint: string; strategy: ProjectionStrategy }>();
  private readonly packages = new Map<string, ProjectionPlanningPackage>();
  constructor(private readonly store: WorkspaceStore, private readonly options: { checkpointMs?: number; fail?: (point: FailurePoint) => void } = {}) {
    super(store.path, true);
    this.generations = new GenerationTree(this.root);
    this.statusValue = { state: 'idle', workspaceRevision: store.snapshot().revision, lastSuccessRevision: null, projectionRoot: resolve(this.root, 'Markdown'), dirtyPaths: [] };
  }
  private capture(): Capture { return this.store.projectionCapture(); }
  private async initializeProjection(): Promise<void> {
    this.projectionInitialized ??= (async () => {
      for (const directory of ['.grasp/recovery', '.grasp/internal/projection', '.grasp/exchange/inbox', '.grasp/exchange/outbox', '.grasp/manifests']) await this.generations.directory(directory);
      await this.recoverPublication();
      if (await this.generations.exists(`Markdown/${COMPLETE}`)) {
        const published = this.store.projectionMetadata<TrustedPublication>('published'), pending = this.store.projectionMetadata<TrustedPublication | null>('pending');
        let actual: GenerationManifest | undefined; try { actual = await this.generations.manifest('Markdown'); } catch { /* A trusted previous baseline still detects damaged public metadata. */ }
        if (pending && JSON.stringify(pending.manifest) === JSON.stringify(actual) && !(await this.generations.dirty('Markdown', pending.manifest)).length) {
          this.store.saveProjectionMetadata('published', pending); this.store.saveProjectionMetadata('pending', null); this.projectionCurrent = pending.manifest;
        } else if (published) this.projectionCurrent = published.manifest;
        else throw new Error('Public projection has no trusted database publication baseline; preserve it and use explicit rebuild/import.');
        if (this.projectionCurrent.workspaceId !== this.store.id) throw new Error('Existing projection belongs to another workspace.');
        this.lastFingerprint = this.projectionCurrent.fingerprint;
        this.acceptCurrent(this.projectionCurrent);
      } else if (await this.generations.exists('Markdown')) {
        // A clean v0.2 raw projection can be replaced only after its old public
        // manifest verifies every byte. Dirty legacy trees remain untouched.
        const candidates = (await readdir(toNamespacedPath(resolve(this.root, '.grasp/manifests')))).filter(name => /^r.*\.json$/.test(name)).sort().reverse();
        if (candidates.length) {
          try {
            const old = await readMirrorManifest(resolve(this.root, '.grasp/manifests', candidates[0]));
            if (projectionJson(old.snapshot) === projectionJson(this.store.snapshot())) this.legacy = await this.inventory('Markdown');
          } catch { /* Unverified legacy content is external dirty data. */ }
        }
      }
    })().catch(error => { this.projectionInitialized = undefined; throw error; });
    return this.projectionInitialized;
  }
  private acceptCurrent(manifest: GenerationManifest): void {
    this.projectionCurrent = manifest;
    this.statusValue = { ...this.statusValue, state: 'ready', lastSuccessRevision: manifest.workspaceRevision, lastSuccessAt: manifest.createdAt,
      lastSuccessFingerprint: manifest.fingerprint, manifestPath: resolve(this.root, 'Markdown', MANIFEST), dirtyPaths: [], error: undefined };
  }
  private async inventory(directory: string, includeObsidian = false): Promise<GenerationEntry[]> {
    const entries: GenerationEntry[] = [];
    for (const path of await this.generations.files(directory, !includeObsidian)) { const bytes = await this.generations.read(`${directory}/${path}`); entries.push({ path, sha256: byteHash(bytes), size: bytes.length }); }
    return entries;
  }
  private async compareInventory(directory: string, entries: GenerationEntry[], includeObsidian = false): Promise<string[]> {
    const known = new Map(entries.map(entry => [entry.path, entry])); const dirty: string[] = [];
    for (const entry of entries) { try { const bytes = await this.generations.read(`${directory}/${entry.path}`); if (bytes.length !== entry.size || byteHash(bytes) !== entry.sha256) dirty.push(entry.path); } catch { dirty.push(entry.path); } }
    for (const file of await this.generations.files(directory, !includeObsidian)) if (!known.has(file)) dirty.push(file);
    return [...new Set(dirty)].sort();
  }
  private async dirty(): Promise<string[]> {
    if (this.projectionCurrent) {
      const dirty = await this.generations.dirty('Markdown', this.projectionCurrent), remaining: string[] = [];
      const accepted = new Map((this.store.projectionMetadata<ExternalProjectionApproval[]>('externalApprovals') ?? []).filter(item => item.generationFingerprint === this.projectionCurrent!.fingerprint).map(item => [item.path.replace(/^Markdown\//, ''), item.sha256]));
      for (const path of dirty) { const approvedHash = accepted.get(path); if (!approvedHash || byteHash(await this.generations.read(`Markdown/${path}`).catch(() => Buffer.alloc(0))) !== approvedHash) remaining.push(path); }
      return remaining;
    }
    if (this.legacy) return this.compareInventory('Markdown', this.legacy);
    return this.generations.files('Markdown');
  }
  private async recoverPublication(): Promise<void> {
    const files = await readdir(toNamespacedPath(resolve(this.root, '.grasp/internal/projection')));
    for (const name of files.filter(name => /^journal-[a-f\d-]+\.json$/.test(name)).sort()) {
      const journalPath = `.grasp/internal/projection/${name}`;
      const journal = JSON.parse((await this.generations.read(journalPath, 32 * 1024 * 1024)).toString('utf8')) as PublicationJournal;
      if (journal.version !== 1 || !/^\.grasp\/internal\/projection\/stage-[a-f\d-]+$/.test(journal.stage) || !/^\.grasp\/internal\/projection\/old-[a-f\d-]+$/.test(journal.previous) || !Array.isArray(journal.previousFiles)) throw new Error('Invalid interrupted publication journal; files preserved.');
      let installed = false;
      if (await this.generations.exists(`Markdown/${COMPLETE}`)) {
        try { const manifest = await this.generations.validate('Markdown'), pending = this.store.projectionMetadata<TrustedPublication | null>('pending'); installed = manifest.fingerprint === journal.fingerprint && JSON.stringify(manifest) === JSON.stringify(pending?.manifest ?? this.store.projectionMetadata<TrustedPublication>('published')?.manifest); } catch { /* Preserve changed bytes below. */ }
      }
      if (!installed) {
        if (!await this.generations.exists('Markdown') && await this.generations.exists(journal.previous)) {
          if ((await this.compareInventory(journal.previous, journal.previousFiles, true)).length) throw new Error(`Interrupted old generation was externally changed; preserved at ${journal.previous}.`);
          await this.generations.move(journal.previous, 'Markdown');
        } else if (await this.generations.exists('Markdown')) {
          const unchangedOld = !(await this.compareInventory('Markdown', journal.previousFiles, true)).length;
          if (!unchangedOld) throw new Error(`Interrupted publication contains external edits; preserve Markdown and review ${journal.previous}.`);
        }
      }
      await this.generations.move(journalPath, `${journalPath}.done`);
    }
  }
  override schedule(_snapshot: WorkspaceSnapshot, _readBlob: (sha256: string) => Uint8Array | Promise<Uint8Array>): void {
    if (this.projectionClosing) return;
    this.statusValue.workspaceRevision = _snapshot.revision;
    if (this.projectionCurrent?.stamp === this.store.projectionStamp()) return;
    if (this.statusValue.state !== 'dirty') this.statusValue.state = 'pending';
    if (!this.projectionTimer) { const delay = this.initialScheduled ? this.options.checkpointMs ?? 10 * 60_000 : 0; this.initialScheduled = true; this.projectionTimer = setTimeout(() => { this.projectionTimer = undefined; void this.checkpoint(); }, delay); this.projectionTimer.unref?.(); }
  }
  projectionStatus(): ProjectionStatus { return structuredClone(this.statusValue); }
  override status(): FilesStatus {
    const base = super.status(), value = this.statusValue;
    base.mirror = { ...base.mirror, state: value.state, revision: value.lastSuccessRevision, manifestPath: value.manifestPath ?? null, indexPath: null, dirtyPaths: value.dirtyPaths.map(path => `Markdown/${path}`), ...(value.error ? { error: value.error } : {}) };
    const plan = this.projectionCurrent?.plan;
    base.projection.notes = (plan?.targetMap ?? []).filter(item => item.unitId.startsWith('noteProse:')).map(item => ({ id: item.unitId.slice(10), path: `Markdown/${item.path}` }));
    base.projection.attachments = (plan?.attachments ?? []).map(item => ({ id: item.id, path: `Markdown/${item.file}` }));
    base.projection.units = (plan?.targetMap ?? []).map(item => ({ unitId: item.unitId, path: `Markdown/${item.path}` }));
    const snapshot = this.store.snapshot(), folders = new Map(snapshot.folders.map(folder => [folder.id, folder]));
    base.projection.folders = snapshot.folders.map(folder => {
      const paths = snapshot.notes.filter(note => { let id = note.folderId; const seen = new Set<string>(); while (id && !seen.has(id)) { if (id === folder.id) return true; seen.add(id); id = folders.get(id)?.parentId ?? null; } return false; })
        .map(note => plan?.targetMap.find(target => target.unitId === `noteProse:${note.id}`)?.path.split('/').slice(0, -1)).filter((path): path is string[] => !!path);
      const common = [...paths[0] ?? []]; for (const path of paths.slice(1)) { while (common.length && !common.every((part, index) => path[index] === part)) common.pop(); }
      return { id: folder.id, path: ['Markdown', ...common].join('/') };
    });
    return base;
  }
  override async inspect(): Promise<FilesStatus> {
    if (this.projectionRunning) await this.projectionRunning;
    try {
      await this.initializeProjection(); const dirty = await this.dirty(); this.statusValue.dirtyPaths = dirty;
      if (dirty.length) this.statusValue.state = 'dirty';
      else if (this.statusValue.state !== 'error') this.statusValue.state = this.projectionCurrent?.stamp === this.store.projectionStamp() ? 'ready' : 'pending';
    } catch (error) { this.statusValue.state = 'error'; this.statusValue.error = message(error); }
    return this.status();
  }
  async apiState(): Promise<ProjectionApiState> {
    await this.inspect(); const capture = this.capture(), catalog = createProjectionCatalog(capture.snapshot, capture.semantic, { hash: sourceHash });
    return { strategy: capture.strategy, status: this.projectionStatus(), catalog: { workspaceId: catalog.workspaceId, workspaceRevision: catalog.workspaceRevision, semanticRevision: catalog.semanticRevision, fingerprint: catalog.fingerprint,
      units: catalog.units.map(({ id, kind, label, owner, revision, hash }) => ({ id, kind, label, owner, revision, hash })) } };
  }
  planningPackage(selectors?: ProjectionSelector[], provided: 'full' | 'metadata' = 'full', includeDependencies = false): ProjectionPlanningPackage {
    const capture = this.capture(), catalog = createProjectionCatalog(capture.snapshot, capture.semantic, { hash: sourceHash });
    const units = selectors && includeDependencies ? compileProjectionPlan(catalog, capture.strategy, { mode: 'partial', units: selectors, includeDependencies: true }).scope.included : selectors;
    const result = createProjectionPlanningPackage(catalog, { id: randomUUID(), strategyRevision: capture.strategy.revision, units, provided });
    this.store.saveProjectionPackage(result);
    while (this.packages.size >= 20) this.packages.delete(this.packages.keys().next().value!); this.packages.set(result.id, result); return result;
  }
  planStrategy(proposal: ProjectionProposal): ProjectionStrategyReview {
    const capture = this.capture(), catalog = createProjectionCatalog(capture.snapshot, capture.semantic, { hash: sourceHash });
    const planningPackage = this.packages.get(proposal.planningPackageId) ?? this.store.projectionPackage(proposal.planningPackageId);
    if (!planningPackage) throw new StoreError('未知 planningPackageId；請先匯出有 scope 的 planning package。', 409);
    const review = reviewProjectionProposal(catalog, proposal, capture.strategy, planningPackage);
    const token = review.canApply && review.strategy ? randomUUID() : null;
    if (token && review.strategy) { while (this.reviews.size >= 20) this.reviews.delete(this.reviews.keys().next().value!); this.reviews.set(token, { expires: Date.now() + 30 * 60_000, fingerprint: catalog.fingerprint, strategy: structuredClone(review.strategy) }); }
    return { ...review, token };
  }
  applyStrategy(token: string): { snapshot: WorkspaceSnapshot; strategy: ProjectionStrategy; status: ProjectionStatus } {
    const frozen = this.reviews.get(token), capture = this.capture();
    if (!frozen || frozen.expires < Date.now() || frozen.fingerprint !== createProjectionCatalog(capture.snapshot, capture.semantic, { hash: sourceHash }).fingerprint) throw new StoreError('策略審查已過期；請重新產生預覽。', 409);
    const snapshot = this.store.saveProjectionStrategy(frozen.strategy, capture.snapshot.revision, capture.strategy.revision); this.reviews.delete(token);
    this.schedule(snapshot, sha => this.store.readBlob(sha)); return { snapshot, strategy: frozen.strategy, status: this.projectionStatus() };
  }
  private async writeGeneration(directory: string, capture: Capture, scope: ProjectionScope): Promise<GenerationManifest> {
    const catalog = createProjectionCatalog(capture.snapshot, capture.semantic, { hash: sourceHash });
    const plan = compileProjectionPlan(catalog, capture.strategy, scope), rendered = renderProjection(plan);
    const entries: GenerationEntry[] = [];
    const write = async (path: string, bytes: Uint8Array | string) => { const raw = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes; await this.generations.write(`${directory}/${path}`, raw); entries.push({ path, sha256: byteHash(raw), size: raw.byteLength }); };
    await this.generations.directory(directory);
    for (const file of rendered.files) await write(file.path, file.text);
    for (const asset of plan.attachments) { const bytes = this.store.readBlob(asset.sha256); if (bytes.length !== asset.size || byteHash(bytes) !== asset.sha256) throw new Error('DB attachment failed hash verification.'); await write(asset.file, bytes); }
    await write('.grasp-export/rendered.json', JSON.stringify(rendered));
    if (scope.mode === 'full') {
      const recovery: FullRecovery = { bundle: createFullProjectionBundle(capture.snapshot, capture.semantic, capture.strategy, { hash: sourceHash, lineageId: capture.lineageId, ...(capture.provenance === undefined ? {} : { provenance: capture.provenance }) }), drafts: capture.drafts, historyIncluded: false, operationsIncluded: false };
      await write('.grasp-export/recovery.json', JSON.stringify(recovery));
    } else await write('.grasp-export/scope.json', JSON.stringify({ format: 'grasp-selected-export', version: 1, scope: plan.scope, omittedTargets: plan.omittedTargets, canRebuildFullWorkspace: false }));
    const manifest: GenerationManifest = { format: 'grasp-generation', version: 1, kind: scope.mode, id: randomUUID(), fingerprint: fingerprint(capture), workspaceId: capture.snapshot.id,
      workspaceRevision: capture.snapshot.revision, semanticRevision: capture.semantic.revision, strategyRevision: capture.strategy.revision, createdAt: new Date().toISOString(),
      stamp: sourceHash(JSON.stringify([capture.snapshot.id, capture.snapshot.revision, capture.semantic.revision, capture.strategy.revision, [...capture.drafts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(draft => [draft.id, draft.revision, draft.updatedAt])])), files: entries, plan };
    const metadata = JSON.stringify(manifest); await this.generations.write(`${directory}/${MANIFEST}`, metadata);
    await this.generations.write(`${directory}/${COMPLETE}`, JSON.stringify({ format: 'grasp-generation-complete', version: 1, sha256: byteHash(metadata) }));
    await this.generations.validate(directory); return manifest;
  }
  async checkpoint(): Promise<ProjectionStatus> {
    this.initialScheduled = true;
    if (this.projectionTimer) { clearTimeout(this.projectionTimer); this.projectionTimer = undefined; }
    if (this.projectionRunning) { await this.projectionRunning; if (['dirty', 'error'].includes(this.statusValue.state) || this.projectionCurrent?.stamp === this.store.projectionStamp()) return this.projectionStatus(); }
    this.projectionRunning = this.publish().catch(async error => {
      try { await this.recoverPublication(); this.projectionInitialized = undefined; await this.initializeProjection(); } catch (recoveryError) { this.statusValue.error = `${message(error)} Recovery: ${message(recoveryError)}`; }
      this.projectionInitialized = undefined; this.statusValue.state = 'error'; this.statusValue.error ??= message(error);
    }).finally(() => { this.projectionRunning = undefined; });
    await this.projectionRunning; return this.projectionStatus();
  }
  private async publish(): Promise<void> {
    await this.initializeProjection(); const capture = this.capture(), next = fingerprint(capture);
    this.statusValue.workspaceRevision = capture.snapshot.revision; this.statusValue.fingerprint = next;
    let dirty = await this.dirty();
    if (next === this.lastFingerprint && !dirty.length) { this.statusValue.state = 'ready'; return; }
    const id = randomUUID(), recovery = `.grasp/recovery/generation-${id}`;
    const manifest = await this.writeGeneration(recovery, capture, { mode: 'full' });
    this.statusValue.recoveryRevision = capture.snapshot.revision;
    this.options.fail?.('generation-complete');
    dirty = await this.dirty();
    if (dirty.length) { this.statusValue.state = 'dirty'; this.statusValue.dirtyPaths = dirty; await this.retain(); return; }
    const stage = `.grasp/internal/projection/stage-${id}`, previous = `.grasp/internal/projection/old-${id}`;
    await this.generations.copy(recovery, stage); await this.generations.validate(stage);
    if (await this.generations.exists('Markdown/.obsidian')) await this.generations.copy('Markdown/.obsidian', `${stage}/.obsidian`, true);
    const previousFiles = await this.inventory('Markdown', true);
    dirty = await this.dirty(); if (dirty.length) { this.statusValue.state = 'dirty'; this.statusValue.dirtyPaths = dirty; return; }
    const journalPath = `.grasp/internal/projection/journal-${id}.json`;
    const journal: PublicationJournal = { version: 1, stage, previous, recovery, fingerprint: next, previousFiles, hadPrevious: await this.generations.exists('Markdown') };
    const trusted: TrustedPublication = { manifest, rendered: renderProjection(manifest.plan), snapshot: capture.snapshot };
    this.store.saveProjectionMetadata('pending', trusted);
    await this.generations.atomicJson(journalPath, journal); this.options.fail?.('journal-durable');
    if (journal.hadPrevious) await this.generations.move('Markdown', previous); this.options.fail?.('old-renamed');
    if (journal.hadPrevious) {
      const changed = await this.compareInventory(previous, previousFiles, true);
      if (changed.length) { await this.generations.move(previous, 'Markdown'); await this.generations.move(journalPath, `${journalPath}.done`); this.statusValue.state = 'dirty'; this.statusValue.dirtyPaths = changed; return; }
    }
    await this.generations.move(stage, 'Markdown'); this.options.fail?.('new-renamed');
    await this.generations.validate('Markdown');
    if (journal.hadPrevious) {
      const changed = await this.compareInventory(previous, previousFiles, true);
      if (changed.length) { await this.generations.move('Markdown', stage); await this.generations.move(previous, 'Markdown'); await this.generations.move(journalPath, `${journalPath}.done`); this.statusValue.state = 'dirty'; this.statusValue.dirtyPaths = changed; return; }
    }
    this.store.saveProjectionMetadata('published', trusted); this.store.saveProjectionMetadata('pending', null); this.store.saveProjectionMetadata('externalApprovals', []);
    await this.generations.move(journalPath, `${journalPath}.done`);
    this.lastFingerprint = next; this.legacy = undefined; this.acceptCurrent(manifest);
    if (journal.hadPrevious && !(await this.compareInventory(previous, previousFiles, true)).length) await this.generations.removeVerified(previous);
    await this.retain();
    if (this.store.projectionStamp() !== manifest.stamp) this.schedule(this.store.snapshot(), sha => this.store.readBlob(sha));
  }
  private async retain(): Promise<void> {
    const valid: Array<{ path: string; createdAt: string }> = [];
    for (const name of await readdir(toNamespacedPath(resolve(this.root, '.grasp/recovery')))) {
      if (!/^generation-[a-f\d-]+$/.test(name)) continue;
      const path = `.grasp/recovery/${name}`; try { const manifest = await this.generations.validate(path); if (manifest.workspaceId === this.store.id) valid.push({ path, createdAt: manifest.createdAt }); } catch { /* Changed or incomplete generations are preserved. */ }
    }
    valid.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const old of valid.slice(2)) { await this.generations.validate(old.path); await this.generations.removeVerified(old.path); }
  }
  override async flush(): Promise<FilesStatus> { await this.checkpoint(); return this.status(); }
  override async close(): Promise<void> { this.projectionClosing = true; if (this.projectionTimer) clearTimeout(this.projectionTimer); if (this.projectionRunning) await this.projectionRunning; /* DB already durably owns edits; close never forces expensive checkpoint. */ }
  override async locate(kind: 'note' | 'folder' | 'attachment', id: string): Promise<FileEntry> {
    await this.checkpoint();
    if (kind === 'folder') { const folder = this.status().projection.folders.find(folder => folder.id === id); if (!folder) throw new StoreError('Folder not found.', 404); return this.revealPath(folder.path); }
    const file = kind === 'attachment' ? this.projectionCurrent?.plan.attachments.find(item => item.id === id)?.file : this.projectionCurrent?.plan.targetMap.find(item => item.unitId === `noteProse:${id}`)?.path;
    if (!file) throw new StoreError('此項目尚未存在已發布 projection。', 404);
    return this.revealPath(`Markdown/${file}`);
  }
  async locateUnit(unitId: string): Promise<{ entry: FileEntry; anchor: string }> { await this.checkpoint(); const target = this.projectionCurrent?.plan.targetMap.find(item => item.unitId === unitId); if (!target) throw new StoreError('Projection unit 尚未發佈。', 404); return { entry: await this.revealPath(`Markdown/${target.path}`), anchor: target.anchor }; }
  override async buildAiFolder(_snapshot: WorkspaceSnapshot, _readBlob: (sha256: string) => Uint8Array | Promise<Uint8Array>): Promise<FileExportResult> { return this.exportScope({ mode: 'full' }); }
  async exportScope(scope: ProjectionScope): Promise<FileExportResult> {
    await this.initializeProjection(); let directory: string, manifest: GenerationManifest;
    if (scope.mode === 'full') { const status = await this.checkpoint(); if (status.state !== 'ready' || !this.projectionCurrent) throw new StoreError('主要 projection 尚未成功發布；請先處理 dirty/error。', 409); directory = 'Markdown'; manifest = this.projectionCurrent; }
    else { directory = `.grasp/exchange/outbox/selected-${randomUUID()}`; manifest = await this.writeGeneration(directory, this.capture(), scope); }
    return { path: directory, absolutePath: resolve(this.root, directory), manifestPath: resolve(this.root, directory, MANIFEST), indexPath: resolve(this.root, directory, manifest.plan.groups[0]?.path ?? MANIFEST), files: manifest.files.length + 2, bytes: manifest.files.reduce((sum, item) => sum + item.size, 0) };
  }
  async externalReview(path: string): Promise<{ snapshot: WorkspaceSnapshot; sha256: string; diagnostics: unknown[]; canApply: boolean; identityHints: SemanticIdentityHints; approvals: ExternalProjectionApproval[] }> {
    await this.initializeProjection(); if (!this.projectionCurrent || !path.startsWith('Markdown/')) throw new StoreError('僅可審查已發布的 projection 檔案。');
    const capture = this.capture(), trusted = this.store.projectionMetadata<TrustedPublication>('published');
    if (!trusted || trusted.manifest.fingerprint !== this.projectionCurrent.fingerprint) throw new StoreError('DB 沒有這個 generation 的可信審查基線。', 409);
    if (!trusted.rendered.files.some(file => `Markdown/${file.path}` === path)) throw new StoreError('此檔不是可審查的 reading file。');
    const snapshot = structuredClone(capture.snapshot), diagnostics: unknown[] = [], changes: ProjectionReadingChange[] = [], approvals: ExternalProjectionApproval[] = [];
    const already = this.store.projectionMetadata<ExternalProjectionApproval[]>('externalApprovals') ?? []; let canApply = true, requestedHash = '';
    // Review all changed reading files of this generation together. A split
    // owner cannot deadlock after importing one group before its sibling group.
    for (const baseline of trusted.rendered.files) {
      const relative = `Markdown/${baseline.path}`, bytes = await this.generations.read(relative), sha256 = byteHash(bytes);
      if (relative === path) requestedHash = sha256;
      if (sha256 === byteHash(baseline.text) || already.some(item => item.path === relative && item.sha256 === sha256 && item.generationFingerprint === trusted.manifest.fingerprint)) continue;
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), review = reviewProjectionFile(baseline, text);
      canApply &&= review.canApply; diagnostics.push(...review.diagnostics.map(item => ({ ...item, path: relative }))); changes.push(...review.changes);
      approvals.push({ path: relative, sha256, generationFingerprint: trusted.manifest.fingerprint });
    }
    if (!approvals.length) canApply = false;
    const identityHints: SemanticIdentityHints = { sourceEdits: [] };
    if (canApply) {
      const byNote = new Map<string, ProjectionReadingChange[]>();
      for (const original of changes) {
        const change = { ...original };
        if (change.kind === 'cache-only' || !change.owner) continue;
        if (change.owner.kind === 'note') {
          if (change.bindingId) { const binding = capture.semantic.bindings.find(binding => binding.id === change.bindingId); if (!binding || binding.owner.kind !== 'note' || binding.owner.noteId !== change.owner.noteId) throw new StoreError('External binding identity changed.', 409); change.from = binding.location.from; change.to = binding.location.to; }
          else { const noteId = change.owner.noteId; if (capture.snapshot.notes.find(note => note.id === noteId)?.markdown !== trusted.snapshot.notes.find(note => note.id === noteId)?.markdown) throw new StoreError('此正文 owner 在 DB 已變更；請重新協調原稿與外部修改。', 409); }
          const items = byNote.get(change.owner.noteId) ?? []; items.push(change); byNote.set(change.owner.noteId, items);
        }
      }
      for (const [noteId, changes] of byNote) {
        const note = snapshot.notes.find(note => note.id === noteId); if (!note) throw new StoreError('External source owner missing.');
        const edits = changes.flatMap(change => {
          if (change.from === undefined || !Array.isArray(change.rawEdits)) throw new StoreError('External edit is missing verified source lineage.');
          return change.rawEdits.map(edit => ({ from: change.from! + edit.from, to: change.from! + edit.to, insert: edit.insert, expected: change.beforeRaw.slice(edit.from, edit.to) }));
        }).sort((a, b) => a.from - b.from);
        identityHints.sourceEdits!.push({ noteId, baseRevision: note.revision, baseHash: sourceHash(note.markdown), steps: [edits] });
        for (const change of [...changes].sort((a, b) => (b.from ?? 0) - (a.from ?? 0))) {
          if (change.from === undefined || change.to === undefined || note.markdown.slice(change.from, change.to) !== change.beforeRaw) throw new StoreError('External source range no longer matches.');
          note.markdown = note.markdown.slice(0, change.from) + change.afterRaw + note.markdown.slice(change.to);
        }
      }
      for (const change of changes) if (change.owner?.kind === 'record') { const owner = change.owner, record = snapshot.records.find(item => item.id === owner.recordId); if (!record || record.fields[owner.field] !== change.beforeRaw) throw new StoreError('External record field no longer matches.'); record.fields[owner.field] = change.afterRaw; }
    }
    return { snapshot, sha256: requestedHash, diagnostics, canApply, identityHints, approvals };
  }
}
