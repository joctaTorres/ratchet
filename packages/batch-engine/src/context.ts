/**
 * Engine-internal step types.
 *
 * The public contract (`ResolvedStepContext` / `StepResult` from `ratchet`) is
 * the boundary the CLI sees. This module adds engine-internal detail the
 * contract deliberately keeps opaque:
 *
 *  - `EngineStepOutcome` carries the richer outcome the engine computes while
 *    running a transition (including `failed`, which the contract surfaces as
 *    `blocked` so the CLI re-prompts rather than corrupting batch state).
 *  - `resolveProjectRoot()` recovers the project root the engine needs to read
 *    on-disk change state and append to the journal. The contract intentionally
 *    omits the root (the CLI resolves context; the engine returns a result), so
 *    the engine — which runs in-process inside the project — recovers it via the
 *    re-exported planning-home resolver, falling back to `process.cwd()`.
 */

import { resolveCurrentPlanningHomeSync } from 'ratchet';
import type { StepResult, StepState, Transition } from 'ratchet';

/** Richer outcome states the engine distinguishes internally. */
export type EngineOutcomeState = StepState | 'failed';

export interface EngineStepOutcome {
  state: EngineOutcomeState;
  change: string;
  transition: Transition;
  blocker?: string;
  approvalRequest?: string;
  /** Captured agent output, surfaced on failure. */
  detail?: string;
  message?: string;
  journalRefs?: number[];
}

/**
 * Map the engine's internal outcome to the public `StepResult`.
 *
 * `failed` is not a contract state: a crashed/non-zero agent surfaces as
 * `blocked` (needs attention) so the CLI parks it and the batch stays resumable,
 * rather than being reported as a clean advance.
 */
export function toStepResult(outcome: EngineStepOutcome): StepResult {
  if (outcome.state === 'failed') {
    return {
      state: 'blocked',
      change: outcome.change,
      transition: outcome.transition,
      blocker: outcome.blocker ?? outcome.detail ?? 'agent step failed',
      journalRefs: outcome.journalRefs,
      message: outcome.message ?? outcome.detail,
    };
  }
  return {
    state: outcome.state,
    change: outcome.change,
    transition: outcome.transition,
    blocker: outcome.blocker,
    approvalRequest: outcome.approvalRequest,
    journalRefs: outcome.journalRefs,
    message: outcome.message,
  };
}

/**
 * Resolve the project root the engine operates against. The engine runs
 * in-process inside the project the CLI invoked, so the planning-home resolver
 * (re-exported from `ratchet`) is authoritative; `process.cwd()` is the fallback
 * for tests or detached invocations.
 */
export function resolveProjectRoot(): string {
  try {
    return resolveCurrentPlanningHomeSync().root;
  } catch {
    return process.cwd();
  }
}
