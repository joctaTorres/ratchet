# harden-release-gate-from-review

## Why

The PR #20 review of the `ci-npx-release` gate stack flagged two hardening gaps in the otherwise fail-closed release pipeline. First, `decideRelease` ALLOWs an EMPTY gate set: `decideRelease({ branch: 'main', gates: {} })` returns ALLOW because the per-gate loop has nothing to reject, so the whole "only when green" guarantee rests on the runner always populating `WIRED_GATES` — a future refactor that passes `{}` would silently open the gate. Second, the secret-scan allowlist matches a bare `rule` id, which exempts EVERY finding of that rule in ANY file — an "allowlist too broad" footgun for a security gate. This change closes both: an empty gate set must DENY, the runner must assert its wired set is non-empty, and the secret-scan allowlist must drop bare-`rule` matching (keeping the precise `file:rule` fingerprint and the bare-`file` match the CI allowlist actually uses). No other ALLOW/DENY or gate behavior changes.

## What Changes

- `src/core/ci/release-decision.ts`: `decideRelease` treats an EMPTY `gates` record as fail-closed DENY with a clear reason, so a release can never be allowed with no wired gates. Non-empty gate sets keep identical ALLOW/DENY behavior.
- `src/core/ci/release-gate.ts`: add a defensive guard that `WIRED_GATES` is non-empty, so a future refactor passing `{}` cannot silently open the gate.
- `src/core/ci/secret-scan-gate.ts`: drop the bare-`rule` arm from `isAllowlisted`; keep the `file:rule` fingerprint match and the bare-`file` match. Update the doc comment + `SecretScanInput` doc to match.
- Tests: `test/ci/release-decision.test.ts` (empty gates -> DENY), `test/ci/release-gate.test.ts` (non-empty WIRED_GATES guard), `test/ci/secret-scan-gate.test.ts` (a bare-rule allowlist entry no longer exempts; fingerprint + file still do).
- The existing CI allowlist entry `test/core/batch/permissions-resolution.test.ts` is a bare-FILE match, so it stays exempt and `security-gate.sh` stays green.
- Multi-agent surface: none. Pure decision modules + a thin runner + unit tests.

## Design

**Empty gates fail-closed.** The decision rule is "ALLOW iff branch is main AND every wired gate is green". With zero gates the "every gate green" clause is vacuously true, so the only safe reading for a release gate is: an empty wired set is itself a failure (there is nothing proving the build is green). `decideRelease` adds one guard — if `gates` has no keys, push a reason and DENY — before the existing per-gate loop, leaving every non-empty path byte-for-byte unchanged. This is defense in depth alongside the runner guard, so the property holds at the pure-decision layer too and stays unit-testable.

**Runner guard.** `runReleaseGate` asserts `WIRED_GATES.length > 0` before building the gates record. The wired set is a compile-time constant today, but the guard makes a future refactor that empties it fail loudly rather than silently open the gate. It throws a clear error (the runner is the impure boundary; a misconfigured wired set is a programming error, not a runtime gate signal).

**Narrowed allowlist.** `isAllowlisted` keeps two arms: the precise `file:rule` fingerprint (targets one planted finding) and the bare `file` (exempts a known-safe fixture file). It drops the bare `rule` arm, which exempted every finding of a rule everywhere — too broad for a security gate. The CI allowlist already uses a bare-FILE entry (`test/core/batch/permissions-resolution.test.ts`), so the planted fake-credential fixture stays exempt and the security gate stays green; only the never-used, dangerous bare-rule path is removed.

**No behavior change beyond the two findings.** Every existing ALLOW/DENY for a non-empty gate set, and every secret-scan verdict that did not rely on bare-rule matching, is preserved. The tests pin both the new fail-closed behavior and the unchanged behavior.

## Tasks

- [x] 1.1 In `src/core/ci/release-decision.ts`, make `decideRelease` DENY (with a clear reason) when `gates` is an empty record, before the per-gate loop; keep all non-empty behavior identical.
- [x] 1.2 Add a unit test in `test/ci/release-decision.test.ts`: `decideRelease({ branch: 'main', gates: {} })` is DENY with a reason naming the empty/no-gates condition.
- [x] 2.1 In `src/core/ci/release-gate.ts`, add a defensive guard that `WIRED_GATES` is non-empty in `runReleaseGate` (throw a clear error if empty).
- [x] 2.2 Extend `test/ci/release-gate.test.ts` to assert the non-empty `WIRED_GATES` invariant.
- [x] 3.1 In `src/core/ci/secret-scan-gate.ts`, drop the bare-`rule` arm from `isAllowlisted` (keep `file:rule` fingerprint and bare `file`); update the doc comments.
- [x] 3.2 Update `test/ci/secret-scan-gate.test.ts`: a bare-rule allowlist entry no longer exempts a finding; fingerprint and bare-file still do.
- [x] 4.1 Run `pnpm lint && pnpm vitest run test/ci`; confirm lint clean and all `test/ci` tests pass. Confirm `security-gate.sh` stays green (bare-file allowlist entry still exempts the planted fixture).
