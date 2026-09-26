import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const root = process.cwd();
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (!existsSync('dist/server.mjs')) throw new Error('Run npm run build before packaging.');
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
for (const name of ['DECISIONS.md', 'LIMITATIONS.md', 'PERFORMANCE.md', 'VERIFICATION.md']) if (existsSync(join('docs', name))) cpSync(join('docs', name), join(destination, 'docs', name));
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
writeFileSync(join(destination, 'PACKAGE-INFO.txt'), `GraspPortable ${pkg.version}\nBuilt ${new Date().toISOString()}\nNo user workspaces, secrets or node_modules are included.\nRequires Node.js >=24.0.0.\nWindows: Start-GraspPortable.cmd\nOther desktop: node scripts/launch.mjs\nCopy workspace only while its host is closed.\n`);
console.log(destination);
