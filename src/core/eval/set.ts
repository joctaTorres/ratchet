/**
 * Enumerate eval cases from `.feature` files.
 *
 * One case per Scenario. The default scope is the permanent feature store
 * (`.ratchet/features/**`); flags widen or narrow it. The archive is never a
 * source. Parsing reuses {@link GherkinParser}; ids come from `case-id.ts`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { RATCHET_DIR_NAME } from '../config.js';
import { parseFeatureFile } from '../parsers/gherkin-parser.js';
import type { Step } from '../schemas/feature.schema.js';
import { assignCaseIds } from './case-id.js';

export interface EvalCase {
  /** Stable id: `<relative-feature-path-sans-ext>#<scenario-slug>`. */
  id: string;
  /** Feature name from the `Feature:` header. */
  feature: string;
  /** Scenario name. */
  scenario: string;
  /** Source `.feature` file, relative to the project root (posix). */
  source: string;
  /** Ordered Given/When/Then steps. */
  steps: Step[];
}

export type EvalScopeKind = 'store' | 'changes' | 'change' | 'path';

export interface EvalScope {
  kind: EvalScopeKind;
  /** For `change`: the change name. For `path`: the relative dir-or-file. */
  target?: string;
}

/** A root directory to enumerate feature files under, plus how a discovered
 * file maps to the id-relative path it is keyed by. */
interface ScopeRoot {
  /** Absolute directory (or file) to walk. */
  dir: string;
  /** Absolute base the case `source`/id path is relative to. */
  base: string;
}

function featureStoreDir(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'features');
}

function changesDir(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'changes');
}

/** Recursively collect `.feature` files under a directory (archive excluded by
 * never being a scope root). */
function collectFeatureFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (stat.isFile()) {
    return dir.endsWith('.feature') ? [dir] : [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFeatureFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.feature')) {
      out.push(full);
    }
  }
  return out.sort();
}

function listActiveChanges(projectRoot: string): string[] {
  const dir = changesDir(projectRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'archive')
    .map((e) => e.name)
    .sort();
}

function changeFeatureRoot(projectRoot: string, change: string): ScopeRoot {
  const dir = path.join(changesDir(projectRoot), change, 'features');
  return { dir, base: dir };
}

/** Resolve the scope into the set of roots to enumerate. */
function resolveScopeRoots(projectRoot: string, scope: EvalScope): ScopeRoot[] {
  const storeDir = featureStoreDir(projectRoot);
  const storeRoot: ScopeRoot = { dir: storeDir, base: storeDir };

  if (scope.kind === 'store') return [storeRoot];
  if (scope.kind === 'changes') {
    return [storeRoot, ...listActiveChanges(projectRoot).map((c) => changeFeatureRoot(projectRoot, c))];
  }
  if (scope.kind === 'change') {
    if (!scope.target) throw new Error('Scope kind "change" requires a change name.');
    return [changeFeatureRoot(projectRoot, scope.target)];
  }
  // path: narrow within the feature store, relative to its features dir.
  if (!scope.target) throw new Error('Scope kind "path" requires a target.');
  const stripped = scope.target.replace(/^features[/\\]/, '');
  return [{ dir: path.join(storeDir, stripped), base: storeDir }];
}

function ratchetRelative(file: string, projectRoot: string): string {
  // Ids/sources are anchored at the `.ratchet/` directory so they stay stable
  // and human-readable: store cases read `features/...`, change cases read
  // `changes/<name>/features/...`. Unambiguous across scopes, no collisions.
  const ratchetDir = path.join(projectRoot, RATCHET_DIR_NAME);
  return path.relative(ratchetDir, file).split(path.sep).join('/');
}

function casesFromFile(projectRoot: string, file: string): EvalCase[] {
  const content = readFileSync(file, 'utf-8');
  const feature = parseFeatureFile(content);
  const rel = ratchetRelative(file, projectRoot);
  const names = feature.scenarios.map((s) => s.name);
  const ids = assignCaseIds(rel, names);
  return feature.scenarios.map((scenario, i) => ({
    id: ids[i],
    feature: feature.name,
    scenario: scenario.name,
    source: rel,
    steps: scenario.steps,
  }));
}

/**
 * Discover and parse every in-scope `.feature` file into eval cases.
 * Cases are returned sorted by id for deterministic output across runs.
 */
export function enumerateEvalSet(projectRoot: string, scope: EvalScope): EvalCase[] {
  const roots = resolveScopeRoots(projectRoot, scope);
  const files = new Set<string>();
  for (const root of roots) {
    for (const f of collectFeatureFiles(root.dir)) files.add(f);
  }
  const cases: EvalCase[] = [];
  for (const file of [...files].sort()) {
    cases.push(...casesFromFile(projectRoot, file));
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}
