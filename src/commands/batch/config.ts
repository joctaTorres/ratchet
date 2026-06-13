/**
 * `ratchet batch config [name]`
 *
 * Resolve/get/set batch settings. With no name, resolves project-level defaults
 * (defaults ← project config). With a name, resolves effective settings for
 * that batch (... ← manifest overrides), annotating each value's source.
 *
 * `--set key=value` writes the project-level `batch:` section, validating enum
 * values and leaving the file unchanged on invalid input.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { loadBatchManifest } from '../../core/batch/manifest.js';
import {
  resolveBatchSettings,
  setProjectBatchSetting,
  type ResolvedBatchSettings,
  type BatchSettings,
} from '../../core/batch/config.js';
import { batchExists } from '../../core/batch/manifest.js';

export interface BatchConfigOptions {
  set?: string;
  json?: boolean;
}

export async function batchConfigCommand(
  name: string | undefined,
  options: BatchConfigOptions = {}
): Promise<void> {
  const projectRoot = resolveCurrentPlanningHomeSync().root;

  // --set always writes the project-level config (not per-manifest).
  if (options.set) {
    const eq = options.set.indexOf('=');
    if (eq === -1) {
      throw new Error(`Invalid --set '${options.set}'. Expected key=value.`);
    }
    const key = options.set.slice(0, eq).trim();
    const value = options.set.slice(eq + 1).trim();
    const result = setProjectBatchSetting(projectRoot, key, value);
    if (!result.ok) {
      // No-op on invalid input: report and fail without touching the file.
      throw new Error(result.error);
    }
    if (!options.json) {
      console.log(chalk.green(`Set batch.${key} = ${value}`));
    } else {
      console.log(JSON.stringify({ ok: true, key, value }, null, 2));
    }
    return;
  }

  const manifest =
    name && batchExists(projectRoot, name)
      ? loadBatchManifest(projectRoot, name)
      : null;
  if (name && !manifest) {
    throw new Error(`Batch '${name}' not found under .ratchet/batches.`);
  }

  const resolved = resolveBatchSettings(projectRoot, manifest);

  if (options.json) {
    console.log(JSON.stringify({ name: name ?? null, ...resolved }, null, 2));
    return;
  }

  printResolved(name, resolved);
}

const KEYS: (keyof BatchSettings)[] = ['gate', 'strategy', 'proofOfWork', 'agent'];

function printResolved(name: string | undefined, resolved: ResolvedBatchSettings): void {
  const heading = name ? `Effective batch settings for '${name}'` : 'Batch settings (project)';
  console.log(chalk.bold(`\n${heading}\n`));

  for (const key of KEYS) {
    const value = resolved.settings[key];
    const source = resolved.sources[key];
    const valueText = value === undefined ? chalk.dim('(unset)') : String(value);
    const sourceText =
      source === 'manifest'
        ? chalk.cyan('[manifest]')
        : source === 'project'
          ? chalk.yellow('[project]')
          : chalk.dim('[default]');
    console.log(`  ${key.padEnd(12)} ${valueText.padEnd(18)} ${sourceText}`);
  }
}
