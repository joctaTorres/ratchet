# Rename per-change `success` to a required `done`

## Why

The per-change criterion on a batch manifest change intent was just added as an
optional `success`. We want it named **`done`** (a change's definition of done)
and **required** — every change intent must state what done means for it. The
unrelated phase-level `success` criterion stays exactly as is; only the
per-change field is renamed, and no per-change `success` may remain anywhere.

## What Changes

- **BREAKING (manifest schema)**: rename `ChangeIntentSchema.success` →
  `done` and make it **required, non-empty** (drop `.optional()`) in
  `src/core/batch/manifest.ts`. A change intent without `done` now fails
  validation. The old `success` key is no longer recognized on a change intent.
  Implements `features/batch-change-done/manifest-schema.feature`.
- **Engine context**: rename `ResolvedStepContext.changeSuccess` → `changeDone`
  (required `string`) in `src/core/batch/engine/contract.ts`; populate it from
  `change.done` in `src/commands/batch/apply.ts`.
- **Agent instructions**: replace the conditional `Change success criteria:`
  line with an always-present, agent-neutral `Definition of done:` line in
  `src/core/batch/engine/instructions.ts`. Implements
  `features/batch-change-done/step-instructions.feature`.
- **Derived status**: rename `ChangeStatusInfo.success` → `done` (required) and
  pass it through unconditionally in `src/core/batch/status.ts`; rename the
  `success` key to `done` in the `ratchet batch status --json` projection
  (`toJson`) in `src/commands/batch/status.ts`. Implements
  `features/batch-change-done/status-output.feature`.
- **Authoring surface**: update the manifest template
  (`schemas/ratchet/templates/batch.yaml`) and the shared `propose-batch`
  workflow content (`src/core/templates/workflows/propose-batch.ts`) to document
  a **required** per-change `done` (no longer an optional `success`). Implements
  `features/batch-change-done/authoring-and-no-stray-success.feature`.
- **Data (required-field migration)**: add a `done` criterion to **every** change
  intent that lacks one, and rename the three existing `success` lines to `done`:
  - `.ratchet/batches/ci-npx-release/batch.yaml` — rename 3 (phase 1) + add `done`
    to the 8 change intents in phases 2–4.
  - `.ratchet/evals/fixtures/batch-apply/.ratchet/batches/q3-auth/batch.yaml` — 1 change.
  - `.ratchet/evals/fixtures/batch-states/.ratchet/batches/states/batch.yaml` — 4 changes.
- **Docs**: update `README.md` — the batch.yaml diagram (`{ name, after, done }`)
  and the manifest paragraph sentence (required `done`, not optional `success`).
- **Tests**: update the per-change tests (manifest / instructions / status /
  propose-batch) for the rename + required semantics, replacing
  "optional / valid-when-absent / omitted-when-absent" assertions with
  "required / rejected-when-missing / always-present", and assert no per-change
  `success` remains.

## Design

**Required, non-empty.** `done: z.string().min(1, { error: 'change intent done
criterion is required' })` — no `.optional()`. This is the whole behavioral
change at the parse layer; because the field is required, every existing manifest
and fixture must carry it, which is why the data migration below is part of this
change, not a follow-up.

**Phase `success` is untouched.** `PhaseSchema.success`, `phase.success`, and the
`Phase success criteria:` instruction line are a different concern and remain.
The rename touches only the per-change field and its derivations
(`changeSuccess`, `ChangeStatusInfo.success`, the `toJson` change key, the
`Change success criteria:` line). Zod's internal `result.success` boolean in the
parser is also unrelated and stays.

**Always present, so no conditionals.** Because `done` is required, the engine
context field, the status passthrough, the `toJson` key, and the instruction line
all become unconditional — simpler than the optional version they replace.

**Instruction phrasing.** The agent-facing line becomes `Definition of done:
<text>` — agent-neutral, names no specific coding agent, sits alongside the
existing phase goal / phase success lines (multi-agent-support standard).

**No stray `success`.** After the rename, a search for a per-change `success`
(the `success` key on a change intent, `changeSuccess`, `ChangeStatusInfo.success`,
`Change success criteria`) must return nothing; only the phase-level `success`
remains. A verification task enforces this.

**Multi-agent standard.** The `propose-batch` guidance and manifest template are
shared content rendered per agent — edited once, no agent-specific copies, phrased
agent-neutrally.

## Tasks

- [x] 1.1 Rename `success` → required non-empty `done` in `ChangeIntentSchema` (`src/core/batch/manifest.ts`)
- [x] 1.2 Update `manifest.test.ts`: `done` retained when present, rejected when missing, rejected when empty; old `success` key not recognized; phase `success` still valid
- [x] 2.1 Rename `changeSuccess` → required `changeDone` in `ResolvedStepContext` (`contract.ts`) and populate from `change.done` in `apply.ts`
- [x] 2.2 Replace the conditional `Change success criteria:` line with an always-present, agent-neutral `Definition of done:` line (`instructions.ts`)
- [x] 2.3 Update `instructions.test.ts`: `Definition of done` always present + agent-neutral; no `Change success criteria` line
- [x] 3.1 Rename `ChangeStatusInfo.success` → required `done` + unconditional passthrough (`src/core/batch/status.ts`); rename the `success` key → `done` in `toJson` (`src/commands/batch/status.ts`)
- [x] 3.2 Update `status.test.ts`: `batch status --json` always carries `done`, never a per-change `success`
- [x] 4.1 Update the manifest template (`schemas/ratchet/templates/batch.yaml`) to show a required per-change `done`, no `success`
- [x] 4.2 Update the `propose-batch` guidance (`src/core/templates/workflows/propose-batch.ts`) to a required `done`; update `propose-batch.test.ts`
- [x] 5.1 Migrate `.ratchet/batches/ci-npx-release/batch.yaml`: rename 3 `success`→`done`, add `done` to the 8 change intents in phases 2–4
- [x] 5.2 Migrate fixtures `q3-auth` (1) and `batch-states` (4) change intents to carry `done`
- [x] 6.1 Update `README.md` batch.yaml diagram + manifest paragraph (required `done`)
- [x] 6.2 Verify no per-change `success` remains (grep `changeSuccess`, `Change success criteria`, change-intent `success:`); confirm only phase `success` is left
- [x] 6.3 Run `pnpm build`, `pnpm lint`, `pnpm test`; full suite green
