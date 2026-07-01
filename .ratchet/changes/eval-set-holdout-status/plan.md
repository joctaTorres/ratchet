# Eval set hold-out status

## Why

`holdout-tag-resolution` gave ratchet a pure `resolveHoldout()` check, and
`apply-spec-holdout-filter` wired it into what the building agent sees. But
nothing yet lets a person (or the batch's verify step) *see* which cases are
held out short of grepping `.feature` files for `@holdout` — `ratchet eval
set` already reports each case's binding status (`deterministic` /
`llm-judge` / `unbound`) and is the natural place to report hold-out status
alongside it, the same way it will later gain a `--holdout` scope filter.

## What Changes

- `src/core/eval/index.ts` exports `resolveHoldout` and `HOLDOUT_TAG` from
  `./holdout.js`, matching the existing `resolveSkip`/`SKIP_TAG` export line —
  today only `holdout.ts`'s filter half is consumed directly by
  `outputs.ts`, and its resolver half is missing from the barrel entirely.
- `src/commands/eval/set.ts`'s `SetCaseView` gains a `holdout: boolean` field,
  computed via `resolveHoldout(c)` in the same `cases.map(...)` pass that
  already calls `resolveBinding`. The JSON output
  (`{ scope, count, cases[] }`) carries it per case with no other shape
  change. The text renderer (`renderSet`) appends a ` [holdout]` tag after
  the case id when `holdout` is true — the existing binding tag
  (`[deterministic]` / `[llm-judge]` / `[unbound]`) is untouched, so binding
  and hold-out status render as two independent tags on the same line.
- Implements `features/eval-holdout/eval-set-holdout-status.feature`.
- No change to `enumerateEvalSet()`, `resolveBinding()`, `execute.ts`,
  `aggregate.ts`, `report.ts`, `run.ts`, or the persisted run JSON shape —
  this slice only changes what `eval set` reports. A `--holdout` /
  `--no-holdout` CLI scope filter is explicitly out of scope here and belongs
  to the phase's next, sibling change, `holdout-scope-filter`.
- `docs/commands/eval.md`'s `eval set` section and `README.md`'s existing
  "Hold-out scenarios." paragraph are updated to describe the new field/tag,
  per `documentation`.

## Design

**Computed at report time, not persisted — mirrors how binding already
works.** `resolveBinding()` is called fresh on every `eval set` invocation;
`resolveHoldout()` is a pure, already-unit-tested function
(`test/core/eval/holdout.test.ts`) over the same in-memory `EvalCase`, so
this change is wiring, not new logic. There is nothing to cache or persist:
hold-out status is derived from `.feature` source on every call, exactly
like binding.

**Hold-out is reported as an additional, independent tag — not folded into
the binding enum.** A case's binding (`deterministic`/`llm-judge`/`unbound`)
and its hold-out status are orthogonal: a held-out case can be bound or
unbound. Appending `[holdout]` *after* the id (rather than replacing or
prefixing the binding tag) keeps `[deterministic] <id>` /
`[unbound] <id>` intact as stable substrings — the existing
`test/commands/eval/set.test.ts` assertions
(`toContain('[deterministic] ${CASE_JSON}')`,
`toContain('[unbound] ${CASE_TEXT}')`) keep passing unmodified, since neither
of those fixture cases is tagged `@holdout`.

**New test file, not an extension of `set.test.ts` — because of how the
phase's proof-of-work filters.** The phase's proof-of-work is `pnpm vitest run
holdout`, and Vitest's positional filter matches test **file paths**
containing the given string, not test names or content — confirmed by
running it locally: it currently selects only `test/core/eval/holdout.test.ts`
(9 tests), even though `test/commands/workflow/instructions.test.ts` was
already extended with `@holdout`-related assertions by
`apply-spec-holdout-filter` and does not match. To make this change's new
assertions actually exercised by the phase gate (not just by the full suite),
its integration test lives in a new, separately-named file,
`test/commands/eval/set-holdout.test.ts` — matching the existing
topic-suffixed test file convention already used elsewhere in this repo
(`engine-agent-override.test.ts`, `proof-of-work-gate.test.ts`) — rather than
appended into `set.test.ts`.

**Reuses `eval-fixture.ts`'s existing helpers, adds no new shared fixture
constants.** The new test file writes its own local `.feature` content
(one `@holdout`-tagged Scenario, one untagged, one bound via a
`DETERMINISTIC_SPEC`-style spec targeting the held-out case) directly via
`fixture.writeFeature()`/`writeSpec()`, rather than modifying the
`TWO_CASE_FEATURE`/`CASE_JSON`/`CASE_TEXT` constants `eval-fixture.ts`
already exports — those are reused verbatim by `record.test.ts`,
`run.test.ts`, `shared.test.ts`, `baseline.test.ts`, and `report.test.ts`,
so changing their shape would have a blast radius well beyond this slice.

**Standards applicability.** `testing`: `set-holdout.test.ts` is an
integration test over command wiring (tmpdir fixture, per the pyramid);
`resolveHoldout()` itself is already unit-tested and untouched here, so no
new unit test is needed for it. `documentation`: mandatory task below,
scoped to `docs/commands/eval.md`'s `eval set` section and `README.md`'s
"Hold-out scenarios." paragraph — both already exist and are being extended,
not created. `multi-agent-support`: satisfied by construction — this is a
change to one CLI command's already agent-neutral JSON/text output, not a
skill, command-generation template, or per-agent artifact; no new
agent-facing surface is introduced. `generalizable-defaults`: not
applicable — no new default, config key, or literal ships into a consuming
project's toolchain. `delegated-lifecycle`: not applicable — no batch-engine
or agent-spawning code is touched.

## Tasks

### 1. Barrel export

- [x] 1.1 In `src/core/eval/index.ts`, add
      `export { resolveHoldout, HOLDOUT_TAG, type ... } from './holdout.js';`
      alongside the existing `resolveSkip`/`SKIP_TAG` export line, so
      `src/commands/eval/set.ts` can import `resolveHoldout` the same way it
      already imports `resolveBinding`.

### 2. Wire into `eval set`

- [x] 2.1 In `src/commands/eval/set.ts`, add `holdout: boolean` to
      `SetCaseView` and compute it via `resolveHoldout(c)` in the existing
      `cases.map(...)` block, alongside the existing `resolveBinding(specs,
      c.id)` call.
- [x] 2.2 In `renderSet()`, append `` ` ${chalk.magenta('[holdout]')}` ``
      after the case id (`console.log(\`  ${tag} ${v.id}...\`)`) when
      `v.holdout` is true; leave the binding tag line and the
      `feature › scenario` line untouched otherwise.

### 3. Tests

- [x] 3.1 Add `test/commands/eval/set-holdout.test.ts` (header names
      `features/eval-holdout/eval-set-holdout-status.feature`), using the
      existing `makeEvalFixture`/`EvalFixture` helpers from `eval-fixture.ts`
      with its own local `.feature`/spec content (not the shared
      `TWO_CASE_FEATURE` constants), covering: JSON output reports
      `holdout: true` for the `@holdout`-tagged case and `holdout: false` for
      the untagged case; text output contains a `[holdout]` tag on the
      held-out case's line and no `[holdout]` tag on the other case's line;
      a held-out case that is also bound to a deterministic spec shows both
      its `[deterministic]` binding tag and `[holdout]` on the same line.
- [x] 3.2 Run `pnpm build && pnpm vitest run holdout` and confirm exit 0,
      verifying the new test file's path match actually exercises these
      assertions under the phase's proof-of-work command.

### 4. Documentation (`documentation` standard)

- [x] 4.1 In `docs/commands/eval.md`'s `eval set` section: add a "Hold-out
      status" item to the numbered "Behavior" list (after "Binding status",
      before "Archive exclusion") describing the `holdout: true`/`false` JSON
      field and the `[holdout]` text tag, sourced from `resolveHoldout()`/the
      `@holdout` tag, reporting-only with no effect on gating; update the
      `--json` option's shape description if it needs to mention the new
      field.
- [x] 4.2 In `README.md`, extend the existing "**Hold-out scenarios.**"
      paragraph (next to "**Skip filters.**" in the eval section) with a
      sentence noting `ratchet eval set` now reports each case's hold-out
      status (`holdout` in JSON, a `[holdout]` tag in text) alongside its
      binding kind; update the `ratchet eval set --json` example comment
      (near line 382) if it undersells the new field.

### 5. Verify

- [x] 5.1 Run `pnpm build && pnpm vitest run holdout` and confirm exit 0
      (phase proof-of-work).
