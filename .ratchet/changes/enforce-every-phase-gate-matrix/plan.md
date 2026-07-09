# enforce-every-phase-gate-matrix

## Why

`shouldParkForApproval` (`src/core/batch/engine/engine.ts`) returns false for every
transition except `propose`, so the `every-phase` gate is behaviorally identical to
`after-propose`: apply and verify never pause for approval, and an autonomous batch
can apply and verify its way to `done` with a single human checkpoint. The gate's
documented behavior is both narrower than its name implies and (until now) largely
undocumented. Fixes #81 (confirmed OPEN and unfixed at decompose, 2026-07-09).

## What Changes

- **Gate matrix picked and enforced** (`features/approval-gate-matrix/per-gate-parking.feature`):
  - `voluntary` — never parks for approval (unchanged).
  - `after-propose` — parks a completed `propose` only (unchanged, correctly named).
  - `every-phase` — parks **every completed change transition** (`propose`, `apply`,
    `verify`). Decomposition and PR-open steps never park for approval.
  - `autonomous` — parks nothing (agent blockers still park, unchanged).
- `shouldParkForApproval` threads the gate policy and transition through a pure,
  exported matrix function instead of hardcoding `transition !== 'propose'`. The
  decompose and PR call sites route through the same matrix (behavior-identical:
  the matrix returns false for them) so the policy has one author.
- The awaiting-approval outcome message and the reject-resume instruction framing
  become transition-aware — today both hardcode "propose"
  (`features/approval-gate-matrix/approval-resume-flow.feature`).
- `docs/engine/overview.md`, `docs/commands/batch.md`, and
  `docs/configuration/config-yaml.md` state exactly which transitions each gate
  value pauses (`features/approval-gate-matrix/documented-matrix.feature`); the
  `--awaiting-approval` CLI help drops its "(after-propose gate)" qualifier.
- Per-gate park scenarios added at the unit layer (pure matrix) and integration
  layer (engine flow), plus approval/reject resume-flow coverage.
- Not breaking for `voluntary`, `after-propose`, `autonomous`. **Behavior change**
  for `every-phase` batches: apply and verify now park for approval — this is the
  fix, and it matches the gate's documented intent.

## Design

**Chosen matrix: `every-phase` parks every completed change transition.** Issue #81
offers two readings ("first step of each phase" vs "every transition"); this plan
picks *every transition* because (a) ratchet's change lifecycle transitions
(propose/apply/verify) are the phases the gate name refers to, (b) it closes the
#81 hole completely — no unattended apply→verify→done path remains, and (c) it
needs no batch-phase-boundary awareness inside `ChangeStepContext`, keeping the
slice thin. Decomposition and PR-open steps do not park: a decomposition's output
(`batch.yaml` change intents) is reviewed when each authored change's propose
parks, and a PR is itself the human checkpoint (review happens on the PR).

**Pure policy module, engine threads it.** A new
`src/core/batch/engine/approval-gate.ts` exports
`parksForApproval(gate: GateValue | undefined, transition: StepKind): boolean`
implementing the matrix as a deterministic function over in-memory inputs — unit
tested with no filesystem or spawn, per the testing standard's pyramid. The engine
stays the orchestrator (delegated-lifecycle: gating is mechanical orchestration,
not lifecycle semantics — no instruction content moves into the engine):

- `shouldParkForApproval(ctx, transition)` keeps its resume suppression
  (`ctx.resume?.answer || ctx.resume?.feedback` → false, so an answered/rejected
  re-run of the SAME transition does not re-park — existing behavior) and
  delegates the gate×transition decision to `parksForApproval`.
- The decompose (`engine.ts` `parkForApproval: false` in `runDecompositionStepLocked`)
  and PR (`runPrStepLocked`) call sites call
  `parksForApproval(settings.gate, 'decompose' | 'pr')` instead of a hardcoded
  `false` — identical behavior, single source of truth.

**Resume interplay is already correct for the new parks.** `recordApproval`
(`src/core/batch/journal.ts`) deletes the park entirely, so after approving a
parked propose the next step runs `apply` with `resume === undefined` — the
suppression does not leak across transitions and `apply` parks again under
`every-phase`. `computeNextTransition` is journal/task-derived, so an approved
apply park resumes into `verify` with no selection changes. No run-state or
selection code changes are needed; scenarios prove it.

**Transition-aware surfaces.** `mapSessionToOutcome` (`outcome.ts`) hardcodes
`"Propose complete; awaiting approval."`; it becomes
`` `${transition} complete; awaiting approval.` `` (capitalized), keyed off the
input's transition. `resumeGuidance` (`instructions.ts`) hardcodes "The prior
proposal was REJECTED… Re-run propose"; it names `context.transition` instead
("Re-run apply against the existing work…"). Both stay agent-neutral prose
(multi-agent-support): they name transitions and the `ratchet batch report`
surface, never a specific coding agent, and the shared instruction template
remains the single author of lifecycle text (delegated-lifecycle — no new
lifecycle prose is added, only the transition name is substituted).

**Docs are part of done** (documentation standard). The gate matrix is
config-driven engine behavior with an existing Reference home: the gate table in
`docs/engine/overview.md` (currently "`every-phase` | Same as `after-propose`."),
the `gate` config rows in `docs/commands/batch.md` and
`docs/configuration/config-yaml.md`, and the awaiting-approval status/outcome rows
in `docs/commands/batch.md`. All are updated in this change to name the exact
transitions each gate parks; no new doc file and no new diagram is needed — the
existing engine overview diagrams do not depict per-gate park sets, and adding one
for a 4×5 boolean matrix would restate the adjacent table (deliberate-diagram
guideline). `README.md` does not enumerate gate values; it is checked and left
accurate.

**Tests follow the pyramid** (testing standard): the matrix is proven at the unit
layer (`test/batch-engine/approval-gate.test.ts`, no fs); park/resume flows at the
integration layer over tmpdir fixture repos alongside the existing engine-flow
suites, with `.feature` names mirrored in test headers. The phase proof-of-work is
`npm test -- test/batch-engine/` exiting 0.

## Tasks

- [x] 1.1 Add pure `parksForApproval(gate, transition)` matrix in
      `src/core/batch/engine/approval-gate.ts` (voluntary/autonomous: never;
      after-propose: propose only; every-phase: propose, apply, verify; decompose
      and pr: never) and export it through the engine barrel
- [x] 1.2 Unit tests for the full gate×transition matrix in
      `test/batch-engine/approval-gate.test.ts`, header mirroring
      `approval-gate-matrix/per-gate-parking.feature` (testing standard: unit
      layer, no filesystem)
- [x] 2.1 Thread the matrix through `shouldParkForApproval` (keep the
      answer/feedback resume suppression) and replace the hardcoded
      `parkForApproval: false` at the decompose and PR call sites with matrix
      calls; update the stale doc comments at all three sites
- [x] 2.2 Make the awaiting-approval outcome message transition-aware in
      `src/core/batch/engine/outcome.ts` (drop hardcoded "Propose complete")
- [x] 2.3 Make the reject-resume framing in
      `src/core/batch/engine/instructions.ts` name the parked transition instead
      of hardcoding "Re-run propose"
- [x] 3.1 Integration scenarios per gate value (voluntary, after-propose,
      every-phase propose/apply/verify, autonomous, decompose/pr never park) in
      `test/batch-engine/` over tmpdir fixtures, headers mirroring
      `approval-gate-matrix/per-gate-parking.feature`
- [x] 3.2 Integration scenarios for the resume flows: approval of a parked
      propose does not exempt apply; approved apply park selects verify next;
      rejected re-run does not re-park; park message and reject framing name the
      transition — mirroring `approval-gate-matrix/approval-resume-flow.feature`
- [x] 4.1 Documentation task (documentation standard, `documentation` tag —
      mandatory): update the gate matrix table in `docs/engine/overview.md`, the
      `gate` rows and awaiting-approval status/outcome rows in
      `docs/commands/batch.md`, the `gate` row in
      `docs/configuration/config-yaml.md`, and the `--awaiting-approval` help
      text in `src/cli/index.ts` so each names exactly which transitions pause
      per gate (`approval-gate-matrix/documented-matrix.feature`); verify
      `README.md` still makes no stale gate claims
- [x] 4.2 Run `npm test -- test/batch-engine/` (phase proof-of-work) and the full
      suite with the coverage gate green at or above the enforced threshold
