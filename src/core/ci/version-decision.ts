/**
 * Version-decision module — the idempotency spine.
 *
 * A pure function that answers a single question: "should we publish THIS
 * version, or has it already shipped?". It is the idempotency counterpart to
 * `release-decision.ts`: where that module decides whether a release is allowed
 * at all (fail-closed on a non-main branch or a red gate), this one decides,
 * on the already-permitted publish path, whether the local version is NEW
 * (PUBLISH) or already on the registry (SKIP — a deliberate, green no-op).
 *
 * The crux of idempotency is that re-running an already-published version must
 * NOT error the pipeline. So SKIP is success, not failure: it is carried as a
 * `shouldPublish: false` flag, never as a failing outcome. The publish step is
 * what gets gated on that flag; the decision here only classifies.
 *
 * Pure: no I/O, no registry, no clock. The workflow layer gathers the local
 * version and the set of already-published versions and passes them in; this
 * module only decides. That is what makes the idempotency guarantee
 * exhaustively unit-testable. In this slice the published-version set is FORCED
 * via the environment; the swap to a real `npm view ratchet-ai versions` query is
 * the later `real-npm-publish` change and needs no change here.
 */

/** Named outcomes so call sites and assertions read clearly. */
export const PUBLISH = 'PUBLISH';
export const SKIP = 'SKIP';
export type VersionOutcome = typeof PUBLISH | typeof SKIP;

export interface VersionDecisionInput {
  /** The local version to consider publishing (from `package.json`). */
  version: string;
  /**
   * The versions already present on the registry. Membership is what makes the
   * decision idempotent: a `version` already in this set SKIPs.
   */
  publishedVersions: string[];
}

export interface VersionDecision {
  /** True only when `version` is NOT already published. */
  shouldPublish: boolean;
  /** Named outcome mirroring `shouldPublish`, for readable call sites. */
  outcome: VersionOutcome;
  /**
   * One human-readable reason explaining a SKIP; empty on PUBLISH. A new
   * version needs no justification, so PUBLISH carries no reasons — mirroring
   * the ALLOW path of `release-decision.ts`.
   */
  reasons: string[];
}

/**
 * Decide whether to publish `version`. PUBLISH (with empty reasons) when it is
 * absent from `publishedVersions`; otherwise SKIP, carrying one reason that the
 * version is already published — an idempotent no-op that must keep the pipeline
 * green.
 */
export function decidePublishVersion(input: VersionDecisionInput): VersionDecision {
  const alreadyPublished = input.publishedVersions.includes(input.version);

  const reasons: string[] = [];
  if (alreadyPublished) {
    reasons.push(`version "${input.version}" is already published — skipping (idempotent no-op)`);
  }

  const shouldPublish = !alreadyPublished;
  return {
    shouldPublish,
    outcome: shouldPublish ? PUBLISH : SKIP,
    reasons,
  };
}
