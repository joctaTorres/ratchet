# Hold-out tag resolution

## Why

The `holdout-scenarios` phase needs one shared, pure source of truth for "is
this case held out" before apply-time filtering, `eval set` reporting, or a
`--holdout` scope filter can be built on top of it. Deriving that status first,
in isolation, keeps each downstream change a thin, independently-provable slice
instead of re-deriving hold-out status ad hoc in three different call sites.

## What Changes

- New pure resolver `resolveHoldout()` in `src/core/eval/holdout.ts`, mirroring
  the shape of `resolveSkip()` in `src/core/eval/skip.ts`: synchronous,
  in-memory, no filesystem, no spawn, called with an `EvalCase`.
- Exports the `HOLDOUT_TAG = '@holdout'` constant, matching `SKIP_TAG`'s
  pattern in `skip.ts`.
- Unlike `resolveSkip()`, there is no project-config layer to check (no
  `eval.holdout` key) — the return is a plain `boolean`, not a reason object,
  because there is exactly one source (the tag) and nothing else to report.
- Implements `features/eval-holdout/holdout-tag-resolution.feature`.
- No change to `EvalCase`, `gherkin-parser.ts`, `execute.ts`, `aggregate.ts`,
  `report.ts`, or any CLI surface — this slice only adds the resolver and its
  tests. Wiring it into apply-time spec assembly, `eval set` output, and the
  `--holdout` CLI scope filter is explicitly out of scope here and belongs to
  the phase's next three changes (`apply-spec-holdout-filter`,
  `eval-set-holdout-status`, `holdout-scope-filter`), per the batch's
  vertical-slice strategy.

## Design

**Mirrors `resolveSkip()`'s shape, not its full signature.** `resolveSkip(c,
patterns?)` exists because `@skip` has two independent sources (an in-file tag
and a project `eval.skip` config glob) that must be tried in order and the
caller needs to know which one fired (`SkipReason.source`). `@holdout` has
exactly one source per the phase's definition of done ("tag-only, no new
`eval.holdout` config key"), so `resolveHoldout(c: EvalCase): boolean` takes no
second argument and returns a plain boolean rather than a reason object —
matching resolveSkip's purity and placement (`src/core/eval/`, same layer as
`skip.ts`/`gate.ts`/`jury.ts`) without carrying over machinery (a config-source
branch, a `detail` field) that would have nothing to populate it.

**Reads `EvalCase.tags`, which is already Scenario-scoped — by design, not by
gap.** `gherkin-parser.ts` accumulates `@`-prefixed tag lines into
`pendingTags` and attaches them to the next `Scenario:`/`Scenario Outline:`
block; tags preceding the `Feature:` line are intentionally discarded
(`pendingTags = []` right after the `Feature:` match, added deliberately in the
`skip-filters` change so a stray tag can't leak into the first scenario). There
is no separate feature-level tag facility to read from today, and adding one is
a parser change this slice's definition of done explicitly excludes ("no
parser change needed"). `resolveHoldout()` therefore resolves hold-out status
per Scenario, exactly as `resolveSkip()` already does for `@skip` — an entire
feature file is held out by tagging every one of its scenarios `@holdout`, and
`resolveHoldout()` is the same pure per-scenario check either way. The stronger
"exclude a whole feature file via sibling-location isolation" alternative
(keeping held-out `.feature` files out of the apply-time glob entirely) is a
documented option for `apply-spec-holdout-filter`, not a gap in this resolver.

**Standards applicability for this slice.** `testing` applies: `holdout.ts` is
a pure evaluator/policy (deterministic function over an in-memory `EvalCase`),
so it gets unit tests with no filesystem or process spawn, mirroring the
`.feature` in the test header per the standard. `documentation`,
`multi-agent-support`, `generalizable-defaults`, and `delegated-lifecycle` are
out of scope for this specific slice: there is no new/changed CLI command,
flag, config key, generated artifact, or externally-observable behavior yet
(`documentation`'s "Applies to" is scoped to user-facing surfaces — none exists
until `eval-set-holdout-status`/`holdout-scope-filter` land); no skill,
command, or template is added (`multi-agent-support`); no default or literal
ships into a consuming project (`generalizable-defaults`); and no batch-engine
or agent-spawning code is touched (`delegated-lifecycle`). The later changes in
this phase that do add a user-facing surface each carry their own mandatory
documentation task per the batch manifest's `done` text.

## Tasks

### 1. Resolver

- [x] 1.1 Add `src/core/eval/holdout.ts` exporting `HOLDOUT_TAG = '@holdout'`
      and `resolveHoldout(c: EvalCase): boolean`, returning whether
      `c.tags` includes `HOLDOUT_TAG`.

### 2. Tests

- [x] 2.1 Add `test/core/eval/holdout.test.ts` (header names
      `features/eval-holdout/holdout-tag-resolution.feature`) covering: a
      case tagged `@holdout` resolves `true`; a case with no tags resolves
      `false`; a case with other tags (`@wip`, `@smoke`) but not `@holdout`
      resolves `false`; a case tagged both `@holdout` and `@skip` resolves
      `true` for hold-out independent of skip status.
- [x] 2.2 Run `pnpm build && pnpm vitest run holdout` and confirm exit 0.
