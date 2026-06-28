/**
 * Runnable-step selection.
 *
 * The contract hands the engine a single resolved change, but the engine also
 * exposes pure selection so a later internal-loop change (and the tests for this
 * one) can pick the next runnable change from a phase's DAG view: a change that
 * is ready (all `after` deps done) and not itself done/blocked/gated.
 *
 * This mirrors the CLI's `pickNextStep` but operates on plain data so it is
 * testable without the filesystem.
 */

export interface SelectableChange {
  name: string;
  /** `after` dependency names within the same phase. */
  after: string[];
  /**
   * True when the change is done under the ONE journal-aware rule — fed from the
   * same predicate as status and transition (`isChangeDone` in transition.ts):
   * archived, or tasks all checked AND a verify completion journaled. A
   * tasks-checked-but-unverified change is therefore `done: false`, so selection
   * picks it and verify runs as the gate before done — selection and the
   * next-transition logic agree by construction.
   */
  done: boolean;
  /** True when the change has an unresolved park (blocked/awaiting input). */
  parked: boolean;
}

export interface SelectablePhase {
  name: string;
  /**
   * True when a prior phase gates this one. Callers populate it from
   * `computeBatchStatus`'s derived `phase.gated`, which now folds in the prior
   * phase's recorded boundary proof-of-work: a phase whose predecessor is done
   * but whose recorded `hard-gate` proof failed (`gatePassed: false`) is `gated`.
   * Selection therefore refuses a proof-blocked phase by construction — it reads
   * the same gate status reports, never re-deriving it.
   */
  gated: boolean;
  changes: SelectableChange[];
  /**
   * True when the phase has concrete change intents yet to act on (i.e. it is
   * decomposed). Derived from `changes.length > 0`; when omitted it falls back to
   * exactly that, so callers need not set it. A reachable (ungated) phase that is
   * NOT decomposed is an outstanding decomposition step, not vacuously done.
   */
  decomposed?: boolean;
}

export interface SelectedStep {
  phase: string;
  /**
   * The selected change, when the step advances a concrete change intent. Absent
   * on a decomposition step (the phase has no concrete change intents yet).
   */
  change?: string;
  /**
   * True when this is a decomposition step: a reachable, ungated phase whose
   * `changes` list is empty. The follow-on `drive-decomposition-step` change
   * consumes this to spawn the agent that authors the phase's concrete intents.
   */
  decompose?: boolean;
}

export type NoStepReason =
  | 'all-done'
  | 'all-gated'
  | 'all-blocked-or-parked'
  | 'empty';

export interface SelectionResult {
  step?: SelectedStep;
  reason?: NoStepReason;
}

/**
 * Select the first runnable change across phases in order: skip gated phases,
 * then within a phase pick the first change whose deps are all done, that is not
 * itself done, and not parked. Returns a reason when nothing is runnable.
 *
 * `gated` folds in the prior phase's recorded proof-of-work (see
 * `SelectablePhase.gated`): a phase held shut by a failing `hard-gate` proof is
 * skipped here exactly as status reports it `blocked`, so the step this seam
 * refuses to run is precisely the one status reports as gated — they agree by
 * construction because both read the single gate `computeBatchStatus` derived.
 */
export function selectRunnableStep(phases: SelectablePhase[]): SelectionResult {
  if (phases.length === 0 || phases.every((p) => p.changes.length === 0)) {
    return { reason: 'empty' };
  }

  // A phase is decomposed when it has concrete change intents. Keyed off
  // `changes.length > 0` — the SAME fact `computeBatchStatus` uses — so status
  // and selection cannot disagree about whether a reachable empty phase is work.
  const isDecomposed = (p: SelectablePhase) =>
    p.decomposed ?? p.changes.length > 0;

  // `all-done` ONLY when every phase is decomposed AND all its changes are done.
  // The old rule used `phase.changes.every((c) => c.done)`, which an empty phase
  // satisfies VACUOUSLY — masking the undecomposed phase as finished.
  const allDone = phases.every(
    (p) => isDecomposed(p) && p.changes.every((c) => c.done)
  );
  if (allDone) return { reason: 'all-done' };

  let sawBlockedOrParked = false;
  let sawGatedWithWork = false;

  for (const phase of phases) {
    const decomposed = isDecomposed(phase);
    // An undecomposed reachable phase is outstanding work even with no changes.
    const phaseHasWork = !decomposed || phase.changes.some((c) => !c.done);

    if (phase.gated) {
      if (phaseHasWork) sawGatedWithWork = true;
      continue;
    }

    // Reachable (ungated) but undecomposed: the outstanding decomposition step.
    // The follow-on change spawns the agent that authors this phase's intents.
    if (!decomposed) {
      return { step: { phase: phase.name, decompose: true } };
    }

    const doneSet = new Set(
      phase.changes.filter((c) => c.done).map((c) => c.name)
    );

    for (const change of phase.changes) {
      if (change.done) continue;
      const depsMet = change.after.every((dep) => doneSet.has(dep));
      if (!depsMet) {
        sawBlockedOrParked = true;
        continue;
      }
      if (change.parked) {
        sawBlockedOrParked = true;
        continue;
      }
      return { step: { phase: phase.name, change: change.name } };
    }
  }

  if (sawBlockedOrParked) return { reason: 'all-blocked-or-parked' };
  // No runnable ungated work, and no blocked/parked ungated work: the only
  // remaining work (if any) sits behind a phase gate.
  if (sawGatedWithWork) return { reason: 'all-gated' };
  return { reason: 'all-done' };
}
