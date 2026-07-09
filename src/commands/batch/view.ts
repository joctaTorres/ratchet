/**
 * `ratchet batch view [name]` and `ratchet batch list`
 *
 * Rich terminal dashboard for a single batch and a list of all batches,
 * mirroring the chalk / status-symbol / progress-bar patterns in
 * `src/core/view.ts`. Status is derived live from change state on disk.
 *
 * Honors `--no-color`: the CLI sets NO_COLOR, which chalk respects, so no ANSI
 * escape codes are emitted.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { loadBatchManifest } from '../../core/batch/manifest.js';
import {
  computeBatchStatus,
  type BatchStatusInfo,
  type ChangeStatusInfo,
  type ParkedInfo,
} from '../../core/batch/status.js';
import { readRunState, readJournal } from '../../core/batch/journal.js';
import { resolveBatchName, listBatchNames } from './shared.js';
import { resolveBatchSettings } from '../../core/batch/config.js';
import { describeLocusIsolation } from '../../core/batch/runtime/isolation.js';
import {
  resolvePostureEnforcement,
  type PostureEnforcement,
} from '../../core/batch/runtime/agent-permissions.js';
import { AGENT_STAGE_KEYS, resolveAgentForStage } from '../../core/batch/agent-setting.js';

export interface BatchViewOptions {
  json?: boolean;
}

function createProgressBar(completed: number, total: number, width = 20): string {
  if (total === 0) return chalk.dim('─'.repeat(width));
  const percentage = completed / total;
  const filled = Math.round(percentage * width);
  const empty = width - filled;
  return `[${chalk.green('█'.repeat(filled))}${chalk.dim('░'.repeat(empty))}]`;
}

function symbolFor(change: ChangeStatusInfo): string {
  switch (change.status) {
    case 'done':
      return chalk.green('✓');
    case 'in-progress':
      return chalk.yellow('◉');
    case 'awaiting-verify':
      // Tasks done, verify gate pending — distinct from done (✓) and approval (⏸).
      return chalk.magenta('⧖');
    case 'ready':
      return chalk.cyan('○');
    case 'blocked':
      return chalk.red('✗');
    case 'awaiting-approval':
      return chalk.cyan('⏸');
    default:
      return chalk.gray('·');
  }
}

/** Render the parked halt (blocker question or approval request) under a step. */
function renderParked(parked: ParkedInfo): void {
  if (parked.kind === 'blocked') {
    const tail = parked.answer ? chalk.dim('  (answered — resumes on next apply)') : '';
    console.log(chalk.red(`      ⚠ blocked: ${parked.reason}`) + tail);
  } else {
    const tail = parked.feedback
      ? chalk.dim('  (rejected — re-runs propose on next apply)')
      : chalk.dim('  (approve or reject with feedback)');
    console.log(chalk.cyan(`      ⏸ awaiting approval: ${parked.reason}`) + tail);
  }
}

export async function batchViewCommand(
  name: string | undefined,
  options: BatchViewOptions = {}
): Promise<void> {
  const projectRoot = resolveCurrentPlanningHomeSync().root;
  const batchName = resolveBatchName(projectRoot, name);
  const manifest = loadBatchManifest(projectRoot, batchName);
  const runState = readRunState(projectRoot, batchName);
  // Thread the run journal so status honors the single journal-aware done-rule
  // (an all-tasks-checked change with no journaled verify renders awaiting-verify).
  const journal = readJournal(projectRoot, batchName);
  const status = await computeBatchStatus(projectRoot, manifest, runState, journal);
  // Resolve the batch's runtime settings so the dashboard renders an honest
  // runtime summary (locus + its real isolation, posture + source + per-agent
  // enforcement) — the same descriptors `batch config` uses, so the runtime
  // story can never drift between surfaces (#86 posture-honesty half).
  const resolved = resolveBatchSettings(projectRoot, manifest);

  if (options.json) {
    const isolation = describeLocusIsolation(resolved.settings);
    const enforcement = resolveViewEnforcement(resolved, projectRoot);
    console.log(
      JSON.stringify(
        { ...status, isolation, enforcement, posture: resolved.settings.permissions?.posture },
        null,
        2
      )
    );
    return;
  }

  renderSingleBatch(status, resolved, projectRoot);
}

/**
 * Render the runtime summary line: the locus and its real isolation, plus the
 * posture with its source scope and per-agent enforcement status. Reuses the
 * same descriptors as `batch config` so the wording never drifts. Printed right
 * under the progress bar so an operator inspecting a batch sees the honest
 * runtime story before the change list.
 */
function renderRuntimeSummary(
  resolved: ReturnType<typeof resolveBatchSettings>,
  repoRoot: string
): void {
  const isolation = describeLocusIsolation(resolved.settings);
  console.log(
    chalk.dim(`  runtime: ${isolation.locus} — ${isolation.description}`)
  );
  const policy = resolved.settings.permissions;
  if (!policy) return;
  const sourceTag =
    resolved.sources.permissions === 'manifest'
      ? ' (set by batch manifest — repo-controlled)'
      : resolved.sources.permissions === 'project'
        ? ' [project]'
        : resolved.sources.permissions === 'user'
          ? ' [user]'
          : ' [default]';
  console.log(chalk.dim(`  posture:  ${policy.posture}${sourceTag}`));
  const enforcement = resolveViewEnforcement(resolved, repoRoot);
  for (const e of enforcement) {
    const tag = e.enforced ? 'enforced' : 'NOT ENFORCED';
    console.log(chalk.dim(`            ${e.agent}: ${tag}`));
  }
}

/** Distinct stage agents → per-agent enforcement entries (mirrors `batch config`). */
function resolveViewEnforcement(
  resolved: ReturnType<typeof resolveBatchSettings>,
  repoRoot: string
): PostureEnforcement[] {
  const policy = resolved.settings.permissions;
  if (!policy) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const stage of AGENT_STAGE_KEYS) {
    const spec = resolveAgentForStage(resolved.settings.agent, stage);
    if (spec === undefined) continue;
    const agentName = spec.split(':')[0];
    if (agentName.length === 0) continue;
    if (!seen.has(agentName)) {
      seen.add(agentName);
      ordered.push(agentName);
    }
  }
  return ordered.map((a) => resolvePostureEnforcement(a, policy, repoRoot));
}

function renderSingleBatch(
  status: BatchStatusInfo,
  resolved: ReturnType<typeof resolveBatchSettings>,
  repoRoot: string
): void {
  console.log(chalk.bold(`\nBatch: ${status.name}`));
  console.log('═'.repeat(60));

  const pct =
    status.progress.total > 0
      ? Math.round((status.progress.completed / status.progress.total) * 100)
      : 0;
  console.log(
    `${createProgressBar(status.progress.completed, status.progress.total)} ${chalk.dim(
      `${pct}% · ${status.doneCount}/${status.changeCount} changes done`
    )}`
  );

  // Honest runtime summary: locus + real isolation, posture + source + per-
  // agent enforcement. Rendered before the change list so an operator sees the
  // security story first (see view-runtime-summary.feature).
  renderRuntimeSummary(resolved, repoRoot);

  if (status.changeCount === 0) {
    console.log(
      chalk.dim(
        '\nThis batch has no changes yet. Add change intents under a phase in the manifest:'
      )
    );
    console.log(chalk.dim('  phases:\n    - changes:\n        - name: <change-name>'));
    return;
  }

  for (const phase of status.phases) {
    const gate = phase.gated ? chalk.red(`  (gated by ${phase.gatedBy})`) : '';
    console.log(`\n${chalk.bold.cyan(phase.name)} ${chalk.dim(`— ${phase.goal}`)}${gate}`);
    console.log('─'.repeat(60));
    for (const change of phase.changes) {
      const bar = createProgressBar(change.progress.completed, change.progress.total, 12);
      const after =
        change.after.length > 0 ? chalk.dim(`  after: ${change.after.join(', ')}`) : '';
      const blocked =
        change.status === 'blocked' && change.blockedBy.length > 0
          ? chalk.red(`  blocked by ${change.blockedBy.join(', ')}`)
          : '';
      console.log(
        `  ${symbolFor(change)} ${chalk.bold(change.name.padEnd(28))} ${bar}${after}${blocked}`
      );
      if (change.parked) {
        renderParked(change.parked);
      }
    }
  }

  console.log('\n' + '═'.repeat(60));
  if (status.next) {
    const label = status.next.decompose
      ? `decompose phase ${status.next.phase}`
      : `${status.next.change} (phase ${status.next.phase})`;
    console.log(chalk.bold(`Next: ${label}`));
  } else if (status.status === 'done') {
    console.log(chalk.green('All changes done.'));
  } else {
    console.log(chalk.dim('No ready step — everything is blocked or gated.'));
  }
}

export async function batchListCommand(options: BatchViewOptions = {}): Promise<void> {
  const projectRoot = resolveCurrentPlanningHomeSync().root;
  const names = listBatchNames(projectRoot);

  const rows: BatchStatusInfo[] = [];
  for (const batchName of names) {
    const manifest = loadBatchManifest(projectRoot, batchName);
    rows.push(await computeBatchStatus(projectRoot, manifest));
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          batches: rows.map((r) => ({
            name: r.name,
            changeCount: r.changeCount,
            doneCount: r.doneCount,
            progress: r.progress,
            status: r.status,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (rows.length === 0) {
    console.log("No batches found. Create one with 'ratchet new batch <name>'.");
    return;
  }

  console.log(chalk.bold('\nBatches'));
  console.log('─'.repeat(60));
  const nameWidth = Math.max(...rows.map((r) => r.name.length), 8);
  for (const row of rows) {
    const pct =
      row.progress.total > 0
        ? Math.round((row.progress.completed / row.progress.total) * 100)
        : 0;
    const bar = createProgressBar(row.progress.completed, row.progress.total, 16);
    const label = row.changeCount === 1 ? 'change' : 'changes';
    console.log(
      `  ${chalk.bold(row.name.padEnd(nameWidth))}  ${bar} ${chalk.dim(
        `${pct}% · ${row.changeCount} ${label}`
      )}`
    );
  }
}
