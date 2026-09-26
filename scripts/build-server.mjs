import { build } from 'vite';
await build({
  configFile: false,
  build: { ssr: 'server/main.ts', outDir: 'dist', emptyOutDir: false, rolldownOptions: { output: { entryFileNames: 'server.mjs' } } },
  ssr: { noExternal: [/^@lezer\//] },
});
