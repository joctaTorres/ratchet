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
import * as yaml from 'yaml';
import { RATCHET_DIR_NAME } from './config.js';
import { getStandardsDir, loadStandards } from './standards.js';
import {
  type PlanningHome,
  getParentPlanningHome,
  getRootPlanningHome,
} from './planning-home.js';
import { discoverModules } from './module-discovery.js';

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

// -----------------------------------------------------------------------------
// Standard-link materialization
// -----------------------------------------------------------------------------

const SIDECAR_FILENAME = '.ratchet.yaml';
const IMPLEMENTED_BY_HEADING = '## Implemented by';
const IMPLEMENTED_BY_MARKER =
  '<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->';

/** The store-relative path with its leading capability segment removed. */
function relWithinCapability(rel: string): string {
  const normalized = rel.split(path.sep).join('/');
  const parts = normalized.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : normalized;
}

interface CapabilitySidecar {
  /** Map of capability-relative feature path -> sorted list of standard tags. */
  features: Record<string, string[]>;
}

function sidecarPathFor(storeDir: string, capability: string): string {
  return path.join(storeDir, capability, SIDECAR_FILENAME);
}

async function readSidecar(sidecarPath: string): Promise<CapabilitySidecar> {
  let content: string;
  try {
    content = await fs.readFile(sidecarPath, 'utf-8');
  } catch {
    return { features: {} };
  }
  let parsed: unknown;
  try {
    parsed = yaml.parse(content);
  } catch {
    return { features: {} };
  }
  const features: Record<string, string[]> = {};
  const raw =
    parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).features
      : undefined;
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        features[key] = value.filter((t): t is string => typeof t === 'string');
      }
    }
  }
  return { features };
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function writeSidecar(sidecarPath: string, sidecar: CapabilitySidecar): Promise<void> {
  const keys = Object.keys(sidecar.features).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) {
    // No links remain for this capability — drop the sidecar entirely.
    await fs.rm(sidecarPath, { force: true });
    return;
  }
  const ordered: Record<string, string[]> = {};
  for (const key of keys) {
    ordered[key] = sortedUnique(sidecar.features[key]);
  }
  await fs.mkdir(path.dirname(sidecarPath), { recursive: true });
  await fs.writeFile(sidecarPath, yaml.stringify({ features: ordered }), 'utf-8');
}

/**
 * Write the forward links for a single change into the per-capability sidecars:
 * added/overwritten features gain the change's `tags`; tombstoned features have
 * their entries removed. Updates only the capabilities the change touches.
 */
async function updateForwardLinks(
  storeDir: string,
  updates: FeatureUpdate[],
  tombstones: string[],
  tags: string[]
): Promise<void> {
  const byCapability = new Map<string, CapabilitySidecar>();

  const load = async (capability: string): Promise<CapabilitySidecar> => {
    let sidecar = byCapability.get(capability);
    if (!sidecar) {
      sidecar = await readSidecar(sidecarPathFor(storeDir, capability));
      byCapability.set(capability, sidecar);
    }
    return sidecar;
  };

  for (const update of updates) {
    const sidecar = await load(update.capability);
    sidecar.features[relWithinCapability(update.rel)] = sortedUnique(tags);
  }

  for (const rel of tombstones) {
    const capability = capabilityOf(rel);
    const sidecar = await load(capability);
    delete sidecar.features[relWithinCapability(rel)];
  }

  for (const [capability, sidecar] of byCapability) {
    await writeSidecar(sidecarPathFor(storeDir, capability), sidecar);
  }
}

/**
 * Build the reverse index (tag -> sorted store-relative feature paths) by
 * scanning every capability sidecar in the store. This is the single source for
 * the regenerated `## Implemented by` blocks, so the reverse link is always a
 * pure projection of the forward sidecars.
 */
async function buildReverseIndex(storeDir: string): Promise<Map<string, string[]>> {
  const index = new Map<string, Set<string>>();

  let capabilities: string[] = [];
  try {
    const entries = await fs.readdir(storeDir, { withFileTypes: true });
    capabilities = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    capabilities = [];
  }

  for (const capability of capabilities) {
    const sidecar = await readSidecar(sidecarPathFor(storeDir, capability));
    for (const [relWithin, tags] of Object.entries(sidecar.features)) {
      const featureRel = `${capability}/${relWithin}`;
      for (const tag of tags) {
        let set = index.get(tag);
        if (!set) {
          set = new Set<string>();
          index.set(tag, set);
        }
        set.add(featureRel);
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [tag, set] of index) {
    result.set(tag, [...set].sort((a, b) => a.localeCompare(b)));
  }
  return result;
}

/**
 * Replace (or remove) the generated `## Implemented by` block in a standard's
 * markdown. The block runs from the heading to the next top-level `##` heading
 * or end of file. Returns the content with the block set to `features` (or
 * removed when `features` is empty). Idempotent: regenerating from the same
 * inputs yields identical bytes.
 */
function renderImplementedByBlock(content: string, features: string[]): string {
  // Strip any existing generated block (heading → next "## " or EOF).
  const headingPattern = new RegExp(
    `\\n*${escapeRegExp(IMPLEMENTED_BY_HEADING)}[^\\n]*\\n[\\s\\S]*?(?=\\n## |$)`,
    'g'
  );
  let body = content.replace(headingPattern, '');
  body = body.replace(/\s+$/, '');

  if (features.length === 0) {
    return body.length > 0 ? `${body}\n` : '';
  }

  const lines = [
    IMPLEMENTED_BY_HEADING,
    '',
    IMPLEMENTED_BY_MARKER,
    '',
    ...features.map((f) => `- ${f}`),
    '',
  ];
  const block = lines.join('\n');
  return body.length > 0 ? `${body}\n\n${block}` : `${block}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regenerate the `## Implemented by` block in every standard file from the
 * current reverse index. Standards with no implementing features get the block
 * removed (or never gain one), keeping the reverse link a pure projection.
 *
 * Standards are keyed by their resolved tag (frontmatter `tag` or file-name
 * stem), matching how changes reference them.
 */
async function regenerateReverseLinks(
  projectRoot: string,
  reverse: Map<string, string[]>
): Promise<void> {
  const standardsDir = getStandardsDir(projectRoot);
  const standards = loadStandards(projectRoot);

  for (const standard of standards) {
    const features = reverse.get(standard.tag) ?? [];
    const fullPath = path.join(standardsDir, standard.fileName);
    let raw: string;
    try {
      raw = await fs.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }
    const next = renderImplementedByBlock(raw, features);
    if (next !== raw) {
      await fs.writeFile(fullPath, next, 'utf-8');
    }
  }
}

function storeDirFor(homeRoot: string): string {
  return path.join(homeRoot, RATCHET_DIR_NAME, FEATURES_SUBDIR);
}

/**
 * Build a reverse index across a set of homes, qualifying each implementing
 * feature with the owning module name (`<module>: <capability>/<file>`); root
 * features stay unqualified. This is the source for layered reverse links so a
 * root standard's `## Implemented by` block can list features from any module.
 */
async function buildQualifiedReverseIndex(
  homes: Array<{ storeDir: string; moduleName?: string }>
): Promise<Map<string, string[]>> {
  const index = new Map<string, Set<string>>();
  for (const home of homes) {
    const local = await buildReverseIndex(home.storeDir);
    for (const [tag, features] of local) {
      let set = index.get(tag);
      if (!set) {
        set = new Set<string>();
        index.set(tag, set);
      }
      for (const feature of features) {
        set.add(home.moduleName ? `${home.moduleName}: ${feature}` : feature);
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [tag, set] of index) {
    result.set(tag, [...set].sort((a, b) => a.localeCompare(b)));
  }
  return result;
}

/**
 * Materialize a change's standard links into the permanent store. Runs after
 * `applyFeatures` (store + tombstones already applied) and before the change is
 * moved to the archive.
 *
 * - Forward link: writes/updates the per-capability sidecar in the change's own
 *   home store, mapping each feature file to the change's declared `tags`;
 *   tombstoned features are removed. Always module-local.
 * - Reverse link: regenerates the `## Implemented by` block in the standard's
 *   *defining* home. For a single-home repo this is just that repo's standards.
 *   When `home` is provided and is a module (or a root with modules), the
 *   reverse index spans the root and every module, qualifying module features
 *   by module name, and each standard is regenerated in the home that defines
 *   it — so an inherited root standard collects module features in the root
 *   file, while a module-local standard stays within the module.
 *
 * When the change declares no standards (`tags` empty), this is a no-op.
 *
 * @param root - The change's home root (parent of `.ratchet`).
 * @param home - The resolved planning home, when nesting is in play. Omit for
 *   the legacy single-home path (reverse links scoped to `root`).
 */
export async function materializeStandardLinks(
  root: string,
  changeName: string,
  tags: string[],
  home?: PlanningHome
): Promise<void> {
  if (tags.length === 0) {
    // A change with no declared standards must not touch the store links.
    return;
  }

  const changeDir = path.join(root, RATCHET_DIR_NAME, 'changes', changeName);
  const storeDir = storeDirFor(root);

  const updates = await findFeatureUpdates(changeDir, storeDir);
  const tombstones = await readTombstones(changeDir);

  // Forward links are always written into the change's own home store.
  await updateForwardLinks(storeDir, updates, tombstones, tags);

  // Reverse links: regenerate the `## Implemented by` block in each standard's
  // defining home. Without a planning home, or for a plain single-home repo,
  // this is exactly the legacy behavior (scan `root`'s store, regenerate
  // `root`'s standards).
  const isNested = home !== undefined && getParentPlanningHome(home) !== null;
  const rootHome = home ? getRootPlanningHome(home) : undefined;
  const modules = rootHome && (isNested || home === rootHome)
    ? await discoverModules(rootHome)
    : [];

  if (!rootHome || modules.length === 0) {
    // Single-home (or no discovered modules): pure projection of root's store.
    const reverse = await buildReverseIndex(storeDir);
    await regenerateReverseLinks(root, reverse);
    return;
  }

  // Every home that could define a standard: the root and every module.
  const allHomes: Array<{ root: string; moduleName?: string }> = [
    { root: rootHome.root },
    ...modules.map((m) => ({ root: m.home.root, moduleName: m.moduleName })),
  ];

  // Regenerate each home's standards from a reverse index built relative to
  // that home: the home's own features are listed unqualified, while features
  // contributed by *other* modules are qualified by their module name. This
  // keeps a module-local standard's entries local, while an inherited root
  // standard collects module features qualified by module name.
  for (const defining of allHomes) {
    const homesForIndex = allHomes.map((h) => ({
      storeDir: storeDirFor(h.root),
      // Unqualified when the contributing home is the one we're regenerating.
      moduleName: h.root === defining.root ? undefined : h.moduleName,
    }));
    const reverse = await buildQualifiedReverseIndex(homesForIndex);
    await regenerateReverseLinks(defining.root, reverse);
  }
}
