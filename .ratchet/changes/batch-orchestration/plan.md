# batch-orchestration

## Why

Ratchet manages one change at a time, with no way to streamline a set of
related changes that should run in serial or parallel. Teams that try to plan a
multi-change effort upfront fall into the classic waterfall traps: a frozen
spec that is expensive to revise, errors that surface only at the end, no
working software until late, and timelines built on the planning fallacy. A
batch introduces phased delivery where each phase ships functional software
behind an executable proof-of-work, and changes are discovered phase by phase
rather than fixed upfront.

## What Changes

This change delivers the **open CLI surface** for batches plus the **engine
interface contract**. The licensed execution engine that actually spawns agent
subprocesses is a separate change (`batch-engine`); here `ratchet batch apply`
hands off to that engine through the contract and fails cleanly when it is
absent.

- New `.ratchet/batches/<name>/batch.yaml` manifest format: ordered **phases**,
  each with a goal, success criteria, and an executable **proof-of-work**; each
  phase holds a DAG of **change intents** (`name` + optional `after` edges).
  References changes by name — never owns them. Implements features in
  `features/batch-manifest/`, `features/batch-phases/`, and `features/batch-dag/`.
- `ratchet new batch <name>` — scaffold a batch from a template (mirrors
  `ratchet new change`). `features/batch-manifest/`.
- `ratchet batch view [name]` / `ratchet batch list` — rich terminal dashboard
  for batches and a single batch, status derived live from change state on
  disk. `features/batch-view/`, `features/batch-status/`.
- `ratchet batch config [name]` — resolve/get/set batch settings, defaults from
  `.ratchet/config.yaml` under a new `batch:` key, per-manifest overrides.
  Dials: `gate` (default `voluntary`), `strategy` (default `vertical-slice`),
  `proofOfWork` (default `hard-gate`), `agent`. `features/batch-config/`.
- `ratchet batch report` — CLI channel for the agent to post progress, raise a
  blocker, or request input; the voluntary-halt mechanism. `features/batch-report/`.
- `ratchet batch apply <name>` — **single step**: pick the next ready DAG step,
  hand it to the engine for exactly one transition (propose → apply → verify),
  render the result, return. No internal loop. `features/batch-apply/`.
- `ratchet template batch` — serve the batch manifest template.
  `features/batch-template/`.
- **Engine interface contract** — a versioned typed boundary the CLI uses to
  load and call an engine without importing its internals; engine-absent is a
  first-class state. `features/engine-interface/`.
- `/rct:batch` skill — triggers the same single-step apply as the CLI.

## Design

**Manifest as declarative intent; status derived on disk.** The manifest holds
phases and change intents only — never progress. Batch status is computed live
the way `ratchet view` already does it: change existence under
`.ratchet/changes/`, `plan.md` checkbox counts via
`getTaskProgressForChange` (`src/utils/task-progress.ts`), and archive
membership = done. A manifest intent with no change directory yet is `pending`,
not an error — this is what lets changes be created lazily as the batch
progresses (anti-waterfall: plan phase N with phase N-1's real outcomes).

**DAG reuse.** The `after` edges form a dependency graph per phase. Reuse the
Kahn's-algorithm topological sort and ready/blocked logic from
`ArtifactGraph` (`src/core/artifact-graph/graph.ts`: `getBuildOrder`,
`getNextArtifacts`, `getBlocked`) rather than reimplementing. Cycle and
unknown-reference detection live here.

**Phases and proof-of-work.** A phase declares `goal`, `success`, and a
`proofOfWork` with `kind` (`integration | blackbox | llm-judge`), a runnable
`run` command, and a `pass` condition — each kind is something an agent can
execute via bash or an MCP tool. Phase N+1 is blocked until phase N's
proof-of-work passes; a failing proof-of-work hard-gates phase completion by
default (`proofOfWork: warn` relaxes to a warning). The CLI models and reports
phase gating; the engine executes the proof-of-work.

**Config layering.** Extend `ProjectConfigSchema`
(`src/core/project-config.ts`) with an optional `batch` object. Effective
settings = project config defaults ← manifest overrides. `ratchet batch config`
reads/writes the `batch:` section and validates enum values, leaving the file
unchanged on invalid input.

**Engine boundary.** Define a `BatchEngine` interface (contract version
included): the CLI builds a resolved step context (change name, transition,
phase goal/success/proof-of-work, resolved settings, prior run journal), passes
it to the engine, and persists the structured result (new state, blocker or
approval request, journal pointer) without knowing how it was produced. If no
engine is registered, the CLI reports engine-absent through the interface;
`status`/`view`/`config` work without it. A contract-version mismatch refuses
to run.

**Halt model.** Default gate `voluntary`: only agent-raised blockers (via
`ratchet batch report --blocker`) halt; the engine parks the step and the next
`apply` resumes the agent with the answer. `after-propose` adds a structural
awaiting-approval gate after propose, with reject-with-feedback re-running
propose (cheap revision, no phase rollback). The CLI owns parking/journal
state; the engine owns running the agent.

**Wiring.** Add `batchesDir` to `PlanningHome`
(`src/core/planning-home.ts`). Register a `batch` command group in
`src/cli/index.ts` (mirroring the `new` group) with `view`, `list`, `config`,
`report`, `apply` subcommands, plus `new batch` under the existing `new` group.
New batch template at `schemas/ratchet/templates/batch.yaml`, served by the
existing `templateCommand` (`src/commands/template.ts`). View/list mirror
`ViewCommand` (`src/core/view.ts`) and `ListCommand` (`src/core/list.ts`)
chalk/symbol/progress-bar patterns.

## Tasks

- [x] 1.1 Add `batchesDir` to `PlanningHome` and populate it in the repo planning-home helper (`src/core/planning-home.ts`)
- [x] 1.2 Define batch manifest types + Zod schema (phases, proof-of-work, change intents with `after` edges)
- [x] 1.3 Implement manifest load/parse/validate with clear errors for malformed entries
- [x] 2.1 Implement the batch DAG: build ready/blocked/done over change intents, reusing the artifact-graph topological-sort logic
- [x] 2.2 Add cycle detection and unknown-reference detection naming the offending entries
- [ ] 2.3 Implement phase gating: phase blocked until prior phase proof-of-work passes
- [ ] 3.1 Derive change status on disk (existence=pending, plan.md task counts, archive=done) and aggregate to phase and batch level
- [ ] 3.2 Implement `ratchet batch status` text + `--json` output (phases, changes, next step, gated/blocked)
- [ ] 4.1 Extend `ProjectConfigSchema` with an optional `batch` section (gate, strategy, proofOfWork, agent) and defaults
- [ ] 4.2 Implement effective-settings resolution (project defaults ← manifest overrides)
- [ ] 4.3 Implement `ratchet batch config [name]` get/set with enum validation and no-op on invalid input
- [ ] 5.1 Create `schemas/ratchet/templates/batch.yaml` template and confirm `ratchet template batch` serves it
- [ ] 5.2 Implement `ratchet new batch <name>` scaffolding from the template, with kebab-case name validation and exists-guard
- [ ] 6.1 Implement `ratchet batch view [name]` rich dashboard (single batch + list) mirroring view.ts patterns, honoring `--no-color`
- [ ] 7.1 Define the run journal model and the `ratchet batch report` command (status, blocker, needs-input, completion)
- [ ] 7.2 Model parked states (blocked, awaiting-approval) and answer/reject-with-feedback recording
- [ ] 8.1 Define the versioned `BatchEngine` interface: resolved step context in, structured step result out, engine-absent + version-mismatch as first-class states
- [ ] 8.2 Implement `ratchet batch apply <name>`: pick next ready step, enforce gates/halts, hand off to the engine, persist result, render rich view; clean error when engine absent
- [ ] 8.3 Add the `/rct:batch` skill that drives the same single-step apply
- [ ] 9.1 Tests: manifest parsing/validation, DAG ready/blocked/cycle, status derivation, config layering, engine-absent path
