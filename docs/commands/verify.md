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

## Help group

`verify` is listed under the `Workflow:` heading in `ratchet --help`, after
`apply` and before `batch`. See [Workflow help group](./workflow-help.md).
