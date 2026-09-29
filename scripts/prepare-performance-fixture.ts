/** Complete private fixtures. No WorkspaceStore is opened on the source. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { cp, lstat, mkdir, open, readdir, realpath, statfs, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, toNamespacedPath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';

const native = toNamespacedPath;
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
type FileEntry = { path: string; size: number; mtimeMs: number; sha256: string };
export async function inventory(root: string) {
  const files: FileEntry[] = [], directories: string[] = [];
  async function walk(part: string) {
    for (const name of (await readdir(native(resolve(root, part)))).sort()) {
      const path = part ? `${part}/${name}` : name, absolute = native(resolve(root, path)), before = await lstat(absolute);
      assert(!before.isSymbolicLink(), 'Fixture contains a symlink.');
      assert(inside(root, await realpath(absolute)), 'Fixture entry escaped its root.');
      if (before.isDirectory()) { directories.push(path); await walk(path); continue; }
      assert(before.isFile(), 'Fixture contains a nonregular file.');
      const digest = createHash('sha256'), handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk); } finally { await handle.close(); }
      const after = await lstat(absolute);
      assert(after.isFile() && !after.isSymbolicLink() && before.ino === after.ino && before.ctimeMs === after.ctimeMs && before.mtimeMs === after.mtimeMs && before.size === after.size, 'Fixture changed during hashing.');
      files.push({ path, size: before.size, mtimeMs: before.mtimeMs, sha256: digest.digest('hex') });
    }
  }
  await walk(''); files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); directories.sort();
  return { files, directories, bytes: files.reduce((n, file) => n + file.size, 0), fingerprint: sha(JSON.stringify({ files: files.map(({ mtimeMs: _, ...file }) => file), directories })) };
}

/** All SQL rows, including history/receipts/blobs, compared without publishing their values. */
export function databaseFingerprint(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    assert.deepEqual(db.prepare('PRAGMA quick_check').all().map(row => row.quick_check), ['ok']);
    const tables = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name").all();
    const digest = createHash('sha256'); const counts: Record<string, number> = {};
    for (const table of tables) {
      const name = String(table.name), rows: string[] = [];
      const statement = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`); statement.setReadBigInts(true);
      for (const row of statement.iterate()) rows.push(sha(JSON.stringify(row, (_key, value: unknown) => typeof value === 'bigint' ? { integer: value.toString() } : value instanceof Uint8Array ? { blob: sha(value), bytes: value.byteLength } : value)));
      rows.sort(); counts[name] = rows.length; digest.update(JSON.stringify([name, table.sql, rows]));
    }
    const workspace = db.prepare('SELECT revision FROM workspace').get();
    const version = db.prepare('PRAGMA user_version').get(); db.exec('COMMIT');
    return { fingerprint: digest.digest('hex'), tables: counts, revision: workspace?.revision, schema: version?.user_version };
  } finally { db.close(); }
}

export async function prepareFixture(sourceInput: string, outputInput: string, scratchInput: string, trials = 3) {
  assert(isAbsolute(sourceInput) && isAbsolute(outputInput) && isAbsolute(scratchInput), 'Use absolute paths.');
  assert(Number.isInteger(trials) && trials >= 1 && trials <= 3);
  const sourceInfo = await lstat(native(sourceInput)), scratchInfo = await lstat(native(scratchInput));
  assert(sourceInfo.isDirectory() && !sourceInfo.isSymbolicLink() && scratchInfo.isDirectory() && !scratchInfo.isSymbolicLink());
  const source = await realpath(native(sourceInput)), scratch = await realpath(native(scratchInput));
  // The parent must already exist: aliases cannot be hidden in missing parents.
  const output = resolve(await realpath(native(dirname(outputInput))), relative(dirname(outputInput), outputInput));
  assert(output !== scratch && inside(scratch, output) && !inside(source, output) && !inside(output, source), 'Output must be a new directory within Scratch, outside source.');
  await mkdir(native(output)); // Exclusive. Never reuse an earlier trial root.
  const report: Record<string, unknown> = { version: 1, startedAt: new Date().toISOString(), status: 'preparing', phases: {} };
  const save = () => writeFile(native(resolve(output, 'fixture-summary.json')), JSON.stringify(report, null, 2));
  async function phase<T>(name: string, action: () => Promise<T>): Promise<T> {
    report.phase = name; await save(); process.stdout.write(`${name}\n`);
    const start = performance.now(), result = await action();
    (report.phases as Record<string, number>)[name] = performance.now() - start; await save(); return result;
  }
  const dbPart = '.grasp/workspace.grasp.db';
  try {
    const before = await phase('source-inventory', () => inventory(source));
    assert(!before.files.some(file => file.path === `${dbPart}-journal` || file.path === `${dbPart}-wal` || file.path === `${dbPart}-shm`), 'Source has SQLite sidecars; preserve and investigate before freezing.');
    await writeFile(native(resolve(output, 'source-before-private.json')), JSON.stringify(before));
    const dbBefore = databaseFingerprint(resolve(source, dbPart));
    const capacity = await statfs(native(output)); assert(capacity.bavail * capacity.bsize > before.bytes * (trials + 3), 'Insufficient space for independent trials and new publication generations.');
    const frozen = resolve(output, 'Frozen', 'Workspace'); await mkdir(native(dirname(frozen)));
    await phase('freeze-files', () => cp(native(source), native(frozen), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
      filter: path => relative(native(source), path).replaceAll('\\', '/') !== dbPart }));
    await phase('freeze-consistent-sqlite-backup', async () => {
      const db = new DatabaseSync(resolve(source, dbPart), { readOnly: true });
      try { await backup(db, native(resolve(frozen, dbPart))); } finally { db.close(); }
    });
    const frozenInventory = await phase('verify-frozen', () => inventory(frozen));
    assert.deepEqual(frozenInventory.directories, before.directories);
    const withoutDb = (files: FileEntry[]) => files.filter(file => file.path !== dbPart).map(({ mtimeMs: _, ...file }) => file);
    assert.deepEqual(withoutDb(frozenInventory.files), withoutDb(before.files));
    assert.deepEqual(databaseFingerprint(resolve(frozen, dbPart)), dbBefore, 'SQLite backup differs in logical content.');
    const after = await phase('verify-source-unchanged', () => inventory(source)); assert.deepEqual(after, before);
    assert.deepEqual(databaseFingerprint(resolve(source, dbPart)), dbBefore);
    await writeFile(native(resolve(output, 'frozen-private.json')), JSON.stringify(frozenInventory));
    report.source = { files: before.files.length, directories: before.directories.length, bytes: before.bytes, fingerprint: before.fingerprint, database: dbBefore };
    report.frozen = { files: frozenInventory.files.length, directories: frozenInventory.directories.length, bytes: frozenInventory.bytes, fingerprint: frozenInventory.fingerprint };
    report.databaseCopyMethod = 'SQLite online backup; all SQL rows and blobs compared; original file tree unchanged';
    const results = [];
    for (let index = 1; index <= trials; index++) {
      const copy = resolve(output, `Trial-${index}`, 'Workspace'); await mkdir(native(dirname(copy)));
      await phase(`trial-${index}-copy`, () => cp(native(frozen), native(copy), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true }));
      const copied = await phase(`trial-${index}-verify`, () => inventory(copy)); assert.equal(copied.fingerprint, frozenInventory.fingerprint);
      assert.deepEqual(databaseFingerprint(resolve(copy, dbPart)), dbBefore);
      results.push({ trial: index, fingerprint: copied.fingerprint, independentFiles: true });
    }
    report.trials = results; report.status = 'passed'; report.completedAt = new Date().toISOString(); report.sourceUnchanged = true; await save(); return report;
  } catch (error) {
    report.status = 'failed'; report.completedAt = new Date().toISOString(); await save();
    await writeFile(native(resolve(output, 'failure-private.txt')), error instanceof Error ? error.stack ?? error.message : String(error)); throw new Error('Fixture preparation failed; private diagnostics preserved.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arguments_ = process.argv.slice(2), source = arguments_[arguments_.indexOf('--source') + 1], output = arguments_[arguments_.indexOf('--output-root') + 1];
  assert(arguments_.includes('--source') && arguments_.includes('--output-root'), 'Use --source <absolute workspace> --output-root <new absolute Scratch directory>');
  const repo = fileURLToPath(new URL('..', import.meta.url));
  try { await prepareFixture(source, output, resolve(repo, '..', 'Scratch')); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Fixture preparation failed'); process.exitCode = 1; }
}
