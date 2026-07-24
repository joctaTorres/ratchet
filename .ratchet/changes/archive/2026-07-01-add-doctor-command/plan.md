# Add `ratchet doctor` command

## Why

`npm install ratchet-ai` installs only the npm dependencies. The pieces that actually run code generation — a coding-agent CLI and the Python/SWE-ReX runtime — must be installed separately, and today nothing checks for them. A missing agent binary surfaces as a raw `ENOENT` deep inside the batch engine (`engine.ts:233`, `judge.ts:229`), and the Python/SWE-ReX/Docker prerequisites are undocumented (README states only Node ≥ 20.19). Users hit these failures late, with unhelpful errors.

## What Changes

- Add a new `ratchet doctor` command that validates external (non-npm) runtime dependencies and reports each as pass / fail / informational, with actionable remedies. Implements `features/doctor/command.feature`.
- Agent preflight: verify at least one **supported coding-agent CLI** is installed on PATH, checking every batch-capable agent (not just the default), with version reporting. Fail if none are installed. Implements `features/doctor/agent-preflight.feature`.
- Runtime preflight: verify `uv` (preferred) **or** Python 3.10+ with venv+pip for the SWE-ReX sidecar. Implements `features/doctor/python-runtime.feature`.
- Docker is reported as **optional/informational** (only needed for `locus: docker`); its absence never fails doctor. Implements `features/doctor/docker-optional.feature`.
- `ratchet init` runs doctor automatically on the **first** init only and skips it on subsequent inits; doctor warnings never abort or block setup, even non-interactively. Implements `features/doctor/init-first-run.feature`.
- `--json` output for scripting/CI. Implements the JSON scenario in `command.feature`.
- README gains a Prerequisites/Requirements section covering the agent CLI, Python/uv, and Docker-for-docker-locus, pointing to `ratchet doctor`. Implements `features/doctor/documented-prerequisites.feature`.

## Design

**Tool-agnostic by construction (multi-agent-support standard).** The agent preflight must check *every* supported coding agent, never special-case Claude. To avoid drift, `src/core/batch/engine/agent.ts` becomes the single source of truth: export the batch-capable agent binary map derived from `BUILTIN_ADAPTERS` (the binary each adapter spawns):

| Agent id | Binary on PATH |
|----------|----------------|
| `claude` | `claude` |
| `codex` | `codex` |
| `gemini` | `gemini` |
| `cursor` | `cursor-agent` |

Doctor iterates this map. (`github-copilot` and `opencode` are init *config* targets but have no headless batch adapter, so they are out of scope for the batch-agent preflight; doctor documents this rather than reporting them as missing agents.) The "at least one installed" rule passes when any one of these binaries resolves.

**Pure check engine with injected side effects.** Mirror the proven seam pattern in `rex-bootstrap.ts` (`BootstrapDeps`: `run`, `hasOnPath`, `exists`). Add `src/core/doctor/` with a pure `runDoctorChecks(deps): DoctorReport` that returns structured `DoctorCheck[]` (`id`, `label`, `status: 'pass' | 'fail' | 'info'`, `severity: 'required' | 'optional'`, `detail`, `remedy?`). No process/fs calls inline — tests inject fakes, matching how rex-bootstrap is tested. A thin renderer formats the report for humans (chalk) and a `--json` path serializes the same structure.

**Reuse, don't duplicate, the runtime probes.** The Python/uv/version logic already exists in `rex-bootstrap.ts` (`findPython`, `meetsMinimum`, `MIN_PYTHON`, `defaultDeps.hasOnPath`, `SWE_REX_VERSION`). Doctor's runtime check calls these via the same `BootstrapDeps` shape (wrapping `findPython` in a non-throwing probe so doctor reports a failing check instead of throwing). Docker uses the same `docker info` probe idea as `preflightDockerDaemon` but downgraded to informational.

**Exit codes.** Exit 0 when all `required` checks pass (optional `info` notices do not affect the code); non-zero when any `required` check fails. `--json` emits one object and suppresses spinners/decoration.

**First-init hook.** `ratchet init` already distinguishes first-time setup via `extendMode` (`init.ts:128`, false when `.ratchet/` did not previously exist). Run doctor from `InitCommand.execute` only when `extendMode === false`, after setup completes. It runs in a never-block mode: render results as advisory output (warnings, not errors), never call `process.exit`, never prompt — consistent with the headless guarantee in `first-run-setup.ts`. Subsequent inits (`extendMode === true`) skip it. This keys off the same project-state signal the existing first-run flows use, so no new persisted marker is required.

**CLI wiring.** Register `program.command('doctor')` with `--json` in `src/cli/index.ts`, following the existing lazy-import + try/catch + `ora().fail` + `process.exit(1)` pattern. The command sets the exit code from the report.

**Per-agent output surface (enumerated per the standard).** This change adds a CLI command and updates the README; it does not add or modify skills/commands, so there are no per-agent generated artifacts to fan out. The only agent-facing surfaces are: (a) the agent-binary map in `agent.ts` covering all batch-capable agents, and (b) README prose that names agents agnostically. No `.claude/`-only output is produced.

## Tasks

- [x] 1.1 Export a batch-capable agent→binary map from `src/core/batch/engine/agent.ts` (derived from `BUILTIN_ADAPTERS`), so doctor and the engine share one source of truth.
- [x] 1.2 Define the doctor types in `src/core/doctor/types.ts`: `DoctorCheck`, `DoctorReport`, status/severity enums.
- [x] 2.1 Implement the agent preflight check (iterate the agent-binary map, detect presence + version, require ≥1) in `src/core/doctor/checks/agents.ts`.
- [x] 2.2 Implement the runtime check (uv preferred, else Python 3.10+ with venv+pip) reusing `rex-bootstrap` probes in `src/core/doctor/checks/runtime.ts`.
- [x] 2.3 Implement the optional Docker check (`docker info`, informational only) in `src/core/doctor/checks/docker.ts`.
- [x] 2.4 Implement `runDoctorChecks(deps)` aggregator returning a `DoctorReport`, with injectable `BootstrapDeps`-style side effects.
- [x] 3.1 Implement the human renderer (chalk, per-check pass/fail/info lines + remedies + summary) and the `--json` serializer.
- [x] 3.2 Compute the process exit code from the report (non-zero iff any required check fails).
- [x] 4.1 Register the `doctor` command (with `--json`) in `src/cli/index.ts` following the existing command pattern.
- [x] 5.1 Invoke doctor from `InitCommand.execute` only on first init (`extendMode === false`), in advisory never-block mode that never prompts or exits, with a "re-run with `ratchet doctor`" hint.
- [x] 5.2 Ensure subsequent inits (`extendMode === true`) and non-interactive first inits do not block on doctor.
- [x] 6.1 Unit-test the check engine with injected fakes: all-pass, no-agent-fail, old-python-fail, no-runtime-fail, uv-preferred, docker-optional-info, version-probe-failure, and `--json` shape.
- [x] 6.2 Test the init integration: doctor runs on first init, is skipped on re-init, and never aborts setup (interactive and non-interactive).
- [x] 7.1 Add a Prerequisites/Requirements section to the README (agent CLI, Python 3.10+/uv, Docker for docker locus) and reference `ratchet doctor`.
