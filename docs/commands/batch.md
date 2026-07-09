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
      kind: integration       # integration | blackbox  (llm-judge not yet supported)
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

### Pass conditions

A phase's `proofOfWork.pass` is a declarative condition the engine evaluates
against the `run` command's exit status and stdout. Recognized shapes:

- `exit 0` / `exit-zero` / `exit code 0` (or a leading exit-zero directive
  followed by prose, e.g. `exit code 0 — suite green`) — passes when the command
  exits 0. Gates on the exit status, never stdout.
- `contains:<needle>` — passes when stdout contains `<needle>` (exit 0 required).
- `regex:<pattern>` — passes when stdout matches the pattern (exit 0 required).
- Any other non-empty string — a bare substring match against stdout (exit 0
  required).

**Load-time validation.** The manifest is rejected at parse (by both
`ratchet validate` and `batch apply`'s manifest load) when a pass condition is
degenerate — a hard-gate proof-of-work must never be vacuous by construction:

- an empty or whitespace-only `contains:` needle (`stdout.includes('')` is
  always true),
- an empty `regex:` pattern (matches everything),
- an invalid `regex:` pattern — the RegExp compile error is surfaced in the
  message,
- the echo-your-own-pass-phrase shape: the literal needle of a `contains:` or
  bare-string condition appearing verbatim in the `run` command, so the command
  can satisfy its own gate.

Exit-zero directives are exempt from the self-satisfying lint (they gate on exit
status, never stdout); `regex:` patterns are exempt too (a pattern appearing in
`run` is not the echo shape). Errors are located at `phases.<N>.proofOfWork.pass`.


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
| `awaiting-approval` | `⏸` | Agent completed a change transition and parked for approval: `propose` under `after-propose`, or `propose`/`apply`/`verify` under `every-phase`. |

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

A **runtime summary** line is rendered after the progress dashboard, stating the
resolved locus and the effective permission posture with its source. Per-agent
enforcement lines follow (see [Isolation and enforcement
rendering](#isolation-and-enforcement-rendering) below).

JSON output is the full `BatchStatusInfo` object — the same fields as `batch
status --json` without the `gate` field annotation — plus `runtime` (locus,
posture, postureSource, isolation) and `enforcement` (per-agent entries) fields.

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
ratchet batch config [name] [--set <key=value>] [--json] [--allow-manifest-escalation]
```

`[name]` defaults to the current active batch when omitted.

### Options

| Option | Argument | Description |
|---|---|---|
| `--set` | `<key=value>` | Write the project-level `batch:` section key. |
| `--json` | | Output resolved settings as JSON. |
| `--allow-manifest-escalation` | | Let the repo-committed manifest RAISE the permission posture above the operator-owned (default/user/project) scopes when resolving for display. Default (unset): the manifest may only NARROW (lower) posture; a manifest raise is clamped and the posture is annotated with its real (clamped) source. Mirrors the `batch apply` flag so operators can preview an escalated posture. |

### Behavior

**Without `--set`**: resolves and displays effective settings. Settings are
resolved in this order (nearest wins): manifest overrides ← project config
(`.ratchet/config.yaml` `batch:` section) ← user config ← built-in defaults.
Each value is annotated with its source: `[manifest]`, `[project]`, `[user]`,
or `[default]`. `authToken` is always redacted in output (`***`).

In addition to the resolved scalar settings, the display renders an
**isolation** block and per-agent **enforcement** lines (see
[Isolation and enforcement rendering](#isolation-and-enforcement-rendering)
below).

**With `--set key=value`**: writes the project-level config (`batch:` section)
only. Invalid enum values are rejected and the file is left unchanged. Secret
values (e.g. `authToken`) are not echoed back.

The `agent` key is validated through the same shared `AgentSettingSchema` the
loaders use (so the write path can never persist what the loader rejects): a
scalar value is validated as an `agent[:model]` spec, and a value whose
trimmed form starts with `{` is parsed as a YAML flow map and validated as a
per-stage map (each entry checked). A malformed value (e.g. `agent=claude:`)
is rejected with an error naming the offending value, and the file is left
byte-for-byte unchanged. A valid inline map (e.g.
`agent={apply: opencode, verify: 'claude:fable'}`) persists as a real YAML
map the loader round-trips with no warning; a valid scalar persists as a
plain string.

Settable keys:

| Key | Values | Default |
|---|---|---|
| `gate` | `voluntary` \| `after-propose` \| `every-phase` \| `autonomous` | `voluntary` |
| `strategy` | `vertical-slice` \| `feature` | `vertical-slice` |
| `proofOfWork` | `hard-gate` \| `warn` | `hard-gate` |
| `locus` | `local` \| `docker` \| `remote` | `local` |
| `agent` | `agent[:model]` spec, or an inline `{propose, apply, verify, pr}` stage-map (validated through the shared schema; rejected without writing when malformed) | (adapter default) |
| `image` | string | `python:3.12` (docker locus) |
| `dockerUser` | string (e.g. `"1000:1000"`) | current host `uid:gid` (docker locus) |
| `dockerMemory` | string (e.g. `"2g"`) | `2g` (docker locus) |
| `dockerPidsLimit` | positive integer | `512` (docker locus) |
| `dockerCpus` | positive number (fractional ok) | *(no flag — opt-in)* (docker locus) |
| `network` | `bridge` \| `none` \| `<custom name>` | `bridge` (docker locus) |
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
| `--awaiting-approval` | | Combined with `--complete`: parks the step as `awaiting-approval` (the gate×transition matrix decides which transitions park). |
| `--answer` | `<message>` | Record an answer to a parked blocker; the step remains parked until the next `batch apply`. |
| `--reject` | `<message>` | Reject an `awaiting-approval` step with feedback; next `batch apply` re-runs the parked transition. |
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
| `--reject` | `reject` | feedback stored on the existing `awaiting-approval` park; next apply re-runs the parked transition |

A `blocked` step with a recorded answer (via `--answer`) resumes on the next
`batch apply`. A rejected `awaiting-approval` step causes the next `batch apply`
to re-run the parked transition with the feedback in context.

Journal entries are appended to
`.ratchet/batches/<batch>/run/journal.jsonl`; parked state is written to
`.ratchet/batches/<batch>/run/state.json`.

## `batch apply`

Advance the batch by one step via the bundled engine.

### Synopsis

```bash
ratchet batch apply [name] [--json] [--allow-manifest-escalation]
```

`[name]` defaults to the current active batch when omitted.

### Options

| Option | Description |
|---|---|
| `--json` | Output the structured `StepResult` as JSON. Suppresses the human-readable posture banner and suppression warning. |
| `--allow-manifest-escalation` | Let the repo-committed manifest RAISE the permission posture above the operator-owned (default/user/project) scopes. Default (unset): the manifest may only NARROW (lower) posture; a manifest raise is clamped to the operator-scope posture and a warning is printed. |

### Posture banner

Every human-readable `batch apply` run opens with a one-line banner stating the
effective permission posture and the scope that supplied it:

```
permissions: repo-sandboxed-permissive (project scope)
```

When a repo-committed manifest tries to RAISE the posture above the
operator-owned scopes and `--allow-manifest-escalation` is not set, the raise is
**clamped** — the run proceeds under the operator-scope posture — and a warning
is printed naming the requested posture, the `--allow-manifest-escalation` flag,
and the operator-owned (`user`/`project`) config scopes as the ways to raise the
posture. The manifest's `deny` additions still take effect under the clamped
posture. `--json` suppresses both lines (machine consumers read the resolved
settings they build themselves). See
[`batch.permissions`](../configuration/config-yaml.md#batchpermissions-object)
for the merge semantics.

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

   **Proof-of-work boundary step.** Before returning a runnable change in a phase
   `Q`, `batch apply` interposes the immediately-preceding phase `P`'s
   proof-of-work as a boundary step. `P` is `done` (else `Q` would be gated), so
   when `P` has no recorded proof verdict yet, `batch apply` runs `P`'s
   **configured** `proofOfWork.run` in the project root (with the resolved policy
   and `P`'s success criteria), journals the verdict as a `proof-of-work` entry,
   and returns. The verdict is recorded once per boundary. The first phase has no
   predecessor, so no proof runs there. The recorded verdict then **drives the
   gate**: the next `batch apply` derives `Q`'s gate from `P`'s recorded
   `gatePassed`. A passing proof (or `warn`) advances into `Q`'s change; a failing
   `hard-gate` proof keeps `Q` blocked, `batch apply` advances no `Q` change, and
   its "no ready step" output cites `P`'s failing proof instead of the generic
   gated message. The block persists across separate stateless `batch apply`
   invocations. See [engine: phase gates and
   proof-of-work](../engine/overview.md#phase-gates-and-proof-of-work).

   **Terminal-phase proof.** The **last** phase has no following phase `Q` to
   trigger its boundary proof. So once every change in the batch is done and
   nothing is left to decompose, `batch apply` surfaces and runs the terminal
   phase's proof-of-work the same way — and the batch is **not `done`** until that
   proof is recorded as satisfied (`gatePassed: true`). A failing terminal
   `hard-gate` proof keeps the batch `in-progress` with nothing auto-runnable: the
   no-step output cites the failing terminal proof and the operator must
   `batch rerun-proof` (or fix the cause). A **single-phase** batch therefore gates
   on its one phase's proof before reporting `done`. The predecessor's boundary
   proof also runs **before a decomposition step** (an undecomposed phase is
   entered off its predecessor's slice).

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
   | `awaiting-approval` | A completed change transition parked under an approval gate; step is parked for approval. |
   | `nothing-ready` | No actionable step found. |

7. **Persist outcome.** Parked state is written to `state.json`; journal entry
   appended to `journal.jsonl`. A cleared park (on `advanced`) removes the prior
   park entry.

**Gate behavior by setting:**

| `gate` | Transitions parked for approval |
|---|---|
| `voluntary` | Agent may voluntarily park as `blocked`; no automatic approval gate. |
| `after-propose` | Every completed `propose` parks as `awaiting-approval` before `apply`. |
| `every-phase` | Every completed change transition (`propose`, `apply`, `verify`) parks as `awaiting-approval`. Decomposition and PR-open steps never park. |
| `autonomous` | Agent may park on blockers; no approval gate. |

The decision is made by the pure `parksForApproval(gate, transition)` matrix
(`src/core/batch/engine/approval-gate.ts`), the single source of truth threaded
through `shouldParkForApproval` and the decomposition and PR-open step call
sites — so a decomposition or PR-open step never parks for approval under any
gate (a decomposition's authored intents are reviewed when each change's
propose parks; a PR is itself the human checkpoint). The awaiting-approval
park message names the transition that completed (e.g. "Apply complete;
awaiting approval.").

**JSON output**: the raw `StepResult` object (`state`, `change`, `transition`,
`blocker?`, `approvalRequest?`, `journalRefs?`, `message?`). `transition` is
`propose` | `apply` | `verify` | `decompose`; on a decomposition step `change`
carries the decomposed phase's name. When nothing is
ready, `{ state: 'nothing-ready', message: '...' }`. When a step is pre-checked
as parked, `{ state: 'parked', change, reason, hint }`.

**Attributed fast failures**: when a transition (or a batch-driven pr / phase-
decomposition step) whose resolved spec explicitly named a model fails fast on a
real non-zero exit code (no signal — `signal === null`, not a signal kill), with
no journal progress — the argv-rejection signature — the surfaced
`blocker`/`message` carry the stage/agent/model/scope attribution hint, so the
non-JSON blocked line (`⚠ blocked — …`), the parked-step reason re-shown on
resume, and the journal entry message recorded for the transition all name the
exact model string and its supplying scope as "if this model id is invalid…"
guidance (the `detail` field still opens with the hint above the captured stderr
tail for `--json` consumers). The `pr` stage spawn is attributed via its `pr`
stage entry's supplying scope; the phase-decomposition spawn is likewise
attributed via its own `decompose` stage entry's supplying scope. A signal-killed spawn (e.g. a `timeout`
SIGKILL, OOM kill — `exitCode: null, signal: 'SIGKILL'`) under a valid explicit
model is NOT a real exit code, so the hint is suppressed there even with zero
journal progress; the bare-failure fallback names the signal (`via signal
SIGKILL`) and surfaces the stderr tail on every rendered surface without the
hint, so an externally killed agent under a valid model never misdirects the
operator. Bare-name specs, stage-map-driven decompose spawns (default agent, no
model), scope-less standalone paths, and failures after journal progress render
byte-for-byte today's output with no hint.

## `batch rerun-proof`

Invalidate a phase's recorded proof-of-work so the next `batch apply` re-runs
that phase's configured boundary proof.

### Synopsis

```bash
ratchet batch rerun-proof [name] --phase <phase> [--json]
```

`[name]` defaults to the current active batch when omitted. `--phase` is
**required**.

### Options

| Option | Argument | Description |
|---|---|---|
| `--phase` | `<phase>` | **Required.** The phase whose recorded proof-of-work to invalidate. Must be a phase declared in the manifest. |
| `--json` | | Output the result as JSON (`{ batch, phase, invalidated }`). |

### Behavior

A phase's boundary proof-of-work runs **at most once**: `batch apply` journals a
durable `proof-of-work` verdict, and the gate reads that verdict forever after.
When a verdict was recorded `FAILED` for a fixable reason (a misconfigured `pass`
condition, a flaky run, an environment fix), the next phase stays permanently
blocked. `batch rerun-proof` is the **supported** operator override that replaces
hand-editing the append-only run journal.

It appends a **superseding `proof-of-work-invalidated` marker** keyed by the same
`proof-of-work:<phase>` key the recorder uses. The journal stays append-only —
the original `proof-of-work` entry is left in place (the audit trail is
preserved). The single record reader (`proofRecordsFromEntries`, read by both the
phase gate and boundary-step selection) treats the later marker as **removing**
the phase from the current record map, so the next `batch apply` re-runs the
phase's own configured `proofOfWork.run` boundary proof and records a fresh
verdict that re-derives the gate. The marker carries only the phase name — no
toolchain or command detail.

- **Recorded proof present** (failing or passing): appends the marker and reports
  that the phase's recorded proof was invalidated; the next `batch apply` re-runs
  the boundary instead of advancing into the next phase.
- **No recorded proof for the phase**: a **no-op** — nothing is appended, the run
  journal is left unchanged, and the command reports there is nothing to
  invalidate (`invalidated: false` in JSON).
- **Missing `--phase`**: exits with an actionable error naming the missing flag;
  nothing is appended.
- **Unknown phase** (not in the manifest): exits with an error stating the phase
  is not part of the batch; nothing is appended.

This is an orchestration override only: it journals a marker that changes which
boundary step the engine next offers. It spawns no agent and defines no second
"done" — the boundary proof still runs via the normal `batch apply` path. See
[engine: phase gates and
proof-of-work](../engine/overview.md#phase-gates-and-proof-of-work) and
[run-state: proof-of-work records](../engine/run-state.md#proof-of-work-records-phase-boundary-verdicts).

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

## Isolation and enforcement rendering

`batch config` and `batch view` render an honest picture of how the resolved
batch settings translate into runtime isolation and per-agent enforcement. This
is descriptive only — it reports the real posture; it does not change it.

### Isolation block

A single line describes the real isolation boundary imposed by the resolved
locus, independent of the permission posture:

| Locus | Rendered isolation |
|---|---|
| `local` | `advisory — no process boundary; permission posture is the only gate` |
| `docker` | `container (image <image>, memory <m>, pids <p>, network <net>, user <uid:gid>)` with the resolved docker contract values, and a note that full autonomy still needs the container hardened (see [#85](https://github.com/anomaly-ai/ratchet/issues/85)) |
| `remote` | `server boundary — agent runs on the remote host; local ratchet only streams` |

The docker contract line states the documented host `uid:gid` fallback when no
`dockerUser` is set rather than probing the live process.

### Per-agent enforcement lines

For every distinct agent assigned across the batch's stages, one line states
whether that agent's permission flags are actually enforced at spawn:

- **Enforced**: the agent's binary is on the supported list and its permission
  flags are injected into the spawn argv (e.g. `claude: enforced via flags`).
- **Not enforced**: the agent defaults apply unchanged — the agent is either not
  on the supported list or its permission mapper is a no-op for this posture
  (e.g. `cursor: NOT ENFORCED — agent defaults apply`).

The enforcement verdict is derived from the same per-agent mappers the spawn
path uses (`resolvePostureFlags`), so it can never drift from the real argv.

### Posture source annotation

When the resolved permission posture was raised by the repo-committed manifest
above the operator-owned scope and `--allow-manifest-escalation` is set, the
posture line names the escalation source, e.g.:

```
posture: full-autonomy (set by batch manifest — repo-controlled)
```

Without `--allow-manifest-escalation`, a manifest raise is clamped to the
operator-owned posture and the line names the clamped (real) source instead.

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
