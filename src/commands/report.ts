/**
 * `ratchet report <change> [--status|--blocker|--needs-input|--complete] <message>`
 *
 * The batch-less report channel for the standalone headless verbs
 * (`ratchet propose|apply|verify <change>`). Those verbs run with no batch, so
 * their run journal lives change-locally under `.ratchet/changes/<change>/.run/`;
 * this command appends to exactly that journal — the one the engine snapshots to
 * map the step's outcome. Unlike `batch report [name]`, it never resolves a
 * batch, so a lone batch in the project can never capture a standalone report.
 *
 * Only the four kinds the engine's outcome mapper reads from the session journal
 * are offered: standalone steps have no park/resume state, so `--answer` /
 * `--reject` do not apply here.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../core/planning-home.js';
import { appendJournalForLocus, type JournalEntry } from '../core/batch/journal.js';
import { validateChangeName } from '../utils/change-utils.js';
import { reportProvenance, selectReportKind } from './batch/report.js';

export interface ReportOptions {
  status?: string;
  blocker?: string;
  needsInput?: string;
  complete?: string;
  json?: boolean;
}

const STANDALONE_KINDS = ['status', 'blocker', 'needs-input', 'complete'] as const;

const JOURNAL_KIND: Record<(typeof STANDALONE_KINDS)[number], JournalEntry['kind']> = {
  status: 'progress',
  blocker: 'blocker',
  'needs-input': 'needs-input',
  complete: 'completion',
};

export async function reportCommand(
  change: string,
  options: ReportOptions,
  projectRoot: string = resolveCurrentPlanningHomeSync().root
): Promise<void> {
  const [kind, message] = selectReportKind(options, STANDALONE_KINDS);

  // Validate the NAME before building any path, so a traversal like `../../src`
  // can never resolve a journal outside `.ratchet/changes/`. The change DIRECTORY
  // is deliberately not required: a fresh `ratchet propose` spawns the agent
  // before the change exists, and its early progress/blocker reports must still
  // reach the change-local journal the engine snapshots.
  const name = validateChangeName(change);
  if (!name.valid) {
    throw new Error(`Invalid change name "${change}": ${name.error}.`);
  }

  appendJournalForLocus(projectRoot, { change }, {
    change,
    kind: JOURNAL_KIND[kind],
    message,
    ...reportProvenance(),
  });

  if (options.json) {
    console.log(JSON.stringify({ kind, change }, null, 2));
    return;
  }
  console.log(renderReport(kind, change, message));
}

function renderReport(
  kind: (typeof STANDALONE_KINDS)[number],
  change: string,
  message: string
): string {
  switch (kind) {
    case 'status':
      return chalk.dim(`Recorded progress for ${change}: ${message}`);
    case 'blocker':
      return chalk.yellow(`Recorded blocker for ${change}: ${message}`);
    case 'needs-input':
      return chalk.yellow(`Recorded input request for ${change}: ${message}`);
    case 'complete':
      return chalk.green(`Recorded completion for ${change}`);
  }
}
