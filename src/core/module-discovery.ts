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
  getRootPlanningHome,
  relativeModulePath,
  resolveCurrentPlanningHomeSync,
  toPosix,
  type ResolvePlanningHomeOptions,
} from './planning-home.js';
import { readModuleName, readModuleRegistry } from './project-config.js';

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
    batchesDir: path.join(moduleRoot, RATCHET_DIR_NAME, 'batches'),
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
 *
 * Note: this is an intentionally uncached, full filesystem scan re-run on every
 * command. Module sets are small and discovery is cheap relative to the I/O the
 * surrounding command already does; caching would add mtime/invalidation
 * complexity for negligible benefit (mirrors the readProjectConfig rationale).
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
    const normalized = toPosix(rel);
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

/**
 * Discover modules, degrading any discovery failure (including a duplicate
 * module name) to a non-fatal warning and an empty result.
 *
 * This is the uniform policy for *incidental* cross-module aggregation: a
 * malformed module set (e.g. two modules sharing a `name:`) must not hard-crash
 * an otherwise-unrelated command. Commands that aggregate modules as a side
 * effect (`list`, archive-time link materialization, `--module` resolution)
 * route through here so a single broken module is diagnosable but not fatal.
 * Use `discoverModules` directly only when the failure should propagate.
 */
export async function discoverModulesSafe(rootHome: PlanningHome): Promise<DiscoveredModule[]> {
  try {
    return await discoverModules(rootHome);
  } catch (error) {
    console.warn(`Module discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Compare discovered modules against the root `modules:` registry and return
 * lint warnings. The registry is an optional allowlist — discovery is always
 * the source of truth, so every warning here is non-fatal:
 *
 * - discovered-but-unregistered: a nested `.ratchet` exists on disk but is not
 *   listed (only reported when a registry is declared at all).
 * - registered-but-missing: a registry entry has no `.ratchet` on disk.
 *
 * Returns an empty list when no registry is declared, so single-home and
 * unregistered monorepos produce no warnings.
 */
export function reconcileModuleRegistry(
  rootHome: PlanningHome,
  modules: DiscoveredModule[]
): string[] {
  const registry = readModuleRegistry(rootHome.root);
  if (registry === undefined) {
    // No registry declared — nothing to lint against.
    return [];
  }

  const registered = new Set(registry);
  const discoveredPaths = new Set(modules.map((m) => m.relativePath));
  const warnings: string[] = [];

  // Discovered but not registered.
  for (const mod of modules) {
    if (!registered.has(mod.relativePath)) {
      warnings.push(`Module '${mod.relativePath}' is not registered in the root config 'modules:' list.`);
    }
  }

  // Registered but missing on disk.
  for (const entry of registry) {
    if (!discoveredPaths.has(entry)) {
      warnings.push(`Registered module '${entry}' has no .ratchet directory on disk.`);
    }
  }

  return warnings;
}

export interface ResolveCommandHomeOptions extends ResolvePlanningHomeOptions {
  /** Module name to target (from the shared `--module` flag). */
  module?: string;
}

/**
 * Resolve the planning home a change-scoped command should operate on.
 *
 * Without `--module`, this is the nearest-wins home (today's behavior). With
 * `--module <name>`, it resolves the *root* home from cwd, runs discovery, and
 * substitutes the matched module's home — so a module can be addressed from
 * anywhere in the repo. An unknown name throws with the discovered-name list.
 */
export async function resolvePlanningHomeForCommand(
  options: ResolveCommandHomeOptions = {}
): Promise<PlanningHome> {
  const { module: moduleName, ...resolveOptions } = options;
  const nearest = resolveCurrentPlanningHomeSync(resolveOptions);

  if (!moduleName) {
    return nearest;
  }

  // Address a module from the root: discovery is rooted at the topmost home.
  // Use the safe variant so a duplicate name elsewhere in the repo degrades to
  // a warning rather than crashing this command before it can report whether
  // the requested module exists.
  const rootHome = getRootPlanningHome(nearest);
  const modules = await discoverModulesSafe(rootHome);
  const match = modules.find((m) => m.moduleName === moduleName);

  if (!match) {
    const known =
      modules.length > 0
        ? modules.map((m) => m.moduleName).join(', ')
        : '(none discovered)';
    throw new Error(
      `Unknown module '${moduleName}'. Discovered modules: ${known}`
    );
  }

  return match.home;
}
