/**
 * Hold-out tag resolution.
 *
 * One source marks a case held out: an in-file `@holdout` Gherkin tag on the
 * Scenario. `resolveHoldout` is a pure function mirroring `resolveSkip`'s
 * shape — synchronous, in-memory, no filesystem, no spawn — but returns a
 * plain boolean since there is exactly one source and nothing else to report.
 *
 * The domain-neutral raw-text transform `filterHoldoutContent` (and the
 * `@holdout` tag constant it shares with the resolver here) lives beside the
 * Gherkin parser in `../parsers/holdout-filter.js`; this module re-uses
 * {@link HOLDOUT_TAG} from there and re-exports it for existing consumers.
 */

import type { EvalCase } from './set.js';
import { HOLDOUT_TAG } from '../parsers/holdout-filter.js';

export { HOLDOUT_TAG };

/** Resolve whether a case is held out: true when `c.tags` includes `@holdout`. */
export function resolveHoldout(c: EvalCase): boolean {
  return c.tags.includes(HOLDOUT_TAG);
}

/**
 * Narrow `cases` to only those matching a hold-out scope filter: `undefined`
 * (no `--holdout`/`--no-holdout` flag) returns `cases` unchanged; otherwise
 * keeps only cases where `resolveHoldout(c) === holdout`.
 */
export function filterCasesByHoldout(cases: EvalCase[], holdout: boolean | undefined): EvalCase[] {
  if (holdout === undefined) return cases;
  return cases.filter((c) => resolveHoldout(c) === holdout);
}
