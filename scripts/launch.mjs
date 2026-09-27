import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('GraspPortable requires Node.js 24 or newer.');
const port = Number(process.env.PORT || 43821);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const url = `http://127.0.0.1:${port}`;
let expectedBuild;
try { expectedBuild = JSON.parse(await readFile('dist/build-info.json', 'utf8')); }
catch { throw new Error('Build identity is missing. Run npm run build in the source checkout, or use a complete GraspPortable package.'); }
if (expectedBuild.format !== 'grasp-build' || expectedBuild.version !== 1 || typeof expectedBuild.buildId !== 'string' || !/^[a-f0-9-]{36}$/.test(expectedBuild.buildId)) throw new Error('Build identity is invalid. Rebuild or use a complete package.');
const args = process.argv.slice(2), workspaceAt = args.indexOf('--workspace');
if (workspaceAt >= 0 && (!args[workspaceAt + 1] || args[workspaceAt + 1].startsWith('--'))) throw new Error('--workspace requires a database path.');
const requestedWorkspace = workspaceAt >= 0 ? args[workspaceAt + 1] : process.env.GRASP_WORKSPACE;
async function workspaceKey(path) {
  let current = resolve(path); const missing = [];
  for (;;) {
    try { current = resolve(await realpath(current), ...missing); break; }
    catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = dirname(current); if (parent === current) throw error;
      missing.unshift(basename(current)); current = parent;
    }
  }
  return process.platform === 'win32' ? current.replace(/^\\\\\?\\/, '').toLowerCase() : current;
}
const requestedKey = requestedWorkspace ? await workspaceKey(requestedWorkspace) : undefined;
const action = `Close the existing host yourself, or choose another PORT, then launch again. No existing process was stopped. (${url})`;
async function probe() {
  let response;
  try { response = await fetch(url + '/api/host', { signal: AbortSignal.timeout(1000) }); }
  catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return { kind: 'absent' };
    return { kind: 'blocked', message: `The port did not provide a verifiable GraspPortable host. ${action}` };
  }
  if (!response.ok || response.headers.get('x-graspportable') !== '1') return { kind: 'blocked', message: `The port is occupied by another or unavailable service. ${action}` };
  if (response.headers.get('x-graspportable-build') !== expectedBuild.buildId) return { kind: 'blocked', message: `A different or unidentified GraspPortable build is running. ${action}` };
  let host;
  try { host = await response.json(); }
  catch { return { kind: 'blocked', message: `The running host returned invalid workspace information. ${action}` }; }
  if (requestedKey && (typeof host.path !== 'string' || await workspaceKey(host.path) !== requestedKey)) return { kind: 'blocked', message: `The running host has a different workspace. Requested: ${resolve(requestedWorkspace)}; running: ${typeof host.path === 'string' ? host.path : '(unknown)'}. ${action}` };
  // A matching host's recovery UI remains usable if its selected DB cannot open.
  return { kind: 'matching' };
}
function openBrowser() {
  if (process.env.GRASP_NO_BROWSER === '1') return;
  const command = process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const browser = spawn(command[0], command[1], { stdio: 'ignore', windowsHide: true, detached: true });
  browser.on('error', () => console.log(`Open ${url} in your browser.`)); browser.unref();
}
const initial = await probe();
if (initial.kind === 'blocked') throw new Error(initial.message);
if (initial.kind === 'matching') { console.log(`GraspPortable is already running with the requested build and workspace: ${url}`); openBrowser(); }
else {
  const child = spawn(process.execPath, ['dist/server.mjs', ...args], { stdio: 'inherit', windowsHide: true });
  child.on('exit', code => { process.exitCode = code || 0; });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`GraspPortable exited before readiness (${child.exitCode ?? child.signalCode}).`);
    const state = await probe();
    if (state.kind === 'matching') { console.log('Keep this window open. Press Ctrl+C to stop. Your saved data stays in SQLite.'); openBrowser(); break; }
    if (state.kind === 'blocked') { child.kill(); throw new Error(state.message); } // Only our newly created child is stopped.
    if (attempt === 99) { child.kill(); throw new Error(`Startup timed out. Check ${url} and the log above.`); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
