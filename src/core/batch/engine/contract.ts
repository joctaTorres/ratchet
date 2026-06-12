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

/** Everything the engine needs to drive one transition, resolved by the CLI. */
export interface ResolvedStepContext {
  batch: string;
  change: string;
  transition: Transition;
  phase: {
    name: string;
    goal: string;
    success: string;
    proofOfWork: ProofOfWork;
  };
  settings: BatchSettings;
  /** Prior journal entries for this change (resume context). */
  journal: JournalEntry[];
  /** Resume context when the step was parked. */
  resume?: {
    kind: 'blocked' | 'awaiting-approval';
    reason: string;
    answer?: string;
    feedback?: string;
  };
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
