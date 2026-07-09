# apply-boundary-pr-wiring

## Why

Phase 3 makes the engine spawn one PR agent per stacked group boundary
(`engine-spawn-at-boundaries`), keyed and idempotent per group, with each
group's stacked base injected as data. But nothing in the user-visible loop ever
selects a per-boundary PR step: `batch apply` only surfaces the *whole-batch*
completion PR (`pr-step-apply-wiring`). This is the CLI wiring slice for stacked
modes — `batch apply` must surface one PR step per detected boundary and route it
to `engine.runPrStep` with the fired boundary and its resolved stacked base, so a
completed `per-phase` batch drives one PR per phase and a `per-change` batch one
per change, each idempotent on re-run, while `off` and `whole-batch` behave
byte-identically to today.

## What Changes

Implements
`features/apply-boundary-pr-wiring/apply-routes-boundary-prs.feature`.

- The `{ kind: 'pr'; phase: Phase }` `ApplyTarget` variant in
  `src/commands/batch/apply.ts` gains an optional `boundary?: PrGroupBoundary`.
  Absent → the existing whole-batch completion PR (routed to `runPr`,
  unchanged). Present → a fired stacked group boundary (routed to a new
  `runStackedPr`). No other variant changes.
- `pickNextStep` gains a **separate stacked tail**, reached only at genuine batch
  completion under `per-phase`/`per-change`: it derives the ordered boundaries
  from the manifest via `detectPrGroupBoundaries` (the single home of "where the
  groups are") and returns a `pr` target for the **first boundary whose per-group
  PR is not yet recorded**, in boundary order. The existing whole-batch tail and
  the `off` path are untouched, so their output is byte-identical.
- The `pickNextStep` gating input `prContext` gains `openedGroupKeys:
  ReadonlySet<string>` — the set of per-group PR keys already journaled — computed
  once by `batchApplyCommand` from the run-state journal and passed in as data.
  The existing whole-batch `alreadyOpened` flag is kept. The selector still reads
  neither config nor the journal itself.
- `batchApplyCommand` routes a `pr` target by `boundary`: present →
  `runStackedPr`, absent → the existing `runPr`.
- A new `runStackedPr` helper (twin of `runPr`) keyed by `prJournalKey(batch,
  boundary)`: it honors a halt on that per-group key via the shared
  `precheckPark`, computes the group's stacked base by composing the two pure
  policies — `selectStackedBases(detectPrGroupBoundaries(state, mode),
  batchBaseBranch, branchForGroup)` — selects the entry for the fired boundary,
  builds the `PrStepContext` (the boundary, the resolved stacked `baseBranch`/
  `workBranch`, phase framing, settings, resume), calls `engine.runPrStep`, then
  persists and renders through the **same** `persistStepOutcome` / `renderResult`
  paths a change and the whole-batch PR step use.
- Branch naming stays the CLI's job and is delivered as data: `batchBaseBranch`
  is the repo's base branch from the existing `resolveBranches` seam, and each
  group's own branch is named from its stable identity by a `branchForGroup`
  resolver (`boundary.groupId`), exposed as an injectable `groupBranch?` seam on
  `BatchApplyDeps` alongside `branches?`. Only git is invoked (universal); no
  forge CLI.
- A shared `boundaryStateFromPhases(manifestPhases)` helper builds the
  `BoundaryBatchState` both `pickNextStep` and `runStackedPr` feed to
  `detectPrGroupBoundaries`, so the boundary ordering is derived one way.
- Documents the `batch apply` per-boundary PR wiring in
  `docs/engine/agent-runtime.md`.

Not a breaking change: the `pr` `ApplyTarget` keeps its shape (the `boundary`
field is an optional superset addition); the stacked tail is reached only under
`per-phase`/`per-change` once the batch is otherwise `done`, so every existing
apply path — change, decompose, proof-of-work, the whole-batch PR, and the
`off`-default "nothing to do" terminal — is untouched.

## Design

**The CLI selects the boundary; the engine spawns and journals; the skill authors
the PR (`delegated-lifecycle`).** This change adds exactly one layer — CLI
*selection and routing* — on top of the group-aware `runPrStep` that already
exists. `batch apply` remains a single-step verb: it picks the next runnable
`ApplyTarget` and hands it to the matching engine entry point (`runStep`,
`runDecompositionStep`, `runProofOfWork`, `runPrStep`). "Where the groups are"
and "what group N stacks on" keep their single homes in the two pure policies
(`detectPrGroupBoundaries`, `selectStackedBases`); `pickNextStep` and
`runStackedPr` consume their output and never re-derive boundary or stacked-base
rules inline. `runStackedPr` re-authors none of the commit/push/PR-open steps
(they live once in the `/rct:pr-open` body) and duplicates none of the engine's
spawn/journal machinery — it delegates to `runPrStep`, which delegates to the
canonical command.

**"Done" has one definition, honored per group (`delegated-lifecycle`).** The
per-group "PR opened" done-rule keeps its single home in
`hasJournaledPrForGroup(journal, key)`. The engine's resume precondition consults
THAT predicate against the per-group key; the CLI selection consults the same
journal shape — `batchApplyCommand` derives `openedGroupKeys` as the set of
`change` values on `completion`/`transition: 'pr'` entries (exactly what
`hasJournaledPrForGroup` matches) and `pickNextStep` checks membership by
`prJournalKey(batch, boundary)`. Neither re-derives a second done-rule; the CLI
gate and the engine precondition agree by construction, and a failed open (a
`blocker`, never a `completion`) leaves the group unrecorded and therefore
re-surfaced.

**Surfaced only at genuine batch completion, gated in the CLI so `off`/`whole-batch`
are byte-identical (`generalizable-defaults`).** The stacked tail is a new branch
reached only after every existing branch (change → decompose → boundary proof →
terminal proof → the whole-batch PR tail) has declined, and only when
`status.status === 'done'` and `grouping` is `per-phase`/`per-change`. It walks
the detected boundaries in order and returns the first whose per-group key is not
in `openedGroupKeys`; each subsequent `batch apply` opens the next group, so a
`per-phase` batch drives one PR per phase and a `per-change` batch one per change.
Because the tail is separate and mode-guarded, `off` (and unset) returns
`undefined` and prints the unchanged "Nothing to do — all changes are done."
message, and `whole-batch` still flows through its existing tail (`grouping ===
'whole-batch' && !alreadyOpened`) and `runPr` — its `workBranch` stays the current
git branch, unchanged. The only defaults introduced are ecosystem-neutral:
gating on the neutral mode values, resolving the git base branch, and naming a
group branch from its own identity. No forge command, package manager, or test
runner is hard-coded, and no forge CLI is invoked — detecting and driving
`gh`/`glab`/… remains the spawned agent's job.

**Gating inputs are passed as parameters; `pickNextStep` stays pure
(`instruction-fed-config`, `testing`).** `pickNextStep` does not read config or
the journal — `batchApplyCommand` resolves `settings.prGrouping`,
`hasJournaledPr(journal)` (whole-batch), and the `openedGroupKeys` set once, at
the one command seam that already performs config/journal reads, and passes them
in as the small `prContext` argument. The boundary ordering is derived from the
in-memory `manifest.phases` the selector already holds. This keeps the selector a
deterministic pure function over in-memory inputs (unit-testable with no
filesystem, per the pyramid) and keeps the side effects at the single command
seam. The stacked base still reaches the PR agent only through the `ratchet
instructions` payload the engine builds (`pr-instruction-stacked-base`) — this
change adds **no** config read inside the `/rct:pr-open` skill; it supplies the
resolved base/work branch to the engine as `PrStepContext` data, exactly as the
whole-batch step already does.

**Stacked base resolved by the CLI and delivered as data (`instruction-fed-config`,
`generalizable-defaults`).** `runStackedPr` composes the two pure policies to
resolve the fired group's base: `detectPrGroupBoundaries(state, mode)` orders the
groups, `selectStackedBases(boundaries, batchBaseBranch, branchForGroup)` computes
each group's `baseBranch` (group N-1's own branch, or `batchBaseBranch` for group
0) and `headBranch`, and the entry for the fired boundary supplies
`PrStepContext.baseBranch`/`workBranch`. `batchBaseBranch` is the repo's base
branch from the existing `resolveBranches` seam (git `symbolic-ref` on the remote
HEAD, falling back to the neutral `main`); `branchForGroup(boundary) =
boundary.groupId` names each group's branch from its stable identity (phase or
change name — already kebab-case). Both are injectable through `BatchApplyDeps`
(the existing `branches?` plus a new `groupBranch?`) so integration tests supply
fake names without a real git repo. Only git is touched; the engine never derives
which branch is base/work.

**The stacked PR step reuses the change step's persist/render/park vocabulary.**
`runStackedPr` is the structural twin of `runPr`/`runDecomposition`: it is keyed
by the per-group `prJournalKey(batch, boundary)`, honors a halt on that key via
the shared `precheckPark`, threads any resolved resume answer/feedback into
`PrStepContext.resume`, and routes the engine's `StepResult` through the shared
`persistStepOutcome` and `renderResult`. So a blocked/failed per-boundary PR step
parks under that group's key and renders as a reported step failure with no new
failure logic, and an `advanced` step clears the park — the same outcome mapping
every step uses. The engine already records the per-group `completion`/`blocker`
entry; the CLI adds no journal writes beyond the shared park state.

**No new routable stage or command is authored here (`multi-agent-support`).** The
`pr` agent stage, the `/rct:pr-open` command, per-stage adapter resolution, and
the group-aware spawn all landed earlier. This change adds **no** per-agent PR
copy, no agent-specific branching, and no new generated artifact — it selects the
step and threads resolved data. The agent that runs is still resolved by the
engine through `resolveAgentForStage(settings.agent, 'pr')` inside `runPrStep`,
identically for every registered agent, so there are no new per-agent output
files to enumerate. The one user-facing CLI surface (`batch apply`'s selection)
is agent-neutral by construction.

**Testing (`testing`).** Proven at the two layers this slice touches, weighted
down the pyramid:
- **Unit** — `pickNextStep` is a pure selector, so its new stacked branch is
  proven directly (extending the existing `pickNextStep` unit coverage): a `done`
  status with `{ grouping: 'per-phase', openedGroupKeys: ∅ }` returns a `pr`
  target for the first phase boundary; recording the first group's key returns
  the second boundary; all groups recorded returns `undefined`; `per-change`
  likewise yields one target per change in order; `off`/unset, `whole-batch`
  (still the boundary-less tail), and a not-`done` status behave exactly as
  before; an outstanding change still returns that change target, never a `pr`
  target.
- **Integration** — extend `test/commands/batch/apply.test.ts` (mocked engine, no
  real agent) with stacked-mode scenarios over the tmpdir fixture: a completed
  `per-phase` batch invokes `runPrStep` once per apply with a `PrStepContext`
  carrying the fired boundary and the injected stacked `workBranch`/`baseBranch`
  (group 0 → the batch base branch, group N → group N-1's branch) and never
  `runStep`; a per-group pre-seeded completion (idempotent resume) skips that
  group and selects the next; all groups recorded prints the unchanged done
  message and never calls `runPrStep`; a blocked `runPrStep` result parks under
  the per-group `prJournalKey` and renders a reported failure, leaving the group
  re-surfaceable; `off`/unset and `whole-batch` are unchanged (`whole-batch`
  still routes to `runPr` with a boundary-less context). Branch resolution is
  injected via the `branches?`/`groupBranch?` seams, so no test shells out to git.
- The full suite and the coverage gate stay green at or above the enforced
  `COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** The per-boundary PR step becomes
user-reachable through `batch apply` in this change, so the Reference doc that
describes the engine PR flow is updated in the same change:
- `docs/engine/agent-runtime.md` — extend the PR-step section to state that under
  `per-phase`/`per-change` `batch apply` surfaces one `pr` `ApplyTarget` per
  detected group boundary (in order) once the batch is otherwise `done`, gated on
  the mode and the per-group recorded state (`openedGroupKeys`) so `off`/unset and
  a fully-opened batch leave the existing "Nothing to do" output unchanged and
  `whole-batch` keeps its single boundary-less completion PR; the CLI resolves the
  stacked base (group N-1's branch, or the repo base for group 0) via the two pure
  policies and hands it to `runPrStep` as `PrStepContext` data.
- No `README.md` change is required for accuracy: the `batch apply` one-liner and
  the `per-phase`/`per-change` config keys are already documented
  (`grouping-mode-schema`), and this slice adds no new user-facing command, flag,
  or config key. Per the standard's "do not over-document visually" guidance and
  the phase plan's scoping, the comprehensive stacked-grouping overview + Mermaid
  diagram and any README narrative land with the phase's final
  `grouping-modes-e2e-and-docs` change, not here.

## Tasks

- [x] 1.1 Add the optional `boundary?: PrGroupBoundary` field to the `{ kind:
  'pr' }` variant of the `ApplyTarget` union in `src/commands/batch/apply.ts`
  (importing `PrGroupBoundary` from `../../core/batch/engine/boundary.js`), with a
  doc comment: absent → the whole-batch completion PR (`runPr`, unchanged),
  present → a fired stacked group boundary (`runStackedPr`).
- [x] 1.2 Add a `boundaryStateFromPhases(manifestPhases)` helper that maps the
  manifest phases/changes to a `BoundaryBatchState`, used by both `pickNextStep`
  and `runStackedPr` so the boundary ordering is derived one way.
- [x] 1.3 Extend `pickNextStep`'s `prContext` parameter with `openedGroupKeys:
  ReadonlySet<string>` and add a single new stacked tail: after every existing
  branch declines, when `status.status === 'done'` and `prContext.grouping` is
  `per-phase`/`per-change`, derive the ordered boundaries via
  `detectPrGroupBoundaries` and return a `pr` target (with `boundary`) for the
  first boundary whose `prJournalKey(status.name, boundary)` is not in
  `openedGroupKeys`; otherwise fall through to `undefined`. Keep the whole-batch
  tail and `off` path unchanged; the function reads neither config nor the journal.
- [x] 1.4 In `batchApplyCommand`, compute `openedGroupKeys` once from the
  run-state journal (the `change` of every `completion`/`transition: 'pr'` entry),
  add it to `prContext`, and route a `target.kind === 'pr'` by `boundary`:
  `boundary` present → `runStackedPr`, absent → the existing `runPr`.
- [x] 1.5 Add a `groupBranch?: (boundary: PrGroupBoundary, index: number) =>
  string` seam to `BatchApplyDeps` (default `(b) => b.groupId`) alongside
  `branches?`; no forge CLI is invoked.
- [x] 1.6 Add the `runStackedPr` helper (twin of `runPr`): key on
  `prJournalKey(batch, boundary)`, honor a halt via `precheckPark`, resolve the
  group's stacked base by composing `detectPrGroupBoundaries` +
  `selectStackedBases` (with `batchBaseBranch` from the `branches?` seam and the
  `groupBranch?` resolver) and selecting the fired boundary's entry, build the
  `PrStepContext` (`boundary`, resolved `baseBranch`/`workBranch`, phase framing,
  `settings`, `resume`), call `engine.runPrStep`, then `persistStepOutcome` and
  `renderResult` under the per-group key.
- [x] 2.1 (`testing`) Add unit coverage for `pickNextStep`'s stacked branch:
  `done` + `per-phase` + empty `openedGroupKeys` → `pr` target for the first phase
  boundary; recording the first group's key → the second boundary; all recorded →
  `undefined`; `per-change` → one target per change in order; `off`/unset,
  `whole-batch` (boundary-less), and not-`done` → unchanged; an outstanding change
  → that change target.
- [x] 2.2 (`testing`) Extend `test/commands/batch/apply.test.ts` with
  stacked-mode `runPrStep` scenarios (mocked engine + injected fake
  `branches`/`groupBranch`): completed `per-phase` → one `runPrStep` per apply
  carrying the fired boundary and the stacked base (group 0 → batch base, group N
  → group N-1's branch) and no `runStep`; per-group pre-seeded completion → skips
  that group and selects the next; all groups recorded → the unchanged "Nothing to
  do — all changes are done." and no `runPrStep`; a blocked `runPrStep` → parked
  under the per-group `prJournalKey` and rendered as a failure and re-surfaceable;
  `off`/unset and `whole-batch` unchanged. Confirm the full suite and coverage
  gate stay green.
- [x] 3.1 (`documentation`, mandatory — `documentation` tag) Update
  `docs/engine/agent-runtime.md`'s PR-step section: under `per-phase`/`per-change`
  `batch apply` surfaces one `pr` `ApplyTarget` per detected group boundary once
  the batch is `done`, gated on the mode and the per-group recorded state (so
  `off`/unset and a fully-opened batch leave the existing "Nothing to do" output
  unchanged and `whole-batch` keeps its single boundary-less completion PR); the
  CLI resolves the stacked base via the two pure policies and hands it to
  `runPrStep` as `PrStepContext` data. No `README.md` change (accurate already);
  the stacked-grouping overview Mermaid + README narrative land with
  `grouping-modes-e2e-and-docs`.
