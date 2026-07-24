/**
 * Stacked PR base selection.
 *
 * The single, authoritative home for "what branch does each PR group's PR
 * target?" Given the ordered list of PR group boundaries (from
 * `detectPrGroupBoundaries`), the batch's base branch, and a resolver that names
 * each group's own branch, `selectStackedBases` returns one `StackedBase` per
 * boundary: group 0 bases on the batch base branch and group N (N ≥ 1) bases on
 * group N-1's own branch, so each stacked PR's diff stays scoped to its own unit
 * while dependent code still compiles.
 *
 * Every Phase 3 consumer that needs the stacked base — `pr-instruction-stacked-base`,
 * `engine-spawn-at-boundaries`, `apply-boundary-pr-wiring` — reads this one policy
 * instead of re-deriving "group N bases on group N-1" inline, the same single-home
 * discipline `detectPrGroupBoundaries` already established for boundaries.
 *
 * This is a purely *structural* mapping over the ordered boundaries: the base for
 * group N is fixed by the array's ordering (the previous boundary's group branch),
 * not by how far the run has progressed. Branch naming is supplied as a resolver,
 * not baked in — there is no git/forge literal here — so the policy is provable in
 * isolation with no filesystem access and no agent spawn.
 */

import type { PrGroupBoundary } from './boundary.js';

export interface StackedBase {
  /** The boundary this base was computed for — carries index/kind/groupId/trigger. */
  boundary: PrGroupBoundary;
  /** The branch this group's PR opens FROM — `branchForGroup(boundary)`. */
  headBranch: string;
  /**
   * The branch this group's PR targets: the PREVIOUS group's `headBranch`, or the
   * batch base branch for the first group.
   */
  baseBranch: string;
}

/**
 * Map the ordered PR group boundaries, the batch's base branch, and a
 * `branchForGroup` resolver to each group's stacked base, in order:
 *
 * - group 0 → `baseBranch` = `batchBaseBranch`; `headBranch` =
 *   `branchForGroup(boundary0)`.
 * - group N (N ≥ 1) → `baseBranch` = `branchForGroup(boundary N-1)` (the previous
 *   group's own branch); `headBranch` = `branchForGroup(boundary N)`.
 * - an empty boundary list → `[]` (nothing to stack).
 *
 * Each `StackedBase` carries its originating boundary so a consumer keeps the
 * group identity/trigger without a second lookup. The mapping uses the array's own
 * order rather than trusting `boundary.index`, so it is correct for any ordered
 * input.
 *
 * Pure over its plain-data input: no filesystem access and no agent spawn.
 */
export function selectStackedBases(
  boundaries: PrGroupBoundary[],
  batchBaseBranch: string,
  branchForGroup: (boundary: PrGroupBoundary, index: number) => string
): StackedBase[] {
  return boundaries.map((boundary, index) => ({
    boundary,
    headBranch: branchForGroup(boundary, index),
    baseBranch:
      index === 0
        ? batchBaseBranch
        : branchForGroup(boundaries[index - 1], index - 1),
  }));
}
