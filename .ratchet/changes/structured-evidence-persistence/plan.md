# structured-evidence-persistence

## Why

`judgeAgent`/`judgeCheck` already compute a resolved rubric, every juror's
individual per-clause vote, and (for a skip) the matched source/detail — but
`execute.ts` flattens all of it into one `CaseRecord.reason` string before
`persistRun` writes the run JSON, and every other juror's vote is discarded
the moment `resolveVotes` picks a deciding one. The judge-hardening phase
needs that already-computed detail to survive into the run JSON and the
report/CLI surfaces, so a verdict or a skip is auditable structurally instead
of only as prose — without touching how a verdict is decided.

## What Changes

- `src/core/eval/judge.ts`: the private `AgentVote` interface is renamed and
  exported as `JurorVote` (`{ pass: boolean; clauses: ClauseResult[] }`) — the
  same shape, now public so `run.ts`/`report.ts` can reference it.
  `CaseVerdict` gains `rubric: string[]` (the resolved rubric used to judge
  the case) and `votes: JurorVote[]` (every juror's individual vote, in cast
  order); `evidence: ClauseResult[]` is unchanged and keeps meaning "the
  deciding vote's per-clause result" (or `votes[0]` on a clean fail/sub-quorum,
  exactly as today).
  - `resolveVotes`'s return type narrows to a new `VoteResolution = {
    verdict: Verdict; evidence: ClauseResult[] }` (a structural subset of
    `CaseVerdict`) so its existing signature, tests, and majority/unanimous/
    sub-quorum behavior are untouched.
  - `judgeAgent` builds the full `CaseVerdict` by spreading `resolveVotes`'s
    result together with the `rubric` it already derived and the `votes`
    array it already collected: `{ ...resolveVotes(votes, quorum), rubric,
    votes }`.
  - `judgeCheck` (deterministic path) sets `rubric: [binding.check.pass]` and
    `votes: [{ pass, clauses: <the existing one-item clauses array> }]` on
    both its pass and fail branches, keeping the uniform one-clause/one-vote
    shape `rubric-decomposition` already established for deterministic cases.
  - `unjudgedModeMismatch` sets `rubric: []`, `votes: []`.
- `src/core/eval/run.ts`: `CaseRecord` gains four optional fields —
  `rubric?: string[]`, `clauses?: ClauseResult[]`, `votes?: JurorVote[]`
  (present only on a judged case; absent for `unjudged`/`unbound`/disabled-
  contributor/manual records, which have no judging detail to carry), and
  `skip?: { source: 'tag' | 'config'; detail: string }` (present only on a
  `skipped` record). `reason: string` is unchanged and keeps carrying the
  flattened human sentence every consumer already reads.
- `src/core/eval/execute.ts`: `judgeBound` copies `verdict.rubric`,
  `verdict.evidence` (as `clauses`), and `verdict.votes` onto the returned
  `CaseRecord` alongside the existing `reason`. `skipped(reason: SkipReason)`
  adds `skip: { source: reason.source, detail: reason.detail }` onto the
  record it already builds from the same `SkipReason` it flattens into
  `reason`. The stale doc comment on `summarizeEvidence` ("the run JSON gains
  structured per-clause persistence in a later judge-hardening change") is
  removed — this is that change.
- `src/core/eval/report.ts`: new `CaseDetail` interface — `{ id, scenario,
  verdict, source, rubric: string[], clauses: ClauseResult[], votes:
  JurorVote[], skip?: { source, detail } }` — one entry per case in
  `run.cases`, defaulting `rubric`/`clauses`/`votes` to `[]` when the record
  carries none. `EvalReport` gains `cases: CaseDetail[]`, populated by
  `buildReport` alongside the existing `failing`/`unjudgedCases`/`diff`.
  `FailingCase` and `scoreRun`/`diffAgainstBaseline` are unchanged — this adds
  a new, complete per-case view rather than reshaping the existing
  failure-focused one.
- `src/commands/eval/run.ts`: the `--json` output object gains `cases:
  report.cases`, alongside the fields it already prints
  (`runId`/`overall`/`scorecard`/`contributors`/...).
- `src/commands/eval/report.ts`: `eval report --json` already prints the
  whole `EvalReport` (`JSON.stringify(report, ...)`), so `cases` is surfaced
  there for free. `renderReport`'s text path gains, per failing case, the
  per-clause pass/fail breakdown (looked up from `report.cases`) printed
  under the existing evidence line, plus a one-line juror tally (`Jury: x/y
  passed`) when `votes.length > 1`.
- Implements `features/eval-judge/structured-evidence-persistence.feature` in
  this change.
- `src/core/eval/index.ts` barrel: export `type JurorVote` from `judge.ts`
  and `type CaseDetail` from `report.ts`.
- Out of scope: any change to `resolveVotes`'s pass/fail/quorum decision,
  `resolveSkip`'s matching, or `aggregate.ts`'s AND-over-contributors gate —
  this slice only changes what survives into the persisted/displayed record
  of a decision those modules already make.

## Design

- **Persist what is already computed, change no decision.** Every field this
  slice adds (`rubric`, `votes`, `clauses`, `skip`) already exists as an
  in-memory value before this change — `deriveRubric`'s output, the `votes:
  JurorVote[]` array `judgeAgent` collects before calling `resolveVotes`, and
  `resolveSkip`'s structured `SkipReason`. The change is purely "stop
  discarding it before `persistRun`/`buildReport` run," which is why
  `aggregate.ts`, `resolveVotes`'s majority/unanimous logic, and
  `resolveSkip`'s matching need zero edits — satisfying the phase goal's
  "without changing where the judge plugs into the gate" directly, the same
  way the three upstream slices left `aggregate.ts` untouched.
- **`VoteResolution` keeps `resolveVotes` test-stable.** Widening
  `CaseVerdict` to require `rubric`/`votes` would force `resolveVotes` (which
  has no access to the rubric, and only decides from already-cast votes) to
  either fabricate those fields or take new parameters — churning its
  existing, already-tested signature for no behavioral reason. Splitting out
  `VoteResolution` as the narrower return type `resolveVotes` keeps, and
  letting `judgeAgent` assemble the full `CaseVerdict` by spreading
  `VoteResolution` plus the `rubric`/`votes` it already has in scope, is a
  pure additive change at the one call site that has both halves.
- **`AgentVote` becomes `JurorVote`, not a parallel type.** The phase's
  definition of done asks for "each juror's individual vote (clauses +
  verdict)" persisted; that is exactly the shape `AgentVote` already is.
  Renaming and exporting it (rather than defining a second, structurally
  identical "persisted vote" type) keeps one type for "what a juror decided,"
  reused unchanged from in-memory judging through to the persisted
  `CaseRecord.votes` and the report's `CaseDetail.votes`. No test references
  the type by its old name (`AgentVote` is never imported), so the rename is
  a clean, non-breaking internal change.
- **Deterministic cases get the same uniform shape as `llm-judge` ones.**
  `rubric-decomposition` already chose to wrap a deterministic check's single
  pass condition as a one-item `clauses` array so `CaseVerdict` has one shape
  across both binding kinds; this slice continues that choice by also giving
  `judgeCheck` a one-item `rubric` and a one-element `votes` array (the check
  standing in as its own sole "juror"). This keeps `CaseRecord.rubric`/
  `.votes` populated unconditionally on every judged path instead of only on
  `llm-judge` ones, so `report.ts`'s `CaseDetail` needs no binding-kind
  branch.
- **`reason` stays the single flattened string every existing consumer
  reads.** `summarizeEvidence` is unchanged; `CaseRecord.reason` keeps being
  the human sentence `FailingCase.evidence`, `renderReport`'s evidence line,
  and the baseline-skip warning already depend on. The new fields are
  additive siblings, not a replacement — no existing reader of `reason`
  changes behavior.
- **`skip` is a structured sibling of the existing flattened sentence, not a
  replacement for it.** `skip-filters` explicitly deferred "a dedicated
  structured field for the skip source/reason" to this change; `flattenSkipReason`
  is unchanged (the `reason` sentence still reads the same), and `skip:
  { source, detail }` is read straight from the same `SkipReason` `resolveSkip`
  already returns, with no new matching logic.
- **`report.ts` exposes one new `cases: CaseDetail[]` list rather than
  reshaping `FailingCase`.** The phase's definition of done asks for every
  judged case's structured detail, not only failing ones — `FailingCase`
  exists specifically for the failing-case-with-evidence view `eval
  report`/`eval run` already render and stays as is. `CaseDetail` is the one
  place that walks every case in `run.cases` (judged, skipped, or
  unjudged/unbound alike) and surfaces its full record, giving `--json`
  consumers one complete structural view without duplicating fields across
  two case lists.
- **CLI surfacing follows the existing JSON/text split.** `eval report
  --json` already serializes the entire `EvalReport`, so adding `cases` to
  the type surfaces it there with no command-layer code change (the same
  "free" pattern `skip-filters` used for the `skipped` scorecard count).
  `eval run --json` cherry-picks fields today, so `cases` is added to that
  cherry-picked object explicitly. Text output is extended minimally — only
  `eval report`'s already-existing failing-case loop gains the per-clause/
  juror-tally lines — rather than printing full per-case detail for every
  passing case in either command's text mode, keeping the terse scorecard-style
  output `eval run`'s text path already has.

## Tasks

- [x] 1.1 In `src/core/eval/judge.ts`: rename `AgentVote` to `JurorVote` and
  export it; add `rubric: string[]` and `votes: JurorVote[]` to
  `CaseVerdict`; introduce `VoteResolution = { verdict: Verdict; evidence:
  ClauseResult[] }` as `resolveVotes`'s (and `subQuorum`'s) return type
- [x] 1.2 In `judgeAgent`, build the returned `CaseVerdict` as `{
  ...resolveVotes(votes, quorum), rubric, votes }` using the `rubric` and
  `votes` it already computes
- [x] 1.3 In `judgeCheck`, add `rubric: [binding.check.pass]` and a one-item
  `votes: [{ pass, clauses }]` to both the pass and fail return branches; in
  `unjudgedModeMismatch`, add `rubric: []`, `votes: []`
- [x] 1.4 In `src/core/eval/run.ts`, add `rubric?: string[]`, `clauses?:
  ClauseResult[]`, `votes?: JurorVote[]`, and `skip?: { source: 'tag' |
  'config'; detail: string }` to `CaseRecord` (import `ClauseResult`,
  `JurorVote` from `./judge.js`)
- [x] 1.5 In `src/core/eval/execute.ts`: `judgeBound` copies
  `verdict.rubric`, `verdict.evidence` (as `clauses`), and `verdict.votes`
  onto the `CaseRecord` it returns; `skipped(reason)` adds `skip: {
  source: reason.source, detail: reason.detail }`; remove the now-stale
  forward-reference comment on `summarizeEvidence`
- [x] 1.6 In `src/core/eval/report.ts`, add `CaseDetail` (`id, scenario,
  verdict, source, rubric, clauses, votes, skip?`), a `caseDetails(run):
  CaseDetail[]` builder defaulting `rubric`/`clauses`/`votes` to `[]` when a
  record carries none, and `cases: CaseDetail[]` on `EvalReport`, populated in
  `buildReport`
- [x] 1.7 In `src/commands/eval/run.ts`, add `cases: report.cases` to the
  `--json` output object
- [x] 1.8 In `src/commands/eval/report.ts`'s `renderReport`, for each printed
  failing case look up its `CaseDetail` from `report.cases` and print each
  clause's pass/fail mark beneath the existing evidence line, plus a `Jury:
  x/y passed` line when `votes.length > 1`
- [x] 1.9 In `src/core/eval/index.ts`, export `type JurorVote` from
  `judge.ts` and `type CaseDetail` from `report.ts`
- [x] 1.10 Unit tests per [[testing]]: `judge.test.ts` — `judgeAgent`/
  `judgeCase` (llm-judge) returns `rubric` matching the derived/declared
  rubric and `votes` with one entry per cast vote (each carrying its own
  `pass`/`clauses`), including a sub-quorum case where `votes` still holds
  every dissenting vote; `judgeCheck` returns a one-item `rubric` and a
  one-element `votes` array on both pass and fail; `run.test.ts` —
  `persistRun`/`loadRun` round-trips `rubric`/`clauses`/`votes`/`skip` on a
  `CaseRecord` unchanged; `execute.test.ts` (or the existing execute coverage
  in `judge.test.ts`/`run.test.ts`, whichever already exercises
  `executeRun`) — a skipped case's persisted record carries `skip.source`
  `"tag"` for an `@skip` match and `"config"` with the matched pattern for an
  `eval.skip` match, an unbound/disabled-contributor/manual record carries no
  `rubric`/`clauses`/`votes`; `report.test.ts` — `buildReport`'s `cases`
  includes one `CaseDetail` per run case with the expected rubric/clauses/
  votes/skip, and the existing overall-verdict/contributor/scorecard
  assertions are unchanged by the new field
- [x] 1.11 E2E test in `test/cli-e2e/eval.test.ts` per [[testing]]: `eval run
  --json` and `eval report --run <id> --json` both include `cases[]` with a
  judged case's `rubric`/`clauses`/`votes` and a skipped case's `skip`
  source/detail
- [x] 1.12 Per [[documentation]]: in `docs/commands/eval.md`, add a numbered
  step to `eval run`'s Behavior section (after "Persistence") and to `eval
  report`'s Behavior section noting the run JSON's per-case `rubric`,
  `clauses`, `votes`, and `skip` fields and that `eval run --json`/`eval
  report --json` surface them under `cases[]`; update the `--json` Options
  rows for both commands to mention the `cases[]` shape. Update README.md's
  "The agent judge is rubric-driven and guarded" paragraph (~line 424) and
  "Skip filters" paragraph (~line 445) to note the run JSON persists this
  structured per-case detail (rubric, per-clause evidence, per-juror votes,
  skip source/detail), surfaced via `eval run`/`eval report --json`
