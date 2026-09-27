import { build } from 'vite';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const buildId = randomUUID();
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await build({
  configFile: false,
  define: { __GRASP_BUILD_ID__: JSON.stringify(buildId) },
  build: { ssr: 'server/main.ts', outDir: 'dist', emptyOutDir: false, rolldownOptions: { output: { entryFileNames: 'server.mjs' } } },
  ssr: { noExternal: [/^@lezer\//] },
});
await writeFile('dist/build-info.json', JSON.stringify({ format: 'grasp-build', version: 1, buildId, productVersion: version }) + '\n');
