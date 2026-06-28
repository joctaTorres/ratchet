# Delegate the change-verb prompt to `/rct:<transition> <change>`

## Why

The engine's spawned-agent prompt currently HAND-BUILDS the propose/apply/verify
steps inline (`transitionGuidance` in `src/core/batch/engine/instructions.ts`):
it tells the agent to "write files directly on disk", author feature files, and
write `plan.md` by hand. That is a second, engine-local copy of the lifecycle
instructions — exactly the `delegated-lifecycle` defect: it bypasses the
standards-aware skill path, so the agent never loads `.ratchet/standards/` and
"done" can drift from the canonical definition.

The prior change (`guarantee-skill-in-spawn-locus`) made the precondition real:
before spawning, the engine guarantees the rct command is present in the spawn
locus and owns the single-source transition → command-id map
(`rctCommandIdForTransition`). With the skill now guaranteed present, this change
flips the prompt: `buildAgentInstructions` emits a `/rct:<transition> <change>`
skill invocation instead of the inline step descriptions.

## What Changes

- **Rewrite `transitionGuidance`** (`src/core/batch/engine/instructions.ts`) so
  that for `propose`/`apply`/`verify` it emits a single delegating instruction —
  tell the agent to invoke the rct skill for `<change>` — instead of the inline
  step descriptions. Resolve the command id through
  `rctCommandIdForTransition(context.transition)` (the single-source map already
  owned by `skill-locus.ts`) so the invocation and the guarantee's rendered
  command can never drift.
- **Resolve the invocation token from the CONFIGURED spawn agent's adapter — do
  NOT hard-code `/rct:<id>`.** The invocation syntax is not uniform: claude
  namespaces with `:` (`/rct:propose`, from `.claude/commands/rct/<id>.md`) while
  cursor, gemini, codex, github-copilot, and opencode use `/rct-<id>`
  (`/rct-propose`, frontmatter `name: /rct-<id>`). Hard-coding `/rct:<id>` would
  emit Claude's syntax to a cursor/gemini/codex spawn agent, which has no such
  command — a `multi-agent-support` / `delegated-lifecycle` violation. Add a
  per-agent invocation resolver (e.g. `getInvocation(commandId)` on the command
  adapter, alongside `getFilePath`/`formatFile`) and resolve the token via the
  configured agent's adapter (`ctx.settings.agent`) from the command-generation
  registry, so the shared prompt path special-cases no agent.
- **Keep the delegation context-preserving.** `buildAgentInstructions` already
  injects the resolved phase goal/success/proof-of-work and the per-change
  `Definition of done:` line; leave that block in place so the new invocation is
  delegated WITH context, not as a bare call. (Injecting `-m` guidance and resume
  answers as `/rct` arguments is the next change.)
- **Invert the existing prompt-contract tests.** `test/batch-engine/instructions.test.ts`
  currently asserts the prompt contains NO slash-command/"skill" — that contract
  is now reversed for the change-verb path. Update those assertions to require the
  `/rct:<transition> <change>` invocation, and to confirm the inline step text is
  gone, while keeping the agent-neutral (names no coding agent) and
  completion-requirement-up-front assertions.
- **Out of scope (next change):** injecting the `-m` caller guidance and resume
  answer as arguments to the skill invocation (`inject-invocation-context`).

Implements `features/delegation/emit-skill-invocation.feature` and
`features/delegation/invocation-not-bare.feature`.

## Design

- **Single seam, one author.** Only `transitionGuidance` changes shape:
  propose/apply/verify each return a one-line skill delegation rather than a
  multi-line step recipe. The id comes from
  `rctCommandIdForTransition(context.transition)` imported from `skill-locus.ts`,
  so the invocation and the spawn-locus guarantee's rendered command share one
  source of truth and cannot drift.
- **Invocation token is per-agent, prose is agent-neutral.** The token is
  resolved from the configured spawn agent's adapter (claude `/rct:propose`,
  cursor/gemini/codex/etc. `/rct-propose`) — NOT a hard-coded literal, because the
  syntax genuinely differs per agent. The surrounding prose names no coding agent.
  This is the `multi-agent-support` / `delegated-lifecycle` requirement: name the
  canonical skill via the agent's own invocation, never special-case one agent's
  syntax in the shared path.
- **Context stays where it already lives.** `buildAgentInstructions` keeps its
  existing top block (phase goal/success/proof-of-work + `Definition of done:`),
  so the delegation is context-preserving by construction — the only removed text
  is the inline step recipe.
- **Test contract inversion is deliberate.** The existing
  `instructions.test.ts` "no slash-command/skill" assertions encoded the
  pre-delegation contract; they are rewritten (not deleted wholesale) to assert
  the new invocation while retaining the agent-neutral and
  completion-up-front guarantees.
- **Boundary with the next change.** Wiring `-m` guidance and resume answers in
  as `/rct` ARGUMENTS belongs to `inject-invocation-context`; this slice only
  emits the bare-but-context-surrounded invocation.

## Tasks

- [x] Add a per-agent invocation resolver (e.g. `getInvocation(commandId)`) to the
      command adapter interface + every adapter in
      `src/core/command-generation/adapters/` (claude → `/rct:<id>`; cursor,
      gemini, codex, github-copilot, opencode → `/rct-<id>`), so the invocation
      token is owned by each agent's adapter, not hard-coded in the engine.
- [x] Rewrite `transitionGuidance` in `src/core/batch/engine/instructions.ts` to
      emit a delegating instruction for propose/apply/verify that invokes the rct
      skill for `<change>`, resolving the command id via `rctCommandIdForTransition`
      and the invocation TOKEN via the configured spawn agent's adapter
      (`ctx.settings.agent`) `getInvocation(...)` — never a hard-coded `/rct:<id>`.
      Remove the inline "write files directly on disk" / "## Tasks checklist" step
      descriptions for all three transitions.
- [x] Confirm `buildAgentInstructions` still injects the resolved phase
      goal/success/proof-of-work and the per-change `Definition of done:` line
      alongside the new invocation (do not regress to a bare, context-free call).
      The `-m` guidance / resume-answer ARGUMENT wiring stays for the next change.
- [x] Update `test/batch-engine/instructions.test.ts`: replace the
      "references no slash-command/skill" assertions with assertions that, for a
      claude spawn, each transition emits `/rct:<transition> add-login-api`; that
      the inline step text is gone; and that the phase context + `Definition of
      done:` line are still present alongside the invocation. Add a
      registry-iterating assertion that the invocation token matches the
      configured spawn agent (claude `/rct:propose`, cursor/gemini/codex
      `/rct-propose`) — proving no agent's syntax is hard-coded. Keep the
      prose-agent-neutral and completion-requirement-up-front assertions.
- [x] Run `pnpm vitest run test/batch-engine` and confirm exit code 0 — this
      change owns the phase proof-of-work assertion (a) (the spawned prompt
      invokes `/rct:<transition> <change>` rather than describing steps inline)
      and the context-preservation half of (b); assertion (c) is owned by the
      prior change and the full `-m`/resume argument injection by the next.
- [x] **Documentation (mandatory — `documentation` standard, "Reference
      documentation").** Update `docs/engine/agent-runtime.md` so the spawn-flow
      reference shows the prompt delegating to `/rct:<transition> <change>` (not
      hand-built inline steps), cross-referencing the skill-in-spawn-locus
      guarantee section the prior change added. Confirm this change adds NO new
      user-facing command/flag/config key (it is internal prompt-builder
      behavior), so `README.md` needs no edit — note this; if any user-visible
      surface or message is in fact added, update `README.md` in the same task.
- [x] **Multi-agent surface (scoped per `multi-agent-support`).** The invocation
      token is resolved per the configured spawn agent via its adapter's
      `getInvocation` — claude `/rct:<id>`, cursor/gemini/codex `/rct-<id>` — so
      the shared prompt path special-cases no agent. The `getInvocation` resolver
      is added for every command-generation adapter (claude, codex, cursor, gemini,
      github-copilot, opencode); the engine only ever resolves it for the spawnable
      set (claude/codex/gemini/cursor). Tests iterate the spawnable set asserting
      each agent's correct token, never a single hard-coded literal.
