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
import { AGENT_STAGE_KEYS, resolveAgentForStage } from '../../core/batch/agent-setting.js';
import {
  resolvePostureEnforcement,
  type PostureEnforcement,
} from '../../core/batch/runtime/agent-permissions.js';
import { describeLocusIsolation } from '../../core/batch/runtime/isolation.js';

export interface BatchConfigOptions {
  set?: string;
  json?: boolean;
  /**
   * Per-invocation opt-in letting a repo-committed manifest RAISE the posture
   * above the operator-owned scopes (mirrors `batch apply`). Set via
   * `batch config --allow-manifest-escalation` so an operator can preview the
   * escalated posture and its manifest-source annotation without running.
   */
  allowManifestEscalation?: boolean;
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

  const resolved = resolveBatchSettings(projectRoot, manifest, {
    allowManifestEscalation: options.allowManifestEscalation,
  });

  if (options.json) {
    // Redact the secret authToken before printing — `ratchet batch config`
    // must never echo it (see features/remote-locus/config-and-validation).
    const safe: ResolvedBatchSettings = {
      ...resolved,
      settings: redactSettings(resolved.settings),
    };
    const isolation = describeLocusIsolation(resolved.settings);
    const enforcement = resolveEnforcementEntries(resolved, projectRoot);
    console.log(
      JSON.stringify(
        { name: name ?? null, ...safe, isolation, enforcement },
        null,
        2
      )
    );
    return;
  }

  printResolved(name, resolved, projectRoot);
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

function printResolved(
  name: string | undefined,
  resolved: ResolvedBatchSettings,
  repoRoot: string
): void {
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

  // Isolation line: state the real isolation of the resolved locus so an
  // operator can never mistake an advisory posture (local) for a real sandbox.
  // The description is pure data over the resolved settings (see
  // `runtime/isolation.ts`), so this rendering can never drift from the locus
  // the engine actually runs under.
  const isolation = describeLocusIsolation(resolved.settings);
  console.log(chalk.bold('\n  isolation'));
  console.log(`    ${isolation.locus.padEnd(10)} ${isolation.description}`);

  // Permissions is a structured policy, not a scalar — render it as its own
  // block. `display` is already redacted, so any secret-bearing `raw` value is
  // masked here too.
  const permissions = display.permissions;
  if (permissions) {
    console.log(chalk.bold('\n  permissions'));
    const postureSource = resolved.sources.permissions;
    const postureLabel =
      postureSource === 'manifest'
        ? `${permissions.posture} (set by batch manifest — repo-controlled)`
        : permissions.posture;
    console.log(`    posture      ${postureLabel}  ${sourceLabel(postureSource)}`);
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
    // Per-agent enforcement: one line per distinct resolved stage agent,
    // derived from the SAME per-agent mappers that build spawn argv so the
    // rendered status can never drift from what reaches the agent (#88). A
    // posture that yields no argv fragment (cursor / opencode) renders as
    // `NOT ENFORCED — agent defaults apply` so an operator is never told a
    // posture is enforced when the agent will run on its own defaults.
    const enforcement = resolveEnforcementEntries(resolved, repoRoot);
    if (enforcement.length > 0) {
      for (const e of enforcement) {
        const statusText = e.enforced
          ? chalk.green(e.detail)
          : chalk.yellow(e.detail);
        console.log(`    enforce      ${e.agent.padEnd(10)} ${statusText}`);
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

/**
 * Resolve the distinct agent names the batch will actually spawn, by iterating
 * every routable stage over the resolved `agent` setting. A scalar covers every
 * stage (so it dedupes to one agent); a per-stage map yields the named agents;
 * an unset setting yields none (the caller's default agent — not rendered here).
 * Order is stage-order then first-seen, so the rendered enforcement lines are
 * stable and readable.
 */
function resolveDistinctStageAgents(settings: BatchSettings): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const stage of AGENT_STAGE_KEYS) {
    const spec = resolveAgentForStage(settings.agent, stage);
    if (spec === undefined) continue; // unset stage → caller's default agent
    const agentName = spec.split(':')[0];
    if (agentName.length === 0) continue;
    if (!seen.has(agentName)) {
      seen.add(agentName);
      ordered.push(agentName);
    }
  }
  return ordered;
}

/**
 * Resolve one enforcement entry per distinct resolved stage agent, consulting the
 * SAME per-agent translators that build spawn argv (see
 * `resolvePostureEnforcement`) so the rendered status never drifts from what
 * reaches the agent. Returns `[]` when no agent is resolved (unset setting →
 * the caller's default agent, not rendered here) or when the policy is absent.
 */
function resolveEnforcementEntries(
  resolved: ResolvedBatchSettings,
  repoRoot: string
): PostureEnforcement[] {
  const policy = resolved.settings.permissions;
  if (!policy) return [];
  const agents = resolveDistinctStageAgents(resolved.settings);
  return agents.map((agent) => resolvePostureEnforcement(agent, policy, repoRoot));
}
