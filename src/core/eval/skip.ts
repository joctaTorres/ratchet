/**
 * Skip-filter resolution.
 *
 * Two independent sources can exclude a case from judging: an in-file
 * `@skip` Gherkin tag on the Scenario, or a project-level `eval.skip` glob
 * pattern matched against the case id. `resolveSkip` is a pure function
 * mirroring `gate.ts`/`jury.ts`'s shape — synchronous, in-memory, no
 * filesystem, no spawn — called once per case from `execute.ts` before any
 * binding resolution.
 */

import type { EvalCase } from './set.js';

export const SKIP_TAG = '@skip';

export interface SkipReason {
  source: 'tag' | 'config';
  /** The matched detail: the case's source file for a tag match, the matched pattern for a config match. */
  detail: string;
}

/** Convert an `eval.skip` glob pattern to an anchored regex, matched against the full case id. */
function patternMatches(pattern: string, id: string): boolean {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
    .replace(/\*/g, '.*'); // Replace * with .*
  return new RegExp(`^${regexPattern}$`).test(id);
}

/**
 * Resolve whether a case is skipped: the `@skip` tag is checked first, then
 * each `eval.skip` pattern (in order) against the case id. Returns `null`
 * when neither source matches.
 */
export function resolveSkip(c: EvalCase, patterns?: string[]): SkipReason | null {
  if (c.tags.includes(SKIP_TAG)) {
    return { source: 'tag', detail: c.source };
  }
  for (const pattern of patterns ?? []) {
    if (patternMatches(pattern, c.id)) {
      return { source: 'config', detail: pattern };
    }
  }
  return null;
}
