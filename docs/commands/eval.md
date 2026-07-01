---
title: ratchet eval
sidebar_position: 22
---

# `ratchet eval`

Turn `.feature` files into a scored, baseline-diffed regression suite. Judging
is delegated to the bundled batch engine seams run against checked-in fixture
working copies; the live repository is never read or mutated during judging.

## Overview

An eval turns behavioral `.feature` specifications into a graded, tracked
regression suite. Every Scenario becomes one **eval case**. A **binding** in
`.ratchet/evals/specs/` attaches a case to a checked-in **fixture** (a sample
codebase) and to a judging method — a `deterministic` command whose exit/output
decides pass, or an `llm-judge` agent that reads success criteria. Judging never
touches the working repository: each case is judged in a throwaway copy of its
fixture.

The five subcommands are one lifecycle. `eval set` lists the cases in scope and
whether each is bound. `eval run` judges every bound case, applies the run-level
gates (invariants and baseline regression), and persists the result as a **run**.
`eval record` manually overrides a single case's verdict in a stored run. `eval
report` prints a run's scorecard and its diff against the promoted baseline.
`eval baseline` promotes a complete run so later runs are diffed against it.

```mermaid
flowchart TD
    FEATURES[📄 .feature files<br/>.ratchet/features · changes]
    SPECS[📄 eval specs<br/>.ratchet/evals/specs · bindings]
    FIXTURES[💾 fixtures<br/>.ratchet/evals/fixtures]

    SET{{⚙️ eval set<br/>enumerate cases · binding status}}
    RUN{{⚙️ eval run<br/>judge bound cases · run-level gates}}
    RECORD{{✏️ eval record<br/>manual verdict override}}
    REPORT{{📊 eval report<br/>scorecard · baseline diff}}
    BASELINE{{🏁 eval baseline<br/>promote a complete run}}

    RUNSTORE[💾 runs<br/>.ratchet/evals/runs]
    BASESTORE[💾 baseline.json<br/>promoted run id]

    FEATURES --> SET
    SPECS --> SET

    FEATURES --> RUN
    SPECS --> RUN
    FIXTURES --> RUN
    RUN --> RUNSTORE

    RUNSTORE --> RECORD
    RECORD --> RUNSTORE

    RUNSTORE --> REPORT
    BASESTORE -. baseline .-> REPORT

    RUNSTORE --> BASELINE
    BASELINE --> BASESTORE

    classDef source  fill:#E6E6FA,stroke:#333,stroke-width:2px,color:darkblue
    classDef store   fill:#ADD8E6,stroke:#333,stroke-width:2px,color:darkblue
    classDef cmd     fill:#FFD700,stroke:#333,stroke-width:2px,color:black
    classDef promote fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen

    class FEATURES,SPECS source
    class FIXTURES,RUNSTORE,BASESTORE store
    class SET,RUN,RECORD,REPORT cmd
    class BASELINE promote
```

---

## `eval set`

Enumerate eval cases (one per Scenario) from `.feature` files and report each
case's binding status.

### Synopsis

```bash
ratchet eval set [--changes | --change <name> | --path <dir-or-file>] [--holdout | --no-holdout] [--json]
```

### Options

| Option | Argument | Description |
|---|---|---|
| `--changes` | | Include active changes alongside the feature store. |
| `--change` | `<name>` | Scope to a single active change. |
| `--path` | `<dir-or-file>` | Narrow to a capability directory or `.feature` file within the feature store. |
| `--holdout` | | Restrict to only held-out (`@holdout`-tagged) cases. |
| `--no-holdout` | | Exclude held-out (`@holdout`-tagged) cases. |
| `--json` | | Output as JSON: `{ scope, count, cases[] }`. |

The three scope flags are mutually exclusive; supplying more than one is an
error.

### Behavior

1. **Scope resolution.** Without a scope flag, cases are drawn from the
   permanent feature store (`.ratchet/features/**`). `--changes` appends all
   active change feature directories (`changes/<name>/features/`). `--change`
   restricts to one change's features directory. `--path` narrows within the
   store to a subdirectory or single file.
2. **Enumeration.** Every `.feature` file in scope is parsed. One `EvalCase` is
   produced per Scenario, assigned its stable case id, and sorted by id for
   deterministic output.
3. **Binding status.** Each case id is looked up in the loaded eval specs. The
   reported binding is `deterministic`, `llm-judge`, `web`, or `unbound`.
4. **Hold-out status.** Each case is checked for the `@holdout` Gherkin tag via
   `resolveHoldout()`. JSON reports a `holdout: true`/`false` field per case;
   text appends a `[holdout]` tag after the case id when true. This is
   reporting only — it has no effect on gating, and is independent of (shown
   alongside, not instead of) the binding tag.
5. **Hold-out filter.** `--holdout`/`--no-holdout` narrow the in-scope case
   set to only held-out or only non-held-out cases, composing with (not
   replacing) the `--changes`/`--change`/`--path` scope flags. Omitting both
   flags lists every in-scope case, exactly as before. Filtering has no
   effect on binding, judging, the gate, or aggregation.
6. **Archive exclusion.** The archive (`changes/archive/`) is never a scope
   root regardless of flags.

---

## `eval run`

Judge every bound in-scope case through the engine seams against its fixture
working copy and persist the run.

### Synopsis

```bash
ratchet eval run [--changes | --change <name> | --path <dir-or-file>] [--holdout | --no-holdout] [--gate <ids> | --only <ids> | --no-llm-judge | --no-invariants] [--judge <mode>] [--include-skipped] [--json]
```

### Options

| Option | Argument | Description |
|---|---|---|
| `--changes` | | Include active changes alongside the feature store. |
| `--change` | `<name>` | Scope to a single active change. |
| `--path` | `<dir-or-file>` | Narrow to a capability directory or `.feature` file within the feature store. |
| `--holdout` | | Restrict to only held-out (`@holdout`-tagged) cases. |
| `--no-holdout` | | Exclude held-out (`@holdout`-tagged) cases. |
| `--gate` | `<ids>` | Set the enabled contributor set outright (comma-separated ids from `deterministic`, `llm-judge`, `invariants`, `regression`). |
| `--only` | `<ids>` | Restrict the enabled set to the listed contributor ids (intersection with the config default). |
| `--no-llm-judge` | | Disable the `llm-judge` contributor for this run. |
| `--no-invariants` | | Disable the `invariants` contributor for this run (the manifest is not evaluated and no invariant command runs). |
| `--judge` | `auto \| deterministic \| llm-judge` | **Deprecated** legacy alias mapped onto the gate: `deterministic` disables `llm-judge`, `llm-judge` disables `deterministic`, `auto` enables both. Prefer `--gate`/`--only`/`--no-llm-judge`. |
| `--include-skipped` | | Judge cases that would otherwise be excluded by skip filters (`eval.skip` config or an in-file `@skip` tag), overriding both sources for this run. |
| `--json` | | Output as JSON: `{ runId, overall, scorecard, contributors, invariants, regressions, warnings, cases }` (`invariantLoadError` is added when the manifest could not be loaded). `cases[]` is one entry per case — `{ id, scenario, verdict, source, rubric, clauses, votes, skip? }` — carrying a judged case's resolved rubric/per-clause evidence/per-juror votes or a skipped case's skip source/detail. |

The contributor gate selects which verdict contributors execute and gate the
run. Resolution precedence is default (all contributors enabled) ◁ the project
config `eval.gate` map ◁ these CLI flags. An unknown id in `--gate`/`--only`
fails the command with the valid ids listed. See
[Eval verdict aggregation](../eval-verdict-aggregation.md#contributor-selection-the-gate).

### Behavior

1. **Scope and enumeration.** Same as `eval set`.
2. **Hold-out filter.** `--holdout`/`--no-holdout` narrow the in-scope case
   set to only held-out or only non-held-out cases, composing with (not
   replacing) the `--changes`/`--change`/`--path` scope flags, applied
   immediately after enumeration and before the skip/binding/judging loop.
   Filtering has no effect on binding, judging, the gate, or aggregation — a
   held-out case that is in scope is judged and gated exactly like any other
   case.
3. **Skip filters.** Before binding resolution, each case is checked against
   the skip sources: an in-file `@skip` Gherkin tag on its Scenario, then (if
   untagged) the project's `eval.skip` glob patterns (matched against the full
   case id) from `.ratchet/config.yaml`. A match records the case `skipped`
   with a reason naming the matched tag or pattern, and the case is excluded
   entirely — no binding is resolved, no fixture is materialized, and no judge
   is spawned for it. `--include-skipped` disables both sources for the run,
   so every case is judged by its bound kind as usual. A `skipped` case never
   blocks run completeness and is counted in the scorecard, never silently
   dropped. If a case being skipped was `pass` in the promoted baseline, a
   warning naming the case is printed (see Output below).
4. **Spec loading.** All YAML files under `.ratchet/evals/specs/` are loaded.
   Invalid bindings and duplicate case ids are collected as warnings and
   surfaced in output.
5. **Fixture materialization.** For each bound, non-skipped case, the named
   fixture is copied into a throwaway temp working copy. When the binding
   declares a `setup` command, setup runs once into a cached copy for that
   fixture+setup pair; subsequent cases bound to the same fixture+setup reuse
   the cached copy. Each case judges in an isolated working copy; the
   checked-in fixture and host repository are never modified.
6. **Contributor gating.** The enabled contributor set (resolved from config and
   CLI flags, persisted on the run as `gate`) decides what runs. It has two
   distinct effects:
   - *Per-case judging.* A bound case is judged by its binding kind — a
     `deterministic` binding runs its check command, an `llm-judge` binding spawns
     the judge agent. If that case's binding-kind contributor is **disabled**, the
     case is not judged at all: it is recorded `unjudged` (the reason names the
     disabled contributor) with no fixture materialized and no judge spawned, which
     leaves the run **incomplete**.
   - *Run-level gates.* The `invariants` and `regression` contributors judge the
     run as a whole rather than any single case, so disabling them changes only the
     aggregated verdict, never per-case execution. When `invariants` is enabled, the
     run-level gate loads `.ratchet/evals/invariants.yaml` **fail-closed** and checks
     only its **active** invariants; any violated, unevaluable, or unloadable
     invariant fails the run, while inert (`active: false`) invariants are skipped.
     See [Eval invariant manifest](../eval-invariants.md#gate-contributor).
7. **Unbound cases.** A non-skipped case with no binding in any spec is recorded `unjudged`
   with reason `"No eval-spec binding for this case"` and is never passed.
8. **Persistence.** The completed run is persisted atomically to
   `.ratchet/evals/runs/<run-id>.json`. The run id is a UTC timestamp plus a
   3-byte hex suffix (`YYYYMMDDTHHMMSSmmmZ-<hex>`), ensuring chronological
   sort order and no collisions.
9. **Structured per-case detail.** Alongside the flattened `reason` sentence,
   the run JSON persists each judged case's resolved rubric, every clause's
   boolean pass/fail with its cited evidence, and each juror's individual vote
   (a deterministic check carries the same shape as a one-clause/one-vote
   `llm-judge` case); a skipped case persists its skip source (`tag` or
   `config`) and matched detail. A failed, judged `web`-bound case additionally
   persists `artifacts.trace`/`artifacts.screenshot` — project-relative paths
   under `.ratchet/evals/runs/<run-id>/artifacts/<case-id>/` pointing at its
   captured Playwright trace and (when the project's own Playwright config
   captures one) screenshot. `eval run --json` surfaces this under `cases[]`.
10. **Output.** The run id, the aggregated overall verdict, the
   pass/fail/unjudged/skipped scorecard, and a per-contributor breakdown are
   printed (`deterministic`, `llm-judge`, `invariants`, `regression`).
   Run-level gate violations — a violated/unevaluable invariant (or an
   unloadable manifest), then a regression — are surfaced **first**, ahead of
   the per-case detail. The overall verdict is decided by the
   [verdict-aggregation core](../eval-verdict-aggregation.md) as a logical AND
   over the contributors. Any spec-load warnings are printed as dim lines,
   followed by one warning per case whose baseline verdict was `pass` and is
   now `skipped` (`Case '<id>' was 'pass' in the baseline and is now
   skipped.`).

---

## `eval record`

Manually override a single case's verdict in a persisted run.

### Synopsis

```bash
ratchet eval record --run <id> --case <id> --verdict <pass|fail|unjudged> [--evidence <text>] [--json]
```

### Options

| Option | Argument | Description |
|---|---|---|
| `--run` | `<id>` | Run id to amend. Required. |
| `--case` | `<id>` | Case id to override. Required. |
| `--verdict` | `pass \| fail \| unjudged` | New verdict. Required. |
| `--evidence` | `<text>` | Evidence text. Required when `--verdict fail`. |
| `--json` | | Output as JSON: `{ runId, caseId, verdict, source: "manual" }`. |

### Behavior

1. The run is loaded from `.ratchet/evals/runs/<run-id>.json`. If the run does
   not exist, the command fails non-zero and the file is left unchanged.
2. The case id must be present in the run's case list; an unknown id is an
   error.
3. A `fail` verdict without `--evidence` (or with blank evidence) is an error.
4. The verdict record is written with `source: "manual"`. The run is persisted
   atomically (write to temp, rename); on any rejection the run is unchanged.

---

## `eval report`

Print the scorecard and baseline regression diff for a run.

### Synopsis

```bash
ratchet eval report --run <id> [--json]
```

### Options

| Option | Argument | Description |
|---|---|---|
| `--run` | `<id>` | Run id to report. Required. |
| `--json` | | Output the full `EvalReport` object as JSON, including `cases[]` (see below). |

### Behavior

1. The run is loaded. The promoted baseline run (if any) is loaded from the
   path recorded in `.ratchet/evals/baseline.json`.
2. **Scorecard.** Pass/fail/unjudged counts are derived from the run's verdict
   map; a missing verdict entry is treated as `unjudged`. A run is `complete`
   when no case is unjudged.
3. **Baseline diff.** The current run's case ids are compared against the
   baseline run's case ids:
   - **Regression** — present in both, verdict was `pass` in baseline and is
     `fail` now. Regressions are surfaced first in text output.
   - **New** — present in the current run but not in the baseline.
   - **Retired** — present in the baseline but not in the current run.
   - When no baseline is promoted, the diff is empty (no regressions).
4. **Overall verdict.** The run-level verdict is decided by the
   [verdict-aggregation core](../eval-verdict-aggregation.md) as a logical AND
   over named contributors: it is `pass` only when every contributor passes. The
   `EvalReport` carries the per-contributor breakdown under `contributors`.
5. **Structured per-case detail.** `EvalReport.cases[]` holds one entry per run
   case — `{ id, scenario, verdict, source, rubric, clauses, votes, skip?,
   artifacts? }` — surfacing every judged case's resolved rubric, per-clause
   pass/fail evidence, and per-juror votes, a skipped case's skip
   source/detail, or a failed `web`-bound case's captured `artifacts.trace`/
   `artifacts.screenshot` paths. `eval report --json` surfaces this under
   `cases[]`; the text rendering prints each failing case's per-clause
   breakdown beneath its evidence line, plus a `Jury: x/y passed` line when
   more than one vote was cast, and `Trace: <path>`/`Screenshot: <path>` lines
   when the case captured them.

---

## `eval baseline`

Promote a run to the baseline.

### Synopsis

```bash
ratchet eval baseline <run-id> [--json]
```

### Arguments

| Argument | Description |
|---|---|
| `<run-id>` | Id of the run to promote. Required. |

### Options

| Option | Description |
|---|---|
| `--json` | Output as JSON: `{ baseline: { runId } }`. |

### Behavior

1. The run is loaded to verify it exists; a non-existent run id fails
   non-zero.
2. **Completeness guard.** An incomplete run — one with any case still
   `unjudged`, per the [verdict-aggregation core](../eval-verdict-aggregation.md)'s
   `complete` signal — is rejected with an error naming the run as incomplete,
   and `baseline.json` is left unchanged. An incomplete run can never become the
   regression baseline.
3. `.ratchet/evals/baseline.json` is written (or overwritten) with
   `{ "runId": "<run-id>" }`.
4. Subsequent `eval report` calls diff against this run.

---

## Cases and ids

A case id has the form:

```
<relative-feature-path-sans-ext>#<scenario-slug>
```

The path component is the `.feature` file's path relative to the
`.ratchet/` directory, using posix separators, with the `.feature` extension
removed. Examples:

| Source | Case id prefix |
|---|---|
| `.ratchet/features/auth/login.feature` | `features/auth/login#…` |
| `.ratchet/changes/my-change/features/search.feature` | `changes/my-change/features/search#…` |

The scenario component is the Scenario name lower-cased, trimmed, and
kebab-cased (`[^a-z0-9]+` replaced by `-`, leading/trailing hyphens stripped).
A name that produces an empty slug becomes `scenario`.

When two scenarios in the same file produce the same slug, the second and later
occurrences receive ordinal suffixes in document order: `-2`, `-3`, and so on.
A renamed scenario surfaces as a retired id plus a new id; rename and ordinal
shifts never produce a silent mismatch.

---

## Bindings

Bindings are authored YAML under `.ratchet/evals/specs/` (any `.yaml` or
`.yml` file). A spec file is a mapping of case id to binding object, optionally
nested under a top-level `bindings:` key. All spec files are loaded and merged;
when the same case id appears in more than one file, the last file in
alphabetical sort order wins and a warning is emitted.

### Deterministic binding

```yaml
"features/auth/login#valid-credentials":
  fixture: auth-app
  kind: deterministic
  setup: "pnpm install"       # optional; runs once per fixture+setup pair
  check:
    run: "pnpm test"
    pass: "exit-zero"         # default
```

| Field | Type | Description |
|---|---|---|
| `fixture` | string | Name of the fixture directory under `.ratchet/evals/fixtures/`. Required. |
| `kind` | `"deterministic"` | Discriminant. Required. |
| `setup` | string | Shell command run once to bootstrap the fixture working copy. Optional. |
| `check.run` | string | Shell command executed in the fixture working copy. Required. |
| `check.pass` | string | Pass condition. Default `exit-zero`. See pass conditions below. |

**Pass conditions for `check.pass`:**

| Value | Passes when |
|---|---|
| `exit-zero` / `exit 0` / `exit code 0` | Command exits with code 0. |
| leading exit-zero directive (e.g. `exit code 0 — tests pass`, `exit-zero: suite green`) | Command exits with code 0. A condition that *begins* with an `exit 0` / `exit-zero` / `exit code 0` directive — optionally followed by punctuation/prose — gates on the exit status and is **not** matched against stdout. |
| `contains:<text>` | Stdout contains the literal text after the prefix. |
| `regex:<pattern>` | Stdout matches the regex pattern after the prefix. |
| anything else (not an exit-code directive) | Treated as a stdout substring: command exits 0 and stdout contains the string. |

### LLM-judge binding

```yaml
"features/search#full-text-results":
  fixture: search-app
  kind: llm-judge
  setup: "pnpm install --frozen-lockfile"   # optional
  success: "The search endpoint returns ranked results for multi-word queries."
  jury:                       # optional; default { votes: 1, quorum: majority }
    votes: 3
    quorum: unanimous
  rubric:          # optional; default derives one item per Then-clause
    - "Multi-word queries return ranked results"
    - "Single-word queries still return results"
```

| Field | Type | Description |
|---|---|---|
| `fixture` | string | Name of the fixture directory under `.ratchet/evals/fixtures/`. Required. |
| `kind` | `"llm-judge"` | Discriminant. Required. |
| `setup` | string | Shell command run once to bootstrap the fixture working copy. Optional. |
| `success` | string | Success criteria passed to the spawned judge agent. Required. |
| `jury` | object | Per-binding jury override (`votes`, `quorum`), layered over the project-level `eval.jury` default. See [`eval:` settings](../configuration/config-yaml.md#eval-settings). Optional. |
| `rubric` | string[] | Explicit binary rubric, used verbatim instead of auto-deriving one item per Gherkin `Then`-clause. Optional. |

### Web binding

```yaml
"features/checkout#add-to-cart":
  fixture: storefront-app
  kind: web
  setup: "pnpm install"       # optional; runs once per fixture+setup pair
  start: "pnpm dev"
  readiness:
    url: "http://localhost:3000"   # or `command`; exactly one is required
    timeoutMs: 15000
  spec: e2e/add-to-cart.spec.ts
```

| Field | Type | Description |
|---|---|---|
| `fixture` | string | Name of the fixture directory under `.ratchet/evals/fixtures/`. Required. |
| `kind` | `"web"` | Discriminant. Required. |
| `setup` | string | Shell command run once to bootstrap the fixture working copy. Optional. |
| `start` | string | Shell command that boots the app under test. Required. |
| `readiness.url` | string | URL polled to determine the app is ready. Exactly one of `readiness.url` / `readiness.command` is required. |
| `readiness.command` | string | Command run to determine the app is ready. Exactly one of `readiness.url` / `readiness.command` is required. |
| `readiness.timeoutMs` | number | Positive integer milliseconds to wait for readiness. Required; the fail-closed boundary — readiness not reached within it is a failure, never an assumed-ready pass. |
| `spec` | string | Repo-relative path to the Playwright spec that drives the case's Given/When/Then. Required. |

`start`/`readiness`/`spec` are run by the web binding lifecycle harness
(`runWebLifecycle`): `start` is launched as a background process, `readiness`
is polled check-then-sleep until it succeeds or `readiness.timeoutMs` elapses
(a fail-closed timeout, never an assumed-ready pass), `spec` then runs via a
bash invocation that forces `--trace=retain-on-failure` and a `list,json`
reporter pair, and the started process is torn down in a `finally` on every
path. See [Web binding lifecycle harness](../eval-web-lifecycle.md) for the
full start/poll/run/teardown contract and its injectable seams. A `web`
binding runs through `ratchet eval run` like any other binding kind:
`judgeCase` dispatches it through the harness and reduces the result to a
`pass`/`fail` verdict (exit-zero Playwright run = `pass`; a non-zero exit or a
readiness timeout = `fail`), which gates through the `deterministic`
contributor — see [Verdict aggregation](../eval-verdict-aggregation.md) — so
`eval.gate.deterministic`/`--only`/`--gate` control a `web`-bound case exactly
like a `deterministic`-bound one. A failed case's captured Playwright trace
(and a screenshot, when the project's own Playwright config enables
`use.screenshot`) is persisted as durable run evidence under
`.ratchet/evals/runs/<run-id>/artifacts/<case-id>/` and referenced by path
from the run JSON — see the "Structured per-case detail" steps of `eval run`
and `eval report` above. The conditional `ratchet doctor` Playwright probe is
still deferred to a later change in the `playwright-web-tier` phase.

---

## Fixtures

A fixture is a checked-in codebase directory under
`.ratchet/evals/fixtures/<name>/`. Before each case is judged, the fixture is
copied into a throwaway temp working copy (`ratchet-eval-*` under the system
temp directory). The judge runs in that copy as its working directory; it may
freely build, run, or mutate files without affecting the checked-in fixture or
the host repository.

When a binding declares `setup`, the setup command is run in a cached working
copy keyed by `(fixture, setup)`. Each subsequent case bound to the same
fixture+setup receives a fresh copy of the post-setup cache, so setup runs at
most once per fixture+setup pair within a single `eval run` invocation.

---

## Verdicts and baseline

### Verdicts

Each case in a run carries one of four verdicts:

| Verdict | Meaning |
|---|---|
| `pass` | The case was judged and satisfied its pass condition or success criteria. |
| `fail` | The case was judged and did not satisfy its pass condition or success criteria. |
| `unjudged` | The case was not judged: unbound, excluded by judge mode, or the jury's cast votes did not reach its configured quorum. |
| `skipped` | The case matched a skip filter (an in-file `@skip` tag or a project `eval.skip` pattern) and was intentionally excluded from judging. Distinct from `unjudged`: a `skipped` case is a deliberate, counted exclusion, never an incompleteness, and does not block baseline promotion. |

Each verdict record carries a `source` field: `"judged"` for engine-produced
verdicts or `"manual"` for overrides written by `eval record`.

### Skip filters

A case is excluded from judging when either source matches, checked in this
order:

1. **In-file tag.** The case's Scenario carries the `@skip` Gherkin tag.
2. **Project config.** No `@skip` tag, but the case id matches a glob pattern
   in `eval.skip` (`.ratchet/config.yaml`; see [`eval:`
   settings](../configuration/config-yaml.md#eval-settings)). Patterns are
   matched against the full case id with `*` as a wildcard, anchored to the
   whole string.

A skipped case is recorded `skipped` with a reason naming the matched tag's
source file or the matched pattern, and is excluded before binding
resolution — it is never bound, no fixture is materialized, and no judge is
spawned for it, even when the case has no eval-spec binding at all.
`--include-skipped` disables both sources together for the run; there is no
flag to disable only one source.

### Agent judge guarantees

Each `llm-judge` case is judged against a binary **rubric**: one item per
`Then`-clause (the `Then` step plus every `And`/`But` step that follows it,
until the next `Given`/`When`/`Then`), or the binding's explicit `rubric:`
list when present. `And`/`But` steps rooted under `Given`/`When` are not
rubric items.

Per vote, the spawned judge agent is instructed to reason step by step about
each clause **before** stating that clause's verdict (CoT-before-verdict), and
to reach its own judgment from observed evidence rather than defer to the
scenario's or success criteria's framing (anti-sycophancy). The agent reports
one `"yes" | "no" | "can't-tell"` verdict with cited evidence per clause.

The agent judge fails closed:

- A clause judged `"no"` or `"can't-tell"`, left unaddressed, or reported
  `"yes"` without concrete evidence, does not pass — uncertainty is never a
  pass.
- A vote passes only when **every** clause passes (all-yes); a single failing
  or inconclusive clause fails the whole vote.
- A judge response with no parseable per-clause verdict array fails every
  clause closed.
- The jury (`jury.votes`, default 1; `jury.quorum`, default `majority`) casts
  that many votes (each already all-yes-gated) and resolves them under the
  configured quorum:
  - `majority`: `pass` when passing votes are a strict majority, `fail` when
    failing votes are a strict majority; a tie does not reach quorum.
  - `unanimous`: `pass` only when every vote passes, `fail` only when every
    vote fails; any split does not reach quorum.
  - A jury that does not reach its configured quorum always records
    `unjudged` with the vote tally — never a guessed `pass` or `fail`.

### Baseline regression

A regression is a case that was `pass` in the promoted baseline run and is
`fail` in the current run. `unjudged` in either run is not a regression. The
overall verdict is decided by the
[verdict-aggregation core](../eval-verdict-aggregation.md) as a logical AND over
named contributors; the `regression` contributor fails the run while any
regression exists.

A case that was `pass` in the baseline and is now `skipped` is **not** a
regression — it does not fail the `regression` contributor or the run — but is
listed under `EvalReport.diff.skippedRegressions` and surfaces as a visible
`eval run` warning (`Case '<id>' was 'pass' in the baseline and is now
skipped.`), so an intentional skip of a previously-passing case is never
silent.

The baseline is stored at `.ratchet/evals/baseline.json` as
`{ "runId": "<id>" }`. Promoting a new baseline with `eval baseline` overwrites
this file, but only a **complete** run (no case `unjudged`) may be promoted.
