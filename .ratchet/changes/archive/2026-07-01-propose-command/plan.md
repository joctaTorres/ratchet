# `ratchet propose "<objective>"` — a headless propose verb on runChangeStep

## Why

The previous two changes built the foundation but exposed no user-facing verb:

- `change-step-core` extracted `runChangeStep(ctx)` — one agent, one forced
  transition, no batch lock, no transition derivation.
- `standalone-settings-and-state` made that core batch-free: optional
  `ctx.batch`, change-local run state under `.ratchet/changes/<change>/.run/`,
  and `resolveChangeStepSettings(projectRoot, overrides)` (flag → project config
  → default, no manifest).

Nothing *calls* that standalone path yet. This change ships the first verb that
does: `ratchet propose "<objective>"`. It is the thin vertical slice that proves
the whole stack end-to-end — derive a change name from free text (or honour
`--name`), refuse to clobber an existing change, resolve settings standalone,
append optional `-m` guidance, and run exactly one agent via `runChangeStep` for
a **forced** propose transition, writing run state change-locally. Apply and
verify verbs are the *next* phase (`apply-verify-loop`); here we deliver propose
only.

## What Changes

- **New `ratchet propose` command** (`src/commands/propose.ts`, exported and
  wired in `src/cli/index.ts` alongside the `batch` group). Signature:
  `propose <objective>` with options `--name <change>`, `-m, --message
  <guidance>` (repeatable/accumulated into one block), and the standalone
  settings flags `--agent`, `--locus`, `--image` plus `--json`. It mirrors the
  shape of `batchApplyCommand`: build a context, call the engine once, persist
  the outcome, render a result.

- **Change-name derivation** (small helper, e.g. `deriveChangeName(objective)`
  reusing the existing kebab-case slug logic in `src/core/eval/case-id.ts`, or a
  shared `slugify`). `--name` short-circuits derivation. A blank/unsluggable
  objective with no `--name` fails fast with an actionable error and **no spawn**.

- **Refuse-if-exists guard**: if `.ratchet/changes/<change>/` already exists,
  fail before constructing any context or spawning — propose creates, it does
  not resume an existing change (that is `apply`/`verify` territory).

- **`-m` guidance plumbed into instructions**: add an optional `guidance?:
  string` field to `ChangeStepContext` (engine contract) and append it in
  `buildAgentInstructions` as an extra "Additional guidance:" block for the
  forced transition. The propose command joins one-or-more `-m` values into that
  field. `batchApplyCommand` leaves `guidance` undefined, so batch behaviour and
  existing instructions output are unchanged.

- **Standalone wiring**: the command resolves settings via
  `resolveChangeStepSettings(projectRoot, { agent, locus, image })`, builds a
  `ChangeStepContext` with `batch` **undefined**, `transition: 'propose'`
  (forced), the derived/overridden `change`, a `changeDone` summarising the
  objective, a synthetic single-change `phase` context, the change-local
  `journal`, and the new `guidance`. It calls `engine.runChangeStep(context)`,
  persists the parked/cleared outcome change-locally, and renders.

- **Batch apply is untouched**: it still calls `engine.runStep` with a
  manifest-resolved batch context; nothing in this change alters that path.

Implements `features/propose/propose-command.feature` and
`features/propose/forced-propose-spawn.feature`.

## Tasks

- [x] Add an optional `guidance?: string` to `ChangeStepContext` in
      `src/core/batch/engine/contract.ts`, and append it in
      `buildAgentInstructions` (`src/core/batch/engine/instructions.ts`) as an
      "Additional guidance:" block when present; `batchApplyCommand` leaves it
      undefined so existing instructions are byte-identical.
- [x] Add a change-name derivation helper that kebab-case-slugs the objective
      (reuse the existing slug logic; share or factor a `slugify`), returning a
      validated change name; a blank/unsluggable objective yields no name.
- [x] Create `src/commands/propose.ts`: parse objective + `--name` + `-m`
      guidance + `--agent/--locus/--image/--json`; derive or override the change
      name; refuse with an actionable error if `.ratchet/changes/<change>/`
      already exists (no spawn); resolve settings via
      `resolveChangeStepSettings`; build a forced-propose `ChangeStepContext`
      (no `batch`, change-local journal, `guidance`); call
      `engine.runChangeStep`; persist the outcome change-locally; render
      (text + `--json`).
- [x] Wire `program.command('propose <objective>')` in `src/cli/index.ts` to the
      new command, with the options above and the standard error/`process.exit`
      wrapper used by the other verbs.
- [x] Write `test/cli/propose.test.ts` with an injected agent runtime: (a) the
      change name is derived from the objective and one agent is spawned for the
      forced propose transition; (b) `--name` overrides the derived slug;
      (c) proposing an existing change refuses with no spawn; (d) a blank
      objective with no `--name` fails with no spawn; (e) `-m` guidance appears
      in the built instructions; (f) settings resolve flag → config → default
      and feed `selectRuntime`; (g) the journal outcome is written under
      `.ratchet/changes/<change>/.run/` and nothing under `.ratchet/batches/`.
- [x] Run `pnpm vitest run test/core/batch/engine/change-step.test.ts
      test/cli/propose.test.ts` and confirm exit 0 — propose drives a forced
      propose via `runChangeStep` with appended `-m` guidance and standalone
      settings, derives/overrides the name, refuses on conflict, AND the
      existing batch-apply delegation through `runChangeStep` still passes.
- [x] **Documentation (mandatory — `documentation` standard, "Reference
      documentation").** Create `docs/commands/propose.md` (the `ratchet propose`
      command: synopsis, every flag — `--name`, repeatable `-m`, `--agent`,
      `--locus`, `--image`, `--json` — name derivation, refuse-if-exists guard,
      standalone settings, and change-local run state) and update `README.md`:
      add the `propose "<objective>"` row to the Commands table and the
      "Headless workflow verbs" subsection covering `propose`/`apply`/`verify`,
      their flags, and the `.ratchet/changes/<change>/.run/` run state.
