# Hold-out scope filter

## Why

`holdout-tag-resolution` gave ratchet a pure `resolveHoldout()` check and
`eval-set-holdout-status` surfaced it as a read-only tag on `ratchet eval
set`. But there is still no way to *run* or *list* just the held-out set (to
sanity-check it in isolation) or just the non-held-out set (to reproduce
"what the building agent saw") without grepping ids by hand. This change
closes the `holdout-scenarios` phase by adding `--holdout` / `--no-holdout`
scope flags to `eval run` and `eval set`, composing with the existing
`--changes` / `--change` / `--path` scope flags.

## What Changes

- New pure filter `filterCasesByHoldout(cases: EvalCase[], holdout: boolean |
  undefined): EvalCase[]` in `src/core/eval/holdout.ts`, alongside
  `resolveHoldout()`/`HOLDOUT_TAG`/`filterHoldoutContent()`: returns `cases`
  unchanged when `holdout` is `undefined` (no flag passed), otherwise keeps
  only the cases whose `resolveHoldout(c) === holdout`. Exported from
  `src/core/eval/index.ts` alongside the existing `resolveHoldout`/`HOLDOUT_TAG`
  export line.
- `ScopeFlags` (`src/commands/eval/shared.ts`) gains `holdout?: boolean`,
  flowing into `EvalSetOptions` and `EvalRunOptions` (both already `extends
  ScopeFlags`) for free.
- `src/commands/eval/set.ts`: `evalSetCommand` filters the enumerated case
  list through `filterCasesByHoldout(cases, options.holdout)` before mapping
  to `SetCaseView[]`, so `--holdout`/`--no-holdout` narrow both the `--json`
  output and the text report.
- `src/core/eval/execute.ts`: `RunOptions` gains `holdout?: boolean`;
  `executeRun()` filters the enumerated case list through
  `filterCasesByHoldout()` immediately after `enumerateEvalSet()`, before the
  skip-check/binding/judging loop — the same place `options.scope` already
  narrows the working set. Nothing downstream of that filter point (skip
  resolution, binding resolution, judging, the aggregation core, `EvalRun`/
  `CaseSnapshot`'s persisted shape) changes.
- `src/commands/eval/run.ts`: `evalRunCommand` passes `holdout:
  options.holdout` into `executeRun()`.
- `src/cli/index.ts`: the shared `withScopeFlags()` helper (already applied
  to both `eval set` and `eval run`) gains `.option('--holdout', ...)` and
  `.option('--no-holdout', ...)`, so both commands get the flags from the one
  registration point that already owns `--changes`/`--change`/`--path`.
- Implements `features/eval-holdout/holdout-scope-filter.feature`.
- `docs/commands/eval.md` (`eval set` and `eval run` sections) and
  `README.md` document the new flags, per `documentation`.

## Design

**One filter function, applied at the same point `scope` already narrows the
case set, reused by both commands.** `enumerateEvalSet(root, scope)` is the
single place both `eval set` and `eval run` turn a scope into a concrete
`EvalCase[]`; `filterCasesByHoldout()` is a second, independent narrowing
step applied immediately after it in both call sites (`set.ts`, `execute.ts`),
mirroring how `options.scope` and the skip check are each their own
narrowing pass rather than being folded into one mega-function. This keeps
the filter reusable, unit-testable in isolation, and guarantees `eval set`
and `eval run` apply `--holdout`/`--no-holdout` identically — there is
exactly one place that decides "is this case in scope for hold-out
purposes."

**`holdout` lives on `ScopeFlags`, but `EvalScope`/`resolveScope()` stay
untouched.** `--holdout`/`--no-holdout` reach both commands through the same
options bag and the same `withScopeFlags()` CLI registration point as
`--changes`/`--change`/`--path`, so adding the field to `ScopeFlags` is the
natural way to "compose with the existing scope-flag pattern" per this
change's done text. It is deliberately **not** folded into `EvalScope`
(`kind`/`target`) or `resolveScope()`: hold-out status is a per-case
predicate orthogonal to which `.feature` files are read (a case's
`resolveHoldout()` result does not depend on *which* scope root it was
enumerated from), whereas `EvalScope` selects file-system roots. Keeping
`EvalScope` untouched also means `EvalRun.scope` (`{ kind, target }`,
persisted verbatim on every run) needs no shape change — the hold-out filter
prunes the case list before it ever reaches `EvalRun.cases`, the same way
today's `scope` already does, so nothing new is persisted and no existing
persisted-run consumer (`report.ts`, `eval record`, baseline diffing) needs
to change.

**`--holdout` and `--no-holdout` are two Commander flags sharing one
property, not a custom tri-state parser.** Verified directly: registering
`.option('--holdout', ...)` and `.option('--no-holdout', ...)` on the same
Commander command produces `{}` when neither is passed (`options.holdout ===
undefined`, filter is a no-op), `{ holdout: true }` for `--holdout`, and
`{ holdout: false }` for `--no-holdout` — exactly the three states
`filterCasesByHoldout()` needs, with no custom parsing. If a caller passes
both flags, Commander resolves it by last-flag-wins (an accepted CLI idiom
for a boolean/negation pair, the same shape as `--holdout`/`--no-holdout`
itself); this change does not add a mutually-exclusive-flags validation error
the way `resolveScope()` does for `--changes`/`--change`/`--path`, because
those three are semantically distinct scope *kinds* where combining two is
almost always a mistake, while `--holdout`/`--no-holdout` are one negatable
boolean where "last one wins" is the ordinary, unsurprising outcome — adding
validation here would be defensive code for a non-issue.

**Standards applicability.** `testing`: `filterCasesByHoldout()` is a pure
evaluator (deterministic array-in/array-out, no filesystem/spawn) and gets
unit tests in `test/core/eval/holdout.test.ts`; `executeRun()`'s new
`holdout` option is core/command wiring and gets an integration test in
`test/core/eval/execute.test.ts` over the existing tmpdir-fixture pattern;
the CLI-facing `eval set`/`eval run` wiring gets integration tests extending
`test/commands/eval/set-holdout.test.ts` and a new
`test/commands/eval/run-holdout.test.ts` (new file, not appended to
`run.test.ts`, so its assertions are exercised by the phase's `pnpm vitest
run holdout` proof-of-work the same way `set-holdout.test.ts` already is —
Vitest's positional filter matches file *paths*, and `run.test.ts` does not
contain "holdout"). `documentation`: mandatory task below — `docs/commands/
eval.md`'s `eval set`/`eval run` synopsis, options table, and Behavior
sections, plus `README.md`'s command table and "Hold-out scenarios."
paragraph, are updated in the same change. `multi-agent-support`: satisfied
by construction — this is a change to one already agent-neutral CLI command
group's flags/output, not a skill, command-generation template, or per-agent
artifact. `generalizable-defaults`: not applicable — no new default,
project-specific command, or toolchain literal ships into a consuming
project. `delegated-lifecycle`: not applicable — no batch-engine or
agent-spawning code is touched.

## Tasks

### 1. Core filter

- [x] 1.1 Add `filterCasesByHoldout(cases: EvalCase[], holdout: boolean |
      undefined): EvalCase[]` to `src/core/eval/holdout.ts`: returns `cases`
      unchanged when `holdout` is `undefined`; otherwise returns only the
      cases where `resolveHoldout(c) === holdout`.
- [x] 1.2 Export `filterCasesByHoldout` from `src/core/eval/index.ts`
      alongside the existing `resolveHoldout`/`HOLDOUT_TAG` export line.
- [x] 1.3 Add `test/core/eval/holdout.test.ts` cases (extend the existing
      file): `holdout: true` keeps only `@holdout`-tagged cases;
      `holdout: false` keeps only untagged cases; `holdout: undefined`
      returns the input array's cases unchanged (identity over content, order
      preserved); an empty input returns an empty array regardless of the
      flag.

### 2. Wire into `eval set`

- [x] 2.1 In `src/commands/eval/shared.ts`, add `holdout?: boolean` to
      `ScopeFlags` with a doc comment noting it is an orthogonal per-case
      filter, not a scope-kind flag, and that `resolveScope()` does not read
      it.
- [x] 2.2 In `src/commands/eval/set.ts`, filter the enumerated cases through
      `filterCasesByHoldout(cases, options.holdout)` before building
      `SetCaseView[]`; update the file's header comment (synopsis line) to
      include `[--holdout | --no-holdout]`.
- [x] 2.3 Extend `test/commands/eval/set-holdout.test.ts`: `--holdout --json`
      returns only the held-out case's entry; `--no-holdout --json` returns
      only the non-held-out case's entry; the text report under each flag
      lists only the matching case's line; omitting both flags still lists
      every case (regression check against the existing tests in this file).

### 3. Wire into `eval run`

- [x] 3.1 In `src/core/eval/execute.ts`, add `holdout?: boolean` to
      `RunOptions`; in `executeRun()`, filter the result of
      `enumerateEvalSet()` through `filterCasesByHoldout()` before the
      skip/binding/judging loop.
- [x] 3.2 In `src/commands/eval/run.ts`, pass `holdout: options.holdout` into
      the `executeRun()` call; update the file's header comment (synopsis
      line) to include `[--holdout | --no-holdout]`.
- [x] 3.3 In `src/cli/index.ts`, add `.option('--holdout', 'Restrict to only
      held-out (@holdout-tagged) cases')` and `.option('--no-holdout',
      'Exclude held-out (@holdout-tagged) cases')` to the shared
      `withScopeFlags()` helper, so both `eval set` and `eval run` register
      the flags from the one place that already owns
      `--changes`/`--change`/`--path`.
- [x] 3.4 Add `test/core/eval/execute.test.ts` cases: `executeRun()` with
      `holdout: true` persists a run whose `cases`/`verdicts` include only
      the held-out case(s); `holdout: false` includes only the non-held-out
      case(s); a held-out, deterministic-bound case run under `holdout: true`
      is judged and gated exactly like any other bound case (same verdict
      shape, no special-casing) — proving the filter changes only which
      cases enter the loop, not how they're judged or aggregated.
- [x] 3.5 Add `test/commands/eval/run-holdout.test.ts` (new file, header
      names `features/eval-holdout/holdout-scope-filter.feature`): `ratchet
      eval run --holdout` persists a run scoped to only the held-out case;
      `--no-holdout` persists a run scoped to only the non-held-out case; the
      held-out case's verdict/scorecard behavior is unaffected by being
      selected via the flag versus being in an unfiltered run.

### 4. Compose with existing scope flags

- [x] 4.1 Add a case to `test/commands/eval/set-holdout.test.ts` (or a
      focused addition to `run-holdout.test.ts`) proving `--holdout` composes
      with `--change <name>`: a change-scoped feature store with its own
      held-out and non-held-out cases returns only the held-out case when
      both `--change <name>` and `--holdout` are passed together.

### 5. Documentation (`documentation` standard)

- [x] 5.1 In `docs/commands/eval.md`: add `[--holdout | --no-holdout]` to
      both the `eval set` and `eval run` Synopsis lines; add `--holdout` /
      `--no-holdout` rows to both Options tables; add a "Hold-out filter"
      item to `eval set`'s Behavior list (after "Hold-out status") and to
      `eval run`'s Behavior list (after "Scope and enumeration") describing
      that the flags narrow the in-scope case set to only held-out or only
      non-held-out cases, composing with (not replacing) the `--changes`/
      `--change`/`--path` scope flags, with no effect on binding, judging,
      the gate, or aggregation.
- [x] 5.2 In `README.md`: update the `eval set` and `eval run` rows in the
      command reference table (lines ~233-234) to list `--holdout`/
      `--no-holdout`; extend the existing "**Hold-out scenarios.**" paragraph
      (in the eval section) with a sentence noting `--holdout`/`--no-holdout`
      on `eval set`/`eval run` restrict the in-scope set to just the held-out
      or just the non-held-out cases.

### 6. Verify

- [x] 6.1 Run `pnpm build && pnpm vitest run holdout` and confirm exit 0
      (phase proof-of-work).
