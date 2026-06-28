---
title: ratchet batch
sidebar_position: 21
---

# `ratchet batch`

Coordinate related changes across phases via a batch manifest. A batch is an
ordered list of phases, each gating the next with a proof-of-work. Each phase
declares a set of change intents forming a DAG via `after` edges. The manifest
is stored at `.ratchet/batches/<name>/batch.yaml` and references changes by
name. Batch status is derived live from change state on disk — the manifest
stores intent only and never accumulates progress.

`batch apply` advances one DAG step by exactly one transition
(`propose` → `apply` → `verify`) through the bundled engine. The autonomous
loop lives in the `apply-batch` skill, not in the CLI.

Selection treats an `awaiting-verify` change as runnable work: when a change's
tasks are all checked but no verify completion is journaled yet, `batch apply`
selects it and runs its `verify` transition — delegating to the canonical
`/rct:verify <change>` skill — as the gate that must pass before the change
becomes `done`. Selection, status, and next-transition computation all honor the single
journal-aware definition of done (see the `batch status` change-status table
below), so an all-tasks-checked-but-unverified change is never treated as done
and is never skipped.

## Manifest structure

```yaml
name: <batch-name>           # kebab-case
created: YYYY-MM-DD          # set by `batch new`
settings:                    # optional per-manifest overrides
  gate: voluntary            # voluntary | after-propose | every-phase | autonomous
  strategy: vertical-slice   # vertical-slice | feature
  proofOfWork: hard-gate     # hard-gate | warn
  locus: local               # local | docker | remote
  agent: <agent>
  image: <image>             # docker locus only
  host: <host>               # remote locus only
  port: <port>               # remote locus only
  authToken: <token>         # remote locus only (redacted in output)
  insecure: false            # allow plaintext http to non-local remote host
  permissions:               # agent permission policy override
    posture: repo-sandboxed-permissive
    allow: []
    deny: []
phases:
  - name: <phase-name>
    goal: <phase goal>
    success: <success criteria>
    proofOfWork:
      kind: integration       # integration | blackbox | llm-judge
      run: <bash command>
      pass: <pass condition>
    changes:
      - name: <change-name>
        done: <definition of done for this change>  # required
        after: []             # names of changes this one depends on (DAG edges)
```

Every `change.done` field is required. A change intent whose directory does not
yet exist under `.ratchet/changes/` is `pending` — this is not an error.
Changes are created lazily by the engine as the batch progresses.

## `batch new`

Scaffold a new batch manifest from the template.

### Synopsis

```bash
ratchet batch new <name> [--json]
ratchet new batch <name> [--json]   # alias
```

### Options

| Option | Description |
|---|---|
| `--json` | Output the created batch path as JSON. |

### Behavior

1. Validates `<name>` as kebab-case; fails with an actionable error if invalid.
2. Refuses to overwrite an existing batch at `.ratchet/batches/<name>/batch.yaml`.
3. Creates `.ratchet/batches/<name>/batch.yaml` from the canonical batch
   template, stamping `name` and `created` (today's ISO date).

`ratchet new batch <name>` is an identical alias registered on the top-level
`new` command.

## `batch status`

Show batch status derived live from change state on disk.

### Synopsis

```bash
ratchet batch status [name] [--json]
```

`[name]` defaults to the current active batch when omitted (see
[Name resolution](#name-resolution)).

### Options

| Option | Description |
|---|---|
| `--json` | Output structured status as JSON. |

### Behavior

Reads the manifest, reads the run-state journal, and derives status for each
change without consulting the batch manifest for progress (the manifest stores
intent only).

Change statuses (the `Symbol` column is the glyph used in `batch status` and
`batch view` text output):

| Status | Symbol | Meaning |
|---|---|---|
| `pending` | `·` | No change directory exists yet. |
| `ready` | `○` | Dependencies met; change not yet started. |
| `in-progress` | `◉` | Change directory exists; tasks partially complete. |
| `awaiting-verify` | `⧖` | All tasks complete but **no verify completion is journaled yet** — the verify gate has not run, so the change is NOT done. |
| `done` | `✓` | All tasks complete **and** a verify completion is journaled for the change, or the change is archived. |
| `blocked` | `✗` | Dependency unmet, OR an agent voluntarily parked the step with a blocker. |
| `awaiting-approval` | `⏸` | Agent completed propose and parked for approval (after-propose/every-phase gate). |

"Done" has a **single journal-aware definition** shared by status derivation,
step selection, and next-transition computation: a change is done only when its
plan tasks are all checked AND the run journal carries a `completion` entry for
the `verify` transition (or the change is archived). An all-tasks-checked change
with no journaled verify is reported `awaiting-verify` — it is the batch's next
actionable step, because `verify` is the transition that must run before it can
be done.

Phase gating: phase N is gated (status `blocked`) until phase N−1 reports
`done` for all its changes.

**A multi-phase batch is `done` only once every reachable phase is decomposed
AND all its changes are done.** Phases are decomposed lazily: a later phase may
start with an empty `changes` list (no concrete change intents yet). A ready,
ungated phase with empty `changes` is an **outstanding decomposition step**, not
terminal — the batch is NOT reported `done` while such a phase remains, even when
every *declared* change is done. Status and step selection agree by construction:
both treat a reachable empty phase as work (status reports `in-progress` and
`next` points at the phase as a decomposition step; selection returns that phase
rather than `all-done`). A still-gated empty phase is not surfaced yet — the
unfinished prior-phase change is selected first.

**Text output** lists each phase and its changes with status symbols, task
progress counters, `after` edges, and parked step details (blocker message or
approval summary). The next actionable step is printed at the end — a reachable
empty phase prints as `Next: decompose phase <name>`.

**JSON output** (`--json`): the root object includes `name`, `status`,
`progress` (`{ completed, total }`), `changeCount`, `doneCount`, `gate`
(resolved setting), `next` (`{ phase, change }` for a change step, or
`{ phase, decompose: true }` for a reachable empty phase, or `null`), and
`phases`. Each
phase includes `name`, `goal`, `success`, `status`, `gated`, `gatedBy`, and
`changes`. Each change includes `name`, `status`, `done`, `progress`, `after`,
`blockedBy`, `exists`, `archived`, `blocked`, `awaitingApproval`,
`awaitingVerify` (`true` when tasks are all checked but no verify completion is
journaled), and `parked` (`{ kind, reason, answer?, feedback? }` or `null`).

## `batch view`

Rich terminal dashboard for a single batch.

### Synopsis

```bash
ratchet batch view [name] [--json]
```

`[name]` defaults to the current active batch when omitted.

### Options

| Option | Description |
|---|---|
| `--json` | Output the raw `BatchStatusInfo` object as JSON. |

### Behavior

Computes batch status identically to `batch status` and renders it as a
formatted terminal dashboard with progress bars (filled/empty block characters),
phase headings, per-change rows (symbol + name + progress bar + after edges +
blocked-by), and parked step details. Honors `--no-color` (via `NO_COLOR`).

JSON output is the full `BatchStatusInfo` object — the same fields as `batch
status --json` without the `gate` field annotation.

## `batch list`

List all batches with change count and aggregate progress.

### Synopsis

```bash
ratchet batch list [--json]
```

### Options

| Option | Description |
|---|---|
| `--json` | Output structured list as JSON. |

### Behavior

Reads all directories under `.ratchet/batches/` that contain a `batch.yaml`
(the reserved `archive/` directory is excluded). Computes aggregate status for
each batch and renders a summary table.

**Text output**: batch name, inline progress bar, percent complete, and change
count.

**JSON output** (`--json`): `{ batches: [ { name, changeCount, doneCount,
progress, status } ] }`.

## `batch config`

Resolve, get, or set batch settings.

### Synopsis

```bash
ratchet batch config [name] [--set <key=value>] [--json]
```

`[name]` defaults to the current active batch when omitted.

### Options

| Option | Argument | Description |
|---|---|---|
| `--set` | `<key=value>` | Write the project-level `batch:` section key. |
| `--json` | | Output resolved settings as JSON. |

### Behavior

**Without `--set`**: resolves and displays effective settings. Settings are
resolved in this order (nearest wins): manifest overrides ← project config
(`.ratchet/config.yaml` `batch:` section) ← user config ← built-in defaults.
Each value is annotated with its source: `[manifest]`, `[project]`, `[user]`,
or `[default]`. `authToken` is always redacted in output (`***`).

**With `--set key=value`**: writes the project-level config (`batch:` section)
only. Invalid enum values are rejected and the file is left unchanged. Secret
values (e.g. `authToken`) are not echoed back.

Settable keys:

| Key | Values | Default |
|---|---|---|
| `gate` | `voluntary` \| `after-propose` \| `every-phase` \| `autonomous` | `voluntary` |
| `strategy` | `vertical-slice` \| `feature` | `vertical-slice` |
| `proofOfWork` | `hard-gate` \| `warn` | `hard-gate` |
| `locus` | `local` \| `docker` \| `remote` | `local` |
| `agent` | string | (adapter default) |
| `image` | string | `python:3.12` (docker locus) |
| `host` | string | (required for remote) |
| `port` | number | (required for remote) |
| `authToken` | string | (required for remote) |

The `permissions` policy is structured; use the manifest `settings.permissions`
block to set it per-batch.

## `batch report`

Report progress, raise a blocker, or request input on a step.

### Synopsis

```bash
ratchet batch report [name] --change <name> <kind-flag> <message> [--json]
```

`[name]` defaults to the current active batch when omitted. `--change` is
always required. Exactly one kind flag must be provided.

### Options

| Option | Argument | Description |
|---|---|---|
| `--change` | `<name>` | **Required.** Change the report is about. |
| `--status` | `<message>` | Record routine progress (appends a `progress` journal entry). |
| `--blocker` | `<message>` | Raise a blocker and park the step as `blocked`. |
| `--needs-input` | `<message>` | Request input and park the step as `blocked`. |
| `--complete` | `<message>` | Signal that the step produced its output (appends a `completion` entry). |
| `--awaiting-approval` | | Combined with `--complete`: parks the step as `awaiting-approval` (after-propose gate). |
| `--answer` | `<message>` | Record an answer to a parked blocker; the step remains parked until the next `batch apply`. |
| `--reject` | `<message>` | Reject an `awaiting-approval` step with feedback; next `batch apply` re-runs propose. |
| `--json` | | Output the result as JSON (`{ kind, change, text }`). |

### Behavior

Exactly one of `--status`, `--blocker`, `--needs-input`, `--complete`,
`--answer`, or `--reject` must be present; providing zero or more than one is
an error.

| Kind flag | Journal entry appended | Parked state written |
|---|---|---|
| `--status` | `progress` | none |
| `--blocker` | `blocker` | `blocked` (reason = message) |
| `--needs-input` | `needs-input` | `blocked` (reason = message) |
| `--complete` | `completion` | none (or `awaiting-approval` with `--awaiting-approval`) |
| `--complete --awaiting-approval` | `completion` | `awaiting-approval` (reason = message) |
| `--answer` | `answer` | answer stored on the existing `blocked` park; park stays until resume |
| `--reject` | `reject` | feedback stored on the existing `awaiting-approval` park; next apply re-runs propose |

A `blocked` step with a recorded answer (via `--answer`) resumes on the next
`batch apply`. A rejected `awaiting-approval` step causes the next `batch apply`
to re-run propose with the feedback in context.

Journal entries are appended to
`.ratchet/batches/<batch>/run/journal.jsonl`; parked state is written to
`.ratchet/batches/<batch>/run/state.json`.

## `batch apply`

Advance the batch by one step via the bundled engine.

### Synopsis

```bash
ratchet batch apply [name] [--json]
```

`[name]` defaults to the current active batch when omitted.

### Options

| Option | Description |
|---|---|
| `--json` | Output the structured `StepResult` as JSON. |

### Behavior

`batch apply` is a **single-step** command: it selects the next ready step,
runs exactly one transition, persists the result, and returns. It does not loop.
The autonomous apply loop is the `apply-batch` skill.

Execution sequence:

1. **Select next step.** Iterates phases in declaration order, skipping gated
   phases. Within each ungated phase, picks the first change with status `ready`,
   `in-progress`, or `awaiting-verify` (an all-tasks-checked change with no
   journaled verify is selected so its `verify` gate runs before `done`). If no
   change is runnable but a reachable, ungated phase has
   an empty `changes` list, that phase is selected as a **decomposition step**
   (see below). If neither exists, prints a "nothing ready" message and exits
   (without error).

   **Decomposition step.** When the next runnable step is a reachable phase whose
   `changes` are still empty, `batch apply` spawns one agent that delegates to the
   canonical `decompose-phase` skill (`/rct:decompose-phase <phase>`, resolved per
   agent) to author that phase's concrete change intents into `batch.yaml` from
   the prior phases' shipped results — the engine orchestrates the spawn, the
   skill authors the intents (it creates no change directories). The agent reports
   under the phase name (`ratchet batch report <batch> --change <phase> ...`), and
   the resulting `StepResult` has `transition: 'decompose'`. The next `batch
   apply` then selects the phase's first ready change as an ordinary
   propose/apply/verify step, so a multi-phase batch with later empty phases is
   driven to completion with no manual stop/propose/resume detour.

2. **Park precheck.** If the selected step is parked as `blocked` without a
   recorded answer, or as `awaiting-approval` without approval or feedback, the
   command prints a "did not advance" message with a hint and exits. The park must
   be resolved before the step can advance.

3. **Derive transition.** The authoritative transition is computed from on-disk
   state via `computeNextTransition`; the status-derived hint in the context is
   only a coarse fallback.

4. **Acquire per-batch lock.** A single-flight lock prevents concurrent applies
   for the same batch. An already-locked batch returns immediately.

5. **Spawn agent.** The bundled `RatchetBatchEngine` spawns exactly one coding
   agent for the derived transition (`propose`, `apply`, or `verify`) — or, for a
   decomposition step, for the phase decomposition (`decompose`). The engine is
   in-process — no separate install or activation is required. The agent receives
   structured instructions including phase goal, success criteria, proof-of-work
   description, change definition of done (change steps) or the prior phases'
   shipped results (decomposition steps), and resume context (if any). Every spawn
   delegates to the canonical rct skill for that step rather than re-describing it
   inline.

6. **Map outcome.** Session journal entries and the on-disk change-state delta
   are mapped to a `StepResult`:

   | `state` | Meaning |
   |---|---|
   | `advanced` | Transition completed; change moves to next step. |
   | `blocked` | Agent raised a blocker; step is parked. |
   | `awaiting-approval` | Propose completed under an `after-propose`/`every-phase` gate; step is parked for approval. |
   | `nothing-ready` | No actionable step found. |

7. **Persist outcome.** Parked state is written to `state.json`; journal entry
   appended to `journal.jsonl`. A cleared park (on `advanced`) removes the prior
   park entry.

**Gate behavior by setting:**

| `gate` | After-propose behavior |
|---|---|
| `voluntary` | Agent may voluntarily park as `blocked`; no automatic approval gate. |
| `after-propose` | Every propose parks as `awaiting-approval` before apply. |
| `every-phase` | Same as `after-propose` within each phase. |
| `autonomous` | Agent may park on blockers; no approval gate. |

**JSON output**: the raw `StepResult` object (`state`, `change`, `transition`,
`blocker?`, `approvalRequest?`, `journalRefs?`, `message?`). `transition` is
`propose` | `apply` | `verify` | `decompose`; on a decomposition step `change`
carries the decomposed phase's name. When nothing is
ready, `{ state: 'nothing-ready', message: '...' }`. When a step is pre-checked
as parked, `{ state: 'parked', change, reason, hint }`.

## `batch archive`

Archive a completed batch: cascade change-archive over member changes, then
move the batch directory to the archive.

### Synopsis

```bash
ratchet batch archive [name] [-y | --yes] [--json]
```

`[name]` defaults to the current active batch when omitted.

### Options

| Option | Description |
|---|---|
| `-y, --yes` | Skip the incomplete-batch confirmation prompt. |
| `--json` | Output the structured archive result as JSON. |

### Behavior

1. Loads and derives the current batch status. If any changes are not `done`,
   prints a warning listing the incomplete changes and prompts for confirmation
   (unless `--yes` skips the prompt). Declining the prompt aborts with no
   changes made.

2. Resolves the destination path
   `.ratchet/batches/archive/<YYYY-MM-DD>-<name>/` and fails before any
   cascade if an entry already exists there.

3. Cascades the change-archive flow over every change intent in phase order.
   Already-archived changes are skipped (idempotent). Never-created (pending)
   changes are skipped. Each archived change runs through the standard
   `ArchiveCommand` (feature-store materialization, standard-link materialization).

4. Moves the batch directory (manifest + run journal) to the resolved archive
   path.

A mid-cascade failure leaves earlier changes archived and the batch directory in
place. Re-running is safe: already-archived changes are skipped.

**JSON output**: `{ batchName, archivedChanges, skippedArchived, skippedPending,
archivePath?, aborted? }`.

## Name resolution

For subcommands where `[name]` is optional:

- If `<name>` is given, it must match an existing batch under
  `.ratchet/batches/`; otherwise an error is thrown.
- If omitted and exactly one batch exists, that batch is selected automatically.
- If omitted and zero or multiple batches exist, the command errors with
  actionable guidance (create one, or specify a name).

The `archive/` subdirectory is never treated as a batch name.

## Notes

**First-run agent-permissions setup.** Before the first `batch` subcommand
executes when no agent-permissions posture is configured, an interactive setup
prompt guides the operator to choose a posture. Headless and CI environments
are never prompted — the effective posture falls back to the built-in default.
The setup is best-effort: any failure is non-fatal and the underlying command
proceeds. Debug output is available under `DEBUG=1` or `RATCHET_DEBUG=1`.

## See also

- [Change-step core](../engine/change-step.md)
- [Run-state locus](../engine/run-state.md)
