# gated-publish-job

## Why

The `ci-npx-release` batch publishes `ratchet` to npm only when every quality gate is green — a unit-tested decision, not just YAML wiring. Phases 1–3 proved the spine: the pure `decideRelease` and the thin `release-gate` runner. Today the workflow consults that runner in a main-only step immediately preceding a same-job `npm publish --dry-run` step.

Phase 4's first risk is structural: the publish must be reachable ONLY when the decision returns ALLOW on `main` — never on a non-main branch or any red gate. Today that reachability is just in-job step ordering plus a belt-and-braces `if: main`; it is not a property of the workflow graph and the decision is not a consumable job-level signal.

This **gated-publish-job** slice promotes the publish into its own `publish` job, governed by the proven decision surfaced as a machine-readable job output. It stays `npm publish --dry-run`; the idempotent guard and the real publish are later `after` changes.

## What Changes

A thin end-to-end slice through the whole stack — pure decision → runner output → job output → gated job → blackbox reachability proof — that adds the gated publish job without touching `decideRelease` and without performing a real release:

- **Emit a machine-readable decision from the runner.** `runReleaseGate` in `src/core/ci/release-gate.ts` today returns only `exitCode` + printable `lines`. Add a `release_allowed` boolean (mirroring `decision.allowed`) to its result and have the direct-run path append a `release_allowed=true|false` line to the file named by `GITHUB_OUTPUT` (GitHub Actions' step-output mechanism), in addition to the existing console lines and exit code. The pure function stays pure (it returns the value; only `isDirectRun()` writes the file), so it is exercised directly in tests. No new decision logic — the value is `decision.allowed`.

- **Expose the decision as a `ci` job output.** In `.github/workflows/ci.yml`, give the release-gate step an `id` and add an `outputs:` block to the `ci` job exposing `release_allowed: ${{ steps.<gate>.outputs.release_allowed }}`. This lifts the proven verdict from a step into a job-level signal another job can depend on.

- **Add a dedicated, gated `publish` job.** Add a second job `publish` to the workflow that `needs: [ci]` and is conditioned `if: needs.ci.outputs.release_allowed == 'true'`. Because `needs: [ci]` only runs on `ci` success, a red lint/test/coverage/e2e/security (which fails the `ci` job) skips `publish` automatically; on a non-main ref the gate step is skipped so `release_allowed` is not `true` and `publish` is skipped too. The job checks out, sets up Node + pnpm, builds, and runs the publish step — kept as **`npm publish --dry-run`** in this slice (no token, no real upload).

- **Extend the workflow test model.** `test/ci/helpers/workflow.ts` currently normalizes jobs to `{ id, name, runsOn, steps }`. Add job-level `needs`, `if`, and `outputs` to `WorkflowJob` (and parse them) so the structural assertions can see the publish job's gating. This is purely additive to the model.

- **Unit + structural tests.** Prove (a) behaviorally, that the runner writes `release_allowed=true` to a scratch `GITHUB_OUTPUT` on ALLOW (main + all green) and `release_allowed=false` on a red gate or a non-main branch; and (b) structurally, that the `ci` job exposes a `release_allowed` output sourced from the release-gate step, and that a distinct `publish` job exists, `needs` `ci`, is conditioned on `needs.ci.outputs.release_allowed == 'true'`, and runs `npm publish --dry-run`.

- **Ship the phase proof harness (reachability seed).** Add `test/e2e/npx-publish.sh` (the phase-4 proof-of-work, modeled on `test/e2e/release-gate.sh` / `security-gate.sh`): `pnpm build`, then run `release-gate.js` over FORCED gate signals against a scratch `GITHUB_OUTPUT`, and assert — ALLOW on `main` with all gates green → `release_allowed=true` → the publish job's gate condition is satisfied → dry-run publish path exercised (marker); a forced red gate → `release_allowed=false` → publish path NOT reached; a non-main ref → `release_allowed=false` → publish path NOT reached. The later changes thicken this same harness to a real/staged publish and an `npx ratchet --version` assertion.

## Design

**Decision as a job-level signal, governed by the proven module.** The reachability guarantee ("publish only when ALLOW on main") becomes a property of the workflow GRAPH: `publish` depends on a `ci` job output that is literally `decision.allowed` from the unit-tested `decideRelease`. The runner remains a thin adapter — it now adapts the verdict into BOTH an exit code (unchanged) and a `GITHUB_OUTPUT` line — adding no branching. `WIRED_GATES` and `decideRelease` are untouched.

**Two independent skip mechanisms, both fail-closed.** A red gate fails the `ci` job, and `needs: [ci]` skips `publish` (GitHub Actions requires needed jobs to succeed). A non-main ref leaves the main-only gate step unrun, so `release_allowed` is absent/`false` and the `if: needs.ci.outputs.release_allowed == 'true'` condition is false. Either path alone blocks publish; together they are belt-and-braces, matching the spine's fail-closed posture (a missing/non-`true` output never publishes).

**Why a separate job, not just a step.** A separate `publish` job makes the gating auditable in the workflow graph (the dependency edge + the output condition), isolates the publish environment (later: the npm token secret and provenance permissions live only on this job, not the test job), and gives the proof harness a concrete `release_allowed` signal to assert against. It also sets the seam the next two changes fill without re-plumbing.

**Structure vs behavior, proven two ways.** Behaviorally, the runner is exercised directly over a scratch `GITHUB_OUTPUT` (ALLOW writes `true`, DENY/non-main writes `false`). Structurally, the parsed-workflow model asserts the `ci` output and the `publish` job's `needs`/`if`/dry-run step by matching on substrings (robust to cosmetic renames), mirroring how `dry-run-publish-wiring.test.ts` already asserts the release path. The blackbox `npx-publish.sh` is the end-to-end maintainer-facing proof on top.

**Scope discipline.** This slice ships the gated job and the decision-output plumbing and NOTHING more: the publish stays `npm publish --dry-run`, no npm token / `id-token` provenance permission is added, and no version/idempotency handling is introduced. Those are the explicit later `after` changes (`idempotent-version-guard`, then `real-npm-publish`). Keeping the publish a dry-run here means the gating is proven before anything can ship.

**Trade-offs.** Promoting the publish to its own job re-incurs checkout/setup/build in that job (a fresh runner) — accepted, because the isolation it buys (a clean place for the token/provenance later, and a graph-level gate) is exactly the phase's point; the cost is one extra job's setup time. Surfacing the decision via `GITHUB_OUTPUT` couples the runner to one Actions mechanism, but it is the same mechanism the existing `GATE_*` wiring already relies on, and the pure function stays mechanism-free. Forcing the harness's inputs via environment (rather than a real Actions run) keeps it deterministic and local, at the cost of not exercising the literal `needs`/`if` evaluation — which the structural workflow test covers instead.

## Tasks

- [x] 1.1 Extend `runReleaseGate` in `src/core/ci/release-gate.ts` to include `release_allowed` (mirroring `decision.allowed`) in its result; in the `isDirectRun()` path, append `release_allowed=true|false` to the file named by `process.env.GITHUB_OUTPUT` (when set), alongside the existing console output and exit code. Do NOT change `WIRED_GATES` or `decideRelease`.
- [x] 2.1 In `.github/workflows/ci.yml`, give the release-gate step an `id` and add an `outputs:` block to the `ci` job exposing `release_allowed: ${{ steps.<id>.outputs.release_allowed }}`.
- [x] 2.2 Add a separate `publish` job to `.github/workflows/ci.yml`: `needs: [ci]`, `if: needs.ci.outputs.release_allowed == 'true'`, that checks out, sets up Node + pnpm, builds, and runs `npm publish --dry-run`. Add NO npm token, secret, or provenance permission in this slice.
- [x] 3.1 Extend `test/ci/helpers/workflow.ts`: add `needs`, `if`, and `outputs` to `WorkflowJob` and parse them (additive to the existing `{ id, name, runsOn, steps }` model).
- [x] 3.2 Add/extend unit tests (e.g. `test/ci/release-gate.test.ts`): the runner writes `release_allowed=true` to a scratch `GITHUB_OUTPUT` on ALLOW (main + every wired gate green), and `release_allowed=false` on a red gate and on a non-main branch.
- [x] 3.3 Add structural assertions (new `test/ci/gated-publish-job.test.ts`, using the extended workflow helper): the `ci` job exposes a `release_allowed` output sourced from the release-gate step; a distinct `publish` job exists, `needs` `ci`, is conditioned on `needs.ci.outputs.release_allowed == 'true'`, and runs `npm publish --dry-run`.
- [x] 4.1 Add `test/e2e/npx-publish.sh` (`set -euo pipefail`, scratch workdir, per-check logging, modeled on `test/e2e/release-gate.sh`): `pnpm build`, then run `release-gate.js` over forced GATE_* / branch env against a scratch `GITHUB_OUTPUT`, and assert the ALLOW-on-main case yields `release_allowed=true`, the publish gate condition is satisfied, and the dry-run publish path is exercised (marker written).
- [x] 4.2 In `npx-publish.sh`, add the skip cases: a forced red wired gate and a non-main ref each yield `release_allowed=false`, the publish gate condition is NOT satisfied, and the dry-run publish path is NOT reached.
- [x] 5.1 Run `pnpm lint && pnpm vitest run test/ci` (exit 0) and `bash test/e2e/npx-publish.sh` (passes), confirming the publish job is reachable only on ALLOW@main and skipped on a red gate or non-main ref.
- [x] 5.2 Confirm scope: this change adds only the decision output plumbing and the gated `publish` job; the publish stays `npm publish --dry-run`, no npm token/secret or provenance permission is added, no version/idempotency handling is introduced, and `decideRelease`'s core logic is unchanged. Idempotency and the real publish are the later `idempotent-version-guard` and `real-npm-publish` changes.
