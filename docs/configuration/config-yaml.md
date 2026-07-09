---
title: config.yaml
sidebar_position: 1
---

# `config.yaml`

`.ratchet/config.yaml` (also accepted as `.ratchet/config.yml`) is the project-level
configuration file for Ratchet. It is read on every command and validated
field-by-field; an invalid field emits a warning and is ignored rather than aborting
the command. The file is YAML; all keys are optional unless noted.

Effective batch settings resolve across four scopes in increasing precedence:
built-in default ← user/global config ← `.ratchet/config.yaml` ← per-change manifest.

---

## Top-level keys

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| `schema` | string | yes | — | Workflow schema to use. Must be a non-empty string matching a built-in schema name (e.g. `ratchet`) or a project-local schema name. |
| `context` | string | no | — | Free-text project context injected verbatim into every artifact instruction. Maximum 50 KB (UTF-8 bytes); larger values are ignored with a warning. |
| `rules` | map | no | — | Per-artifact additive rules. Keys are artifact IDs from the active schema; values are arrays of rule strings. Unknown artifact IDs produce a warning. |
| `batch` | object | no | — | Project-level defaults for batch orchestration. All sub-keys are optional; absent keys inherit the built-in default. See [`batch:` settings](#batch-settings). |
| `eval` | object | no | — | Project-level defaults for eval orchestration. See [`eval:` settings](#eval-settings). |

### `rules` structure

```yaml
rules:
  features:
    - "Keep scenarios atomic: one behavior per scenario."
  plan:
    - "Tasks must reference the feature file that requires them."
```

Keys must match artifact IDs defined in the active schema. For the built-in `ratchet`
schema the valid IDs are `features` and `plan`.

---

## `batch:` settings

Project-level defaults for the batch engine. Per-manifest overrides take precedence
over these values; both are overridden by flags passed to individual commands.

Scalar settings (all keys except `permissions`) are nearest-wins across scopes.

### Invalid batch key load behavior

The `batch:` section is parsed **per-key** (resilient): each present key is
validated independently, so a malformed key (e.g. `agent: "claude:"`) is
dropped with a warning naming the key path (`batch.agent`, or
`batch.agent.apply` for a malformed per-stage map entry) and the offending
value, while valid sibling settings (e.g. `gate`, `locus`, `permissions`) are
preserved instead of being silently reverted to defaults. The secret
`authToken` is never echoed — its warning names the key only. A fully valid
section loads warning-free and value-identical. Unknown keys are ignored
(the schema is `.partial()`, not `.strict()`).

### Gate and orchestration

| Key | Type | Default | Accepted values | Description |
|---|---|---|---|---|
| `gate` | string | `voluntary` | `voluntary` `after-propose` `every-phase` `autonomous` | Controls when the batch engine pauses for human approval between phases. `voluntary` never interrupts; `after-propose` gates after the propose phase; `every-phase` gates after every phase; `autonomous` runs all phases without interruption. |
| `strategy` | string | `vertical-slice` | `vertical-slice` `feature` | Slice strategy used when the batch manifest is generated. |
| `proofOfWork` | string | `hard-gate` | `hard-gate` `warn` | What happens when an agent does not produce required proof-of-work. `hard-gate` blocks the phase; `warn` logs a warning and continues. |
| `prGrouping` | string | `off` | `off` `whole-batch` `per-phase` `per-change` | Whether a completed batch opens a pull request, and how work is grouped into PRs. `off` opens no PR (behavior unchanged). `whole-batch` groups the whole batch's work into a single PR opened by a dedicated `pr`-stage agent at completion. `per-phase` opens one stacked PR per completed phase and `per-change` one stacked PR per change — `batch apply` drives one stacked PR per group boundary, one group per apply in boundary order, idempotently per group (group 0 targets the batch base branch, group N targets group N-1's branch). |

### Execution locus

| Key | Type | Default | Accepted values | Description |
|---|---|---|---|---|
| `locus` | string | `local` | `local` `docker` `remote` | Where the agent runs. `local` drives the in-process ReX sidecar. `docker` runs the step inside a container via ReX `DockerDeployment` with the project root bind-mounted. `remote` drives a `swerex-remote` server over its REST API. |
| `agent` | string \| map | — | an `agent[:model]` spec, or a `{propose, apply, verify, pr, decompose}` stage-map of spec values | Coding agent(s) to spawn. A scalar spec applies to every lifecycle stage; a partial per-stage map assigns a spec to each stage (see [Per-stage agent map](#per-stage-agent-map)). Each spec is an agent name optionally followed by `:model` (e.g. `claude`, `claude:fable`, `opencode:zai/glm-5.2`) — see [Agent `[:model]` spec](#agent-model-spec). When unset, the engine uses the agent configured at init time. |
| `image` | string | — | free-form | Container image reference for `locus: docker`. Must be non-empty when set. When unset and `locus` is `docker`, the runtime falls back to `python:3.12`. |

#### Per-stage agent map

`agent` accepts **either** a single agent name **or** a map that names a coding
agent per lifecycle stage — `propose`, `apply`, `verify`, `pr` (the
whole-batch PR-opening stage, spawned only when [`prGrouping`](#gate-and-orchestration)
is active), and `decompose` (the phase-decomposition stage, spawned when a batch
has a reachable empty phase to author into `batch.yaml`):

```yaml
batch:
  agent:
    propose: claude
    apply: opencode
    verify: opencode
    decompose: claude
```

Each lifecycle transition spawns the agent its stage maps to — so the example
above has `claude` propose and decompose while `opencode` applies and verifies.
The map is **partial**: any subset of the five stages may be given. Stage
resolution falls back in order **mapped stage → scalar → default agent**: a stage
the map names uses that agent; a stage it omits uses a scalar `agent` if one is
in effect, otherwise the init-time default. A scalar name is therefore
equivalent to naming the same agent for every stage, and an unset `agent` keeps
the init-time default for every stage — both behave exactly as before. An
unmapped `decompose` (or `pr`) falls to the default agent with no model flag, so
a config that does not name `decompose` behaves byte-for-byte as before.

**Cross-scope merge (nearest-wins per stage).** When `agent` is set at more than
one scope (project config `batch:` ← manifest `settings:`), the values merge one
stage at a time rather than replacing wholesale:

- a **partial stage-map** merges over a lower scope per stage — each stage it
  names wins for that stage, while stages it omits keep the lower scope's agent
  (a lower scalar covers all of them);
- a **nearer scalar** covers every stage, so it replaces a farther map entirely.

For example, a project-config scalar `claude` with a manifest map `{ apply:
opencode }` routes `apply` to `opencode` and both `propose` and `verify` to
`claude`; a project-config map `{ propose: claude, apply: claude }` under a
manifest map `{ apply: opencode }` routes `propose` to `claude`, `apply` to
`opencode`, and the unmapped `verify` to the default.

Resolution records, per stage, which scope (project config vs manifest)
supplied that stage's resolved `agent[:model]` spec — so a model-rejection
failure can be attributed to the scope that supplied the model. A stage
attributed to `project` carried the project config's spec; a stage attributed
to `manifest` carried the manifest's; a stage no scope supplied (the default
agent) carries no attribution. The resolved value and merge results are
unchanged by this attribution. This per-stage scope is what the engine's
model-failure hint names: when a transition whose spec explicitly named a
model fails fast (non-zero exit, no journal progress), the surfaced failure
names the stage, agent, exact model string, and the supplying scope above the
stderr tail — so the operator can correct the `agent` setting at that scope
rather than reverse-engineer the merge.

The same shape is validated at both the project-config `batch:` scope and a batch
manifest's `settings:` scope. Validation rejects an **unknown stage key** (any key
other than `propose`, `apply`, `verify`, `pr`, or `decompose`), a **non-string agent value**,
and a **malformed `agent[:model]` spec** (empty agent part or empty model part,
e.g. `claude:`, `:fable`, `:`) — naming the offending value — at config load,
before any agent is spawned; an **unknown agent name** (scalar or mapped) is
rejected — naming the available adapters — before that stage's agent is spawned.

#### Agent `[:model]` spec

Every string value of the `agent` setting — the scalar form and each stage-map
value, at both the project-config `batch:` scope and the manifest `settings:`
scope — is an `agent[:model]` spec: an agent name, optionally followed by a
model after the first `:`.

```yaml
batch:
  agent:
    propose: claude:fable
    apply: opencode:zai/glm-5.2
    verify: opencode:qwen/qwen-3.7
```

The spec splits on the **first** `:` only, so a model id that itself contains a
colon or slash passes through intact (e.g. `opencode:zai/glm-5.2` → agent
`opencode`, model `zai/glm-5.2`; `codex:vendor:tagged-1` → agent `codex`, model
`vendor:tagged-1`). A bare agent name (no `:`) carries no model — the spawned
agent uses its harness-configured default model, and existing bare-name configs
validate byte-for-byte unchanged.

The model part is free-form pass-through: the parser keeps no model registry and
never consults the adapter registry. Whether the agent part names a **known**
agent stays a resolution/spawn-time concern (`UnknownAgentError` in
`resolveAdapter`, before any spawn). A spec with an **empty agent part**
(`:fable`, `:`) or **empty model part** (`claude:`, `:`) is rejected at config
load with a message naming the offending value, e.g. `Invalid agent spec
":fable": empty agent part (expected "agent[:model]")`.

A spec whose agent part or model part has **leading or trailing whitespace**
is likewise rejected at config load, naming the offending value and which part
is at fault — e.g. `Invalid agent spec "claude: opus": model part " opus" has
leading or trailing whitespace (expected "agent[:model]")` (and `" claude"`,
`"claude "`, `"claude :m"`, `"claude: "` the same way). The parser rejects
rather than auto-trims: silently trimming `"claude: opus"` would repair the
value but hide the config defect. A model part **starting with `-`** is also
rejected — e.g. `Invalid agent spec "claude:-flag": model part "-flag" must
not start with "-" (expected "agent[:model]")` — so a flag-shaped token like
`claude:--dangerously-skip-permissions` never rides into a spawned agent's argv
as an option. Interior dashes stay valid (`codex:gpt-5.2-codex`), as do models
containing `/` or `:`.

The schema validates but does not transform: stored values remain whole spec
strings, so the cross-scope nearest-wins per-stage merge moves agent and model
**atomically** — a nearer `apply: opencode:zai/glm-5.2` replaces a farther
`apply` agent and model together, never one without the other.

When the engine spawns an agent for a transition, it parses the resolved spec
once and threads the model part to that agent's adapter via the request context.
Each adapter declares its own model flag — claude, opencode, and cursor use
`--model`; codex and gemini use `-m` — and the adapter appends `[flag, model]`
to the spawn argv **only when a model is named**. A bare agent name (no `:`
model part) emits no model flag, so the agent runs its harness-configured default
model and the spawn argv is byte-for-byte identical to a config with no model
named. The model pair sits between the agent's base argv and any permission
flags, so the base argv shape and the trailing permission block are preserved.

### Agent timeout

Applies to every locus (`local`, `docker`, `remote`) and every coding agent.

| Key | Type | Default | Accepted values | Description |
|---|---|---|---|---|
| `agentTimeoutMs` | number | `600000` | positive integer (ms) | Per-agent ReX timeout in milliseconds — the guard against a hung agent. When unset, the runtime applies its built-in default of `600000` (10 minutes). Raise it when a slow-but-passing transition (e.g. a full-suite coverage proof-of-work) is being killed at the default. |

The `RATCHET_AGENT_TIMEOUT_MS` environment variable overrides this key. It must
parse to a positive integer; a zero, negative, non-numeric, or empty value is
ignored (a typo never shortens or removes the guard) and resolution falls
through to the config key, then to the built-in default. The effective timeout
resolves with precedence **env > manifest > project config > built-in default**.

```bash
# Raise the per-agent timeout to 30 minutes for one run, overriding any config key.
RATCHET_AGENT_TIMEOUT_MS=1800000 ratchet batch run
```

### Remote-locus settings

These keys are required when `locus: remote` and ignored for `local` and `docker`.

| Key | Type | Default | Description |
|---|---|---|---|
| `host` | string | — | Hostname (or `scheme://host`) of the `swerex-remote` server. A bare host resolves to `http` for loopback addresses and `https` for all others. An explicit `http://` to a non-local host is rejected unless `insecure: true` is set. |
| `port` | number | — | Port of the `swerex-remote` server. Must be a positive integer. |
| `authToken` | string | — | Secret sent as the `X-API-Key` header to the `swerex-remote` server. Redacted in all `ratchet batch config` output. |
| `insecure` | boolean | `false` | Opt-in to send `authToken` over plaintext `http://` to a non-local host. Has no effect on loopback hosts, which always allow plaintext. |

### `batch.permissions` object

Agent-agnostic permission policy. Merged across user/global, project, and
per-change manifest scopes: `posture` is nearest-wins; `deny` is the union of all
scopes; `allow` is replaced by the nearest scope that defines it; each agent's
`raw` entry is nearest-wins per agent.

| Key | Type | Default | Accepted values | Description |
|---|---|---|---|---|
| `posture` | string | `repo-sandboxed-permissive` | `repo-sandboxed-permissive` `curated-allowlist` `full-autonomy` | Agent-agnostic permission posture. `repo-sandboxed-permissive`: edits and ordinary build/test commands run unprompted, scoped to the repo, with a denylist blocking destructive operations. `curated-allowlist`: nothing runs unprompted outside an explicit allow list. `full-autonomy`: all permission checks bypassed. |
| `allow` | string[] | `[]` | tool-pattern strings | Allowlist of tool-name patterns. Injected as native permission flags for each agent. Replaced (not merged) by the nearest scope that defines the key. |
| `deny` | string[] | `[]` | tool-pattern strings | Denylist of tool-name patterns. Unioned across all scopes; a narrower scope cannot remove a denial set by a wider scope. |
| `raw` | object | `{}` | per-agent map | Per-agent raw argv fragment override (escape hatch). Recognized agents: `claude`, `codex`, `gemini`, `cursor`. Each entry is a string array of flags appended verbatim to the agent invocation. Nearest-wins per agent. |

#### Example `batch.permissions` block

```yaml
batch:
  permissions:
    posture: repo-sandboxed-permissive
    deny:
      - "Bash(rm -rf*)"
    raw:
      claude:
        - "--allowedTools"
        - "Edit,Read,Bash"
```

---

## `eval:` settings

Project-level defaults for `ratchet eval` orchestration.

| Key | Type | Default | Accepted values | Description |
|---|---|---|---|---|
| `gate` | object | every contributor enabled | keys `deterministic` `llm-judge` `invariants` `regression` → boolean | Enables or disables each verdict contributor for `ratchet eval run`. An omitted contributor stays enabled; an unset `gate` ⇒ every contributor enabled. Overridable per run by `--gate`/`--only`/`--no-llm-judge`/`--no-invariants`. |
| `judge` | string | — | `auto` `deterministic` `llm-judge` | **Deprecated** default judge mode, mapped onto the gate (`deterministic` disables `llm-judge`, `llm-judge` disables `deterministic`, `auto` enables both). Prefer `gate`. |
| `jury` | object | `{ votes: 1, quorum: majority }` | `votes` (integer ≥ 1), `quorum` (`majority` \| `unanimous`), `panel` (reserved, see below) | Project-level default jury for the `llm-judge` contributor. A binding's own `jury:` block (see [LLM-judge binding](../commands/eval.md#llm-judge-binding)) overrides this default field-by-field. |
| `skip` | string[] | — (no patterns) | non-empty glob strings | Glob patterns matched against the full case id (`*` wildcard, anchored to the whole string). A matching case is excluded from judging and recorded `skipped`, alongside any case carrying an in-file `@skip` Gherkin tag. Overridable per run by `--include-skipped` (disables both sources together). See [Skip filters](../commands/eval.md#skip-filters). |

The `gate` map selects which contributors execute and gate a run, generalizing
the legacy `judge` mode. A contributor disabled here records its cases
`unjudged` (leaving the run incomplete, so it cannot be promoted to baseline) and
takes no part in the overall AND verdict. Setting `invariants: false` disables the
run-level [invariant gate](../eval-invariants.md#gate-contributor) — the
`.ratchet/evals/invariants.yaml` manifest is not loaded and no invariant command
runs for the run (equivalent to `--no-invariants`). See
[Eval verdict aggregation](../eval-verdict-aggregation.md#contributor-selection-the-gate).

An unknown contributor id under `gate` (or a non-boolean value) is rejected: the
whole `eval` section is dropped with a warning, and `eval run` falls back to
every contributor enabled.

The `jury` block sets the default number of repeat votes (`votes`) the
`llm-judge` contributor casts per case and the agreement required to land a
definitive verdict (`quorum`): `majority` decides on a strict majority either
way (a tie does not reach quorum), `unanimous` requires every vote to agree
(any split does not reach quorum). A jury that does not reach its quorum
records the case `unjudged` rather than guessing. `panel` is a reserved,
validated-but-inert slot (`{ families: string[] }`, min one family) for a
future cross-family panel; it is parsed and retained but not yet read by vote
resolution. An invalid `jury` value (e.g. an unrecognized `quorum`) is
rejected the same way an invalid `gate` value is: the whole `eval` section is
dropped with a warning.

`skip` excludes matching cases from judging by default, the project-config
half of [skip filters](../commands/eval.md#skip-filters) — the other half is
an in-file `@skip` Gherkin tag, checked first and independent of this config.
A skipped case is recorded `skipped` (never silently dropped) and is counted
in the `eval run` scorecard. `--include-skipped` on `eval run` overrides both
the `skip` patterns and the `@skip` tag together for that run.

---

## Complete example

```yaml
schema: ratchet

context: |
  This is a TypeScript monorepo managed with pnpm workspaces.
  All source lives under src/; tests are co-located with a .test.ts suffix.

rules:
  features:
    - "Each scenario must have at least one Then step asserting an observable output."
  plan:
    - "Tasks must be ordered by dependency."

batch:
  gate: after-propose
  strategy: vertical-slice
  proofOfWork: hard-gate
  locus: local
  agent: claude
  permissions:
    posture: repo-sandboxed-permissive
    deny:
      - "Bash(curl*)"

eval:
  gate:
    deterministic: true
    llm-judge: true
    invariants: true
    regression: true
  jury:
    votes: 3
    quorum: unanimous
  skip:
    - "features/legacy/*"
```
