# gated-dry-run-publish

## Why

The `ci-npx-release` batch publishes `ratchet` to npm only when every quality gate is green, and its promise is that "only when green" is a **real, unit-tested decision**, not just YAML wiring. Phase 1 (`gated-release-path-dry-run`) stands up the whole pipeline as a dry-run. Two slices have landed: `ci-quality-gate-workflow` shipped the `install -> lint -> test` spine plus a reusable YAML parser, and `release-decision-module` shipped the pure, unit-tested `decideRelease` function.

This change is the **third and final slice**: it **wires those two together**, filling the `=== RELEASE PATH SEAM ===` in `.github/workflows/ci.yml` with a **main-only release-gate step that consults the release-decision module** and, on ALLOW, runs **`npm publish --dry-run`** — exercising the full publish path without releasing anything (no real publish, no npm token). After it, the phase proof `pnpm lint && pnpm vitest run test/ci` is green. Phases 2–4 thicken this spine and are out of scope.

## What Changes

- **Workflow wiring.** Replace the seam in `.github/workflows/ci.yml` (after the green `install -> lint -> test` spine) with two release-path steps, both conditioned to the `main` branch only (e.g. `if: github.ref == 'refs/heads/main'`):
  1. A **release-gate step** that invokes the release-gate runner, which consults the release-decision module. A DENY exits non-zero and short-circuits the publish path; an ALLOW lets it proceed.
  2. A **dry-run publish step** that runs `npm publish --dry-run` — only reachable after the gate passes. Never a bare `npm publish`; no `NODE_AUTH_TOKEN` / npm secret is required.
- **Release-gate runner.** Add a small, shippable entrypoint under `src/core/ci/` (e.g. `src/core/ci/release-gate.ts`) that reads the current branch and the wired `lint` / `test` gate signals from its environment, calls `decideRelease`, prints the outcome (and denial reasons on DENY), and exits `0` on ALLOW / non-zero on DENY. It adds **no** new decision logic — it only adapts the workflow's environment to the pure module so the YAML condition is backed by the proven decision, not a hand-rolled `if`.
- **Tests** under `test/ci/` (so the phase proof `pnpm vitest run test/ci` covers them):
  - Parser-driven assertions on the wired `ci.yml`: the `install -> lint -> test` spine is preserved; a main-only release-gate step that references the release-decision module sits after the spine; an `npm publish --dry-run` step sits after the gate and is main-only; **no** step runs a bare `npm publish` without `--dry-run`; both release-path steps sit after lint and test.
  - Runner integration assertions: ALLOW + exit zero on a green `main` build; DENY + non-zero on a non-main branch (reason names the branch); DENY + non-zero when a wired gate is red (reason names the gate); fail-closed DENY + non-zero when a gate signal is missing.
- Implements `features/ci/dry-run-publish-wiring.feature` and `features/ci/release-gate-runner.feature`.
- Multi-agent surface: **none**. Workflow YAML, a thin runner, and tests; no agent-specific files, skills, or commands.

## Design

**Thin vertical slice that closes the loop.** The two prior slices are deliberately decoupled — a workflow that runs install/lint/test and a pure decision function that nothing yet calls. This slice is the smallest change that joins them into a working end-to-end pipeline: it touches `ci.yml` (which the first slice forbade itself from completing) and adds the bridge runner. After it, all three parts of the phase proof pass together.

**Runner as a thin adapter, not new logic.** The decision rule is already proven in `release-decision-module`. The runner's only job is impure glue: read `branch` + gate signals from the environment, hand them to `decideRelease`, and translate the returned `{ allowed, reasons }` into a process exit code the gate step can act on. Keeping the runner logic-free preserves the batch's promise — the gate is governed by the *unit-tested* module, while the YAML `if` only narrows to `main`. The runner is tested by feeding it an environment and asserting its decision + exit behavior, no Actions runner needed.

**Why a runner instead of an inline `if`.** A hand-written `if:` in YAML re-implements the gate logic outside the tested module and drifts as phases 2–4 add gates. Routing the decision through `decideRelease` means every later gate plugs into the same proven spine — the workflow step never grows new branching, it just passes more signals. The `if: github.ref == 'refs/heads/main'` on the step is only the main-only narrowing the module also enforces; it is belt-and-braces, keeping the publish path unreachable off `main` even before the runner runs.

**Structure asserted via the parser, behavior asserted via the runner.** A unit test can't run GitHub Actions, so the workflow half is proven structurally against the parsed model the first slice exposed: step presence, ordering (gate after spine, publish after gate), the main-only condition, and the dry-run flag — matching steps by `run`/`uses` substrings and reading each step's `if`, robust to cosmetic renames. The decision half is proven behaviorally by exercising the runner directly. Together they pin both "the wiring is shaped right" and "the gate decides right". The real red/green behavior is exercised for real on every push to GitHub, which the batch wants observable.

**Dry-run, fail-closed, no secrets.** `npm publish --dry-run` runs the entire publish path — pack, manifest checks, registry negotiation — and stops short of uploading, so it needs no token and releases nothing. The gate is fail-closed by construction (the module denies on any non-green/missing signal), and the publish step is positioned so a red lint/test (which fails the job earlier via Actions' default `success()` condition) is never followed by a publish attempt.

**Parser extension, if any, stays minimal.** The existing helper already exposes ordered steps with `name`/`uses`/`run`. If the assertions need a step's `if` condition to verify "main-only", extend `WorkflowStep` with an optional `if` field in the helper and normalize it alongside the others — a small, churn-free addition the helper was designed to allow. No new parsing framework.

**Trade-offs.** Backing the YAML condition with a runner is slightly more than a one-line `if`, but it is exactly the batch's thesis: the release gate is a provable decision reused by every later phase, not YAML hoped to be correct. The cost is one tiny adapter; the payoff is that phases 2–4 extend the gate by passing more signals, never by rewriting workflow conditions.

## Tasks

- [x] 1.1 Add a shippable release-gate runner under `src/core/ci/` (e.g. `src/core/ci/release-gate.ts`) that reads the current branch and the wired `lint`/`test` gate signals from its environment, calls `decideRelease`, prints the outcome and any denial reasons, and exits `0` on ALLOW / non-zero on DENY. Add no new decision logic — delegate entirely to the module.
- [x] 1.2 Wire `.github/workflows/ci.yml`: replace the `=== RELEASE PATH SEAM ===` with a main-only release-gate step (`if: github.ref == 'refs/heads/main'`) that invokes the runner, followed by a main-only `npm publish --dry-run` step that runs only after the gate. Do not add a bare `npm publish` and do not require an npm auth token.
- [x] 2.1 Add `test/ci/dry-run-publish-wiring.test.ts` (using the existing workflow parser helper) asserting: the `install -> lint -> test` spine is preserved; a release-gate step referencing the release-decision module sits after the spine and is conditioned to `main` only; an `npm publish --dry-run` step sits after the gate and is main-only; both release-path steps sit after lint and test.
- [x] 2.2 In the same suite, assert the workflow performs no real publish: no step runs a bare `npm publish` without `--dry-run`, and the publish path requires no npm auth token.
- [x] 2.3 If asserting the main-only condition requires it, extend the workflow parser helper's `WorkflowStep` with an optional `if` field (normalized like `name`/`uses`/`run`) — a minimal, churn-free addition.
- [x] 2.4 Add `test/ci/release-gate.test.ts` exercising the runner: ALLOW + exit zero on a green `main` build; DENY + non-zero on a non-main branch (reason names the branch); DENY + non-zero when `test` is red (reason names the gate); fail-closed DENY + non-zero when a gate signal is missing.
- [x] 3.1 Run `pnpm lint && pnpm vitest run test/ci` locally; confirm lint is clean and all `test/ci` tests pass (exit 0) — covering this change's two suites plus the prior slices'.
- [x] 3.2 Confirm scope: the workflow runs only `npm publish --dry-run` (never a real publish), needs no token, and adds no agent-specific branching. Real publish, version/tag handling, and the npm secret belong to phase 4 (`real-npm-publish-on-main`); coverage/e2e/security gates belong to phases 2–3.
