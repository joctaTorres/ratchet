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

Three checks run in a fixed order: agent, runtime, docker.

### Coding-agent CLI (`agent`) — required

Verifies that at least one supported coding-agent CLI binary is present on `PATH`. Supported agents are `claude`, `codex`, `cursor-agent`, and `gemini`. The check passes when any one binary is found. Each detected binary is probed for its version (`--version`); a binary that does not emit a parseable version string is still reported as detected with version unknown.

**Pass**: one or more supported binaries found on `PATH`. Detail lists each detected agent and its version.

**Fail**: no supported binary found on `PATH`. Remedy: install one of the supported CLIs and add it to `PATH`.

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
| `checks[].id` | string | Stable machine id: `agent`, `runtime`, or `docker`. |
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
