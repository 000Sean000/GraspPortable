import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { WorkspaceFiles, readMirrorManifest } from '../server/files.js';
import type { WorkspaceSnapshot } from '../src/domain/model.js';

const root = resolve(`.cache/file-benchmark/run-${Date.now()}-${process.pid}`);
await mkdir(root, { recursive: true });
const attachment = Buffer.alloc(4096, 7);
const snapshot: WorkspaceSnapshot = {
  id: 'synthetic-files', name: 'Synthetic Files Benchmark', revision: 1, settings: {},
  folders: Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, name: `Folder${i}`, parentId: i ? `f${i - 1}` : null, revision: 1 })),
  notes: Array.from({ length: 2820 }, (_, i) => ({ id: `n${i}`, title: `Synthetic ${String(i).padStart(4, '0')}`, folderId: `f${i % 6}`, revision: 1, updatedAt: '2026-01-01T00:00:00Z', markdown: `# Synthetic ${i}\n\n` + 'Markdown text, Unicode 中文, and a stable source line.\n'.repeat(39) })),
  records: Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, collection: 'synthetic', name: `record${i}`, fields: { label: `Record ${i}`, value: 'literal' }, revision: 1 })),
  attachments: [{ id: 'asset', name: 'synthetic.bin', path: 'assets/synthetic.bin', mimeType: 'application/octet-stream', sha256: createHash('sha256').update(attachment).digest('hex'), size: attachment.length, revision: 1, createdAt: '2026-01-01T00:00:00Z' }],
};
const files = new WorkspaceFiles(resolve(root, 'benchmark.db'));
const timed = async <T>(action: () => Promise<T>) => { const start = performance.now(); const result = await action(); return { milliseconds: Number((performance.now() - start).toFixed(2)), result }; };
files.schedule(snapshot, () => attachment);
const cold = await timed(() => files.flush());
if (cold.result.mirror.state !== 'ready') throw new Error(cold.result.mirror.error);
const whole = await timed(() => files.buildAiFolder(snapshot, () => attachment));
const updated = { ...snapshot, revision: 2, notes: snapshot.notes.map((note, i) => i === 1400 ? { ...note, revision: 2, markdown: note.markdown + '\nOne changed line.' } : note) };
files.schedule(updated, () => attachment);
const oneChange = await timed(() => files.flush());
if (oneChange.result.mirror.state !== 'ready' || oneChange.result.mirror.writtenFiles !== 1 || oneChange.result.mirror.reusedFiles !== 2820) throw new Error('Incremental projection invariant failed.');
const recovered = await timed(() => readMirrorManifest(resolve(files.root, oneChange.result.mirror.manifestPath!)));
if (JSON.stringify(recovered.result.snapshot) !== JSON.stringify(updated) && recovered.result.snapshot.notes.some((note, i) => note.markdown !== updated.notes[i].markdown)) throw new Error('Recovery did not preserve source.');
const latestManifest = await stat(resolve(files.root, oneChange.result.mirror.manifestPath!));
const evidence = {
  timestamp: new Date().toISOString(), node: process.version, platform: process.platform, corpus: 'synthetic only',
  notes: snapshot.notes.length, noteBytes: snapshot.notes.reduce((sum, note) => sum + Buffer.byteLength(note.markdown), 0), records: snapshot.records.length, attachments: snapshot.attachments.length,
  coldMirror: { milliseconds: cold.milliseconds, writtenFiles: cold.result.mirror.writtenFiles, reusedFiles: cold.result.mirror.reusedFiles },
  wholeAiFolder: { milliseconds: whole.milliseconds, files: whole.result.files, payloadBytes: whole.result.bytes },
  warmOneChange: { milliseconds: oneChange.milliseconds, writtenFiles: oneChange.result.mirror.writtenFiles, reusedFiles: oneChange.result.mirror.reusedFiles, manifestBytes: latestManifest.size, changedNoteBytes: Buffer.byteLength(updated.notes[1400].markdown) },
  validatedRebuild: { milliseconds: recovered.milliseconds, notes: recovered.result.snapshot.notes.length, blobs: recovered.result.blobs.length },
  limits: ['Warm update still scans metadata/stats for every current projected file and writes a full manifest/index.', 'Stat signature cache avoids rehashing unchanged projection bytes; rebuild always reads and verifies all bytes.', 'This measures filesystem projection, not editor latency. No background pruning.'],
};
await mkdir(resolve('docs/benchmarks'), { recursive: true });
await writeFile(resolve('docs/benchmarks/files-latest.json'), JSON.stringify(evidence, null, 2) + '\n');
await writeFile(resolve('docs/FILES-PERFORMANCE.md'), `# File projection evidence\n\nRun: ${evidence.timestamp}; ${process.version}, ${process.platform}. Synthetic corpus only: ${evidence.notes} notes, ${evidence.noteBytes.toLocaleString()} Markdown bytes, 100 records and one 4 KiB attachment.\n\n| Operation | Time | Payload files written / reused |\n| --- | ---: | ---: |\n| Cold immutable mirror | ${cold.milliseconds} ms | ${cold.result.mirror.writtenFiles} / ${cold.result.mirror.reusedFiles} |\n| Fresh conventional AI folder | ${whole.milliseconds} ms | ${whole.result.files} files including metadata/index |\n| Warm one-note edit | ${oneChange.milliseconds} ms | 1 / ${oneChange.result.mirror.reusedFiles} |\n| Full verified rebuild read | ${recovered.milliseconds} ms | no writes |\n\nWarm updates avoid rewriting the other 2,819 notes and attachment, but still scan file metadata and publish a full manifest (${latestManifest.size.toLocaleString()} bytes) plus human-readable index. This is an asynchronous projection cost, not typing latency. The stat signature cache avoids repeated content hashing; rebuild always verifies every byte. Old revisions and externally edited files are retained; there is no automatic pruning.\n\nReproduce: \`node --import tsx scripts/benchmark-files.ts\`. JSON: [files-latest.json](benchmarks/files-latest.json).\n`);
console.log(JSON.stringify(evidence, null, 2));
await files.close();
