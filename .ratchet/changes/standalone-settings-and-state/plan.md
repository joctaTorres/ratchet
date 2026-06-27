# Standalone settings resolution + change-local run state for runChangeStep

## Why

The previous change (`change-step-core`) extracted `runChangeStep(ctx)`, but it
is still tethered to a batch in two places:

- **Run-state locus**: `runChangeStep` reads/appends the journal and resume
  (parked) state under `.ratchet/batches/<batch>/run/` via
  `ctx.batch` — `readChangeJournalTolerant(projectRoot, batch, change)`,
  `appendJournal(projectRoot, batch, …)`, and `RATCHET_BATCH_NAME`. The contract
  even documents `batch` as "retained ONLY as the run-state locus".
- **Settings**: `ctx.settings` is fully resolved by the *batch* CLI
  (`resolveBatchSettings(projectRoot, manifest)`); there is no path that resolves
  settings for a change with **no manifest**.

The `propose-headless` phase needs `runChangeStep` to advance a single change
with **no batch manifest present**. This change removes both tethers as a thin
vertical slice: relocate the run-state locus to `.ratchet/changes/<change>/.run/`
when no batch is given, and add a settings resolver that cascades
`flag → project config → default` (no manifest). The headless `ratchet propose`
verb that *calls* this path is the next change (`propose-command`) — here we only
prove the core works batch-free, with batch apply provably unchanged.

## What Changes

- **`ChangeStepContext.batch` becomes optional** (in the engine contract). When
  `batch` is set, run state lives under `.ratchet/batches/<batch>/run/` exactly
  as today (batch apply path). When `batch` is absent, run state lives under
  `.ratchet/changes/<change>/.run/` (the standalone path). The field's doc
  comment is updated to describe this batch-or-change run-state locus.

- **Change-local run-state functions** (in `core/batch/journal.ts` and the
  engine's `run-state.ts`): introduce a change-scoped locus for the journal and
  parked state — `.ratchet/changes/<change>/.run/journal.jsonl` and
  `state.json`. Factor the existing batch path and the new change-local path
  behind a small locus helper so `appendJournal`, `readChangeJournalTolerant`,
  and the parked-state read used by the engine target the right directory. Batch
  callers keep their current `(projectRoot, batch, …)` signatures and behaviour.

- **`runChangeStep` uses the resolved locus**: when `ctx.batch` is undefined it
  reads/appends the journal and reads resume state change-locally, and does NOT
  set `RATCHET_BATCH_NAME` (the runtime then places its temp prompt under the
  change-local `.run/`). The forced-transition spawn, journal-delta snapshot,
  `ensureChangeMetadata` propose stamp, and outcome mapping are otherwise
  unchanged.

- **Standalone settings resolver** (in `core/batch/config.ts`):
  `resolveChangeStepSettings(projectRoot, overrides)` returns `BatchSettings`
  by cascading explicit `agent` / `locus` / `image` overrides over
  `resolveBatchSettings(projectRoot)` (project config ← default, **no
  manifest**). Each override flag is validated through the existing
  `validateSetting` so an invalid value fails with an actionable message before
  any agent is spawned. `local`/`docker`/`remote` selection in `selectRuntime`
  is untouched — it already keys off `settings.locus`/`image`.

- **Batch apply is untouched** in behaviour: it still passes `batch` through, so
  `runStepLocked` → `runChangeStep` resolves the batch-scoped locus and the
  existing batch-apply suites still pass.

Implements `features/standalone/change-local-run-state.feature` and
`features/standalone/settings-resolution.feature`.

## Tasks

- [x] Make `ChangeStepContext.batch` optional in
      `src/core/batch/engine/contract.ts` and update its doc comment to describe
      the batch-or-change run-state locus; keep `ResolvedStepContext.batch`
      required (batch apply still passes it).
- [x] Add change-local run-state support: a `.ratchet/changes/<change>/.run/`
      locus for the journal (`appendJournal` / `readChangeJournalTolerant`) and
      parked state, factored behind a locus helper so the existing batch paths
      keep their signatures and behaviour. Cover the path selection with a unit
      test.
- [x] Add `resolveChangeStepSettings(projectRoot, { agent?, locus?, image? })`
      to `src/core/batch/config.ts`: cascade flag → project config → default
      (no manifest), validating each override via `validateSetting` and surfacing
      an actionable error on an invalid value. Export it from the engine index if
      consumed there.
- [x] Point `runChangeStep` at the resolved locus: when `ctx.batch` is undefined,
      read/append the journal and read resume state change-locally and omit
      `RATCHET_BATCH_NAME`; when `ctx.batch` is set, behave exactly as today.
- [x] Extend `test/core/batch/engine/change-step.test.ts`: with an injected
      runtime and **no batch**, `runChangeStep` (a) spawns exactly one agent for
      the forced transition, (b) appends the outcome entry under
      `.ratchet/changes/<change>/.run/journal.jsonl` and writes nothing under
      `.ratchet/batches/`, (c) reconstructs prior change-local entries on resume,
      (d) honours a change-local park (blocked, no answer) without spawning, and
      (e) folds a recorded change-local answer into the instructions on resume.
- [x] Add `test/core/batch/engine/change-step.test.ts` (or a sibling) coverage
      for `resolveChangeStepSettings`: defaults with no config, project-config
      override, flag-wins-over-config/default, and an invalid flag rejected with
      no spawn — and that the resolved locus/image flow into `selectRuntime`.
- [x] Run `pnpm vitest run test/core/batch/engine/change-step.test.ts` plus the
      existing batch-engine apply suites
      (`test/batch-engine/engine.test.ts`,
      `test/cli-e2e/batch-bundled-engine.test.ts`); confirm all pass — batch
      apply still writes run state under `.ratchet/batches/<batch>/run/` and its
      behaviour is unchanged.
- [x] **Documentation (mandatory — `documentation` standard, "Reference
      documentation").** Create the Reference entries
      `docs/engine/standalone-settings.md` (the `resolveChangeStepSettings`
      resolver — `flag → project config → default`, overridable keys, validation)
      and `docs/engine/run-state.md` (the `RunLocus` batch-or-change run-state
      locus and the locus-aware journal functions). Public-API-only change — no
      command/flag yet calls these — so `README.md` needs no edit here; the
      `.ratchet/changes/<change>/.run/` run state and standalone settings are
      surfaced in `README.md` by the headless verbs that consume them
      (`propose-command`, `apply-verify-verbs`).
