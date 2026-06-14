# Plan: rex-docker-locus (Phase 4 — container-locus)

## Why

Phases 1–3 ship a config-selected `AgentRuntime` that drives the coding agent through the ReX Python sidecar locally, with rich live stream-json rendering. The sidecar already *branches* on `REX_LOCUS` (`docker` → `DockerDeployment`), but that branch is inert: the image is hard-coded (`DockerDeployment()` with swe-rex's `python:3.11` default), there is no repo access, `docker` is not an accepted config value, and a missing daemon would surface as a raw traceback or a hang. This change makes `locus: docker` REAL — the same batch step runs inside a container with no change to the calling code — while keeping `local` the untouched default.

## What Changes

- **Config: accept `docker`.** Add `docker` to `LOCUS_VALUES` (`src/core/batch/config.ts`), the manifest enum (`BatchSettingsOverrideSchema.locus`, `src/core/batch/manifest.ts`), and the project-config enum (`src/core/project-config.ts` `batch.locus`). Implements `features/container-locus/local-unaffected.feature` (default stays `local`) and the docker scenarios across the suite.
- **Config: a container image setting.** Add a flat `image` setting (key `image`) to `BatchSettings`, `DEFAULT_BATCH_SETTINGS`, `SETTING_KEYS`, `ALLOWED_VALUES` (free-form string, like `agent`), the manifest override schema, and project-config. Implements `features/container-locus/configurable-image.feature`.
- **Sidecar: configurable image + repo mount + workdir mapping.** `_make_deployment` in `src/core/batch/engine/runtime/sidecar.py` reads `REX_IMAGE`, `REX_MOUNT_HOST`, `REX_MOUNT_CONTAINER` and builds `DockerDeploymentConfig(image=..., docker_args=["-v", f"{host}:{container}"])`, mapping `REX_WORKDIR` to the in-container mount path. docker stays lazily imported. Implements `features/container-locus/run-in-container.feature`, `configurable-image.feature`.
- **Runtime/bootstrap: thread image + mount env.** `rex-sidecar-runtime.ts` accepts an `image` option and the project root → mount; `rex-bootstrap.ts` passes `REX_IMAGE`/`REX_MOUNT_*` through (as it already does for `REX_LOCUS`/`REX_WORKDIR`). The engine's `selectRuntime` (`engine.ts`) passes the resolved `image` for `locus: docker`. The engine, renderer, and event channel are otherwise UNCHANGED — streaming and rendering are locus-agnostic. Implements `features/container-locus/streaming-and-exit-code.feature`.
- **Clear no-Docker error (fail closed).** A daemon pre-flight check raises a `RexBootstrapError`-shaped, actionable error ("Docker not available for locus=docker — install/start Docker") BEFORE the swe-rex deployment is started, so the run never hangs. Implements `features/container-locus/no-docker-error.feature`.
- **Dependency note: `swe-rex[docker]`.** The docker deployment pulls `aiohttp` (verified below); bootstrap must install the docker extra when the docker locus is needed. Documented + wired (see Design).
- **Honest, SKIP-aware proof-of-work.** New `test/e2e/rex-docker-locus.sh`: with Docker present, drives a step through the docker locus against a generic small image + stub agent and asserts an in-container marker, incremental streaming, and the captured exit code; with Docker absent, prints `SKIP:` and exits 0. Implements `features/container-locus/proof-of-work-skip.feature`.
- **Docs:** a short note (in this plan + a comment block in the e2e and sidecar) on what a REAL agent-provisioned image needs (node + the chosen agent + `ratchet` on PATH) as a follow-on, since the stub proves plumbing, not a full agent run.

## Design

### swe-rex `DockerDeployment` API (verified against the installed 1.4.0 venv)

`DockerDeploymentConfig.model_fields` are: `image`, `port`, `docker_args`, `startup_timeout`, `pull` (default `"missing"`), `remove_images`, `python_standalone_dir`, `platform`, `remove_container` (default `True`), `container_runtime` (default `"docker"`), `type`. There is **no dedicated `volumes`/`mounts` field.** In `swerex/deployment/docker.py` `start()` the container is launched as `[runtime, "run", *rm_arg, "-p", ..., *platform_arg, *docker_args, "--name", ..., image_id, ...]`. So **the mount mechanism is `docker_args`**: pass `docker_args=["-v", f"{hostPath}:{containerPath}"]`. The first thing `start()` does is `_pull_image()` → `docker inspect` / `docker pull` via `subprocess.check_output` — this is also where a missing daemon throws.

> Apply must re-verify these exact field names against whatever swe-rex version is pinned at apply time; if `docker_args` is renamed, the mount construction is the only thing that moves.

### Image + repo access + workdir mapping

- **Image** is configurable via the new `image` setting → `REX_IMAGE` → `DockerDeploymentConfig(image=...)`. Default (when locus=docker and no image set): a documented small generic image for the plumbing default — recommend `python:3.12` (matches the current hard-coded value and is already pulled in CI-like flows). A REAL agent image is out of scope (documented below).
- **Repo access** is a read-write bind mount of the project root so the agent does real work AND journal writes inside the container propagate back to the host (the engine reads the journal back after the run). Mechanism: `docker_args=["-v", f"{projectRoot}:{containerWorkdir}"]`. We pass `REX_MOUNT_HOST=projectRoot` and `REX_MOUNT_CONTAINER=/workspace` (a stable, documented in-container path).
- **Workdir mapping:** `REX_WORKDIR` (used by the sidecar for its tail-poll logfiles AND as the agent's cwd) maps to the in-container mount path (`/workspace`), NOT the host path — inside the container the host path may not exist. So for docker: `REX_WORKDIR=/workspace`, `REX_MOUNT_HOST=projectRoot`, `REX_MOUNT_CONTAINER=/workspace`. For local: `REX_WORKDIR=projectRoot` (unchanged). The sidecar's logfile paths (`{workdir}/ratchet-rex-*.log`) then live under the mount, which is writable.

### Config shape: flat keys vs. nested `execution:` — RECOMMENDATION

Today the schema is flat (`gate`, `strategy`, `proofOfWork`, `locus`, `agent`) and `.strict()`. This change adds `image`. Phase 5 (remote) will need `host`, `port`, `token`. That is 4+ execution-transport keys accreting onto a flat namespace that already mixes orchestration policy (`gate`, `strategy`) with execution transport (`locus`, `image`, …).

**Recommendation: keep flat keys for THIS change (add `image`), and introduce a nested `execution:` namespace in Phase 5** when remote forces 3 more transport keys. Rationale: (1) nesting now would be a larger, riskier edit touching resolution, validation, get/set, and three schemas for a single new key, against this change's thin-slice mandate; (2) `local` must stay byte-for-byte unaffected, which a flat additive key guarantees; (3) Phase 5 is the natural seam to group `{ locus, image, host, port, token }` under `execution:` with a back-compat shim, and it can migrate `image` at the same time. This is a documented, deliberate decision — not an omission. (Alternative considered: nest `execution: { locus, image }` now; rejected as premature for one key.)

### How streaming/rendering stay identical

The sidecar's streaming model (launch detached to a logfile, tail-poll via `execute()`, emit `stdout`/`exit` events) is deployment-agnostic — `runtime.execute()` is the same abstract call whether the runtime is `LocalDeployment.runtime` or `DockerDeployment.runtime`. The Node side (`rex-sidecar-runtime.ts`) consumes the SAME JSON-lines protocol and emits the SAME `AgentEvent`s; the engine routes them through the SAME `makeStreamJsonRenderer`. **No engine/renderer/runtime calling code branches on locus** beyond `selectRuntime` choosing the same `makeRexSidecarRuntime` with different env. That is the locked invariant from the batch header and `features/container-locus/run-in-container.feature` scenario 2.

### No-Docker error path (fail closed, no hang)

Requesting `locus: docker` with no daemon must produce an actionable error, surfaced like `RexBootstrapError`. Approach: a pre-flight daemon probe BEFORE the deployment starts:
- **Node-side preferred:** in the docker branch of `selectRuntime`/bootstrap, probe `docker info`/`docker version` (via the existing injected `run` seam) with a short timeout; on non-zero/missing-binary, throw `RexBootstrapError("Docker not available for locus=docker — install Docker and ensure the daemon is running …")`. `rex-sidecar-runtime.ts` already catches `RexBootstrapError` and resolves a non-zero result with the message in stderr, which the engine maps to blocked/failed and stays resumable. This keeps the error in the same actionable channel as the Python-prereq error and avoids waiting on swe-rex's `startup_timeout` (default 180s).
- **Sidecar-side belt-and-braces:** the sidecar wraps `deployment.start()` for docker and, on a daemon/connection error, emits a clear `error` event (the runtime already maps `error` → non-zero + stderr). This covers a daemon that dies mid-start.

Both paths are unit-testable WITHOUT Docker via the injected `run`/spawn seams (fake a non-zero `docker info`, assert the actionable message; fake a sidecar `error` event line, assert the mapped result).

### Dependency: `swe-rex[docker]` / aiohttp

Verified against the installed venv: importing `swerex.deployment.docker` raises `ModuleNotFoundError: No module named 'aiohttp'` because it pulls `swerex.runtime.remote` → `aiohttp`, which base `swe-rex==1.4.0` does not install. So the docker locus requires the docker extra. Plan: `rex-bootstrap.ts` installs `swe-rex[docker]==1.4.0` (or adds `aiohttp`) when the docker locus is requested — gated on locus so the local path stays lean and its marker/version key distinguishes a docker-capable venv from a local-only one (extend the marker to record the installed extra so a local-only cached venv is rebuilt when docker is first requested). The no-Docker error and the missing-extra install failure both surface as `RexBootstrapError`.

### Stub-proves-plumbing vs. real-image provisioning (honest scope)

The e2e proves the **plumbing** — that a step actually runs inside a container with streaming + a captured exit code — using a generic small image (e.g. `python:3.12` or `alpine`) and a STUB agent command (e.g. `hostname`/`cat /etc/hostname`/a sentinel file the host lacks). It does NOT prove a real agent run, because that needs an image provisioned with node + the chosen coding agent + `ratchet` on PATH (so the agent can run `ratchet batch report` and the engine can read the journal back over the mount). That production image is a documented **follow-on**, out of scope here. The stub keeps the proof cheap, deterministic, and not dependent on a fully built agent image.

### Reality on THIS machine

**Docker is NOT installed here**, so `test/e2e/rex-docker-locus.sh` will hit its daemon pre-flight and **SKIP explicitly** (clear `SKIP:` line, exit 0). It is genuinely runnable and will PASS on a Docker-equipped machine. The phase gate is honest: a SKIP never claims in-container behavior was verified. The unit tests (config/locus resolution, image/mount construction, no-Docker error) run fully here with injected seams and no daemon.

## Tasks

- [x] 1.1 Add `docker` to `LOCUS_VALUES` and a flat `image` key to `BatchSettings`, `DEFAULT_BATCH_SETTINGS`, `SETTING_KEYS`, and `ALLOWED_VALUES` (free-form, like `agent`) in `src/core/batch/config.ts`; keep `local` the default.
- [x] 1.2 Add `docker` to the manifest `locus` enum and an optional `image` to `BatchSettingsOverrideSchema` (keep `.strict()`) in `src/core/batch/manifest.ts`.
- [x] 1.3 Add `docker` to the `batch.locus` enum and an optional `image` to `batch` in `src/core/project-config.ts`.
- [x] 1.4 Unit tests: locus resolution accepts `docker`; `image` resolves through defaults ← project ← manifest with correct sources; `validateSetting` accepts a non-empty image and rejects an empty one; an unknown locus is still rejected. (No daemon required.)
- [x] 2.1 In `sidecar.py` `_make_deployment`, read `REX_IMAGE`/`REX_MOUNT_HOST`/`REX_MOUNT_CONTAINER` and build `DockerDeploymentConfig(image=..., docker_args=["-v", f"{host}:{container}"])`; keep docker imported lazily and local untouched.
- [x] 2.2 Map `REX_WORKDIR` to the in-container mount path (`/workspace`) for docker; leave it as the project root for local. Document the mapping in the sidecar docstring.
- [x] 2.3 Sidecar belt-and-braces: wrap docker `deployment.start()` and emit a clear `error` event on a daemon/connection failure (no raw traceback).
- [x] 3.1 In `rex-sidecar-runtime.ts`, add an `image` option and derive `REX_MOUNT_HOST`/`REX_MOUNT_CONTAINER` + the docker `REX_WORKDIR` from the project root; thread them to the bootstrap options.
- [x] 3.2 In `rex-bootstrap.ts`, pass `REX_IMAGE`/`REX_MOUNT_HOST`/`REX_MOUNT_CONTAINER` through to the sidecar env (mirroring the existing `REX_LOCUS`/`REX_WORKDIR` passthrough).
- [x] 3.3 In `engine.ts` `selectRuntime`, pass the resolved `image` to `makeRexSidecarRuntime` when `locus === 'docker'`; assert no other engine/renderer code path branches on locus.
- [ ] 3.4 Unit tests: for `locus: docker`, the sidecar deployment env carries the configured image and the `-v projectRoot:/workspace` mount, and `REX_WORKDIR=/workspace`; for `local`, none of these are set and docker is never imported. (Injected seams; no daemon.)
- [x] 4.1 Add a Docker daemon pre-flight in the docker bootstrap branch (probe `docker info`/`version` via the injected `run` seam, short timeout); on failure throw `RexBootstrapError` with an actionable install/start-Docker message naming `locus=docker`.
- [ ] 4.2 Unit test: with a faked non-zero `docker info`, the docker path throws the actionable `RexBootstrapError`, the runtime resolves a non-zero result with the message in stderr, and the engine maps it to blocked/failed (no hang, no traceback). (No daemon.)
- [x] 5.1 In `rex-bootstrap.ts`, install `swe-rex[docker]==1.4.0` (or add `aiohttp`) when the docker locus is requested; extend the readiness marker to record the installed extra so a local-only cached venv is rebuilt on first docker use.
- [ ] 5.2 Unit test: a local-only marker is treated as not-ready when the docker locus is requested (forces a docker-capable rebuild); a docker-capable marker is reused.
- [ ] 6.1 Write `test/e2e/rex-docker-locus.sh`: SKIP explicitly (clear message, exit 0) when no Docker daemon, the dist is unbuilt, or (cold cache) PyPI is unreachable; mirror the structure of `test/e2e/rex-local-stream.sh`.
- [ ] 6.2 In that e2e (Docker present), pull a generic small image and drive a step through the docker locus with a stub agent that prints an in-container marker (e.g. the container hostname / a sentinel file absent on the host); assert the marker is observed, lines stream incrementally, and the captured exit code matches the stub. Exit 0 on pass.
- [ ] 6.3 Add a documented comment block (in the e2e and sidecar) describing what a REAL agent-provisioned image needs (node + the chosen agent + `ratchet` on PATH) as a follow-on beyond the stub plumbing proof.
- [ ] 7.1 Run `pnpm vitest run test/batch-engine` (and the new unit tests) green; run `bash test/e2e/rex-docker-locus.sh` and confirm it SKIPs cleanly on this Docker-less machine. Confirm `local` behavior is unchanged.
