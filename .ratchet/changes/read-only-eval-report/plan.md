# read-only-eval-report

## Why

`buildReport(projectRoot, runId)` (`src/core/eval/report.ts`) is called by BOTH
`eval run` and the read-only `eval report` verb, and it calls
`evaluateInvariantGate(...)` on every call. So `eval report` re-evaluates the
whole invariant gate: it re-runs deterministic invariant `check.run` commands
and, for an active `mutation` invariant on a cache miss, spawns a coding agent
and `git reset --hard` / `git clean -fd`s the working tree through the mutation
harness. A reporting command must never evaluate, spawn, or mutate. This change
splits the two responsibilities so the gate is evaluated at run time only and the
report renders purely from persisted state.

## What Changes

This implements `features/eval-report/read-only-report.feature`.

- **Persist the gate result on the run.** Extend `EvalRun`
  (`src/core/eval/run.ts`) with an optional `invariantGate?: InvariantGateResult`
  field — the full run-level gate result: the per-invariant `InvariantOutcome[]`
  (`outcomes`), the violating ids (`failing`), and any `loadError`. Today only
  per-mutation `outcome.json` evidence is persisted; this persists the reduced
  gate verdict onto the run record itself.
- **`evaluateRun` (run path, replaces `buildReport`).** Used by `eval run`.
  Evaluates the invariant gate WITH the spawner (`evaluateInvariantGate`, deps
  injectable), persists the full gate result onto the run via `persistRun`, and
  assembles the `EvalReport`. Preserves `eval run` behavior exactly — it still
  evaluates, gates, and persists the mutation harness/spawner evidence and
  `outcome.json`.
- **`renderReport` (report path, PURE).** Used by `eval report`. Reads the run
  and its **persisted** `invariantGate` and computes scorecard/diff/aggregate
  from persisted data. Takes no spawner, never calls `evaluateInvariantGate`,
  never spawns, never runs shell, never touches the tree. Synchronous.
- **"Not evaluated" state.** When a run carries no persisted `invariantGate`
  (invariants were disabled for the run, or the run predates this change),
  `renderReport` renders those invariants as a neutral **"not evaluated"** state
  via a new `EvalReport.invariantsEvaluated: boolean` discriminator — NOT
  `unevaluable`, NOT a re-eval, NOT a failure. The invariants contributor, if
  present in the AND, reads no violating ids and stays neutral (pass), so the
  state does not affect the pass/fail gate.
- **Callers.** `src/commands/eval/run.ts` calls `evaluateRun`;
  `src/commands/eval/report.ts` calls the synchronous `renderReport` and surfaces
  the neutral "not evaluated" line for an unevaluated run.
- **Out of scope (separate follow-ups, do NOT touch):** the `web` URL readiness
  probe and the unguarded cache `JSON.parse` findings. The mutation-harness logic
  and `evaluateInvariantGate` semantics are unchanged — only WHERE they run
  (run-time only) and that the result is persisted/read.

## Design

**One evaluation seam moved from "both verbs" to "the run verb only".** The
run-level invariant gate is the only async, spawning, tree-touching work in the
report pipeline. Today `buildReport` performs it, and both `eval run` and `eval
report` call `buildReport` — so a read-only verb inherits a mutating side effect.
The fix is to evaluate the gate once, at run time, and persist its reduced result
(`InvariantGateResult` — already the exact shape the pure `invariantsContributor`
reads) onto the run, exactly as `diffAgainstBaseline` precomputes
`diff.regressions` for the pure `regression` contributor. The report path then
reads the persisted gate and feeds it into the same synchronous `aggregateRun`,
so a run-then-report shows the identical verdict a run showed alone.

**`evaluateRun` vs `renderReport`.** The two functions share a pure
`assembleReport(run, runId, diff, gate, invariantsEvaluated)` helper that builds
the `EvalReport` from already-resolved inputs (scorecard, failing/unjudged cases,
case details, aggregation over `run.gate`). `evaluateRun` is async: it evaluates
the gate (when the `invariants` contributor is in `run.gate`) with injectable
`bash`/`readFile`/`spawner`/`agentName` deps, persists `run.invariantGate`, and
assembles with `invariantsEvaluated = true`. `renderReport` is synchronous: it
reads `run.invariantGate` and assembles with
`invariantsEvaluated = run.invariantGate !== undefined` — it imports no spawner,
constructs no `InvariantEvalContext`, and calls no gate, so it cannot spawn or
mutate by construction.

**"Not evaluated" is a first-class, gate-neutral state — distinct from an empty
pass.** A run with invariants enabled but no declared manifest persists an empty
gate `{ outcomes: [], failing: [] }` — that is *evaluated, nothing to check*
(`invariantsEvaluated = true`, contributor passes). A run whose gate was never
persisted (disabled, or legacy) is *not evaluated* (`invariantsEvaluated =
false`). The persisted-gate presence is the discriminator, so the two are never
conflated. In both cases the invariants contributor reads no violating ids and
stays neutral, so "not evaluated" never fails a gate and never blocks a run — and
because `renderReport` never loads the manifest, a legacy run with a *malformed*
manifest present renders "not evaluated" and does not crash or report a load
error.

**`generalizable-defaults` compliance.** This change introduces no command
string, package manager, test runner, build tool, or toolchain path into any
shipped default, config schema, or generated artifact. It only moves WHERE the
already-user-authored gate commands run (run-time only) and adds a persisted
field plus a boolean discriminator — all ecosystem-neutral. The persisted
`invariantGate` shape reuses the existing neutral `InvariantGateResult`.

**`multi-agent-support` compliance.** The split is tool-agnostic core logic
identical for every coding agent: it changes no agent-facing skill, command, or
template, adds no per-agent surface, and renders identically for every agent in
the registry. `delegated-lifecycle` is unaffected — no skill-delegated
propose/apply/verify verb changes; only the `eval run`/`eval report` command
internals move.

**`documentation` compliance (mandatory, blocking).** `eval report` is a
user-facing command whose behavior changes (it becomes read-only), so the
documentation task is required:
- `docs/commands/eval.md`: state under `eval report` **Behavior** that it is
  read-only — it renders purely from the run's persisted state, never
  re-evaluating the invariant gate (no check command re-run, no agent spawn, no
  tree mutation); the gate is evaluated only by `eval run`, whose result is
  persisted on the run; a run with no persisted gate (invariants disabled or a
  legacy run) reports its invariants as "not evaluated". Note the same split
  under `eval run` (it persists the gate result). Update the `eval report`
  **Overview** Mermaid diagram (kept vertical `flowchart TD`, high-contrast, every
  `classDef` sets `color:`, semantic Unicode labels) to show `eval report`
  reading the persisted gate rather than evaluating it.
- `docs/eval-invariants.md` / `docs/eval-verdict-aggregation.md`: where they state
  the gate is evaluated inside the single report seam, update to say the gate is
  evaluated at run time (`evaluateRun`) and persisted, and the report path
  (`renderReport`) reads the persisted result; note the "not evaluated" state.
- `README.md`: update where it describes `eval report` so it does not describe the
  now-stale "report re-evaluates" behavior — report is read-only.

**`testing` compliance.** Tests land at the correct pyramid layer, name their
`.feature` in the header, isolate fs with the `mkdtemp(tmpdir())` fixture pattern
already used in `report.test.ts`, inject `bash`/`spawner` fakes (no real spawn),
and keep the full suite + coverage gate green at or above the enforced
`COVERAGE_THRESHOLD` (95% floor):
- **Integration** (`test/core/eval/report.test.ts`) — repoint the existing
  gate/scorecard/diff assertions from `buildReport` to `evaluateRun` (same
  semantics + persistence). Add: (a) `renderReport` on a run with an active
  mutation invariant + an injected counting fake spawner is called **zero** times
  and leaves an untracked sentinel file intact (no `git clean -fd`), rendering
  "not evaluated"; (b) `evaluateRun` with a counting fake spawner on a surviving
  mutant fails the gate and persists it, then `renderReport` reads it to the
  **same** verdict with the spawner counter **unchanged** (zero re-spawn) and the
  same per-invariant breakdown; (c) a run whose gate excludes `invariants`
  renders "not evaluated" and takes no part in the AND; (d) a legacy run with the
  gate including `invariants` but no persisted `invariantGate` and a malformed
  manifest present renders "not evaluated" without loading the manifest, without a
  load error, and without crashing.
- **Command** (`test/commands/eval/report.test.ts`) — the `eval report` verb
  renders a run with no persisted gate as "not evaluated" in text/JSON and never
  throws.
- **E2E** (`test/cli-e2e/eval.test.ts`, built CLI) — an active deterministic
  invariant whose `check.run` increments an on-disk counter runs once under `eval
  run` and the counter does NOT advance when `eval report` is invoked afterward,
  proving the report path re-runs no check command.

## Tasks

- [ ] 1.1 Persist the gate on the run: add optional
  `invariantGate?: InvariantGateResult` to `EvalRun` in `src/core/eval/run.ts`
  (type-only import from `./invariant-gate.js`), documenting it as the run-time
  gate result absent on disabled/legacy runs.
- [ ] 2.1 In `src/core/eval/report.ts`: add `invariantsEvaluated: boolean` to
  `EvalReport`; extract a pure `assembleReport(run, runId, diff, gate,
  invariantsEvaluated)` helper; add async `evaluateRun(projectRoot, runId, deps?)`
  (evaluate the gate with injectable `bash`/`readFile`/`spawner`/`agentName` when
  the `invariants` contributor is enabled, persist `run.invariantGate`, assemble
  with `invariantsEvaluated = true`, else `false` and no persist); add synchronous
  `renderReport(projectRoot, runId)` (read `run.invariantGate`, assemble with
  `invariantsEvaluated = gate !== undefined`, no gate/spawner). Remove
  `buildReport`.
- [ ] 2.2 Update `src/core/eval/index.ts` to export `evaluateRun` / `renderReport`
  (and the deps type) in place of `buildReport`.
- [ ] 3.1 Update callers: `src/commands/eval/run.ts` calls `evaluateRun`;
  `src/commands/eval/report.ts` calls synchronous `renderReport`, renames its
  local console renderer to avoid the name clash, and prints a neutral
  "Invariants: not evaluated" line (text) with `invariantsEvaluated` surfaced in
  `--json` when the run carries no persisted gate.
- [ ] 4.1 Integration tests in `test/core/eval/report.test.ts`: repoint existing
  assertions to `evaluateRun`; add the no-spawn/no-mutate `renderReport` test
  (counting fake spawner asserted zero, untracked sentinel intact), the
  run-then-report parity + zero-re-spawn test, the disabled-invariants
  "not evaluated" test, and the legacy-run (no persisted gate, malformed manifest
  never loaded) "not evaluated" test.
- [ ] 4.2 Command test in `test/commands/eval/report.test.ts`: `eval report`
  renders a run with no persisted gate as "not evaluated" (text + JSON) and does
  not throw.
- [ ] 4.3 E2E in `test/cli-e2e/eval.test.ts`: an active deterministic invariant
  whose `check.run` increments an on-disk counter runs once under `eval run`; a
  subsequent `eval report` leaves the counter unchanged (report re-runs no check
  command).
- [ ] 5.1 **[documentation standard — mandatory, blocking]** Update
  `docs/commands/eval.md` (`eval report` is read-only — renders from persisted
  state, no re-eval/spawn/mutate; `eval run` persists the gate; "not evaluated"
  state; update the `eval report` vertical `flowchart TD` Overview diagram,
  high-contrast, every `classDef` sets `color:`, semantic Unicode labels),
  `docs/eval-invariants.md` and `docs/eval-verdict-aggregation.md` (gate evaluated
  at run time and persisted; report reads the persisted result; "not evaluated"),
  and `README.md` (`eval report` is read-only). Cross-check no toolchain literal
  leaks (`generalizable-defaults`).
- [ ] 6.1 Run `pnpm build`, `pnpm vitest run` (full suite), `pnpm lint`, and the
  coverage gate; confirm green at or above the enforced `COVERAGE_THRESHOLD`
  (95% floor).
