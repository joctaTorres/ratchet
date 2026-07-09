/**
 * Batch engine types.
 *
 * The engine is bundled into the CLI: `batch apply` builds a resolved step
 * context and calls the engine in-process for exactly one transition, and the
 * engine returns a structured result the CLI persists. These types are the
 * shared shape of that hand-off. `status`/`view`/`config` never touch the engine.
 */

import type { BatchSettings, SettingSource } from '../config.js';
import type { AgentStage } from '../agent-setting.js';
import type { ProofOfWork } from '../manifest.js';
import type { JournalEntry } from '../journal.js';
import type { PrGroupBoundary } from './boundary.js';

export type Transition = 'propose' | 'apply' | 'verify';

/**
 * What the engine ran for one step: a per-change transition, a phase
 * decomposition, or the whole-batch PR-open step. `decompose` and `pr` are NOT
 * per-change transitions — neither is ever derived by `computeNextTransition` and
 * neither keys a change's done-rule. They exist only so a decomposition or PR
 * step's {@link StepResult} and journal entry can name their kind for rendering,
 * alongside the per-change transitions, without inventing per-change transitions.
 * `pr` doubles as the run-state done-key for the PR-open step (see
 * `hasJournaledPr`): the completion PR step is done iff the batch journal carries a
 * `completion` entry whose `transition` is `pr`.
 */
export type StepKind = Transition | 'decompose' | 'pr';

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
  /**
   * Per-stage supplying scope for the resolved `agent` setting, threaded from
   * {@link resolveBatchSettings}. When present for the running transition's
   * stage, the engine builds a model-failure attribution naming that scope so a
   * fast failure under an explicit model can surface which scope supplied it
   * (the project config vs the batch manifest). Left undefined by the standalone
   * headless verbs (their `--agent` flag can override the spec after scope
   * resolution, so a threaded scope could lie; with no scope present the
   * mapper's gate keeps today's failure surface).
   */
  agentStageScopes?: Partial<Record<AgentStage, SettingSource>>;
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
   * Per-stage supplying scope for the resolved `agent` setting, threaded from
   * {@link resolveBatchSettings} (via `batchApplyCommand`). The decomposition
   * spawn routes via the `decompose` stage (exactly as a change step routes its
   * transition and the PR step routes `pr`), so its supplying scope is the
   * `decompose` entry here. When present and the parsed spec names a model, the
   * engine builds a model-failure attribution naming that scope so a
   * fast-failing decompose spawn under an explicit model surfaces the same
   * attributed hint a change step gets. Left undefined by the standalone paths
   * (no scope present → the mapper's gate keeps today's failure surface).
   */
  agentStageScopes?: Partial<Record<AgentStage, SettingSource>>;
  /**
   * Resume context when the decomposition step was parked (W1). Mirrors a change
   * step's `resume`: when the user answered a blocker (or rejected with feedback),
   * the resolved text rides along as a trailing argument of the decompose-phase
   * invocation so a resumed decomposition does not silently drop the answer.
   */
  resume?: StepResume;
}

/**
 * The batch-scoped subset the engine needs to drive ONE whole-batch PR-open step
 * for a completed batch. Like a decomposition step it carries NO `change` and NO
 * `transition`: the spawned PR agent delegates to the canonical `/rct:open-pr`
 * command to commit the prior stage agents' accumulated work in the repo's
 * git-log style and open EXACTLY ONE pull request from the work branch to its base
 * branch. The engine never re-authors those commit/push/PR-open steps itself.
 *
 * `baseBranch`/`workBranch` are RESOLVED UPSTREAM (the CLI's job when it assembles
 * this context) and delivered here as DATA the `open-pr` body consumes as its
 * "Input" — mirroring how `DecompositionStepContext.priorResults` hands the
 * decomposition skill its grounding context rather than having the engine read it
 * (`instruction-fed-config`). The engine method stays pure and unit-testable over
 * these resolved names and never itself derives which git branch is base/work.
 */
export interface PrStepContext {
  batch: string;
  /** The terminal phase framing surfaced in the PR agent's instructions. */
  phase: StepPhase;
  settings: BatchSettings;
  /**
   * Per-stage supplying scope for the resolved `agent` setting, threaded from
   * {@link resolveBatchSettings} (via `batchApplyCommand`). The PR spawn routes
   * via the `pr` STAGE of the agent map (exactly as a change step routes
   * propose/apply/verify), so its supplying scope is `agentStageScopes.pr`.
   * When present and the parsed spec names a model, the engine builds a
   * model-failure attribution naming that scope so a fast-failing PR spawn
   * under an explicit per-stage model surfaces the same attributed hint a
   * change step gets. Left undefined by the standalone paths (no scope present
   * → the mapper's gate keeps today's failure surface).
   */
  agentStageScopes?: Partial<Record<AgentStage, SettingSource>>;
  /** Resume context when the PR step was parked. */
  resume?: StepResume;
  /** The base branch the PR targets — resolved upstream, delivered as data. */
  baseBranch: string;
  /** The work branch the PR opens from — resolved upstream, delivered as data. */
  workBranch: string;
  /**
   * The fired group boundary this PR step opens, under a stacked grouping mode
   * (`per-phase`/`per-change`). Its `groupId` keys the per-group run-state entry
   * ({@link prJournalKey}) so a resumed loop opens each group exactly once and
   * distinct groups are guarded independently. Absent (or `kind: 'batch'`) for a
   * whole-batch PR, which keeps its existing batch-level `pr:<batch>` key. The
   * resolved stacked base for the boundary already rides in `baseBranch`/`workBranch`
   * (computed upstream by `selectStackedBases`); this field carries only the group
   * IDENTITY for keying, not the base derivation, so the engine never re-derives
   * boundary rules inline (`detectPrGroupBoundaries` stays their single home).
   */
  boundary?: PrGroupBoundary;
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
  /**
   * Captured agent output surfaced on a failed/blocked step. Carries the
   * model-failure attribution hint (when the failure matches the
   * argv-rejection signature) above the truncated stderr tail, so the operator
   * can spot an invalid model id without decoding raw stderr.
   */
  detail?: string;
  /** Pointer to journal entries this step produced (indices or ids). */
  journalRefs?: number[];
  message?: string;
}
