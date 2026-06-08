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
├── skills/ratchet-{propose,apply-change,verify-change,archive-change,propose-standard}/
└── commands/rct/{propose,apply,verify,archive,propose-standard}.md
```

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

## Agent workflows (skills / `/rct:` commands)

| Workflow | What it does |
|---|---|
| **propose** | Clarifies intent (explore-first when unclear), then generates `features/` + `plan.md` |
| **apply** | Implements against each scenario's `Given/When/Then`, checking off plan tasks |
| **verify** | Confirms the implementation satisfies every scenario and all tasks are done |
| **archive** | Runs `ratchet archive` to ratchet features into the permanent store |
| **propose-standard** | Authors a new standard into `.ratchet/standards/` for propose + verify to apply |

> `explore` exists as an internal stance used by **propose** — it is not a standalone command.

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
