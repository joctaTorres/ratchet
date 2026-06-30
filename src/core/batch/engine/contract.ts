/**
 * Batch engine types.
 *
 * The engine is bundled into the CLI: `batch apply` builds a resolved step
 * context and calls the engine in-process for exactly one transition, and the
 * engine returns a structured result the CLI persists. These types are the
 * shared shape of that hand-off. `status`/`view`/`config` never touch the engine.
 */

import type { BatchSettings } from '../config.js';
import type { ProofOfWork } from '../manifest.js';
import type { JournalEntry } from '../journal.js';

export type Transition = 'propose' | 'apply' | 'verify';

/**
 * What the engine ran for one step: a per-change transition, or a phase
 * decomposition. `decompose` is NOT a per-change transition — it is never derived
 * by `computeNextTransition` and never keys a change's done-rule. It exists only
 * so a decomposition step's {@link StepResult} can name its kind for rendering,
 * alongside the per-change transitions, without inventing a fourth transition.
 */
export type StepKind = Transition | 'decompose';

/** Phase framing surfaced in the agent instructions for one step. */
export interface StepPhase {
  name: string;
  goal: string;
  success: string;
  proofOfWork: ProofOfWork;
}

/** Resume context carried when a step was parked. */
export interface StepResume {
  kind: 'blocked' | 'awaiting-approval';
  reason: string;
  answer?: string;
  feedback?: string;
}

/**
 * Fields shared verbatim by both step contexts — the resolved batch step and the
 * forced single-change step. `batch` is intentionally NOT here: it is required on
 * `ResolvedStepContext` but only an optional run-state locus on
 * `ChangeStepContext`, so each declares it with its own cardinality.
 */
interface BaseStepContext {
  change: string;
  /** The picked change intent's own definition of done (required). */
  changeDone: string;
  transition: Transition;
  phase: StepPhase;
  settings: BatchSettings;
  /** Prior journal entries for this change (resume context). */
  journal: JournalEntry[];
  /** Resume context when the step was parked. */
  resume?: StepResume;
}

/** Everything the engine needs to drive one transition, resolved by the CLI. */
export interface ResolvedStepContext extends BaseStepContext {
  batch: string;
}

/**
 * The change-scoped subset the engine core needs to drive ONE forced transition
 * on a single change — no batch derivation, no transition re-computation.
 *
 * It is what `runChangeStep` consumes: the same fields a batch step resolves
 * (`change`, `changeDone`, `phase`, `settings`, `journal`, optional `resume`)
 * but with a **forced** `transition` the core spawns the agent for verbatim
 * instead of deriving it from disk. `batch` is the run-state locus only and is
 * now OPTIONAL: when set, the journal/run files live under
 * `.ratchet/batches/<batch>/run/` (the batch apply path); when absent, they live
 * change-locally under `.ratchet/changes/<change>/.run/` (the standalone path a
 * headless verb drives with no manifest present).
 */
export interface ChangeStepContext extends BaseStepContext {
  /**
   * Run-state locus only. When set, the journal/run files live under
   * `.ratchet/batches/<batch>/run/`; when absent, they live change-locally under
   * `.ratchet/changes/<change>/.run/`.
   */
  batch?: string;
  /**
   * Optional free-text guidance (e.g. the headless propose verb's `-m` values)
   * injected as a trailing ARGUMENT of the `/rct:<transition> <change>` skill
   * invocation, so the agent hands it to the skill as `$ARGUMENTS` rather than
   * reading it from a detached block (`delegated-lifecycle`). Left undefined by
   * `batch apply`, so the invocation stays the bare, byte-identical call.
   */
  guidance?: string;
}

/**
 * A change intent shipped by a prior phase, surfaced to the decomposition agent
 * as the basis for authoring a later phase's concrete intents. Carries only what
 * the agent needs to ground the decomposition — the change's name and its
 * definition of done — never engine internals.
 */
export interface ShippedChange {
  name: string;
  done: string;
}

/** A prior phase's shipped results: its name and the change intents it shipped. */
export interface PriorPhaseResult {
  phase: string;
  changes: ShippedChange[];
}

/**
 * The phase-scoped subset the engine needs to drive ONE decomposition spawn for a
 * reachable, ungated phase whose `changes` list is still empty. Unlike a change
 * step it carries NO `change` and NO `transition`: the spawned agent delegates to
 * the canonical decomposition skill (`DECOMPOSE_COMMAND_ID`) to AUTHOR the phase's
 * concrete change intents into `batch.yaml` from `priorResults`. The engine never
 * derives a per-change transition for it and never authors the intents itself.
 */
export interface DecompositionStepContext {
  batch: string;
  /** The reachable empty phase to decompose (its goal/success/proof framing). */
  phase: StepPhase;
  /** Prior phases' shipped results — the basis for authoring this phase's intents. */
  priorResults: PriorPhaseResult[];
  settings: BatchSettings;
  /**
   * Resume context when the decomposition step was parked (W1). Mirrors a change
   * step's `resume`: when the user answered a blocker (or rejected with feedback),
   * the resolved text rides along as a trailing argument of the decompose-phase
   * invocation so a resumed decomposition does not silently drop the answer.
   */
  resume?: StepResume;
}

export type StepState =
  | 'advanced'
  | 'blocked'
  | 'awaiting-approval'
  | 'phase-gated'
  | 'nothing-ready';

/**
 * The structured result the engine returns after one step — a per-change
 * transition or a phase decomposition. `change` carries the decomposed phase's
 * name on a decomposition result (there is no change), and `transition` is
 * `decompose` there, so `renderResult` shows the outcome like any other step.
 */
export interface StepResult {
  state: StepState;
  change: string;
  transition: StepKind;
  /** Present when state is `blocked`: the question requiring an answer. */
  blocker?: string;
  /** Present when state is `awaiting-approval`: the proposal summary. */
  approvalRequest?: string;
  /** Pointer to journal entries this step produced (indices or ids). */
  journalRefs?: number[];
  message?: string;
}
