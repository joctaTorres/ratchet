# eval-system

## Why

Ratchet's `.feature` files are the project's behavioral contract, but nothing
turns them into a repeatable, scored evaluation. The first cut of this change had
the driving agent read the *live* working tree and form a judgment per scenario —
non-reproducible and entangled with whatever the repo happens to look like today.
Instead, eval cases should run against a **pre-determined fixture codebase** and be
judged by a **fixed backend**, so a verdict is reproducible and a scenario that
once passed can never silently regress. The judging backend already exists — the
bundled batch engine — so we reuse it rather than inventing scoring logic.

## What Changes

- New `ratchet eval` command family (open CLI, deterministic plumbing):
  - `ratchet eval set [scope] [--json]` — enumerate eval cases (one per Scenario)
    from `.ratchet/features/**/*.feature` by default; `--changes` / `--change <name>`
    / `--path <dir-or-file>` adjust scope; archive always excluded. Reports each
    case's binding status. (`features/eval-set/eval-set.feature`)
  - `ratchet eval run [scope] [--judge auto|check|agent] [--json]` — snapshot the
    in-scope set, judge every **bound** case through the engine, persist the run
    under `.ratchet/evals/runs/`, and print the scorecard. Unbound cases record
    `unjudged`. (`features/eval-runs/run-and-score.feature`,
    `features/eval-judge/engine-backed-judge.feature`)
  - `ratchet eval record --run <id> --case <id> --verdict <pass|fail|unjudged>
    [--evidence <text>]` — manual override for a case (e.g. one with no fixture);
    `fail` requires evidence; marked as manually recorded.
    (`features/eval-runs/run-and-score.feature`)
  - `ratchet eval report --run <id> [--json]` — scorecard (pass/fail/unjudged),
    failing cases with evidence, baseline diff flagging regressions plus
    new/retired cases. (`features/eval-scorecard/scorecard-and-baseline.feature`)
  - `ratchet eval baseline <run-id>` — promote a run to baseline
    (`.ratchet/evals/baseline.json`). (`features/eval-scorecard/scorecard-and-baseline.feature`)
- New **eval-spec binding layer**: authored YAML under `.ratchet/evals/specs/`
  maps a case id → `{ fixture, kind, check|success, setup?, agentVotes? }`;
  fixtures are checked-in codebases under `.ratchet/evals/fixtures/<name>/` with an
  optional one-time `setup`. Cases without a binding are `unjudged`, never passed.
  (`features/eval-spec/binding.feature`)
- New `/rct:eval` skill generated for **every** supported agent from one shared
  template: run the engine-backed eval, present the report, and guide authoring
  bindings for unjudged cases — it does **not** judge by reading the live repo.
  (`features/eval-skill/eval-skill.feature`)

## Design

**The judge is the batch engine, run against fixtures.** `src/core/batch/engine/`
already exports the two seams we need (`engine/index.ts`):

- **`check` kind** → `evaluatePassCondition` + `realBashRunner` (`proof-of-work.ts`):
  run the binding's bash command in the fixture cwd, decide pass/fail via
  `exit-zero` / `contains:<text>` / `regex:<pattern>` / substring. Deterministic,
  no agent.
- **`agent` kind** → `resolveAdapter` + `realSpawner` (`agent.ts`): spawn a fresh
  coding-agent subprocess (claude/codex/gemini/cursor) in the fixture cwd with
  judge instructions built from the scenario's steps + the binding's `success`
  criteria, and capture a `{pass, reason}` verdict (the `LlmJudge`/`JudgeVerdict`
  shape). Fresh process per case = context hygiene, same as the engine's per-step
  spawn.

The eval runner reuses these seams directly (it does **not** call
`RatchetBatchEngine.runStep`, which drives the batch DAG — eval just loops over
cases). All seams are injectable (`BashRunner`/`Spawner`/`LlmJudge`) so tests
never shell out or spawn a real agent.

**Judge mode is configurable per the user's call.** `--judge auto` (default) judges
each case by the kind its binding declares; `--judge check` runs only deterministic
checks (agent-only cases fall to `unjudged`); `--judge agent` forces the spawned-
agent judge where a fixture + success criteria exist. An optional `eval:` section in
`.ratchet/config.yaml` sets the default mode; for this repo's declarative scenarios
the bound kind is `agent`, so `auto` judges them by spawned agent — against a
fixture, never the live tree.

**Fixtures run isolated, and bootstrap once.** Before judging, the runner
materializes the fixture into a throwaway temp working copy and points the
bash/agent cwd there, so a check or agent may freely build/run/mutate without
dirtying the checked-in fixture or the host repo. No judgment ever uses the live
working tree as its codebase. Fixtures are expected to be **small and
self-contained** (no per-case install). When a fixture genuinely needs
bootstrapping (e.g. `pnpm install`, a build), its binding declares an optional
`setup` command that runs **once** into a cached working copy keyed by fixture +
setup; every case bound to that fixture reuses the cached copy instead of
re-bootstrapping. This keeps serial runs (a stated non-goal to parallelize) from
being dominated by repeated install cost.

**The agent judge is guarded against flakiness.** The spawned-agent path is the
one place reproducibility can leak, so it is constrained: the judge is instructed
to **fail closed on uncertainty** (no concrete evidence ⇒ not a pass), and a case
may be judged by **N-of-M repeat votes** (`agentVotes`, default 1; majority wins).
When the votes do not agree (a flaky verdict), the case is recorded as `unjudged`
with the disagreement noted — never silently `fail` — so judge noise can never
manufacture a baseline regression. Deterministic `check` cases need none of this
and stay the preferred kind.

**Cases enumerate from `.feature`; bindings say how to judge.** Enumeration reuses
`GherkinParser` (`src/core/parsers/gherkin-parser.ts`) — one case per Scenario.
Case id is `<relative-feature-path-sans-ext>#<scenario-slug>` (posix, ordinal
suffix on duplicate names) — stable across runs, which is what baseline diffing
keys on. Renamed scenarios surface as retired + new (accepted trade-off).

**Run persistence is one JSON file per run** at `.ratchet/evals/runs/<run-id>.json`
(run id: UTC timestamp + short suffix, batch-journal style). It embeds the case
snapshot (id, feature, scenario, source path, steps, binding ref) and a verdict map
(`verdict`, `evidence`/`reason`, `source: judged|manual`). `eval record` does an
atomic read-modify-write. `baseline.json` holds `{ runId }`.

**Diff semantics.** Regression = `pass` in baseline AND `fail` in current run.
Current-only cases are "new"; baseline-only are "retired"; neither counts as a
regression. `unjudged` cases keep a run incomplete and never count as a pass. The
report's overall verdict fails while any regression or fail exists.

**Module layout.**
- `src/core/eval/`: `case-id.ts`, `set.ts` (discover + parse → `EvalCase[]`),
  `spec.ts` (load/validate/resolve eval-spec bindings), `fixture.ts` (materialize +
  cached one-time `setup`), `judge.ts` (drive the engine seams per case, fail-closed
  + vote), `run.ts` (snapshot/persist/record), `report.ts` (scorecard + baseline
  diff), `index.ts`.
- `src/commands/eval/`: `set.ts`, `run.ts`, `record.ts`, `report.ts`,
  `baseline.ts`, `index.ts`; registered in `src/cli/index.ts` as the `eval` group,
  following `src/commands/batch/` conventions (the repo's CC ≤ 15 gate applies).

**Multi-agent surface (per the multi-agent-support standard).** Skill body authored
once in `src/core/templates/workflows/eval.ts` (pattern: `verify-change.ts`), wired
through `src/core/shared/skill-generation.ts`, `src/core/templates/skill-templates.ts`,
`src/core/shared/tool-detection.ts`, rendered per agent by the adapter registry:
- Claude Code: `.claude/skills/rct-eval/SKILL.md`
- Codex: `.codex/skills/rct-eval/SKILL.md`
- Cursor: `.cursor/skills/rct-eval/SKILL.md`
- GitHub Copilot: `.github/skills/rct-eval/SKILL.md`
- OpenCode: `.opencode/skills/rct-eval/SKILL.md`
Body is agent-neutral ("your agent", plain-prose fallbacks); it orchestrates
`ratchet eval run`/`report` and guides binding authoring — judging belongs to the
engine, not the driving agent.

**Non-goals (this slice).** No parallel case execution, no LLM-judge automation
beyond the engine seam, no CI wiring, no reuse of the batch DAG/host loop. The CLI
stays agent-agnostic plumbing.

## Tasks

- [x] 1.1 Add `src/core/eval/case-id.ts` — slug + ordinal-suffix case-id scheme with unit tests (`test/core/eval/case-id.test.ts`)
- [x] 1.2 Add `src/core/eval/set.ts` — discover `.feature` files for a scope (store default, `--changes`, `--change`, `--path`; archive excluded), parse with `GherkinParser`, emit `EvalCase[]`; unit tests (`test/core/eval/set.test.ts`)
- [x] 2.1 Add `src/core/eval/spec.ts` — load + schema-validate eval-specs from `.ratchet/evals/specs/` (multiple case bindings per file), resolve bindings (`fixture`, `kind`, `check`|`success`, optional `setup`, `agentVotes`) by case id, fixtures under `.ratchet/evals/fixtures/`; unbound → unjudged; unit tests (`test/core/eval/spec.test.ts`)
- [x] 2.2 Add `src/core/eval/fixture.ts` — materialize a fixture into a temp working copy; run an optional `setup` command **once** into a copy cached by fixture+setup and reuse it across cases; unit tests with a fake runner (`test/core/eval/fixture.test.ts`)
- [x] 2.3 Add `src/core/eval/judge.ts` — judge a case via the engine seams: `check` → `evaluatePassCondition` + `realBashRunner`; `agent` → `resolveAdapter` + `realSpawner` with built judge instructions, **fail-closed on uncertainty** and **N-of-M `agentVotes`** (disagreement → `unjudged`, never `fail`); run in the fixture working copy as cwd; honor `--judge auto|check|agent`. Inject seams; unit tests with fake `BashRunner`/`Spawner` (`test/core/eval/judge.test.ts`)
- [x] 3.1 Add `src/core/eval/run.ts` — run-id, snapshot/persist under `.ratchet/evals/runs/`, manual `record` with validation (unknown case, bad verdict, fail-requires-evidence, source marking); unit tests (`test/core/eval/run.test.ts`)
- [x] 3.2 Add `src/core/eval/report.ts` — scorecard counts (pass/fail/unjudged), failing-case listing, baseline load/promote, regression/new/retired diff; unit tests (`test/core/eval/report.test.ts`)
- [x] 4.1 Add `src/commands/eval/` subcommands (`set`, `run`, `record`, `report`, `baseline`) with `--json` shapes and `--judge`/scope flags; register the `eval` group in `src/cli/index.ts`
- [x] 4.2 Export the eval core from `src/core/index.ts`; add the optional `eval:` default-mode config to `src/core/project-config.ts`
- [x] 5.1 Add `src/core/templates/workflows/eval.ts` — shared `/rct:eval` skill + command (run engine-backed eval, present report, author bindings for unjudged cases, surface regressions first)
- [x] 5.2 Wire the template into `src/core/shared/skill-generation.ts`, `src/core/templates/skill-templates.ts`, `src/core/shared/tool-detection.ts` so `ratchet init`/refresh renders `rct-eval` for every registered agent; extend `test/core/shared/skill-generation.test.ts` to assert output for all agents
- [x] 6.1 Add `test/cli-e2e/eval.test.ts` — fixture project + an eval-spec with a `check` and an `agent` binding (agent seam faked): `eval set` scoping, `eval run --judge` modes, one-time fixture `setup` reuse, agent fail-closed + vote-disagreement → `unjudged`, `record` override + rejection paths, `report`, `baseline` promote + regression flagged on a second run
- [x] 6.2 Run `pnpm build`, `pnpm test`, `pnpm lint`, `tsc --noEmit`; document the eval workflow + eval-spec/fixture authoring in README
