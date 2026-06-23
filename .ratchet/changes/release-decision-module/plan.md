# release-decision-module

## Why

The `ci-npx-release` batch publishes `ratchet` to npm only when every quality gate is green, and the batch's central promise is that "only when green" is a **real, unit-tested decision** — not just YAML wiring that is hoped to be correct. Phase 1 (`gated-release-path-dry-run`) stands up the whole pipeline shape end to end as a dry-run; the first slice (`ci-quality-gate-workflow`) shipped the `install -> lint -> test` workflow skeleton and a reusable workflow parser.

This change is the **second, thinnest slice** of that phase: the **release-decision module** itself — a pure, exhaustively unit-tested function that answers "is a release allowed?" and returns ALLOW only when `branch == main` AND every wired gate signal (this phase: lint + test) is green. This module is the spine every later gate plugs into: phase 2 wires coverage + e2e into it, phase 3 wires security, and phase 4 flips the path to a real publish — all consulting this same decision.

It deliberately does **not** wire the module into `.github/workflows/ci.yml` or add the `npm publish --dry-run` step — that is the next change, `gated-dry-run-publish`, which consumes this module's decision behind a main-only release-gate step. This slice exists to prove the "only when green" logic in isolation so the workflow wiring has a trustworthy spine to call.

## What Changes

- Add a shippable, pure release-decision module under `src/core/ci/` (e.g. `src/core/ci/release-decision.ts`) so it is covered by `pnpm lint` (`eslint src/`) and reusable by the CLI/workflow later.
- The module exports a `decideRelease(input)` function returning a small, explicit decision: `{ allowed: boolean; reasons: string[] }` (DENY carries the human-readable reasons; ALLOW carries none). Model decisions as named constants/types (e.g. `ALLOW`/`DENY`) so call sites read clearly.
- Inputs: the current `branch` plus a set of wired **gate signals** keyed by name (`lint`, `test`, and later `coverage`/`e2e`/`security`), each `green | red | (missing)`. The set of wired gates is data, not hardcoded branching — so a later phase adds a gate by wiring one more signal, with no change to the core logic.
- Decision rule, **fail-closed**: ALLOW iff `branch === 'main'` AND every wired gate is explicitly green. Any non-main branch, any red gate, or any missing/unknown gate signal yields DENY with a precise reason per failing condition.
- Add unit tests under `test/ci/` (e.g. `test/ci/release-decision.test.ts`) so the phase proof `pnpm vitest run test/ci` covers them. Tests prove: DENY on a non-main branch (even all-green), DENY when lint is red, DENY when test is red, DENY reporting both when both are red, ALLOW only on a green `main` build, fail-closed DENY on a missing gate signal, and that an extra wired gate must also be green to ALLOW.
- Implements `features/ci/release-decision.feature`.
- Multi-agent surface: **none**. This is a pure decision module plus unit tests; no agent-specific files, skills, or commands.

## Design

**Thin vertical slice, shared spine.** The phase proof-of-work is `pnpm lint && pnpm vitest run test/ci`, which spans all three phase-1 changes. This change owns the part that is purely the decision logic: the module and its unit tests. The workflow-wiring half of the proof (a main-only release-gate step ahead of `npm publish --dry-run`, asserted via the parser the first slice shipped) is added by `gated-dry-run-publish` — this change must not touch `ci.yml`.

**Pure function, no I/O.** `decideRelease` takes everything it needs as arguments — branch name and gate signals — and returns a value. No git calls, no env reads, no clock. This is what makes the "only when green" guarantee provable: every branch of the decision is exhaustively unit-testable without a runner. The workflow (next change) is responsible for *gathering* branch + gate results and *passing* them in.

**Gates as data, not branches.** Represent wired gates as a keyed collection of signals rather than fixed `if (lint) … if (test) …` code. ALLOW requires `branch === 'main'` and that **every** wired gate resolves to green; the reasons list accumulates one entry per failing gate plus one for a non-main branch. This makes phases 2–3 ("wire coverage/e2e", "wire security") additive: they extend the input set and the same loop covers them, which the `coverage`-gate scenario in the feature pins now.

**Fail-closed semantics.** A gate that is `red`, absent, or any value other than an explicit green is treated as not-green and denies. Defaulting to DENY on unknown input is the safe posture for a release gate and is asserted directly (missing `test` signal → DENY).

**Explicit, inspectable decision shape.** Returning `{ allowed, reasons }` (rather than a bare boolean) lets the later workflow surface *why* a release was blocked and lets tests assert specific reasons, not just the boolean. Naming the outcomes ALLOW/DENY keeps call sites and assertions readable.

**Placement.** The module lives in `src/core/ci/` (shippable source) because `pnpm lint` lints `src/` and later changes (the workflow gate step, eventually the real publish) call it as real code — unlike the first slice's parser, which is test-only under `test/ci/helpers`. Tests live under `test/ci/` so the existing phase proof command picks them up with no config change.

**Trade-offs.** Keeping the module a pure decision (inputs in, decision out) deliberately leaves signal-gathering to the workflow layer. That separation is the point: the risky, fiddly part — "is a release allowed?" — is isolated and proven here, so the YAML wiring in the next change is reduced to passing inputs and acting on a trustworthy answer.

## Tasks

- [x] 1.1 Add `src/core/ci/release-decision.ts` exporting a pure `decideRelease(input)` that returns an explicit `{ allowed: boolean; reasons: string[] }` decision (with named ALLOW/DENY outcomes/types).
- [x] 1.2 Model inputs as `{ branch: string; gates: Record<string, 'green' | 'red'> }` (or equivalent keyed signals), treating any missing/non-green value as not-green; keep the wired-gate set data-driven, not hardcoded branching.
- [x] 1.3 Implement the rule: ALLOW iff `branch === 'main'` AND every wired gate is green; otherwise DENY, accumulating a precise reason for the non-main branch and for each non-green gate.
- [x] 2.1 Add `test/ci/release-decision.test.ts` asserting: DENY on a non-main branch even when all gates are green (reason names the branch).
- [x] 2.2 Assert DENY on `main` when lint is red, DENY when test is red, and DENY reporting both reasons when both are red.
- [x] 2.3 Assert ALLOW only on a green `main` build (no denial reasons).
- [x] 2.4 Assert fail-closed DENY when a wired gate signal is missing/unknown, and that an additional wired gate (e.g. `coverage`) must also be green to ALLOW.
- [x] 3.1 Run `pnpm lint && pnpm vitest run test/ci` locally; confirm lint is clean and all `test/ci` tests pass (exit 0).
- [x] 3.2 Confirm this change does NOT modify `.github/workflows/ci.yml` and adds no publish step or agent-specific branching — workflow wiring and the dry-run publish belong to `gated-dry-run-publish`.
