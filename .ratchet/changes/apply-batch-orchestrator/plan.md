# apply-batch-orchestrator

## Why

The current `/rct:batch` skill is a single-step action: it advances exactly one
transition and stops, requiring the user to re-invoke it for every step. The user
wants the batch skill to be a continuous, autonomous orchestrator that drives a
batch to completion on their behalf, acting as the interface between the ratchet
CLI and the user. This change renames the skill to `/rct:apply-batch` and inverts
its behavior from "single-step, never loop" into an orchestrator loop, while leaving
the engine and `ratchet batch apply` unchanged (still one transition per call).

## What Changes

- **BREAKING (user-facing name)**: The `/rct:batch` skill/command is renamed to
  `/rct:apply-batch`. Skill dir `ratchet-batch` -> `ratchet-apply-batch`; command
  `RCT: Batch` -> `RCT: Apply Batch`.
- The skill body is rewritten from a single-step action into a **continuous batch
  orchestrator loop** (implements `features/apply-batch-orchestrator/orchestrator-loop.feature`).
- The orchestrator surfaces halts/approvals to the user, records answers, resumes,
  and stops on hard failures (`halts-and-failures.feature`).
- A hard role boundary is stated: the orchestrator only runs `ratchet` CLI commands
  and talks to the user; it never writes code or hand-edits `.ratchet` artifacts
  (`role-boundary.feature`).
- The internal workflow id `'batch'` is renamed to `'apply-batch'` across registration
  maps and profiles (see Design for the migration note).
- **UNCHANGED**: the `ratchet batch ...` CLI subcommand namespace, the engine, and
  `ratchet batch apply` single-step semantics. The `propose-batch` skill's behavior
  is untouched.

References: all four feature files under
`.ratchet/changes/apply-batch-orchestrator/features/apply-batch-orchestrator/`.

## Design

### Skill-loops-but-CLI-stays-single-step (the critical distinction)

`ratchet batch apply <name>` remains **single-step**: the bundled engine runs exactly
ONE transition (propose -> apply -> verify for one DAG step) per invocation. This is
unchanged. The **loop lives in the orchestrator skill**, which calls
`ratchet batch apply` repeatedly until `ratchet batch status --json` shows the batch
done. The old skill body's guardrail "One step per invocation; never loop" was a
*skill-level* instruction; this change supersedes that guardrail **at the skill level
only**. The CLI/engine contract is not touched. The plan and skill body both state
this explicitly so a future reader does not "fix" the engine to loop.

### Orchestrator loop algorithm (new skill body)

1. **Select the batch**: use the name arg; else infer from context; else if a single
   batch exists use it; else run `ratchet batch list --json` and ask the user.
2. **Loop** until `ratchet batch status <name> --json` reports the batch done:
   - Read status JSON: phases, change statuses, `after` edges, `next`, parked state.
   - Run `ratchet batch apply <name>` (advances ONE transition via the bundled engine).
   - Interpret outcome:
     - **advanced** -> translate the JSON into a brief human progress update; continue.
     - **blocked / awaiting-approval (halt)** -> STOP looping; surface to the USER
       exactly what input/decision is required; collect the answer/approval; record it
       via `ratchet batch report <name> --change <change> --answer "..."` (or the
       approval path); then resume the loop.
     - **failed / proof-of-work hard-gate failure** -> STOP; surface the failure
       clearly; do not paper over it or retry blindly.
   - Respect phase gates / proof-of-work: the engine gates; the orchestrator surfaces
     gate results.
3. **Stop conditions**: batch complete (summarize + celebrate), a halt needing the
   user, or a hard failure.

The orchestrator is autonomous between halts (it does not ask permission each step)
but always surfaces halts and failures.

### Role boundary

The orchestrating session acts as the SWE batch orchestrator and does NO coding work
directly. Its only actions are `ratchet` CLI commands (status/apply/report/list/view/
config) and communicating with the user. It never writes/edits code and never
hand-edits `.ratchet` artifacts; the actual coding happens inside `ratchet batch apply`,
which spawns the coding agent via the engine. The orchestrator is a driver/interface,
full stop.

### Multi-agent (tool-agnostic) requirement

Per the `multi-agent-support` standard, the skill body is defined once as shared
tool-agnostic content in `src/core/templates/workflows/apply-batch.ts` and rendered
per agent via the adapter registry. The body refers to "the coding agent" / "your
agent", never a single named agent. `ratchet init` (core profile) must emit the
renamed skill + command for **every** registered agent. Per-agent outputs:

| Agent (config.ts) | Skill dir output | Command output |
| --- | --- | --- |
| claude | `.claude/skills/ratchet-apply-batch/SKILL.md` | `RCT: Apply Batch` command |
| codex | `.codex/.../ratchet-apply-batch` | `RCT: Apply Batch` command |
| cursor | `.cursor/.../ratchet-apply-batch` | `RCT: Apply Batch` command |
| github-copilot | `.github/.../ratchet-apply-batch` | `RCT: Apply Batch` command |
| opencode | `.opencode/.../ratchet-apply-batch` | `RCT: Apply Batch` command |

Tests for skill/command generation must assert/iterate the registry, not one agent.

### Rename mapping table (every touch point — grepped, with file:line)

| # | File:line | Current | New |
| --- | --- | --- | --- |
| 1 | `src/core/templates/workflows/batch.ts` (whole file) | file `batch.ts`; doc comment `/rct:batch ... single-step ... No internal loop` | rename file to `apply-batch.ts`; rewrite doc comment to describe the orchestrator loop |
| 2 | `src/core/templates/workflows/batch.ts:10` | `const BATCH_BODY = "Advance ... by exactly one step ... never loop"` | rewrite to the orchestrator loop body (rename const, e.g. `APPLY_BATCH_BODY`) |
| 3 | `src/core/templates/workflows/batch.ts:53,55-61` | `getBatchSkillTemplate()` returning name `'ratchet-batch'`, single-step description | `getApplyBatchSkillTemplate()` returning name `'ratchet-apply-batch'`, orchestrator description |
| 4 | `src/core/templates/workflows/batch.ts:65,67-71` | `getRctBatchCommandTemplate()` -> name `'RCT: Batch'`, desc "Advance ... by one step", tags `['workflow','batch','experimental']` | `getRctApplyBatchCommandTemplate()` -> `'RCT: Apply Batch'`, orchestrator desc, tags updated (`'apply-batch'`) |
| 5 | `src/core/templates/skill-templates.ts:15` | `export { getBatchSkillTemplate, getRctBatchCommandTemplate } from './workflows/batch.js'` | export renamed fns from `./workflows/apply-batch.js` |
| 6 | `src/core/shared/skill-generation.ts:13,21` | imports `getBatchSkillTemplate`, `getRctBatchCommandTemplate` | import renamed fns |
| 7 | `src/core/shared/skill-generation.ts:59` | `{ template: getBatchSkillTemplate(), dirName: 'ratchet-batch', workflowId: 'batch' }` | `{ template: getApplyBatchSkillTemplate(), dirName: 'ratchet-apply-batch', workflowId: 'apply-batch' }` |
| 8 | `src/core/shared/skill-generation.ts:83` | `{ template: getRctBatchCommandTemplate(), id: 'batch' }` | `{ template: getRctApplyBatchCommandTemplate(), id: 'apply-batch' }` |
| 9 | `src/core/shared/tool-detection.ts:20` | `SKILL_NAMES` includes `'ratchet-batch'` | `'ratchet-apply-batch'` |
| 10 | `src/core/shared/tool-detection.ts:37` | `COMMAND_IDS` includes `'batch'` | `'apply-batch'` |
| 11 | `src/core/profile-sync-drift.ts:20` | `WORKFLOW_TO_SKILL_DIR`: `'batch': 'ratchet-batch'` | `'apply-batch': 'ratchet-apply-batch'` |
| 12 | `src/core/profiles.ts:19` | `CORE_WORKFLOWS` includes `'batch'` | `'apply-batch'` |
| 13 | `src/core/profiles.ts:29` | `ALL_WORKFLOWS` includes `'batch'` | `'apply-batch'` |
| 14 | `src/core/profiles.ts:14-17,26-27` | doc comments naming `'batch'` workflow as "single-step batch apply" | update wording to orchestrator + new id |

Verified NON-touch points (must NOT change):
- `src/cli/index.ts:375` `.command('batch')` — the `ratchet batch` CLI subcommand. KEEP.
- All `test/cli-e2e/batch*.ts` uses of `['batch', ...]`, `['new','batch',...]`,
  `['template','batch']` — these are CLI subcommand args. KEEP.
- `src/core/batch/engine/engine.ts:120` `name = 'ratchet-batch-engine'` — engine id. KEEP.
- `src/core/init.ts:64` `WORKFLOW_TO_SKILL_DIR` — this local map only lists 5 change
  workflows (no batch); not involved. KEEP.
- `src/core/project-config.ts:195` `'batch'` config field — unrelated. KEEP.
- `src/core/templates/workflows/propose-batch.ts:22,139` `ratchet batch apply` — CLI
  command reference, correct as-is. KEEP (no `/rct:batch` slash reference exists there).

### Tests that assert the old name / old single-step body (must update)

| File:line | Current assertion | Update |
| --- | --- | --- |
| `test/core/shared/tool-detection.test.ts:37` | `expect(SKILL_NAMES).toContain('ratchet-batch')` | `'ratchet-apply-batch'` |
| `test/core/shared/tool-detection.test.ts:31` | `SKILL_NAMES` length 8 | keep length 8 (rename, not add) |
| `test/core/shared/skill-generation.test.ts:33` | `dirNames` contains `'ratchet-batch'` | `'ratchet-apply-batch'` |
| `test/core/shared/skill-generation.test.ts:159` | command `ids` contains `'batch'` | `'apply-batch'` |
| `test/core/profiles.test.ts:12` | `CORE_WORKFLOWS` equals `[...,'batch','propose-batch']` | replace `'batch'` with `'apply-batch'` |
| `test/core/profiles.test.ts:22` | `CORE_WORKFLOWS` contains `'batch'` | `'apply-batch'` |
| `test/core/profiles.test.ts:37` | `ALL_WORKFLOWS` expected array with `'batch'` | replace with `'apply-batch'` |
| `test/core/init.test.ts:119` | `coreSkillNames` includes `'ratchet-batch'` | `'ratchet-apply-batch'` |

No dedicated `test/core/templates/workflows/batch.test.ts` exists (only
`propose-batch.test.ts` and `propose-standard.test.ts`), so there is no batch-template
unit test asserting the old body text; the body assertions live indirectly via the
generation tests above. `test/core/profile-sync-drift.test.ts` iterates
`CORE_WORKFLOWS`/`WORKFLOW_TO_SKILL_DIR` generically and needs no literal edit but must
stay green after the id rename.

### Workflow-id rename decision (recommendation)

**Recommendation: rename the internal workflow id `'batch'` -> `'apply-batch'`** for
consistency with the skill/command/slash name, rather than keeping a divergent internal
id. Rationale: every map (`skill-generation`, `WORKFLOW_TO_SKILL_DIR`, `SKILL_NAMES`,
`COMMAND_IDS`, `CORE_WORKFLOWS`/`ALL_WORKFLOWS`) keys off this id; keeping `'batch'`
internally while exposing `apply-batch` externally creates a lasting mismatch that
future maintainers will trip on.

**Migration implication / note**: `'batch'` is in the default `CORE_WORKFLOWS`, so
`profile: core` users are unaffected (they always resolve to the current `CORE_WORKFLOWS`
list — see `getProfileWorkflows`). Only `profile: custom` users who explicitly list
`'batch'` in their custom workflow allowlist would have a stale id after the rename. To
avoid silently dropping their batch skill, add a lightweight alias/migration: when
resolving custom workflows (and in `migration.ts`/`update.ts` detection), treat a
configured `'batch'` as `'apply-batch'`. This is a small, documented compatibility shim;
the alternative (no shim) would require those users to hand-edit their config. (If the
team prefers minimal churn, the fallback is to keep internal id `'batch'` and rename only
the user-facing strings — but that is not recommended for the reason above.)

## Tasks

- [x] 1.1 Rename `src/core/templates/workflows/batch.ts` to `apply-batch.ts`; rewrite the doc comment to describe the orchestrator loop (not single-step)
- [x] 1.2 Rewrite the skill body (rename `BATCH_BODY` -> `APPLY_BATCH_BODY`) to the orchestrator loop: select batch, loop on `ratchet batch apply` until status-done, interpret advanced/halt/failure, record answers/approvals, stop conditions — agent-neutral prose
- [x] 1.3 In the body, explicitly state the skill-loops-but-`ratchet batch apply`-stays-single-step distinction and the hard role boundary (no coding, no hand-editing artifacts, only ratchet CLI + user communication)
- [x] 1.4 Rename `getBatchSkillTemplate` -> `getApplyBatchSkillTemplate` (name `'ratchet-apply-batch'`, orchestrator description); rename `getRctBatchCommandTemplate` -> `getRctApplyBatchCommandTemplate` (`'RCT: Apply Batch'`, orchestrator desc, tags `apply-batch`)
- [x] 2.1 Update `src/core/templates/skill-templates.ts:15` export to renamed fns + `./workflows/apply-batch.js`
- [x] 2.2 Update `src/core/shared/skill-generation.ts` imports (lines 13,21) and entries (lines 59,83): `dirName: 'ratchet-apply-batch'`, `workflowId: 'apply-batch'`, `id: 'apply-batch'`
- [x] 2.3 Update `src/core/shared/tool-detection.ts`: `SKILL_NAMES` `'ratchet-batch'` -> `'ratchet-apply-batch'` (line 20); `COMMAND_IDS` `'batch'` -> `'apply-batch'` (line 37)
- [x] 2.4 Update `src/core/profile-sync-drift.ts:20` `WORKFLOW_TO_SKILL_DIR`: `'apply-batch': 'ratchet-apply-batch'`
- [x] 2.5 Update `src/core/profiles.ts`: `CORE_WORKFLOWS` and `ALL_WORKFLOWS` `'batch'` -> `'apply-batch'` (lines 19,29) and the doc comments (lines 14-17,26-27)
- [x] 3.1 Add the `'batch'` -> `'apply-batch'` custom-profile alias/migration shim (custom workflow resolution + `migration.ts`/`update.ts` detection) so existing `profile: custom` allowlists are not silently dropped
- [x] 4.1 Update `test/core/shared/tool-detection.test.ts:37` to `'ratchet-apply-batch'` (keep length 8)
- [x] 4.2 Update `test/core/shared/skill-generation.test.ts` dirNames (line 33) and command ids (line 159) to the new names
- [x] 4.3 Update `test/core/profiles.test.ts` (lines 12,22,37) `'batch'` -> `'apply-batch'`
- [x] 4.4 Update `test/core/init.test.ts:119` `coreSkillNames` to `'ratchet-apply-batch'`
- [x] 4.5 Confirm `test/core/profile-sync-drift.test.ts` still passes (iterates generically) and add a regression test for the `'batch'` -> `'apply-batch'` alias
- [x] 5.1 Verify propose-batch and any docs: no `/rct:batch` slash cross-reference exists (grep confirmed); leave `ratchet batch apply` CLI references intact
- [x] 6.1 Run `pnpm build` and the full test suite; ensure green
