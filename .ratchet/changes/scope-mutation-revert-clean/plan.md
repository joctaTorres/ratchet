# Scope mutation revert git clean to preserve runs dir

## Why

A follow-up review found the mutation harness's per-attempt revert
(`git reset --hard HEAD && git clean -fd` in `runMutationHarness`'s `finally`) is
unscoped. The working-tree precondition was just changed to exclude ratchet's own
transient run directory (`.ratchet/evals/runs`) from its dirtiness probe, but the
revert's blanket `git clean -fd` still deletes untracked files there. In a repo that
tracks `.ratchet/` but has not gitignored the runs dir, reverting a seeded mutant would
delete the in-progress run record — the same class of inconsistency the probe fix
addressed. This aligns the revert with the probe.

## What Changes

- The revert in `runMutationHarness` (`src/core/eval/mutation-harness.ts`) excludes
  ratchet's transient runs dir from the clean step:
  `git reset --hard HEAD && git clean -fd -e .ratchet/evals/runs`. The seeded mutant is
  still fully removed; only ratchet's own transient run records are preserved. Implements
  `features/mutation-invariant-harness/revert-preserves-runs-dir.feature`.

## Design

`git clean -fd` already skips gitignored files, so on the common path (a repo where
`ratchet init` gitignored the runs dir) nothing changes. Adding `-e .ratchet/evals/runs`
makes the exclusion hold regardless of whether the consuming repo gitignores the dir —
the same robustness stance the working-tree probe (`WORKING_TREE_PROBE`) already takes,
so the two now agree on which paths are ratchet-owned and off-limits. The pattern is a
ratchet path, not a toolchain literal, so it stays ecosystem-agnostic
(**generalizable-defaults**). Prefer a shared constant/derivation so the probe and the
clean cannot drift out of sync on the excluded path.

**Standards.** Follows **testing** (a unit test proving the revert removes the seeded
mutant but preserves an untracked path under `.ratchet/evals/runs`; keep the 95% floor)
and **documentation** (update `docs/eval-mutation-harness.md`'s revert description).
Not applicable: **generalizable-defaults** is satisfied by construction (ratchet path);
**multi-agent-support** and **delegated-lifecycle** (core logic only, no agent/lifecycle
surface).

## Tasks

- [x] 1.1 Change the revert command in `runMutationHarness` (`src/core/eval/mutation-harness.ts`) to `git reset --hard HEAD && git clean -fd -e .ratchet/evals/runs`; keep the exclusion path in sync with the probe (share a constant or derive it) so they cannot drift.
- [x] 1.2 Add/extend a unit test in `test/core/eval/mutation-harness.test.ts` asserting the revert issues the scoped clean (excludes `.ratchet/evals/runs`) so a run record there survives while the seeded mutant is removed.
- [x] 2.1 **Documentation (required, per the `documentation` standard).** Update `docs/eval-mutation-harness.md`'s revert/working-tree section to state the revert preserves ratchet's transient `.ratchet/evals/runs` records, matching the probe exclusion.
- [x] 3.1 Run the full suite (`pnpm vitest run`) and the coverage gate; ensure green at or above the enforced `COVERAGE_THRESHOLD`.
