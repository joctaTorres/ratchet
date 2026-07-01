# skip-filters

## Why

Today every enumerated case with a binding is judged unconditionally — there is
no way to deliberately exclude a case from a run (a known-flaky scenario, a
work-in-progress one, one deferred on purpose) without deleting its spec or
leaving it unbound, both of which either lose the binding or land on
`unjudged` — a status that already means "couldn't determine a verdict," not
"the team chose not to judge this." The judge-hardening phase needs a
transparent, counted skip path — two sources (project config, in-file tag) and
a CLI override — before the downstream `structured-evidence-persistence`
change can persist *why* a case was skipped.

## What Changes

- `src/core/parsers/gherkin-parser.ts` stops discarding `@tag` lines: it
  accumulates pending tag lines (`@skip`, `@wip @skip`, …) and attaches them to
  the next `Scenario:`/`Scenario Outline:` block, clearing the buffer at each
  scenario boundary. `ScenarioSchema`/`FeatureScenario`
  (`src/core/schemas/feature.schema.ts`) gains `tags: z.array(z.string()).default([])`.
  General tag capture (not skip-specific) so a future tag consumer (e.g. the
  upcoming `@holdout` tag) reads the same field.
- `EvalCase` (`src/core/eval/set.ts`) gains `tags: string[]`, carried straight
  from the parsed scenario's tags.
- New `src/core/eval/skip.ts` (mirrors `gate.ts`/`jury.ts`): exports
  `SKIP_TAG = '@skip'` and a pure `resolveSkip(c: EvalCase, patterns?:
  string[]): SkipReason | null` returning `{ source: 'tag' | 'config'; detail:
  string }` when the case is tagged `@skip` or its id matches an `eval.skip`
  glob pattern (tag checked first), `null` otherwise. No filesystem, no I/O.
- `ProjectConfigSchema.eval` (`src/core/project-config.ts`) gains `skip:
  z.array(z.string().min(1)).optional()`, read from `.ratchet/config.yaml`'s
  `eval.skip` the same generic way `gate`/`jury` already round-trip.
- `src/commands/eval/shared.ts` gains `resolveSkipConfig(root: string):
  string[] | undefined` (reads `readProjectConfig(root)?.eval?.skip`),
  mirroring `resolveJuryDefault`.
- `src/core/eval/execute.ts` (`executeRun`): `RunOptions` gains `skip?:
  string[]` and `includeSkipped?: boolean`. For each case, **before**
  resolving its binding, `executeRun` checks `resolveSkip(c, options.skip)`
  (skipped entirely when `options.includeSkipped` is true); a match records
  `CaseRecord { verdict: 'skipped', reason: '<source + matched tag/pattern>',
  source: 'judged' }` and the case is never bound, no fixture is
  materialized, and no judge is spawned for it.
- `src/core/eval/judge.ts`: `Verdict` widens from `'pass' | 'fail' |
  'unjudged'` to `'pass' | 'fail' | 'unjudged' | 'skipped'` — the one
  per-case status vocabulary `CaseRecord.verdict` already uses gains its
  fourth member. `judgeCase`/`resolveVotes` never produce `'skipped'`
  themselves (the skip decision short-circuits in `execute.ts` before any
  judging happens); the widened type only makes the new `CaseRecord` value
  legal.
- `src/core/eval/report.ts`: `Scorecard` gains `skipped: number`; `scoreRun`
  counts it (still included in `total`). `BaselineDiff` gains
  `skippedRegressions: string[]` — case ids whose baseline verdict was `pass`
  and whose current verdict is `skipped` — computed in the same
  `diffAgainstBaseline` loop that already computes `regressions`.
- `src/commands/eval/run.ts`: new `--include-skipped` flag
  (`EvalRunOptions.includeSkipped`), passed into `executeRun`'s options
  alongside the already-resolved `skip` patterns from `resolveSkipConfig`.
  After `buildReport`, one warning line per `report.diff.skippedRegressions`
  entry (`Case '<id>' was 'pass' in the baseline and is now skipped.`) is
  appended to the existing `warnings` array shared by the text and `--json`
  output paths — no new output shape, the existing `warn:` rendering /
  `warnings` JSON field carries it. `renderRun`'s scorecard line and the
  `--json` `scorecard` object both surface the new `skipped` count for free
  (it is just another `Scorecard` field).
- `src/cli/index.ts`: register `.option('--include-skipped', 'Judge cases
  that would otherwise be excluded by skip filters (eval.skip config or an
  in-file @skip tag)')` on the `eval run` command.
- Implements `features/eval-judge/skip-filters.feature` in this change.
- Out of scope (deferred to the downstream `structured-evidence-persistence`
  change per the batch manifest): a dedicated structured field for the skip
  source/reason on `CaseRecord` (this slice writes a human-readable sentence
  into the existing free-text `reason`, exactly like `UNBOUND`/
  `disabledContributor` already do for their non-judged statuses); `eval set`
  surfacing per-case skip status (not in this change's done-criteria).

## Design

- **Tag capture is general; skip is one consumer of it.** The def-of-done
  frames this as "captured by gherkin-parser.ts, today discarded along with
  all tags" — so the parser change captures every tag onto
  `FeatureScenario.tags`, not just `@skip`. This keeps the parser free of
  skip-specific knowledge and lets a later tag (`@holdout`, in the next phase)
  reuse the same field with no second parser change.
- **`skip.ts` follows the established `gate.ts`/`jury.ts` shape.** Both
  existing resolvers are pure functions with no I/O, consumed by a thin
  command-layer wrapper that supplies the config side via
  `readProjectConfig`. `resolveSkip` matches that shape exactly: synchronous,
  in-memory, called once per case from `execute.ts`.
- **`skipped` extends `Verdict` instead of adding a parallel status field.**
  `CaseRecord` already has exactly one per-case status (`verdict: Verdict`),
  reused for every non-`pass`/`fail` outcome today (`unjudged` for unbound
  cases, a disabled contributor, a sub-quorum jury). Adding a second "status"
  field next to `verdict` would create two competing sources of per-case
  state for no reason; a fourth `Verdict` member keeps one source. This
  choice is also why `src/core/eval/aggregate.ts` needs **zero changes**:
  `failingOfKind` only matches `verdict === 'fail'` and `isRunComplete` only
  excludes `verdict === 'unjudged'` — `'skipped'` is neither, so a skipped
  case is automatically excluded from every contributor's failing set *and*
  automatically counted complete, with no edit to the aggregation core. That
  satisfies the phase goal's "without changing where the judge plugs into the
  gate" constraint directly, the same way `jury-quorum-resolution` and
  `rubric-decomposition` left `aggregate.ts` untouched.
- **Skip is decided before binding resolution, as a full short-circuit.**
  `executeRun` checks `resolveSkip` first, using only `EvalCase.tags`/`id` —
  no binding needed — so a skip-tagged case with *no* spec binding is still
  recorded `skipped` (not `unjudged`), and, symmetrically, a skipped case
  never reaches `resolveBinding`/`FixtureManager.materialize`/`judgeCase`. No
  fixture copy, no judge spawn, for any skipped case.
- **One override flag, not one per source.** `--include-skipped` overrides
  both the config-pattern source and the in-file-tag source together,
  mirroring the existing single-flag-overrides-richer-config shape already
  used by `--no-llm-judge`/`--no-invariants`. The def-of-done does not call
  for suppressing one skip source while keeping the other live.
- **The baseline-skip warning extends the existing diff loop, not a second
  comparison.** `diffAgainstBaseline` already walks `run.cases` against
  `baseline.verdicts` to compute `regressions` (`wasPass && nowFail`).
  `skippedRegressions` adds one sibling branch (`wasPass && nowSkipped`) to
  that same loop, so there remains exactly one place a run is compared
  against its baseline. The command layer (`commands/eval/run.ts`) only
  turns the returned id list into a warning string; it does not re-derive
  baseline membership itself.
- **Skip-pattern matching is a minimal glob-to-regex match against the case
  id, no new dependency.** `eval.skip` entries are matched against the full
  case id (`<source>#<scenario-slug>`) using the same escape-special-chars,
  substitute-`*`-for-`.*`, anchor-the-whole-string technique already used in
  `src/core/legacy-cleanup.ts` for glob matching. `fast-glob` (already a
  dependency) is filesystem-oriented and not a fit for matching an in-memory
  id string, so this reuses the project's existing inline technique instead
  of adding a new glob-matching dependency.
- **Reason stays free text in this slice.** `resolveSkip`'s `SkipReason`
  carries `{ source, detail }` in-memory, but `execute.ts` flattens it into
  `CaseRecord.reason` as a sentence (e.g. `Skipped: tagged @skip in
  features/foo.feature.` / `Skipped: matched eval.skip pattern
  'features/legacy/*'.`), exactly how `UNBOUND`/`disabledContributor` already
  encode their explanation today. The downstream
  `structured-evidence-persistence` change is the one that, per the batch
  manifest, promotes per-case skip detail to a structured `CaseRecord` field;
  this change does not anticipate that shape.

## Tasks

- [x] 1.1 In `src/core/parsers/gherkin-parser.ts`, capture `@tag` lines into a
  pending-tags buffer (split on whitespace, each token starting with `@`),
  attach the buffer to the next `Scenario:`/`Scenario Outline:` block as
  `tags`, and clear the buffer at every scenario boundary (including when no
  tags preceded it, so `tags` defaults to `[]`); add `tags:
  z.array(z.string()).default([])` to `ScenarioSchema` in
  `src/core/schemas/feature.schema.ts`
- [x] 1.2 In `src/core/eval/set.ts`, add `tags: string[]` to `EvalCase` and
  populate it from `scenario.tags` in `casesFromFile`
- [x] 1.3 Create `src/core/eval/skip.ts`: `SKIP_TAG = '@skip'`; an exported
  `SkipReason { source: 'tag' | 'config'; detail: string }`; a pure
  `resolveSkip(c: EvalCase, patterns?: string[]): SkipReason | null` that
  returns a `tag` reason when `c.tags.includes(SKIP_TAG)`, else a `config`
  reason when any pattern in `patterns` glob-matches `c.id` (escape regex
  specials, substitute `*` → `.*`, anchor full-string), else `null`
- [x] 1.4 In `src/core/project-config.ts`, add `skip:
  z.array(z.string().min(1)).optional()` to the `eval` object schema
- [x] 1.5 In `src/commands/eval/shared.ts`, add `resolveSkipConfig(root:
  string): string[] | undefined` reading `readProjectConfig(root)?.eval?.skip`
- [x] 1.6 In `src/core/eval/judge.ts`, widen `Verdict` to `'pass' | 'fail' |
  'unjudged' | 'skipped'`
- [x] 1.7 In `src/core/eval/execute.ts`: add `skip?: string[]` and
  `includeSkipped?: boolean` to `RunOptions`; in `executeRun`'s per-case loop,
  before resolving the binding, call `resolveSkip(c, options.skip)` (skip the
  check entirely when `options.includeSkipped`); on a match push the case
  snapshot (with `bindingKind: null` — no binding lookup needed) and record
  `CaseRecord { verdict: 'skipped', reason: <flattened source+detail
  sentence>, source: 'judged' }`, then `continue` before any binding
  resolution, fixture materialization, or `judgeCase` call
- [x] 1.8 In `src/core/eval/report.ts`: add `skipped: number` to `Scorecard`
  and count it in `scoreRun` (still counted in `total`); add
  `skippedRegressions: string[]` to `BaselineDiff` and populate it in
  `diffAgainstBaseline`'s existing per-case loop (`wasPass && verdictOf(run,
  c.id) === 'skipped'`)
- [x] 1.9 In `src/commands/eval/run.ts`: add `includeSkipped?: boolean` to
  `EvalRunOptions`; call `resolveSkipConfig(root)` and pass `{ skip,
  includeSkipped: options.includeSkipped }` into `executeRun`'s options;
  after `buildReport`, map `report.diff.skippedRegressions` into warning
  strings and include them in both the text (`renderRun`) and `--json`
  warnings output; add the `skipped` count to `renderRun`'s scorecard line
- [x] 1.10 In `src/cli/index.ts`, add `.option('--include-skipped', 'Judge
  cases that would otherwise be excluded by skip filters (eval.skip config or
  an in-file @skip tag)')` to the `eval run` command registration
- [x] 1.11 Unit tests per [[testing]]: `gherkin-parser.test.ts` (a tagged
  Scenario gets `tags`, an untagged one gets `[]`, multiple tags on one line,
  tags reset between scenarios); `skip.test.ts` (`@skip` tag wins regardless
  of config, a matching `eval.skip` glob pattern, a non-matching pattern, no
  config and no tag → `null`); `report.test.ts` (`scoreRun` counts `skipped`
  separately from `unjudged` and includes it in `total`;
  `diffAgainstBaseline` populates `skippedRegressions` only for a case that
  was `pass` in the baseline and is `skipped` now, and leaves it empty for a
  case with no baseline entry)
- [x] 1.12 E2E tests in `test/cli-e2e/eval.test.ts` per [[testing]]: a
  `@skip`-tagged scenario with no binding still runs (no fixture/agent
  needed) and is reported `skipped`, not `unjudged`; an `eval.skip`
  config pattern excludes a bound case from judging (its fixture is left
  broken/unwritten to prove it was never materialized); `--include-skipped`
  judges a case that would otherwise be skipped by either source; a run with
  only skipped/judged (no unjudged) cases promotes to baseline; a later run
  that skips a case which was `pass` in the promoted baseline prints a
  warning naming the case
- [x] 1.13 Per [[documentation]]: update `docs/commands/eval.md`'s `eval run`
  Synopsis/Options (`--include-skipped`) and Behavior (skip filters run
  before fixture materialization/judging, the `skipped` scorecard count, the
  baseline-pass-now-skipped warning); add a `skip` row to the `## eval:`
  settings table and accompanying prose in
  `docs/configuration/config-yaml.md` describing the glob-pattern-on-case-id
  match and its interaction with the in-file `@skip` tag; update
  `README.md`'s `eval run` command-table row (add `--include-skipped`) and
  "Verdicts & baseline" section (case states become `pass`, `fail`,
  `unjudged`, or `skipped`, with skip filters summarized)
