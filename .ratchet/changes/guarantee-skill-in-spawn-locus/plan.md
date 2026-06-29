# Guarantee the rct skill is present in the spawn locus before delegating

## Why

This batch makes the change-verb spawn path delegate to the canonical rct skill
(`/rct:<transition> <change>`) instead of hand-building an inline prompt
(`delegated-lifecycle` standard). That delegation is only safe if the skill is
actually runnable where the engine spawns the agent. The `rex-agent-runtime`
batch raised exactly this risk ("don't tell a headless agent to use a skill it
cannot invoke"); the resolution recorded in the manifest is to make
"the rct command is present in the spawn locus" an **explicit, enforced
precondition (render-or-fail)** — this change builds that precondition first, so
the later prompt-delegation changes (`delegate-change-verb-prompt`,
`inject-invocation-context`) can rely on it.

This is the thin vertical slice for the precondition only: it guarantees the
command file exists in the spawn locus (renders it or verifies it), and fails
with a clear, actionable bootstrap message when it cannot. It does NOT yet change
the prompt to invoke `/rct:<transition>` — that is the next change.

## What Changes

- **New guarantee seam** `ensureSkillInSpawnLocus(...)` (e.g.
  `src/core/batch/engine/skill-locus.ts`): given the forced transition, the
  configured agent, and the spawn locus (project root for `local`/`docker`),
  resolve the canonical rct command id for the transition (`propose`/`apply`/
  `verify`), resolve the **per-agent** command adapter from the
  command-generation registry (`src/core/command-generation/`), compute the
  command file path via `adapter.getFilePath(<id>)` under the locus, and:
  - if present → verify and leave untouched;
  - if absent → render it from the **shared** command content
    (`adapter.formatFile(...)`) and write it;
  - if the locus is one the engine cannot place files into (e.g. `remote`), or
    the render/write fails → throw an actionable `SkillLocusError`.
  Side effects (exists/read/write) go through an injectable deps seam so the
  logic is unit-testable without touching disk, mirroring `rex-bootstrap.ts`.
- **Wire it into `runChangeStep`** (`src/core/batch/engine/engine.ts`): evaluate
  the guarantee BEFORE `buildSpawnRequest` and before `selectRuntime`/runtime
  invocation. On `SkillLocusError`, short-circuit to a `failed`/`blocked`
  `StepResult` carrying the actionable message (no agent spawned, step stays
  resumable) — reusing the existing bootstrap-error contract (the same shape as
  the `UnknownAgentError` / `failingRuntime` paths: non-zero result, message
  surfaced on the live sink, no new outcome state).
- **Transition → command-id map** kept in one place so propose→`/rct:propose`,
  apply→`/rct:apply`, verify→`/rct:verify` stay aligned with the later
  prompt-delegation change.
- **Out of scope (next changes):** emitting the `/rct:<transition> <change>`
  invocation in the prompt and injecting the resolved phase context / per-change
  done / `-m` guidance / resume answer. `buildAgentInstructions` is unchanged by
  this slice.

Implements `features/spawn-locus/guarantee-skill-present.feature` and
`features/spawn-locus/bootstrap-failure.feature`.

## Tasks

- [x] Add a transition→rct-command-id mapping and `ensureSkillInSpawnLocus(ctx,
      projectRoot, deps)` in `src/core/batch/engine/skill-locus.ts`, with an
      injectable deps seam (`exists`/`writeText`) and an actionable
      `SkillLocusError`. Resolve the command adapter for `ctx.settings.agent`
      (default `claude`) from the command-generation registry — never hard-code a
      single agent's path.
- [x] Write `test/batch-engine/skill-locus.test.ts` asserting, with fake deps:
      (a) a missing command is rendered at the configured agent's
      `getFilePath(<transition>)` from the shared command content, (b) an
      existing command is left untouched, (c) the transition selects exactly its
      own rct command, and (d) a locus the engine cannot write into (remote) or a
      failed write raises `SkillLocusError` with a message that names the missing
      command + locus + remedy and never tells the agent to invoke an
      unavailable skill. **Iterate the batch-engine spawnable adapter set**
      (`BUILTIN_ADAPTERS` in `src/core/batch/engine/agent.ts` — claude, codex,
      gemini, cursor) rather than hard-coding one (`multi-agent-support`). Scope
      note: the guarantee runs at SPAWN time for the configured spawn agent, and
      `resolveAdapter` rejects any agent without a spawn adapter
      (`UnknownAgentError`) before a spawn — so `github-copilot` and `opencode`
      (command-generation adapters but no batch-engine spawn adapter) can never be
      the spawn agent here and are intentionally out of scope. Drive the test from
      the spawnable registry so it stays correct if a spawn adapter is added.
- [x] Wire the guarantee into `RatchetBatchEngine.runChangeStep`
      (`src/core/batch/engine/engine.ts`): evaluate it before `buildSpawnRequest`
      and runtime selection; map `SkillLocusError` to a `failed`/`blocked`
      `StepResult` (no spawn, resumable) using the existing bootstrap-error
      contract. Add an integration test in `test/batch-engine` asserting that an
      injected runtime is NEVER invoked when the guarantee fails, and that the
      command file is present in the spawn cwd before the runtime runs when it
      succeeds.
- [x] Run `pnpm vitest run test/batch-engine` and confirm exit code 0 — the new
      and existing batch-engine suites pass (the prompt-delegation assertions
      (a)/(b) of the phase proof-of-work land with the next changes; this change
      owns assertion (c): skill guaranteed/rendered or a clear, actionable
      failure with no instruction to invoke an unavailable skill).
- [x] **Documentation (mandatory — `documentation` standard, "Reference
      documentation").** Update `docs/engine/agent-runtime.md` (the engine spawn
      reference) with a new "Skill-in-spawn-locus guarantee" section documenting:
      the render-or-fail precondition, the transition→`/rct:<id>` mapping, the
      per-agent command-path resolution via the command-generation registry, the
      `SkillLocusError` bootstrap-failure contract, and where it runs in
      `runChangeStep` (before the spawn). Add/refresh the engine spawn-flow
      Mermaid overview diagram (vertical, high-contrast, every `classDef` sets
      `color:`) so the guarantee step appears before the spawn. This change adds
      NO new user-facing command/flag/config key (it is internal engine
      behavior), so `README.md` needs no edit — confirm and note this in the
      documentation task at apply time; if any user-visible surface or message is
      in fact added, update `README.md` in the same task.
- [x] **Multi-agent surface (scoped per `multi-agent-support`).** The guarantee
      renders the rct command for the configured **spawn** agent at that agent's
      command-adapter path — claude → `.claude/commands/rct/<transition>.md`;
      cursor, codex, gemini → their respective `getFilePath(<transition>)`
      (resolved from each adapter in `src/core/command-generation/adapters/`).
      The applicable set is the **batch-engine spawnable agents**
      (`BUILTIN_ADAPTERS`: claude, codex, gemini, cursor), because the guarantee
      only ever runs for an agent the engine can spawn. `github-copilot` and
      `opencode` have command-generation adapters but **no batch-engine spawn
      adapter**, so they cannot be the spawn agent (`resolveAdapter` →
      `UnknownAgentError`) and are out of scope for this spawn-time guarantee —
      a pre-existing engine limitation, not introduced or widened here. The shared
      spawn path stays agent-neutral and routes through the registry; tests
      iterate the spawnable set rather than asserting one agent.
