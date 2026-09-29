import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`;

export function isWithin(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

/** Resolve existing ancestors too: a symlink/junction must not redirect artifacts into the repository. */
export function resolvePhysicalPath(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync.native(absolute);
  const parent = dirname(absolute);
  if (parent === absolute) throw new Error('Evidence path has no accessible existing ancestor.');
  return resolve(resolvePhysicalPath(parent), relative(parent, absolute));
}

export function assertOutsideRepository(path: string, repo = repositoryRoot): string {
  const physical = resolvePhysicalPath(path);
  if (isWithin(resolvePhysicalPath(repo), physical)) throw new Error('Generated evidence must be outside the source repository.');
  return physical;
}

/** Historical reports are never overwritten. Explicit roots still receive a per-process run directory. */
export function evidenceDirectory(scope: string): string {
  if (!/^[a-z0-9-]+$/.test(scope)) throw new Error('Evidence scope must be a fixed lowercase name.');
  const requested = process.env.GRASP_EVIDENCE_ROOT;
  if (requested && !isAbsolute(requested)) throw new Error('GRASP_EVIDENCE_ROOT must be absolute.');
  const root = assertOutsideRepository(requested ?? resolve(repositoryRoot, '..', 'Scratch', 'Evidence'));
  const directory = resolve(root, runId, scope);
  mkdirSync(directory, { recursive: true });
  return directory;
}
