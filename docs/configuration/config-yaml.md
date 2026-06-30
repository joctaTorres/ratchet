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

### Gate and orchestration

| Key | Type | Default | Accepted values | Description |
|---|---|---|---|---|
| `gate` | string | `voluntary` | `voluntary` `after-propose` `every-phase` `autonomous` | Controls when the batch engine pauses for human approval between phases. `voluntary` never interrupts; `after-propose` gates after the propose phase; `every-phase` gates after every phase; `autonomous` runs all phases without interruption. |
| `strategy` | string | `vertical-slice` | `vertical-slice` `feature` | Slice strategy used when the batch manifest is generated. |
| `proofOfWork` | string | `hard-gate` | `hard-gate` `warn` | What happens when an agent does not produce required proof-of-work. `hard-gate` blocks the phase; `warn` logs a warning and continues. |

### Execution locus

| Key | Type | Default | Accepted values | Description |
|---|---|---|---|---|
| `locus` | string | `local` | `local` `docker` `remote` | Where the agent runs. `local` drives the in-process ReX sidecar. `docker` runs the step inside a container via ReX `DockerDeployment` with the project root bind-mounted. `remote` drives a `swerex-remote` server over its REST API. |
| `agent` | string | — | free-form | Coding-agent binary to spawn (e.g. `claude`, `codex`, `cursor-agent`, `gemini`). When unset, the engine uses the agent configured at init time. |
| `image` | string | — | free-form | Container image reference for `locus: docker`. Must be non-empty when set. When unset and `locus` is `docker`, the runtime falls back to `python:3.12`. |

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
```
