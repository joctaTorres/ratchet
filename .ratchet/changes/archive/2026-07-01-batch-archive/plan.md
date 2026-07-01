# batch-archive

## Why

Batches have no terminal lifecycle step: once every member change is done, the
batch directory sits in `.ratchet/batches/` forever, cluttering `ratchet batch
list` with finished work. Changes already archive (`src/core/archive.ts`); the
batch workflow needs the matching `archive` step to close the loop.

## What Changes

- Add `ratchet batch archive <name>` — a new batch subcommand that closes a
  batch's lifecycle. It moves the batch directory (manifest + run journal) to
  `.ratchet/batches/archive/<YYYY-MM-DD>-<name>/`.
- **Cascade**: archiving a batch first runs the existing change-archive flow for
  each member change (feature-store materialization + standard-link
  materialization + move to `changes/archive/`), in phase order, then moves the
  batch directory. Already-archived and never-created (pending) intents are
  skipped without error.
- **Done gate**: mirror change archive — report derived batch status, warn and
  require confirmation when the batch is not `done` (incomplete/blocked/parked
  changes count as incomplete); `--yes` forces non-interactively.
- Exclude the `archive/` directory from `ratchet batch list` and from single-batch
  name resolution (`listBatchNames` / `resolveBatchName` in
  `src/commands/batch/shared.ts`).
- Add an `archive-batch` guided workflow (skill + command) defined once as shared
  content and rendered for **every** agent in the supported-tools registry; point
  the `apply-batch` workflow's terminal step at it.
- Implements feature files:
  - `features/batch-archive/archive-command.feature`
  - `features/batch-archive/done-gate.feature`
  - `features/batch-archive/listing-excludes-archive.feature`
  - `features/batch-archive/workflow-surface.feature`

## Design

**A batch owns no artifacts of its own.** Status is derived live from change
state (`src/core/batch/status.ts`), and all real artifacts (features) belong to
the member *changes*. So batch archive is two concerns layered: (1) reuse the
change-archive flow per member change so the unit clears out together, and (2)
housekeeping — move the batch dir out of the active listing while preserving the
manifest + run journal for the record.

**Reuse, not reimplement.** The cascade calls the existing `ArchiveCommand`
(`src/core/archive.ts`) per member change rather than duplicating feature-store
and standard-link logic. The new batch-archive core (`src/core/batch/archive.ts`,
mirroring `moveDirectory` + date-prefix + overwrite guard) handles only the
batch-level move and the iteration. Member changes are resolved from the manifest
via `allChangeIntents` and ordered by phase; each is archived only if its change
directory exists and is not already under `changes/archive/` (idempotent skip).

**Done gate reuses derived status.** `computeBatchStatus` already yields
`status`, `doneCount`, `changeCount`, and per-change status (including `blocked`
and parked/`awaiting-approval`). The gate counts any non-`done` change as
incomplete, warns with their names, and confirms — identical UX to change
archive, including the `--yes` override.

**Trade-off (cascade ordering & partial failure).** Changes archive in phase
order for determinism; feature materialization is per-change independent, so a
mid-cascade failure leaves earlier changes archived and the batch directory in
place. This is acceptable and recoverable — re-running skips the already-archived
changes and completes. We do not wrap the cascade in a transaction.

**Multi-agent surface (required by `multi-agent-support`).** The `archive-batch`
body is authored once in `src/core/templates/workflows/archive-batch.ts`
(`getArchiveBatchSkillTemplate` + `getRctArchiveBatchCommandTemplate`), exported
from `skill-templates.ts`, and registered in both `all` arrays in
`src/core/shared/skill-generation.ts` (skill `dirName: 'ratchet-archive-batch'`,
command `id: 'archive-batch'`). It is rendered per agent through the adapter
registry (`src/core/command-generation/registry.ts`) — no hand-authored
per-agent copies. The body is agent-neutral ("your agent") and any
structured-question step carries a plain-prose fallback. The workflow's job is to
report status and invoke `ratchet batch archive <name>` — it never moves
directories by hand.

Per-agent generated outputs (one skill dir + one command per registered adapter:
claude, codex, cursor, gemini, github-copilot, opencode), following the existing
`apply-batch`/`propose-batch` layout — e.g. for claude:
`.claude/skills/ratchet-archive-batch/SKILL.md` and
`.claude/commands/rct/archive-batch.md`; for opencode:
`.opencode/skills/ratchet-archive-batch/SKILL.md` and
`.opencode/command/rct-archive-batch.md`; for gemini:
`.gemini/skills/ratchet-archive-batch/SKILL.md` and
`.gemini/commands/rct-archive-batch.md`; codex, cursor, and github-copilot emit
their adapter-specific equivalents. Each is produced by `ratchet init` for its
agent. Driving generation off the adapter registry (`CommandAdapterRegistry`)
rather than a hardcoded agent list is what keeps any future adapter — gemini was
added after this change was first drafted — covered automatically.

## Tasks

- [x] 1.1 Add `src/core/batch/archive.ts`: resolve member intents via
  `allChangeIntents`, order by phase, archive existing/non-archived changes by
  delegating to `ArchiveCommand`, skip pending and already-archived intents.
- [x] 1.2 Add the batch-level move: date-prefixed `batches/archive/<date>-<name>/`,
  reuse a `moveDirectory` helper (copy+remove fallback on EPERM/EXDEV), and guard
  against overwriting an existing archive entry.
- [x] 1.3 Implement the done gate: report derived batch status, warn + confirm on
  incomplete (non-`done`, including blocked/parked) changes, honor `--yes`.
- [x] 1.4 Surface an error for unknown batch names.
- [x] 2.1 Add `batchArchiveCommand` in `src/commands/batch/archive.ts`, export it
  from `src/commands/batch/index.ts`, and wire the `ratchet batch archive <name>`
  subcommand (with `--yes`) in the CLI.
- [x] 2.2 Exclude `archive/` from `listBatchNames` and `resolveBatchName` in
  `src/commands/batch/shared.ts`.
- [x] 3.1 Add `src/core/templates/workflows/archive-batch.ts` with a single shared
  body (`getArchiveBatchSkillTemplate` + `getRctArchiveBatchCommandTemplate`),
  agent-neutral wording, plain-prose fallback for any structured-question step.
- [x] 3.2 Export the new templates from `src/core/templates/skill-templates.ts`
  and register them in both `all` arrays in
  `src/core/shared/skill-generation.ts` (skill `ratchet-archive-batch`, command
  `archive-batch`).
- [x] 3.3 Update the `apply-batch` workflow body so its terminal step points the
  user at archiving the batch.
- [x] 4.1 Unit tests for `src/core/batch/archive.ts`: cascade order, idempotent
  skip of archived changes, skip of pending intents, batch move, overwrite guard,
  unknown-batch error.
- [x] 4.2 Tests for the done gate (done → no prompt; incomplete → warn + confirm;
  decline aborts; `--yes` forces).
- [x] 4.3 Tests that `batch list` / single-batch resolution exclude `archive/`.
- [x] 4.4 Skill/command generation tests asserting the `archive-batch` surface is
  produced for **all** registered agents (iterate the registry).
- [x] 5.1 Run `ratchet batch archive` end-to-end on a done batch and an incomplete
  batch to confirm cascade + gate behavior.
