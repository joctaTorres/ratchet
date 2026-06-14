# fix-headless-agent-contract

## Why

A real `ratchet batch apply` run reported `⚠ blocked — Agent exited with code 0
without reporting completion or a blocker.` after the agent ran for minutes and
appeared to "do nothing". Two transport-independent bugs cause this: the propose
prompt tells a headless agent to use the `/rct:propose` slash-command/skill it
cannot invoke, and the engine discards the agent's transcript and ignores on-disk
evidence on a zero-exit-without-report. This is Phase 1 of the `rex-agent-runtime`
batch and unblocks the rest of it.

## What Changes

- Rewrite the `propose` transition guidance in
  `src/core/batch/engine/instructions.ts` to concrete, tool-agnostic filesystem/CLI
  steps (create `.ratchet/changes/<change>/`, write `features/**/*.feature`, write
  `plan.md` with a `## Tasks` checklist) instead of "use the ratchet propose
  workflow". Sanity-check `apply`/`verify` guidance for the same issue.
- Hoist the completion requirement to the TOP of the built instructions: the agent
  MUST finish by running `ratchet batch report <batch> --change <change> --complete`.
  Keep the full report channel at the bottom.
- On the zero-exit-without-report path in `src/core/batch/engine/outcome.ts`, attach
  a `detail` with the truncated captured transcript (mirroring the non-zero branch),
  and consult on-disk evidence so observed progress is surfaced instead of a bare
  "did nothing".
- Wire on-disk change state into `mapSessionToOutcome` so it can judge whether the
  transition's expected artifact appeared.
- New vitest tests under `test/batch-engine/`; update any existing tests/snapshots
  asserting the old instruction text.
- Implements `features/headless-instructions/propose-contract.feature` and
  `features/honest-outcome/zero-exit-evidence.feature`.

## Design

**Agent-neutral instructions (Bug 1).** `transitionGuidance` keeps switching on
transition, but the `propose` branch is rewritten to enumerate plain filesystem/CLI
actions a non-interactive agent can perform, with no "workflow"/"skill"/slash-command
references and no agent name. This also satisfies the `multi-agent-support` standard
(shared instruction text must be tool-agnostic). The completion requirement moves into
a new leading section in `buildAgentInstructions` (a one-line MUST, placed right after
the transition line), while the detailed `reportChannel` stays at the bottom so the
hard requirement is both up front and fully specified at the end.

**Outcome representation (Bug 2).** Decision: keep the zero-exit-no-report result in
the `blocked` family for the truly-silent case, but make it evidence-aware:

- Always attach `detail = truncate(spawn.stdout / spawn.stderr)` on this path,
  reusing the existing `truncate` helper, exactly like the `nonZero && !completion`
  branch already does. `EngineStepOutcome.detail` already exists and is already
  carried through `toStepResult`'s `failed`→`blocked` mapping; for the plain
  `blocked` path we surface it via `detail` (and reference it in `message`).
- Consult on-disk evidence. When the propose artifact exists (change dir + plan.md
  appeared) or the apply artifact advanced (more task checkboxes checked than the
  pre-session count), represent the step as observed progress rather than a stall.
  Representation choice: introduce an `advanced-unreported` shape — surfaced to the
  CLI as `advanced` with a message that says the agent completed work on disk but did
  not post a completion (so the batch moves forward and resume re-derives the next
  transition from disk), while still attaching the transcript `detail`. If the team
  prefers conservatism, the fallback is to stay `blocked` but enrich `message`/`detail`
  with the observed evidence; the tests assert the message reflects evidence either
  way. We default to the `advanced`-with-note representation because the transition
  computer (`computeNextTransition`) already re-derives state from disk, so advancing
  is safe and idempotent.

**Disk-state wiring.** `mapSessionToOutcome` currently has no `projectRoot`/disk
access. `MapOutcomeInput` gains a small, pre-computed disk-evidence summary rather
than a raw `projectRoot`, to keep `outcome.ts` pure and easy to test: the caller in
`engine.ts` already holds `projectRoot`, snapshots the journal `before` the spawn, and
can also snapshot `readChangeDiskState(projectRoot, change)` before and read it again
after, passing `{ before, after }` (or a derived `progressed` flag + counts) into the
input. `outcome.ts` then decides purely from that summary — no fs access in the mapper,
so tests pass synthetic summaries. `readChangeDiskState` is reused unchanged from
`transition.ts`. The `before` snapshot is needed so apply-progress is measured as a
delta (checkboxes advanced during THIS session), not an absolute count.

## Tasks

- [ ] 1.1 Rewrite the `propose` branch of `transitionGuidance` in `instructions.ts` to
  concrete tool-agnostic filesystem/CLI steps (create `.ratchet/changes/<change>/`,
  feature files under `features/**/*.feature`, `plan.md` with a `## Tasks` checklist),
  with no slash-command/workflow/skill reference and no agent name.
- [ ] 1.2 Sanity-check and adjust the `apply` and `verify` branches so neither names a
  slash-command/skill; keep them describing concrete plan/test actions.
- [ ] 1.3 Hoist the completion requirement: add a leading one-line MUST in
  `buildAgentInstructions` (right after the transition line) stating the agent must
  finish by running `ratchet batch report <batch> --change <change> --complete`,
  keeping the full `reportChannel` at the bottom.
- [ ] 2.1 Extend `MapOutcomeInput` in `outcome.ts` with a disk-evidence summary
  (before/after `ChangeDiskState` or a derived progress flag + task counts) and update
  the `mapSessionToOutcome` signature/types.
- [ ] 2.2 On the zero-exit-no-report path, attach `detail = truncate(spawn.stdout /
  spawn.stderr)` reusing the existing `truncate` helper, mirroring the non-zero branch.
- [ ] 2.3 On the same path, consult the disk-evidence summary: when the transition's
  expected artifact appeared/advanced, represent the step as observed progress
  (`advanced` with an "unreported completion" note) instead of a bare stall; otherwise
  keep the evidence-free `blocked` outcome but with the transcript `detail` attached.
- [ ] 3.1 Wire the disk-evidence summary in `engine.ts`: snapshot
  `readChangeDiskState(projectRoot, change)` before the spawn and read it again after,
  and pass the summary into `mapSessionToOutcome`.
- [ ] 4.1 Add vitest tests under `test/batch-engine/` asserting propose instructions
  reference no slash-command/skill, contain the concrete steps, and state the
  completion requirement up front (and that apply/verify name no slash-command).
- [ ] 4.2 Add vitest tests asserting the zero-exit-no-report outcome attaches the
  truncated transcript `detail`, and that on-disk evidence (propose dir/plan created;
  apply checkboxes advanced) is surfaced as progress rather than "did nothing", while a
  truly silent run with no evidence still parks as `blocked`.
- [ ] 4.3 Update any existing `test/batch-engine` tests/snapshots that assert the old
  instruction text or the old bare zero-exit message; confirm
  `pnpm vitest run test/batch-engine` passes (the phase proof-of-work).
