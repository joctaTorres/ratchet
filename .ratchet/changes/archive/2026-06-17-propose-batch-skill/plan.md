# propose-batch-skill

## Why

Ratchet can propose a single change (`/rct:propose`) and drive a batch one step at a
time (`/rct:batch`), but there is no guided workflow for *proposing a batch* — the
phased, anti-waterfall multi-change unit. Today a user must hand-author a
`.ratchet/batches/<name>/batch.yaml` manifest with the right vertical-slice phases and
proofs-of-work. This change adds a `propose-batch` workflow skill that guides that
authoring, embodying the anti-waterfall principles, so batches are planned
shallow-but-wide instead of as a frozen up-front change list.

## What Changes

- Add a new `propose-batch` workflow: a guided skill + command that **writes a batch
  manifest** at `.ratchet/batches/<name>/batch.yaml`. It is NOT a new ratchet schema and
  NOT a change-directory generator.
- The skill flow: explore the objective → slice into ordered vertical-slice phases →
  require success criteria + a proof-of-work (`integration` | `blackbox` | `llm-judge`)
  per phase → scaffold the manifest with a shallow DAG of change intents → ask a gated
  "propose phase-one changes now?" prompt that optionally chains into the propose-change
  flow.
- The skill actively **rejects horizontal / infra-only phases** (e.g. "set up the DB",
  "build all the models") and counter-proposes vertical slices that ship runnable
  software.
- The skill **refuses to scaffold** any phase lacking success criteria + a
  proof-of-work. Phase one's proof must be a concrete runnable command + pass condition;
  later phases may carry a described proof whose exact command is refined at phase entry.
- Register the workflow as **opt-in** (alongside `batch`), NOT in the core profile.
- Render the skill and command for **every** supported agent (Claude Code, Codex, Cursor,
  GitHub Copilot, OpenCode) per the `multi-agent-support` standard.
- Implements the feature files under `features/propose-batch/`:
  `phase-elicitation.feature`, `reject-horizontal-phases.feature`,
  `proof-of-work-required.feature`, `scaffold-manifest.feature`,
  `gated-chain-in.feature`, `multi-agent-surface.feature`.

## Design

This change adds a workflow whose entire payload is a guided prose body — it introduces
no new core logic, no batch schema, and no CLI command. It reuses the existing
batch-manifest machinery and the existing per-agent skill/command rendering pipeline.

**Anti-waterfall rationale, mapped to skill behavior** (these are the design's load-bearing
constraints, stated in the skill body as rationale):
- *Inflexibility to change* → the skill commits to phase **contracts**, not a frozen
  change list; phases are independently shippable; the manifest is editable intent. The
  skill writes only phase one's change intents concretely.
- *Late error detection* → every phase declares an executable proof-of-work that runs at
  its boundary; the skill refuses to scaffold a phase without one.
- *No early customer feedback* → every phase must be a vertical slice that ships working
  software; the skill rejects horizontal/infra-only phases.
- *Planning fallacy* → no complete-upfront-knowledge demand; the skill plans
  shallow-but-wide (all phases as goal+proof now, change detail deferred), decomposing
  phase N with phase N-1's real outcomes at apply time.

**Concrete touch points:**

1. **New workflow template** `src/core/templates/workflows/propose-batch.ts`, mirroring
   the `src/core/templates/workflows/propose.ts` pattern: export
   `getProposeBatchSkillTemplate(): SkillTemplate` and
   `getRctProposeBatchCommandTemplate(): CommandTemplate`. Like `batch.ts`, define a single
   shared body constant reused by both. The body encodes the five-step flow, the
   anti-waterfall rationale, the proof-of-work hard requirement, and the gated chain-in
   prompt. Following `multi-agent-support`, the body is agent-neutral ("your agent") and
   phrases any structured-question step (e.g. `AskUserQuestion`) as optional with a
   plain-prose fallback. Command metadata: category `Workflow`, tags
   `['workflow', 'batch', 'experimental']`.

2. **Manifest authoring via existing machinery only.** The skill body instructs the agent
   to run `ratchet new batch <name>` (`src/commands/batch/new-batch.ts`, which stamps the
   `schemas/ratchet/templates/batch.yaml` template) and then edit the resulting
   `.ratchet/batches/<name>/batch.yaml`. The manifest shape is already defined by
   `BatchManifestSchema` in `src/core/batch/manifest.ts` (`phases[].{name, goal, success,
   proofOfWork{kind,run,pass}, changes[]{name, after[]}}` and optional
   `settings{gate, strategy, proofOfWork, agent}`). The skill introduces **no schema
   change**; it writes intent the existing parser/validator already accepts. The "shallow
   DAG" maps directly to: phase one's `changes` populated with `after` edges; later phases'
   `changes` left empty (a change intent with no change dir is a valid `pending`, per the
   manifest doc comment).

3. **Registration (opt-in, not core).**
   - Re-export the two template getters from the facade
     `src/core/templates/skill-templates.ts` (alongside the existing `getBatchSkillTemplate`
     / `getRctBatchCommandTemplate` re-exports).
   - Add a `SkillTemplateEntry` (`dirName: 'ratchet-propose-batch'`,
     `workflowId: 'propose-batch'`) to `getSkillTemplates` and a `CommandTemplateEntry`
     (`id: 'propose-batch'`) to `getCommandTemplates` in
     `src/core/shared/skill-generation.ts`.
   - Add `'propose-batch'` to `ALL_WORKFLOWS` in `src/core/profiles.ts`. Do **NOT** add it
     to `CORE_WORKFLOWS`: like `batch`, it is opt-in and installed only for custom profiles
     that request it. (Caveat: it is only useful alongside `batch`; the docs/template should
     note the pairing, but enforcing the pairing is out of scope.)

4. **Per-agent rendering** is automatic once registered: `multi-agent-support` requires the
   shared content render through the adapter registry
   (`src/core/command-generation/registry.ts`) into each agent in the supported-tools
   registry (`src/core/config.ts`) — Claude Code, Codex, Cursor, GitHub Copilot, OpenCode.
   No per-agent hand-authoring; no shared-template changes beyond adding the new entry.
   Per the standard's proposal-time rule, the per-agent outputs are: a
   `ratchet-propose-batch` skill directory and a `propose-batch` command file rendered into
   each agent's directory by `ratchet init` when the workflow is enabled.

**Trade-offs / decisions:**
- *Opt-in vs core*: kept opt-in because it only makes sense for users who also run the
  `batch` workflow; adding it to core would surface a batch-centric skill to users on the
  streamlined profile. Revisit if `batch` ever moves to core.
- *Skill writes manifest, not change dirs*: keeps proposal cheap and the manifest editable;
  change decomposition stays lazy and is owned by `ratchet batch apply`.
- *Chain-in is gated*: the skill never auto-creates changes; it asks, so the user controls
  whether phase-one changes are spec'd now or deferred.

## Tasks

- [x] 1.1 Create `src/core/templates/workflows/propose-batch.ts` with a shared body
      constant and exports `getProposeBatchSkillTemplate()` and
      `getRctProposeBatchCommandTemplate()`, mirroring `batch.ts` / `propose.ts`.
- [x] 1.2 Encode the five-step flow in the body: explore objective → slice into
      vertical-slice phases → require success + proof-of-work per phase → scaffold manifest
      via `ratchet new batch` with a shallow DAG → gated "propose phase-one changes now?"
      prompt that optionally chains into the propose-change flow.
- [x] 1.3 In the body, state the four anti-waterfall principles as rationale and map each
      to a concrete skill behavior (reject horizontal phases; hard proof-of-work gate;
      phase-one concrete vs later-phase refinable proof; shallow-but-wide DAG).
- [x] 1.4 Keep the body agent-neutral and phrase any structured-question step as optional
      with a plain-prose fallback, per the `multi-agent-support` standard.
- [x] 2.1 Re-export `getProposeBatchSkillTemplate` and `getRctProposeBatchCommandTemplate`
      from `src/core/templates/skill-templates.ts`.
- [x] 2.2 Add the `propose-batch` `SkillTemplateEntry` (`dirName: 'ratchet-propose-batch'`,
      `workflowId: 'propose-batch'`) to `getSkillTemplates` in
      `src/core/shared/skill-generation.ts`.
- [x] 2.3 Add the `propose-batch` `CommandTemplateEntry` (`id: 'propose-batch'`) to
      `getCommandTemplates` in `src/core/shared/skill-generation.ts`, and update the import
      block accordingly.
- [x] 2.4 Add `'propose-batch'` to `ALL_WORKFLOWS` in `src/core/profiles.ts`; leave
      `CORE_WORKFLOWS` unchanged (opt-in, not core).
- [x] 3.1 Verify per-agent rendering: `ratchet init` with the workflow enabled emits a
      `ratchet-propose-batch` skill and a `propose-batch` command for every agent in the
      supported-tools registry (Claude Code, Codex, Cursor, GitHub Copilot, OpenCode).
- [x] 3.2 Update skill/command generation tests to assert the new `propose-batch` outputs
      for all registered agents (iterate the registry, not a single agent), and update any
      snapshot/count tests over `ALL_WORKFLOWS` or the template lists.
- [x] 3.3 Confirm `pnpm build` and the test suite pass, and that the rendered skill/command
      bodies read correctly in at least one agent directory.
