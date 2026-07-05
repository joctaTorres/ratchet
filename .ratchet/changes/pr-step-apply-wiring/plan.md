# pr-step-apply-wiring

## Why

Phase 2 of the `per-stage-agents-and-prs` batch opens a single whole-batch PR at
completion. The config (`prGrouping`, the `pr` stage), the shared forge-agnostic
`/rct:pr-open` instruction, and the engine method that spawns the PR agent
(`runPrStep`) all landed in earlier changes — but nothing in the user-visible
loop ever calls `runPrStep`. This is the CLI wiring slice: `batch apply` must
surface the completion PR step as a new apply target and route it to
`engine.runPrStep`, so a completed `prGrouping: whole-batch` batch drives the PR
step exactly once (idempotent on re-run) while an `off`/unset batch drives no PR
step and behaves byte-identically to today. It mirrors how `batch apply` already
surfaces the phase `decompose` and boundary `proof-of-work` steps as
`ApplyTarget`s and routes each to its engine entry point.

## What Changes

- `ApplyTarget` in `src/commands/batch/apply.ts` gains a fourth variant,
  `{ kind: 'pr'; phase: Phase }`, alongside `change | decompose | proof-of-work`,
  so `pickNextStep` can name the completion PR step and `batchApplyCommand` can
  route it — exactly as the `decompose` and `proof-of-work` variants are named
  and routed.
- `pickNextStep` surfaces the PR target **only at batch completion**: when no
  change / decompose / boundary-proof step is runnable AND `status.status` is
  `done` AND the PR is not yet opened. It takes the gating inputs as parameters
  (the resolved `prGrouping` mode and an `alreadyOpened` flag) so it stays a pure,
  directly-testable selector — it never reads config or the journal itself. With
  `prGrouping` not `whole-batch`, or the PR already opened, it returns `undefined`
  exactly as today, so the existing "Nothing to do — all changes are done."
  output is unchanged.
- `batchApplyCommand` computes the two gating inputs once — `settings.prGrouping`
  and `hasJournaledPr(readJournalTolerant(projectRoot, batch))` — hands them to
  `pickNextStep`, and routes a `pr` target to a new `runPr` helper (mirroring the
  `decompose` / `proof-of-work` routing).
- A new `runPr` helper builds a `PrStepContext` — the terminal phase framing, the
  resolved `settings`, the PR-keyed resume context, and the resolved
  `workBranch` / `baseBranch` — calls `engine.runPrStep`, then persists and
  renders the outcome through the **same** `persistStepOutcome` / `renderResult`
  paths a change and decomposition step use, keyed by `prJournalKey(batch)`.
- Branch resolution is the CLI's job (as `PrStepContext` documents): a small,
  injectable `resolveBranches(projectRoot)` seam reads git — `workBranch` from the
  current branch, `baseBranch` from the repo's default branch — and delivers the
  names to the engine as data. It runs only git (universal), never a forge CLI.
- Documents the `batch apply` CLI wiring of the completion PR step in
  `docs/engine/agent-runtime.md`.
- Implements
  `features/pr-step-apply-wiring/apply-routes-completion-pr.feature`.

Not a breaking change: the `pr` `ApplyTarget` is a superset addition; the PR
target is surfaced only under `prGrouping: whole-batch` and only once the batch
is otherwise `done`, so every existing apply path — change, decompose,
proof-of-work, and the `off`-default "nothing to do" terminal — is untouched.

## Design

**The CLI selects the step; the engine spawns and journals; the skill authors
the PR (`delegated-lifecycle`).** This change adds exactly one layer — CLI
*selection and routing* — on top of the engine `runPrStep` that already exists.
`batch apply` remains a single-step verb: it picks the next runnable
`ApplyTarget` and hands it to the matching engine entry point (`runStep`,
`runDecompositionStep`, `runProofOfWork`, and now `runPrStep`). The "PR opened"
done-rule keeps its single home in `hasJournaledPr`
(`delegated-lifecycle`: "'Done' has one definition, computed once, honored by
every consumer") — the engine's resume precondition and this CLI selection both
consult THAT predicate; neither re-derives it. `runPr` never re-authors the
commit/push/PR-open steps (they live once in the `/rct:pr-open` body) and never
duplicates the engine's spawn/journal machinery.

**Surfaced only at genuine batch completion, gated in the CLI so `off`/unset is
byte-identical (`generalizable-defaults`).** `pickNextStep` returns the `pr`
target from a single new tail branch, reached only after every existing branch
(change → decompose → boundary proof → terminal proof) has declined. It fires
only when `status.status === 'done'` (all changes done AND the terminal boundary
proof recorded and passed — the PR opens strictly *after* the terminal proof),
`grouping === 'whole-batch'`, and `!alreadyOpened`. The gate lives in the CLI —
not only in the engine's precondition — precisely so that an `off`/unset batch
and an already-opened PR never surface a target at all: `pickNextStep` returns
`undefined` and the existing terminal `status === 'done'` branch prints the exact
same "Nothing to do — all changes are done." message it prints today. The
engine's own `prGrouping` and `hasJournaledPr` preconditions remain as
defense-in-depth (a direct `runPrStep` caller is still safe), but the
user-visible output is preserved by the CLI gate. The only defaults this change
introduces are ecosystem-neutral: gating on the neutral `whole-batch` value and
resolving git branch names. No forge command, package manager, or test runner is
hard-coded.

**Gating inputs are passed as parameters; `pickNextStep` stays pure
(`instruction-fed-config`, `testing`).** `pickNextStep` does not read config or
the journal — `batchApplyCommand` resolves `settings.prGrouping` and
`hasJournaledPr(readJournalTolerant(...))` once and passes them in as a small
`{ grouping, alreadyOpened }` argument. This keeps the selector a deterministic
pure function over in-memory inputs (unit-testable with no filesystem, per the
pyramid) and keeps the "read config / read journal" side effects at the one
command seam that already performs them. It mirrors how the resolved
`priorResults` and branch names are computed by the CLI and handed to the engine
as data rather than read inside the pure core.

**Branches resolved by the CLI and delivered as data (`instruction-fed-config`,
`generalizable-defaults`).** `PrStepContext.workBranch` / `baseBranch` are
documented as resolved upstream and delivered as data the `/rct:pr-open` body
consumes as its "Input" — the engine never derives which git branch is
base/work. `runPr` resolves them via a small `resolveBranches(projectRoot)` seam:
`workBranch` from the current branch (`git rev-parse --abbrev-ref HEAD`) and
`baseBranch` from the repository's default branch (`git symbolic-ref --short
refs/remotes/origin/HEAD`, stripped of its `origin/` prefix), falling back to the
neutral `main` when no remote is configured — the same no-remote condition the
sibling `doctor-pr-remote-warning` change warns about. This touches only git,
which is universal; it invokes no forge CLI (detecting and driving `gh`/`glab`/…
is the spawned agent's job). The seam is injectable through `BatchApplyDeps`
(alongside the existing `proof` seam) so integration tests supply fake branch
names without a real git repo.

**The `pr` step reuses the change step's persist/render/park vocabulary.**
`runPr` is the structural twin of the existing `runDecomposition` helper: it is
keyed by `prJournalKey(batch)` (there is no change directory), honors a halt on
that key via the shared `precheckPark`, threads any resolved resume
answer/feedback into the `PrStepContext.resume` exactly as a change or
decomposition step does, and routes the engine's `StepResult` through the shared
`persistStepOutcome` and `renderResult`. So a blocked/failed PR step parks under
the PR key and renders as a reported step failure with no new failure logic, and
an `advanced` PR step clears the park — the same outcome mapping every step uses.
The engine already records a `completion`/`blocker` entry for the step; the CLI
adds no journal writes of its own beyond the shared park state.

**No new routable stage or command is authored here (`multi-agent-support`).**
The `pr` agent stage, the `/rct:pr-open` command, and the per-stage adapter
resolution all landed earlier; this change adds no per-agent PR copy and no
agent special-casing. It only selects the step and threads resolved data — the
agent that actually runs is still resolved by the engine through
`resolveAgentForStage(settings.agent, 'pr')` inside `runPrStep`.

**Testing (`testing`).** Proven at the two layers this slice touches, weighted
down the pyramid:
- **Unit** — `pickNextStep` is a pure selector, so its new branch is proven
  directly (extending `test/core/batch/…` / the existing `pickNextStep` unit
  coverage): a `done` status with `{ grouping: 'whole-batch', alreadyOpened:
  false }` returns a `pr` target for the terminal phase; `grouping: 'off'`,
  unset, `alreadyOpened: true`, and a not-yet-`done` status each return
  `undefined` (no `pr` target); an outstanding change still returns that change
  target, never the `pr` target.
- **Integration** — extend `test/commands/batch/apply.test.ts` (mocked engine, no
  real agent) with `runPrStep` scenarios over the tmpdir fixture: a completed
  `whole-batch` batch invokes `runPrStep` exactly once (and never `runStep`) with
  a `PrStepContext` carrying the injected `workBranch`/`baseBranch`; `off` and
  unset print the unchanged "Nothing to do — all changes are done." and never
  call `runPrStep`; a pre-seeded `pr` completion (idempotent resume) prints the
  done message and never calls `runPrStep`; a blocked `runPrStep` result parks
  under `prJournalKey` and renders a reported failure. The mocked engine module
  gains `runPrStep`, and the mock exposes `prJournalKey`, `hasJournaledPr`, and
  `readJournalTolerant` (the new symbols `apply.ts` imports). Branch resolution is
  injected via the `BatchApplyDeps` seam, so no test shells out to git.
- The full suite and the coverage gate stay green at or above the enforced
  `COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** The completion PR step becomes
user-reachable through `batch apply` in this change, so the Reference doc that
describes the engine PR flow is updated in the same change:
- `docs/engine/agent-runtime.md` — the "Completion PR step" section currently
  says "the engine SELECTS the step"; add that `batch apply` is what surfaces it,
  as the `pr` `ApplyTarget`, once the batch is otherwise `done`, gated on
  `whole-batch` and `hasJournaledPr` so an `off`/unset batch and an already-opened
  PR surface no target and leave the existing "Nothing to do" output unchanged,
  and that the CLI resolves the work/base branch and hands them to `runPrStep` as
  `PrStepContext` data.
- No `README.md` change is required for accuracy: the `batch apply` one-liner
  ("Advance the batch by **one** transition") and the `pr` agent-map entry are
  already correct and already documented (by `pr-grouping-config`), and this slice
  adds no new user-facing command, flag, or config key. Per the standard's "do not
  over-document visually" guidance and the phase plan's scoping, the whole-batch
  PR-flow overview + Mermaid diagram and any README narrative land with the
  phase's final `whole-batch-pr-e2e-and-docs` change, not here.

## Tasks

- [x] 1.1 Add the `{ kind: 'pr'; phase: Phase }` variant to the `ApplyTarget`
  union in `src/commands/batch/apply.ts`, with a doc comment naming it the
  completion PR step routed to `engine.runPrStep` (mirroring the `decompose` /
  `proof-of-work` variants).
- [x] 1.2 Extend `pickNextStep` with a gating parameter (e.g. `prContext?: {
  grouping: PrGrouping; alreadyOpened: boolean }`) and a single new tail branch:
  after every existing branch declines, when `status.status === 'done'`,
  `prContext.grouping === 'whole-batch'`, and `!prContext.alreadyOpened`, return a
  `pr` target for the terminal phase; otherwise return `undefined` exactly as
  today. Keep the function pure — it reads neither config nor the journal.
- [x] 1.3 In `batchApplyCommand`, resolve the gating inputs once —
  `settings.prGrouping` and `hasJournaledPr(readJournalTolerant(projectRoot,
  batch))` — pass them to `pickNextStep`, and route a `target.kind === 'pr'` to a
  new `runPr` helper (before the change-step path), importing `hasJournaledPr`,
  `readJournalTolerant`, and `prJournalKey` from `../../core/batch/engine/index.js`.
- [x] 1.4 Add a `resolveBranches(projectRoot)` helper (default git impl:
  `workBranch` = current branch, `baseBranch` = default branch via remote HEAD,
  falling back to `main` with no remote) and expose it as an injectable
  `branches?` seam on `BatchApplyDeps`, alongside the existing `proof` seam. No
  forge CLI is invoked.
- [x] 1.5 Add the `runPr` helper (twin of `runDecomposition`): key on
  `prJournalKey(batch)`, honor a halt via `precheckPark`, build the
  `PrStepContext` (terminal phase framing, `settings`, `resume`, resolved
  `workBranch`/`baseBranch`), call `engine.runPrStep`, then `persistStepOutcome`
  and `renderResult` under the PR key.
- [x] 2.1 (`testing`) Add unit coverage for `pickNextStep`'s new branch: `done` +
  `{ grouping: 'whole-batch', alreadyOpened: false }` → `pr` target for the
  terminal phase; `off` / unset / `alreadyOpened: true` / not-`done` → `undefined`;
  an outstanding change still returns that change target.
- [x] 2.2 (`testing`) Extend `test/commands/batch/apply.test.ts` with `runPrStep`
  scenarios (mocked engine + injected fake branches): completed `whole-batch` →
  one `runPrStep` call with the branch data and no `runStep`; `off`/unset → the
  unchanged "Nothing to do — all changes are done." and no `runPrStep`; pre-seeded
  `pr` completion → done message and no `runPrStep`; blocked `runPrStep` → parked
  under `prJournalKey` and rendered as a failure. Add `runPrStep`/`prJournalKey`/
  `hasJournaledPr`/`readJournalTolerant` to the mocked engine module. Confirm the
  full suite and coverage gate stay green.
- [x] 3.1 (`documentation`, mandatory — `documentation` tag) Update
  `docs/engine/agent-runtime.md`'s "Completion PR step" section: `batch apply`
  surfaces the step as the `pr` `ApplyTarget` once the batch is `done`, gated on
  `whole-batch` + `hasJournaledPr` (so `off`/unset and an already-opened PR leave
  the existing "Nothing to do" output unchanged), resolving and handing the
  work/base branch to `runPrStep` as `PrStepContext` data. No `README.md` change
  (accurate already); the overview Mermaid + README narrative land with
  `whole-batch-pr-e2e-and-docs`.
