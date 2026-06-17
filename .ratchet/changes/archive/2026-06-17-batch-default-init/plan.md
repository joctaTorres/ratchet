# batch-default-init

## Why

The `batch` workflow (`/rct:batch`) is currently opt-in: it only installs for custom
profiles, so a stock `ratchet init` never ships it. Batch apply is a core part of the
intended workflow now, so a new user should get it without authoring a custom profile.
Promote `batch` into the default `core` profile.

## What Changes

- Add `'batch'` to `CORE_WORKFLOWS` in `src/core/profiles.ts` so `getProfileWorkflows('core')`
  resolves it and a stock `ratchet init` (default core profile) installs the batch
  workflow for every supported agent.
- Update the `CORE_WORKFLOWS` / `ALL_WORKFLOWS` docstrings in `src/core/profiles.ts` so
  `batch` is no longer described as opt-in (eval remains opt-in).
- Update tests/assertions that pin the core workflow set or the installed-skill /
  command set to include `batch`.
- `eval` stays opt-in — out of scope. (On the `batch` branch `eval` is not present in
  `ALL_WORKFLOWS` at all; nothing about eval changes here.)
- Implements: `features/default-init/batch-workflow.feature`,
  `features/default-init/eval-remains-opt-in.feature`.

## Design

The profile system is the single source of truth for *which* workflows install.
`getProfileWorkflows('core')` returns `CORE_WORKFLOWS`, and `ratchet init` renders each
resolved workflow's skill + command into every supported agent's directory via the
adapter registry. So the entire behavior change is achieved by adding `'batch'` to the
`CORE_WORKFLOWS` tuple — no new template, no init wiring, no per-agent special-casing.
`batch` is already in `ALL_WORKFLOWS`, so it is already a valid `WorkflowId` and its
template `src/core/templates/workflows/batch.ts` is already registered; this change only
moves it from "available" to "default".

Tool-agnostic surface (per the multi-agent-support standard): the change touches a
generated artifact (the batch skill/command now ships by default), so it must land for
**every** agent in the supported-tools registry (`src/core/config.ts`), not just Claude.
Because init already iterates the registry and the batch template is already shared
tool-agnostic content, adding `'batch'` to `CORE_WORKFLOWS` automatically renders it into
each agent's directory. Per-agent outputs that a stock init must now produce:

- Claude Code → `.claude/skills/ratchet-batch/SKILL.md` + `.claude/commands/rct/batch.md`
- Codex → `.codex/...` batch skill + command
- Cursor → `.cursor/...` batch skill + command
- GitHub Copilot → `.github/...` batch skill + command
- OpenCode → `.opencode/...` batch skill + command

(Exact per-agent paths follow whatever the adapter registry already produces for the
other core workflows; batch is rendered through the same path, not hand-authored.)

Trade-off / decision: only `batch` is promoted. `eval` deliberately stays opt-in to keep
this change scoped to the stated goal; promoting eval would be a separate decision.

Test impact (touch points to update at apply time): assertions that hardcode the core
set or the stock-init output will need `batch` added. Known locations:
- `test/core/profiles.test.ts`
  - `CORE_WORKFLOWS` equality assertion (currently `['propose','apply','verify','archive','propose-standard']`).
  - the `getProfileWorkflows('core')` expectations follow `CORE_WORKFLOWS` automatically.
  - the `ALL_WORKFLOWS` length / membership assertions do NOT change (batch already in
    ALL_WORKFLOWS; `eval` is not on this branch).
- `test/core/init.test.ts`
  - "should create core profile skills for Claude Code by default" — add
    `ratchet-batch` to `coreSkillNames` and remove batch from any non-core exclusion list.
  - "should create core profile commands for Claude Code by default" — add
    `rct/batch.md` to `coreCommandNames`.
- `test/core/profile-sync-drift.test.ts` iterates `CORE_WORKFLOWS`, so it picks up
  `batch` automatically; confirm no fixture pins the old set.
- Any other test or snapshot that hardcodes the core workflow names or the stock-init
  installed-skill count must be swept (`CORE_WORKFLOWS`, `propose-standard`,
  `ratchet-batch`, `rct/batch`).

## Tasks

- [x] 1.1 Add `'batch'` to the `CORE_WORKFLOWS` tuple in `src/core/profiles.ts`.
- [x] 1.2 Update the `CORE_WORKFLOWS` and `ALL_WORKFLOWS` docstrings in `src/core/profiles.ts` so `batch` is described as default and only `eval` is noted as opt-in.
- [x] 2.1 Update `test/core/profiles.test.ts` so the `CORE_WORKFLOWS` equality assertion includes `batch`.
- [x] 2.2 Update `test/core/init.test.ts` core-skill test: add `ratchet-batch` to `coreSkillNames` and remove batch from any non-core exclusion list.
- [x] 2.3 Update `test/core/init.test.ts` core-command test: add `rct/batch.md` to `coreCommandNames`.
- [x] 2.4 Sweep `test/` for any remaining hardcoded core workflow set or stock-init installed-skill/command count and add `batch` (or update counts) as needed.
- [x] 3.1 Run the full test suite and confirm the batch workflow installs for every supported agent on a stock `ratchet init` (no custom profile) and that `eval` remains absent from the default install.
