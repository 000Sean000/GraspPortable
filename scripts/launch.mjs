import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('GraspPortable requires Node.js 24 or newer.');
const port = Number(process.env.PORT || 43821);
const url = `http://127.0.0.1:${port}`;
async function available() {
  try { const response = await fetch(url + '/api/workspace', { signal: AbortSignal.timeout(1000) }); return response.ok && response.headers.get('x-graspportable') === '1'; } catch { return false; }
}
function openBrowser() {
  if (process.env.GRASP_NO_BROWSER === '1') return;
  const command = process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const browser = spawn(command[0], command[1], { stdio: 'ignore', windowsHide: true, detached: true });
  browser.on('error', () => console.log(`Open ${url} in your browser.`)); browser.unref();
}
if (await available()) { console.log(`GraspPortable is already running: ${url}`); openBrowser(); }
else {
  const child = spawn(process.execPath, ['dist/server.mjs', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
  child.on('exit', code => { process.exitCode = code || 0; });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`GraspPortable exited with ${child.exitCode}.`);
    if (await available()) { console.log('Keep this window open. Press Ctrl+C to stop. Your saved data stays in SQLite.'); openBrowser(); break; }
    if (attempt === 99) { child.kill(); throw new Error(`Startup timed out. Check ${url} and the log above.`); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
