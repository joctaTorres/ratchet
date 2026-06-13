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

  // Exactly one report kind must be present.
  const provided = [
    ['status', options.status],
    ['blocker', options.blocker],
    ['needs-input', options.needsInput],
    ['complete', options.complete],
    ['answer', options.answer],
    ['reject', options.reject],
  ].filter(([, v]) => v !== undefined);

  if (provided.length === 0) {
    throw new Error(
      'Provide one of --status, --blocker, --needs-input, --complete, --answer, or --reject.'
    );
  }
  if (provided.length > 1) {
    throw new Error('Provide exactly one report kind at a time.');
  }

  const [kind, message] = provided[0] as [string, string];
  const result = applyReport(projectRoot, batch, change, kind, message, options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.text);
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
      appendJournal(projectRoot, batch, { change, kind: 'progress', message });
      return { kind, change, text: chalk.dim(`Recorded progress for ${change}: ${message}`) };

    case 'blocker':
      appendJournal(projectRoot, batch, { change, kind: 'blocker', message });
      parkStep(projectRoot, batch, { change, kind: 'blocked', reason: message });
      return {
        kind,
        change,
        text: chalk.yellow(`Parked ${change} as blocked: ${message}`),
      };

    case 'needs-input':
      appendJournal(projectRoot, batch, { change, kind: 'needs-input', message });
      parkStep(projectRoot, batch, { change, kind: 'blocked', reason: message });
      return {
        kind,
        change,
        text: chalk.yellow(`Parked ${change} awaiting input: ${message}`),
      };

    case 'complete':
      appendJournal(projectRoot, batch, { change, kind: 'completion', message });
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
