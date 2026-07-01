# configurable-contributor-gate

## Why

The verdict-aggregation core already decides an eval run's pass as a logical AND
over named contributors, but *which* contributors execute and gate is hard-wired
to the full set and selectable only through the narrow `--judge auto|deterministic|llm-judge`
flag. This change makes contributor selection first-class and configurable —
project config plus CLI overrides — generalizing `--judge`, and guarantees that
disabling a contributor leaves the run incomplete so a partial run can never be
promoted to the regression baseline.

## What Changes

- Add an `eval.gate` key to `.ratchet/config.yaml` that enables/disables each
  built-in contributor (`deterministic`, `llm-judge`, `invariants`, `regression`).
  Unset ⇒ every contributor enabled. Implements
  `features/eval-contributor-gate/gate-selection.feature`.
- Add a contributor-gate resolver `src/core/eval/gate.ts` that produces the
  enabled contributor set from `eval.gate` overlaid by CLI flags, with precedence
  default(all-enabled) ◁ config ◁ CLI.
- Add CLI selectors on `ratchet eval run`: `--gate <ids>` (set the enabled set
  explicitly), `--only <ids>` (restrict to the listed ids), and `--no-llm-judge`
  (disable the llm-judge contributor). Keep `--judge <mode>` as a **deprecated
  legacy alias** mapped onto the gate (`deterministic` ⇒ llm-judge off,
  `llm-judge` ⇒ deterministic off, `auto` ⇒ both on), so the old flag still works.
- Drive per-case execution from the enabled set: a bound case whose binding-kind
  contributor is **disabled** is recorded `unjudged` (reason names the disabled
  contributor) instead of being executed — so the run is **incomplete**.
  Implements `features/eval-contributor-gate/disabled-contributor-incompleteness.feature`.
- The aggregation core ANDs only over the **enabled** contributors: the enabled
  set is persisted on the run and `buildReport` filters the contributor list by
  it before calling `aggregateRun`. A disabled contributor takes no part in the
  AND.
- An incomplete run (any `unjudged` case, including those left by a disabled
  contributor) remains refused for baseline promotion through the core's existing
  completeness signal — leaving `baseline.json` untouched.
- Unknown contributor ids passed to `--only`/`--gate` are rejected with an error
  listing the valid ids.

## Design

**One gate resolver, contributor-shaped.** `src/core/eval/gate.ts` is a pure
function over in-memory inputs (config object + parsed flags) — no fs, no spawn —
so it unit-tests at the bottom of the pyramid (`testing` standard). Shape:

- `ALL_CONTRIBUTOR_IDS: ContributorId[]` reuses the `ContributorId` union already
  exported by `aggregate.ts` (`deterministic | llm-judge | invariants |
  regression`) — no new vocabulary, no duplication of the contributor set.
- `resolveGate({ config, flags }): Set<ContributorId>` computes the enabled set:
  start from all-enabled, apply `eval.gate` booleans, then apply CLI flags. CLI
  precedence within flags: `--gate` sets the set outright; `--only` intersects to
  the listed ids; `--no-llm-judge` clears `llm-judge`; legacy `--judge` maps to
  the equivalent kind toggle. Comma-separated id lists are parsed and validated
  against `ALL_CONTRIBUTOR_IDS`; an unknown id throws an `Error` naming the bad id
  and listing the valid ids (mirrors `resolveScope`/`resolveJudgeMode` error
  style).

**Config schema.** Extend `ProjectConfigSchema.eval` with
`gate: z.record(z.enum([...ALL_CONTRIBUTOR_IDS]), z.boolean()).partial().optional()`,
keeping the existing `judge` key for the legacy alias. `readProjectConfig`'s
resilient `eval` branch already `safeParse`s the whole `eval` object, so the new
key is validated field-by-field with the existing warning path; no new parsing
machinery is needed.

**Execution gating replaces the judge-mode skip.** `executeRun` receives the
enabled set. For each bound case, the relevant contributor is its
`bindingKind` (`deterministic`/`llm-judge`); when that contributor is **not** in
the enabled set the case is recorded `unjudged` with a reason naming the disabled
contributor (no fixture materialized, no judge spawned), otherwise it is judged by
its bound kind. This makes the gate the single decision point for which cases run;
`--judge` no longer skips cases directly — it is resolved into the gate upstream.
The `invariants`/`regression` contributors are run-level (not per-case), so
disabling them affects only the AND, not per-case execution.

**Persist the enabled set on the run.** `EvalRun` gains `gate: ContributorId[]`
(the enabled ids, in display order). `buildReport` reads `run.gate` and passes
`DEFAULT_CONTRIBUTORS.filter(c => run.gate.includes(c.id))` to `aggregateRun`, so
the report's AND and per-contributor breakdown reflect exactly the contributors
that gated the run, and a later `eval report` on the persisted run is consistent
with how it executed. Promotion is unchanged: it rejects on the core's
`complete === false`, which a disabled kind contributor triggers by leaving cases
`unjudged`.

**`generalizable-defaults` compliance.** The shipped default for `eval.gate` is
"all contributors enabled" expressed purely through ecosystem-neutral contributor
ids; no package manager, test runner, build tool, command string, or toolchain
path is introduced into the config schema, the resolver, or any generated
artifact. Contributor ids (`deterministic`, `llm-judge`, `invariants`,
`regression`) are tool-agnostic vocabulary and the gate behaves identically in any
consuming repo. No default command string crosses into user repos.

**`multi-agent-support` compliance.** Contributor selection is agnostic across
coding agents: the `llm-judge` contributor names a *tier*, never a specific agent,
and disabling it changes nothing about which agent would be spawned — the gate
operates on contributor ids only and resolves the agent through the existing
adapter seam unchanged.

**`documentation` compliance.** `eval.gate` and the new CLI flags are user-facing
surfaces, so the documentation task updates `docs/commands/eval.md` (the
`eval run` flag table), `docs/configuration/config-yaml.md` (the `eval` section,
adding the `gate` key), and `docs/eval-verdict-aggregation.md` — whose existing
vertical `flowchart TD` overview diagram is extended to show contributor
*selection* (config + CLI) feeding the enabled contributor set into the AND core,
kept high-contrast with every `classDef` setting `color:` and accurate to this
change. `README.md` is updated where it describes the `eval run` surface and the
`--judge` flag. The plan's documentation task is mandatory and references the
`documentation` standard.

**`testing` compliance.** Pure-logic unit tests for `gate.ts` (default all-on,
config disable, each CLI override, legacy `--judge` mapping, precedence, unknown-id
rejection) with no fs/spawn; integration tests over a tmpdir fixture for
`executeRun` recording disabled-kind cases `unjudged`, `buildReport` ANDing over
the enabled set, and `promoteBaseline` refusing the resulting incomplete run;
config-parse tests for the `eval.gate` key; and a thin E2E assertion that
`ratchet eval run --no-llm-judge` (and `--only`) on the built CLI leaves
llm-judge cases unjudged and the run incomplete. Tests name their `.feature` in
the header. The full suite and the coverage gate must stay green at or above the
enforced `COVERAGE_THRESHOLD` (95% floor).

## Tasks

- [x] 1.1 Add `src/core/eval/gate.ts`: `ALL_CONTRIBUTOR_IDS` (reusing
  `ContributorId` from `aggregate.ts`), a `GateFlags` type (`gate`, `only`,
  `llmJudge`, legacy `judge`), and `resolveGate({ config, flags })` returning the
  enabled `Set<ContributorId>` with precedence default ◁ config ◁ CLI, parsing
  comma-separated id lists and throwing on an unknown id with the valid ids
  listed. Export it from `src/core/eval/index.ts`.
- [x] 1.2 Unit-test `gate.ts` (`test/core/eval/gate.test.ts`, `.feature` named in
  the header): all-enabled default, `eval.gate` disabling a contributor, each CLI
  override (`--gate`, `--only`, `--no-llm-judge`), the legacy `--judge` mapping,
  CLI-over-config precedence, and unknown-id rejection — pure in-memory inputs.
- [x] 2.1 Extend `ProjectConfigSchema.eval` with the `gate` record (contributor
  id → boolean) in `src/core/project-config.ts`, keeping `judge`; cover the new
  key in `test/core/project-config*` parse tests (valid map kept, invalid map
  warned-and-dropped).
- [x] 3.1 Persist the enabled set on the run: add `gate: ContributorId[]` to
  `EvalRun` (`src/core/eval/run.ts`) and have `executeRun`
  (`src/core/eval/execute.ts`) accept the enabled set, record a disabled-kind
  case `unjudged` with a contributor-naming reason instead of judging it, and
  write the enabled ids onto the run.
- [x] 3.2 Route the report AND over the enabled set: `buildReport`
  (`src/core/eval/report.ts`) filters `DEFAULT_CONTRIBUTORS` by `run.gate` before
  calling `aggregateRun`, so the overall verdict and breakdown reflect only the
  enabled contributors.
- [x] 3.3 Update/extend integration tests (`test/core/eval/execute*`,
  `report.test.ts`, `run.test.ts`): a disabled kind contributor leaves its cases
  `unjudged` and the run incomplete, the AND runs over the enabled set only, and
  `promoteBaseline` refuses the incomplete run with the baseline untouched.
- [x] 4.1 Wire the CLI: in `src/commands/eval/shared.ts` replace/extend
  `resolveJudgeMode` with a gate resolver that reads `eval.gate` + flags via
  `resolveGate`; add `--gate <ids>`, `--only <ids>`, `--no-llm-judge`, and keep
  `--judge <mode>` (legacy alias) on the `eval run` command in
  `src/cli/index.ts`; pass the resolved enabled set into `evalRunCommand` →
  `executeRun`. Update `test/commands/eval/run.test.ts` and
  `test/commands/eval/shared.test.ts`.
- [x] 4.2 E2E (`test/cli-e2e/eval.test.ts`): driving the built CLI,
  `ratchet eval run --no-llm-judge` (and `--only deterministic`) records
  llm-judge cases `unjudged`, reports the run incomplete, and `--only not-a-contributor`
  fails with the valid ids listed.
- [x] 5.1 **[documentation standard]** Update `docs/commands/eval.md` (the
  `eval run` flag table with `--gate`/`--only`/`--no-llm-judge` and the legacy
  `--judge`), `docs/configuration/config-yaml.md` (the `eval` section, adding the
  `gate` key and its all-enabled default), and `docs/eval-verdict-aggregation.md`
  (extend the existing vertical `flowchart TD` overview to show config+CLI
  contributor selection feeding the enabled set into the AND core; high-contrast,
  every `classDef` sets `color:`). Update `README.md` where it describes
  `eval run`/`--judge`. Cross-check no toolchain literal leaks
  (`generalizable-defaults`).
- [x] 6.1 Run `pnpm build && pnpm vitest run eval` and the coverage gate; ensure
  the full suite is green at or above the enforced `COVERAGE_THRESHOLD` (95%
  floor).
