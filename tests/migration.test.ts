import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { applyVault, MIGRATION_LIMITS, planVault, writeVaultReport } from '../server/migration.js';
import { WorkspaceStore } from '../server/store.js';

const root = resolve('.cache/migration-tests'); mkdirSync(root, { recursive: true });
const dirs: string[] = [];
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const dir = mkdtempSync(join(root, 'case-')); dirs.push(dir); const source = join(dir, 'source'); mkdirSync(source);
  const write = (path: string, bytes: string | Uint8Array) => { const full = join(source, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, bytes); };
  return { dir, source, write };
}
afterEach(() => { for (const dir of dirs.splice(0)) { if (!resolve(dir).startsWith(root + sep)) throw new Error('Unsafe test cleanup'); rmSync(dir, { recursive: true, force: true }); } });

describe('read-only copied-vault migration', () => {
  it('preserves exact BOM/CRLF Markdown, frontmatter, original hierarchy, attachment bytes and source timestamps through restart', async () => {
    const f = fixture();
    const raw = '\uFEFF---\r\ntags: [one, two]\r\n---\r\n# 中文\r\n\r\n[[Other|Alias]] ![[images/chart.png]]\r\n';
    const image = Buffer.from([137, 80, 78, 71, 13, 10]);
    f.write('Folder/筆記.md', raw); f.write('Other.md', '# Other\r\n'); f.write('images/chart.png', image);
    f.write('.obsidian/plugins/example/main.js', 'NEVER LOAD THIS'); f.write('.git/config', 'private config');
    const original = readFileSync(join(f.source, 'Folder/筆記.md')), modified = statSync(join(f.source, 'Folder/筆記.md')).mtimeMs;
    const plan = await planVault(f.source);
    expect(plan.report.counts).toMatchObject({ notes: 2, attachments: 1, folders: 2, excludedDirectories: 2 });
    expect(plan.snapshot.records).toEqual([]);
    expect(plan.snapshot.notes.find(note => note.title === '筆記')!.markdown).toBe(raw);
    expect(plan.report.links).toMatchObject({ total: 2, resolved: 2 });
    const database = join(f.dir, 'output', 'rehearsal.db');
    const result = await applyVault(plan, database);
    expect(result.snapshot.id).not.toBe(plan.snapshot.id);
    const reopened = new WorkspaceStore(database);
    try {
      expect(reopened.snapshot()).toEqual(result.snapshot);
      expect(reopened.snapshot().notes).toEqual(plan.snapshot.notes);
      expect(reopened.snapshot().folders).toEqual(plan.snapshot.folders);
      expect(Buffer.from(reopened.readBlob(plan.snapshot.attachments[0].sha256))).toEqual(image);
    } finally { reopened.close(); }
    expect(readFileSync(join(f.source, 'Folder/筆記.md'))).toEqual(original);
    expect(statSync(join(f.source, 'Folder/筆記.md')).mtimeMs).toBe(modified);
    expect(readFileSync(join(f.source, '.obsidian/plugins/example/main.js'), 'utf8')).toBe('NEVER LOAD THIS');
  });

  it('derives stable IDs from relative paths and produces private mapping/unsupported/link reports without content rewrites', async () => {
    const f = fixture(); f.write('one/Guide.md', 'same'); f.write('two/Guide.md', 'same');
    f.write('Index.md', '---\nexcalidraw-plugin: parsed\n---\n[[Guide]] [[Missing]]\n```mermaid\nflowchart LR\nA-->B\n```\n$x+y$');
    f.write('view.base', '{"filters":[]}');
    const first = await planVault(f.source), second = await planVault(f.source);
    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.report.sourceFingerprint).toBe(second.report.sourceFingerprint);
    expect(first.report.links).toMatchObject({ ambiguous: 1, missing: 1 });
    expect(first.report.unsupported.map(item => item.kind)).toEqual(expect.arrayContaining(['excalidraw', 'mermaid', 'math', 'obsidian-base']));
    expect(first.report.files.every(file => file.id && file.sha256.length === 64)).toBe(true);
    const report = await writeVaultReport(first, join(f.dir, 'private-reports'));
    expect(JSON.parse(readFileSync(report, 'utf8')).files).toEqual(first.report.files);
    expect(readFileSync(report, 'utf8')).not.toContain('flowchart LR');
    expect(readdirSync(f.source).sort()).toEqual(['Index.md', 'one', 'two', 'view.base']);
  });

  it('rejects an existing database target and never writes reports/databases into the input tree', async () => {
    const f = fixture(); f.write('Note.md', 'source'); const plan = await planVault(f.source);
    const existing = join(f.dir, 'existing.db'); writeFileSync(existing, 'do not overwrite');
    const before = sha(readFileSync(existing));
    await expect(applyVault(plan, existing)).rejects.toThrow('creation failed');
    expect(sha(readFileSync(existing))).toBe(before);
    await expect(applyVault(plan, join(f.source, 'new.db'))).rejects.toThrow('outside the source');
    await expect(writeVaultReport(plan, join(f.source, 'reports'))).rejects.toThrow('outside the source');
    expect(readdirSync(f.source)).toEqual(['Note.md']);
  });

  it('rejects changed source contents, path sets or reviewed in-memory bytes before database creation', async () => {
    const f = fixture(); f.write('Note.md', 'before'); const plan = await planVault(f.source);
    f.write('Note.md', 'after'); await expect(applyVault(plan, join(f.dir, 'changed.db'))).rejects.toThrow('differs from');
    expect(existsSync(join(f.dir, 'changed.db'))).toBe(false);
    const next = await planVault(f.source); f.write('Extra.md', 'extra');
    await expect(applyVault(next, join(f.dir, 'extra.db'))).rejects.toThrow('differs from');
    const modifiedPlan = await planVault(f.source); modifiedPlan.snapshot.notes[0].markdown += 'modified';
    await expect(applyVault(modifiedPlan, join(f.dir, 'plan.db'))).rejects.toThrow('Preview Markdown changed');
    expect(existsSync(join(f.dir, 'plan.db'))).toBe(false);
  });

  it('rejects symlinks, executable artifacts and invalid UTF-8 without executing or rewriting them', async () => {
    const link = fixture(); const outside = join(link.dir, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'secret.md'), 'private');
    symlinkSync(outside, join(link.source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(planVault(link.source)).rejects.toThrow('symlink');
    expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('private');
    const script = fixture(); script.write('run.js', 'throw new Error("must never execute")');
    await expect(planVault(script.source)).rejects.toThrow('configuration');
    const encoding = fixture(); const bad = Buffer.from([0xff, 0xfe, 0x41, 0x00]); encoding.write('invalid.md', bad);
    await expect(planVault(encoding.source)).rejects.toThrow('UTF-8');
    expect(readFileSync(join(encoding.source, 'invalid.md'))).toEqual(bad);
  });

  it('rejects aliased output paths back into the source and refuses silent filename normalization', async () => {
    const f = fixture(); f.write('Note.md', 'text'); const plan = await planVault(f.source);
    const alias = join(f.dir, 'source-alias'); symlinkSync(f.source, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(writeVaultReport(plan, join(alias, 'reports'))).rejects.toThrow('outside the source');
    const names = fixture(); names.write(' leading.md', 'raw title');
    await expect(planVault(names.source)).rejects.toThrow('losslessly representable');
  });

  it('defaults CLI to preview and creates a new database only with explicit --apply', async () => {
    const f = fixture(); f.write('Note.md', '# Safe source\r\n');
    const cli = resolve('scripts/migrate-vault.ts'), output = join(f.dir, 'reports'), database = join(f.dir, 'result.db');
    const args = ['--import', 'tsx', cli, `--source=${f.source}`, `--output=${output}`];
    const preview = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
    expect(preview.status, preview.stderr).toBe(0); expect(JSON.parse(preview.stdout).mode).toBe('preview-only');
    expect(existsSync(database)).toBe(false); expect(preview.stdout).not.toContain('Note.md');
    const applied = spawnSync(process.execPath, [...args, `--apply=${database}`], { encoding: 'utf8', windowsHide: true });
    expect(applied.status, applied.stderr).toBe(0); expect(JSON.parse(applied.stdout).mode).toBe('applied-to-new-database');
    expect(existsSync(database)).toBe(true);
  });

  it('streams asset bodies independently of the explicit aggregate Markdown memory budget', async () => {
    const f = fixture(); f.write('Note.md', '1234'); f.write('asset.png', Buffer.alloc(MIGRATION_LIMITS.chunkBytes + 7, 0x62));
    const plan = await planVault(f.source, { maxMarkdownBytes: 4 });
    expect(plan.report.memory).toEqual({ chunkBytes: MIGRATION_LIMITS.chunkBytes, markdownBytes: 4, maxMarkdownBytes: 4, retainedAssetBytes: 0 });
    expect('blobs' in plan).toBe(false);
    expect(plan.report.files.find(file => file.kind === 'asset')?.size).toBe(MIGRATION_LIMITS.chunkBytes + 7);
    await expect(planVault(f.source, { maxMarkdownBytes: 3 })).rejects.toMatchObject({ code: 'markdown-memory-limit' });
    expect(plan.report.counts.bytes).toBe(MIGRATION_LIMITS.chunkBytes + 11);
  });

  it('preserves a UTF-8 character that straddles the streaming chunk boundary', async () => {
    const f = fixture(), text = 'a'.repeat(MIGRATION_LIMITS.chunkBytes - 1) + '中\r\n'; f.write('Boundary.md', text);
    const plan = await planVault(f.source);
    expect(plan.snapshot.notes[0].markdown).toBe(text);
    expect(plan.report.files[0].sha256).toBe(sha(Buffer.from(text)));
  });

  it('resumes verified asset checkpoints after interruption and reopens the same completed database idempotently', async () => {
    const f = fixture(); f.write('Note.md', 'source'); f.write('a.png', 'first'); f.write('b.png', 'second');
    const plan = await planVault(f.source), database = join(f.dir, 'result.db');
    await expect(applyVault(plan, database, { onProgress: progress => { if (progress.phase === 'asset-copied') throw new Error('simulated interruption'); } })).rejects.toMatchObject({ code: 'apply-failed' });
    expect(existsSync(database)).toBe(false);
    const checkpoint = database + '.migration';
    expect(readdirSync(join(checkpoint, 'objects')).filter(file => /^[a-f0-9]{64}\.blob$/.test(file))).toHaveLength(1);
    const freshPlan = await planVault(f.source);
    const resumed = await applyVault(freshPlan, database);
    expect(resumed.copiedAssets).toBe(1); expect(resumed.resumedAssets).toBe(1);
    const retried = await applyVault(await planVault(f.source), database);
    expect(retried.snapshot).toEqual(resumed.snapshot);
    expect(retried.copiedAssets).toBe(0); expect(retried.resumedAssets).toBe(2);
    const store = new WorkspaceStore(database);
    try {
      const capture = store.projectionCapture();
      expect(capture.provenance).toMatchObject({ format: 'grasp-vault-provenance', sourceFingerprint: plan.report.sourceFingerprint, files: plan.report.files });
      expect(store.snapshot().notes).toEqual(plan.snapshot.notes);
    } finally { store.close(); }
  });

  it('resumes a completed private candidate after interruption before publication', async () => {
    const f = fixture(); f.write('Note.md', 'source'); f.write('image.png', 'bytes'); const plan = await planVault(f.source), database = join(f.dir, 'result.db');
    await expect(applyVault(plan, database, { onProgress: progress => { if (progress.phase === 'candidate-ready') throw new Error('simulated crash'); } })).rejects.toMatchObject({ code: 'apply-failed' });
    expect(existsSync(database)).toBe(false);
    const candidate = readdirSync(database + '.migration').find(file => /^candidate-.*\.db$/.test(file))!;
    const candidateHash = sha(readFileSync(join(database + '.migration', candidate)));
    const result = await applyVault(plan, database);
    expect(sha(readFileSync(database))).toBe(candidateHash);
    expect(result.resumedAssets).toBe(1); expect(result.copiedAssets).toBe(0);
  });

  it('rechecks source after copying and again before publication without mutating the source itself', async () => {
    for (const phase of ['asset-copied', 'candidate-ready']) {
      const f = fixture(); f.write('Note.md', 'before'); f.write('image.png', 'bytes');
      const plan = await planVault(f.source), database = join(f.dir, 'result.db');
      await expect(applyVault(plan, database, { onProgress: progress => { if (progress.phase === phase) f.write('Note.md', 'external change'); } }))
        .rejects.toMatchObject({ code: 'source-changed' });
      expect(existsSync(database)).toBe(false);
      expect(readFileSync(join(f.source, 'Note.md'), 'utf8')).toBe('external change');
    }
  });

  it('refuses insufficient disk space, a mismatched checkpoint and externally edited staged objects', async () => {
    const f = fixture(); f.write('Note.md', 'source'); f.write('image.png', 'bytes'); const plan = await planVault(f.source);
    await expect(applyVault(plan, join(f.dir, 'no-space.db'), { availableBytes: async () => 0n })).rejects.toMatchObject({ code: 'disk-space' });
    expect(existsSync(join(f.dir, 'no-space.db'))).toBe(false);
    const database = join(f.dir, 'result.db');
    await expect(applyVault(plan, database, { onProgress: progress => { if (progress.phase === 'asset-copied') throw new Error('stop'); } })).rejects.toThrow();
    const object = join(database + '.migration', 'objects', plan.snapshot.attachments[0].sha256 + '.blob');
    writeFileSync(object, 'external staged edit');
    await expect(applyVault(plan, database)).rejects.toMatchObject({ code: 'checkpoint-invalid' });
    expect(readFileSync(object, 'utf8')).toBe('external staged edit');
    f.write('Note.md', 'changed source for a new plan');
    await expect(applyVault(await planVault(f.source), database)).rejects.toMatchObject({ code: 'checkpoint-mismatch' });
  });

  it('does not follow a checkpoint symlink into the original source or another directory', async () => {
    const f = fixture(); f.write('Note.md', 'source'); const plan = await planVault(f.source), database = join(f.dir, 'result.db');
    symlinkSync(f.source, database + '.migration', process.platform === 'win32' ? 'junction' : 'dir');
    await expect(applyVault(plan, database)).rejects.toThrow(/outside the source/);
    expect(readdirSync(f.source)).toEqual(['Note.md']);
  });
});
