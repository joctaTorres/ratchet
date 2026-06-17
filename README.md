<p align="center">
  <img src="ratchet.png" alt="ratchet logo" width="220">
</p>

<h1 align="center">ratchet</h1>

**AI-native, BDD-flavored spec-driven development.** A lightweight CLI that lets you and your coding agent agree on *behavior* — written as executable [Gherkin](https://cucumber.io/docs/gherkin/) — before any code is written, then drive the change from proposal to merged spec.

ratchet keeps a lean, behavior-first model: every change is just **two artifacts** — feature files and a plan — and completed work ratchets forward into a permanent, living feature store.

```
You: /rct:propose add dark mode
AI:  Created .ratchet/changes/add-dark-mode/
     ✓ features/theming/dark-mode.feature   — behavior as Given/When/Then
     ✓ plan.md                              — why, what, design, tasks
     Ready for implementation.

You: /rct:apply
AI:  ✓ 1.1 Add theme context provider
     ✓ 1.2 Wire up the toggle + persistence
     All tasks complete.

You: /rct:archive
AI:  Synced features → .ratchet/features/theming/dark-mode.feature
     Archived to .ratchet/changes/archive/2026-06-05-add-dark-mode/
```

---

## Why ratchet?

AI coding assistants are powerful but unpredictable when the spec lives only in chat history. ratchet adds a thin spec layer so intent is explicit and verifiable:

- **Behavior is the contract.** Requirements are Gherkin scenarios (`Given/When/Then`) — concrete, testable, and unambiguous for both humans and agents.
- **Two artifacts, no ceremony.** A change is `features/` + `plan.md`. That's it.
- **A living spec that ratchets forward.** Archiving a change copies its features into a permanent `.ratchet/features/` store — your project's always-current behavioral spec.
- **Big work ships in phases, not waterfalls.** [Batch orchestration](#batch-orchestration) slices an objective into ordered vertical-slice phases, each gated by an executable proof-of-work, and drives them to completion autonomously — changes are created lazily as the batch advances.
- **The spec is also a regression suite.** [`ratchet eval`](#eval-suite) turns your `.feature` files into a scored, baseline-diffed eval run, judged against fixtures by the bundled engine — so behavior that passes today can't silently regress.
- **Works with the tools you already use.** Slash commands and skills for Claude Code, OpenCode, Cursor, GitHub Copilot, and Codex.

## The model

Each change has exactly two artifacts, with a clear dependency:

```
features/**/*.feature  ──▶  plan.md  ──▶  apply  ──▶  archive
   (Gherkin behavior)      (why+what         (tasks         (whole-file copy into
                            +design+tasks)    tracked)        .ratchet/features/)
```

- **`features/`** — one or more Gherkin `.feature` files, grouped by capability (`features/<capability>/<name>.feature`). Each scenario must have at least one `Given`, one `When`, and one `Then`.
- **`plan.md`** — a single document combining `## Why`, `## What Changes`, `## Design`, and a `## Tasks` checklist. The apply phase tracks progress by reading the `- [ ]` boxes here.
- **`apply`** requires `plan`; it implements against the scenarios and checks off tasks.
- **`archive`** validates, copies the change's features into the permanent store (add / overwrite by path, or remove via a `features/.deleted` tombstone), and moves the change into `changes/archive/<date>-<name>/`.

### Standards

Standards are project-level guidelines kept at `.ratchet/standards/*.md` — a sibling of the feature store, **not** a per-change artifact. A standard can cover any concern (testing, security, architecture, design, …). `ratchet init` creates the directory empty; author standards with `/rct:propose-standard`.

Each standard carries a stable **`tag`** in its frontmatter (`tag: security`); the tag falls back to the file name when omitted. The tag — not the file name — is how changes and features reference a standard, so a standard can be renamed without breaking links. Tags must be unique across the library (`validate` errors on a duplicate).

Standards are loaded automatically where the agent has discretion:

- **propose** reads the active standards, bakes the applicable ones into `plan.md` (Design + Tasks) and the features, and records the tags the change follows as `standards: [<tag>…]` in the change's `.ratchet.yaml`.
- **verify** scopes its check to the change's declared tags (falling back to all standards when none are declared).
- **apply** never reads standards — the plan already embedded them, so it just follows the plan.

**Bidirectional links, materialized on archive.** A change declares which standards it follows; `validate` errors if it references an unknown tag. On **archive** that link is written into the permanent store in both directions:

- **Forward** — a per-capability sidecar `.ratchet/features/<capability>/.ratchet.yaml` maps each feature file to the change's standard tags.
- **Reverse** — a generated `## Implemented by` block in each `.ratchet/standards/<tag>.md` lists the features that satisfy it.

The reverse block is a pure projection of the forward sidecars: it is **regenerated from the store on every archive, never hand-edited or appended**. Rename or tombstone a feature and its entry drops out on the next archive, so a standard's implementing-features list can't go stale. A change that declares no standards changes nothing.

## Install

Requires **Node.js ≥ 20.19** and **pnpm**.

```bash
git clone https://github.com/joctaTorres/ratchet.git
cd ratchet
pnpm install
make install          # build + link the `ratchet` command onto your PATH
```

`make install` builds the project and globally links `ratchet` from the **currently checked-out branch** — switch branches and re-run it to install that version. Manage the local install with:

| Command | What it does |
|---|---|
| `make install` | Build + globally link `ratchet` (prints the installed branch + commit) |
| `make uninstall` | Remove the global `ratchet` link |
| `make reinstall` | `uninstall` then `install` |

These wrap the `link`/`unlink` package scripts plus a guarded `asdf reshim` (skipped automatically if you don't use asdf). Prefer no global install? After `pnpm build`, run directly with `node bin/ratchet.js …`.

## Quick start

```bash
cd your-project
ratchet init --tools claude          # scaffold .ratchet/ + agent skills/commands
```

Then tell your agent what to build: `/rct:propose <your idea>`. Or drive it by hand:

```bash
ratchet new change add-login                      # scaffold a change
# write features/auth/login.feature  (Gherkin)
# write plan.md                      (Why / What Changes / Design / Tasks)
ratchet validate add-login                        # check Gherkin + plan structure
ratchet status --change add-login                 # artifact completion + applyRequires
ratchet instructions apply --change add-login     # task list for implementation
# ...implement, check off tasks in plan.md...
ratchet archive add-login -y                      # sync features → store, archive change
```

## What `init` creates

```
.ratchet/
├── features/                 # permanent, living feature store (the spec)
├── standards/                # project guidelines, loaded by propose + verify (starts empty)
├── changes/
│   └── archive/              # completed changes land here, date-prefixed
└── config.yaml               # schema + project context/rules

.claude/                      # (per selected tool)
├── skills/ratchet-{propose,apply-change,verify-change,archive-change,propose-standard,propose-batch,apply-batch}/
└── commands/rct/{propose,apply,verify,archive,propose-standard,propose-batch,apply-batch}.md
```

The `core` profile installed by a stock `ratchet init` ships the change workflows **plus** the batch workflows (`propose-batch` + `apply-batch`). `eval` is the one opt-in workflow — request it with a custom profile.

**Supported tools** (`--tools`): `claude`, `opencode`, `cursor`, `github-copilot`, `codex`.

## Commands

| Command | Purpose |
|---|---|
| `init [path]` | Initialize ratchet + generate agent skills/commands |
| `update [path]` | Refresh generated skills/commands |
| `new change <name>` | Scaffold a new change directory |
| `validate [item]` | Validate a change's features + plan (`--all`, `--changes`, `--specs`) |
| `status --change <name>` | Artifact completion status + what apply requires (`--json`) |
| `instructions [artifact\|apply]` | Enriched, schema-driven guidance for an agent (`--json`) |
| `template <name>` | Print a canonical schema template (e.g. `standard`) so authoring follows the schema |
| `list` | List active changes (or `--specs` for the feature store) |
| `view` | Interactive dashboard of changes and features |
| `archive [name]` | Sync features into the store and archive the change |
| `new batch <name>` | Scaffold a batch manifest (`.ratchet/batches/<name>/batch.yaml`) |
| `batch status [name]` | Live phase/change status derived from disk, incl. parked gates/blockers (`--json`) |
| `batch view` / `batch list` | Rich dashboards of a batch (or all batches) |
| `batch config [name]` | Resolved batch settings: project defaults + manifest overrides + agent permissions |
| `batch apply [name]` | Advance the batch by **one** transition via the bundled engine (single-step) |
| `batch report [name]` | Record an agent answer / approval to cross a halt (`--change`, `--answer`) |
| `eval set` | List eval cases (one per Scenario) from `.feature` files (`--changes`, `--change <name>`, `--path`, `--json`) |
| `eval run` | Judge every bound case through the engine and persist a scored run (`--judge auto\|check\|agent`, `--json`) |
| `eval record` | Manually override one case's verdict in a run (`fail` requires `--evidence`) |
| `eval report --run <id>` | Scorecard, failing cases with evidence, and the baseline regression diff (`--json`) |
| `eval baseline <run-id>` | Promote a run to the baseline future runs are compared against |

## Batch orchestration

A **batch** ships a large objective as an ordered sequence of **phases**, where
each phase is a **vertical slice** — runnable software a user can exercise end to
end — gated by an **executable proof-of-work**. It's deliberately
**anti-waterfall**: only the current phase is decomposed into concrete change
intents; later phases stay as goal + proof, and their changes are created
**lazily** as the batch advances with real outcomes in hand.

```
batch.yaml
├── phase 1  goal · success · proofOfWork{kind,run,pass}     ← decomposed now
│     └── changes: DAG of { name, after: [...] }  ──▶ propose ▶ apply ▶ verify
├── phase 2  goal · success · proofOfWork (refined at entry) ← changes: lazy
└── phase 3  …
      ⮑ each phase boundary is a proof-of-work gate that unlocks the next
```

The manifest lives at `.ratchet/batches/<name>/batch.yaml` and **references
changes by name — it never owns them**; status is derived live from disk.
There's no new schema: a batch is intent you can revise before applying.

### The two batch workflows

| Workflow | Command | What it does |
|---|---|---|
| **propose-batch** | `/rct:propose-batch <objective>` | Guided, anti-waterfall authoring: explores the objective, slices it into ordered vertical-slice phases, **hard-gates** each phase on a success criterion + a proof-of-work (`integration` / `blackbox` / `llm-judge`), then scaffolds the manifest with a **shallow DAG** (only phase one decomposed). Its only artifact is the manifest — never change directories. Ends with a gated offer to chain into `/rct:propose` on phase one. |
| **apply-batch** | `/rct:apply-batch <name>` | Autonomous orchestrator that drives the batch to completion. It **loops** `ratchet batch apply` (which stays single-step) until done, surfacing halts (blocked / awaiting-approval) and proof-of-work failures to you, recording your answers via `ratchet batch report`, then resuming. The orchestrator does **no coding itself** — it only runs `ratchet` CLI commands and talks to you; the coding happens inside the engine-spawned agent. |

```
You: /rct:propose-batch ship a checkout flow
AI:  Sliced into 3 vertical-slice phases, each with a proof-of-work.
     ✓ .ratchet/batches/checkout-flow/batch.yaml
     Propose phase one's changes now, or defer to `ratchet batch apply`?

You: /rct:apply-batch checkout-flow
AI:  Driving batch: checkout-flow
     ✓ phase 1 · add-cart-model      proposed → applied → verified
     ✓ phase 1 · proof-of-work       PASS — unlocking phase 2
     ⏸ awaiting approval: phase 2 gate. Approve to continue?
```

### Single-step engine + the loop

`ratchet batch apply` advances **exactly one transition** (propose → apply →
verify for one ready DAG step) via a **bundled, in-process engine** — no separate
package, install, or activation. The continuous loop lives in the **apply-batch
skill**, not in the CLI. The engine appends to a resumable journal + run-state
behind a per-batch lock, and halts on gates and agent-raised blockers; default
gate is `voluntary` (`after-propose` / `every-phase` / `autonomous` are config
dials under `.ratchet/config.yaml` `batch:`, with manifest-level overrides).

The coding agent itself runs through a **SWE-ReX agent runtime** with live
output streaming, configurable to execute **locally**, in **Docker**, or on a
**remote** host — with pluggable adapters (claude / codex / gemini / cursor).

## Eval suite

`ratchet eval` turns the project's `.feature` files into a scored, reproducible,
baseline-diffed regression suite. The CLI is deterministic plumbing; **judging is
delegated to the bundled batch engine, run against fixtures** — never the live
working tree — so a scenario that passes today can't silently regress tomorrow.

```bash
ratchet eval set --json                 # one case per Scenario, with binding status
ratchet eval run --json                 # judge bound cases through the engine, persist a run
ratchet eval report --run <run-id> --json   # scorecard + baseline regression diff
ratchet eval baseline <run-id>          # promote a clean run as the baseline
```

**Cases & ids.** Each Scenario becomes one case with a stable id
`<feature-path-sans-ext>#<scenario-slug>` (e.g. `features/cli/status#status-as-json`;
duplicate scenario names in a file get an ordinal `-2`, `-3` suffix). Baseline
diffing keys on this id, so a renamed scenario surfaces as retired + new.

**Bindings (`.ratchet/evals/specs/*.yaml`).** A case is unjudged until an
eval-spec says how to judge it. Each binding maps a case id to a **fixture**
(a checked-in codebase under `.ratchet/evals/fixtures/<name>/`) and a judging kind:

```yaml
# .ratchet/evals/specs/status.yaml
features/cli/status#status-as-json:
  fixture: status-ok          # .ratchet/evals/fixtures/status-ok/
  kind: check                 # deterministic — preferred
  setup: pnpm install         # optional: runs ONCE into a cached working copy
  check:
    run: ratchet status --json
    pass: contains:applyRequires   # exit-zero | contains:<text> | regex:<pattern>

features/cli/status#status-as-text:
  fixture: verify-sample
  kind: agent                 # spawned-judge fallback for prose-y scenarios
  success: the status output is human-readable text
  agentVotes: 3               # N-of-M repeat votes; majority wins
```

**Fixtures run isolated.** Before judging, the fixture is materialized into a
throwaway temp working copy that becomes the judging cwd, so a check or agent may
build/run/mutate freely without touching the checked-in fixture or the host repo.
An optional `setup` bootstraps a fixture **once** into a copy cached by
fixture+setup and reused across every case bound to it.

**The agent judge is guarded.** It **fails closed on uncertainty** (no concrete
evidence ⇒ not a pass) and may cast **N-of-M votes** (`agentVotes`, default 1).
When votes disagree, the case is recorded `unjudged` — never silently `fail` — so
judge noise can't manufacture a regression. Prefer a deterministic `check`.

**Verdicts & baseline.** Each case is `pass`, `fail`, or `unjudged`. A regression
is a case that **passed in the baseline and fails now**; new/retired cases are
diffed, not failed. `unjudged` keeps a run incomplete and never counts as a pass.
The overall verdict fails while any regression or fail exists — so never promote a
run to baseline while a regression exists. Unbound cases (no fixture) can take a
manual verdict via `ratchet eval record` (a `fail` requires `--evidence`).

## Agent workflows (skills / `/rct:` commands)

| Workflow | What it does |
|---|---|
| **propose** | Clarifies intent (explore-first when unclear), then generates `features/` + `plan.md` |
| **apply** | Implements against each scenario's `Given/When/Then`, checking off plan tasks |
| **verify** | Confirms the implementation satisfies every scenario and all tasks are done |
| **archive** | Runs `ratchet archive` to ratchet features into the permanent store |
| **propose-standard** | Authors a new standard into `.ratchet/standards/` for propose + verify to apply |
| **propose-batch** | Slices an objective into ordered vertical-slice phases with per-phase proofs-of-work and writes a batch manifest (not change directories) |
| **apply-batch** | Autonomously drives a batch to completion — loops the single-step `ratchet batch apply`, surfaces halts/approvals + proof-of-work failures, records answers, resumes |
| **eval** | Runs the engine-backed eval, surfaces regressions first, and guides authoring bindings for unjudged cases |

> `explore` exists as an internal stance used by **propose** — it is not a standalone command. `propose-batch` + `apply-batch` ship in the default `core` profile; `eval` is opt-in.

## Development

```bash
pnpm build          # compile TypeScript → dist/
pnpm test           # run the vitest suite
pnpm test:coverage  # coverage report
pnpm lint           # eslint
pnpm dev            # tsc --watch
```

The CLI is built on `commander`, `@inquirer/prompts`, `zod`, `yaml`, `fast-glob`, `chalk`, and `ora`. The artifact graph is schema-driven (`schemas/ratchet/schema.yaml`); Gherkin is parsed by a hand-rolled parser in `src/core/parsers/`.

## Credits & license

ratchet is a fork of [OpenSpec](https://github.com/Fission-AI/OpenSpec) by Fission-AI. Licensed under MIT.
