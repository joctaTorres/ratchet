/**
 * Batch Status (derived live from disk)
 *
 * The manifest holds intent only; progress is never stored. Status is computed
 * the way `ratchet view` already does it:
 *   - no change directory yet            -> pending (NOT an error: lazy creation)
 *   - change dir exists, partial tasks   -> in-progress
 *   - change dir exists, all tasks done  -> done
 *   - change archived                    -> done
 *
 * Phase status aggregates its change intents plus the prior-phase proof-of-work
 * gate; batch status aggregates phases.
 */

import { existsSync } from 'fs';
import path from 'path';
import { RATCHET_DIR_NAME } from '../config.js';
import { getTaskProgressForChange, type TaskProgress } from '../../utils/task-progress.js';
import { BatchDag } from './dag.js';
import type { BatchManifest, Phase, ChangeIntent } from './manifest.js';
import type { ParkedKind, RunState } from './journal.js';

export type ChangeStatus =
  | 'pending'
  | 'ready'
  | 'in-progress'
  | 'done'
  | 'blocked'
  | 'awaiting-approval';

/**
 * Parked overlay surfaced from the run journal/state onto a derived change.
 * Mirrors the user-visible fields of a `ParkedStep` so status text, `--json`,
 * and the rich view can all render the halt and its question/summary.
 */
export interface ParkedInfo {
  kind: ParkedKind;
  /** The blocker question or the awaiting-approval summary that parked it. */
  reason: string;
  /** User's recorded answer (blocked) — present once they responded. */
  answer?: string;
  /** User's reject feedback (awaiting-approval). */
  feedback?: string;
  /** True once an awaiting-approval step was approved. */
  approved?: boolean;
}

export interface ChangeStatusInfo {
  name: string;
  status: ChangeStatus;
  exists: boolean;
  archived: boolean;
  progress: TaskProgress;
  after: string[];
  /** The change's own success criterion, if its intent declared one. */
  success?: string;
  /** When blocked, the unmet (not-done) dependency names. */
  blockedBy: string[];
  /** Parked state overlaid from the run journal, if the step is halted. */
  parked?: ParkedInfo;
}

export interface PhaseStatusInfo {
  name: string;
  goal: string;
  success: string;
  changes: ChangeStatusInfo[];
  /** True until the prior phase's proof-of-work is satisfied (all done). */
  gated: boolean;
  /** Name of the prior phase gating this one, if gated. */
  gatedBy?: string;
  status: 'pending' | 'in-progress' | 'done' | 'blocked';
}

export interface BatchStatusInfo {
  name: string;
  phases: PhaseStatusInfo[];
  progress: TaskProgress;
  changeCount: number;
  doneCount: number;
  /** The next actionable step, if any (first ready, ungated change). */
  next?: { phase: string; change: string };
  status: 'empty' | 'pending' | 'in-progress' | 'done';
}

function isArchived(projectRoot: string, changeName: string): boolean {
  const archivePath = path.join(
    projectRoot,
    RATCHET_DIR_NAME,
    'changes',
    'archive',
    changeName
  );
  return existsSync(archivePath);
}

function changeExists(projectRoot: string, changeName: string): boolean {
  const changePath = path.join(projectRoot, RATCHET_DIR_NAME, 'changes', changeName);
  return existsSync(changePath);
}

/** Derive a single change's on-disk status (ignoring DAG/phase gating). */
async function deriveChangeBase(
  projectRoot: string,
  intent: ChangeIntent
): Promise<{ exists: boolean; archived: boolean; progress: TaskProgress; done: boolean }> {
  const changesDir = path.join(projectRoot, RATCHET_DIR_NAME, 'changes');
  const archived = isArchived(projectRoot, intent.name);
  if (archived) {
    return { exists: false, archived: true, progress: { total: 0, completed: 0 }, done: true };
  }

  const exists = changeExists(projectRoot, intent.name);
  if (!exists) {
    return { exists: false, archived: false, progress: { total: 0, completed: 0 }, done: false };
  }

  const progress = await getTaskProgressForChange(changesDir, intent.name);
  const done = progress.total > 0 && progress.completed === progress.total;
  return { exists: true, archived: false, progress, done };
}

async function derivePhaseStatus(
  projectRoot: string,
  phase: Phase,
  gated: boolean,
  gatedBy: string | undefined,
  runState: RunState
): Promise<PhaseStatusInfo> {
  // First pass: derive each change's on-disk base + collect the done set.
  const bases = new Map<
    string,
    Awaited<ReturnType<typeof deriveChangeBase>>
  >();
  for (const intent of phase.changes) {
    bases.set(intent.name, await deriveChangeBase(projectRoot, intent));
  }

  const doneSet = new Set(
    phase.changes.filter((c) => bases.get(c.name)!.done).map((c) => c.name)
  );

  // DAG over this phase's intents gives ready/blocked.
  const dag = BatchDag.fromIntents(phase.changes);
  const blocked = dag.getBlocked(doneSet);

  const changes: ChangeStatusInfo[] = phase.changes.map((intent) => {
    const base = bases.get(intent.name)!;
    const blockedBy = blocked[intent.name] ?? [];

    let status: ChangeStatus;
    if (base.done) {
      status = 'done';
    } else if (base.exists && base.progress.total > 0) {
      status = 'in-progress';
    } else if (blockedBy.length > 0) {
      status = 'blocked';
    } else {
      // Ready to start. A pending change (no dir) that is ready is reported as
      // ready-to-start; an existing-but-empty change is also ready.
      status = base.exists ? 'in-progress' : 'ready';
    }

    // Overlay parked state from the run journal: a step the agent halted (a
    // voluntary blocker or an after-propose approval request) must surface as
    // halted, not as ready/in-progress. A finished (done/archived) step's stale
    // park is moot, so we leave it alone.
    const parkedRaw = runState.parked[intent.name];
    let parked: ParkedInfo | undefined;
    if (parkedRaw && !base.done) {
      parked = {
        kind: parkedRaw.kind,
        reason: parkedRaw.reason,
        answer: parkedRaw.answer,
        feedback: parkedRaw.feedback,
        approved: parkedRaw.approved,
      };
      if (parkedRaw.kind === 'blocked') {
        status = 'blocked';
      } else if (parkedRaw.kind === 'awaiting-approval' && !parkedRaw.approved) {
        status = 'awaiting-approval';
      }
    }

    return {
      name: intent.name,
      status,
      exists: base.exists,
      archived: base.archived,
      progress: base.progress,
      after: intent.after,
      ...(intent.success ? { success: intent.success } : {}),
      blockedBy,
      parked,
    };
  });

  const allDone = changes.length > 0 && changes.every((c) => c.status === 'done');
  const anyProgress = changes.some(
    (c) => c.status === 'in-progress' || c.status === 'done'
  );

  let status: PhaseStatusInfo['status'];
  if (gated) {
    status = 'blocked';
  } else if (allDone) {
    status = 'done';
  } else if (anyProgress) {
    status = 'in-progress';
  } else {
    status = 'pending';
  }

  return {
    name: phase.name,
    goal: phase.goal,
    success: phase.success,
    changes,
    gated,
    gatedBy,
    status,
  };
}

/**
 * Compute the full derived status for a batch manifest.
 *
 * Phase gating: phase N is gated until phase N-1 is `done` (all its changes
 * done — a stand-in for "prior phase proof-of-work passed", which the engine
 * actually executes; the CLI models the gate).
 *
 * DEFERRED (by design): this `priorPhaseDone` gate does NOT yet consult
 * `runProofOfWork`'s `gatePassed`. Proof-of-work execution is implemented and
 * unit-tested in `engine/proof-of-work.ts` but is wired in by the future
 * host/internal loop, not by the single-step `batch apply` path. Until then a
 * `hard-gate` proof-of-work cannot block a phase here; the gate is "prior phase
 * all changes done". See the `runProofOfWork` docstring for the seam.
 */
export async function computeBatchStatus(
  projectRoot: string,
  manifest: BatchManifest,
  runState: RunState = { parked: {} }
): Promise<BatchStatusInfo> {
  const phases: PhaseStatusInfo[] = [];
  let priorPhaseDone = true;
  let priorPhaseName: string | undefined;

  for (const phase of manifest.phases) {
    const gated = !priorPhaseDone;
    const phaseStatus = await derivePhaseStatus(
      projectRoot,
      phase,
      gated,
      gated ? priorPhaseName : undefined,
      runState
    );
    phases.push(phaseStatus);
    priorPhaseDone = phaseStatus.status === 'done';
    priorPhaseName = phase.name;
  }

  // Aggregate task progress and counts.
  let total = 0;
  let completed = 0;
  let changeCount = 0;
  let doneCount = 0;
  let next: { phase: string; change: string } | undefined;

  for (const phase of phases) {
    for (const change of phase.changes) {
      changeCount += 1;
      total += change.progress.total;
      completed += change.progress.completed;
      if (change.status === 'done') doneCount += 1;
      if (
        !next &&
        !phase.gated &&
        (change.status === 'ready' || change.status === 'in-progress')
      ) {
        next = { phase: phase.name, change: change.name };
      }
    }
  }

  let status: BatchStatusInfo['status'];
  if (changeCount === 0) {
    status = 'empty';
  } else if (doneCount === changeCount) {
    status = 'done';
  } else if (doneCount > 0 || phases.some((p) => p.status === 'in-progress')) {
    status = 'in-progress';
  } else {
    status = 'pending';
  }

  return {
    name: manifest.name,
    phases,
    progress: { total, completed },
    changeCount,
    doneCount,
    next,
    status,
  };
}
