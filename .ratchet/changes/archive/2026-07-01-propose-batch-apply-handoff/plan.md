# Hand off from propose-batch into apply-batch

## Why

After `propose-batch` writes the manifest, the skill currently offers to propose
phase one's changes now (chain into `/rct:propose`). The better next move is to
drive the batch itself: hand the user straight into `apply-batch` so the current
session can act as the orchestrator. This replaces the propose-change chain-in
with an apply-batch hand-off, removing a detour and matching how a batch is meant
to be run.

## What Changes

- **BREAKING (workflow behavior)**: the final gate of the shared `propose-batch`
  body (`src/core/templates/workflows/propose-batch.ts`) no longer offers to
  propose phase-one changes. It now offers to **drive the batch now via
  apply-batch**, with two paths:
  - **Directly**: chain into the apply-batch workflow (`/rct:apply-batch <name>`)
    in the current session, which then acts as the batch orchestrator.
  - **Indirectly**: defer — tell the user they can run apply-batch on the batch
    later themselves; changes are still created lazily during `ratchet batch apply`.
- Update the skill's docstring, the **Output** summary, and the **Guardrails**
  bullet that described the propose-change chain-in to describe the apply-batch
  hand-off instead.
- Keep the gate **explicit** (never automatic) and **agent-neutral**: name the
  apply-batch workflow without assuming one agent, and keep the
  structured-question step optional with a plain-prose fallback.
- Replace the store feature `propose-batch/gated-chain-in.feature` (reusing the
  same path) with the apply-batch hand-off behavior. Implements
  `features/propose-batch/gated-chain-in.feature`.
- Update `test/core/templates/workflows/propose-batch.test.ts` so the chain-in
  assertions check the apply-batch hand-off (and drop the propose-change ones).

## Design

**Shared body, rendered per agent.** The change edits one shared constant
(`PROPOSE_BATCH_BODY`), which feeds both the skill (`getProposeBatchSkillTemplate`)
and the command (`getRctProposeBatchCommandTemplate`). Per the `multi-agent-support`
standard there are no agent-specific copies; `ratchet init` renders this single
body into every registered tool. Per-agent outputs touched (all via the shared
body — no per-agent edits):

| Tool | Skill | Command |
|---|---|---|
| claude | `.claude/skills/ratchet-propose-batch/` | `.claude/commands/rct/rct-propose-batch.md` |
| codex | `.codex/skills/ratchet-propose-batch/` | `~/.codex/prompts/rct-rct-propose-batch.md` |
| cursor | `.cursor/skills/ratchet-propose-batch/` | `.cursor/commands/rct-rct-propose-batch.md` |
| github-copilot | `.github/skills/ratchet-propose-batch/` | `.github/prompts/rct-rct-propose-batch.prompt.md` |
| opencode | `.opencode/skills/ratchet-propose-batch/` | `.opencode/commands/rct-rct-propose-batch.md` |

**Agent-neutral phrasing.** Reference "the apply-batch workflow
(`/rct:apply-batch <name>`)" rather than a Claude-specific instruction, mirroring
how the body already references `/rct:propose` and `ratchet batch apply`. The
"drive now" path says the current session becomes the orchestrator — consistent
with the apply-batch skill, where the orchestrating session runs only `ratchet`
CLI commands and does no coding itself. The AskUserQuestion mention stays guarded
with a plain-prose fallback, as elsewhere in the body.

**Clean feature replacement.** Authoring the new scenarios at the existing path
`features/propose-batch/gated-chain-in.feature` overwrites the store entry at
archive time instead of orphaning it, so the standard's `Implemented by` list
stays valid. The feature is reframed from "propose phase-one changes" to "drive
the batch via apply-batch".

**No CLI/engine change.** This is purely workflow-guidance text plus its tests;
the `ratchet batch` CLI, engine, and manifest are untouched.

## Tasks

- [x] 1.1 Rewrite step 5 of `PROPOSE_BATCH_BODY` in `src/core/templates/workflows/propose-batch.ts` to a gated apply-batch hand-off (direct: chain into `/rct:apply-batch <name>` as orchestrator; indirect: defer to the user), agent-neutral with a plain-prose fallback
- [x] 1.2 Update the file docstring, the **Output** bullet, and the **Guardrails** bullet to describe the apply-batch hand-off instead of the propose-change chain-in
- [x] 2.1 Update `test/core/templates/workflows/propose-batch.test.ts`: assert the body offers the apply-batch hand-off (direct + indirect), is an explicit gate, and no longer offers to propose phase-one changes
- [x] 2.2 Keep/extend the per-tool rendering test so the apply-batch hand-off text appears in every registered tool's rendered command
- [x] 3.1 Run `pnpm build`, `pnpm lint`, and `pnpm test`; confirm the propose-batch suite and full suite pass
