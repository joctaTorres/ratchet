# corroborate-reported-completions

## Why

`mapSessionToOutcome` classifies `advanced` on any `completion` journal entry —
whatever an agent wrote via `ratchet batch report --complete "<anything>"` — and
never consults the `diskEvidence` it already receives to corroborate the claim
(issue #78). A verify completion is the whole done-gate for a change, so a bare
`--complete` unlocks DAG dependents with zero evidence; and a crash after
reporting (`completion` + non-zero exit) is invisible because the failure branch
requires `!completion`. The engine's honest-outcome philosophy ("never
auto-advance on unreported work") has no dual for reported-but-undone work.
Fixes #78 (`gh issue view 78` re-confirmed OPEN at propose, 2026-07-09).

## What Changes

Implements `features/completion-corroboration/*.feature` (disk-corroboration,
verify-verdict, crash-and-gates). Vertical slice: corroboration in the pure
mapper + the verify-verdict contract in the instructions layer + docs + tests.

- `mapSessionToOutcome` (src/core/batch/engine/outcome.ts) corroborates a
  claimed completion against `diskEvidence` before advancing; a mismatch fails
  closed as `blocked` with a "reported complete but disk disagrees: …" blocker.
- A completion followed by a non-zero exit or signal maps to `blocked`
  (fail-closed — the manifest allows "at least warned, arguably blocked"; this
  phase's integrity-gate goal picks blocked) with a blocker naming the exit.
- Verify completions must carry the verification verdict: a new exported
  `VERIFY_VERDICT_PATTERN` in outcome.ts recognizes the canonical
  final-assessment shapes the rct:verify workflow already authors.
- The engine's verify-transition instructions (src/core/batch/engine/
  instructions.ts) tell the agent the `--complete` summary MUST include the
  verification report's final-assessment verdict (agent-neutral prose).
- `decompose` and `pr` step completions are exempt (their synthetic journal
  keys — `decompose:<phase>`, `pr:<batch>[:group]` — have no change directory);
  their behavior stays byte-for-byte today's.
- Corroboration and the crash check run BEFORE the after-propose approval park,
  so an uncorroborated propose can no longer park as `awaiting-approval`.
- Docs: `docs/engine/overview.md` § "Session-to-outcome mapping" updated;
  outcome.ts header comment updated (the DoD's "documented in outcome.ts").

Not breaking for override-free, honest agents: a genuine propose leaves a plan,
a genuine apply checks tasks, and verify guidance now names the verdict to
include. **Behavioral change** for dishonest/hollow completions: they park
instead of advancing — that is the point.

## Design

**Where.** All corroboration lives in the pure mapper (`outcome.ts`) — no fs
access, no engine.ts changes: `spawnAndMap` already passes
`diskEvidence: { before, after }` (ChangeDiskState snapshots) for every step
kind. Unit-testable at the bottom of the pyramid (testing standard).

**Corroboration rules** (new `corroborateCompletion(transition, evidence,
message)` returning `undefined` when corroborated or a human-readable mismatch
reason; applied only when `transition` is `propose | apply | verify`):

- `propose` → `after.exists && after.hasPlan`. Absolute after-state, not a
  delta, so a resumed propose over an existing directory still corroborates.
- `apply` → `after.applied || after.tasksComplete > before.tasksComplete`
  (the DoD's "checked/progressed": fully checked, or at least progressed this
  session — a partially-progressed apply completion is honest work; step
  selection simply schedules apply again).
- `verify` → `after.applied && VERIFY_VERDICT_PATTERN.test(message)`. Verify
  produces no disk artifact, so its evidence is (a) the change is actually
  applied and (b) the completion message carries the verdict. An archived
  after-state reports `applied: true`, so late archival cannot false-block.

**Verdict contract.** `VERIFY_VERDICT_PATTERN = /ready for archive|critical
issue/i`, exported from outcome.ts with a doc comment naming its source: the
Final Assessment lines the rct:verify workflow template
(src/core/templates/workflows/verify-change.ts) canonically emits ("Ready for
archive…", "X critical issue(s) found…"). The pattern checks verdict PRESENCE,
not polarity — gating done on a passing verdict is out of scope (issue #78
point 3 asks only that the completion carry the verdict/evidence). The
delegated-lifecycle standard is preserved: the verify lifecycle stays authored
once in the workflow template; the engine instruction layer only adds the
transition-level reporting requirement, and the mapper consumes the message as
data.

**Branch order in the completion path** (documented in the outcome.ts header):

1. reported blocker → `blocked` (unchanged, still first)
2. non-zero exit without completion → `failed` (unchanged)
3. completion + corroboration mismatch → `blocked`, blocker
   `Reported complete but disk disagrees: <reason>.`
4. completion + non-zero exit/signal → `blocked`, blocker
   `Agent reported completion but exited <describeExit> — the reported work may
   be incomplete; review and resume.`
5. completion + `parkForApproval` → `awaiting-approval` (unchanged shape)
6. completion → `advanced` (unchanged shape)
7. zero exit, no report → `blocked` (unchanged)

(3) before (4): a disk mismatch is the more specific, actionable evidence. Both
precede (5) so the approval gate only ever parks corroborated proposes. Mismatch
outcomes carry `journalRefs` and the transcript-bearing `detail` like the other
parked shapes, so resume surfaces the evidence.

**Instructions surface.** `buildAgentInstructions` gains one verify-only line
(alongside the existing `--complete` mandate) requiring the summary to include
the verification report's final-assessment verdict. Agent-neutral wording
(multi-agent-support standard); no skill template edit needed — rct:verify
already produces the Final Assessment this quotes.

**Blast radius.** Existing tests that assert `advanced` on a bare completion
(outcome.test.ts, engine flow suites driving stub agents that `--complete`
without touching disk) must gain corroborating disk fixtures — that churn is
the gate working as intended. Phase proof-of-work `npm test --
test/batch-engine/` is the integration bar.

## Tasks

- [x] 1.1 Unit tests first (testing standard, TDD): extend
      `test/batch-engine/outcome.test.ts` with the corroboration matrix —
      propose mismatch/agreement, apply no-progress/progressed/already-applied,
      verify unapplied/verdict-free/verdict-carrying, completion+non-zero exit
      and completion+signal blocked, mismatch-beats-parkForApproval,
      corroborated propose still parks awaiting-approval, decompose and pr
      completions exempt, blocker-still-wins — per
      `features/completion-corroboration/*.feature`.
- [x] 1.2 Implement `corroborateCompletion` + `VERIFY_VERDICT_PATTERN` in
      `src/core/batch/engine/outcome.ts`, wire the completion branch in the
      documented order (mismatch → crash → approval → advanced), update the
      header comment (DoD: documented in outcome.ts); 1.1 tests green.
- [x] 2.1 Add the verify-only verdict-reporting line in
      `src/core/batch/engine/instructions.ts` (agent-neutral) and assert it in
      `test/batch-engine/instructions.test.ts` (present for verify, absent for
      propose/apply).
- [x] 3.1 Repair existing suites that assert advancement on bare completions
      by giving their stubs corroborating disk fixtures; run
      `npm test -- test/batch-engine/` (phase proof-of-work) to exit 0.
- [x] 4.1 Documentation task (documentation standard, `documentation` tag):
      update `docs/engine/overview.md` § "Session-to-outcome mapping" with the
      new completion-corroboration rules, verdict contract, and crash-after-
      completion behavior; sweep `docs/engine/agent-runtime.md` and
      `docs/engine/change-step.md` for now-stale "completion → advanced"
      claims; README checked — it does not describe outcome-mapping internals,
      so no README edit unless that check finds otherwise.
