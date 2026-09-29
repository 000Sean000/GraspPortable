import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { databaseFingerprint, inventory, prepareFixture } from '../scripts/prepare-performance-fixture';

describe('private complete performance fixtures', () => {
  it('backs up SQL history and binary data, preserves originals and rejects reuse/outside output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'grasp-p0-fixture-')), source = join(root, 'Source'), scratch = join(root, 'Scratch');
    await mkdir(join(source, '.grasp'), { recursive: true }); await mkdir(scratch);
    await writeFile(join(source, 'note.md'), 'private fixture\r\n');
    const path = join(source, '.grasp', 'workspace.grasp.db'), db = new DatabaseSync(path);
    db.exec('CREATE TABLE workspace (revision INTEGER); INSERT INTO workspace VALUES (9); CREATE TABLE history (bytes BLOB, value INTEGER);');
    db.prepare('INSERT INTO history VALUES (?, ?)').run(new Uint8Array([0, 255, 10]), 9007199254740993n); db.close();
    const original = await inventory(source), digest = databaseFingerprint(path), output = join(scratch, 'run');
    await expect(prepareFixture(source, join(root, 'outside'), scratch, 1)).rejects.toThrow('within Scratch');
    const report = await prepareFixture(source, output, scratch, 1); expect(report.status).toBe('passed');
    expect(await inventory(source)).toEqual(original);
    expect(databaseFingerprint(join(output, 'Trial-1', 'Workspace', '.grasp', 'workspace.grasp.db'))).toEqual(digest);
    expect(await readFile(join(output, 'Trial-1', 'Workspace', 'note.md'), 'utf8')).toBe('private fixture\r\n');
    await expect(prepareFixture(source, output, scratch, 1)).rejects.toThrow();
  });
  it('does not claim a frozen corpus when a SQLite journal exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'grasp-p0-journal-')), source = join(root, 'Source'), scratch = join(root, 'Scratch');
    await mkdir(join(source, '.grasp'), { recursive: true }); await mkdir(scratch);
    await writeFile(join(source, '.grasp', 'workspace.grasp.db-journal'), 'pending');
    await expect(prepareFixture(source, join(scratch, 'run'), scratch, 1)).rejects.toThrow('private diagnostics preserved');
    const report = JSON.parse(await readFile(join(scratch, 'run', 'fixture-summary.json'), 'utf8')); expect(report.status).toBe('failed');
  });
});
