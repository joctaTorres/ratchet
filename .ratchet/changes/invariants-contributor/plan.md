# invariants-contributor

## Why

The eval gate now has a fail-closed manifest loader (`loadInvariantManifest`) and
a per-invariant evaluator (`evaluateInvariant` / `isInvariantViolation`), but the
`invariants` contributor in `aggregate.ts` is still the neutral placeholder that
always passes — so a checked-in `.ratchet/evals/invariants.yaml` is loaded and
evaluable yet never actually gates a run. This change makes the contributor real:
the manifest's **active** invariants are evaluated run-level and reduced to one
pass/fail outcome inside the single verdict-aggregation seam, closing the
vacuous-pass hole the invariant set exists to close.

## What Changes

This is the contributor-wiring vertical slice of the invariant set. It implements
`features/eval-invariants/contributor.feature`:

- Add an async run-level gate `evaluateInvariantGate({ projectRoot, run, baseline,
  bash?, readFile? })` (in a new `src/core/eval/invariant-gate.ts`) that loads the
  manifest, evaluates **only the `active` invariants** via `evaluateInvariant`,
  and returns `{ outcomes, failing, loadError? }` — `failing` is the ids of every
  invariant `isInvariantViolation` flags (both `fail` and `unevaluable`). Inert
  (`active: false`) invariants are skipped and never counted. The loader is
  wrapped **fail-closed**: an `InvariantManifestError` (malformed/invalid
  manifest) returns a `loadError` and a non-empty `failing` so the run cannot pass
  on an empty set; an **absent** manifest yields no active invariants and the
  contributor passes (nothing declared).
- Turn the neutral `invariantsContributor` in `src/core/eval/aggregate.ts` into a
  real but still **pure, synchronous** contributor: add an optional
  `invariants?: InvariantGateResult` field to `ContributorContext`, and have the
  contributor report `fail` with the precomputed violating ids as `failing` (and
  `pass` when absent/empty). The async command-running work stays out of the
  aggregation core — exactly as `regression` reads the precomputed
  `diff.regressions`, `invariants` reads the precomputed gate result.
- Thread the gate through the single run-level seam: make `buildReport`
  **async**, and when the `invariants` contributor is in the enabled set
  (`run.gate`) compute the gate result via `evaluateInvariantGate` (passing the
  already-loaded baseline run) and feed it into `aggregateRun`. Expose the
  per-invariant breakdown on `EvalReport` as `invariants: InvariantOutcome[]` (and
  the `loadError`) for rendering. When the contributor is disabled, the gate is
  **not evaluated** (no manifest commands run).
- Surface a violated invariant **first, as a sibling to regression**: in
  `src/commands/eval/run.ts` render the run-level gate violations (invariants,
  then regression) ahead of the per-case failures, naming the violated/unevaluable
  invariants and the load error when present.
- Add the `--no-invariants` toggle: extend `GateFlags` in `src/core/eval/gate.ts`
  with `invariants?: boolean` (clears `invariants` when `false`), add
  `--no-invariants` to the `eval run` command in `src/cli/index.ts`, and thread
  it through `src/commands/eval/run.ts` + `src/commands/eval/shared.ts`. The
  `eval.gate.invariants` config key already works through the existing generic
  config loop in `resolveGate`.
- **Non-goal (downstream `init-default-manifest` change):** `ratchet init`
  writing a default `.ratchet/evals/invariants.yaml` (with `spec-not-weakened`
  active and `tests-still-exist` / `public-api-unchanged` inert). Every
  predecessor slice names that as the separate init change; this slice only wires
  the contributor over whatever manifest exists.
- **Non-goal:** wiring eval into the batch engine's agent-driven change-step.
  Batch `verify` surfaces an eval verdict through the same `buildReport` seam this
  slice gates; no new batch-engine eval path is introduced.

## Design

**One run-level seam, contributor reads a precomputed result.** `buildReport`
(`src/core/eval/report.ts`) is the single place a run's verdict is aggregated —
both the `eval run` and `eval report` commands route through it, and a batch
`verify` that surfaces an eval verdict consumes the same report. So the
contributor is wired there and only there. The aggregation core must stay a pure,
synchronous, I/O-free function (it is documented as such and unit-tested at the
bottom of the pyramid), but evaluating an invariant runs `check.run` / `produce.run`
commands (async). The resolution mirrors the existing `regression` contributor:
`diffAgainstBaseline` precomputes `diff.regressions` upstream and the pure
contributor merely reads it. Likewise `evaluateInvariantGate` precomputes the
invariant outcomes upstream (in async `buildReport`) and the pure
`invariantsContributor` merely reads `ctx.invariants.failing`. The aggregation
seam (`aggregateRun`, the `Contributor` interface) is **not reshaped** —
`ContributorContext` gains one optional field, consistent with how the
extension point was designed.

**Active-only, inert-skipped, never vacuous.** `evaluateInvariantGate` filters to
`inv.active === true` before evaluating, so inert invariants are neither run nor
counted — a manifest of only inert invariants yields zero active invariants and
the contributor passes, but no inert invariant is recorded as a passing
invariant. This is the explicit anti-vacuous rule: an invariant only counts when
it is active and actually evaluated.

**Fail-closed at both layers.** The evaluator already returns `unevaluable` (a
violation via `isInvariantViolation`) for an active invariant it cannot check.
This slice adds the second fail-closed layer: the **manifest load** itself. An
`InvariantManifestError` is caught and converted to `{ failing: ['<manifest>'],
loadError: message }` so a present-but-broken manifest fails the contributor
rather than silently resolving to an empty (vacuous) pass. Only a genuinely
**absent** manifest yields a passing contributor — the documented loader contract
(absent ⇒ empty set, no error). The load error is modeled separately from
`InvariantOutcome` so no synthetic/fake `InvariantKind` is invented.

**Monotonic baseline reuse.** `buildReport` already loads the baseline run
(`loadBaselineRunId` + `safeLoad`) for the diff; the same baseline `EvalRun` is
passed into the gate as `InvariantEvalContext.baseline`, so the monotonic kind
compares against the baseline run's recorded measure with no new persistence or
schema change.

**Toggle.** `eval.gate.invariants` already flows through the generic config loop
in `resolveGate`; this slice only adds the CLI side — `GateFlags.invariants` and
the `--no-invariants` option (mirroring `--no-llm-judge` exactly, including
commander's `false`-only convention). When `invariants` is not in the enabled set
the gate is skipped in `buildReport` (no commands run) and, per the existing
`run.gate` filter, the contributor takes no part in the AND.

**Surfaced first as a sibling to regression.** `invariants` and `regression` are
the two run-level gates (the others are per-case). The render order in
`src/commands/eval/run.ts` lists the run-level violations first — invariants, then
regression — ahead of per-case failures, so a violated invariant is the first
thing surfaced, as a peer of a regression.

**`generalizable-defaults` compliance.** This slice introduces **no** command
string, package manager, test runner, build tool, or toolchain path into any
shipped default, config schema, or generated artifact. The contributor runs only
the user-authored `check.run` / `produce.run` commands already in the manifest;
the only built-in measure (`scenario-count`) is computed from run state with no
command. `--no-invariants` and the `invariants` id are ecosystem-neutral
vocabulary. The agent-neutral **default manifest** — the one place a toolchain
literal could leak — is explicitly the downstream `init-default-manifest`
change's concern, not this slice's.

**`multi-agent-support` compliance.** The wiring is tool-agnostic core logic
identical for every coding agent. `--no-invariants` and `eval.gate.invariants` are
a single shared CLI/config surface (not per-agent), the `invariants` contributor
names a gate not an agent, and this slice adds no agent-facing skill, command, or
template — so it renders identically for every agent in the registry with no
per-agent output to enumerate. (`delegated-lifecycle` is unaffected: this slice
changes no skill-delegated propose/apply/verify verb.)

**`documentation` compliance (mandatory, blocking).** The invariants gate is a
core anti-gaming component, so the documentation task is required:
- `docs/eval-invariants.md` (the Reference doc the loader/evaluator slices
  created) gains a section on the contributor — how the manifest's active
  invariants gate the run-level verdict, inert invariants skipped, fail-closed on
  an unevaluable invariant **and** on an unloadable manifest, surfaced first as a
  sibling to regression, and the `--no-invariants` / `eval.gate.invariants`
  toggle. Its `## Overview` Mermaid diagram is extended to show manifest → gate →
  `invariants` contributor → AND core, kept **vertical** (`flowchart TD`),
  high-contrast with **every `classDef` setting `color:`**, and semantic Unicode
  node labels.
- `docs/eval-verdict-aggregation.md`: the `invariants` contributor is now real (no
  longer a neutral placeholder) — its overview diagram/prose is updated to show it
  as a run-level gate sibling to regression.
- `docs/commands/eval.md`: add `--no-invariants` to the `eval run` flag table.
- `docs/configuration/config-yaml.md`: note `eval.gate.invariants` under the
  `eval` section.
- `README.md`: update where it describes the `eval run` surface and the invariant
  manifest — invariants now gate `eval run`, and `--no-invariants` disables them.

**`testing` compliance.** Tests land at the correct pyramid layer, name their
`.feature` in the header, isolate fs with the `fs.mkdtemp(os.tmpdir())` fixture
pattern, and keep the suite + coverage gate green at or above the enforced
`COVERAGE_THRESHOLD` (95% floor):
- **Unit** — `invariant-gate.ts` (active-only filter, inert skipped, violation
  ids collected, unevaluable counted as violation, manifest `loadError` ⇒
  fail-closed, absent ⇒ pass) with injected `bash`/`readFile`, no real spawn; the
  pure `invariantsContributor` in `aggregate.test.ts` (reads precomputed result,
  fail on violations, pass when absent/empty, identity to the AND); `gate.ts`
  `--no-invariants` and `eval.gate.invariants` resolution.
- **Integration** — `buildReport` over a tmpdir fixture: an active invariant gates
  the verdict run-level, an inert one is skipped, an unevaluable active invariant
  and an unloadable manifest both fail the run closed, and a disabled contributor
  skips evaluation entirely; the breakdown is exposed on `EvalReport`.
- **E2E** (`test/cli-e2e/eval.test.ts`) — on the built CLI, `ratchet eval run`
  with an active violated invariant fails the run and surfaces the invariant
  violation first (sibling to regression), and `ratchet eval run --no-invariants`
  disables it. The proof-of-work `pnpm vitest run invariant` stays green.

## Tasks

- [x] 1.1 Add `src/core/eval/invariant-gate.ts`: `InvariantGateResult`
  (`outcomes: InvariantOutcome[]`, `failing: string[]`, `loadError?: string`) and
  `evaluateInvariantGate({ projectRoot, run, baseline, bash?, readFile? })` —
  load the manifest fail-closed (catch `InvariantManifestError` ⇒
  `failing: ['<manifest>'] + loadError`), evaluate only `active` invariants via
  `evaluateInvariant`, collect `isInvariantViolation` ids into `failing`. Export
  it from `src/core/eval/index.ts`.
- [x] 1.2 Unit-test `invariant-gate.ts` (`test/core/eval/invariant-gate.test.ts`,
  header names `features/eval-invariants/contributor.feature`): active invariant
  pass/violation, inert skipped and never counted, unevaluable counted as a
  violation, malformed-manifest `loadError` ⇒ fail-closed, absent manifest ⇒ no
  failing — injected `bash`/`readFile`, tmpdir fixture for golden cases, no real
  spawn.
- [x] 2.1 In `src/core/eval/aggregate.ts`: add optional
  `invariants?: InvariantGateResult` to `ContributorContext`; replace the neutral
  `invariantsContributor` with a pure contributor returning
  `outcome('invariants', ctx.invariants?.failing ?? [])`. Keep `aggregateRun` and
  the `Contributor` interface unchanged.
- [x] 2.2 Extend `test/core/eval/aggregate.test.ts`: the `invariants` contributor
  fails on a precomputed violation, passes when the gate result is absent/empty,
  is identity to the AND when passing, and fails the overall AND when it fails.
- [x] 3.1 Make `buildReport` async in `src/core/eval/report.ts`: when the
  `invariants` contributor is enabled (`run.gate`), `await evaluateInvariantGate`
  with the already-loaded baseline and pass the result into `aggregateRun`; add
  `invariants: InvariantOutcome[]` (and `loadError`) to `EvalReport`. Skip the
  gate when the contributor is disabled. Update the export site.
- [x] 3.2 Update `buildReport` callers to await: `src/commands/eval/run.ts`,
  `src/commands/eval/report.ts`, and `test/core/eval/report.test.ts`. Extend
  `report.test.ts` (integration, tmpdir fixture): active invariant gates the
  verdict, inert skipped, unevaluable active invariant and unloadable manifest
  both fail closed, disabled contributor skips evaluation, breakdown present on
  the report.
- [x] 4.1 Add the `--no-invariants` toggle: `GateFlags.invariants?: boolean` and
  the `flags.invariants === false ⇒ enabled.delete('invariants')` branch in
  `src/core/eval/gate.ts`; the `--no-invariants` option on `eval run` in
  `src/cli/index.ts`; thread `invariants` through `RunFlags` in
  `src/commands/eval/run.ts` and the flags passed by `src/commands/eval/shared.ts`.
  Extend `test/core/eval/gate.test.ts` (`--no-invariants`, `eval.gate.invariants`
  false) and `test/commands/eval/shared.test.ts`.
- [x] 4.2 Render run-level gate violations first in `src/commands/eval/run.ts`:
  surface the invariants violation (named, with `loadError` when present), then
  regression, ahead of per-case failures (text + `--json`). Update
  `test/commands/eval/run.test.ts`.
- [x] 4.3 E2E (`test/cli-e2e/eval.test.ts`, built CLI): `ratchet eval run` with an
  active violated invariant fails the run and surfaces the invariant violation
  first as a sibling to regression; `ratchet eval run --no-invariants` disables
  the contributor.
- [x] 5.1 **[documentation standard — mandatory, blocking]** Update
  `docs/eval-invariants.md` (contributor section + extend the `## Overview`
  vertical `flowchart TD` Mermaid diagram: manifest → gate → invariants
  contributor → AND core, high-contrast, every `classDef` sets `color:`, semantic
  Unicode labels), `docs/eval-verdict-aggregation.md` (invariants now a real
  run-level gate sibling to regression), `docs/commands/eval.md` (`--no-invariants`
  flag), `docs/configuration/config-yaml.md` (`eval.gate.invariants`), and
  `README.md` (invariants gate `eval run`; `--no-invariants`). Cross-check no
  toolchain literal leaks (`generalizable-defaults`).
- [x] 6.1 Run `pnpm build && pnpm vitest run invariant` and the full suite +
  coverage gate; confirm green at or above the enforced `COVERAGE_THRESHOLD` (95%
  floor).
