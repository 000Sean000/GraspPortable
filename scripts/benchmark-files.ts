import assert from 'node:assert/strict';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { WorkspaceFiles, readMirrorManifest } from '../server/files.js';
import type { WorkspaceSnapshot } from '../src/domain/model.js';
import { evidenceDirectory } from './evidence-path.js';

const scratchRoot = resolve(process.env.GRASP_SCRATCH_ROOT ?? '../Scratch');
const root = resolve(scratchRoot, 'file-benchmark', `run-${Date.now()}-${process.pid}`);
const workspaceRoot = resolve(root, 'Workspace');
const evidenceRoot = evidenceDirectory('legacy-file-benchmark');
await mkdir(workspaceRoot, { recursive: true });
const attachment = Buffer.alloc(4096, 7);
const snapshot: WorkspaceSnapshot = {
  id: 'synthetic-files', name: 'Synthetic Files Benchmark', revision: 1, settings: {},
  folders: Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, name: `Folder${i}`, parentId: i ? `f${i - 1}` : null, revision: 1 })),
  notes: Array.from({ length: 2820 }, (_, i) => ({ id: `n${i}`, title: `Synthetic ${String(i).padStart(4, '0')}`, folderId: `f${i % 6}`, revision: 1, updatedAt: '2026-01-01T00:00:00Z', markdown: `# Synthetic ${i}\n\n` + 'Markdown text, Unicode 中文, and a stable source line.\n'.repeat(39) })),
  records: Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, collection: 'synthetic', name: `record${i}`, fields: { label: `Record ${i}`, value: 'literal' }, revision: 1 })),
  attachments: [{ id: 'asset', name: 'synthetic.bin', path: 'assets/synthetic.bin', mimeType: 'application/octet-stream', sha256: createHash('sha256').update(attachment).digest('hex'), size: attachment.length, revision: 1, createdAt: '2026-01-01T00:00:00Z' }],
};
const files = new WorkspaceFiles(resolve(workspaceRoot, '.grasp/workspace.grasp.db'));
const timed = async <T>(action: () => Promise<T>) => { const start = performance.now(); const result = await action(); return { milliseconds: Number((performance.now() - start).toFixed(2)), result }; };

// Inventory checks are outside timed operations. They prove the compatibility
// alias leaves both the public tree and internal manifests/recovery unchanged.
async function inventory(directory: string, prefix = ''): Promise<Array<{ path: string; directory: boolean; size: number; mtimeMs: number; ctimeMs: number; ino: number }>> {
  const result: Awaited<ReturnType<typeof inventory>> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Unexpected symbolic link in synthetic benchmark workspace.');
    const absolutePath = resolve(directory, entry.name), path = prefix + entry.name, info = await stat(absolutePath);
    result.push({ path, directory: entry.isDirectory(), size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino });
    if (entry.isDirectory()) result.push(...await inventory(absolutePath, path + '/'));
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

try {
  files.schedule(snapshot, () => attachment);
  const cold = await timed(() => files.flush());
  assert.equal(cold.result.mirror.state, 'ready', cold.result.mirror.error ?? 'Cold projection did not finish.');
  assert.equal(resolve(files.root), workspaceRoot);
  assert.equal(resolve(cold.result.projection.absolutePath), resolve(workspaceRoot, 'Markdown'));
  const payloadCount = snapshot.notes.length + snapshot.attachments.length;
  const beforeReuse = await inventory(files.root);
  const publicTrees = beforeReuse.filter(entry => entry.directory && !entry.path.includes('/') && !entry.path.startsWith('.')).map(entry => entry.path);
  assert.deepEqual(publicTrees, ['Markdown'], 'The synthetic workspace must have exactly one public projection tree.');
  assert.equal(beforeReuse.filter(entry => !entry.directory && entry.path.startsWith('Markdown/')).length, payloadCount);

  const reuse = await timed(() => files.buildAiFolder(snapshot, () => attachment));
  const afterReuse = await inventory(files.root);
  assert.equal(reuse.result.path, cold.result.projection.path, 'Compatibility alias must return the existing projection path.');
  assert.equal(resolve(reuse.result.absolutePath), resolve(cold.result.projection.absolutePath));
  assert.equal(reuse.result.files, payloadCount);
  assert.deepEqual(afterReuse, beforeReuse, 'Reusing the same revision must not create another tree or rewrite public/internal files.');

  const updated = { ...snapshot, revision: 2, notes: snapshot.notes.map((note, i) => i === 1400 ? { ...note, revision: 2, markdown: note.markdown + '\nOne changed line.' } : note) };
  files.schedule(updated, () => attachment);
  const oneChange = await timed(() => files.flush());
  assert.equal(oneChange.result.mirror.state, 'ready', oneChange.result.mirror.error ?? 'Updated projection did not finish.');
  assert.equal(oneChange.result.mirror.writtenFiles, 1);
  assert.equal(oneChange.result.mirror.reusedFiles, payloadCount - 1);
  assert.deepEqual(oneChange.result.projection, cold.result.projection, 'Editing source must reuse existing note and asset paths.');
  const publicAfterEdit = (await readdir(files.root, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name).sort();
  assert.deepEqual(publicAfterEdit, ['Markdown'], 'Updating the projection must not create a second public tree.');

  const recovered = await timed(() => readMirrorManifest(resolve(files.root, oneChange.result.mirror.manifestPath!)));
  assert.deepEqual(recovered.result.snapshot, updated, 'Verified recovery must preserve all source and metadata.');
  assert.equal(recovered.result.blobs.length, 1);
  assert.equal(recovered.result.blobs[0].sha256, snapshot.attachments[0].sha256);
  assert(Buffer.from(recovered.result.blobs[0].bytes).equals(attachment), 'Verified recovery must preserve attachment bytes.');
  const latestManifest = await stat(resolve(files.root, oneChange.result.mirror.manifestPath!));
  const evidence = {
    schemaVersion: 2, timestamp: new Date().toISOString(), node: process.version, platform: process.platform, corpus: 'synthetic only',
    layout: 'Workspace/.grasp/workspace.grasp.db + one live Workspace/Markdown projection',
    notes: snapshot.notes.length, noteBytes: snapshot.notes.reduce((sum, note) => sum + Buffer.byteLength(note.markdown), 0), records: snapshot.records.length, attachments: snapshot.attachments.length,
    coldProjection: { milliseconds: cold.milliseconds, writtenFiles: cold.result.mirror.writtenFiles, reusedFiles: cold.result.mirror.reusedFiles },
    existingProjectionReuse: { milliseconds: reuse.milliseconds, path: reuse.result.path, files: reuse.result.files, payloadBytes: reuse.result.bytes, samePath: true, unchangedFilesystemInventory: true, publicProjectionTrees: publicTrees.length, secondPersistentTreeCreated: false },
    warmOneChange: { milliseconds: oneChange.milliseconds, writtenFiles: oneChange.result.mirror.writtenFiles, reusedFiles: oneChange.result.mirror.reusedFiles, manifestBytes: latestManifest.size, changedNoteBytes: Buffer.byteLength(updated.notes[1400].markdown), sameProjectionPaths: true },
    validatedRebuildRead: { milliseconds: recovered.milliseconds, notes: recovered.result.snapshot.notes.length, blobs: recovered.result.blobs.length, snapshotExact: true, attachmentBytesExact: true },
    limits: ['Warm update still scans file metadata and publishes full manifest/index plus internal recovery metadata.', 'The compatibility buildAiFolder call validates/reuses the existing projection; it does not build or time another AI tree.', 'Stat signature cache avoids rehashing unchanged projection bytes; rebuild reads and verifies all bytes.', 'Inventory assertions are outside measured operations. This measures filesystem projection, not editor latency. No background pruning.'],
  };
  await writeFile(resolve(evidenceRoot, 'files-latest.json'), JSON.stringify(evidence, null, 2) + '\n');
  await writeFile(resolve(evidenceRoot, 'FILES-PERFORMANCE.md'), `# File projection evidence\n\nRun: ${evidence.timestamp}; ${process.version}, ${process.platform}. Synthetic corpus only: ${evidence.notes} notes, ${evidence.noteBytes.toLocaleString()} Markdown bytes, 100 records and one 4 KiB attachment. Layout: Workspace/.grasp/workspace.grasp.db plus one live Workspace/Markdown tree.\n\n| Operation | Time | Verified result |\n| --- | ---: | --- |\n| Cold single Markdown projection | ${cold.milliseconds} ms | ${cold.result.mirror.writtenFiles} public payloads written / ${cold.result.mirror.reusedFiles} reused |\n| Reuse existing projection through compatibility alias | ${reuse.milliseconds} ms | Same Markdown path; ${reuse.result.files} existing payloads; no filesystem mutations or second tree |\n| Warm one-note edit | ${oneChange.milliseconds} ms | 1 public payload written / ${oneChange.result.mirror.reusedFiles} reused; paths unchanged |\n| Full verified rebuild read | ${recovered.milliseconds} ms | Exact snapshot and attachment bytes; no writes |\n\nThe compatibility buildAiFolder call returns the same projection. Before/after inventories check paths, file identities, sizes and modification timestamps across both Markdown and .grasp; they are excluded from the timing. No second persistent AI directory is created.\n\nWarm updates avoid rewriting the other 2,819 notes and attachment, but still scan file metadata and publish a full manifest (${latestManifest.size.toLocaleString()} bytes), index and internal recovery metadata. This is asynchronous filesystem cost, not typing latency. Stat-signature caching avoids repeated hashing; rebuild verifies every byte. Internal recovery objects, prior manifests and external edits are retained without automatic pruning.\n\nReproduce: \`node --import tsx scripts/benchmark-files.ts\`. Synthetic workspaces are retained outside the repository under \`../Scratch/file-benchmark\`; set \`GRASP_SCRATCH_ROOT\` to choose another Scratch root. JSON: [files-latest.json](files-latest.json).\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally { await files.close(); }
