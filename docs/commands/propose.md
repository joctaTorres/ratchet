---
title: ratchet propose
sidebar_position: 1
---

# `ratchet propose`

Create a single change headlessly from a free-text objective. `propose` runs
exactly one agent for a **forced** `propose` transition through the change-scoped
engine core (`runChangeStep`), with no batch manifest in sight. Run state is kept
change-locally under `.ratchet/changes/<change>/.run/`.

## Synopsis

```bash
ratchet propose "<objective>" [options]
```

`<objective>` is required: the free-text description the change is created
toward.

## Options

| Option | Argument | Description |
|---|---|---|
| `--name` | `<change>` | Explicit change name; overrides the slug derived from the objective. |
| `-m, --message` | `<guidance>` | Extra guidance for the agent. Repeatable; each value is accumulated and the values are joined into one "Additional guidance:" block. |
| `--agent` | `<agent>` | Override the coding agent for this step. |
| `--locus` | `<locus>` | Where the agent runs: `local`, `docker`, or `remote`. |
| `--image` | `<image>` | Container image for `--locus docker`. |
| `--json` | | Output the structured step result as JSON. |

## Behavior

1. **Change-name derivation.** The change name is the explicit `--name` when
   given, otherwise a kebab-case slug derived from the objective. An objective
   that yields no sluggable characters and no `--name` fails with an actionable
   error and **no agent is spawned**.
2. **Refuse-if-exists.** If `.ratchet/changes/<change>/` already exists, the
   command fails before resolving settings or spawning — `propose` creates a new
   change, it does not resume an existing one. Use `apply`/`verify` to advance an
   existing change, or pass `--name <other>`.
3. **Standalone settings.** Settings resolve `flag → project config → default`
   via `resolveChangeStepSettings` (no manifest). An invalid `--agent`,
   `--locus`, or `--image` value fails with an actionable error before any agent
   is spawned.
4. **Forced propose.** A `ChangeStepContext` is built with `batch` undefined,
   `transition: 'propose'`, the joined `-m` guidance, and the change-local
   journal, then run once via `engine.runChangeStep`. `computeNextTransition` is
   never consulted — the verb name is the transition.
5. **Result.** The structured `StepResult` is rendered as text, or as JSON with
   `--json`. The engine has already written the outcome journal entry under
   `.ratchet/changes/<change>/.run/`, so a `blocked` or `awaiting-approval` step
   stays resumable.

## Run state

Run state for the change is written under `.ratchet/changes/<change>/.run/`
(`journal.jsonl`, `state.json`) — never under `.ratchet/batches/`. See
[Run-state locus](../engine/run-state.md).

## Help group

`propose` is listed under the `Workflow:` heading in `ratchet --help`, before
`apply`, `verify`, `batch`, and `eval`. See [Workflow help group](./workflow-help.md).
