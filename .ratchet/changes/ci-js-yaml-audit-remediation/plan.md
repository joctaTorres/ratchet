# ci-js-yaml-audit-remediation

## Why

PR #113's CI fails the dependency-audit gate: `pnpm audit` reports js-yaml
advisory GHSA-2883-xcg3-v3hh against the transitive js-yaml 4.x (pulled in via
eslint / typescript-eslint dev tooling), and the existing workspace override
still pins `js-yaml@4` to the now-vulnerable 4.3.1. Bumping the pin to the
patched 4.3.2 clears the advisory without touching the gate.

## What Changes

- `pnpm-workspace.yaml`: change the existing override `js-yaml@4: 4.3.1` →
  `js-yaml@4: 4.3.2`, and update the adjacent security-remediation comment to
  name GHSA-2883-xcg3-v3hh and "patched in 4.3.2".
- `pnpm-lock.yaml`: regenerated so every js-yaml 4.x resolution is 4.3.2.
- No change to `.github/workflows/ci.yml`, `src/core/ci/dependency-audit-gate.ts`,
  or the audit threshold.
- Implements `features/ci/js-yaml-audit-remediation.feature`.

## Design

**Severity classification (security-remediation standard).** The advisory is
flagged at/above the gate's failure threshold (that is why CI fails), so it is
treated as high: the remediation must be complete, not partial.

**Material requirements of the exposure**, each mapped to a task below:

1. R1 — No installed js-yaml 4.x version is below the patched 4.3.2
   (override bumped; lockfile has zero 4.x entries at ≤ 4.3.1). → tasks 1.1–1.3
2. R2 — `pnpm audit` no longer reports GHSA-2883-xcg3-v3hh and the
   dependency-audit gate passes at its unchanged threshold. → task 2.1
3. R3 — No other js-yaml major is left vulnerable to this advisory: confirm from
   the audit report that no js-yaml 3.x/5.x path is flagged; if one is, add a
   matching per-major override in the same change rather than deferring it. → task 2.2

**Approach.** Reuse the existing per-major override (`js-yaml@4`) rather than
adding a direct dependency or a range override: it is the established pattern in
`pnpm-workspace.yaml`, scopes the pin to the vulnerable major, and is a one-line
change. The audit gate and threshold are explicitly out of scope — weakening them
would be a "lying security control" under the security-remediation standard.

**Testing (testing standard).** No product behavior changes, so no new unit or
integration test is added; the proof is the existing audit gate plus the full
existing suite staying green (js-yaml is consumed by lint tooling, so `pnpm lint`
must also pass).

**Documentation (documentation standard).** No CLI command, flag, config key,
generated artifact, or public API changes, so no `docs/` Reference entry or
`README.md` surface is affected; the only documentation is the security
remediation comment in `pnpm-workspace.yaml`, updated in task 3.1.

**Close-claim.** Honest close wording ("fixes the PR #113 audit failure") is
asserted only after task 2.1–2.2 verification passes.

## Tasks

- [x] 1.1 In `pnpm-workspace.yaml`, change the override `js-yaml@4: 4.3.1` to `js-yaml@4: 4.3.2` (R1)
- [x] 1.2 Regenerate `pnpm-lock.yaml` with `pnpm install` (R1)
- [x] 1.3 Confirm `pnpm-lock.yaml` resolves every js-yaml 4.x entry to 4.3.2 and none to ≤ 4.3.1, e.g. `pnpm why js-yaml` (R1)
- [x] 2.1 Run `pnpm audit --json > audit/audit-report.json`, build, and run `node dist/core/ci/dependency-audit-gate.js` with `AUDIT_REPORT` set; confirm GHSA-2883-xcg3-v3hh is absent and the gate exits zero (R2)
- [x] 2.2 Confirm the audit report flags no other js-yaml major for this advisory; if one is flagged, add the matching per-major override and repeat 1.2–2.1 (R3)
- [x] 2.3 Confirm `.github/workflows/ci.yml` and `src/core/ci/dependency-audit-gate.ts` are unchanged versus main (gate and threshold untouched)
- [x] 2.4 Run the project's full check suite (`pnpm lint`, `pnpm build`, `pnpm test`) and confirm it is green
- [x] 3.1 Documentation (documentation standard): update the security-remediation comment in `pnpm-workspace.yaml` to name GHSA-2883-xcg3-v3hh and "patched in 4.3.2"; confirm no `docs/` Reference file or `README.md` describes the js-yaml pin (none require updating)
