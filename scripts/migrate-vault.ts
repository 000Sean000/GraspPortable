import { applyVault, MigrationError, planVault, writeVaultReport } from '../server/migration.js';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node --import tsx scripts/migrate-vault.ts --source=<copied-scratch-vault> --output=<private-report-directory> [--apply=<new-database-path>]\nAssets stream through a private <database>.migration checkpoint. Rerun the identical command to resume a verified unchanged source; an existing unrelated database is never overwritten.');
} else {
  try {
    const options = new Map<string, string>();
    for (let at = 0; at < args.length; at++) {
      const equal = args[at].indexOf('='), key = equal < 0 ? args[at] : args[at].slice(0, equal);
      const value = equal < 0 ? args[++at] : args[at].slice(equal + 1);
      if (!['--source', '--output', '--apply'].includes(key) || !value || value.startsWith('--') || options.has(key)) throw new MigrationError('arguments', 'Use --source, --output, and optional --apply with explicit paths.');
      options.set(key, value);
    }
    if (!options.has('--source') || !options.has('--output')) throw new MigrationError('arguments', 'Both --source and --output are required. Preview is the default; --apply must name a new database.');
    const plan = await planVault(options.get('--source')!);
    await writeVaultReport(plan, options.get('--output')!);
    const applied = options.has('--apply') ? await applyVault(plan, options.get('--apply')!) : undefined;
    console.log(JSON.stringify({ mode: applied ? 'applied-to-new-database' : 'preview-only', counts: plan.report.counts, links: plan.report.links, unsupportedPatterns: plan.report.unsupported.length, sourceFingerprint: plan.report.sourceFingerprint,
      memory: plan.report.memory, privateReportWritten: true, ...(applied ? { checkpointSaved: true, copiedAssets: applied.copiedAssets, resumedAssets: applied.resumedAssets } : {}) }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof MigrationError ? error.code : 'migration-failed', message: error instanceof MigrationError ? error.message : 'Migration failed; inspect the private output directory. Source names/content are not printed.' }));
    process.exitCode = 1;
  }
}
