---
title: Coverage gate
sidebar_position: 4
---

# Coverage gate

The coverage gate decides whether a build's measured line coverage meets an
enforced minimum. It reads the v8 `json-summary` produced by the coverage run,
compares `total.lines.pct` against the enforced threshold, and turns the verdict
into a `green`/`red` signal and a process exit code the CI coverage step acts on.

Defined in `src/core/ci/coverage-gate.ts`; invoked in CI as
`node dist/core/ci/coverage-gate.js`.

## Input

| Input | Source | Description |
|---|---|---|
| `total.lines.pct` | the json-summary file | The measured total line-coverage percentage (0–100) the gate judges. |

Only line coverage is gated. Branch coverage is not gated.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `COVERAGE_THRESHOLD` | `87` | The enforced minimum line-coverage percentage required for `green`. Overrides the built-in default when set to a finite number; a missing, empty, or non-numeric value falls back to the default of `87`. |
| `COVERAGE_SUMMARY` | `coverage/coverage-summary.json` | Path to the v8 `json-summary` reporter output the gate reads `total.lines.pct` from. |

The default of `87` is a ratchet point: it is raised as coverage is added and
never lowered, climbing toward the testing standard's 95% line-coverage target.

## Coverage scope

The coverage run measures the repository's application code. Three sources are
excluded from coverage in `vitest.config.ts` because they are not application
code: the vendored reference checkouts under `.agents/`, the terminal-animation
demo scripts under `scripts/` (run by hand, not part of the shipped CLI), and the
root tooling config `eslint.config.js`. The `website/` application code is
measured. This scope makes `total.lines.pct` reflect real application coverage,
so the enforced floor is judged against application code rather than non-app
sources.

## Signal and exit code

| Condition | Signal | Exit code |
|---|---|---|
| `total.lines.pct` is at or above the enforced threshold | `green` | `0` |
| `total.lines.pct` is below the enforced threshold | `red` | `1` |
| the summary file is missing, malformed, or lacks a numeric `total.lines.pct` | `red` (fail-closed) | `1` |

When `red`, the gate prints one reason per failing condition: the shortfall
(measured coverage vs. required threshold) or that the summary could not be read.
The `green`/`red` signal is the same `GateSignal` shape the release-decision
spine consumes.
