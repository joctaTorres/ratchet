# jury-quorum-resolution

## Why

Today `resolveVotes` hard-codes a single, asymmetric, undocumented tie-break
(majority wins a pass, but only a unanimous fail among the cast votes wins a
clean fail; anything else is `unjudged`), and the number of votes is the one
flat `agentVotes` field with no project-level default and no way to require
unanimity. The judge-hardening phase needs a real, configurable jury — a
`votes` + `quorum` block layered from a project default down to a per-binding
override — before panel/skip/persistence work can build on it, and it needs an
inert `panel:` slot reserved now so a future cross-family panel never requires
a schema migration.

## What Changes

- New `src/core/eval/jury.ts` module (mirrors the existing `gate.ts` pure
  resolver): `JurySchema` (zod) for the shape `{ votes?, quorum?, panel? }`,
  and a pure `resolveJury({ config, binding })` that layers a per-binding
  override over a project-level default over the built-in default
  (`votes: 1`, `quorum: 'majority'`), field by field.
- `JurySchema.panel` is a real, validated sub-schema (`{ families:
  string[] (min 1) }`) that is **parsed and retained but never read** by vote
  resolution in this slice — the reserved slot for a future cross-family
  panel called out in the batch's deferred-scope list.
- `LlmJudgeBindingSchema` (`src/core/eval/spec.ts`) replaces `agentVotes:
  z.number().int().positive().optional()` with `jury: JurySchema.optional()`.
  **BREAKING**: a binding authored with `agentVotes:` must move to `jury:
  { votes: N }`.
- `ProjectConfigSchema.eval` (`src/core/project-config.ts`) gains `jury:
  JurySchema.optional()`, read from `.ratchet/config.yaml`'s `eval.jury` the
  same way `eval.gate` already is — no change needed to `readProjectConfig`'s
  generic eval-field parsing, since it already round-trips the whole `eval`
  sub-schema through one `safeParse`.
- `judge.ts`: `JudgeDeps` gains an optional `jury?: Jury` (the project-level
  default, resolved by the caller); `judgeAgent` calls `resolveJury({ config:
  deps.jury, binding: binding.jury })` to get the effective `{votes, quorum}`
  instead of reading `binding.agentVotes` directly, and casts that many votes.
- `resolveVotes(votes, quorum)` gains a `quorum` parameter and is rewritten
  around two **symmetric** definitions instead of the old asymmetric
  pass-favoring/fail-favoring split:
  - `majority`: `pass` when passing votes are a strict majority, `fail` when
    failing votes are a strict majority, otherwise (a tie) quorum is not
    reached.
  - `unanimous`: `pass` only when every vote passes, `fail` only when every
    vote fails, otherwise (any split) quorum is not reached.
  - Not reaching quorum always records `unjudged` (never a guess), with the
    reason naming the configured quorum and the vote tally.
- `commands/eval/shared.ts` gains `resolveJuryDefault(root): Jury | undefined`
  (reads `readProjectConfig(root)?.eval?.jury`), called from
  `commands/eval/run.ts` and threaded into `executeRun(root, { ..., judge: {
  jury } })` — the same shape `resolveContributorGate` already uses for
  `eval.gate`.
- `src/core/eval/index.ts` barrel exports `resolveJury`, `JurySchema`, and the
  `Jury`/`Quorum` types alongside the existing `judge.ts`/`gate.ts` exports.
- Migrates every `agentVotes` reference to the new `jury` shape: the one live
  usage in `.ratchet/evals/specs/eval-self.yaml` (dropped — `votes: 1,
  quorum: majority` is already the default), the authoring guidance in
  `src/core/templates/workflows/eval.ts`, and the existing tests in
  `test/core/eval/judge.test.ts`, `test/core/eval/spec.test.ts`, and
  `test/cli-e2e/eval.test.ts`.
- Implements `features/eval-judge/jury-quorum-resolution.feature` in this
  change.
- Out of scope (explicitly deferred to later judge-hardening changes, per the
  batch manifest): structured per-juror vote persistence in the run JSON
  (`structured-evidence-persistence`), skip filters (`skip-filters`), and any
  actual cross-family panel evaluation (the batch's deferred-scope list keeps
  that schema-reserved-only).

## Design

- **A new pure `jury.ts`, not logic inlined in `judge.ts`.** `gate.ts` already
  establishes the pattern this phase uses for "project default + per-call
  override resolves to an effective value": a schema, a pure resolver with no
  I/O, consumed by a thin command-layer wrapper that supplies the config side
  via `readProjectConfig`. `jury.ts` follows the same shape so both `spec.ts`
  (binding-level `jury:`) and `project-config.ts` (project-level `eval.jury`)
  import one schema with no circular dependency between them.
- **Layering is field-by-field, not whole-object.** `resolveJury` resolves
  `votes` and `quorum` independently (`binding.votes ?? config.votes ??
  DEFAULT`, same for `quorum`) so a binding can override just the quorum
  while still inheriting the project's vote count, matching how `gate.ts`
  layers each contributor id independently rather than replacing the whole
  set.
- **Majority and unanimous both become symmetric, replacing the old
  pass-favoring heuristic.** The current code requires only a single pass to
  block a clean fail ("mixed but fail-leaning... disagreement, not a clean
  fail") while requiring nothing but `passes > fails` for a clean pass — an
  asymmetry that was never a named, configurable quorum. Defining `majority`
  as "strict majority on either side decides; a tie does not reach quorum"
  and `unanimous` as "all-or-nothing; any split does not reach quorum" gives
  both quorum kinds one rule applied uniformly to both outcomes, and a single
  vote (the default) trivially satisfies either quorum the same way it always
  has (no behavior change for the common single-vote case).
- **Sub-quorum is `unjudged`, sharing the existing fail-closed shape.** The
  current `disagreement()` helper already produces an `unjudged` `CaseVerdict`
  with a vote-tally reason; it is renamed/generalized to name the quorum that
  was not reached (`majority`/`unanimous`) instead of always saying
  "disagreed", and is reached by both quorum kinds' "not reached" branch
  instead of being majority-specific.
- **`panel:` is schema-only by design.** The batch's deferred-scope list is
  explicit that cross-family panel *evaluation* is YAGNI for this phase —
  only the config shape is reserved so a future panel feature is additive
  (no breaking schema change). `resolveJury` and `resolveVotes` never read
  `jury.panel`; it round-trips through `JurySchema.safeParse` for validation
  only. A malformed `panel` (e.g. an empty `families` list) fails the whole
  binding/config validation the same way any other invalid field does today
  (`spec.ts`'s warn-and-drop for bindings, `project-config.ts`'s warn-and-drop
  for `eval.jury`).
- **No change to where the contributor plugs into the gate.** `aggregate.ts`'s
  `llmJudgeContributor` and `execute.ts`'s `judgeBound` call `judgeCase`
  exactly as before; only the internals of `judgeAgent`/`resolveVotes` change
  shape. `CaseRecord.reason` continues to come from `execute.ts`'s
  `summarizeEvidence(verdict.evidence)` — structured per-juror persistence is
  the downstream `structured-evidence-persistence` change's concern, not
  this one's.
- **Project-level default plumbing mirrors the gate's, not `execute.ts`'s
  internals.** `execute.ts` keeps taking an opaque `JudgeDeps` and passing it
  through unchanged; the command layer (`commands/eval/run.ts`) is the one
  new call site that resolves `eval.jury` via `resolveJuryDefault` and passes
  it down, the same place `resolveContributorGate` already resolves
  `eval.gate`. This needs no change to `execute.ts`'s function signature.
- **Clean rename over a compatibility alias.** `agentVotes` has exactly one
  live usage in the repo's own dogfood specs and is pre-1.0 internal eval
  config; keeping both `agentVotes` and `jury.votes` as parallel ways to set
  vote count would immediately create the kind of dual-source-of-truth this
  batch's invariants explicitly guard against. The migration list above is
  small and is part of this change's tasks.

## Tasks

- [x] 1.1 Create `src/core/eval/jury.ts`: `JurySchema` (`votes:
  z.number().int().positive().optional()`, `quorum:
  z.enum(['majority','unanimous']).optional()`, `panel:` a validated-but-inert
  `{ families: z.array(z.string().min(1)).min(1) }` sub-schema, optional),
  exported `Jury`/`Quorum`/`ResolvedJury` types, and a pure `resolveJury({
  config?: Jury; binding?: Jury }): { votes: number; quorum: Quorum }`
  defaulting to `votes: 1, quorum: 'majority'`, resolving `votes`/`quorum`
  independently (binding overrides config overrides default)
- [x] 1.2 In `src/core/eval/spec.ts`, replace `LlmJudgeBindingSchema`'s
  `agentVotes` field with `jury: JurySchema.optional()` (import `JurySchema`
  from `./jury.js`)
- [x] 1.3 In `src/core/project-config.ts`, add `jury: JurySchema.optional()`
  to the `eval` object schema (import `JurySchema` from `./eval/jury.js`)
- [x] 1.4 In `src/core/eval/judge.ts`: add `jury?: Jury` to `JudgeDeps`; change
  `judgeAgent` to resolve `{votes, quorum}` via `resolveJury({ config:
  deps.jury, binding: binding.jury })` instead of reading `binding.agentVotes`
  directly, and pass `quorum` into `resolveVotes`
- [x] 1.5 Rewrite `resolveVotes(votes: AgentVote[], quorum: Quorum =
  'majority'): CaseVerdict` with symmetric majority/unanimous resolution:
  `majority` passes on a strict pass-majority, fails on a strict
  fail-majority, else sub-quorum; `unanimous` passes only on all-pass, fails
  only on all-fail, else sub-quorum; rename `disagreement()` to a
  quorum-aware sub-quorum helper that names the configured quorum and vote
  tally in its `unjudged` evidence
- [x] 1.6 In `src/commands/eval/shared.ts`, add `resolveJuryDefault(root:
  string): Jury | undefined` reading `readProjectConfig(root)?.eval?.jury`;
  in `src/commands/eval/run.ts`, call it and pass `judge: { jury }` into
  `executeRun`
- [x] 1.7 Export `resolveJury`, `JurySchema`, `Jury`, `Quorum`,
  `ResolvedJury` from `src/core/eval/index.ts`
- [x] 1.8 Migrate every existing `agentVotes` usage to `jury`: drop the
  redundant `agentVotes: 1` line from `.ratchet/evals/specs/eval-self.yaml`,
  update the authoring guidance in `src/core/templates/workflows/eval.ts` to
  describe the `jury` block, and update `test/core/eval/judge.test.ts`,
  `test/core/eval/spec.test.ts`, and `test/cli-e2e/eval.test.ts` to construct
  `jury: { votes: N }` (and `quorum:` where a test exercises unanimous)
  instead of `agentVotes: N`
- [x] 1.9 Add unit tests for `resolveJury` (no config/binding → default;
  project default alone; per-binding override of both fields; per-binding
  override of one field falling back to the project default for the other)
  and for `resolveVotes` under both quorum kinds (majority pass-majority,
  majority fail-majority, majority tie → unjudged, unanimous all-pass,
  unanimous all-fail, unanimous any-split → unjudged), plus a `JurySchema`
  test asserting a valid `panel` parses and round-trips while an invalid one
  (empty `families`) is rejected, per [[testing]]
- [x] 1.10 Add a project-config test (`test/core/project-config.test.ts`)
  mirroring the existing `eval.gate` coverage: a valid `eval.jury` map is
  kept, and an invalid one (e.g. `quorum: sometimes`) is warned-and-dropped,
  per [[testing]]
- [x] 1.11 Per [[documentation]]: update `docs/commands/eval.md`'s
  "LLM-judge binding" example/table (replace `agentVotes` with `jury:
  { votes, quorum }`) and "Agent judge guarantees" section (describe
  majority/unanimous quorum and sub-quorum → `unjudged`, replacing the old
  majority-only wording); add a `jury` row to the `## eval: settings` table
  in `docs/configuration/config-yaml.md` describing `votes`, `quorum`, and
  the reserved-but-inert `panel`; update `README.md`'s `llm-judge` binding
  example and "The agent judge is rubric-driven and guarded" paragraph; update
  `.ratchet/evals/README.md`'s `agentVotes` mention — all to describe the new
  `jury` block and quorum behavior
