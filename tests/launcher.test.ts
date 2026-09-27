import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile), roots: string[] = [], hosts: Server[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'grasp-launch-')); roots.push(root);
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'dist'));
  await copyFile(resolve('scripts/launch.mjs'), join(root, 'scripts/launch.mjs'));
  const buildId = randomUUID();
  await writeFile(join(root, 'dist/build-info.json'), JSON.stringify({ format: 'grasp-build', version: 1, buildId, productVersion: '0.3.0' }));
  // Any unexpected attempt to start a second host is a regression.
  await writeFile(join(root, 'dist/server.mjs'), 'throw new Error("UNEXPECTED_SECOND_HOST");');
  return { root, buildId, workspace: join(root, 'workspace', '.grasp', 'workspace.grasp.db') };
}
async function host(buildId: string | undefined, body: unknown, grasp = true) {
  const server = createServer((_req, res) => {
    if (grasp) res.setHeader('X-GraspPortable', '1');
    if (buildId) res.setHeader('X-GraspPortable-Build', buildId);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
  }); hosts.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected localhost port');
  return { port: address.port, url: `http://127.0.0.1:${address.port}` };
}
async function launch(root: string, port: number, workspace?: string, args: string[] = []) {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), GRASP_NO_BROWSER: '1' };
  if (workspace === undefined) delete env.GRASP_WORKSPACE; else env.GRASP_WORKSPACE = workspace;
  try { const result = await run(process.execPath, [join(root, 'scripts/launch.mjs'), ...args], { cwd: root, env, timeout: 8000, windowsHide: true }); return { ...result, code: 0 }; }
  catch (error) { const result = error as { stdout: string; stderr: string; code: number | string }; return result; }
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(server => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); })));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('production launcher host identity', () => {
  it('reuses the exact build and requested workspace, including a recovery UI with a missing DB', async () => {
    const f = await fixture(), h = await host(f.buildId, { path: f.workspace, error: 'DB unavailable', unavailablePath: f.workspace });
    const result = await launch(f.root, h.port, join(f.root, 'workspace', '.', '.grasp', 'workspace.grasp.db'));
    expect(result.code).toBe(0); expect(result.stdout).toContain('already running with the requested build and workspace');
    expect((await fetch(h.url + '/api/host')).ok).toBe(true);
  });
  it('rejects a different workspace without starting a replacement or stopping the existing host', async () => {
    const f = await fixture(), h = await host(f.buildId, { path: join(f.root, 'other.db') });
    const result = await launch(f.root, h.port, f.workspace);
    expect(result.code).not.toBe(0); expect(result.stderr).toContain('different workspace'); expect(result.stderr).toContain('choose another PORT');
    expect(result.stderr).not.toContain('UNEXPECTED_SECOND_HOST'); expect((await fetch(h.url)).ok).toBe(true);
  });
  it.each(['different', 'unidentified'])('rejects a %s build and preserves the existing host', async kind => {
    const f = await fixture(), h = await host(kind === 'different' ? randomUUID() : undefined, { path: f.workspace });
    const result = await launch(f.root, h.port, f.workspace);
    expect(result.code).not.toBe(0); expect(result.stderr).toContain('different or unidentified GraspPortable build');
    expect(result.stderr).not.toContain('UNEXPECTED_SECOND_HOST'); expect((await fetch(h.url)).ok).toBe(true);
  });
  it('does not mistake another HTTP service for Grasp or stop it', async () => {
    const f = await fixture(), h = await host(f.buildId, {}, false), result = await launch(f.root, h.port, f.workspace);
    expect(result.code).not.toBe(0); expect(result.stderr).toContain('another or unavailable service'); expect((await fetch(h.url)).ok).toBe(true);
  });
  it('honors explicit --workspace before the environment default', async () => {
    const f = await fixture(), h = await host(f.buildId, { path: f.workspace });
    const result = await launch(f.root, h.port, join(f.root, 'wrong.db'), ['--workspace', f.workspace]);
    expect(result.code).toBe(0);
  });
  it('requires a build manifest even when an apparently healthy host already exists', async () => {
    const f = await fixture(), h = await host(f.buildId, { path: f.workspace });
    await rm(join(f.root, 'dist/build-info.json'));
    const result = await launch(f.root, h.port, f.workspace);
    expect(result.code).not.toBe(0); expect(result.stderr).toContain('Build identity is missing'); expect((await fetch(h.url)).ok).toBe(true);
  });
  it('starts and verifies its own child on an unused port', async () => {
    const f = await fixture(), reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Expected port');
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    await writeFile(join(f.root, 'dist/server.mjs'), `import { createServer } from 'node:http';
const server=createServer((q,r)=>{r.setHeader('X-GraspPortable','1');r.setHeader('X-GraspPortable-Build',${JSON.stringify(f.buildId)});r.end(JSON.stringify({path:process.env.GRASP_WORKSPACE}));});
server.listen(Number(process.env.PORT),'127.0.0.1');setTimeout(()=>server.close(),700);`);
    const result = await launch(f.root, address.port, f.workspace);
    expect(result.code).toBe(0); expect(result.stdout).toContain('Keep this window open');
  });
});
