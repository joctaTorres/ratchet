# wire-coverage-e2e-into-release-gate

## Why

The `ci-npx-release` batch publishes `ratchet` to npm only when every quality gate is green, and that "only when green" must be a **real, unit-tested decision**, not just YAML wiring. Phase 1 shipped the pure `decideRelease` spine (`release-decision.ts`) and the thin `release-gate` runner (`release-gate.ts`), wiring only `lint` and `test`.

Phase 2 makes **missing coverage** and **broken end-to-end behavior** block the release. The two prior slices already PRODUCE the signals — `coverage-threshold-gate` (`coverage-gate.ts`) and `e2e-cli-smoke` (`e2e-gate.ts`) — each emitting the `GateSignal` shape the spine consumes, but **deliberately not wired** into the decision.

This change is the **wiring slice**. It plugs both signals into the release-decision spine so a coverage drop or an e2e failure flips the gate to **DENY**, and ships the phase proof harness (`test/e2e/release-gate.sh`). The publish path stays `npm publish --dry-run` — this phase proves the gate, it does not ship a real release.

## What Changes

A thin, data-only wiring — the riskiest part is already proven, so this slice should be small:

- **Extend the wired-gate set, not the decision logic.** The release-decision module is intentionally data-driven: its wired-gate set is the keys of the `gates` record, not hardcoded branching. `decideRelease` needs **no change**. Wiring is: add `coverage` and `e2e` to `WIRED_GATES` in `release-gate.ts` (→ `['lint', 'test', 'coverage', 'e2e']`). The runner already maps each gate name to `GATE_<NAME>` and treats any non-`green` value (including missing) as not-green, so coverage/e2e inherit fail-closed semantics for free.
- **Feed the signals from the workflow.** The release-gate step in `.github/workflows/ci.yml` already sets `GATE_LINT` / `GATE_TEST` from step outcomes. Add `GATE_COVERAGE` from the `coverage` step's outcome and `GATE_E2E` from the `e2e` step's outcome, each fail-closed to `'red'` when its step did not succeed — mirroring the existing `${{ steps.X.outcome == 'success' && 'green' || 'red' }}` pattern. The dry-run publish step is unchanged.
- **Ship the phase proof harness.** Add `test/e2e/release-gate.sh` (the phase proof-of-work): build the package, drive the built CLI green via the existing `cli-smoke.sh`, and assert (a) all-green on `main` → release gate exits ALLOW and the dry-run publish path is exercised; (b) a forced coverage total below the threshold makes the coverage gate red and the release gate DENY; (c) a forced failing e2e check makes the e2e gate red and the release gate DENY. It composes the already-shipped runners (`coverage-gate.js`, `e2e-gate.js`, `release-gate.js`) over real/forced inputs — no new decision logic.

## Design

**Wired-gate set as data.** `WIRED_GATES` in `src/core/ci/release-gate.ts` becomes `['lint', 'test', 'coverage', 'e2e']`. `decideRelease` is untouched: it already treats the wired-gate set as the keys of the `gates` record, so coverage/e2e inherit the same "ALLOW on `main` only when every wired gate is green, else DENY with a per-gate reason" semantics, and any missing/non-`green` value is fail-closed to not-green for free.

**Workflow env feeds the signals.** The release-gate step in `.github/workflows/ci.yml` adds `GATE_COVERAGE` from the `coverage` step's outcome and `GATE_E2E` from the `e2e` step's outcome, each fail-closed to `'red'` when its step did not succeed, mirroring the existing `${{ steps.X.outcome == 'success' && 'green' || 'red' }}` pattern used for lint/test. The `npm publish --dry-run` step is unchanged.

**Proof harness.** `test/e2e/release-gate.sh` composes the already-shipped runners over real/forced inputs: all-green on `main` → release gate ALLOW and the dry-run publish path is exercised; a forced below-threshold coverage total → coverage gate red → DENY; a forced failing e2e result → e2e gate red → DENY. In both DENY cases the dry-run publish path is not reached.

**Structure vs behavior.** The wiring is proven two ways: behaviorally by exercising the `release-gate` runner directly with coverage/e2e signals (ALLOW only when all four green; DENY on a red or missing coverage/e2e), and structurally by asserting the workflow's release-gate step now carries `GATE_COVERAGE` / `GATE_E2E` and the publish step is still `--dry-run`. The blackbox `release-gate.sh` is the end-to-end maintainer-facing proof on top.

**Trade-offs.** Keeping `decideRelease` untouched and changing only `WIRED_GATES` + the workflow env keeps the proven spine stable and makes the wiring auditable as data. The harness forces regressions by manipulating the gates' inputs (a below-threshold coverage summary, a failing smoke result) rather than by sabotaging real source, so it is deterministic and side-effect-free.

## Tasks

- [x] 1.1 Extend `WIRED_GATES` in `src/core/ci/release-gate.ts` to `['lint', 'test', 'coverage', 'e2e']`. Confirm `decideRelease` in `release-decision.ts` needs NO change (the wired-gate set is data: the keys of `gates`).
- [x] 1.2 Update the release-gate step in `.github/workflows/ci.yml` to also pass `GATE_COVERAGE: ${{ steps.coverage.outcome == 'success' && 'green' || 'red' }}` and `GATE_E2E: ${{ steps.e2e.outcome == 'success' && 'green' || 'red' }}` (fail-closed to `red`). Leave the `npm publish --dry-run` step unchanged.
- [x] 2.1 Update `test/ci/release-gate.test.ts` (and/or `release-decision.test.ts`): assert ALLOW on `main` requires all of `lint`/`test`/`coverage`/`e2e` green; DENY (with the matching reason) when `coverage` is red, when `e2e` is red, and fail-closed DENY when `coverage` or `e2e` is missing.
- [x] 2.2 Update the CI-step structural assertions (using `test/ci/helpers/workflow.ts`) to assert the release-gate step env now includes `GATE_COVERAGE` and `GATE_E2E` wired from the coverage/e2e step outcomes, and that the publish step is still `npm publish --dry-run`.
- [x] 3.1 Add `test/e2e/release-gate.sh` (`set -euo pipefail`, scratch workdir, per-check logging, following the existing `test/e2e/*.sh` conventions): `pnpm build`, then assert the all-green ALLOW case (drive the built CLI via `cli-smoke.sh`, run the coverage + e2e gates green, run `release-gate.js` on `main` with every `GATE_*=green` → exit 0 / ALLOW, dry-run path exercised).
- [x] 3.2 In `release-gate.sh`, add the DENY cases: force a coverage total below the threshold (point `COVERAGE_SUMMARY` at a below-threshold fixture or set a high `COVERAGE_THRESHOLD`) and assert `coverage-gate.js` is red and the release gate is DENY; force a failing e2e result (write a `{ok:false}` / failing-check result and point `E2E_RESULT` at it) and assert `e2e-gate.js` is red and the release gate is DENY. Assert the dry-run publish path is not reached in either DENY case.
- [x] 4.1 Run `pnpm lint && pnpm vitest run test/ci` (exit 0) and `bash test/e2e/release-gate.sh` (passes), confirming the harness shows ALLOW on green and DENY on a forced coverage/e2e regression.
- [x] 4.2 Confirm scope: this change only extends `WIRED_GATES` and the workflow env and adds the proof harness; `decideRelease`'s core logic is unchanged, the publish path stays `--dry-run`, and the security gate (phase 3) is out of scope.
