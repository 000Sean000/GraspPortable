import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createApi } from './api.js';

const port = Number(process.env.PORT || 43821);
const dev = process.argv.includes('--dev');
const workspaceArg = process.argv.indexOf('--workspace');
const defaultPath = workspaceArg >= 0 ? process.argv[workspaceArg + 1] : process.env.GRASP_WORKSPACE;
const api = createApi({ defaultPath });
const vite = dev ? await (await import('vite')).createServer({ server: { middlewareMode: true }, appType: 'spa' }) : undefined;
const webRoot = resolve('dist/web');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!expectedHosts.has(req.headers.host || '')) { res.writeHead(403); res.end('Local host only'); return; }
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) { res.writeHead(403); res.end('Origin rejected'); return; }
    if (req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end('Cross-site request rejected'); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-GraspPortable', '1');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (await api.handle(req, res)) return;
    if (vite) { vite.middlewares(req, res); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url || '/', 'http://localhost');
    let file = resolve(webRoot, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(webRoot + sep) && file !== webRoot) { res.writeHead(403); res.end(); return; }
    if (url.pathname === '/') file = resolve(webRoot, 'index.html');
    try { if (!(await stat(file)).isFile()) throw new Error('Not a file'); }
    catch { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unexpected server error' }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`GraspPortable: http://127.0.0.1:${port}${dev ? ' (development)' : ''}`));
server.on('error', error => { console.error(error); process.exitCode = 1; void api.close(); });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await vite?.close();
  server.close(async () => { try { await api.close(); process.exit(0); } catch (error) { console.error(error); process.exit(1); } });
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
