/**
 * Batch Status (derived live from disk)
 *
 * The manifest holds intent only; progress is never stored. Status is computed
 * live from disk PLUS the run journal, under the single journal-aware definition
 * of done (see `hasJournaledVerify`/`isChangeDone` in engine/transition):
 *   - no change directory yet                       -> pending (lazy creation)
 *   - change dir exists, partial tasks              -> in-progress
 *   - all tasks checked, NO journaled verify        -> awaiting-verify (NOT done)
 *   - all tasks checked AND journaled verify        -> done
 *   - change archived                               -> done
 *
 * `awaiting-verify` is the in-between state the two old divergent done-rules hid:
 * status must not report a change done on task-checkboxes alone while the
 * transition logic still wants a verify gate to run.
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
import type { JournalEntry, ParkedKind, RunState } from './journal.js';
import { readJournal, proofRecordsFromEntries } from './journal.js';
import { hasJournaledVerify } from './engine/transition.js';

export type ChangeStatus =
  | 'pending'
  | 'ready'
  | 'in-progress'
  | 'awaiting-verify'
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
  /** The change's own definition of done (required on every change intent). */
  done: string;
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
  /**
   * True while a prior phase gates this one: either the prior phase still has
   * work, or it is done but its recorded boundary proof-of-work failed
   * (`gatePassed: false`). See `computeBatchStatus` for the full gate rule.
   */
  gated: boolean;
  /**
   * Why this phase is gated, if it is: the bare prior-phase name when that phase
   * still has work, or a message citing the prior phase's failing proof-of-work
   * (and its detail) when a recorded `hard-gate` proof closed the gate.
   */
  gatedBy?: string;
  status: 'pending' | 'in-progress' | 'done' | 'blocked';
}

export interface BatchStatusInfo {
  name: string;
  phases: PhaseStatusInfo[];
  progress: TaskProgress;
  changeCount: number;
  doneCount: number;
  /**
   * The next actionable step, if any. Usually the first ready, ungated change
   * (`change` set). A reachable, ungated phase whose `changes` list is still
   * empty is surfaced as a decomposition step instead: `decompose: true` with no
   * `change` (the concrete intents are authored by the follow-on decomposition
   * run, not here). When every change is done but the TERMINAL phase's boundary
   * proof-of-work has not yet run, the terminal proof is surfaced as the next
   * step: `proof: true` with the terminal phase name and no `change` (see
   * `computeBatchStatus` — the batch is not `done` until that proof is recorded
   * as satisfied).
   */
  next?: { phase: string; change?: string; decompose?: boolean; proof?: boolean };
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

interface ChangeBase {
  exists: boolean;
  archived: boolean;
  progress: TaskProgress;
  /** True iff truly done under the single journal-aware rule (verified/archived). */
  done: boolean;
  /** True iff tasks are all checked but no verify completion is journaled yet. */
  awaitingVerify: boolean;
}

/**
 * Derive a single change's on-disk status (ignoring DAG/phase gating), honoring
 * the ONE journal-aware definition of done. `journal` is this change's run-journal
 * entries: tasks all checked + a journaled verify completion => done; tasks all
 * checked + no journaled verify => `awaitingVerify` (NOT done); partial tasks =>
 * neither; archived => done. The verify-completion rule itself lives in
 * `hasJournaledVerify` (engine/transition), so status never re-derives it.
 */
async function deriveChangeBase(
  projectRoot: string,
  intent: ChangeIntent,
  journal: JournalEntry[]
): Promise<ChangeBase> {
  const changesDir = path.join(projectRoot, RATCHET_DIR_NAME, 'changes');
  const archived = isArchived(projectRoot, intent.name);
  if (archived) {
    return {
      exists: false,
      archived: true,
      progress: { total: 0, completed: 0 },
      done: true,
      awaitingVerify: false,
    };
  }

  const exists = changeExists(projectRoot, intent.name);
  if (!exists) {
    return {
      exists: false,
      archived: false,
      progress: { total: 0, completed: 0 },
      done: false,
      awaitingVerify: false,
    };
  }

  const progress = await getTaskProgressForChange(changesDir, intent.name);
  const allChecked = progress.total > 0 && progress.completed === progress.total;
  const verified = hasJournaledVerify(journal);
  const done = allChecked && verified;
  const awaitingVerify = allChecked && !verified;
  return { exists: true, archived: false, progress, done, awaitingVerify };
}

async function derivePhaseStatus(
  projectRoot: string,
  phase: Phase,
  gated: boolean,
  gatedBy: string | undefined,
  runState: RunState,
  journal: JournalEntry[]
): Promise<PhaseStatusInfo> {
  // First pass: derive each change's on-disk base + collect the done set. Each
  // change sees only its own journal entries for the verify-gate check.
  const bases = new Map<string, ChangeBase>();
  for (const intent of phase.changes) {
    const changeJournal = journal.filter((e) => e.change === intent.name);
    bases.set(intent.name, await deriveChangeBase(projectRoot, intent, changeJournal));
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
    } else if (base.awaitingVerify) {
      // Tasks all checked but no journaled verify completion yet: the verify gate
      // has not run. Explicitly NOT done — the single journal-aware done-rule.
      status = 'awaiting-verify';
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
      done: intent.done,
      blockedBy,
      parked,
    };
  });

  // `allDone` stays keyed on `status === 'done'` ONLY: a phase holding an
  // `awaiting-verify` change is NOT done (its verify gate must still run).
  const allDone = changes.length > 0 && changes.every((c) => c.status === 'done');
  // `awaiting-verify` is actionable work (a runnable verify step), so it counts
  // as progress for the phase rollup, not as finished.
  const anyProgress = changes.some(
    (c) =>
      c.status === 'in-progress' ||
      c.status === 'awaiting-verify' ||
      c.status === 'done'
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
 * Phase gating derives from the prior phase's RECORDED proof-of-work outcome,
 * not from "all changes done" alone. Walking phases in order, the gate for phase
 * N consults phase N-1 (`P`) and its latest recorded boundary proof `rec`
 * (folded from the run `journal` via `proofRecordsFromEntries`, so the gate is
 * derived from the same entries this function is given — no extra disk read):
 *   - `P` not done                  -> gated; `gatedBy` is the bare prior name
 *                                       (the prior phase still has work).
 *   - `P` done, no `rec` yet         -> gate OPEN. The boundary proof has not run;
 *                                       the phase is reachable so the boundary
 *                                       proof-of-work step can run. No verdict is
 *                                       asserted before one exists.
 *   - `P` done, `rec.gatePassed`     -> gate OPEN (passed, or `warn` — see below).
 *   - `P` done, `!rec.gatePassed`    -> gate CLOSED: phase `blocked`, `gatedBy`
 *                                       cites `P`'s failing proof and its detail.
 *
 * Because the recorder folds policy into `gatePassed` (`warn` always records
 * `gatePassed: true`), consulting that one boolean expresses both policies: a
 * failing proof under `warn` never closes the gate. This is the single gate rule;
 * `pickNextStep` reads the derived `gated` and `selectRunnableStep` receives it
 * as input, so status and selection agree on the proof-derived gate by
 * construction. The boundary proof itself is executed and recorded by
 * `batch apply` (see `engine/proof-of-work.ts`'s `runProofOfWork`).
 */
export async function computeBatchStatus(
  projectRoot: string,
  manifest: BatchManifest,
  runState: RunState = { parked: {} },
  journal: JournalEntry[] = readJournal(projectRoot, manifest.name)
): Promise<BatchStatusInfo> {
  const phases: PhaseStatusInfo[] = [];
  // Latest recorded proof per phase, derived from the same journal status reads.
  const proofByPhase = proofRecordsFromEntries(journal);
  let priorPhaseDone = true;
  let priorPhaseName: string | undefined;

  for (const phase of manifest.phases) {
    let gated = false;
    let gatedBy: string | undefined;
    if (!priorPhaseDone) {
      // Prior phase still has outstanding work: gated the old way.
      gated = true;
      gatedBy = priorPhaseName;
    } else if (priorPhaseName) {
      // Prior phase is done: the gate now turns on its recorded boundary proof.
      // No record yet keeps the gate open so the boundary proof step can run; a
      // recorded failing (`!gatePassed`) verdict closes it with a clear reason.
      const rec = proofByPhase.get(priorPhaseName);
      if (rec && !rec.gatePassed) {
        gated = true;
        gatedBy = `${priorPhaseName} — proof-of-work failed: ${rec.detail}`;
      }
    }
    const phaseStatus = await derivePhaseStatus(
      projectRoot,
      phase,
      gated,
      gatedBy,
      runState,
      journal
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
  let next: { phase: string; change?: string; decompose?: boolean; proof?: boolean } | undefined;

  for (const phase of phases) {
    for (const change of phase.changes) {
      changeCount += 1;
      total += change.progress.total;
      completed += change.progress.completed;
      if (change.status === 'done') doneCount += 1;
      if (
        !next &&
        !phase.gated &&
        (change.status === 'ready' ||
          change.status === 'in-progress' ||
          // An `awaiting-verify` change has a runnable next step (verify); it is
          // the gate that must run before the change can be done, so it is the
          // batch's next actionable step.
          change.status === 'awaiting-verify')
      ) {
        next = { phase: phase.name, change: change.name };
      }
    }
  }

  // A reachable, ungated phase whose `changes` list is empty is undecomposed: an
  // outstanding decomposition step, NOT vacuously complete. Both this seam and
  // `selectRunnableStep` key off the same two facts — "phase decomposed?"
  // (`changes.length > 0`) and "phase reachable?" (ungated) — so status and
  // selection cannot disagree about whether a reachable empty phase is work.
  // `derivePhaseStatus` already reports such a phase as `pending` (not `done`);
  // this folds that fact into the batch-level done rule. A still-gated empty
  // phase is NOT outstanding yet — the unfinished prior-phase change comes first.
  const reachableUndecomposed = phases.find(
    (p) => p.changes.length === 0 && !p.gated
  );

  // Surface the first reachable undecomposed phase as the decomposition step when
  // no change-level next was found, so the apply loop has a step to act on. We
  // carry only the phase (no `change`); the concrete intents are authored by the
  // follow-on decomposition run, not invented here.
  if (!next && reachableUndecomposed) {
    next = { phase: reachableUndecomposed.name, decompose: true };
  }

  // Terminal-phase proof-of-work gate (C2). Every phase's boundary proof is run
  // when ENTERING the next phase, but the LAST phase has no successor, so its
  // proof would never run — and the batch would report `done` without it. Close
  // that hole: the batch is not `done` until the terminal phase's proof is
  // recorded as satisfied. `terminalProofSatisfied` folds policy via the same
  // `gatePassed` boolean the phase gate uses (`warn` records `gatePassed: true`),
  // so a `warn` failure still satisfies it. A batch with no phases (no terminal
  // phase) is vacuously satisfied.
  const terminalPhase = manifest.phases[manifest.phases.length - 1];
  const terminalRec = terminalPhase ? proofByPhase.get(terminalPhase.name) : undefined;
  const terminalProofSatisfied =
    !terminalPhase?.proofOfWork || terminalRec?.gatePassed === true;
  // The terminal proof only matters once the terminal phase is itself a FINISHED
  // phase — ungated AND decomposed AND all its changes done (`PhaseStatusInfo`
  // `done`). A gated terminal (e.g. its predecessor's proof failed) or an
  // undecomposed empty terminal keeps the batch in-progress on its own; surfacing
  // or running its proof there would execute a command on blocked/nonexistent
  // work and could flip the batch to a false `done`. `reachableUndecomposed` only
  // catches UNGATED empties, so this guard is what closes the gated-empty case.
  const terminalPhaseDone = phases[phases.length - 1]?.status === 'done';

  // When every change is done and nothing is left to decompose but the terminal
  // proof is NOT yet satisfied, surface the next step:
  //  - proof never ran (`terminalRec` undefined) -> offer it as a selectable
  //    `proof` step so `batch apply` runs and records it.
  //  - proof ran and FAILED its hard-gate (`!gatePassed`) -> nothing is
  //    auto-runnable; leave `next` undefined so the operator must
  //    `batch rerun-proof` or fix. Either way the batch stays out of `done`.
  if (
    !next &&
    changeCount > 0 &&
    doneCount === changeCount &&
    !reachableUndecomposed &&
    terminalPhaseDone &&
    !terminalProofSatisfied &&
    terminalRec === undefined &&
    terminalPhase
  ) {
    next = { phase: terminalPhase.name, proof: true };
  }

  let status: BatchStatusInfo['status'];
  if (changeCount === 0) {
    // Brand-new batch with no actionable change intents anywhere: empty.
    status = 'empty';
  } else if (
    doneCount === changeCount &&
    !reachableUndecomposed &&
    terminalPhaseDone &&
    terminalProofSatisfied
  ) {
    // Done ONLY when every declared change is done, no reachable phase is still
    // undecomposed, AND the terminal phase's boundary proof-of-work is recorded
    // as satisfied. A reachable empty phase or an unrun/failing terminal proof
    // keeps the batch out of `done` (it falls through to `in-progress`).
    status = 'done';
  } else if (
    doneCount > 0 ||
    phases.some((p) => p.status === 'in-progress') ||
    reachableUndecomposed
  ) {
    // A reachable undecomposed phase is in-flight decomposition work.
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
