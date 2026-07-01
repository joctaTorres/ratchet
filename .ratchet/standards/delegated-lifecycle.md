---
tag: delegated-lifecycle
---

# Delegated lifecycle

> Concern: architecture

## Intent

Ratchet defines the change lifecycle — propose → apply → verify — exactly once,
in the shared skill/workflow templates that `ratchet init` renders. The CLI and
batch engine **orchestrate** that lifecycle (select the next step, spawn an
agent, enforce gates, journal outcomes) but must never **re-author** it. Any
automated path that spawns an agent to advance a change must delegate to the
canonical ratchet skill/workflow for that transition — e.g. instruct the
headless agent to invoke `/rct:apply <change>` — rather than hand-build a
parallel inline prompt describing the same steps. This keeps the CLI thin and
prevents lifecycle drift: a second, engine-local copy of the instructions
inevitably diverges from the skill path (it omits standards, or defines "done"
differently), which is exactly how standards get silently skipped and how the
verify gate becomes unreachable.

Delegation must be **context-preserving**, not context-free. The spawned-agent
prompt injects the CLI invocation's own prompt and arguments — the change name,
the active phase goal/success/proof-of-work, the per-change definition of done,
and any caller guidance (`-m` messages) or resume answers the CLI already
resolved — alongside the `/rct:apply <change>` invocation. Delegating to the
skill must never drop the orchestration context the engine has in hand; it hands
that context to the skill as arguments, rather than reducing the step to a bare,
context-free skill call.

## Guidelines

- **One author of lifecycle instructions.** The meaning of each transition — what
  propose/apply/verify instruct the agent to do, the standards they embed, the
  definition of done they enforce — is authored once in the shared workflow/skill
  layer (`src/core/templates/workflows/`) and consumed by both interactive skill
  invocation and any headless/engine-driven spawn. There must be exactly one
  source of lifecycle instruction text.
- **Engine-spawned agents delegate to the skill, not a parallel prompt.** When the
  batch engine or a headless verb spawns an agent to advance a change, the prompt
  must invoke the canonical ratchet skill/workflow for that transition (e.g. tell
  the agent to run `/rct:propose`, `/rct:apply`, `/rct:verify` for the named
  change) instead of re-describing the steps inline. The engine must not maintain
  its own hand-written copy of the propose/apply/verify instructions.
- **Delegation injects the invocation's prompt and arguments.** Switching to skill
  delegation must not lose context the engine already resolved. The spawned-agent
  prompt carries the `ratchet <verb>` invocation's prompt and arguments — the
  change name, the active phase's goal/success/proof-of-work, the per-change
  definition of done, and any `-m` guidance or resume answer — injected alongside
  the `/rct:propose|apply|verify <change>` call. A delegation that reduces the step
  to a bare, context-free skill invocation (dropping the phase context, the
  definition of done, or caller guidance) violates this standard.
- **The CLI orchestrates; it does not re-author.** The CLI/engine's job is
  mechanical: pick the next runnable step, enforce phase/approval gates, spawn one
  agent, record the journal entry and outcome. Lifecycle *semantics* — instruction
  content, standards loading, done-criteria — live in the shared lifecycle layer,
  never in the engine. A change that adds lifecycle meaning to the engine instead
  of the shared layer violates this standard.
- **"Done" has one definition.** Whether a change/transition is complete is
  computed in one place and honored by every consumer (status, selection,
  transition). The engine must not carry a second, divergent done-rule — e.g.
  status marking a change done on task-checkboxes alone while the transition logic
  still expects a journaled verify gate. Divergent done-rules are a defect under
  this standard.
- **Delegation stays agent-neutral.** (See `multi-agent-support`.) The delegating
  prompt names the canonical workflow/skill (`/rct:apply <name>`), not an
  agent-specific mechanism, and must render for every supported agent — never
  special-case one agent's invocation syntax in the shared spawn path.
- **Verification treats lifecycle reimplementation as a defect.** A change that
  introduces a parallel lifecycle prompt-builder, or a divergent definition of
  done, in the engine/CLI instead of routing through the shared skill/workflow does
  not satisfy this standard.

## Applies to

Every change that touches the batch engine, the headless propose/apply/verify
verbs, the agent-instruction builders, the step-selection / status / transition
logic, or the shared workflow/skill templates that define the change lifecycle.
Any path that spawns an agent to advance a change must delegate to the canonical
skill/workflow rather than re-author the lifecycle inline.
