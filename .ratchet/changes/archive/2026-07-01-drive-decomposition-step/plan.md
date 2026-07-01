# `ratchet batch apply` drives a ready empty phase's decomposition natively

## Why

`empty-phase-is-not-done` taught status and selection to RECOGNIZE a reachable,
ungated phase with empty `changes` as an outstanding decomposition step:

- `selectRunnableStep` (`src/core/batch/engine/selection.ts`) returns
  `{ step: { phase, decompose: true } }` for such a phase.
- `computeBatchStatus` (`src/core/batch/status.ts`) keeps the batch out of `done`
  and sets `next = { phase, decompose: true }`.

But nothing ACTS on that step, so the manual stop/propose/resume detour is still
required (#30):

- `pickNextStep` in `src/commands/batch/apply.ts` (~line 163) loops ONLY over
  `phaseStatus.changes`. An empty phase has no changes, so `pickNextStep` returns
  `undefined` and `batch apply` prints "No ready step" — it never consults
  `status.next` / the decomposition step.
- The engine is change-scoped: `runStep` → `runStepLocked` → `runChangeStep`
  (`src/core/batch/engine/engine.ts`) all key off `context.change` and
  `computeNextTransition(projectRoot, change)`. There is no path to spawn an agent
  for a PHASE that has no concrete change yet.

So decomposition has to be done by a human running propose against a hand-named
change. This change closes that gap: `batch apply` surfaces the decomposition
step and the engine drives it by spawning ONE agent that delegates to the
canonical decomposition skill (per phase 1) to author the phase's concrete change
intents into `batch.yaml` from the prior phase's shipped results — then the loop
continues into the new changes.

## What Changes

This is the THIN end-to-end slice of the `native-lazy-decomposition` phase that
turns the RECOGNIZED decomposition step into an EXECUTED one. It reuses phase 1's
delegation machinery (skill-in-spawn-locus guarantee, agent-neutral
`/rct:<command> <target>` invocation resolved through the configured agent's
command adapter, context-preserving instruction injection) rather than
re-authoring lifecycle text in the engine (`delegated-lifecycle`: the CLI
orchestrates the spawn; the canonical skill authors the change intents).

- **Apply surfaces the decomposition step.** `pickNextStep` (and/or
  `batchApplyCommand`) consults `computeBatchStatus.next` so that when the next
  runnable step is `{ phase, decompose: true }`, `batch apply` acts on it instead
  of reporting "nothing ready".
- **The engine drives a phase-scoped decomposition spawn.** A new engine entry
  point spawns EXACTLY ONE agent for the empty phase — paralleling `runChangeStep`
  but keyed off the phase, not a change. It reuses the runtime selection,
  streaming/rendering, journal-delta snapshot, and outcome mapping already in
  `engine.ts`; it does NOT re-derive a per-change transition.
- **Delegation to the canonical decomposition skill, context-preserving.** The
  spawned-agent instructions invoke the canonical decomposition skill for the
  named phase (resolved through the same single-source command-id map + per-agent
  command adapter phase 1 uses, so it stays agent-neutral and cannot drift), and
  inject the empty phase's `goal`/`success`/`proofOfWork` plus the prior phase's
  shipped results — never a bare, context-free call.
- **Skill guaranteed in the spawn locus.** Before spawning, the engine
  guarantees the canonical decomposition command is present in the spawn locus
  (renders or verifies it), failing with a clear, actionable bootstrap message
  for a locus it cannot render into — reusing the `ensureSkillInSpawnLocus`
  render-or-fail discipline from phase 1.
- **The agent authors concrete change intents into `batch.yaml`.** The skill
  writes one or more concrete change intents (each with a non-empty `done`) into
  the previously-empty phase's `changes` list in `batch.yaml`, from the prior
  phase's shipped results. The engine does not author the intents itself.
- **The loop continues; done stays honest.** Once `batch.yaml` carries the new
  intents, the phase is decomposed: the next `batch apply` selects its first
  ready change as an ordinary propose/apply/verify step (the existing
  change-scoped path), and the batch reports `done` only once every reachable
  phase is decomposed AND all its changes are done — the `empty-phase-is-not-done`
  rule, now actually advanced.

Implements `features/lazy-decomposition/drive-decomposition-step.feature` and
`features/lazy-decomposition/loop-continues-after-decomposition.feature`.

## Design

- **Canonical decomposition skill (design decision).** Authoring a phase's
  concrete change intents from the prior phase's shipped results is a distinct
  lifecycle operation, so it gets its own canonical command in the SAME
  single-source map phase 1 introduced for transitions
  (`rctCommandIdForTransition` / `TRANSITION_COMMAND_ID` in
  `src/core/batch/engine/skill-locus.ts`) rather than a hard-coded literal — the
  invocation token is still resolved per-agent through the command adapter
  (`multi-agent-support` / `delegated-lifecycle`). The skill's instruction content
  lives in the shared workflow/skill layer
  (`src/core/templates/workflows/`), reusing the lazy-decomposition guidance the
  `propose-batch` workflow already owns ("phase N is decomposed at apply time with
  phase N-1's real shipped results"; only a phase's `changes` are authored, no
  change directories), so there is ONE author of decomposition semantics. Keep the
  new template minimal — it decomposes ONE named phase of an EXISTING batch, not a
  whole new manifest.
- **Apply selection seam (`src/commands/batch/apply.ts`).** Teach `pickNextStep`
  to return a decomposition target when `computeBatchStatus.next.decompose` is set
  (the `next` carries the phase but no `change`). Model the target so
  `batchApplyCommand` can branch: a normal `{ phase, change, changeDone }` drives
  `engine.runStep`; a decomposition `{ phase, decompose: true }` drives the new
  phase-scoped engine entry point. The decomposition step is selected ONLY when no
  earlier ungated change step is runnable (selection already orders gated/ungated
  and change-before-decompose), so a still-gated empty phase is not picked.
- **Engine decomposition entry point (`src/core/batch/engine/engine.ts`).** Add a
  phase-scoped method (e.g. `runDecompositionStep`) that: takes the batch lock
  (mirroring `runStep`), guarantees the canonical decomposition command in the
  spawn locus (reuse `ensureSkillInSpawnLocus`, generalized from a `Transition` to
  a command id), builds decomposition instructions, selects the runtime, spawns
  one agent, snapshots the journal/`batch.yaml` delta, and maps the session to a
  `StepResult`. It must NOT call `computeNextTransition` (there is no change yet)
  and must NOT author `batch.yaml` itself.
- **Instructions (`src/core/batch/engine/instructions.ts`).** Add a decomposition
  variant of `buildAgentInstructions` (or a branch) that emits the canonical
  decomposition skill invocation (via the same `rctInvocation`-style adapter
  resolution) and injects the empty phase's goal/success/proof-of-work and the
  prior phase's shipped results as the delegation context — agent-neutral prose,
  agent-specific token only. No inline re-description of the decomposition steps.
- **Contract (`src/core/batch/engine/contract.ts`).** Extend the engine boundary
  minimally to carry a decomposition step (a phase + the prior phase's shipped
  results) without inventing a per-change transition for it. Keep `StepResult`
  shape compatible so `renderResult` in `apply.ts` shows the decomposition outcome
  like any other step.
- **Thin slice / non-goals.** No proof-of-work gate execution (that is the next
  phase, `execute-proof-of-work-gate`). No change to the per-change
  propose/apply/verify transitions or the single done-rule
  (`transition.ts`/`status.ts` change-level logic is untouched). The integration
  proof drives the decomposition with a STUB agent (the `RATCHET_BATCH_AGENT_CMD`
  override already supported by `buildSpawnRequest`) that writes change intents
  into `batch.yaml`, so the slice proves the orchestration end-to-end without a
  real coding agent.

## Tasks

- [x] In `src/commands/batch/apply.ts`, teach `pickNextStep` to surface the
      decomposition step from `computeBatchStatus.next` (a `{ phase, decompose:
      true }` with no `change`) when no earlier ungated change step is runnable,
      returning a target shape `batchApplyCommand` can distinguish from a normal
      change step.
- [x] In `batchApplyCommand`, branch on the target: a change step drives
      `engine.runStep` (unchanged); a decomposition step drives the new
      phase-scoped engine entry point with the empty phase's context and the prior
      phase's shipped results, then persists/renders the outcome via the existing
      `persistStepOutcome` / `renderResult` paths.
- [x] Add a phase-scoped decomposition entry point to `RatchetBatchEngine`
      (`src/core/batch/engine/engine.ts`) that takes the batch lock, guarantees the
      canonical decomposition command in the spawn locus, builds decomposition
      instructions, selects the runtime, spawns EXACTLY ONE agent, snapshots the
      journal + `batch.yaml` delta, and maps the session to a `StepResult` — never
      calling `computeNextTransition` and never authoring `batch.yaml` itself.
- [x] Generalize the spawn-locus guarantee (`src/core/batch/engine/skill-locus.ts`)
      so it can render/verify the canonical decomposition command (extend the
      single-source command-id map; resolve the per-agent adapter as today),
      failing with a clear, actionable bootstrap message for a locus it cannot
      render into — never instructing the agent to invoke a skill it cannot run.
- [x] Add a decomposition variant to `buildAgentInstructions`
      (`src/core/batch/engine/instructions.ts`) that emits the canonical
      decomposition skill invocation (adapter-resolved token, agent-neutral prose)
      and injects the empty phase's goal/success/proof-of-work plus the prior
      phase's shipped results as context-preserving delegation — no inline
      re-description of the steps.
- [x] Add the canonical decomposition skill/workflow to the shared template layer
      (`src/core/templates/workflows/`) reusing `propose-batch`'s lazy-decomposition
      guidance: it authors ONE named phase's concrete change intents (each with a
      non-empty `done`) into the existing `batch.yaml`'s `changes` list from the
      prior phase's shipped results, and creates NO change directories. Wire it
      into the command-generation registry so the spawn-locus guarantee and the
      invocation token resolve through it for every supported agent.
- [x] **Multi-agent surface (enumerated per `multi-agent-support`).** The new
      decomposition command is generated for EVERY agent in the registry
      (`src/core/config.ts`) from the single shared template — never a
      claude-only artifact. Per-agent outputs (command id `<decompose-id>`):
      - claude → `.claude/commands/rct/<decompose-id>.md`
      - codex → `<CODEX_HOME>/prompts/rct-<decompose-id>.md`
      - cursor → `.cursor/commands/rct-<decompose-id>.md`
      - gemini → `.gemini/commands/rct-<decompose-id>.md`
      - github-copilot → `.github/prompts/rct-<decompose-id>.prompt.md`
      - opencode → `.opencode/commands/rct-<decompose-id>.md`
      Content is defined once as tool-agnostic shared content and rendered per
      agent via the adapter registry; the invocation token resolves through each
      agent's adapter `getInvocation` (claude `/rct:<id>`, others `/rct-<id>`),
      never a hard-coded literal.
- [x] Extend the engine contract (`src/core/batch/engine/contract.ts`) minimally to
      carry a decomposition step (phase + prior-phase shipped results) without
      inventing a per-change transition, keeping `StepResult` shape compatible with
      `renderResult`.
- [x] Add an integration test under `test/batch-engine/` (e.g.
      `drive-decomposition-step.test.ts`) driving a fixture batch whose first phase
      is fully done and whose second phase has empty `changes`, with a STUB agent
      (`RATCHET_BATCH_AGENT_CMD`) that writes concrete change intents into
      `batch.yaml`. Assert: (a) the decomposition step is selected (not "nothing
      ready"); (b) exactly one agent is spawned for the phase and its instructions
      invoke the canonical decomposition skill with the phase context + prior
      results injected (not an inline re-description); (c) after the step the
      previously-empty phase holds concrete change intents (each with a non-empty
      `done`) in `batch.yaml`; (d) the next selection advances the first new change,
      not the decomposition step; (e) status stays NOT `done` until every reachable
      phase is decomposed and all changes done; (f) a spawn locus missing the
      decomposition command renders it or fails with the actionable message.
- [x] **Generation test (per `multi-agent-support`: assert output for all
      registered agents).** Extend the command-generation tests
      (`test/core/command-generation/` — `registry.test.ts` / `generator.test.ts`)
      to assert the new decomposition command is generated for EVERY registered
      agent by iterating the registry (not a hard-coded subset), at each agent's
      adapter path — so the new artifact can never silently land for claude only.
- [x] Run `pnpm vitest run test/batch-engine` and confirm exit code 0 — the phase
      proof-of-work: a fixture batch with an empty later phase is NOT reported done
      after the first phase; `batch apply` triggers a decomposition step that writes
      concrete change intents for the empty phase, and status stays not-done until
      every reachable phase is decomposed and its changes done.
- [x] **Documentation (mandatory — `documentation` standard).** This change makes
      `batch apply` perform decomposition natively (a new behavior at the phase
      boundary), so update these specific docs (named, not "any reference"):
      - `docs/commands/batch.md` — the **`batch apply` section**: document that when
        the next runnable step is a reachable phase with empty `changes`, `batch
        apply` spawns an agent that delegates to the canonical decomposition skill
        to author that phase's concrete change intents into `batch.yaml`, then the
        loop continues into the new changes — no manual stop/propose/resume detour.
      - `docs/engine/overview.md` — update the **lifecycle/phase flowchart** and the
        step-selection reference so a reachable empty phase routes to a
        decomposition spawn (delegating to the canonical skill) that authors the
        phase's `changes`, then re-enters the normal propose/apply/verify loop
        (vertical, high-contrast, every `classDef` sets `color:`); a stale diagram
        is a documentation defect.
      - `docs/engine/agent-runtime.md` — if it enumerates the transitions/spawn
        kinds the engine drives, add the phase-scoped decomposition spawn alongside
        the change-scoped propose/apply/verify spawns; otherwise state explicitly
        that no update is needed there.
      - `docs/configuration/generated-artifacts.md` — the new decomposition command
        is a generated artifact rendered by `ratchet init` for every agent, so add
        it to the generated-commands reference (with its per-agent paths) alongside
        the existing rct commands.
      No new top-level CLI command/flag is added (`batch apply` gains behavior, not
      surface); update `README.md` only if it lists what `batch apply` does —
      otherwise state explicitly that it does not.
