/**
 * `ratchet batch report --change <name> [--status|--blocker|--needs-input|--complete|--answer|--reject] <message>`
 *
 * The CLI channel an agent (or user) uses to post progress, raise a blocker,
 * request input, or signal completion — and for the user to answer a blocker or
 * reject-with-feedback. Reporting requires only invoking a shell command; no
 * interactive prompt inside the agent session is required.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { resolveBatchName } from './shared.js';
import {
  ENV_OVERRIDE_PROVENANCE,
  SPAWN_VIA_ENV,
  type EnvOverrideProvenance,
} from '../../core/batch/engine/agent.js';
import {
  appendJournal,
  parkStep,
  recordAnswer,
  recordReject,
} from '../../core/batch/journal.js';

export interface BatchReportOptions {
  change?: string;
  status?: string;
  blocker?: string;
  needsInput?: string;
  complete?: string;
  answer?: string;
  reject?: string;
  /** When reporting completion under an after-propose gate. */
  awaitingApproval?: boolean;
  json?: boolean;
}

export async function batchReportCommand(
  batchNameArg: string | undefined,
  options: BatchReportOptions
): Promise<void> {
  const projectRoot = resolveCurrentPlanningHomeSync().root;
  const batch = resolveBatchName(projectRoot, batchNameArg);

  const change = options.change;
  if (!change) {
    throw new Error("Missing required --change <name>.");
  }

  const [kind, message] = selectReportKind(options, [
    'status',
    'blocker',
    'needs-input',
    'complete',
    'answer',
    'reject',
  ]);
  const result = applyReport(projectRoot, batch, change, kind, message, options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.text);
}

/**
 * Provenance for entries a report appends: `via: 'env-override'` when the
 * reporting process is a stand-in the engine spawned under an allowed agent-cmd
 * override (the override script exports `RATCHET_SPAWN_VIA` only for such a
 * spawn). A leftover `RATCHET_BATCH_AGENT_CMD` in an operator's shell stamps
 * nothing. Shared by `batch report` and the batch-less `ratchet report`.
 */
export function reportProvenance(): { via?: EnvOverrideProvenance } {
  return process.env[SPAWN_VIA_ENV] === ENV_OVERRIDE_PROVENANCE
    ? { via: ENV_OVERRIDE_PROVENANCE }
    : {};
}

/** A report kind flag, named as it appears on the CLI (`--<kind>`). */
export type ReportKind = 'status' | 'blocker' | 'needs-input' | 'complete' | 'answer' | 'reject';

const REPORT_KIND_VALUE: Record<ReportKind, (o: BatchReportOptions) => string | undefined> = {
  status: (o) => o.status,
  blocker: (o) => o.blocker,
  'needs-input': (o) => o.needsInput,
  complete: (o) => o.complete,
  answer: (o) => o.answer,
  reject: (o) => o.reject,
};

/**
 * Pick the single report kind present in `options`, restricted to `allowed`.
 * Shared by `batch report` and the batch-less `ratchet report`, so both enforce
 * the same "exactly one report kind" rule and name the kinds they accept.
 */
export function selectReportKind<K extends ReportKind>(
  options: BatchReportOptions,
  allowed: readonly K[]
): [K, string] {
  const provided = allowed
    .map((kind) => [kind, REPORT_KIND_VALUE[kind](options)] as const)
    .filter((entry): entry is readonly [K, string] => entry[1] !== undefined);

  if (provided.length === 0) {
    const flags = allowed.map((k) => `--${k}`);
    throw new Error(`Provide one of ${flags.slice(0, -1).join(', ')}, or ${flags[flags.length - 1]}.`);
  }
  if (provided.length > 1) {
    throw new Error('Provide exactly one report kind at a time.');
  }
  return [provided[0][0], provided[0][1]];
}

function applyReport(
  projectRoot: string,
  batch: string,
  change: string,
  kind: string,
  message: string,
  options: BatchReportOptions
): { kind: string; change: string; text: string } {
  switch (kind) {
    case 'status':
      appendJournal(projectRoot, batch, { change, kind: 'progress', message, ...reportProvenance() });
      return { kind, change, text: chalk.dim(`Recorded progress for ${change}: ${message}`) };

    case 'blocker':
      appendJournal(projectRoot, batch, { change, kind: 'blocker', message, ...reportProvenance() });
      parkStep(projectRoot, batch, { change, kind: 'blocked', reason: message });
      return {
        kind,
        change,
        text: chalk.yellow(`Parked ${change} as blocked: ${message}`),
      };

    case 'needs-input':
      appendJournal(projectRoot, batch, { change, kind: 'needs-input', message, ...reportProvenance() });
      parkStep(projectRoot, batch, { change, kind: 'blocked', reason: message });
      return {
        kind,
        change,
        text: chalk.yellow(`Parked ${change} awaiting input: ${message}`),
      };

    case 'complete':
      appendJournal(projectRoot, batch, { change, kind: 'completion', message, ...reportProvenance() });
      // Under an after-propose gate, a finished propose parks for approval.
      if (options.awaitingApproval) {
        parkStep(projectRoot, batch, {
          change,
          kind: 'awaiting-approval',
          reason: message,
        });
        return {
          kind,
          change,
          text: chalk.cyan(`Parked ${change} awaiting approval: ${message}`),
        };
      }
      return { kind, change, text: chalk.green(`Recorded completion for ${change}`) };

    case 'answer':
      recordAnswer(projectRoot, batch, change, message);
      return {
        kind,
        change,
        text: chalk.green(`Recorded answer for ${change}; next apply will resume the agent.`),
      };

    case 'reject':
      recordReject(projectRoot, batch, change, message);
      return {
        kind,
        change,
        text: chalk.yellow(
          `Recorded reject feedback for ${change}; next apply re-runs propose.`
        ),
      };

    default:
      throw new Error(`Unknown report kind '${kind}'.`);
  }
}
