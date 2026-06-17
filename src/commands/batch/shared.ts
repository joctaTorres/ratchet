/**
 * Shared helpers for the `ratchet batch` command group.
 */

import { existsSync, readdirSync } from 'fs';
import { getBatchesDir, batchExists } from '../../core/batch/manifest.js';

/** List all batch names (directories under `.ratchet/batches` with a manifest). */
export function listBatchNames(projectRoot: string): string[] {
  const batchesDir = getBatchesDir(projectRoot);
  if (!existsSync(batchesDir)) return [];
  return readdirSync(batchesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => batchExists(projectRoot, name))
    .sort();
}

/**
 * Resolve which batch a command targets. If a name is given, validate it
 * exists. If omitted, auto-select the sole batch, else error with guidance.
 */
export function resolveBatchName(projectRoot: string, name: string | undefined): string {
  if (name) {
    if (!batchExists(projectRoot, name)) {
      throw new Error(
        `Batch '${name}' not found under .ratchet/batches. Create it with 'ratchet new batch ${name}'.`
      );
    }
    return name;
  }

  const names = listBatchNames(projectRoot);
  if (names.length === 0) {
    throw new Error(
      "No batches found. Create one with 'ratchet new batch <name>'."
    );
  }
  if (names.length === 1) {
    return names[0];
  }
  throw new Error(
    `Multiple batches exist (${names.join(', ')}). Specify one, e.g. 'ratchet batch status ${names[0]}'.`
  );
}
