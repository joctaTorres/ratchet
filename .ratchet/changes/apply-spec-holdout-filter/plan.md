# Apply-spec hold-out filter

## Why

`holdout-tag-resolution` gave ratchet a pure way to ask "is this case held
out," but nothing reads that signal yet: `generateApplyInstructions()` still
hands the building agent the raw `features/**/*.feature` source paths
verbatim, so a scenario tagged `@holdout` is fully visible to the agent that
writes the implementation — defeating the anti-overfitting point of a
hold-out set before it exists. This change wires the resolver into apply-time
spec assembly so a held-out scenario is invisible to the builder while
staying an ordinary, fully-enumerated gating case everywhere else.

## What Changes

- New pure filter `filterHoldoutContent()` in `src/core/eval/holdout.ts`:
  strips every `@holdout`-tagged Scenario/Scenario Outline block (its tag
  line(s), header, steps, and — for an Outline — its `Examples:` table) out
  of raw `.feature` file text, leaving every other line untouched.
- New `materializeApplyContext()` in `src/core/artifact-graph/outputs.ts`:
  given an artifact's resolved output paths, writes a filtered copy of each
  `.feature` output (via `filterHoldoutContent()`) to
  `<changeDir>/.apply-context/<artifactId>/...` and returns the materialized
  paths; non-`.feature` outputs (e.g. `plan.md`) pass through unchanged.
- `generateApplyInstructions()` (`src/commands/workflow/instructions.ts`)
  builds `contextFiles` from `materializeApplyContext()` instead of the raw
  `resolveArtifactOutputs()` paths, so every path it hands back for a
  `.feature` artifact points at a filtered copy, never the source file.
- `.gitignore` gains a `.ratchet/changes/*/.apply-context/` entry — the
  materialized copies are regenerated on every `ratchet instructions apply`
  call, not source.
- Implements `features/apply-holdout/apply-time-filter.feature`.
- `eval run`, `ratchet verify`, `enumerateEvalSet()`, `execute.ts`,
  `aggregate.ts` are untouched: they already read the real source `.feature`
  file directly (never through `contextFiles`), so a held-out case keeps
  being enumerated and gated exactly like any other case. Regression-tested,
  not re-implemented.
- Reference docs (`docs/commands/instructions.md`, `README.md`) document the
  filtering behavior and the stronger sibling-location isolation
  alternative, per `documentation`.

## Design

**Text-level filtering, not AST round-tripping.** `parseFeatureFile()` drops
comments, docstrings, and `Examples:` table rows when it builds a `Feature`
— reconstructing Gherkin text from that parsed model would silently lose
them. `filterHoldoutContent()` instead operates on the raw lines directly,
mirroring `gherkin-parser.ts`'s own tag-accumulation/reset state machine
(tags accumulate until a `Scenario`/`Scenario Outline`/`Background` line,
then reset) so a `.feature` file's non-held-out content survives byte-for-byte
and only the held-out blocks disappear. A block runs from its first
accumulated tag line (or the `Scenario:` line itself if untagged-but-later-
found-holdout is impossible — holdout is tag-only) through the line
immediately before the next tag run, `Scenario:`/`Scenario Outline:`/
`Background:` header, or end of file — which naturally sweeps in a held-out
Outline's `Examples:` table without special-casing it. Feature-level tags are
not a distinct case: per `holdout-tag-resolution`'s design note, tags
preceding `Feature:` are discarded by the parser today, so a whole feature
file is held out the same way `resolveHoldout()` already treats it —
tagging every one of its Scenarios `@holdout` — and `filterHoldoutContent()`
handles that as a natural consequence of removing every scenario block,
leaving just the `Feature:` header and description.

**Materialize to a sibling directory, not in place.** Writing filtered
`.feature` files into `changeDir/features/...` would corrupt the tracked
source artifact and would itself be picked up by the next call's own
`features` glob. Filtered copies instead land under
`<changeDir>/.apply-context/<artifactId>/`, mirrored by relative path,
fully regenerated (overwritten, not incrementally patched) on every
`generateApplyInstructions()` call — simplest correct behavior, and cheap
since `.feature` artifacts are small text files. This directory is
runtime-derived output, not source, so it is gitignored, matching the
existing `.ratchet/batches/*/run/` precedent for engine-written runtime
state that must not be tracked.

**Filtering lives in the one function both apply and verify already share.**
`apply-change.ts` and `verify-change.ts` (the shared, agent-neutral skill
templates under `src/core/templates/workflows/`) both call
`ratchet instructions apply` and read `contextFiles`; there is no separate
"instructions for verify" entry point. Because `generateApplyInstructions()`
is the single, already-shared builder consumed by both flows, adding the
filter there — rather than growing a second call path or a mode flag —
keeps this a `delegated-lifecycle`-compliant change: no parallel
instruction-builder is introduced, and every consumer (interactive skill,
headless `ratchet apply`, headless `ratchet verify`) goes on getting its
`contextFiles` from the same one place. The mechanical gate that "gates
normally at verify" per this phase's success criteria is `eval run` /
`enumerateEvalSet()` reading the untouched source file directly — a
wholly separate code path from `contextFiles` — so verdict/aggregation
cannot be affected by anything this change does to instruction assembly,
regardless of what a verify-time reviewing agent happens to read for its own
narrative context.

**No new command, flag, or config key.** This is a change to what one
existing function returns, not a new user-facing surface beyond that
already-documented `contextFiles` shape — so `multi-agent-support` is
satisfied by construction (the shared, agent-neutral templates in
`src/core/templates/workflows/` are untouched; every agent ratchet renders
skills for keeps calling the same `ratchet instructions apply` command and
gets filtered paths back identically) and `generalizable-defaults` is
satisfied by construction (`.apply-context/` is a path this change writes
inside the user's own `.ratchet/changes/<name>/` tree, not a package
manager, test runner, or toolchain-specific default).

**Sibling-location isolation (documented, not built).** A stronger
alternative excludes `@holdout`-tagged `.feature` files from the apply-time
artifact glob entirely — e.g. storing held-out scenarios in a sibling
directory such as `features.holdout/**/*.feature` outside `features/**/*
.feature`, so the building agent never sees that a held-out scenario exists
at all, not just its content. Tag-based filtering (this change) only hides
*content*; an agent can still see a stripped Scenario's tag line and name if
implemented carelessly, or infer a gap from a truncated feature. Sibling-
location isolation would close that gap completely but requires a second
artifact-glob pattern, changes to where `eval set`/`eval run` look for the
full case set, and a decision about how `ratchet propose` splits new
Scenarios between the two locations — a materially larger, cross-cutting
change deferred out of this vertical slice. `docs/commands/instructions.md`
records this trade-off explicitly per `documentation`.

**Standards applicability.** `testing`: `filterHoldoutContent()` is a pure
evaluator (deterministic text-in/text-out, no filesystem/spawn) and gets
unit tests; `materializeApplyContext()` and `generateApplyInstructions()`
are core/command wiring and get integration tests over the tmpdir fixture
pattern already used in `test/commands/workflow/instructions.test.ts` and
`test/core/artifact-graph/outputs.test.ts`. `documentation`: this change adds
an externally-observable behavior change to `ratchet instructions apply`'s
documented `contextFiles` output, so `docs/commands/instructions.md` and
`README.md` are updated in the same change. `delegated-lifecycle`,
`multi-agent-support`, `generalizable-defaults`: addressed above — satisfied
by construction, not exempted.

## Tasks

### 1. Pure filter

- [x] 1.1 Add `filterHoldoutContent(content: string): string` to
      `src/core/eval/holdout.ts`, alongside `HOLDOUT_TAG`/`resolveHoldout()`:
      removes every `@holdout`-tagged Scenario/Scenario Outline block (tag
      line(s) through the line before the next tag run/Scenario/Background/
      EOF, including a held-out Outline's `Examples:` table), leaving all
      other lines — Feature header/description, Background, non-held-out
      Scenarios, comments — untouched.
- [x] 1.2 Add `test/core/eval/holdout.test.ts` cases (extend the existing
      file) covering: a mixed file keeps the untagged Scenario and drops the
      `@holdout` one; a file with no `@holdout` tags returns unchanged
      content; a file whose every Scenario is `@holdout` returns the
      `Feature:` header/description with no Scenario blocks; a held-out
      `Scenario Outline` has its `Examples:` table removed too; a tag line
      combining `@holdout` with another tag (e.g. `@holdout @smoke`) is
      still detected.

### 2. Artifact materialization

- [x] 2.1 Add `materializeApplyContext(changeDir: string, artifactId: string,
      outputs: string[]): string[]` to `src/core/artifact-graph/outputs.ts`:
      for each path in `outputs` ending in `.feature`, read it, run
      `filterHoldoutContent()`, write the result to
      `<changeDir>/.apply-context/<artifactId>/<relative-path-under-changeDir>`
      (creating directories as needed), and return the materialized absolute
      path in the output's place; non-`.feature` paths pass through
      unchanged. Fully regenerates on every call (overwrite).
- [x] 2.2 Add `test/core/artifact-graph/outputs.test.ts` cases: a `.feature`
      output with a held-out Scenario materializes to a distinct path whose
      content has that Scenario stripped; the source file's content is
      unchanged after materialization; a `.feature` output with no held-out
      Scenarios materializes content-equivalent to the source; a non-
      `.feature` output (e.g. `plan.md`) is returned as its original path,
      unchanged.

### 3. Wire into apply instructions

- [x] 3.1 In `generateApplyInstructions()`
      (`src/commands/workflow/instructions.ts`), replace the direct
      `contextFiles[artifact.id] = outputs` assignment with
      `contextFiles[artifact.id] = materializeApplyContext(changeDir,
      artifact.id, outputs)`.
- [x] 3.2 Extend `test/commands/workflow/instructions.test.ts`: a change
      whose `.feature` artifact has an `@holdout`-tagged Scenario produces
      `contextFiles` entries that (a) differ from the raw
      `resolveArtifactOutputs()` paths and (b) whose file content excludes
      the held-out Scenario's name/steps; a change with no held-out
      Scenarios produces `contextFiles` content-equivalent to source; the
      `plan.md` entry in `contextFiles` is unaffected.
- [x] 3.3 Add a regression test (in `test/core/eval/` alongside `set.ts`'s
      existing tests, or `test/commands/workflow/instructions.test.ts`)
      proving `enumerateEvalSet()`/`eval run` scope resolution against the
      same fixture change still returns the held-out case, tagged
      `@holdout`, alongside every other case — i.e. this change did not
      touch `execute.ts`, `aggregate.ts`, or `set.ts`.

### 4. Ignore materialized output

- [x] 4.1 Add `.ratchet/changes/*/.apply-context/` to `.gitignore`, matching
      the existing `.ratchet/batches/*/run/` runtime-state pattern and
      comment style.

### 5. Documentation (`documentation` standard)

- [x] 5.1 In `docs/commands/instructions.md`, add a subsection under "Apply
      instructions (`apply` argument)" documenting: `.feature` artifact
      paths in `contextFiles` point to materialized, `@holdout`-filtered
      copies under `.apply-context/`, never the source file; the source
      `.feature` file is unchanged on disk; `eval run`/`ratchet verify` read
      the untouched source directly and gate a held-out case normally; and
      the documented sibling-location isolation alternative (excluding
      held-out `.feature` files from the apply-time glob entirely) as a
      stronger, not-yet-built option.
- [x] 5.2 In `README.md`, add a short "**Hold-out scenarios.**" paragraph
      near the existing "**Skip filters.**" paragraph (in the eval section)
      describing the same apply-time-only visibility split in one or two
      sentences, consistent with that paragraph's tone.

### 6. Verify

- [x] 6.1 Run `pnpm build && pnpm vitest run holdout` and confirm exit 0.
