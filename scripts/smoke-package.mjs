import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, process.argv[2] || 'artifacts/GraspPortable-0.1.0');
assert.ok(existsSync(join(source, 'dist/server.mjs')), 'Build and package first.');
const folder = mkdtempSync(join(tmpdir(), 'grasp-package-smoke-'));
const port = 43832;
const origin = `http://127.0.0.1:${port}`;
const database = join(folder, 'smoke.grasp.db');
let launcher;
let hostPid;
let logs = '';
const assets = [];
function walk(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]); }
async function start() {
  launcher = spawn(process.execPath, ['scripts/launch.mjs'], { cwd: folder, env: { ...process.env, PORT: String(port), GRASP_NO_BROWSER: '1', GRASP_WORKSPACE: database }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  launcher.stdout.on('data', data => logs += data); launcher.stderr.on('data', data => logs += data);
  for (let i = 0; i < 100; i++) {
    if (launcher.exitCode !== null) throw new Error(`Launcher exited: ${logs}`);
    try {
      const response = await fetch(origin + '/api/workspace');
      if (response.ok && response.headers.get('x-graspportable') === '1') {
        const host = await (await fetch(origin + '/api/host')).json(); assert.equal(host.path, database);
        if (process.platform === 'win32') {
          // Windows restricted environments can deny taskkill /T's system-wide
          // process-tree query. Resolve only our verified loopback listener.
          const sockets = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
          const listener = sockets.split('\n').find(line => line.includes(`127.0.0.1:${port} `) && line.includes('LISTENING'));
          assert.ok(listener); hostPid = Number(listener.trim().split(/\s+/).at(-1));
        }
        return await response.json();
      }
    } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
    await new Promise(done => setTimeout(done, 50));
  }
  throw new Error(`Package startup timeout: ${logs}`);
}
async function stop() {
  if (!launcher || launcher.exitCode !== null) return;
  const ended = once(launcher, 'exit');
  if (process.platform === 'win32') {
    if (hostPid) process.kill(hostPid);
    else launcher.kill();
  } else launcher.kill('SIGTERM');
  await ended;
  hostPid = undefined;
}

try {
  const packagedFiles = walk(source);
  assert.ok(!packagedFiles.some(file => /(?:node_modules|workspaces)(?:\\|\/)|\.db(?:-|$)|\.env(?:\.|$)/i.test(file)), 'Package must not contain dependencies, workspaces or credentials.');
  const builtHost = readFileSync(join(source, 'dist/server.mjs'), 'utf8');
  const imports = [...builtHost.matchAll(/^import\s.+?from\s+["']([^"']+)["']/gm)].map(match => match[1]);
  assert.ok(imports.length > 0 && imports.every(name => name.startsWith('node:')), 'Production host must import Node builtins only.');
  cpSync(source, folder, { recursive: true });
  assert.ok(!existsSync(join(folder, 'node_modules')));
  try { await fetch(origin, { signal: AbortSignal.timeout(500) }); throw new Error(`Port ${port} is already in use.`); } catch (error) { if (error.message.includes('already in use')) throw error; }
  let workspace = await start();
  const html = await (await fetch(origin)).text(); assert.match(html, /GraspPortable/);
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) {
    const response = await fetch(origin + match[1]); assert.equal(response.status, 200); assert.ok((await response.arrayBuffer()).byteLength > 0); assets.push(match[1]);
  }
  assert.ok(assets.length >= 2);
  const note = workspace.notes[0];
  const response = await fetch(origin + '/api/notes/' + note.id, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Grasp-Workspace': workspace.id }, body: JSON.stringify({ title: 'Package restart proof', markdown: '# Packaged product\n\n@name = "中文保存"\n{{name}}', revision: note.revision }) });
  assert.equal(response.status, 200); workspace = await response.json();
  const exported = await (await fetch(origin + '/api/export')).text(); assert.ok(exported.includes('中文保存'));
  await stop(); const reopened = await start(); assert.deepEqual(reopened, workspace);
  const evidence = { timestamp: new Date().toISOString(), node: process.version, platform: process.platform, source: basename(source), packagedFiles: packagedFiles.length, staticAssetsLoaded: assets.length, builtinHostImports: imports, isolatedOutsideRepository: true, installedDependenciesRequired: false, launcherStarted: true, databaseWriteExportRestart: 'passed', privateFilesAbsent: true };
  mkdirSync(join(root, 'docs/benchmarks'), { recursive: true });
  writeFileSync(join(root, 'docs/benchmarks/package-smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await stop();
  const resolved = resolve(folder), temp = resolve(tmpdir());
  assert.ok(resolved.startsWith(temp + sep) && basename(resolved).startsWith('grasp-package-smoke-'));
  rmSync(resolved, { recursive: true, force: true });
}
