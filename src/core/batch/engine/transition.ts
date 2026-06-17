/**
 * Next-transition computation from on-disk change state.
 *
 * The per-change transition order is propose -> apply -> verify, derived from
 * what exists on disk for the change:
 *
 *   - no change directory yet            -> propose
 *   - change dir + plan, not yet applied -> apply
 *   - applied (all tasks done)           -> verify
 *
 * "Applied" is approximated by task-checkbox progress: a plan whose tasks are
 * all checked has been implemented and is ready for verify; a partial plan is
 * still in apply. The engine is given the resolved context (including the prior
 * journal) but reads the live change directory to decide precisely, since the
 * CLI only computes a coarse view.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { JournalEntry } from '../journal.js';
import type { Transition } from './contract.js';

const RATCHET_DIR = '.ratchet';

function changeDir(projectRoot: string, change: string): string {
  return path.join(projectRoot, RATCHET_DIR, 'changes', change);
}

function planPath(projectRoot: string, change: string): string {
  return path.join(changeDir(projectRoot, change), 'plan.md');
}

function archivePath(projectRoot: string, change: string): string {
  return path.join(projectRoot, RATCHET_DIR, 'changes', 'archive', change);
}

export interface ChangeDiskState {
  exists: boolean;
  archived: boolean;
  hasPlan: boolean;
  tasksTotal: number;
  tasksComplete: number;
  /** True when a plan exists and every task checkbox is checked. */
  applied: boolean;
}

/**
 * Count `- [ ]` / `- [x]` task checkboxes under a `## Tasks` section of plan.md,
 * mirroring how the CLI derives change progress (see `utils/task-progress`).
 */
const TASK_PATTERN = /^[-*]\s+\[[\sx]\]/i;
const COMPLETED_TASK_PATTERN = /^[-*]\s+\[x\]/i;

function countTasks(plan: string): { total: number; complete: number } {
  let total = 0;
  let complete = 0;
  for (const line of plan.split('\n')) {
    if (TASK_PATTERN.test(line)) {
      total += 1;
      if (COMPLETED_TASK_PATTERN.test(line)) complete += 1;
    }
  }
  return { total, complete };
}

export function readChangeDiskState(projectRoot: string, change: string): ChangeDiskState {
  if (existsSync(archivePath(projectRoot, change))) {
    return {
      exists: false,
      archived: true,
      hasPlan: false,
      tasksTotal: 0,
      tasksComplete: 0,
      applied: true,
    };
  }

  const exists = existsSync(changeDir(projectRoot, change));
  if (!exists) {
    return {
      exists: false,
      archived: false,
      hasPlan: false,
      tasksTotal: 0,
      tasksComplete: 0,
      applied: false,
    };
  }

  const plan = planPath(projectRoot, change);
  const hasPlan = existsSync(plan);
  let tasksTotal = 0;
  let tasksComplete = 0;
  if (hasPlan) {
    const counts = countTasks(readFileSync(plan, 'utf-8'));
    tasksTotal = counts.total;
    tasksComplete = counts.complete;
  }

  const applied = hasPlan && tasksTotal > 0 && tasksComplete === tasksTotal;
  return { exists, archived: false, hasPlan, tasksTotal, tasksComplete, applied };
}

/**
 * Compute the next transition for a change purely from its on-disk state.
 *
 * Returns `undefined` when the change is already verified/archived (nothing
 * runnable for it).
 */
export function computeNextTransition(
  projectRoot: string,
  change: string,
  journal: JournalEntry[] = []
): Transition | undefined {
  const disk = readChangeDiskState(projectRoot, change);

  if (disk.archived) return undefined;

  if (!disk.exists) return 'propose';

  // A change directory exists but has no plan yet: the propose did not finish.
  if (!disk.hasPlan) return 'propose';

  // Plan present but tasks not all done: implement (apply).
  if (!disk.applied) return 'apply';

  // Tasks all done. If a verify completion was already journaled, the change is
  // verified and there is nothing more to do; otherwise the next step is verify.
  const verified = journal.some(
    (e) => e.kind === 'completion' && e.transition === 'verify'
  );
  return verified ? undefined : 'verify';
}
