/**
 * Release-decision module — the "only when green" spine.
 *
 * A pure function that answers a single question: "is a release allowed?". It is
 * the shared spine every later quality gate plugs into. This phase wires the
 * `lint` and `test` gates; later phases add `coverage`, `e2e`, and `security`
 * against the SAME shape, with no change to the core logic — the wired-gate set
 * is data, not hardcoded branching.
 *
 * Fail-closed semantics: ALLOW only when the branch is `main` AND every wired
 * gate is explicitly green. Anything else — a non-main branch, a red gate, or a
 * missing/unknown signal — is a DENY carrying a precise reason per failure.
 *
 * Pure: no I/O, no git, no clock. The workflow layer gathers the branch name and
 * the gate results and passes them in; this module only decides. That is what
 * makes the "only when green" guarantee exhaustively unit-testable.
 */

/** The only branch a release is permitted from. */
export const RELEASE_BRANCH = 'main';

/** A wired gate is green (passing) or red (failing); any other value is not-green. */
export type GateSignal = 'green' | 'red';

/** Named outcomes so call sites and assertions read clearly. */
export const ALLOW = 'ALLOW';
export const DENY = 'DENY';
export type ReleaseOutcome = typeof ALLOW | typeof DENY;

export interface ReleaseDecisionInput {
  /** The branch the build is running on. */
  branch: string;
  /**
   * Signals for the wired gates, keyed by gate name (e.g. `lint`, `test`). The
   * keys ARE the wired-gate set — a key whose value is missing or non-green
   * denies, which is what keeps the decision fail-closed.
   */
  gates: Record<string, GateSignal | undefined>;
}

export interface ReleaseDecision {
  /** True only on a green `main` build. */
  allowed: boolean;
  /** Named outcome mirroring `allowed`, for readable call sites. */
  outcome: ReleaseOutcome;
  /** One human-readable reason per failing condition; empty when allowed. */
  reasons: string[];
}

/**
 * Decide whether a release is allowed. ALLOW iff `branch === 'main'` AND every
 * wired gate resolves to green; otherwise DENY, accumulating one reason for a
 * non-main branch and one for each non-green (red, missing, or unknown) gate.
 */
export function decideRelease(input: ReleaseDecisionInput): ReleaseDecision {
  const reasons: string[] = [];

  if (input.branch !== RELEASE_BRANCH) {
    reasons.push(`branch is "${input.branch}", not "${RELEASE_BRANCH}"`);
  }

  // Fail-closed on an empty wired-gate set: with no gates the per-gate loop below
  // has nothing to reject, so an empty set would otherwise ALLOW — a build that
  // proved nothing. A release must be backed by at least one green gate, so an
  // empty set is itself a denial. (The runner also guards WIRED_GATES is
  // non-empty; this keeps the property at the pure-decision layer too.)
  if (Object.keys(input.gates).length === 0) {
    reasons.push('no wired gates — nothing proves the build is green');
  }

  for (const [gate, signal] of Object.entries(input.gates)) {
    if (signal !== 'green') {
      reasons.push(`"${gate}" gate is not green`);
    }
  }

  const allowed = reasons.length === 0;
  return {
    allowed,
    outcome: allowed ? ALLOW : DENY,
    reasons,
  };
}
