import * as fs from 'node:fs';
import { RATCHET_DIR_NAME, DEFAULT_SCHEMA_NAME } from './config.js';
import * as path from 'node:path';

import { FileSystemUtils } from '../utils/file-system.js';

export type PlanningHomeKind = 'repo' | 'workspace';

export interface PlanningHome {
  kind: PlanningHomeKind;
  root: string;
  changesDir: string;
  batchesDir: string;
  defaultSchema: string;
  /**
   * The enclosing planning home, if any. A home whose walk-up finds another
   * `.ratchet` directory above it is a *module*; the topmost home is the
   * *root*. Resolved lazily via {@link getParentPlanningHome} (continuing the
   * walk-up past this home's root) so single-home repos pay nothing and keep
   * identical behavior. `undefined` means "not yet resolved"; a resolved home
   * with no enclosing home reports `null`.
   */
  parent?: PlanningHome | null;
  /**
   * The module name for a home that has a parent: the POSIX-style relative path
   * from the root home to this home, unless overridden by `name:` in the
   * module's `config.yaml`. Undefined for root (parent-less) homes.
   */
  moduleName?: string;
}

export interface ResolvePlanningHomeOptions {
  startPath?: string;
  allowImplicitRepoRoot?: boolean;
}

const REPO_DEFAULT_SCHEMA = DEFAULT_SCHEMA_NAME;

function pathExistsAsDirectory(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function getSearchStartDirectory(startPath: string): string {
  const resolved = path.resolve(startPath);

  try {
    const stats = fs.statSync(resolved);
    const searchStart = stats.isDirectory() ? resolved : path.dirname(resolved);
    return FileSystemUtils.canonicalizeExistingPath(searchStart);
  } catch {
    return resolved;
  }
}

function findNearestAncestor(startPath: string, predicate: (dirPath: string) => boolean): string | null {
  let currentDir = getSearchStartDirectory(startPath);

  while (true) {
    if (predicate(currentDir)) {
      return FileSystemUtils.canonicalizeExistingPath(currentDir);
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export function findRepoPlanningRootSync(startPath = process.cwd()): string | null {
  return findNearestAncestor(startPath, (dirPath) =>
    pathExistsAsDirectory(path.join(dirPath, RATCHET_DIR_NAME))
  );
}

function isWindowsLikePath(candidatePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(candidatePath) || candidatePath.startsWith('\\\\');
}

function relativePlanningPath(fromPath: string, toPath: string): string {
  if (isWindowsLikePath(fromPath) || isWindowsLikePath(toPath)) {
    return path.win32.relative(path.win32.normalize(fromPath), path.win32.normalize(toPath));
  }

  return path.posix.relative(fromPath.replace(/\\/g, '/'), toPath.replace(/\\/g, '/'));
}

function repoPlanningHome(repoRoot: string): PlanningHome {
  return {
    kind: 'repo',
    root: repoRoot,
    changesDir: path.join(repoRoot, RATCHET_DIR_NAME, 'changes'),
    batchesDir: path.join(repoRoot, RATCHET_DIR_NAME, 'batches'),
    defaultSchema: REPO_DEFAULT_SCHEMA,
  };
}

export function resolveCurrentPlanningHomeSync(
  options: ResolvePlanningHomeOptions = {}
): PlanningHome {
  const startPath = options.startPath ?? process.cwd();
  const searchStart = getSearchStartDirectory(startPath);
  const repoRoot = findRepoPlanningRootSync(searchStart);

  if (repoRoot) {
    return repoPlanningHome(repoRoot);
  }

  if (options.allowImplicitRepoRoot === false) {
    throw new Error('No Ratchet planning home found from the current directory.');
  }

  return repoPlanningHome(FileSystemUtils.canonicalizeExistingPath(searchStart));
}

/**
 * Normalize a path to POSIX separators (`/`). Use this whenever a path is split
 * on or compared as `/`, especially for `fast-glob` results: fast-glob always
 * emits `/`, but `path.sep` is `\` on Windows, so a bare `rel.split(path.sep)`
 * is a silent no-op there. Naming the conversion makes that contract explicit
 * and removes the duplicated `.split(path.sep).join('/')` idiom across the
 * callers (module discovery, project-config registry, relative module paths).
 */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * The POSIX-style relative path from a root home to a descendant home, used as
 * the default module name (e.g. `packages/api`).
 */
export function relativeModulePath(rootRoot: string, moduleRoot: string): string {
  return toPosix(relativePlanningPath(rootRoot, moduleRoot));
}

/**
 * Lazily resolve the enclosing planning home by continuing the walk-up past the
 * given home's root. Returns `null` when the home is the topmost `.ratchet`
 * (i.e. the root). The result is memoized on `planningHome.parent`.
 *
 * Single-home repositories resolve to `null` here and gain no module behavior.
 */
export function getParentPlanningHome(planningHome: PlanningHome): PlanningHome | null {
  if (planningHome.parent !== undefined) {
    return planningHome.parent;
  }

  const above = path.dirname(planningHome.root);
  let parentRoot: string | null = null;
  if (above !== planningHome.root) {
    parentRoot = findRepoPlanningRootSync(above);
  }

  const parent = parentRoot ? repoPlanningHome(parentRoot) : null;
  planningHome.parent = parent;
  return parent;
}

/**
 * Whether a home is a module (it has an enclosing planning home). Resolves the
 * parent lazily as a side effect, so callers can rely on `moduleName` after.
 */
export function isModulePlanningHome(planningHome: PlanningHome): boolean {
  return getParentPlanningHome(planningHome) !== null;
}

/**
 * The module name for a home: the POSIX-style relative path from the root home
 * to this home, memoized on `planningHome.moduleName`. Returns `undefined` for
 * a root (parent-less) home. A module's `config.yaml` `name:` override is
 * applied by discovery (see `discoverModules`), not here.
 */
export function getModuleName(planningHome: PlanningHome): string | undefined {
  if (planningHome.moduleName !== undefined) {
    return planningHome.moduleName;
  }
  const root = getRootPlanningHome(planningHome);
  if (root === planningHome) {
    return undefined;
  }
  const name = relativeModulePath(root.root, planningHome.root);
  planningHome.moduleName = name;
  return name;
}

/**
 * Resolve the root (topmost) planning home for a given home by walking parents.
 */
export function getRootPlanningHome(planningHome: PlanningHome): PlanningHome {
  let current = planningHome;
  let parent = getParentPlanningHome(current);
  while (parent) {
    current = parent;
    parent = getParentPlanningHome(current);
  }
  return current;
}

export function getChangeDir(planningHome: PlanningHome, changeName: string): string {
  return FileSystemUtils.joinPath(planningHome.changesDir, changeName);
}

export function formatChangeLocation(planningHome: PlanningHome, changeName: string): string {
  const changeDir = getChangeDir(planningHome, changeName);
  const relative = relativePlanningPath(planningHome.root, changeDir);
  return relative.length > 0 ? relative : changeDir;
}
