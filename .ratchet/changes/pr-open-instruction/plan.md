# pr-open-instruction

## Why

Phase 2 of the `per-stage-agents-and-prs` batch will spawn a dedicated PR agent
at batch completion to open a single whole-batch PR. Before any spawn or engine
orchestration exists (`pr-spawn-at-completion`), the *instruction that agent will
follow* must exist: one shared, forge-agnostic PR-open command, authored once in
the shared command/workflow layer, that renders for every registered agent and is
guaranteed into the spawn locus by the existing render-or-fail skill-locus path.
This is the instruction-authoring slice — the canonical PR skill the engine will
later delegate to — mirroring how `decompose-phase` landed its shared
engine-spawned command before the engine wired the spawn.

## What Changes

- A new shared workflow, `src/core/templates/workflows/pr-open.ts`, authors the
  PR-open lifecycle instructions **once** as a single shared body constant and
  exports a paired skill template (`getPrOpenSkillTemplate`, dir
  `ratchet-pr-open`) and command template (`getRctPrOpenCommandTemplate`, id
  `pr-open`) — the exact pattern `decompose-phase` uses for an engine-spawned
  command. The shared body instructs the agent to: read `git log` for the repo's
  commit-message style (defaulting to semantic / Conventional Commits), commit the
  accumulated uncommitted work of the prior stage agents in that style, push the
  work branch to its remote, and open **exactly one** pull request from the work
  branch to its base branch using whichever forge CLI the environment provides.
- The new workflow is re-exported from `src/core/templates/skill-templates.ts` and
  registered in **both** lists in `src/core/shared/skill-generation.ts`
  (`getSkillTemplates` → `getCommandTemplates`/`getCommandContents`), so
  `ratchet init` and the spawn-locus render path emit it for every agent in the
  supported-tools registry.
- `src/core/batch/engine/skill-locus.ts` gains a single-source
  `PR_OPEN_COMMAND_ID = 'pr-open'` constant beside the existing
  `DECOMPOSE_COMMAND_ID`, so the later spawn change and the agent invocation token
  (`/rct:pr-open`) resolve the id from one place and cannot drift. The existing
  generic `ensureCommandInSpawnLocus(commandId, settings, root, deps, stage?)`
  already render-or-fails for **any** command id and already accepts the `pr`
  stage (widened by `pr-grouping-config`), so it guarantees `pr-open` for the `pr`
  stage with **no change to its body** — this slice only adds the id and proves
  the guarantee.
- Implements `features/pr-open-instruction/shared-command.feature`.
- Documents the new `pr-open` command in `docs/configuration/generated-artifacts.md`
  and `docs/engine/agent-runtime.md`, and updates `README.md`.

Not a breaking change: it adds a new workflow/command and a new constant only. No
existing skill, command, engine path, or config is altered, and nothing spawns the
PR agent yet — that is `pr-spawn-at-completion`.

**Per-agent generated surface** (multi-agent-support — enumerated before build).
The `pr-open` command (and `ratchet-pr-open` skill) render for every registered
agent at that agent's own path, via the adapter registry — never hand-authored per
agent:

| Agent | Command file | Skill file |
|---|---|---|
| Claude Code | `.claude/commands/rct/pr-open.md` | `.claude/skills/ratchet-pr-open/SKILL.md` |
| Cursor | `.cursor/commands/rct-pr-open.md` | `.cursor/skills/ratchet-pr-open/SKILL.md` |
| Codex | `~/.codex/prompts/rct-pr-open.md` | `.codex/skills/ratchet-pr-open/SKILL.md` |
| Gemini | `.gemini/commands/rct-pr-open.md` | `.gemini/skills/ratchet-pr-open/SKILL.md` |
| GitHub Copilot | `.github/prompts/rct-pr-open.prompt.md` | `.github/skills/ratchet-pr-open/SKILL.md` |
| OpenCode | `.opencode/commands/rct-pr-open.md` | `.opencode/skills/ratchet-pr-open/SKILL.md` |

## Design

**One author of lifecycle instructions (`delegated-lifecycle`).** The PR-open
instructions are authored exactly once, in the shared workflow layer
(`src/core/templates/workflows/pr-open.ts`), as a single `PR_OPEN_BODY` constant
that both the skill and the command template return — the same "one shared body"
convention every workflow file uses. The engine will *orchestrate* the PR step
(select it, spawn one agent, journal the outcome) but must never re-author these
steps inline: the later `pr-spawn-at-completion` change delegates to
`/rct:pr-open` (via the shared command guaranteed in the locus), never a parallel
engine-local prompt. Authoring the shared instruction now is what makes that
delegation possible. Placing the id in `PR_OPEN_COMMAND_ID` (one place) keeps the
spawn-locus guarantee and the `/rct:pr-open` invocation token from drifting, the
same single-source discipline as `DECOMPOSE_COMMAND_ID`.

**Its own command id, distinct from the `pr` stage.** The `pr` added by
`pr-grouping-config` is a routable *agent stage* (which agent runs the PR step);
`pr-open` is the *command id* (what instruction that agent runs). They are
deliberately separate names — the stage selects the binary, the command id selects
the skill — so `ensureCommandInSpawnLocus(PR_OPEN_COMMAND_ID, settings, root,
deps, /* stage */ 'pr')` renders the `pr-open` command for whichever agent the
`pr` stage resolves to. Authoring a distinct command id (rather than reusing a
transition id) matches how `decompose-phase` got its own id for a distinct
lifecycle operation.

**Guaranteed in the spawn locus by the existing render-or-fail path
(`delegated-lifecycle`).** No new locus logic is written. `ensureCommandInSpawnLocus`
already: resolves the per-agent command adapter from the registry, computes
`adapter.getFilePath('pr-open')` under the locus, renders from the shared
definition (`getCommandContents(['pr-open'])`) when absent, verifies-and-leaves
when present, and throws an actionable `SkillLocusError` — naming the command and
locus, never telling the agent to invoke a command it cannot run — for an
unrenderable (`remote`) locus. Registering `pr-open` in the shared command list is
what makes `getCommandContents(['pr-open'])` resolve; the `pr` stage already
type-checks as an `AgentStage`. So the guarantee holds for `pr-open` with only the
id constant added.

**Tool-agnostic, rendered for every agent (`multi-agent-support`).** The command
is defined once as shared, agent-neutral content and rendered per agent through the
adapter registry (`src/core/command-generation/registry.ts`) — the per-agent paths
are enumerated above; no agent is special-cased and no agent-specific copy is
authored. The body names "the coding agent" / "your agent", never one agent, and
assumes no capability unique to a single agent (e.g. no Claude-only
`AskUserQuestion`); any elicitation is phrased as plain prose that works in any
agent. Registering in `getSkillTemplates` (which feeds `getCommandTemplates`)
guarantees `ratchet init` emits it into every registered tool's directory.

**Forge-agnostic and toolchain-agnostic (`generalizable-defaults`).** The
instruction ships into arbitrary user repositories, so it must not carry ratchet's
own toolchain or assume one forge. The body instructs the agent to detect and use
**whichever forge CLI the environment provides** (gh / glab / other are named only
as non-exhaustive examples, never as the required tool), and to read the repo's own
`git log` to derive the commit style — deriving from the user's environment rather
than baking in a command string. It hard-codes no package manager, test runner, or
single forge command as required, and defaults to semantic / Conventional Commits
(a neutral, ecosystem-agnostic convention) only when `git log` is inconclusive. If
no forge CLI is available the body instructs the agent to stop and report the
failure (the engine surfaces it as a reported step failure in a later change),
never to silently fall back to a ratchet-specific command.

**Instruction-fed, not config-reading (`instruction-fed-config`).** The body is a
static shared template; it reads no ratchet config inline and embeds no
"if config says X" branching. Any dynamic, config-driven inputs the PR step needs
(e.g. the resolved base branch, grouping mode) will be delivered as **data** in the
spawn prompt / `ratchet instructions` payload by `pr-spawn-at-completion` — this
change keeps the template static and agent-neutral so resolved behavior never
special-cases an agent or reads config from the skill.

**Testing (`testing`).** Proven at the unit layer (pure template/registry/locus
logic, no process spawn), following the pyramid; the phase's blackbox e2e lands
with `whole-batch-pr-e2e-and-docs`:
- A new `test/core/templates/workflows/pr-open.test.ts` (header naming
  `features/pr-open-instruction/shared-command.feature`) asserts the command/skill
  template identity (id `pr-open`, dir `ratchet-pr-open`, name/description/tags) and
  that the shared body directs the agent to: read `git log` for commit style with a
  semantic/Conventional default, commit the accumulated uncommitted work, push the
  work branch, open exactly one PR to its base branch, use the environment's forge
  CLI, and that it is forge-agnostic (no single forge CLI or ratchet toolchain hard
  required) and agent-neutral (no single-agent tool named; no literal "Claude").
- `test/core/shared/skill-generation.test.ts` is extended to assert `pr-open` is in
  `getCommandTemplates()`/`getCommandContents()` and `ratchet-pr-open` in
  `getSkillTemplates()`, and that the command **renders for every registered agent**
  by iterating `CommandAdapterRegistry.getAll()` and rendering the shared content
  through each adapter (no hard-coded single agent).
- `test/batch-engine/skill-locus.test.ts` is extended to assert
  `PR_OPEN_COMMAND_ID === 'pr-open'` and that `ensureCommandInSpawnLocus('pr-open',
  …, 'pr')` renders the command at each agent's adapter path from the shared
  content, leaves an existing file untouched, and throws an actionable
  `SkillLocusError` naming `pr-open` for a `remote` locus.
- The full suite and the coverage gate stay green at or above the enforced
  `COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** The `pr-open` command is a new
user-facing generated artifact and a new engine-spawned command, so it is
documented in the same change:
- `docs/configuration/generated-artifacts.md` — add a `pr-open` / `ratchet-pr-open`
  row to the generated-workflows table and a short note (matching the existing
  `decompose-phase` note) that the command is also the artifact the batch engine
  renders into the spawn locus for the whole-batch PR step, generated for every
  tool at that tool's command path.
- `docs/engine/agent-runtime.md` — add `pr-open` to the canonical command-id table
  and note that the skill-locus render-or-fail guarantee renders/verifies the
  `pr-open` command the same way before the PR spawn.
- `README.md` — add `pr-open` to the generated `commands/rct/{…}` listing so the
  README does not describe a stale command set.
- This updates existing Reference tables / adds one command entry rather than
  introducing a new core flow, so — per the standard's "do not over-document
  visually" guidance — no new overview Mermaid diagram is warranted here; the
  existing skill-locus render-or-fail diagram already covers the guarantee, and the
  whole-batch PR flow diagram lands with `whole-batch-pr-e2e-and-docs`.

## Tasks

- [x] 1.1 Create `src/core/templates/workflows/pr-open.ts`: author a single
  `PR_OPEN_BODY` shared constant instructing the agent to read `git log` for the
  repo's commit style (semantic / Conventional Commits default), commit the
  accumulated uncommitted work of the prior stage agents in that style, push the
  work branch to its remote, and open exactly one PR from the work branch to its
  base branch via whichever forge CLI the environment provides (forge-agnostic,
  agent-neutral, no ratchet toolchain). Export `getPrOpenSkillTemplate()` (dir
  `ratchet-pr-open`) and `getRctPrOpenCommandTemplate()` (id `pr-open`), both
  returning `PR_OPEN_BODY`, mirroring `decompose-phase.ts`.
- [x] 1.2 Re-export the two `pr-open` template getters from
  `src/core/templates/skill-templates.ts` (and `index.ts` if it re-exports).
- [x] 1.3 Register the workflow in `src/core/shared/skill-generation.ts`: add
  `{ …getPrOpenSkillTemplate(), dirName: 'ratchet-pr-open', workflowId: 'pr-open' }`
  to `getSkillTemplates` and `{ …getRctPrOpenCommandTemplate(), id: 'pr-open' }`
  to `getCommandTemplates`, so `getCommandContents(['pr-open'])` resolves.
- [x] 1.4 Add `export const PR_OPEN_COMMAND_ID = 'pr-open'` to
  `src/core/batch/engine/skill-locus.ts` beside `DECOMPOSE_COMMAND_ID`, with a
  comment that the render-or-fail guarantee (`ensureCommandInSpawnLocus`) and the
  `/rct:pr-open` invocation resolve the id from this one place; confirm no change
  to `ensureCommandInSpawnLocus` is needed (it already render-or-fails any id and
  accepts the `pr` stage).
- [x] 2.1 Add `test/core/templates/workflows/pr-open.test.ts` (header names
  `features/pr-open-instruction/shared-command.feature`): assert template identity
  (id/dir/name/tags) and that `PR_OPEN_BODY` directs git-log commit-style reading
  with semantic/Conventional default, committing accumulated work, pushing the work
  branch, opening exactly one PR to the base branch, using the environment's forge
  CLI, being forge-agnostic (no single forge/toolchain hard-required) and
  agent-neutral (no single-agent tool; no literal "Claude").
- [x] 2.2 Extend `test/core/shared/skill-generation.test.ts`: assert `pr-open` in
  `getCommandTemplates()`/`getCommandContents()` and `ratchet-pr-open` in
  `getSkillTemplates()`, and that the command renders through **every** adapter in
  `CommandAdapterRegistry.getAll()`.
- [x] 2.3 Extend `test/batch-engine/skill-locus.test.ts`: assert
  `PR_OPEN_COMMAND_ID === 'pr-open'`; that `ensureCommandInSpawnLocus('pr-open', …,
  'pr')` renders the command at each agent's adapter path from the shared content,
  verifies an existing file untouched, and throws an actionable `SkillLocusError`
  naming `pr-open` for a `remote` locus. Confirm the full suite + coverage gate
  stay green.
- [x] 3.1 (`documentation`, mandatory) Add the `pr-open` / `ratchet-pr-open` row +
  spawn-locus note to `docs/configuration/generated-artifacts.md`; add `pr-open` to
  the command-id table and the skill-locus render note in
  `docs/engine/agent-runtime.md`; add `pr-open` to the generated commands listing in
  `README.md`. No new Mermaid diagram (existing render-or-fail diagram suffices; the
  PR-flow overview lands with `whole-batch-pr-e2e-and-docs`).
