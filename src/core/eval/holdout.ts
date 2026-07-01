/**
 * Hold-out tag resolution.
 *
 * One source marks a case held out: an in-file `@holdout` Gherkin tag on the
 * Scenario. `resolveHoldout` is a pure function mirroring `resolveSkip`'s
 * shape — synchronous, in-memory, no filesystem, no spawn — but returns a
 * plain boolean since there is exactly one source and nothing else to report.
 */

import type { EvalCase } from './set.js';

export const HOLDOUT_TAG = '@holdout';

/** Resolve whether a case is held out: true when `c.tags` includes `@holdout`. */
export function resolveHoldout(c: EvalCase): boolean {
  return c.tags.includes(HOLDOUT_TAG);
}
