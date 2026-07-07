/**
 * `ratchet batch apply [name]`
 *
 * Single step: pick the next ready DAG step, hand it to the bundled engine for
 * exactly one transition (propose -> apply -> verify), persist the result,
 * render a rich view, and return. No internal loop. The engine ships inside this
 * package, so apply runs it in-process with no separate install or activation.
 */

import chalk from 'chalk';
import { execFileSync } from 'child_process';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { loadBatchManifest, type Phase } from '../../core/batch/manifest.js';
import { computeBatchStatus } from '../../core/batch/status.js';
import { resolveBatchSettings, type PrGrouping } from '../../core/batch/config.js';
import {
  RatchetBatchEngine,
  computeNextTransition,
  decompositionJournalKey,
  prJournalKey,
  hasJournaledPr,
  readJournalTolerant,
  runProofOfWork,
  type ResolvedStepContext,
  type DecompositionStepContext,
  type PrStepContext,
  type PriorPhaseResult,
  type StepResult,
  type ProofOfWorkResult,
  type RunProofOfWorkDeps,
} from '../../core/batch/engine/index.js';
import type { BatchStatusInfo } from '../../core/batch/status.js';
// The two pure stacked-grouping policies are imported from their own modules —
// not the engine index — so they stay the single home of boundary/stacking rules
// even where tests mock the engine entry points.
import {
  detectPrGroupBoundaries,
  type BoundaryBatchState,
  type PrGroupBoundary,
} from '../../core/batch/engine/boundary.js';
import { selectStackedBases } from '../../core/batch/engine/stacked-base.js';
import {
  getParkedStep,
  readJournalForChange,
  parkStep,
  clearParkedStep,
  recordProofOfWork,
  readProofOfWorkByPhase,
  type ParkedStep,
  type ProofOfWorkRecord,
} from '../../core/batch/journal.js';
import { resolveBatchName } from './shared.js';

export interface BatchApplyOptions {
  json?: boolean;
}

/** The git branch names the completion PR step opens between, resolved by the CLI. */
export interface ResolvedBranches {
  /** The work branch the PR opens from (the current branch). */
  workBranch: string;
  /** The base branch the PR targets (the repo's default branch). */
  baseBranch: string;
}

/**
 * Test/embedding seam. Production callers pass nothing: the project root is
 * resolved from the planning home, the boundary proof-of-work runs via the real
 * bash runner, and the PR step's work/base branch are resolved from git. Tests
 * override `projectRoot`, may inject proof `deps`, and may inject `branches` so
 * the PR step gets fake branch names without a real git repo.
 */
export interface BatchApplyDeps {
  projectRoot?: string;
  proof?: RunProofOfWorkDeps;
  branches?: (projectRoot: string) => ResolvedBranches;
  /**
   * Names a stacked PR group's own branch from its stable identity — the
   * `branchForGroup` resolver `selectStackedBases` consumes. Defaults to the
   * group id itself (phase or change name, already kebab-case). Only git branch
   * NAMING lives here; no forge CLI is invoked.
   */
  groupBranch?: (boundary: PrGroupBoundary, index: number) => string;
}

/**
 * If a parked step is unresolved, emit the "did not advance" notice and return
 * true (the step must not advance). Lets the engine own transition derivation;
 * the CLI only blocks on un-actioned halts before building context.
 */
function precheckPark(
  parked: ParkedStep | undefined,
  change: string,
  options: BatchApplyOptions
): boolean {
  if (parked && parked.kind === 'blocked' && !parked.answer) {
    notAdvanced(
      change,
      `blocked: ${parked.reason}`,
      options,
      'record an answer with `ratchet batch report --change ' + change + ' --answer "..."`'
    );
    return true;
  }
  if (parked && parked.kind === 'awaiting-approval' && !parked.approved && !parked.feedback) {
    notAdvanced(
      change,
      `awaiting approval: ${parked.reason}`,
      options,
      'approve or reject from the batch view'
    );
    return true;
  }
  return false;
}

/** Persist parked / cleared state based on the engine's structured result. */
function persistStepOutcome(
  projectRoot: string,
  batch: string,
  change: string,
  result: StepResult
): void {
  if (result.state === 'blocked') {
    parkStep(projectRoot, batch, {
      change,
      kind: 'blocked',
      reason: result.blocker ?? 'blocked',
    });
  } else if (result.state === 'awaiting-approval') {
    parkStep(projectRoot, batch, {
      change,
      kind: 'awaiting-approval',
      reason: result.approvalRequest ?? 'awaiting approval',
    });
  } else if (result.state === 'advanced') {
    clearParkedStep(projectRoot, batch, change);
  }
}

export async function batchApplyCommand(
  name: string | undefined,
  options: BatchApplyOptions = {},
  deps: BatchApplyDeps = {}
): Promise<void> {
  const projectRoot = deps.projectRoot ?? resolveCurrentPlanningHomeSync().root;
  const batch = resolveBatchName(projectRoot, name);
  const manifest = loadBatchManifest(projectRoot, batch);
  const { settings, agentStageScopes } = resolveBatchSettings(projectRoot, manifest);
  const status = await computeBatchStatus(projectRoot, manifest);

  // The engine is bundled into this package; construct it and run in-process.
  const engine = new RatchetBatchEngine();

  // The latest recorded proof per phase. Its keys are the phases whose boundary
  // proof-of-work has already run (so the boundary runs at most once and the next
  // apply skips past it); the records themselves let the no-step branch cite a
  // failing proof that is holding a later phase shut.
  const proofByPhase = readProofOfWorkByPhase(projectRoot, batch);
  const recordedProofPhases = new Set(proofByPhase.keys());

  // Resolve the PR steps' gating inputs ONCE, at the single command seam that
  // already performs config/journal reads, and hand them to the pure
  // `pickNextStep` selector as data (see `buildPrContext`).
  const prContext = buildPrContext(readJournalTolerant(projectRoot, batch), settings.prGrouping);

  // Find the next ready, ungated step.
  const target = pickNextStep(status, manifest.phases, recordedProofPhases, prContext);
  if (!target) {
    renderNoTarget(status, manifest.phases, proofByPhase, options);
    return;
  }

  const ctx: ApplyDispatchContext = {
    projectRoot,
    batch,
    engine,
    manifestPhases: manifest.phases,
    settings,
    agentStageScopes,
    options,
    deps,
  };

  // The non-change kinds (decompose / boundary or terminal proof / PR) each route
  // to their own engine entry point; a `change` target drives `engine.runStep`.
  if (target.kind !== 'change') {
    await dispatchNonChangeTarget(target, ctx, status);
    return;
  }

  await runChangeTarget(target, ctx);
}

/**
 * The shared inputs the per-step-kind dispatch helpers consume — assembled once
 * in `batchApplyCommand` and threaded through so each handler routes its target
 * to the right engine entry point without re-resolving config/journal state.
 */
interface ApplyDispatchContext {
  projectRoot: string;
  batch: string;
  engine: RatchetBatchEngine;
  manifestPhases: Phase[];
  settings: ResolvedStepContext['settings'];
  agentStageScopes: ResolvedStepContext['agentStageScopes'];
  options: BatchApplyOptions;
  deps: BatchApplyDeps;
}

/**
 * Assemble the PR steps' gating inputs for the pure `pickNextStep` selector
 * (`instruction-fed-config`): the resolved `prGrouping` mode, whether a
 * whole-batch PR-open completion is already journaled (the one home of that
 * done-rule, `hasJournaledPr`), and the set of per-group PR keys already recorded
 * — the `change` of every `completion` entry with `transition: 'pr'`, exactly
 * what `hasJournaledPrForGroup` matches, so the CLI gate and the engine's
 * per-group resume precondition agree by construction. The selector reads neither
 * config nor the journal itself.
 */
function buildPrContext(
  journal: ReturnType<typeof readJournalTolerant>,
  grouping: PrGrouping
): { grouping: PrGrouping; alreadyOpened: boolean; openedGroupKeys: Set<string> } {
  return {
    grouping,
    alreadyOpened: hasJournaledPr(journal),
    openedGroupKeys: new Set(
      journal
        .filter((e) => e.kind === 'completion' && e.transition === 'pr')
        .map((e) => e.change)
    ),
  };
}

/**
 * Render the no-runnable-step outcome. When nothing is runnable because a phase is
 * held shut by the prior phase's failing `hard-gate` proof, cite that proof (the
 * same gate `computeBatchStatus` derived) instead of the generic "everything is
 * gated" message. The terminal phase's failing proof gates no successor (there is
 * none), so it is cited separately: it is what holds the batch out of `done`.
 */
function renderNoTarget(
  status: BatchStatusInfo,
  manifestPhases: Phase[],
  proofByPhase: ReadonlyMap<string, ProofOfWorkRecord>,
  options: BatchApplyOptions
): void {
  const proofBlock =
    proofBlockReason(status, proofByPhase) ??
    terminalProofBlockReason(status, manifestPhases, proofByPhase);
  const text =
    status.status === 'done'
      ? chalk.green('Nothing to do — all changes are done.')
      : proofBlock
        ? chalk.red(`No ready step — blocked by ${proofBlock}`)
        : chalk.dim('No ready step. Everything is blocked, gated, or parked.');
  if (options.json) {
    console.log(JSON.stringify({ state: 'nothing-ready', message: text }, null, 2));
  } else {
    console.log(text);
  }
}

/**
 * Route a non-`change` target to its engine entry point, mirroring the previous
 * inline `if (target.kind === …)` chain exactly:
 *
 *   - `decompose`      → spawn ONE agent that authors the empty phase's concrete
 *                        change intents into batch.yaml (`runDecomposition`).
 *   - `proof-of-work`  → run that phase's configured boundary proof once and
 *                        journal the verdict (`runProofAtBoundary`).
 *   - `pr`             → resolve the branches (the CLI's job — git only, no forge
 *                        CLI) and open the PR (`runPrTarget`).
 */
async function dispatchNonChangeTarget(
  target: Exclude<ApplyTarget, { kind: 'change' }>,
  ctx: ApplyDispatchContext,
  status: BatchStatusInfo
): Promise<void> {
  switch (target.kind) {
    case 'decompose':
      await runDecomposition(
        ctx.projectRoot,
        ctx.batch,
        ctx.engine,
        status,
        target.phase,
        ctx.settings,
        ctx.agentStageScopes,
        ctx.options
      );
      return;
    case 'proof-of-work':
      await runProofAtBoundary(
        ctx.projectRoot,
        ctx.batch,
        target.phase,
        ctx.settings,
        ctx.options,
        ctx.deps.proof
      );
      return;
    case 'pr':
      await runPrTarget(target, ctx);
      return;
  }
}

/**
 * Drive a `pr` target: resolve the work/base branches (git only, no forge CLI)
 * and route by `boundary` — present → a fired stacked group boundary
 * (`per-phase`/`per-change`, `runStackedPr`), absent → the whole-batch completion
 * PR (`runPr`, unchanged).
 */
async function runPrTarget(
  target: Extract<ApplyTarget, { kind: 'pr' }>,
  ctx: ApplyDispatchContext
): Promise<void> {
  const branches = (ctx.deps.branches ?? resolveBranches)(ctx.projectRoot);
  if (target.boundary) {
    await runStackedPr(
      ctx.projectRoot,
      ctx.batch,
      ctx.engine,
      ctx.manifestPhases,
      target.phase,
      target.boundary,
      ctx.settings,
      ctx.agentStageScopes,
      branches.baseBranch,
      ctx.deps.groupBranch ?? ((boundary) => boundary.groupId),
      ctx.options
    );
  } else {
    await runPr(
      ctx.projectRoot,
      ctx.batch,
      ctx.engine,
      target.phase,
      ctx.settings,
      ctx.agentStageScopes,
      branches,
      ctx.options
    );
  }
}

/**
 * Drive a `change` target through `engine.runStep`: honor a halt on the change's
 * park, build the `ResolvedStepContext`, run the step, then persist and render the
 * outcome. The prior inline change-step body, unchanged.
 */
async function runChangeTarget(
  target: Extract<ApplyTarget, { kind: 'change' }>,
  ctx: ApplyDispatchContext
): Promise<void> {
  const { projectRoot, batch, engine, manifestPhases, settings, agentStageScopes, options } = ctx;
  const { phase, change, changeDone } = target;

  // Respect halts: a parked step does not advance until input is recorded.
  const parked = getParkedStep(projectRoot, batch, change);
  if (precheckPark(parked, change, options)) return;

  const context: ResolvedStepContext = {
    batch,
    change,
    changeDone,
    // Coarse hint only; the engine derives the authoritative transition from
    // richer on-disk state via the same `computeNextTransition` and overrides
    // this. `propose` is the neutral default for a not-yet-created change.
    // Deliberately journal-blind: this call passes no journal, so it only
    // coarse-sorts from on-disk change state; the engine re-derives the
    // authoritative transition WITH the journal before spawning, so a stale or
    // missing journal here cannot pick the wrong transition.
    transition: computeNextTransition(projectRoot, change) ?? 'propose',
    phase: {
      name: phase.name,
      goal: phase.goal,
      success: phase.success,
      proofOfWork: phase.proofOfWork,
    },
    settings,
    // Thread the per-stage supplying scopes so a fast failure under an explicit
    // model can attribute the stage's spec to its supplying scope (project config
    // vs batch manifest). Left undefined for the standalone paths only.
    agentStageScopes,
    journal: readJournalForChange(projectRoot, batch, change),
    resume: parked
      ? {
          kind: parked.kind,
          reason: parked.reason,
          answer: parked.answer,
          feedback: parked.feedback,
        }
      : undefined,
  };

  const result = await engine.runStep(context);

  persistStepOutcome(projectRoot, batch, change, result);

  renderResult(projectRoot, batch, manifestPhases, result, options);
}

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
 * Map the manifest's phases/changes to the `BoundaryBatchState` that
 * `detectPrGroupBoundaries` consumes. Shared by `pickNextStep` (stacked-tail
 * selection) and `runStackedPr` (stacked-base resolution) so the boundary
 * ordering is derived exactly one way from exactly one input shape.
 */
function boundaryStateFromPhases(batch: string, manifestPhases: Phase[]): BoundaryBatchState {
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
 * `batch apply` runs over `computeBatchStatus`), not only via the pure
 * `selectRunnableStep`.
 */
export function pickNextStep(
  status: Awaited<ReturnType<typeof computeBatchStatus>>,
  manifestPhases: Phase[],
  recordedProofPhases: ReadonlySet<string> = new Set(),
  prContext?: {
    grouping: PrGrouping;
    alreadyOpened: boolean;
    /**
     * The per-group PR keys already journaled (`prJournalKey(batch, boundary)`
     * of every recorded PR-open completion) — computed once by
     * `batchApplyCommand` and passed in as data. Absent behaves as the empty
     * set: no group opened yet.
     */
    openedGroupKeys?: ReadonlySet<string>;
  }
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
 * First branch: the first ungated phase's first runnable change (`ready` /
 * `in-progress` / `awaiting-verify`), preceded by its immediately-preceding
 * phase's one-time boundary proof-of-work.
 */
function selectChangeOrBoundaryProof(
  status: BatchStatusInfo,
  manifestPhases: Phase[],
  recordedProofPhases: ReadonlySet<string>
): ApplyTarget | undefined {
  for (let i = 0; i < status.phases.length; i++) {
    const phaseStatus = status.phases[i];
    if (phaseStatus.gated) continue;
    const phase = manifestPhases.find((p) => p.name === phaseStatus.name);
    if (!phase) continue;
    for (const change of phaseStatus.changes) {
      if (
        change.status === 'ready' ||
        change.status === 'in-progress' ||
        // `awaiting-verify` is selectable: its runnable next step is the verify
        // gate, which must run before the change can be done (the engine derives
        // `verify` via `computeNextTransition`). Skipping it would strand verify.
        change.status === 'awaiting-verify'
      ) {
        // Boundary: run the immediately-preceding phase's proof-of-work once
        // before entering this phase's outstanding work. The predecessor is
        // `done` (else this phase would be gated), so the boundary is real.
        const predecessor =
          i > 0
            ? manifestPhases.find((p) => p.name === status.phases[i - 1].name)
            : undefined;
        if (predecessor && !recordedProofPhases.has(predecessor.name)) {
          return { kind: 'proof-of-work', phase: predecessor };
        }
        // The derived status already carries the per-change definition of done,
        // which the engine surfaces to the agent — no manifest re-lookup.
        return { kind: 'change', phase, change: change.name, changeDone: change.done };
      }
    }
  }
  return undefined;
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
  if (phaseIndex > 0) {
    const predStatus = status.phases[phaseIndex - 1];
    const predecessor = manifestPhases.find((p) => p.name === predStatus.name);
    if (
      predecessor &&
      predStatus.status === 'done' &&
      predecessor.proofOfWork &&
      !recordedProofPhases.has(predecessor.name)
    ) {
      return { kind: 'proof-of-work', phase: predecessor };
    }
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

/**
 * If a phase is gated shut because the immediately-preceding phase's recorded
 * `hard-gate` proof-of-work failed, return that phase's `gatedBy` report (which
 * names the prior phase and cites the failing proof's detail). Returns undefined
 * when no phase is proof-blocked — e.g. a phase is gated only because its prior
 * phase still has outstanding work, which is the generic gated case.
 *
 * This reads the gate `computeBatchStatus` already derived (`phase.gated`) and
 * matches it to the recorded failing verdict; it does not re-derive the gate, so
 * the no-step message and the status gate cannot disagree.
 */
function proofBlockReason(
  status: BatchStatusInfo,
  proofByPhase: ReadonlyMap<string, ProofOfWorkRecord>
): string | undefined {
  for (let i = 1; i < status.phases.length; i++) {
    const phase = status.phases[i];
    if (!phase.gated) continue;
    const predecessor = status.phases[i - 1];
    const rec = proofByPhase.get(predecessor.name);
    if (rec && !rec.gatePassed) {
      return phase.gatedBy ?? `${predecessor.name} — proof-of-work failed: ${rec.detail}`;
    }
  }
  return undefined;
}

/**
 * If the TERMINAL phase's recorded boundary proof-of-work failed its hard-gate,
 * return a message citing it. The terminal phase has no successor to gate, so its
 * failing proof never shows up in `proofBlockReason` (which keys off a downstream
 * phase being `gated`); it is nonetheless what holds the batch out of `done` (C2),
 * so `batch apply`'s no-step output cites it rather than the generic message.
 * Reads only the recorded verdict (`proofByPhase`), never re-deriving the gate.
 */
function terminalProofBlockReason(
  status: BatchStatusInfo,
  manifestPhases: Phase[],
  proofByPhase: ReadonlyMap<string, ProofOfWorkRecord>
): string | undefined {
  if (status.status === 'done') return undefined;
  const terminalPhase = manifestPhases[manifestPhases.length - 1];
  if (!terminalPhase) return undefined;
  const rec = proofByPhase.get(terminalPhase.name);
  if (rec && !rec.gatePassed) {
    return `${terminalPhase.name} — proof-of-work failed: ${rec.detail}`;
  }
  return undefined;
}

/**
 * The prior phases' shipped results for a phase about to be decomposed: every
 * phase before it (in manifest order) with concrete change intents, each change
 * carried as its name + definition of done. This is the context the engine hands
 * the canonical decomposition skill as the basis for authoring the new phase's
 * intents (`delegated-lifecycle`: context-preserving delegation).
 */
function priorPhaseResults(status: BatchStatusInfo, phaseName: string): PriorPhaseResult[] {
  const results: PriorPhaseResult[] = [];
  for (const phaseStatus of status.phases) {
    if (phaseStatus.name === phaseName) break;
    if (phaseStatus.changes.length === 0) continue;
    results.push({
      phase: phaseStatus.name,
      changes: phaseStatus.changes.map((c) => ({ name: c.name, done: c.done })),
    });
  }
  return results;
}

/**
 * Drive ONE phase-decomposition step: honor a halt on the phase-keyed park, build
 * the decomposition context (the empty phase + the prior phases' shipped
 * results), hand it to the engine's phase-scoped entry point, then persist and
 * render the outcome through the same paths a change step uses.
 */
async function runDecomposition(
  projectRoot: string,
  batch: string,
  engine: RatchetBatchEngine,
  status: BatchStatusInfo,
  phase: Phase,
  settings: ResolvedStepContext['settings'],
  agentStageScopes: ResolvedStepContext['agentStageScopes'],
  options: BatchApplyOptions
): Promise<void> {
  // A decomposition has no change; its journal/park state is keyed by the phase.
  const key = decompositionJournalKey(phase.name);
  const parked = getParkedStep(projectRoot, batch, key);
  if (precheckPark(parked, key, options)) return;

  const context: DecompositionStepContext = {
    batch,
    phase: {
      name: phase.name,
      goal: phase.goal,
      success: phase.success,
      proofOfWork: phase.proofOfWork,
    },
    priorResults: priorPhaseResults(status, phase.name),
    settings,
    // Thread the per-stage supplying scopes so a fast-failing decompose spawn
    // under an explicit scalar model can attribute its uniform supplying scope
    // (project config vs batch manifest). The standalone paths thread no scopes.
    agentStageScopes,
    // Thread the resolved resume answer/feedback exactly as a change step does
    // (W1): a parked decomposition that the user answered must carry that answer
    // into the spawned instructions, not silently drop it on resume.
    resume: parked
      ? {
          kind: parked.kind,
          reason: parked.reason,
          answer: parked.answer,
          feedback: parked.feedback,
        }
      : undefined,
  };

  const result = await engine.runDecompositionStep(context);
  persistStepOutcome(projectRoot, batch, key, result);
  renderResult(projectRoot, batch, [], result, options);
}

/**
 * Resolve the git branch names the completion PR step opens between — branch
 * resolution is the CLI's job (`instruction-fed-config`, `generalizable-defaults`),
 * delivered to the engine as `PrStepContext` data the `/rct:pr-open` body consumes
 * as its "Input": `workBranch` from the current branch (`git rev-parse
 * --abbrev-ref HEAD`), `baseBranch` from the repo's default branch (`git
 * symbolic-ref --short refs/remotes/origin/HEAD`, stripped of its `origin/`
 * prefix), each falling back to the neutral `main` when git is unavailable or no
 * remote is configured (the same no-remote condition the doctor PR-remote warning
 * flags). Touches only git, which is universal; it invokes NO forge CLI —
 * detecting and driving `gh`/`glab`/… is the spawned agent's job.
 */
export function resolveBranches(projectRoot: string): ResolvedBranches {
  const git = (args: string[]): string | undefined => {
    try {
      return execFileSync('git', args, {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return undefined;
    }
  };
  const workBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  const remoteHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const baseBranch = remoteHead ? remoteHead.replace(/^origin\//, '') : 'main';
  return { workBranch, baseBranch };
}

/**
 * Drive ONE whole-batch PR-open step at batch completion — the structural twin of
 * `runDecomposition`: honor a halt on the batch-keyed PR park (`prJournalKey`),
 * build the `PrStepContext` (terminal phase framing, resolved settings, resume
 * answer/feedback, and the CLI-resolved work/base branch), hand it to the engine's
 * `runPrStep`, then persist and render the outcome through the SAME
 * `persistStepOutcome` / `renderResult` paths a change and decomposition step use.
 * So a blocked/failed PR step parks under the PR key and renders as a reported
 * step failure with no new failure logic, and an advanced PR step clears the park.
 * `runPr` never re-authors the commit/push/PR-open steps (they live once in the
 * `/rct:pr-open` body) and adds no journal writes beyond the shared park state.
 */
async function runPr(
  projectRoot: string,
  batch: string,
  engine: RatchetBatchEngine,
  phase: Phase,
  settings: ResolvedStepContext['settings'],
  agentStageScopes: ResolvedStepContext['agentStageScopes'],
  branches: ResolvedBranches,
  options: BatchApplyOptions
): Promise<void> {
  // A PR step has no change; its journal/park state is keyed by the batch.
  const key = prJournalKey(batch);
  const parked = getParkedStep(projectRoot, batch, key);
  if (precheckPark(parked, key, options)) return;

  const context: PrStepContext = {
    batch,
    phase: {
      name: phase.name,
      goal: phase.goal,
      success: phase.success,
      proofOfWork: phase.proofOfWork,
    },
    settings,
    // Thread the per-stage supplying scopes so a fast-failing PR spawn under an
    // explicit per-stage model can attribute the `pr` stage's supplying scope
    // (project config vs batch manifest). The standalone paths thread no scopes.
    agentStageScopes,
    baseBranch: branches.baseBranch,
    workBranch: branches.workBranch,
    // Thread the resolved resume answer/feedback exactly as a change or
    // decomposition step does (W1): a parked PR step the user answered must carry
    // that answer into the spawned instructions, not silently drop it on resume.
    resume: parked
      ? {
          kind: parked.kind,
          reason: parked.reason,
          answer: parked.answer,
          feedback: parked.feedback,
        }
      : undefined,
  };

  const result = await engine.runPrStep(context);
  persistStepOutcome(projectRoot, batch, key, result);
  renderResult(projectRoot, batch, [], result, options);
}

/**
 * Drive ONE stacked per-group PR-open step for a fired boundary — the structural
 * twin of {@link runPr}, keyed by the PER-GROUP `prJournalKey(batch, boundary)`:
 * honor a halt on that group's park, resolve the group's stacked base by composing
 * the two pure policies (`detectPrGroupBoundaries` orders the groups over the
 * shared `boundaryStateFromPhases` state; `selectStackedBases` maps group 0 to the
 * batch base branch and group N to group N-1's own branch) and selecting the fired
 * boundary's entry, build the `PrStepContext` (the boundary, the resolved stacked
 * `baseBranch`/`workBranch`, phase framing, settings, resume), hand it to the
 * engine's `runPrStep`, then persist and render through the SAME
 * `persistStepOutcome` / `renderResult` paths every step uses. So a blocked/failed
 * per-boundary PR step parks under that group's key and renders as a reported step
 * failure with no new failure logic, an advanced step clears the park, and the
 * engine — not this helper — records the per-group `completion`/`blocker` entry.
 * Branch NAMING is delivered as data (`batchBaseBranch` + the `groupBranch`
 * resolver); only git identities are involved and no forge CLI is invoked.
 */
async function runStackedPr(
  projectRoot: string,
  batch: string,
  engine: RatchetBatchEngine,
  manifestPhases: Phase[],
  phase: Phase,
  boundary: PrGroupBoundary,
  settings: ResolvedStepContext['settings'],
  agentStageScopes: ResolvedStepContext['agentStageScopes'],
  batchBaseBranch: string,
  groupBranch: (boundary: PrGroupBoundary, index: number) => string,
  options: BatchApplyOptions
): Promise<void> {
  // A stacked PR step has no change; its journal/park state is keyed by the GROUP.
  const key = prJournalKey(batch, boundary);
  const parked = getParkedStep(projectRoot, batch, key);
  if (precheckPark(parked, key, options)) return;

  // Compose the two pure policies over the same boundary state the selector used,
  // then take the fired boundary's entry: its `headBranch` is the group's own
  // branch, its `baseBranch` is group N-1's branch (or the batch base for group 0).
  const bases = selectStackedBases(
    detectPrGroupBoundaries(boundaryStateFromPhases(batch, manifestPhases), settings.prGrouping),
    batchBaseBranch,
    groupBranch
  );
  const base = bases.find(
    (b) => b.boundary.kind === boundary.kind && b.boundary.groupId === boundary.groupId
  );
  if (!base) {
    // Selection and routing derive the boundaries from the same in-memory
    // manifest, so a missing entry is an internal inconsistency, not a user state.
    throw new Error(
      `No stacked base resolved for PR group '${boundary.groupId}' (${boundary.kind}).`
    );
  }

  const context: PrStepContext = {
    batch,
    phase: {
      name: phase.name,
      goal: phase.goal,
      success: phase.success,
      proofOfWork: phase.proofOfWork,
    },
    settings,
    // Thread the per-stage supplying scopes so a fast-failing stacked PR spawn
    // under an explicit per-stage model can attribute the `pr` stage's supplying
    // scope (project config vs batch manifest). The standalone paths thread no
    // scopes.
    agentStageScopes,
    baseBranch: base.baseBranch,
    workBranch: base.headBranch,
    boundary,
    // Thread the resolved resume answer/feedback exactly as every other step does
    // (W1): a parked group the user answered must carry that answer into the
    // spawned instructions, not silently drop it on resume.
    resume: parked
      ? {
          kind: parked.kind,
          reason: parked.reason,
          answer: parked.answer,
          feedback: parked.feedback,
        }
      : undefined,
  };

  const result = await engine.runPrStep(context);
  persistStepOutcome(projectRoot, batch, key, result);
  renderResult(projectRoot, batch, [], result, options);
}

/**
 * Run ONE phase's proof-of-work at the boundary and journal the verdict. The
 * executed command is the phase's *configured* `proofOfWork.run`, run in the
 * project root (`generalizable-defaults`: no ratchet-shipped command, package
 * manager, or test runner) with the resolved policy and the phase's success
 * criteria. The engine's runtime `ProofOfWorkResult` is mapped to the durable
 * `ProofOfWorkRecord` and persisted so the verdict survives across the stateless
 * single-step apply invocations. Recording — not gating — is this slice's job:
 * `pickNextStep` already skips a phase whose proof is recorded, so this runs at
 * most once per boundary.
 */
async function runProofAtBoundary(
  projectRoot: string,
  batch: string,
  phase: Phase,
  settings: ResolvedStepContext['settings'],
  options: BatchApplyOptions,
  proofDeps?: RunProofOfWorkDeps
): Promise<void> {
  const result = await runProofOfWork(
    phase.proofOfWork,
    settings.proofOfWork,
    projectRoot,
    phase.success,
    proofDeps
  );
  const record: ProofOfWorkRecord = {
    phase: phase.name,
    passed: result.passed,
    gatePassed: result.gatePassed,
    policy: result.policy,
    reason: result.reason,
    detail: result.detail,
  };
  recordProofOfWork(projectRoot, batch, phase.name, record);
  renderProofOutcome(phase.name, result, options);
}

/** Render a boundary proof-of-work verdict (JSON or a single rich line). */
function renderProofOutcome(
  phase: string,
  result: ProofOfWorkResult,
  options: BatchApplyOptions
): void {
  if (options.json) {
    console.log(JSON.stringify({ state: 'proof-of-work', phase, ...result }, null, 2));
    return;
  }
  const head = chalk.bold(`\nProof-of-work: ${phase} (${result.policy})`);
  console.log(head);
  if (result.passed) {
    console.log(chalk.green(`✓ passed — ${result.detail}`));
  } else if (result.gatePassed) {
    // `warn` policy: surface the failure but do not present it as a hard stop.
    console.log(chalk.yellow(`⚠ failed (warn) — ${result.detail}`));
  } else {
    console.log(chalk.red(`✗ failed — ${result.detail}`));
  }
}

function notAdvanced(
  change: string,
  reason: string,
  options: BatchApplyOptions,
  hint: string
): void {
  if (options.json) {
    console.log(
      JSON.stringify({ state: 'parked', change, reason, hint }, null, 2)
    );
    return;
  }
  console.log(chalk.yellow(`Step '${change}' did not advance (${reason}).`));
  console.log(chalk.dim(`To proceed: ${hint}`));
}

async function renderResult(
  _projectRoot: string,
  _batch: string,
  _phases: Phase[],
  result: StepResult,
  options: BatchApplyOptions
): Promise<void> {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold(`\nRan: ${result.change} (${result.transition})`));
  switch (result.state) {
    case 'advanced':
      console.log(chalk.green(`✓ advanced — ${result.message ?? 'step complete'}`));
      break;
    case 'blocked':
      console.log(chalk.yellow(`⚠ blocked — ${result.blocker ?? 'needs input'}`));
      break;
    case 'awaiting-approval':
      console.log(chalk.cyan(`⏸ awaiting approval — ${result.approvalRequest ?? ''}`));
      break;
    default:
      console.log(chalk.dim(result.message ?? result.state));
  }
}
