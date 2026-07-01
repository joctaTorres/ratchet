# `ratchet apply <change>` + `ratchet verify <change>` — finish the headless loop

## Why

`propose-command` shipped the first headless verb on the change-scoped engine
core: `ratchet propose "<objective>"` derives a change name, resolves settings
standalone, and runs exactly one agent via `runChangeStep` for a **forced**
`propose` transition — no batch manifest, run state change-local under
`.ratchet/changes/<change>/.run/`.

Two thirds of the loop are still missing. A user can propose a change but has no
first-class verb to *implement* it or *check* it without driving a batch. This
change ships the remaining two verbs — `ratchet apply <change>` and
`ratchet verify <change>` — each a near-mirror of `propose`: one agent, one
forced transition (`apply` and `verify` respectively), standalone settings,
repeatable `-m` guidance, change-local resume. Together with `propose` this
completes the headless `propose → apply → verify` loop on a single change with
no batch manifest in sight.

The one new wrinkle over `propose` is preconditions: you should not apply a
change that was never proposed (no `plan.md`), and you should not verify a
change whose tasks are not all done. Both verbs enforce that, with a `--force`
escape hatch.

## What Changes

- **New `ratchet apply <change>` command** (`src/commands/apply.ts`, exported and
  wired in `src/cli/index.ts` alongside `propose`). Signature:
  `apply <change>` with `--force`, repeatable `-m, --message <guidance>`, and the
  standalone settings flags `--agent`, `--locus`, `--image` plus `--json`. It
  mirrors `proposeCommand`: validate the change/precondition, resolve settings,
  build a forced-`apply` `ChangeStepContext` (no `batch`), call
  `engine.runChangeStep` once, render the result.

- **New `ratchet verify <change>` command** (`src/commands/verify.ts`, exported
  and wired in `src/cli/index.ts`). Same shape as `apply` but forces the
  `verify` transition and enforces the tasks-all-done precondition.

- **Apply precondition**: read on-disk state via `readChangeDiskState`
  (`src/core/batch/engine/transition.ts`). The change must exist; if not, fail
  fast with an actionable error and **no spawn**. If it exists but `hasPlan` is
  false, fail asking the user to `ratchet propose` first (or pass `--force`).
  `--force` bypasses the missing-plan check only.

- **Verify precondition**: the change must exist (else fail, no spawn). If
  `applied` is false (a plan exists but not every `## Tasks` checkbox is checked),
  fail asking the user to finish `ratchet apply` first (or pass `--force`).
  `--force` bypasses the unfinished-tasks check only.

- **Forced transitions, never re-derived**: both commands set
  `transition: 'apply'` / `transition: 'verify'` on the `ChangeStepContext` and
  call `engine.runChangeStep` directly (the same path `propose` uses).
  `computeNextTransition` is NOT consulted — the verb name IS the transition.

- **Standalone settings + change-local state**: like `propose`, each command
  resolves settings via `resolveChangeStepSettings(projectRoot, { agent, locus,
  image })`, reads the change-local journal via the same tolerant reader
  `propose` uses, builds a context with `batch` **undefined** and the joined
  `-m` guidance, and lets `runChangeStep` persist the outcome change-locally.

- **Shared helpers reused, not duplicated**: the `-m` guidance join and the
  result renderer are nearly identical across the three verbs; factor the common
  bits (e.g. a small `joinGuidance` / render helper) so `apply` and `verify`
  reuse rather than copy `propose`'s logic where practical.

- **Batch apply is untouched**: `ratchet batch apply` still calls
  `engine.runStep` with a manifest-resolved batch context and still derives its
  own transition via `computeNextTransition`. Nothing in this change alters that
  path.

Implements `features/apply/apply-command.feature`,
`features/verify/verify-command.feature`, and
`features/loop/headless-loop.feature`.

## Tasks

- [x] Add a change-precondition helper (or inline checks) over
      `readChangeDiskState`: a shared "change must exist" guard, an apply
      "has plan" guard, and a verify "tasks all done" (`applied`) guard, each
      raising an actionable error and bypassable by `--force` (apply: plan;
      verify: tasks). No spawn occurs when a precondition fails.
- [x] Create `src/commands/apply.ts`: parse `<change>` + `--force` + repeatable
      `-m` + `--agent/--locus/--image/--json`; enforce the exists + has-plan
      preconditions (unless `--force`); resolve settings via
      `resolveChangeStepSettings`; build a forced-`apply` `ChangeStepContext`
      (no `batch`, change-local journal, joined guidance); call
      `engine.runChangeStep`; render (text + `--json`). Reuse `propose`'s
      guidance/render helpers rather than copying them.
- [x] Create `src/commands/verify.ts`: same as `apply` but force the `verify`
      transition and enforce the exists + tasks-all-done (`applied`)
      precondition (unless `--force`).
- [x] Wire `program.command('apply <change>')` and
      `program.command('verify <change>')` in `src/cli/index.ts` to the new
      commands, with the options above and the standard error/`process.exit`
      wrapper used by `propose` and the other verbs.
- [x] Write `test/cli/apply.test.ts` with an injected agent runtime:
      (a) apply forces the `apply` transition and spawns one agent;
      (b) no plan → fails with no spawn; (c) `--force` bypasses the missing-plan
      check and spawns; (d) a non-existent change fails with no spawn;
      (e) `-m` guidance appears in the built instructions; (f) settings resolve
      flag → config → default; (g) the journal is read from and the outcome
      written under `.ratchet/changes/<change>/.run/` with nothing under
      `.ratchet/batches/`.
- [x] Write `test/cli/verify.test.ts` mirroring `apply.test.ts` but for the
      `verify` transition and the tasks-all-done precondition: all-done → spawns;
      unfinished tasks → fails with no spawn; `--force` bypasses and spawns;
      missing change → fails with no spawn; `-m` guidance, standalone settings,
      and change-local state all assert as in apply.
- [x] Run `pnpm vitest run` and confirm exit 0 — apply/verify each drive their
      forced transition via `runChangeStep` with standalone settings and
      appended `-m` guidance, enforce their preconditions with a `--force`
      escape hatch, resume from change-local run state, AND the existing
      propose + batch-apply suites still pass (batch apply untouched).
- [x] **Documentation (mandatory — `documentation` standard, "Reference
      documentation").** Create `docs/commands/apply.md` and
      `docs/commands/verify.md` (the `ratchet apply` / `ratchet verify` commands:
      synopsis, every flag — `--force`, repeatable `-m`, `--agent`, `--locus`,
      `--image`, `--json` — the exists + has-plan / exists + tasks-all-done
      preconditions with the `--force` escape hatch, and change-local run state)
      and update `README.md`: add the `apply <change>` and `verify <change>` rows
      to the Commands table and the corresponding bullets in the "Headless
      workflow verbs" subsection.
