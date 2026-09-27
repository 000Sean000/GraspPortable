import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const root = process.cwd();
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (!existsSync('dist/server.mjs')) throw new Error('Run npm run build before packaging.');
if (!existsSync('dist/build-info.json')) throw new Error('Build identity is missing. Run npm run build before packaging.');
const buildInfo = JSON.parse(readFileSync('dist/build-info.json', 'utf8'));
if (buildInfo.format !== 'grasp-build' || buildInfo.version !== 1 || buildInfo.productVersion !== pkg.version || typeof buildInfo.buildId !== 'string') throw new Error('Build identity/version does not match this package. Run npm run build before packaging.');
const documentation = ['DECISIONS.md', 'LIMITATIONS.md', 'PERFORMANCE.md', 'VERIFICATION.md', 'PHASE2-PLAN.md', 'PHASE2-VERIFICATION.md', 'FILES-PERFORMANCE.md', 'IMPLEMENTATION-CONTRACT.md', 'USAGE-LOG.md', 'ACCEPTANCE.md', 'EXECUTION-STATE.md', 'GOAL-PLAN.md', 'BINDING-EDITING-CONTRACT.md', 'SHARED-VALUE-CONTRACT.md', 'PROJECTION-CONTRACT.md', 'REFERENCE-HOST-GATE.md'];
for (const name of documentation) if (!existsSync(join('docs', name))) throw new Error(`Required delivery document missing: docs/${name}`);
// Only explicitly public migration reports enter the package, never .cache/private rehearsal files.
documentation.push(...readdirSync('docs').filter(name => /^MIGRATION(?:-[A-Za-z0-9_-]+)?\.md$/i.test(name)));
documentation.push(...readdirSync('docs').filter(name => /^M[1-4]-(?:VERIFICATION|PERFORMANCE)\.md$/i.test(name)));
const seed = ['README.md', ...readdirSync('docs/Project_Seed').filter(name => /^GraspPortable-Core-(?:Requirements|Development-Method)-.*\.md$/.test(name))];
if (seed.length !== 3) throw new Error('Expected the current Seed README and exactly one Requirements/Development Method pair.');
const destination = resolve('artifacts', `GraspPortable-${pkg.version}`);
if (existsSync(destination)) throw new Error(`Refusing to reuse existing package directory: ${destination}. It may contain workspace data. Move the existing package aside or choose a new version; no package files were changed.`);
mkdirSync(dirname(destination), { recursive: true });
// Non-recursive mkdir is exclusive: a concurrent packaging run cannot silently
// merge into a directory created after the existence check.
mkdirSync(destination);
for (const path of ['dist', 'Start-GraspPortable.cmd', 'README.md', 'ARCHITECTURE.md']) cpSync(path, join(destination, path), { recursive: true });
mkdirSync(join(destination, 'scripts'), { recursive: true });
cpSync('scripts/launch.mjs', join(destination, 'scripts/launch.mjs'));
mkdirSync(join(destination, 'docs'), { recursive: true });
for (const name of documentation) cpSync(join('docs', name), join(destination, 'docs', name));
mkdirSync(join(destination, 'docs/Project_Seed'));
for (const name of seed) cpSync(join('docs/Project_Seed', name), join(destination, 'docs/Project_Seed', name));
if (existsSync('docs/benchmarks')) cpSync('docs/benchmarks', join(destination, 'docs/benchmarks'), { recursive: true });
const notices = ['GraspPortable third-party notices', 'Production host requires an independently installed Node.js 24+ runtime.', 'Browser bundle and Markdown parser include the following packages:', ''];
const seen = new Set();
function visit(name) {
  if (seen.has(name)) return; seen.add(name);
  const directory = join(root, 'node_modules', name);
  const dependency = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  notices.push(`--- ${dependency.name} ${dependency.version} (${dependency.license || 'see license'}) ---`);
  for (const filename of readdirSync(directory).filter(n => /^(license|copying|notice)(\.|$)/i.test(n))) notices.push(readFileSync(join(directory, filename), 'utf8'));
  for (const child of Object.keys(dependency.dependencies || {})) visit(child);
}
for (const name of Object.keys(pkg.dependencies)) visit(name);
writeFileSync(join(destination, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'));
writeFileSync(join(destination, 'PACKAGE-INFO.txt'), `GraspPortable ${pkg.version}\nBuild identity ${buildInfo.buildId}\nPackaged ${new Date().toISOString()}\nNo user workspaces, private migration files, secrets or node_modules are included.\nRequires an independently installed Node.js >=24.0.0.\nWindows: Start-GraspPortable.cmd\nOther desktop: node scripts/launch.mjs\nGRASP_WORKSPACE selects an explicit database; PORT selects the local host port. A different running build/workspace is rejected, never terminated automatically.\nCopy a workspace only while its host is closed. For a complete backup copy the whole Workspace directory, including .grasp and Markdown (with its hidden .grasp-export directory).\nWorkspace/.grasp/workspace.grasp.db owns committed notes, records, attachment bytes, semantic state, durable drafts and strategy. Markdown is the last successful readable projection and may lag the DB; preserve external edits and recovery materials by copying the whole workspace.\nA complete Markdown/.grasp-export/manifest.json and all referenced payloads can rebuild a new DB without the original DB. Selected exports do not promise full rebuild.\nRebuild only into a new database; preserve the original database and file tree. Same-disk fallback is not an off-device backup.\n`);
console.log(destination);
