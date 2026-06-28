/**
 * `ratchet batch apply [name]`
 *
 * Single step: pick the next ready DAG step, hand it to the bundled engine for
 * exactly one transition (propose -> apply -> verify), persist the result,
 * render a rich view, and return. No internal loop. The engine ships inside this
 * package, so apply runs it in-process with no separate install or activation.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { loadBatchManifest, type Phase } from '../../core/batch/manifest.js';
import { computeBatchStatus } from '../../core/batch/status.js';
import { resolveBatchSettings } from '../../core/batch/config.js';
import {
  RatchetBatchEngine,
  computeNextTransition,
  decompositionJournalKey,
  runProofOfWork,
  type ResolvedStepContext,
  type DecompositionStepContext,
  type PriorPhaseResult,
  type StepResult,
  type ProofOfWorkResult,
  type RunProofOfWorkDeps,
} from '../../core/batch/engine/index.js';
import type { BatchStatusInfo } from '../../core/batch/status.js';
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

/**
 * Test/embedding seam. Production callers pass nothing: the project root is
 * resolved from the planning home and the boundary proof-of-work runs via the
 * real bash runner. Tests override `projectRoot` and may inject proof `deps`.
 */
export interface BatchApplyDeps {
  projectRoot?: string;
  proof?: RunProofOfWorkDeps;
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
  const { settings } = resolveBatchSettings(projectRoot, manifest);
  const status = await computeBatchStatus(projectRoot, manifest);

  // The engine is bundled into this package; construct it and run in-process.
  const engine = new RatchetBatchEngine();

  // The latest recorded proof per phase. Its keys are the phases whose boundary
  // proof-of-work has already run (so the boundary runs at most once and the next
  // apply skips past it); the records themselves let the no-step branch cite a
  // failing proof that is holding a later phase shut.
  const proofByPhase = readProofOfWorkByPhase(projectRoot, batch);
  const recordedProofPhases = new Set(proofByPhase.keys());

  // Find the next ready, ungated step.
  const target = pickNextStep(status, manifest.phases, recordedProofPhases);
  if (!target) {
    // When nothing is runnable because a phase is held shut by the prior phase's
    // failing `hard-gate` proof, cite that proof (the same gate `computeBatchStatus`
    // derived) instead of the generic "everything is gated" message.
    const proofBlock = proofBlockReason(status, proofByPhase);
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
    return;
  }

  // A reachable, ungated phase whose `changes` are still empty is a decomposition
  // step: spawn ONE agent (delegating to the canonical decomposition skill) to
  // author that phase's concrete change intents into batch.yaml, then return. The
  // next apply selects the new changes as ordinary propose/apply/verify steps.
  if (target.kind === 'decompose') {
    await runDecomposition(projectRoot, batch, engine, status, target.phase, settings, options);
    return;
  }

  // A `proof-of-work` target is the prior phase's boundary check: run that
  // phase's configured proof-of-work once, journal the verdict, and return. The
  // next apply consults the recorded verdict: a passing proof advances into the
  // phase with work, while a failing `hard-gate` proof keeps that phase blocked
  // (the gate `computeBatchStatus` derives from the record).
  if (target.kind === 'proof-of-work') {
    await runProofAtBoundary(projectRoot, batch, target.phase, settings, options, deps.proof);
    return;
  }

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
    transition: computeNextTransition(projectRoot, change) ?? 'propose',
    phase: {
      name: phase.name,
      goal: phase.goal,
      success: phase.success,
      proofOfWork: phase.proofOfWork,
    },
    settings,
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

  renderResult(projectRoot, batch, manifest.phases, result, options);
}

/**
 * The next runnable step `batch apply` acts on: either a concrete CHANGE step
 * (drives `engine.runStep`) or a phase DECOMPOSE step (drives
 * `engine.runDecompositionStep`). The two are distinguished by `kind` so
 * `batchApplyCommand` routes each to the right engine entry point.
 */
export type ApplyTarget =
  | { kind: 'change'; phase: Phase; change: string; changeDone: string }
  | { kind: 'decompose'; phase: Phase }
  | { kind: 'proof-of-work'; phase: Phase };

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
  recordedProofPhases: ReadonlySet<string> = new Set()
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

  // No runnable change anywhere. A reachable, ungated phase with empty `changes`
  // is the outstanding decomposition step (`computeBatchStatus` already ordered
  // change-before-decompose and gated-after-ungated, so `next.decompose` is set
  // only when this is genuinely next).
  if (status.next?.decompose && status.next.phase) {
    const phase = manifestPhases.find((p) => p.name === status.next!.phase);
    if (phase) return { kind: 'decompose', phase };
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
  };

  const result = await engine.runDecompositionStep(context);
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
