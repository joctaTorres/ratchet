# Inject the invocation's `-m` guidance and resume answer as skill arguments

## Why

The prior change (`delegate-change-verb-prompt`) flipped the change-verb prompt to
DELEGATE: `buildAgentInstructions` now emits a `/rct:<transition> <change>`
invocation and keeps the resolved phase goal/success/proof-of-work + per-change
`Definition of done:` in the prompt's top block. But it explicitly deferred one
thing: the caller's `-m` guidance and any resume answer are still rendered by
`additionalGuidance` / `resumeGuidance` as SEPARATE prose blocks — physically
disconnected from the `/rct:<transition> <change>` invocation, with no contract
that the skill reads them.

The `delegated-lifecycle` standard is precise about this: delegation must "hand
that context to the skill **as arguments**, rather than reducing the step to a
bare, context-free skill call." Context that floats elsewhere in the prompt is
not the same as context handed to the skill as part of its invocation. This
change closes that gap: the caller's `-m` guidance and the resolved resume
answer travel WITH the invocation as arguments the skill consumes.

## What Changes

- **Weave the caller `-m` guidance into the invocation as an argument.** Where
  the prompt today emits `/rct:<transition> <change>` and then a detached
  `Additional guidance:` block, the guidance becomes part of the invocation
  delegation — attached to the `/rct:<transition> <change>` call so the skill
  receives it as input (`$ARGUMENTS`), not as orphaned prose.
- **Weave the resolved resume answer into the invocation as an argument.** A
  parked-blocker `answer` (and a rejected-proposal `feedback`) likewise attaches
  to the invocation, so a resumed step delegates WITH the answer in hand rather
  than describing it in a separate section.
- **Both can be present at once** — caller guidance + resume answer are both
  injected alongside the single invocation; neither is dropped.
- **The clean batch path stays clean.** When no `-m` guidance and no resume
  context exist (the plain `batch apply` path), the invocation remains the bare
  `/rct:<transition> <change>` with no trailing empty-argument noise — batch
  instructions must not regress to carrying spurious argument scaffolding.
- **Never a bare, context-free call.** The phase goal/success/proof-of-work and
  the per-change `Definition of done:` line stay present alongside the invocation
  and its injected arguments (re-asserting the prior change's context-preservation
  contract while adding the argument injection this change owns).
- **Stay agent-neutral / per-agent token preserved** (`multi-agent-support` /
  `delegated-lifecycle`). Argument injection appends to the token resolved from
  the configured spawn agent's adapter (claude `/rct:propose`, cursor/gemini/
  codex `/rct-propose`); it must not hard-code one agent's syntax.

Implements `features/invocation-context/inject-caller-guidance.feature` and
`features/invocation-context/inject-resume-answer.feature`.

## Design

- **Single seam: the invocation builder.** The injection happens where the
  invocation is constructed (`rctInvocation` / `transitionGuidance` in
  `src/core/batch/engine/instructions.ts`). The change name plus the resolved
  caller guidance and resume answer become the argument payload handed to the
  skill, so the delegation block is self-contained and the skill reads its
  context from its own invocation.
- **Fold the disconnected blocks into the delegation.** `additionalGuidance`
  (the `-m` block) and the answer/feedback half of `resumeGuidance` are no longer
  emitted as standalone, far-from-the-invocation sections; their content is
  routed into the invocation's arguments. The resume *intent* prose ("this step
  was parked / the prior proposal was rejected — revise, do not start over") may
  remain as framing, but the actual answer/feedback text travels as an argument.
- **Multi-line guidance handling is an apply-time formatting decision**, but the
  observable contract is fixed by the features: the guidance/resume text appears
  ATTACHED to the invocation (part of the same delegation, consumed as the
  skill's arguments), never as an orphaned block, and the invocation is never
  bare when context exists — while the no-context path stays a clean
  `/rct:<transition> <change>`.
- **Agent-neutrality is preserved by construction**: only the trailing arguments
  are appended; the invocation TOKEN still comes from the configured spawn
  agent's adapter via the existing `getInvocation` resolver — no agent's syntax
  is hard-coded in the shared path.
- **Phase boundary with the prior change.** `delegate-change-verb-prompt` owns
  emitting the invocation + keeping phase context/done present; THIS change owns
  the `-m` guidance + resume-answer ARGUMENT injection it deferred. Together they
  satisfy the phase definition of done.

## Tasks

- [x] Route the caller's `-m` guidance into the `/rct:<transition> <change>`
      invocation as an argument the skill consumes, in
      `src/core/batch/engine/instructions.ts` — replacing the detached
      `additionalGuidance` "Additional guidance:" block as the carrier of that
      text (attach it to the invocation, not a separate far-away section).
- [x] Route the resolved resume answer (parked-blocker `answer`; rejected-
      proposal `feedback`) into the invocation as an argument, so a resumed step
      delegates WITH the answer/feedback in hand. Keep any resume *intent* framing
      ("revise the draft, do not start over") but move the answer text itself into
      the invocation arguments.
- [x] Ensure both caller guidance and a resume answer, when both present, are
      injected together alongside the single invocation — neither dropped.
- [x] Keep the no-context path clean: with no `-m` guidance and no resume context
      (the plain `batch apply` path), the invocation stays the bare
      `/rct:<transition> <change>` with no trailing empty-argument noise.
- [x] Preserve context: the resolved phase goal/success/proof-of-work and the
      per-change `Definition of done:` line remain present alongside the
      invocation + injected arguments — never a bare, context-free call.
- [x] Preserve agent-neutrality: argument injection appends to the token resolved
      from the configured spawn agent's adapter (`getInvocation`) — claude
      `/rct:<id>`, cursor/gemini/codex `/rct-<id>` — never a hard-coded literal.
- [x] Add tests in `test/batch-engine/instructions.test.ts` asserting: (a) the
      `-m` guidance is attached to the invocation (not a detached block);
      (b) a resume answer / rejection feedback is attached to the invocation;
      (c) both-present are injected together; (d) the no-context path emits a
      clean `/rct:<transition> <change>`; (e) injection preserves the per-agent
      token (cursor `/rct-propose`, not hard-coded `/rct:propose`); (f) the phase
      context + `Definition of done:` line remain alongside the invocation.
- [x] Run `pnpm vitest run test/batch-engine` and confirm exit code 0 — this
      change completes phase proof-of-work assertion (b) (the resolved phase
      context + per-change done + caller guidance are injected into the prompt)
      by adding the `-m`/resume ARGUMENT injection the prior change deferred.
- [x] **Documentation (mandatory — `documentation` standard, "Reference
      documentation").** Update `docs/engine/agent-runtime.md` so the spawn-flow
      reference shows the `-m` guidance and resume answer injected as arguments to
      the `/rct:<transition> <change>` invocation (context-preserving delegation),
      cross-referencing the delegation section the prior change added. Confirm
      this change adds NO new user-facing command/flag/config key (it is internal
      prompt-builder behavior), so `README.md` needs no edit — note this; if any
      user-visible surface is in fact added, update `README.md` in the same task.
- [x] **Multi-agent surface (scoped per `multi-agent-support`).** Confirm
      argument injection special-cases no agent: the invocation token is resolved
      per the configured spawn agent's adapter and only the trailing arguments are
      appended. A test iterates the spawnable set (claude/codex/gemini/cursor)
      asserting the per-agent token is preserved with arguments attached.
