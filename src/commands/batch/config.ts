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
  redactSettings,
  SECRET_SETTING_KEYS,
  REDACTED_PLACEHOLDER,
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
    // Never echo a secret value back (it would persist in scrollback / CI logs).
    const echoValue = (SECRET_SETTING_KEYS as readonly string[]).includes(key)
      ? REDACTED_PLACEHOLDER
      : value;
    if (!options.json) {
      console.log(chalk.green(`Set batch.${key} = ${echoValue}`));
    } else {
      console.log(JSON.stringify({ ok: true, key, value: echoValue }, null, 2));
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
    // Redact the secret authToken before printing — `ratchet batch config`
    // must never echo it (see features/remote-locus/config-and-validation).
    const safe: ResolvedBatchSettings = {
      ...resolved,
      settings: redactSettings(resolved.settings),
    };
    console.log(JSON.stringify({ name: name ?? null, ...safe }, null, 2));
    return;
  }

  printResolved(name, resolved);
}

const KEYS: (keyof BatchSettings)[] = [
  'gate',
  'strategy',
  'proofOfWork',
  'locus',
  'agent',
  'image',
  'host',
  'port',
  'authToken',
];

function printResolved(name: string | undefined, resolved: ResolvedBatchSettings): void {
  const heading = name ? `Effective batch settings for '${name}'` : 'Batch settings (project)';
  console.log(chalk.bold(`\n${heading}\n`));

  // Redact the secret authToken so the human-readable table never leaks it.
  const display = redactSettings(resolved.settings);
  for (const key of KEYS) {
    const value = display[key];
    const source = resolved.sources[key];
    const valueText = value === undefined ? chalk.dim('(unset)') : String(value);
    const sourceText = sourceLabel(source);
    console.log(`  ${key.padEnd(12)} ${valueText.padEnd(18)} ${sourceText}`);
  }

  // Permissions is a structured policy, not a scalar — render it as its own
  // block. `display` is already redacted, so any secret-bearing `raw` value is
  // masked here too.
  const permissions = display.permissions;
  if (permissions) {
    console.log(chalk.bold('\n  permissions'));
    console.log(`    posture      ${permissions.posture}  ${sourceLabel(resolved.sources.permissions)}`);
    if (permissions.allow.length > 0) {
      console.log(`    allow        ${permissions.allow.join(', ')}`);
    }
    if (permissions.deny.length > 0) {
      console.log(`    deny         ${permissions.deny.join(', ')}`);
    }
    const rawAgents = Object.keys(permissions.raw);
    if (rawAgents.length > 0) {
      for (const agent of rawAgents) {
        const fragment = permissions.raw[agent as keyof typeof permissions.raw] ?? [];
        console.log(`    raw.${agent.padEnd(8)} ${fragment.join(' ')}`);
      }
    }
  }
}

function sourceLabel(source: ResolvedBatchSettings['sources'][keyof ResolvedBatchSettings['sources']]): string {
  switch (source) {
    case 'manifest':
      return chalk.cyan('[manifest]');
    case 'project':
      return chalk.yellow('[project]');
    case 'user':
      return chalk.magenta('[user]');
    default:
      return chalk.dim('[default]');
  }
}
