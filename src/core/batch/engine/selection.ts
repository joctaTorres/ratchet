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
  /** True when the change is already done (verified/archived). */
  done: boolean;
  /** True when the change has an unresolved park (blocked/awaiting input). */
  parked: boolean;
}

export interface SelectablePhase {
  name: string;
  /** True when a prior phase still gates this one. */
  gated: boolean;
  changes: SelectableChange[];
}

export interface SelectedStep {
  phase: string;
  change: string;
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
 */
export function selectRunnableStep(phases: SelectablePhase[]): SelectionResult {
  if (phases.length === 0 || phases.every((p) => p.changes.length === 0)) {
    return { reason: 'empty' };
  }

  const allDone = phases.every((p) => p.changes.every((c) => c.done));
  if (allDone) return { reason: 'all-done' };

  let sawBlockedOrParked = false;
  let sawGatedWithWork = false;

  for (const phase of phases) {
    const phaseHasWork = phase.changes.some((c) => !c.done);

    if (phase.gated) {
      if (phaseHasWork) sawGatedWithWork = true;
      continue;
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
