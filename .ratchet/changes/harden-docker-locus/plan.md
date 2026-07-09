# harden-docker-locus

## Why

The docker locus passes exactly one flag set to `docker run` — the rw repo bind
mount — so the "sandbox" runs the agent as in-container root (root-owned files
land on the host mount), with unrestricted outbound network and no resource
limits (issue #85). This change makes the container honest: host uid by
default, memory/pids/cpus limits, configurable network policy, and reference
docs that state exactly what the container does and does not protect.

## What Changes

Implements `features/docker-locus-hardening/*.feature`:

- New batch settings — `dockerUser`, `dockerMemory`, `dockerPidsLimit`,
  `dockerCpus`, `network` — resolved through the standard nearest-wins cascade
  (default ← project ← manifest) and settable via `batch config --set`
  (`container-run-constraints.feature`, `configurable-knobs.feature`).
- `bootstrapRexRuntime` threads the resolved knobs to the sidecar as
  `REX_DOCKER_USER` / `REX_DOCKER_MEMORY` / `REX_DOCKER_PIDS_LIMIT` /
  `REX_DOCKER_CPUS` / `REX_DOCKER_NETWORK` (docker locus only; `local` and
  `remote` untouched), mirroring `image` → `REX_IMAGE`.
- `sidecar.py::_make_deployment("docker")` extends `docker_args` with
  `--user` (host uid:gid default), `--memory`, `--pids-limit`, `--network`
  (default `bridge`), and `--cpus` only when configured. The rw `-v` repo
  mount stays by design (`container-run-constraints.feature`).
- `docs/engine/agent-runtime.md` gains an honest isolation-contract section
  for the docker locus; `docs/configuration/config-yaml.md` and
  `docs/commands/batch.md` enumerate the new keys
  (`isolation-contract-docs.feature`).
- Not breaking: every knob has a default; existing docker-locus configs keep
  working (they gain the hardened defaults).

## Design

**Flat scalar settings, not a structured `docker:` group.** The existing
locus-specific settings (`image`, `host`, `port`, `insecure`) are flat scalars
riding the generic `SETTING_KEYS` / `ALLOWED_VALUES` / `SETTING_CODECS`
machinery in `src/core/batch/config.ts`; five more flat keys reuse validation,
persistence, cascade, and `batch config --set` for free, where a structured
group would need bespoke flow-map parsing like `agent`. The network key is
named `network` (the #85 vocabulary); the docker-only knobs with generic names
take a `docker` prefix (`dockerUser`, `dockerMemory`, `dockerPidsLimit`,
`dockerCpus`) to stay self-describing next to locus-neutral keys.

**Defaults live in single TS constants; Python keeps pure unset-fallbacks.**
Following the `DEFAULT_DOCKER_IMAGE` pattern: `config.ts` exports
`DEFAULT_DOCKER_MEMORY = '2g'`, `DEFAULT_DOCKER_PIDS_LIMIT = 512`,
`DEFAULT_DOCKER_NETWORK = 'bridge'`; the bootstrap always threads resolved
values, and `sidecar.py` holds mirrored fallbacks only for the unset case
(documented as deliberate cross-language duplicates, kept in sync). These
defaults are docker semantics, not ratchet-toolchain values, so nothing
ecosystem-specific leaks into consuming repos (`generalizable-defaults`).

**Host uid:gid is computed, not stored.** When `dockerUser` is unconfigured,
`bootstrapRexRuntime` resolves `${process.getuid()}:${process.getgid()}` at
spawn time (guarded to POSIX — on platforms without `getuid` the variable is
omitted and the sidecar falls back to `os.getuid()`, itself guarded so a
non-POSIX host omits `--user` entirely). Images that need root setup override
with `dockerUser: "0:0"`.

**Validation before any container starts.** `SETTING_CODECS` entries reject an
empty `dockerUser`/`dockerMemory`/`network`, a non-positive-integer
`dockerPidsLimit`, and a non-positive-number `dockerCpus`, leaving the config
file unchanged — the same fail-before-spawn contract as `image`/`port`. The
zod schemas in `manifest.ts` and `project-config.ts` mirror the types
(`z.string()` for the string knobs, `z.number().int().positive()` for
`dockerPidsLimit`, `z.number().positive()` for `dockerCpus`) so the write path
never persists what the loaders reject.

**Threading path.** `selectRuntime` (engine.ts) already spreads docker-only
options; it adds the five knobs to `RexSidecarRuntimeOptions`, the sidecar
runtime forwards them to `bootstrapRexRuntime`'s `BootstrapOptions`, and the
bootstrap sets the env only when `locus === 'docker'`. No sidecar protocol
change — the knobs ride the env contract like `REX_IMAGE`.

**Standards.** This change is agent-neutral (a runtime/settings change shared
by every coding agent; no skills, templates, or per-agent artifacts —
`multi-agent-support` holds by construction; `delegated-lifecycle` and
`instruction-fed-config` surfaces are untouched). Tests follow the `testing`
pyramid: pure validation/cascade at unit level in `test/core/batch/config.test.ts`,
env threading in `test/batch-engine/rex-bootstrap.test.ts` and
`test/batch-engine/rex-sidecar-runtime.test.ts` via the injected deps seams (no
real docker), and `docker_args` construction in the Python
`test_sidecar.py` harness alongside the existing `-v` mount cases. Docs are a
mandatory task per the `documentation` standard; the isolation contract is a
new section in the existing `agent-runtime.md` (whose overview diagram already
covers the runtime and stays accurate — no new diagram, deliberately, for a
leaf config surface).

## Tasks

- [x] 1.1 `src/core/batch/config.ts`: add `DEFAULT_DOCKER_MEMORY`,
      `DEFAULT_DOCKER_PIDS_LIMIT`, `DEFAULT_DOCKER_NETWORK` constants; add
      `dockerUser`/`dockerMemory`/`dockerPidsLimit`/`dockerCpus`/`network` to
      `BatchSettings`, `SETTING_KEYS`, `ALLOWED_VALUES`, and the `sources`
      init in `resolveBatchSettings`; add `SETTING_CODECS` entries (non-empty
      strings; positive-int `dockerPidsLimit` and positive-number `dockerCpus`
      serialized as numbers)
- [x] 1.2 Mirror the five keys in the settings zod schemas:
      `src/core/batch/manifest.ts` and `src/core/project-config.ts`
- [x] 1.3 Unit tests in `test/core/batch/config.test.ts`: valid set/persist
      for each key, each invalid-value rejection leaves the file unchanged,
      and manifest-over-project cascade for one knob
- [x] 2.1 `src/core/batch/engine/runtime/rex-bootstrap.ts`: extend
      `BootstrapOptions` with the five knobs; when `locus === 'docker'` set
      `REX_DOCKER_USER` (configured value, else computed host `uid:gid`,
      omitted on non-POSIX), `REX_DOCKER_MEMORY`/`REX_DOCKER_PIDS_LIMIT`/
      `REX_DOCKER_NETWORK` (configured, else the TS defaults), and
      `REX_DOCKER_CPUS` only when configured
- [x] 2.2 Thread the knobs from settings to bootstrap: extend
      `RexSidecarRuntimeOptions` (`rex-sidecar-runtime.ts`) and the
      docker-only spread in `selectRuntime` (`engine.ts`)
- [x] 2.3 Tests: `test/batch-engine/rex-bootstrap.test.ts` asserts the
      defaults case (computed uid:gid, `2g`/`512`/`bridge`, no
      `REX_DOCKER_CPUS`), the fully-configured case, and that `local` sets no
      `REX_DOCKER_*`; `test/batch-engine/rex-sidecar-runtime.test.ts` asserts
      the options reach the bootstrap seam for the docker locus
- [x] 3.1 `src/core/batch/engine/runtime/sidecar.py`: extend
      `_make_deployment("docker")` to append `--user` (env, else
      `os.getuid():os.getgid()` guarded for non-POSIX), `--memory`,
      `--pids-limit`, `--network` (env, else mirrored fallbacks), and
      `--cpus` when the env value is non-empty; update the module docstring's
      docker env contract
- [x] 3.2 `src/core/batch/engine/runtime/test_sidecar.py`: cases for the
      default argv (uid:gid, `2g`, `512`, `bridge`, no `--cpus`), the
      fully-overridden argv, and the rw mount staying `-v host:container`
      with no `:ro`
- [x] 4.1 Documentation (mandatory, per the `documentation` standard):
      rewrite the docker section of `docs/engine/agent-runtime.md` with the
      hardened `docker run` constraints, the new `REX_DOCKER_*` rows in the
      sidecar env table, and an "Isolation contract" subsection stating what
      the container does and does not protect (repo mount writable by design;
      uid, resources, and network per config; default `bridge` network means
      outbound access); enumerate the five keys with type/default/scope in
      `docs/configuration/config-yaml.md` and `docs/commands/batch.md`
      (README checked — it does not enumerate per-key settings, no README
      change)
- [x] 4.2 Run the full suite green (`npm test`), including
      `npm test -- test/batch-engine/` (the phase proof-of-work) and the
      sidecar Python tests per their documented invocation
