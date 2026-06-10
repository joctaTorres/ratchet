/**
 * Module discovery for nested planning homes.
 *
 * The root planning home of a monorepo can contain nested `.ratchet`
 * directories ("modules"). `discoverModules` scans the filesystem below the
 * root for those nested homes so they are visible without manual registration.
 *
 * Discovery is the source of truth; an optional `modules:` registry in the root
 * `config.yaml` only produces lint warnings (see `reconcileModuleRegistry`).
 *
 * Rules:
 * - Bounded fast-glob scan for `*\/.ratchet` directories below the root.
 * - Skip `node_modules`, `.git`, and gitignored paths.
 * - Do not descend past a found module: a module's own nested homes are its
 *   business, not the root's (one level of parent/child per resolution).
 * - Module name defaults to the POSIX relative path from root to module; a
 *   module `config.yaml` `name:` field overrides it. Duplicate names error.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';

import { RATCHET_DIR_NAME } from './config.js';
import {
  type PlanningHome,
  relativeModulePath,
} from './planning-home.js';
import { readModuleName } from './project-config.js';

const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**'];

export interface DiscoveredModule {
  /** The module's planning home. */
  home: PlanningHome;
  /** Resolved module name (config `name:` override, else relative path). */
  moduleName: string;
  /** POSIX relative path from root to module (the default name). */
  relativePath: string;
}

function makeModuleHome(rootHome: PlanningHome, moduleRoot: string): PlanningHome {
  return {
    kind: 'repo',
    root: moduleRoot,
    changesDir: path.join(moduleRoot, RATCHET_DIR_NAME, 'changes'),
    defaultSchema: rootHome.defaultSchema,
    parent: rootHome,
  };
}

/**
 * Parse the root `.gitignore` (if present) into fast-glob ignore globs. This is
 * a best-effort translation good enough for the common directory-ignore case
 * (e.g. `dist/`, `build`, `tmp/`); it is not a full gitignore implementation.
 */
function gitignoreGlobs(rootDir: string): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf-8');
  } catch {
    return [];
  }

  const globs: string[] = [];
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (line.startsWith('!')) continue; // negations not supported (best-effort)
    // Strip trailing slash (directory marker) and any leading slash (anchor).
    const cleaned = line.replace(/\/+$/, '').replace(/^\/+/, '');
    if (cleaned.length === 0) continue;
    if (cleaned.includes('/')) {
      globs.push(`**/${cleaned}/**`, `${cleaned}/**`);
    } else {
      globs.push(`**/${cleaned}/**`);
    }
  }
  return globs;
}

/**
 * Discover nested planning homes below `rootHome` by filesystem scan.
 *
 * Returns modules sorted by their relative path. The `name:` override and
 * duplicate-name detection are applied here so callers always receive resolved
 * names. A duplicate module name throws.
 */
export async function discoverModules(rootHome: PlanningHome): Promise<DiscoveredModule[]> {
  const rootDir = rootHome.root;

  let matches: string[] = [];
  try {
    matches = await fg(`**/${RATCHET_DIR_NAME}`, {
      cwd: rootDir,
      onlyDirectories: true,
      dot: true,
      followSymbolicLinks: false,
      ignore: [...DEFAULT_IGNORE, ...gitignoreGlobs(rootDir)],
      suppressErrors: true,
    });
  } catch {
    matches = [];
  }

  // Each match is a `<relpath>/.ratchet` directory; the module root is its
  // parent. Drop the root's own `.ratchet` (relpath === RATCHET_DIR_NAME).
  const moduleRoots: string[] = [];
  for (const rel of matches) {
    const normalized = rel.split(path.sep).join('/');
    if (normalized === RATCHET_DIR_NAME) continue; // root home itself
    const moduleRel = normalized.replace(new RegExp(`/?${RATCHET_DIR_NAME}$`), '');
    if (moduleRel.length === 0) continue;
    moduleRoots.push(path.join(rootDir, moduleRel));
  }

  // Sort by depth then path so parents are seen before their descendants.
  moduleRoots.sort((a, b) => a.localeCompare(b));

  // Drop any module nested below an already-accepted module (no descent past a
  // found module).
  const accepted: string[] = [];
  for (const moduleRoot of moduleRoots) {
    const isNestedBelowAccepted = accepted.some(
      (parent) => moduleRoot === parent || moduleRoot.startsWith(parent + path.sep)
    );
    if (!isNestedBelowAccepted) {
      accepted.push(moduleRoot);
    }
  }

  const modules: DiscoveredModule[] = [];
  const seenNames = new Map<string, string>(); // name -> first module relative path
  for (const moduleRoot of accepted) {
    const relativePath = relativeModulePath(rootDir, moduleRoot);
    const override = readModuleName(moduleRoot);
    const moduleName = override ?? relativePath;

    const existing = seenNames.get(moduleName);
    if (existing !== undefined) {
      throw new Error(
        `Duplicate module name '${moduleName}' (used by '${existing}' and '${relativePath}'). ` +
          `Module names must be unique; set a distinct 'name:' in the module's .ratchet/config.yaml.`
      );
    }
    seenNames.set(moduleName, relativePath);

    const home = makeModuleHome(rootHome, moduleRoot);
    home.moduleName = moduleName;
    modules.push({ home, moduleName, relativePath });
  }

  modules.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return modules;
}
