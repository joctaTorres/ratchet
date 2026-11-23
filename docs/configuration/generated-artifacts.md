---
title: Generated artifacts
sidebar_position: 2
---

# Generated artifacts

`ratchet init` and `ratchet init` re-runs (update mode) produce two categories of output: the `.ratchet/` directory tree that holds all planning and spec data, and per-tool skill and command files written under each selected AI tool's configuration directory.

## `.ratchet/` directory layout

`init` creates the following directories at the project root. `batches/` and `evals/` are created lazily by the commands that need them.

```
.ratchet/
├── features/               # permanent, living feature store
├── standards/              # project standards library (empty at init)
├── changes/
│   └── archive/            # completed changes, date-prefixed
├── batches/                # batch manifests (created lazily by ratchet new batch)
├── evals/
│   ├── specs/              # eval-spec YAML bindings (opt-in)
│   └── fixtures/           # checked-in fixture codebases (opt-in)
└── config.yaml             # project config (schema + optional context/rules)
```

`init` also ensures the project-root `.gitignore` ignores the transient eval
run-records directory (see the table below).

| Path | Description |
|---|---|
| `features/` | Permanent Gherkin feature store. `ratchet archive` copies a change's `.feature` files here by whole-file replacement. Organized by capability: `features/<capability>/<name>.feature`. |
| `standards/` | Project-level guideline documents. Created empty by `init`; populated by `/rct:propose-standard`. Each file is a Markdown document with an optional `tag:` frontmatter field. |
| `changes/` | Active change directories. Each subdirectory is one change (`changes/<name>/`). |
| `changes/archive/` | Completed changes moved here by `ratchet archive`. Directory name is `YYYY-MM-DD-<name>`. |
| `batches/` | Batch manifests. Each batch is `batches/<name>/batch.yaml`. Created when `ratchet new batch` first runs, not by `init`. |
| `evals/specs/` | YAML eval-spec files. Each file maps case IDs to judge bindings (`fixture`, `kind`, `check` or `success`). Read by `ratchet eval`. |
| `evals/fixtures/` | Checked-in fixture codebases. Each fixture is a directory (`evals/fixtures/<name>/`) that eval materializes into a throwaway working copy before judging. |
| `config.yaml` | Project configuration. Contains at minimum `schema: ratchet`. May include `batch.permissions` for agent sandbox policy. Created by `init` when it does not already exist; never overwritten on re-runs. |
| `.gitignore` (project root) | `init` idempotently ensures the project-root `.gitignore` contains `.ratchet/evals/runs/`, so transient eval run records never dirty the working tree or the mutation invariant gate. The file is created if absent and the entry appended only if missing; a re-run never duplicates it. |

## Per-tool skills and commands

For each AI tool selected during `init`, ratchet writes two kinds of generated files: **skills** (agent skill markdown files under the tool's `skills/` directory) and **commands** (slash-command or prompt files in the tool's command directory). Both are fully regenerated on every `init` re-run.

Skill and command bodies are rendered from shared tool-agnostic templates: every tool receives the same body text, and only the file path and frontmatter format vary by tool. Rendered bodies are agent-neutral. A reference to an agent-specific capability appears only in the capability-plus-fallback form — the capability, optionally illustrated with one tool's name, qualified with "if your agent has one", and paired with an "otherwise …" plain-prose fallback — never as a bare agent-specific tool name. A reference to another ratchet workflow uses the canonical `/rct:<name>` invocation form.

### Skill files

Each skill is a `SKILL.md` file inside a named subdirectory under `<tool-dir>/skills/`. The file contains a YAML frontmatter block followed by the skill instructions.

Frontmatter fields written by ratchet:

| Field | Value |
|---|---|
| `name` | Skill name (e.g. `ratchet-propose`) |
| `description` | One-sentence description of the skill |
| `license` | `MIT` |
| `compatibility` | Requires ratchet CLI. |
| `metadata.author` | `ratchet` |
| `metadata.version` | `1.0` |
| `metadata.generatedBy` | Installed ratchet version (e.g. `0.9.0`) |

### Command files

Each command is a Markdown file with YAML frontmatter. The file path and frontmatter format vary by tool; the body content is the same workflow instruction.

### Tool paths

| Tool | `skillsDir` | Skill path pattern | Command path pattern |
|---|---|---|---|
| Claude Code | `.claude` | `.claude/skills/<dir>/SKILL.md` | `.claude/commands/rct/<id>.md` |
| Cursor | `.cursor` | `.cursor/skills/<dir>/SKILL.md` | `.cursor/commands/rct-<id>.md` |
| Codex | `.codex` | `.codex/skills/<dir>/SKILL.md` | `~/.codex/prompts/rct-<id>.md` (global; respects `CODEX_HOME`) |
| Gemini | `.gemini` | `.gemini/skills/<dir>/SKILL.md` | `.gemini/commands/rct-<id>.md` |
| GitHub Copilot | `.github` | `.github/skills/<dir>/SKILL.md` | `.github/prompts/rct-<id>.prompt.md` |
| OpenCode | `.opencode` | `.opencode/skills/<dir>/SKILL.md` | `.opencode/commands/rct-<id>.md` |

### Workflows: core profile vs. eval opt-in

The `core` profile (the default) installs eleven workflows. The `eval` workflow is opt-in and only installed when a `custom` profile explicitly lists it.

**Core profile workflows** (installed by `ratchet init` by default):

| Workflow ID | Skill directory | `/rct:` command |
|---|---|---|
| `propose` | `ratchet-propose` | `propose` |
| `apply` | `ratchet-apply-change` | `apply` |
| `verify` | `ratchet-verify-change` | `verify` |
| `archive` | `ratchet-archive-change` | `archive` |
| `propose-standard` | `ratchet-propose-standard` | `propose-standard` |
| `brainstorm` | `ratchet-brainstorm` | `brainstorm` |
| `apply-batch` | `ratchet-apply-batch` | `apply-batch` |
| `archive-batch` | `ratchet-archive-batch` | `archive-batch` |
| `propose-batch` | `ratchet-propose-batch` | `propose-batch` |
| `decompose-phase` | `ratchet-decompose-phase` | `decompose-phase` |
| `open-pr` | `ratchet-open-pr` | `open-pr` |

The `open-pr` command is also the artifact the batch engine renders into the spawn
locus for the whole-batch PR step: at batch completion the engine spawns a PR agent
that delegates to `/rct:open-pr` to commit the accumulated work in the repo's
`git log` commit style, run the project's own discovered test command fresh on the
committed tree, push only a green tree — never force-pushing, and stopping and
reporting on a rejected push — and open exactly one forge-agnostic PR
to its base branch. Like every command it is generated for every tool above at the
tool's command path (e.g. claude `.claude/commands/rct/open-pr.md`, cursor
`.cursor/commands/rct-open-pr.md`).

The `decompose-phase` command is also the artifact the batch engine renders into
the spawn locus when `batch apply` drives a phase decomposition (it delegates to
`/rct:decompose-phase <phase>` to author a reachable empty phase's change intents
into `batch.yaml`). The decomposition spawn routes through the `decompose` agent
stage — so `agent.decompose` (or a scalar `agent`) selects which agent runs it,
exactly as the `pr` stage selects the PR agent. Like every command it is
generated for every tool above at the tool's command path (e.g. claude
`.claude/commands/rct/decompose-phase.md`, cursor
`.cursor/commands/rct-decompose-phase.md`).

**Opt-in workflow** (custom profile only):

| Workflow ID | Skill directory | `/rct:` command |
|---|---|---|
| `eval` | `ratchet-eval` | `eval` |

The active profile is read from the global ratchet config. Pass `--profile core` or `--profile custom` to `ratchet init` to override it for that run.

### Scope reconciliation in the change-authoring workflows

The `propose`, `propose-batch`, and `decompose-phase` workflows carry a shared set of
scope-reconciliation rules. The rules are authored once in
`src/core/templates/workflows/scope-reconciliation.ts` and interpolated into each
workflow body, so every generated skill and command for every tool in the table above
renders the same text.

#### Overview

```mermaid
flowchart TD
    A[📝 Authoring run starts<br/>propose · propose-batch]
    B{🔍 Work originates<br/>from a tracked issue?}
    C[🌐 Fetch each issue<br/>through the project's tracker]
    D[📋 Enumerate material requirements<br/>explicit fix items · narrative problems]
    W[✍️ Author the artifacts]
    E[🔗 Map each requirement to the authored scope<br/>feature scenario · plan task · manifest field]
    F{❓ Any requirement<br/>uncovered?}
    G[👤 Surface as an enumerated decision point<br/>issue asks X · this proposal omits X]
    H{🔐 Security · permission ·<br/>integrity relevant?}
    I[🛑 Stop and surface<br/>halt the run · ask the user]
    J[👤 User decides]
    K[📌 Approved deferral needs a filed<br/>tracking issue · named owner · linked from the plan]
    Z[✅ Artifacts called done]
    L{🏷️ All material requirements<br/>implemented?}
    M[✅ A closing claim may be made<br/>at pull-request-authoring time]
    N[⚠️ Say partially addresses<br/>never a closing claim]

    A --> B
    B -- no --> W
    B -- yes --> C
    C --> D
    D --> W
    W --> E
    E --> F
    F -- no --> Z
    F -- yes --> G
    G --> H
    H -- yes --> I
    H -- no --> J
    I --> K
    K --> Z
    J --> Z
    Z --> L
    L -- yes --> M
    L -- no --> N

    classDef entry fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    classDef step  fill:#E6E6FA,stroke:#333,stroke-width:2px,color:darkblue
    classDef gate  fill:#FFD700,stroke:#333,stroke-width:2px,color:black
    classDef halt  fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:black
    classDef done  fill:#ADD8E6,stroke:#333,stroke-width:2px,color:darkblue

    class A entry
    class C,D,W,E,G,J,K step
    class B,F,H,L gate
    class I,N halt
    class Z,M done
```

#### Originating-issue reconciliation

`propose` and `propose-batch` reconcile against every originating issue in two phases,
each at the moment it can actually happen. Requirements can only be enumerated before
the artifacts are authored, and they can only be mapped to authored scope afterwards,
so the procedure is split in two and each workflow embeds each half where it applies:

| Workflow | Before authoring: identify · fetch · enumerate | After authoring: map · list · surface |
|---|---|---|
| `propose` | Step 2, before `ratchet new change` creates the change directory. | Step 6, after the artifact loop and before the final status. The targets are feature scenarios and plan tasks. |
| `propose-batch` | Step 2, before the phases are sliced and the manifest is drafted. | Step 5, after the phases and their success criteria are drafted and before `ratchet new batch` scaffolds the manifest. The targets are each phase `goal`, each phase `success` criterion, and each change-level `done`. |

The two halves require:

| Sub-step | Phase | Requirement |
|---|---|---|
| Identify | Before | Collect every originating issue — referenced by the user, by a manifest phase or change intent, or by an injected `done` criterion. |
| Fetch | Before | Read each issue through the project's issue tracker. `gh issue view <n>` is named as a GitHub example; no tracker or command is required. When no tracker client is available, the user is asked to paste the issue text. |
| Enumerate | Before | List the issue's material requirements from both its explicit fix items and the problems named in its narrative. Hedged wording (`consider`, `maybe`, `optionally`) does not lower the bar for a security-, permission-, or integrity-relevant requirement. |
| Map | After | Point every enumerated requirement at the part of the authored scope that covers it. Each workflow names its targets in the step that embeds this half. |
| List | After | Write out every requirement the authored scope does not cover. |
| Surface | After | Present each uncovered requirement to the user as an enumerated `"issue asks X, this proposal does not include X"` decision point before the artifacts are called done. Writing an omission into plan prose as self-approval is prohibited. |

The fetch and enumerate sub-steps are one shared text. `decompose-phase` embeds the
same text in its earned-close check (see below), so the hedged-wording rule applies at
the phase boundary exactly as it does at proposal time.

#### Close-claim rules

A `Fixes #N` / `Closes #N` claim — in a batch manifest `done`, in a plan, or in a
pull-request body — is permitted only when the issue's material requirements are
actually implemented. A close-claim is an output of verification, never an input of
planning. Work covering only part of an issue states `"partially addresses #N"` and
does not state `Fixes #N` or `Closes #N`.

`propose-batch` applies this to the manifest specifically: `Closes #N` / `Fixes #N`
must not be hard-coded into a phase `goal`, a phase `success` criterion, or a
change-level `done` for work not yet scoped and verified. Phase contracts reference an
issue as `"targets #N"` or `"addresses #N"`; the closing linkage is earned at
pull-request-authoring time.

#### Stop-and-surface guardrail

All three workflows carry the guardrail in their **Guardrails** section. A de-scope of
security-, permission-, or integrity-relevant work halts the workflow and asks the
user rather than proceeding on momentum. An approved deferral requires a tracking
issue that is explicitly filed, carries a named owner, and is linked from the change
plan before the workflow proceeds; a prose bullet in `plan.md` is not a deferral
mechanism.

#### Deferral carry-forward in `decompose-phase`

`decompose-phase` grounds a phase in the prior phases' shipped results. Its grounding
step (step 1) additionally requires:

- Reading each prior phase's shipped change `plan.md`, not only the injected `done`
  criteria. The injected criteria are a paraphrase in which deferrals recorded as plan
  prose are invisible.
- Extracting every `## Out of scope`, `deferred`, `revisit`, `later phase`,
  `follow-up`, or equivalent item recorded in those plans.
- Resolving each extracted item as exactly one of three outcomes: **carried forward**
  as a change intent in the phase being decomposed, **tracked** against an existing
  open tracking issue, or **explicitly dropped** by the user. Silently ignoring an
  extracted item is not an available outcome. For a security-, permission-, or
  integrity-relevant item, **tracked** has the same bar as the stop-and-surface
  guardrail: the tracking issue must be filed, open, have a named owner, and be linked
  from the change plan. An open issue with no owner does not track such an item, and
  the item is surfaced to the user instead. Other items only need an existing open
  tracking issue.

Its own step 2, before the phase is sliced, verifies that each prior phase's
`Fixes #N` / `Closes #N` claim was earned before the issue is treated as shipped. It
fetches and enumerates the issue with the same shared text `propose` and
`propose-batch` use, including the hedged-wording rule, and compares the requirements
against what the prior phase's `done` and `plan.md` describe as implemented. An
unearned claim is surfaced and its remaining scope carried forward, never inherited as
fact.


### Scenario-loss accept flow in the archive workflow

The `archive` workflow (the `ratchet-archive-change` skill and the `/rct:archive`
command, rendered from one shared body for every tool in the table above) runs
`ratchet archive` so the CLI's scenario-loss guard engages, and routes a refusal
through the user instead of approving it on the agent's own initiative.

#### Overview

```mermaid
flowchart TD
    A[📦 First archive attempt<br/>ratchet archive — no -y · never the flag]
    B{🛡️ Scenario-loss guard<br/>trips?}
    C[✅ Archive proceeds<br/>store updated · change moved]
    D[❌ Refusal — non-zero exit<br/>lists each lost scenario per store file]
    E[🗣️ Name each lost scenario and<br/>its store file exactly as listed]
    F[👤 Ask whether the removal is intentional<br/>structured question · otherwise plain prose]
    G{✅ User explicitly confirms<br/>the removal is intentional?}
    H[🔁 Retry with --accept-removed-scenarios<br/>only on that explicit approval]
    I[🪦 Whole-file removal route<br/>features/.deleted tombstone · plain re-run · no flag]
    J[🛠️ Restore the missing scenarios<br/>plain re-run]

    A --> B
    B -- no --> C
    B -- yes --> D
    D --> E
    E --> F
    F --> G
    G -- yes --> H
    G -- whole file goes --> I
    G -- no --> J

    classDef entry fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    classDef step  fill:#E6E6FA,stroke:#333,stroke-width:2px,color:darkblue
    classDef gate  fill:#FFD700,stroke:#333,stroke-width:2px,color:black
    classDef halt  fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:black
    classDef done  fill:#ADD8E6,stroke:#333,stroke-width:2px,color:darkblue

    class A entry
    class E,F,H,I,J step
    class B,G gate
    class D halt
    class C done
```

The first archive attempt runs `ratchet archive "<name>"` without `-y` and never
with `--accept-removed-scenarios`, so the CLI's own confirmations and the
scenario-loss guard surface to the user instead of being pre-approved. When the
guard refuses — a non-zero exit printing `Refusing to apply features: N store
scenario(s) would be lost.` followed by each store file and its lost scenario
names — the workflow body directs the agent to:

1. Name each lost scenario and its store file back to the user exactly as the
   refusal lists them.
2. Ask the user whether the removal is intentional, using a structured-question
   capability if the agent has one and plain prose otherwise.
3. Retry `ratchet archive "<name>" --accept-removed-scenarios` only after the
   user explicitly confirms the removal is intentional — never on the agent's
   own initiative and never on the first attempt.

For an intentional whole-file removal, the `features/.deleted` tombstone is the
route: the store-relative path is listed there and plain `ratchet archive` is
re-run with no flag. Otherwise the missing scenarios are restored into the
change's feature file and plain `ratchet archive` is re-run.

### Store-seeded feature authoring in the propose workflow

The `propose` workflow (the `ratchet-propose` skill and the `/rct:propose`
command, rendered from one shared body for every tool in the table above) seeds
each feature file from the feature store, so a scenario the store already holds
is preserved by construction instead of being dropped by a from-scratch draft
that the archive guard then has to refuse.

#### Overview

```mermaid
flowchart TD
    A[📝 Propose authors a features artifact<br/>one feature file at a time]
    B[📖 Read the capability's existing store files<br/>under the feature store]
    C{💾 A store file already exists at<br/>the file's store-relative path?}
    D[📋 Start from that store file<br/>copy it into the change · edit the copy<br/>never author from scratch]
    E[✍️ Author the feature file new<br/>only when the store has no file at that path]
    F[🚫 Never add a scenario that already exists<br/>in another store file of the capability]
    G[✅ Archive guard passes<br/>store scenarios preserved by construction]

    A --> B
    B --> C
    C -- yes --> D
    C -- no --> E
    D --> F
    E --> F
    F --> G

    classDef entry fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
    classDef step  fill:#E6E6FA,stroke:#333,stroke-width:2px,color:darkblue
    classDef gate  fill:#FFD700,stroke:#333,stroke-width:2px,color:black
    classDef done  fill:#ADD8E6,stroke:#333,stroke-width:2px,color:darkblue

    class A entry
    class B,D,E,F step
    class C gate
    class G done
```

In the artifact-creation loop, before authoring each feature file of a
`features` artifact, the workflow body directs the agent to:

1. Read the capability's existing store files under
   `.ratchet/features/<capability>/`, and never add a scenario that already
   exists in another store file of the capability.
2. When a store file already exists at the file's store-relative path, start
   the feature file from that store file — copy it into the change and edit
   the copy, never author it from scratch — so existing store scenarios are
   preserved by construction.
3. Author a feature file new only when the store has no file at that path (a
   fresh capability or a new file in an existing one).

The `features` artifact instruction in the ratchet schema — the payload
`ratchet instructions features` surfaces — carries the same rule in one line:
when `.ratchet/features/<capability>/<name>.feature` already exists at the
target path, start from that store file (copy it into the change, keep its
scenarios, then edit) and never recreate it from scratch; the
one-file-per-scenario-set layout guidance is unchanged otherwise.

### Payload-conditional spike guidance in the brainstorm workflow

The `brainstorm` workflow (the `ratchet-brainstorm` skill and the
`/rct:brainstorm` command, rendered from one shared body for every tool in the
table above) carries a payload-conditional spike-guidance block: a spike is an
opt-in, throwaway experiment the body surfaces only when the project's
resolved payload enables it, and the body never mentions spikes otherwise.

At invocation time the agent runs `ratchet instructions brainstorm --json` and
reads `spikes.enabled` from the payload as data — it never reads
`.ratchet/config.yaml` directly. The payload is the single seam: the CLI
resolves the `brainstorm.spikes` key (see
[`brainstorm:` settings](config-yaml.md#brainstorm-settings)) into
`spikes.enabled` — `true` only when the config carries
`brainstorm.spikes: true`, and `false` on an absent section, an absent config,
no ratchet root, or any internal failure. The command always exits zero (see
[`ratchet instructions`](../commands/instructions.md#brainstorm-payload-brainstorm-argument)),
so an unavailable payload resolves to `false`.

Only when `spikes.enabled` is `true`, and an approach question is genuinely
uncertain, the agent may offer a spike. The guidance pins four rules:

- **User-approved.** The offer names what the spike would prove, and no spike
  work begins before the user's explicit approval.
- **Throwaway.** A spike is discarded once it has answered its question.
- **Outside the tracked tree.** A spike is built in a scratch location outside
  the project's tracked tree.
- **Keeping routes through propose.** Keeping anything from a spike routes as
  a new `/rct:propose` request; spike output is never merged into the project
  directly.

When `spikes.enabled` is `false` or the payload is unavailable, the agent
never mentions spikes.

## Change directory artifacts

`ratchet new change <name>` scaffolds a change directory at `.ratchet/changes/<name>/`. The propose workflow writes the two required artifacts into it.

```
.ratchet/changes/<name>/
├── features/
│   └── <capability>/
│       └── <name>.feature      # Gherkin: Feature / Scenario / Given-When-Then
├── plan.md                     # ## Why / ## What Changes / ## Non-goals / ## Design / ## Tasks
├── .ratchet.yaml               # change metadata
└── .run/
    ├── journal.jsonl           # append-only engine run log
    └── state.json              # current change state snapshot
```

### `features/<capability>/<name>.feature`

Gherkin feature file. One or more files may exist under `features/` grouped by capability. Each scenario must contain at least one `Given`, one `When`, and one `Then` step. The `features/` directory may also contain a `.deleted` tombstone file listing store-relative paths to remove from the permanent feature store on archive (one path per line; blank lines and `#`-prefixed lines are ignored).

### `plan.md`

Plan document with five required top-level sections:

| Section | Purpose |
|---|---|
| `## Why` | Motivation and problem statement |
| `## What Changes` | Scope description |
| `## Non-goals` | What the change deliberately will not do; each entry traces to a user, issue, or brainstorm decision — never an agent self-approved omission — with an explicit one-liner when nothing was ruled out |
| `## Design` | Technical design, with a `### Approaches considered` subsection naming the approaches weighed ("one sensible way" allowed when there is genuinely one sensible approach); active standards are embedded here by propose |
| `## Tasks` | Markdown checklist (`- [ ]`) tracked by the apply phase |

### `.ratchet.yaml`

Change metadata file. Fields:

| Field | Type | Description |
|---|---|---|
| `schema` | string (required) | Workflow schema name (e.g. `ratchet`) |
| `created` | string (`YYYY-MM-DD`) | Date the change was created |
| `standards` | string array | Tags of standards this change follows (e.g. `[security, testing]`) |

### `.run/` (change-local run state)

`journal.jsonl` and `state.json` hold the engine run state for the change when it is driven by a headless verb (`ratchet propose`, `ratchet apply`, `ratchet verify`). When a change is driven inside a batch, run state is written at `.ratchet/batches/<batch>/run/` instead. See [Run-state locus](../engine/run-state.md).

## Standards model

Each standard is a Markdown file at `.ratchet/standards/<name>.md` with an optional YAML frontmatter block.

Frontmatter field:

| Field | Description |
|---|---|
| `tag` | Stable identifier for the standard. Falls back to the file-name stem when absent. Changes and features reference standards by tag, not by file name. |

Example:

```markdown
---
tag: security
---

# Security standard

...
```

### Bidirectional links materialized on archive

When `ratchet archive` runs and the change declares one or more standard tags in its `.ratchet.yaml`, two link structures are written into the permanent store:

**Forward links — per-capability sidecar**

`.ratchet/features/<capability>/.ratchet.yaml` maps each feature file within that capability to the standard tags the contributing change declared. The sidecar YAML structure:

```yaml
features:
  <feature-file-relative-to-capability>:
    - <tag>
    - <tag>
```

Tombstoned features (listed in `features/.deleted`) have their entries removed from the sidecar on the same archive run.

**Reverse links — `## Implemented by` block**

Each `.ratchet/standards/<tag>.md` that has at least one implementing feature receives a generated `## Implemented by` section appended by ratchet. The block lists the store-relative paths of all feature files that implement the standard. It is regenerated from the forward sidecars on every archive run — ratchet never appends to it incrementally. Standards with no implementing features have the block removed or never gain one.

The block is delimited by an HTML comment marker so ratchet can locate and replace it idempotently:

```markdown
## Implemented by

<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->

- <capability>/<name>.feature
```
