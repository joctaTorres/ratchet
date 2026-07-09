---
title: ratchet doctor
sidebar_position: 17
---

# `ratchet doctor`

Check whether ratchet's external (non-npm) runtime dependencies are installed and usable. Each dependency is reported as `pass`, `fail`, or `info` with an actionable remedy when not passing. The process exits non-zero when any required check fails.

## Synopsis

```bash
ratchet doctor [options]
```

## Options

| Option | Argument | Description |
|---|---|---|
| `--json` | | Output results as a single JSON object. Suppresses spinner and all decoration. |

## Checks

Three checks always run, in a fixed order: agent, runtime, docker. Three
further checks are conditional and each is appended only when it is relevant,
otherwise absent from the report entirely (not merely hidden or skipped):

- **Playwright** — appended only when a `kind: web` binding is present among the
  eval bindings resolved from `.ratchet/evals/specs/`.
- **Git remote (`pr-remote`)** — appended only when `prGrouping` is active for the
  project (resolved from config) **and** the repo has no configured git remote.
- **Batch isolation (`batch-isolation`)** — appended only when the resolved
  batch locus is `local` **and** the effective permission posture is permissive
  (`repo-sandboxed-permissive` or `full-autonomy`).

### Coding-agent CLI (`agent`) — required

Verifies that at least one supported coding-agent CLI binary is present on `PATH`. Supported agents are `claude`, `codex`, `cursor-agent`, `gemini`, and `opencode`. The check passes when any one binary is found. Each detected binary is probed for its version (`--version`); a binary that does not emit a parseable version string is still reported as detected with version unknown.

In addition, the check consults the project-scope `batch.agent` setting (the same resolution the batch engine uses — see [`agent`](../configuration/config-yaml.md)): every configured `agent[:model]` value is parsed through the shared spec parser and the **agent part's** binary is probed. So `agent: opencode:zai/glm-5.2` probes the `opencode` binary — the whole spec string is never treated as a binary name. A configured agent whose binary is not on `PATH` fails the check (the actual ENOENT a batch run would hit at spawn), even when another supported binary is detected. The model part of a spec is never validated and doctor emits no model-related check; an agent part not in the supported registry is skipped (unknown-agent rejection stays at spawn time).

**Pass**: one or more supported binaries found on `PATH` **and** every configured agent's binary present. Detail lists each detected agent and its version.

**Fail**: no supported binary found on `PATH`, or a configured agent's binary is missing. Remedy: install the named CLI and add it to `PATH`.

### SWE-ReX runtime (`runtime`) — required

Verifies that the Python toolchain needed to bootstrap the SWE-ReX sidecar is available.

- `uv` on `PATH` satisfies the check outright (preferred; uv provisions its own interpreter).
- Absent `uv`, a Python interpreter at version 3.10 or higher with `venv` and `pip` modules available satisfies the check.

**Pass (uv)**: `uv` is on `PATH`.

**Pass (Python)**: a Python 3.10+ interpreter with `venv` and `pip` is on `PATH`. Detail reports the interpreter path and version.

**Fail**: neither `uv` nor a qualifying Python interpreter is found. Or a Python interpreter is found but is missing `venv` or `pip`. Remedy: install `uv` (https://docs.astral.sh/uv/) or Python 3.10+ with `venv` and `pip`.

### Docker daemon (`docker`) — optional

Checks whether the Docker daemon is reachable (`docker info`). Docker is only required for the `docker` execution locus; local runs are unaffected.

**Pass**: `docker info` exits zero.

**Info**: `docker info` exits non-zero. Remedy: install Docker and start the daemon if the `docker` locus is needed.

An `info`-status check never affects the exit code.

### Playwright CLI (`playwright`) — optional, conditional

Appended only when a `kind: web` binding is present among the eval bindings resolved
from `.ratchet/evals/specs/` (the same resolver `eval set`/`eval run` use — see
[Web binding](eval.md#web-binding)). Absent from the report, and from `--json` output,
for any project with no web binding in scope. When present, checks whether the
Playwright CLI is usable (`npx --no-install playwright --version`).

**Pass**: the probe exits zero. Detail reports the detected version.

**Info**: the probe exits non-zero (Playwright is not installed). Remedy: install
Playwright (`npm install -D @playwright/test && npx playwright install`).

Like Docker, a missing Playwright CLI never fails doctor or affects the exit code.

### Git remote (`pr-remote`) — optional, conditional

Appended only when `prGrouping` is active for the project (resolved from config via
the same nearest-wins cascade the batch engine uses — see [`prGrouping`](../configuration/config-yaml.md))
**and** the repo has no configured git remote. When PR grouping is active, a completed
batch spawns a PR agent that pushes the work branch and opens a PR; without a remote
that push has nowhere to go, so this check warns up front rather than at the very end
of a batch. It is absent from the report, and from `--json` output, whenever
`prGrouping` is `off` (the default) or a remote is already configured.

A configured remote is detected by probing `git remote` in the project root: a remote
is present when the command exits zero with non-empty output. Any other outcome
(non-zero exit or empty output) is treated as "no remote".

**Info**: `prGrouping` is active and no git remote is configured. Detail explains that
PR grouping is active but the repo has no remote to push to. Remedy: configure a git
remote (e.g. `git remote add <name> <url>`). The remedy names no forge-specific CLI —
which forge (`gh`, `glab`, or other) opens the PR is left to the user's environment.

Like Docker and Playwright, this `info` notice never fails doctor or affects the
exit code.

### Batch isolation (`batch-isolation`) — optional, conditional

Appended only when the resolved batch locus is `local` **and** the effective
permission posture is permissive (`repo-sandboxed-permissive` or `full-autonomy`).
It is absent from the report when the locus is `docker` or `remote`, or when the
posture is `curated-allowlist` (already restrictive enough that no nudge is
warranted). The check resolves the same batch settings `batch config` uses (see
[`batch config`](batch.md#batch-config)).

The local locus imposes no process boundary — the permission posture is the only
gate. A permissive posture on the local locus means the agent can write anywhere
the operator's account can. This check nudges the operator toward the `docker`
locus, which adds a real container boundary, rather than silently relying on
advisory posture alone.

**Info**: locus is `local` and posture is `full-autonomy` — the strongest nudge.
Detail explains that full autonomy with no process boundary gives the agent the
operator's full write surface. Remedy: set `locus: docker` to add a container
boundary (and see
[#85](https://github.com/anomaly-ai/ratchet/issues/85) for the container
hardening contract).

**Info**: locus is `local` and posture is `repo-sandboxed-permissive` — a softer
advisory nudge. Remedy: consider `locus: docker` for a process boundary, or
`curated-allowlist` to restrict the agent to an approved command set.

**Absent**: locus is `docker` or `remote`, or posture is `curated-allowlist`.

Like the other optional checks, this `info` notice never fails doctor or affects
the exit code.

## Human output

```
ratchet doctor — external dependency check

✓ Coding-agent CLI
  Detected: claude 1.2.3.
✓ SWE-ReX runtime (uv / Python)
  uv is installed and will be used as the preferred runtime provider.
ℹ Docker daemon (optional)
  Docker daemon is not available. This is only needed for the docker execution locus; local runs are unaffected.
  → Optional: install Docker (https://docs.docker.com/get-docker/) and start the daemon if you plan to use `locus: docker`.

All required checks passed.
```

Failed required checks show `✗` and print the remedy on the following line prefixed with `→`.

## JSON output

With `--json`, a single JSON object is written to stdout. No spinner or decoration is emitted.

```json
{
  "ok": true,
  "checks": [
    {
      "id": "agent",
      "label": "Coding-agent CLI",
      "status": "pass",
      "severity": "required",
      "detail": "Detected: claude 1.2.3."
    },
    {
      "id": "runtime",
      "label": "SWE-ReX runtime (uv / Python)",
      "status": "pass",
      "severity": "required",
      "detail": "uv is installed and will be used as the preferred runtime provider."
    },
    {
      "id": "docker",
      "label": "Docker daemon",
      "status": "info",
      "severity": "optional",
      "detail": "Docker daemon is not available. This is only needed for the docker execution locus; local runs are unaffected.",
      "remedy": "Optional: install Docker (https://docs.docker.com/get-docker/) and start the daemon if you plan to use `locus: docker`."
    }
  ]
}
```

Fields:

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` iff every `required` check has `status: "pass"`. Drives the exit code. |
| `checks[].id` | string | Stable machine id: `agent`, `runtime`, `docker`; `playwright` only when a `kind: web` binding is in scope; `pr-remote` only when `prGrouping` is active and no git remote is configured; `batch-isolation` only when locus is `local` and posture is permissive. |
| `checks[].label` | string | Short human label. |
| `checks[].status` | `"pass"` \| `"fail"` \| `"info"` | Verdict for this check. |
| `checks[].severity` | `"required"` \| `"optional"` | Whether a failure gates the exit code. |
| `checks[].detail` | string | Human-readable description of the verdict. |
| `checks[].remedy` | string | Actionable fix. Present only when `status` is not `"pass"`. |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | All required checks passed (`ok: true`). |
| `1` | One or more required checks failed (`ok: false`). |

Optional (`optional` severity) checks with `info` status never affect the exit code.
