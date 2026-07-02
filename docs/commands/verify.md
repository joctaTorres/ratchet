---
title: ratchet verify
sidebar_position: 3
---

# `ratchet verify`

Verify a single existing change headlessly. `verify` runs exactly one agent for a
**forced** `verify` transition through the change-scoped engine core
(`runChangeStep`), with no batch manifest in sight. Run state is kept
change-locally under `.ratchet/changes/<change>/.run/`. It completes the headless
`propose → apply → verify` loop on a single change.

## Synopsis

```bash
ratchet verify <change> [options]
```

`<change>` is required: the name of an existing change under
`.ratchet/changes/<change>/`.

## Options

| Option | Argument | Description |
|---|---|---|
| `--force` | | Bypass the unfinished-tasks precondition. The change-exists check still holds. |
| `-m, --message` | `<guidance>` | Extra guidance for the agent. Repeatable; joined into one "Additional guidance:" block. |
| `--agent` | `<agent>` | Override the coding agent for this step. |
| `--locus` | `<locus>` | Where the agent runs: `local`, `docker`, or `remote`. |
| `--image` | `<image>` | Container image for `--locus docker`. |
| `--json` | | Output the structured step result as JSON. |

## Preconditions

Read from on-disk change state before any settings resolution or spawn:

- **The change must exist.** A non-existent change
  (`.ratchet/changes/<change>/` absent) fails with an actionable error and **no
  spawn**. This check is never bypassed by `--force`.
- **Every `## Tasks` checkbox must be checked** (`applied`). A change with
  unfinished tasks fails — naming the `<done>/<total>` task count — asking the
  user to finish `ratchet apply` first, with **no spawn**. `--force` bypasses
  this check only.

## Behavior

1. Enforce the preconditions above.
2. Resolve settings standalone (`flag → project config → default`) via
   `resolveChangeStepSettings`. An invalid `--agent`/`--locus`/`--image` fails
   before any agent is spawned.
3. Build a `ChangeStepContext` with `batch` undefined, `transition: 'verify'`,
   the joined `-m` guidance, and the change-local journal, then run once via
   `engine.runChangeStep`. `computeNextTransition` is never consulted.
4. Render the structured `StepResult` as text, or as JSON with `--json`. The
   outcome journal entry is written under `.ratchet/changes/<change>/.run/`, so a
   `blocked` or `awaiting-approval` step stays resumable.

## Run state

Run state is written under `.ratchet/changes/<change>/.run/` — never under
`.ratchet/batches/`. See [Run-state locus](../engine/run-state.md).

## Hold-out scenarios

`ratchet verify` reads the same filtered `contextFiles` that `ratchet apply`
reads — `@holdout`-tagged Scenarios are stripped from the `.feature` files
before the verify agent reads them. This is intentional: `verify` shares the
`generateApplyInstructions` builder with `apply`; re-using it prevents the
verify loop from leaking held-out content back to the building agent.

If the change has held-out Scenarios, the JSON output of
`ratchet instructions apply --json` carries `heldOutCount > 0` and the verify
agent emits a non-blocking WARNING naming the count only:

> WARNING: N @holdout scenario(s) are excluded from this view — run `ratchet eval run` to enforce them.

The verify agent must NOT treat a held-out Scenario's absence as a coverage
gap — held-out Scenarios are legitimately absent from the filtered view;
enforcement is `eval run`, which reads the real source file directly.

See [`ratchet eval`](./eval.md) for the enforcement surface and
[`ratchet instructions`](./instructions.md) for filtering details.

## Help group

`verify` is listed under the `Workflow:` heading in `ratchet --help`, after
`apply` and before `batch`. See [Workflow help group](./workflow-help.md).
