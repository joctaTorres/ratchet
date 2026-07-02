# Harden eval invariant harness

## Why

PR #41 review found three behavioral defects in the eval invariant harness: (1) the
mutation gate's working-tree precondition counts ratchet's own freshly-persisted run
record as a dirty tree, so every `mutation` invariant collapses to `unevaluable` in any
consuming repo that tracks `.ratchet/`; (2) the mutation seed/revert loop has no
`try/finally`, so a mid-attempt throw leaves a seeded fault applied in the user's real
working tree; (3) the web harness runs `npx playwright test` without `--no-install`, so
an eval on a machine lacking Playwright triggers a surprise network install instead of
failing fast. All three are correctness/safety regressions in code that mutates and runs
against the user's project root.

## What Changes

- The mutation harness working-tree precondition (`checkWorkingTree`,
  `src/core/eval/mutation-harness.ts`) excludes ratchet's own transient run directory
  from the cleanliness probe, so a persisted run record no longer blocks seeding while
  genuine user changes still do. Implements
  `features/mutation-invariant-harness/working-tree-precondition.feature`.
- The seed → stage → oracle → revert loop in `runMutationHarness` wraps its body in
  `try/finally` with the revert in `finally`, making "leave the working tree exactly as
  it started" hold even when the oracle or spawner throws. Implements
  `features/mutation-invariant-harness/seed-revert-safety.feature`.
- The web lifecycle harness Playwright invocation (`src/core/eval/web-lifecycle.ts`)
  passes `--no-install` to `npx`, matching the doctor probe so a missing Playwright
  fails fast instead of installing mid-run. Implements
  `features/web-lifecycle-harness/fail-fast-without-install.feature`.
- `ratchet init` ensures the project `.gitignore` ignores `.ratchet/evals/runs/`
  (idempotently), so transient run records never dirty the tree or the mutation gate in
  a fresh project. Implements `features/ratchet-init/gitignore-eval-runs.feature`.

## Design

**Precondition scoping (fix 1).** `checkWorkingTree` runs `git status --porcelain` at the
project root. Change the probe to `git status --porcelain -- . ':(exclude).ratchet/evals/runs'`
so ratchet's own transient writes are ignored while any other uncommitted path still marks
the tree unusable. This is the robust fix — it holds regardless of whether the consuming
repo gitignores the runs dir — and is what makes the flagship `mutation` invariant able to
evaluate in a repo that tracks `.ratchet/`. The `ratchet init` gitignore entry (below) is
complementary hygiene, not the sole guarantee.

**init gitignore (fix 1, complementary).** `src/core/init.ts` gains an idempotent step that
ensures the project `.gitignore` contains `.ratchet/evals/runs/`: create the file if absent,
append the entry only if not already present (no duplicate on re-init). Per
**generalizable-defaults**, `.ratchet/evals/runs/` is a ratchet-owned path, not a
package-manager/test-runner/toolchain assumption, so it is ecosystem-agnostic and safe to
ship into any consuming repo.

**Unconditional revert (fix 2).** Wrap the per-attempt body (`spawner` → `git add -A` →
`git diff --cached` → oracle) in `try`, with `git reset --hard HEAD && git clean -fd` in
`finally`. `continue` on an empty diff still runs `finally` (harmless no-op revert), and a
throw from oracle/spawner reverts before propagating. The harness contract docstring already
promises this; the code now matches it.

**npx --no-install (fix 3).** Add `--no-install` to the harness's `npx playwright test`
command string in `web-lifecycle.ts`. The doctor probe (`src/core/doctor/checks/playwright.ts`)
already uses it; this makes the two invocations consistent so behavior is uniform whether the
user runs `ratchet doctor` or an actual eval.

**Standards.** Follows **testing** (unit tests for the harness precondition/revert and the web
command string; integration test for `ratchet init` gitignore; a cli-e2e test proving a
`mutation` invariant evaluates inside a real git repo that tracks `.ratchet/`; keep the 95%
line-coverage floor), **documentation** (Reference docs + README updated in this change), and
**generalizable-defaults** (init default is a ratchet path, not a toolchain literal).
Not applicable: **multi-agent-support** (no agent-facing surface — core logic only) and
**delegated-lifecycle** (does not touch the batch engine / lifecycle verbs).

## Tasks

- [x] 1.1 Scope `checkWorkingTree` in `src/core/eval/mutation-harness.ts` to exclude `.ratchet/evals/runs` from the `git status --porcelain` cleanliness probe; keep the "unusable" path for any other uncommitted change.
- [x] 1.2 Add/extend unit tests in `test/core/eval/mutation-harness.test.ts`: a persisted run-record path is not counted dirty; a genuine change outside the runs dir still marks the tree unusable.
- [x] 2.1 Wrap the per-attempt seed/oracle body in `runMutationHarness` (`src/core/eval/mutation-harness.ts`) in `try/finally` with the revert in `finally`.
- [x] 2.2 Add a unit test proving a mid-attempt throw (oracle/spawner) reverts the working tree and re-propagates; keep the existing per-attempt revert assertions green.
- [x] 3.1 Add `--no-install` to the harness Playwright `npx` invocation in `src/core/eval/web-lifecycle.ts`.
- [x] 3.2 Update `test/core/eval/web-lifecycle.test.ts` expected command string(s) to include `--no-install`.
- [x] 4.1 Add an idempotent `.gitignore` step to `ratchet init` (`src/core/init.ts`) ensuring `.ratchet/evals/runs/` is ignored (create-if-absent, append-if-missing, no duplicate on re-init).
- [x] 4.2 Add an integration test for the init gitignore step: fresh project gets the entry; re-init does not duplicate it.
- [x] 5.1 Add a cli-e2e test in `test/cli-e2e/` that runs `eval run` with an active `mutation` invariant inside a real git repo tracking `.ratchet/`, asserting the mutation invariant evaluates (not `unevaluable`) despite the persisted run record.
- [x] 6.1 **Documentation (required, per the `documentation` standard).** Update `docs/eval-mutation-harness.md` (working-tree precondition now tolerates the transient runs dir; unconditional revert-in-`finally` contract), `docs/eval-web-lifecycle.md` (harness runs Playwright with `--no-install`), and the init Reference (`docs/commands/` init entry and/or `docs/configuration/generated-artifacts.md`) plus `README.md` "What `init` creates" for the new `.gitignore` entry. Keep any affected Mermaid diagram accurate.
- [x] 7.1 Run the full suite (`pnpm vitest run`) and the coverage gate; ensure green at or above the enforced `COVERAGE_THRESHOLD`.
