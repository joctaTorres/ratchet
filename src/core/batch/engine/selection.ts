/**
 * Runnable-step selection — the single selection engine.
 *
 * `pickNextStep` is the one implementation of runnable-step selection in the
 * codebase. It lives here in the engine (the home of batch orchestration policy:
 * gating, boundaries, transitions) and is exported through the engine index so
 * the CLI (`batch apply`) is a thin driver that imports it as data. It is pure
 * over its inputs (`BatchStatusInfo`, manifest `Phase[]`, recorded proof phases,
 * PR gating inputs) — it reads neither config nor the journal — so it is fully
 * testable without the filesystem.
 *
 * Status derivation (`computeBatchStatus` in `status.ts`) and step selection
 * share one runnable-change eligibility walk (`firstRunnableChange`): skip gated
 * phases, pick the first change whose derived status is in `RUNNABLE_STATUSES`.
 * Status calls it to derive the change-level `next`; `pickNextStep`'s change
 * branch calls it and layers the boundary-proof interposition on the picked
 * phase. One set, one walk — status and selection agree by construction instead
 * of by mirrored comments.
 */

import { prJournalKey } from './instructions.js';
import {
  detectPrGroupBoundaries,
  type BoundaryBatchState,
  type PrGroupBoundary,
} from './boundary.js';
import type { BatchStatusInfo, ChangeStatus, PhaseStatusInfo } from '../status.js';
import type { Phase } from '../manifest.js';
import type { PrGrouping } from '../config.js';

/**
 * The change statuses whose next step is runnable by the change branch. `ready`
 * and `in-progress` are self-evident; `awaiting-verify` is selectable because its
 * runnable next step is the verify gate, which must run before the change can be
 * done (the engine derives `verify` via `computeNextTransition`) — skipping it
 * would strand verify.
 */
export const RUNNABLE_STATUSES: ReadonlySet<ChangeStatus> = new Set<ChangeStatus>([
  'ready',
  'in-progress',
  'awaiting-verify',
]);

/**
 * The next runnable step `batch apply` acts on: a concrete CHANGE step (drives
 * `engine.runStep`), a phase DECOMPOSE step (drives `engine.runDecompositionStep`),
 * a boundary PROOF-OF-WORK step (drives `runProofOfWork`), or the completion PR
 * step (drives `engine.runPrStep`). The kinds are distinguished by `kind` so
 * `batchApplyCommand` routes each to the right engine entry point.
 *
 * `pr` is a PR-open step, surfaced only once the batch is otherwise `done` under
 * an active grouping mode with unopened work; it carries a phase for the agent's
 * phase framing and no change (there is none). `boundary` distinguishes the two
 * shapes: absent → the whole-batch completion PR (`prGrouping: whole-batch`,
 * routed to `runPr`, unchanged); present → a fired stacked group boundary
 * (`per-phase`/`per-change`, routed to `runStackedPr`).
 */
export type ApplyTarget =
  | { kind: 'change'; phase: Phase; change: string; changeDone: string }
  | { kind: 'decompose'; phase: Phase }
  | { kind: 'proof-of-work'; phase: Phase }
  | { kind: 'pr'; phase: Phase; boundary?: PrGroupBoundary };

/**
 * The resolved PR gating inputs `pickNextStep` consumes as data — the same shape
 * the public selector accepts inline. Extracted so the per-branch selector
 * helpers share one type; `pickNextStep`'s public signature is unchanged.
 */
interface PickPrContext {
  grouping: PrGrouping;
  alreadyOpened: boolean;
  openedGroupKeys?: ReadonlySet<string>;
}

/**
 * A single runnable-change eligibility hit: the first ungated phase's first
 * change whose derived status is in `RUNNABLE_STATUSES`, with the indices/references
 * the change branch needs to layer the boundary-proof interposition. Shared by
 * `computeBatchStatus` (to derive the change-level `next`) and
 * `selectChangeOrBoundaryProof` (to pick the step), so status derivation and step
 * selection share one code path and cannot drift.
 */
export interface RunnableChangeHit {
  /** Index of the hit phase in the status `phases` array (for the predecessor). */
  phaseIndex: number;
  /** The status phase entry of the hit phase. */
  phase: PhaseStatusInfo;
  /** The manifest phase entry of the hit phase (carries `proofOfWork` etc). */
  manifestPhase: Phase;
  /** The runnable change within the hit phase. */
  change: PhaseStatusInfo['changes'][number];
}

/**
 * The runnable-change eligibility walk — the ONE place "first ungated phase's
 * first runnable change" is derived. Skip gated phases, then pick the first
 * change whose derived status is in `RUNNABLE_STATUSES` (`ready` / `in-progress`
 * / `awaiting-verify`). Returns the hit (with the phase index and manifest phase
 * the change branch needs) or `undefined` when no ungated phase has a runnable
 * change. Pure over its inputs; keyed on the single `RUNNABLE_STATUSES` set.
 */
export function firstRunnableChange(
  statusPhases: BatchStatusInfo['phases'],
  manifestPhases: Phase[]
): RunnableChangeHit | undefined {
  for (let i = 0; i < statusPhases.length; i++) {
    const phaseStatus = statusPhases[i];
    if (phaseStatus.gated) continue;
    const manifestPhase = manifestPhases.find((p) => p.name === phaseStatus.name);
    if (!manifestPhase) continue;
    for (const change of phaseStatus.changes) {
      if (RUNNABLE_STATUSES.has(change.status)) {
        return { phaseIndex: i, phase: phaseStatus, manifestPhase, change };
      }
    }
  }
  return undefined;
}

/**
 * Map the manifest's phases/changes to the `BoundaryBatchState` that
 * `detectPrGroupBoundaries` consumes. Shared by `pickNextStep` (stacked-tail
 * selection) and `runStackedPr` (stacked-base resolution) so the boundary
 * ordering is derived exactly one way from exactly one input shape.
 */
export function boundaryStateFromPhases(
  batch: string,
  manifestPhases: Phase[]
): BoundaryBatchState {
  return {
    name: batch,
    phases: manifestPhases.map((phase) => ({
      name: phase.name,
      changes: phase.changes.map((change) => change.name),
    })),
  };
}

/**
 * Pick the next runnable step for `batch apply`: the first ungated phase's first
 * change whose derived status is `ready`, `in-progress`, or `awaiting-verify`.
 *
 * Boundary proof-of-work: before returning a runnable change in phase `Q`, the
 * immediately-preceding phase `P` (which is `done` — that is *why* `Q` is
 * ungated) has its proof-of-work run once. If `P` exists and is not yet in
 * `recordedProofPhases`, a `proof-of-work` target for `P` is returned *before*
 * `Q`'s change; once `P`'s proof is recorded, the next call skips straight to
 * `Q`'s change. The first phase has no predecessor, so it yields no proof step.
 *
 * When no ungated change is runnable, surface a reachable, ungated EMPTY phase as
 * a decomposition step (from `computeBatchStatus.next`, which sets `decompose`
 * only once no change-level next exists — so a still-gated empty phase is never
 * picked). Exported so the selection seam is testable directly (the real seam
 * `batch apply` runs over `computeBatchStatus`).
 */
export function pickNextStep(
  status: BatchStatusInfo,
  manifestPhases: Phase[],
  recordedProofPhases: ReadonlySet<string> = new Set(),
  prContext?: PickPrContext
): ApplyTarget | undefined {
  // The selection order is load-bearing: change/boundary-proof → decompose →
  // terminal proof → whole-batch PR tail → stacked PR tail. Each selector returns
  // its target or `undefined`, and the first non-undefined wins (short-circuit
  // `??`), byte-identical to the previous single sequential body.
  return (
    selectChangeOrBoundaryProof(status, manifestPhases, recordedProofPhases) ??
    selectDecomposeStep(status, manifestPhases, recordedProofPhases) ??
    selectTerminalProofStep(status, manifestPhases) ??
    selectWholeBatchPrStep(status, manifestPhases, prContext) ??
    selectStackedPrStep(status, manifestPhases, prContext)
  );
}

/** The PR-gating inputs `pickNextStep` accepts; re-exported for callers. */
export type { PickPrContext };

/**
 * The immediately-preceding phase's one-time boundary proof-of-work, or
 * `undefined` when there is no such pending proof. Shared by the change and
 * decompose branches, which pass DIFFERENT gates via `requireDoneWithProof`:
 *
 * - `false` (change branch): returns the predecessor whenever it exists and its
 *   proof has not been recorded yet. The predecessor is `done` (else this phase
 *   would be gated), so the boundary is real without re-checking status/proof.
 * - `true` (decompose branch): additionally requires the predecessor to be
 *   `done` AND to have a configured `proofOfWork` before it is returned.
 *
 * In both cases `predStatus` is the `status.phases` entry immediately before the
 * target phase (`undefined` when the target is first), and a missing manifest
 * predecessor or an already-recorded proof yields `undefined`.
 */
function pendingBoundaryProof(
  predStatus: BatchStatusInfo['phases'][number] | undefined,
  manifestPhases: Phase[],
  recordedProofPhases: ReadonlySet<string>,
  requireDoneWithProof: boolean
): Phase | undefined {
  if (!predStatus) return undefined;
  const predecessor = manifestPhases.find((p) => p.name === predStatus.name);
  if (!predecessor) return undefined;
  if (recordedProofPhases.has(predecessor.name)) return undefined;
  if (requireDoneWithProof && !(predStatus.status === 'done' && predecessor.proofOfWork)) {
    return undefined;
  }
  return predecessor;
}

/**
 * First branch: the first ungated phase's first runnable change (`ready` /
 * `in-progress` / `awaiting-verify`), preceded by its immediately-preceding
 * phase's one-time boundary proof-of-work. The runnable-change walk is shared
 * with `computeBatchStatus` via `firstRunnableChange`; this branch layers the
 * boundary-proof interposition on the picked phase.
 */
function selectChangeOrBoundaryProof(
  status: BatchStatusInfo,
  manifestPhases: Phase[],
  recordedProofPhases: ReadonlySet<string>
): ApplyTarget | undefined {
  const hit = firstRunnableChange(status.phases, manifestPhases);
  if (!hit) return undefined;
  // Boundary: run the immediately-preceding phase's proof-of-work once before
  // entering this phase's outstanding work.
  const predecessor = pendingBoundaryProof(
    hit.phaseIndex > 0 ? status.phases[hit.phaseIndex - 1] : undefined,
    manifestPhases,
    recordedProofPhases,
    false
  );
  if (predecessor) {
    return { kind: 'proof-of-work', phase: predecessor };
  }
  // The derived status already carries the per-change definition of done, which
  // the engine surfaces to the agent — no manifest re-lookup.
  return {
    kind: 'change',
    phase: hit.manifestPhase,
    change: hit.change.name,
    changeDone: hit.change.done,
  };
}

/**
 * Second branch: a reachable, ungated phase with empty `changes` is the
 * outstanding decomposition step (`computeBatchStatus` already ordered
 * change-before-decompose and gated-after-ungated, so `next.decompose` is set
 * only when this is genuinely next), preceded by its predecessor's boundary proof.
 */
function selectDecomposeStep(
  status: BatchStatusInfo,
  manifestPhases: Phase[],
  recordedProofPhases: ReadonlySet<string>
): ApplyTarget | undefined {
  if (!(status.next?.decompose && status.next.phase)) return undefined;
  const phase = manifestPhases.find((p) => p.name === status.next!.phase);
  if (!phase) return undefined;
  // Boundary before decomposition (S4): the phase about to be decomposed is
  // entered off its predecessor's shipped slice, so the predecessor's boundary
  // proof must run FIRST — exactly as it does before a change step. If the
  // immediately-preceding phase is done, has a configured proof-of-work, and has
  // not been recorded yet, run that proof before the decompose step (the next
  // apply, with the proof recorded, decomposes).
  const phaseIndex = status.phases.findIndex((p) => p.name === phase.name);
  const predecessor = pendingBoundaryProof(
    phaseIndex > 0 ? status.phases[phaseIndex - 1] : undefined,
    manifestPhases,
    recordedProofPhases,
    true
  );
  if (predecessor) {
    return { kind: 'proof-of-work', phase: predecessor };
  }
  return { kind: 'decompose', phase };
}

/**
 * Third branch: the terminal-phase boundary proof (C2). Once every change is done
 * and nothing is left to decompose, `computeBatchStatus` surfaces the LAST phase's
 * unrun proof as `next.proof`. The last phase has no successor, so its boundary
 * proof is never triggered by entering a later phase; selecting it here is what
 * runs and records it, and the batch is not `done` until that record is satisfied.
 */
function selectTerminalProofStep(
  status: BatchStatusInfo,
  manifestPhases: Phase[]
): ApplyTarget | undefined {
  if (!(status.next?.proof && status.next.phase)) return undefined;
  const phase = manifestPhases.find((p) => p.name === status.next!.phase);
  if (phase) return { kind: 'proof-of-work', phase };
  return undefined;
}

/**
 * Fourth branch: the whole-batch completion PR. Reached only after every branch
 * above has declined, so it fires at genuine batch completion — `status.status
 * === 'done'` means every change is done AND the terminal boundary proof is
 * recorded and passed (the PR opens strictly AFTER the terminal proof). Gated in
 * the CLI so `off`/unset and an already-opened PR surface NO target: returns
 * `undefined` and the existing terminal "Nothing to do — all changes are done."
 * output is byte-identical. The gating inputs are passed in as data; this selector
 * reads neither config nor the journal. The terminal phase frames the PR agent's
 * instructions.
 */
function selectWholeBatchPrStep(
  status: BatchStatusInfo,
  manifestPhases: Phase[],
  prContext?: PickPrContext
): ApplyTarget | undefined {
  if (
    status.status === 'done' &&
    prContext?.grouping === 'whole-batch' &&
    !prContext.alreadyOpened
  ) {
    const terminalPhase = manifestPhases[manifestPhases.length - 1];
    if (terminalPhase) return { kind: 'pr', phase: terminalPhase };
  }
  return undefined;
}

/**
 * Fifth branch: the stacked PR tail. Reached only at genuine batch completion
 * under a STACKED grouping mode (`per-phase`/`per-change`) — a separate,
 * mode-guarded branch, so the `off`/unset terminal and the whole-batch tail stay
 * byte-identical. Derive the ordered group boundaries from the manifest (the
 * single home of "where the groups are") and surface a `pr` target for the FIRST
 * boundary whose per-group PR key is not yet recorded; each subsequent apply opens
 * the next group, so a resumed loop opens every group exactly once, in boundary
 * order. The gating inputs (mode + recorded keys) arrive as data — this selector
 * still reads neither config nor the journal.
 */
function selectStackedPrStep(
  status: BatchStatusInfo,
  manifestPhases: Phase[],
  prContext?: PickPrContext
): ApplyTarget | undefined {
  if (
    status.status === 'done' &&
    (prContext?.grouping === 'per-phase' || prContext?.grouping === 'per-change')
  ) {
    const boundaries = detectPrGroupBoundaries(
      boundaryStateFromPhases(status.name, manifestPhases),
      prContext.grouping
    );
    const opened = prContext.openedGroupKeys ?? new Set<string>();
    for (const boundary of boundaries) {
      if (opened.has(prJournalKey(status.name, boundary))) continue;
      // The group's own phase frames the PR agent's instructions: the phase the
      // boundary's trigger change belongs to (for a `phase` group, the phase
      // itself; for a `change` group, the phase containing that change).
      const phase =
        manifestPhases.find((p) =>
          p.changes.some((c) => c.name === boundary.triggerChange)
        ) ?? manifestPhases[manifestPhases.length - 1];
      if (phase) return { kind: 'pr', phase, boundary };
    }
  }
  return undefined;
}
