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
   * Optional free-text guidance appended verbatim to the agent instructions as
   * an "Additional guidance:" block (e.g. the headless propose verb's `-m`
   * values). Left undefined by `batch apply`, so batch instructions stay
   * byte-identical.
   */
  guidance?: string;
}

export type StepState =
  | 'advanced'
  | 'blocked'
  | 'awaiting-approval'
  | 'phase-gated'
  | 'nothing-ready';

/** The structured result the engine returns after one transition. */
export interface StepResult {
  state: StepState;
  change: string;
  transition: Transition;
  /** Present when state is `blocked`: the question requiring an answer. */
  blocker?: string;
  /** Present when state is `awaiting-approval`: the proposal summary. */
  approvalRequest?: string;
  /** Pointer to journal entries this step produced (indices or ids). */
  journalRefs?: number[];
  message?: string;
}
