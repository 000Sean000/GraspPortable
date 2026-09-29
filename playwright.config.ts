import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidenceDirectory } from './scripts/evidence-path';
const evidenceRoot = evidenceDirectory('playwright');
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 60000,
  outputDir: resolve(evidenceRoot, 'test-results'),
  expect: { timeout: 10000 }, reporter: [['list'], ['json', { outputFile: resolve(evidenceRoot, 'e2e-results.json') }]],
  use: { channel: process.platform === 'win32' && existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe') ? 'msedge' : undefined, headless: true, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
