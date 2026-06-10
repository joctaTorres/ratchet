import { promises as fs } from 'fs';
import { RATCHET_DIR_NAME } from './config.js';
import path from 'path';
import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import fg from 'fast-glob';
import { getParentPlanningHome, resolveCurrentPlanningHomeSync } from './planning-home.js';
import { discoverModules, reconcileModuleRegistry } from './module-discovery.js';
import { configLoadError } from './project-config.js';

interface ChangeInfo {
  name: string;
  completedTasks: number;
  totalTasks: number;
  lastModified: Date;
  /** Module name when the change belongs to a nested module; undefined for root. */
  module?: string;
}

interface ListOptions {
  sort?: 'recent' | 'name';
  json?: boolean;
}

/**
 * Get the most recent modification time of any file in a directory (recursive).
 * Falls back to the directory's own mtime if no files are found.
 */
async function getLastModified(dirPath: string): Promise<Date> {
  let latest: Date | null = null;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        if (latest === null || stat.mtime > latest) {
          latest = stat.mtime;
        }
      }
    }
  }

  await walk(dirPath);

  // If no files found, use the directory's own modification time
  if (latest === null) {
    const dirStat = await fs.stat(dirPath);
    return dirStat.mtime;
  }

  return latest;
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "3 days ago")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) {
    return date.toLocaleDateString();
  } else if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return 'just now';
  }
}

/**
 * Collect active changes (excluding `archive`) for a single home's changes dir.
 * `module` tags each row when listing a nested module. Returns `null` when the
 * changes directory does not exist (so callers can distinguish missing from
 * empty).
 */
async function collectChanges(changesDir: string, module?: string): Promise<ChangeInfo[] | null> {
  try {
    await fs.access(changesDir);
  } catch {
    return null;
  }

  const entries = await fs.readdir(changesDir, { withFileTypes: true });
  const changeDirs = entries
    .filter(entry => entry.isDirectory() && entry.name !== 'archive')
    .map(entry => entry.name);

  const changes: ChangeInfo[] = [];
  for (const changeDir of changeDirs) {
    const progress = await getTaskProgressForChange(changesDir, changeDir);
    const changePath = path.join(changesDir, changeDir);
    const lastModified = await getLastModified(changePath);
    changes.push({
      name: changeDir,
      completedTasks: progress.completed,
      totalTasks: progress.total,
      lastModified,
      ...(module ? { module } : {}),
    });
  }
  return changes;
}

export class ListCommand {
  async execute(targetPath: string = '.', mode: 'changes' | 'specs' = 'changes', options: ListOptions = {}): Promise<void> {
    const { sort = 'recent', json = false } = options;

    // Resolve the nearest planning home by walking up from the target path,
    // rather than assuming `.ratchet` lives directly under the cwd. This keeps
    // list consistent with status/instructions, which already walk up.
    const planningHome = resolveCurrentPlanningHomeSync({ startPath: targetPath });
    const homeRoot = planningHome.root;

    if (mode === 'changes') {
      const changesDir = path.join(homeRoot, RATCHET_DIR_NAME, 'changes');

      const rootChanges = await collectChanges(changesDir);
      if (rootChanges === null) {
        throw new Error("No Ratchet changes directory found. Run 'ratchet init' first.");
      }

      // Root-level aggregation: when this home is itself the root (no enclosing
      // home), fold in changes from every discovered module, labeled by module.
      // Module-level list (a home with a parent) stays scoped to itself.
      const changes: ChangeInfo[] = [...rootChanges];
      const isRootHome = getParentPlanningHome(planningHome) === null;
      if (isRootHome) {
        let modules: Awaited<ReturnType<typeof discoverModules>> = [];
        try {
          modules = await discoverModules(planningHome);
        } catch (error) {
          console.warn(`Module discovery failed: ${(error as Error).message}`);
          modules = [];
        }

        // Surface registry lint warnings (discovered-but-unregistered,
        // registered-but-missing). Non-fatal.
        for (const warning of reconcileModuleRegistry(planningHome, modules)) {
          console.warn(warning);
        }

        for (const mod of modules) {
          // A module with an unparseable config degrades to a warning; one
          // broken module must not blind the whole repo.
          const loadError = configLoadError(mod.home.root);
          if (loadError) {
            console.warn(`Module '${mod.moduleName}' could not be loaded: ${loadError}`);
            continue;
          }
          try {
            const moduleChanges = await collectChanges(mod.home.changesDir, mod.moduleName);
            if (moduleChanges) {
              changes.push(...moduleChanges);
            }
          } catch (error) {
            console.warn(`Module '${mod.moduleName}' could not be loaded: ${(error as Error).message}`);
          }
        }
      }

      if (changes.length === 0) {
        if (json) {
          console.log(JSON.stringify({ changes: [] }));
        } else {
          console.log('No active changes found.');
        }
        return;
      }

      // Sort by preference (default: recent first)
      if (sort === 'recent') {
        changes.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      } else {
        changes.sort((a, b) => a.name.localeCompare(b.name));
      }

      // JSON output for programmatic use
      if (json) {
        const jsonOutput = changes.map(c => ({
          name: c.name,
          ...(c.module ? { module: c.module } : {}),
          completedTasks: c.completedTasks,
          totalTasks: c.totalTasks,
          lastModified: c.lastModified.toISOString(),
          status: c.totalTasks === 0 ? 'no-tasks' : c.completedTasks === c.totalTasks ? 'complete' : 'in-progress'
        }));
        console.log(JSON.stringify({ changes: jsonOutput }, null, 2));
        return;
      }

      // Display results
      console.log('Changes:');
      const padding = '  ';
      const nameWidth = Math.max(...changes.map(c => c.name.length));
      for (const change of changes) {
        const paddedName = change.name.padEnd(nameWidth);
        const status = formatTaskStatus({ total: change.totalTasks, completed: change.completedTasks });
        const timeAgo = formatRelativeTime(change.lastModified);
        const label = change.module ? `  [${change.module}]` : '';
        console.log(`${padding}${paddedName}     ${status.padEnd(12)}  ${timeAgo}${label}`);
      }
      return;
    }

    // specs mode → feature store, grouped by capability
    const featuresDir = path.join(homeRoot, RATCHET_DIR_NAME, 'features');
    try {
      await fs.access(featuresDir);
    } catch {
      console.log('No features found.');
      return;
    }

    let rels: string[] = [];
    try {
      rels = await fg('**/*.feature', { cwd: featuresDir, onlyFiles: true });
    } catch {
      rels = [];
    }
    if (rels.length === 0) {
      console.log('No features found.');
      return;
    }

    const counts = new Map<string, number>();
    for (const rel of rels) {
      const capability = rel.split('/')[0] || '(root)';
      counts.set(capability, (counts.get(capability) ?? 0) + 1);
    }

    type FeatureInfo = { id: string; featureCount: number };
    const specs: FeatureInfo[] = [...counts.entries()].map(([id, featureCount]) => ({ id, featureCount }));

    specs.sort((a, b) => a.id.localeCompare(b.id));
    console.log('Features:');
    const padding = '  ';
    const nameWidth = Math.max(...specs.map(s => s.id.length));
    for (const spec of specs) {
      const padded = spec.id.padEnd(nameWidth);
      console.log(`${padding}${padded}     features ${spec.featureCount}`);
    }
  }
}