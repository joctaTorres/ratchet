/**
 * Feature Application Logic
 *
 * Applies a change's Gherkin feature files into the permanent feature store by
 * whole-file replacement. Each `<changeDir>/features/<rel>` (where `<rel>`
 * matches `**\/*.feature`) is copied to `<root>/.ratchet/features/<rel>`.
 *
 * Removals are expressed via an optional `<changeDir>/features/.deleted`
 * tombstone file listing store-relative paths to remove (one per line; blank
 * lines and `#` comments ignored).
 */

import { promises as fs } from 'fs';
import path from 'path';
import fg from 'fast-glob';
import { RATCHET_DIR_NAME } from './config.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface FeatureUpdate {
  /** Store-relative path (e.g. "user-auth/login.feature"). */
  rel: string;
  /** Absolute path of the source file inside the change. */
  source: string;
  /** Absolute path of the target file inside the store. */
  target: string;
  /** First path segment of `rel`; used only for summary grouping. */
  capability: string;
  /** Whether the target already exists in the store. */
  exists: boolean;
}

export interface CapabilitySummary {
  capability: string;
  added: number;
  overwritten: number;
  deleted: number;
  unchanged: number;
}

export interface FeaturesApplyOutput {
  changeName: string;
  added: number;
  overwritten: number;
  deleted: number;
  unchanged: number;
  byCapability: CapabilitySummary[];
  noChanges: boolean;
}

const FEATURES_SUBDIR = 'features';
const TOMBSTONE_FILENAME = '.deleted';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function capabilityOf(rel: string): string {
  const normalized = rel.split(path.sep).join('/');
  const first = normalized.split('/')[0];
  return first || '(root)';
}

/**
 * Find all `**\/*.feature` files in a change's features directory and pair them
 * with their store target.
 */
export async function findFeatureUpdates(
  changeDir: string,
  storeDir: string
): Promise<FeatureUpdate[]> {
  const changeFeaturesDir = path.join(changeDir, FEATURES_SUBDIR);

  let rels: string[] = [];
  try {
    rels = await fg('**/*.feature', { cwd: changeFeaturesDir, onlyFiles: true });
  } catch {
    rels = [];
  }
  rels.sort();

  const updates: FeatureUpdate[] = [];
  for (const rel of rels) {
    const source = path.join(changeFeaturesDir, rel);
    const target = path.join(storeDir, rel);
    let exists = false;
    try {
      await fs.access(target);
      exists = true;
    } catch {
      exists = false;
    }
    updates.push({ rel, source, target, capability: capabilityOf(rel), exists });
  }

  return updates;
}

/**
 * Read the optional tombstone file listing store-relative paths to remove.
 * Returns a de-duplicated, normalized list of relative paths. Missing file
 * yields an empty list.
 */
export async function readTombstones(changeDir: string): Promise<string[]> {
  const tombstonePath = path.join(changeDir, FEATURES_SUBDIR, TOMBSTONE_FILENAME);
  let content: string;
  try {
    content = await fs.readFile(tombstonePath, 'utf-8');
  } catch {
    return [];
  }

  const seen = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    const normalized = line.split(path.sep).join('/').replace(/^\/+/, '');
    if (normalized.length === 0) continue;
    seen.add(normalized);
  }
  return [...seen];
}

async function filesAreIdentical(a: string, b: string): Promise<boolean> {
  try {
    const [bufA, bufB] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
    return bufA.equals(bufB);
  } catch {
    return false;
  }
}

function bumpCapability(
  map: Map<string, CapabilitySummary>,
  capability: string,
  field: 'added' | 'overwritten' | 'deleted' | 'unchanged'
): void {
  let summary = map.get(capability);
  if (!summary) {
    summary = { capability, added: 0, overwritten: 0, deleted: 0, unchanged: 0 };
    map.set(capability, summary);
  }
  summary[field] += 1;
}

/**
 * Apply all feature files from a change into the permanent feature store using
 * whole-file replacement, and remove any paths listed in the tombstone file.
 *
 * Classification (by byte-compare):
 * - target absent           → added
 * - target exists, differs  → overwritten
 * - target exists, identical → unchanged
 *
 * Tombstone entries that exist in the store are removed and counted as deleted;
 * entries that do not exist are ignored.
 */
export async function applyFeatures(
  root: string,
  changeName: string,
  options: { dryRun?: boolean } = {}
): Promise<FeaturesApplyOutput> {
  const changeDir = path.join(root, RATCHET_DIR_NAME, 'changes', changeName);
  const storeDir = path.join(root, RATCHET_DIR_NAME, FEATURES_SUBDIR);

  // Verify change exists.
  try {
    const stat = await fs.stat(changeDir);
    if (!stat.isDirectory()) {
      throw new Error(`Change '${changeName}' not found.`);
    }
  } catch {
    throw new Error(`Change '${changeName}' not found.`);
  }

  const updates = await findFeatureUpdates(changeDir, storeDir);
  const tombstones = await readTombstones(changeDir);

  const byCapabilityMap = new Map<string, CapabilitySummary>();
  let added = 0;
  let overwritten = 0;
  let deleted = 0;
  let unchanged = 0;

  // Apply file copies.
  for (const update of updates) {
    let classification: 'added' | 'overwritten' | 'unchanged';
    if (!update.exists) {
      classification = 'added';
    } else if (await filesAreIdentical(update.source, update.target)) {
      classification = 'unchanged';
    } else {
      classification = 'overwritten';
    }

    if (classification !== 'unchanged' && !options.dryRun) {
      await fs.mkdir(path.dirname(update.target), { recursive: true });
      await fs.copyFile(update.source, update.target);
    }

    if (classification === 'added') added += 1;
    else if (classification === 'overwritten') overwritten += 1;
    else unchanged += 1;
    bumpCapability(byCapabilityMap, update.capability, classification);
  }

  // Apply tombstone deletions.
  for (const rel of tombstones) {
    const target = path.join(storeDir, rel);
    let targetExists = false;
    try {
      await fs.access(target);
      targetExists = true;
    } catch {
      targetExists = false;
    }
    if (!targetExists) continue;

    if (!options.dryRun) {
      await fs.rm(target, { force: true });
    }
    deleted += 1;
    bumpCapability(byCapabilityMap, capabilityOf(rel), 'deleted');
  }

  const byCapability = [...byCapabilityMap.values()].sort((a, b) =>
    a.capability.localeCompare(b.capability)
  );

  return {
    changeName,
    added,
    overwritten,
    deleted,
    unchanged,
    byCapability,
    noChanges: added + overwritten + deleted === 0,
  };
}
