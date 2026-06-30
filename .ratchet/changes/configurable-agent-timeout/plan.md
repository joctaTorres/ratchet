# Configurable agent timeout

## Why

The ReX per-agent timeout is a hardcoded `10 * 60 * 1000` constant in both the
sidecar and remote runtimes, with no config key, no env override, and no caller
that ever passes `options.timeoutMs`. A long-running but passing proof-of-work
(e.g. a full-suite coverage run) is killed at 600s and the transition halts as
`blocked` even though the work and its proof succeed — observed on batch
`testing-strategy-coverage-95`, change `commands-core-verb-tests`. Operators have
no knob to raise it short of editing the source and rebuilding.

## What Changes

- Add a `batch.agentTimeoutMs` key to `.ratchet/config.yaml` (positive integer
  milliseconds) that raises the per-agent ReX timeout.
- Add a `RATCHET_AGENT_TIMEOUT_MS` environment override following the existing
  `RATCHET_*` convention; it takes precedence over the config key.
- Thread the resolved timeout through `selectRuntime()` into both
  `makeRexSidecarRuntime` and `makeRexRemoteRuntime` via their existing
  `timeoutMs?` option.
- Default behavior is unchanged: when nothing is set, the runtimes apply their
  built-in `DEFAULT_TIMEOUT_MS` (600000ms). Invalid/non-positive values fall back
  to the default.
- Implements `features/agent-timeout/configurable-timeout.feature`.
- No **BREAKING** changes.

## Design

**Settings surface.** `agentTimeoutMs` is a scalar batch setting, so it joins the
existing cascade (built-in default ← user ← project config ← manifest) rather than
inventing a parallel path. Concretely:
- `BatchSettings` (`src/core/batch/config.ts:76`) gains `agentTimeoutMs?: number`.
- `SETTING_KEYS` (`:256`) and the `sources` record literal in `resolveBatchSettings`
  (`:298`) gain `agentTimeoutMs` so the project/manifest scopes copy it and its
  source is tracked. `DEFAULT_BATCH_SETTINGS` leaves it unset (so the runtime's own
  600000ms default applies — no toolchain- or ecosystem-specific literal is shipped,
  per `generalizable-defaults`).
- `ALLOWED_VALUES` (`:269`) maps `agentTimeoutMs` to `null` (free-form numeric, like
  `port`).
- `ProjectConfigSchema.batch` (`src/core/project-config.ts:47`) gains
  `agentTimeoutMs: z.number().int().positive().optional()` so a malformed YAML value
  is rejected at load (the config path is validated; only the env path needs runtime
  parsing). If the per-change manifest `settings` schema is a distinct schema, add the
  same optional field there.

**Resolution + precedence.** A small pure helper
`resolveAgentTimeoutMs(settings, env = process.env): number | undefined` returns the
effective timeout: parse `RATCHET_AGENT_TIMEOUT_MS` (an integer > 0) and prefer it;
else `settings.agentTimeoutMs`; else `undefined`. Returning `undefined` when unset
lets each runtime keep applying its own `DEFAULT_TIMEOUT_MS`, so the default lives in
exactly one place and "unset" stays distinct from "set to the default". A
non-numeric, zero, or negative env value is ignored (falls through to config/default)
so a typo never shortens or removes the guard. Precedence is therefore
`env > manifest > project config > built-in default` (the config layers below env are
ordered by the existing cascade). The helper is pure and env-injectable, mirroring the
runtime seams, so the feature scenarios unit-test directly.

**Threading.** `selectRuntime()` (`src/core/batch/engine/engine.ts:180`) already
receives the resolved `BatchSettings`. Compute `const timeoutMs =
resolveAgentTimeoutMs(settings)` once and spread `...(timeoutMs !== undefined ?
{ timeoutMs } : {})` into both the `makeRexRemoteRuntime` and `makeRexSidecarRuntime`
option objects. Omitting the key when undefined preserves today's behavior exactly.
The timeout is agent-neutral and locus-uniform — it applies identically to every
supported coding agent and to local/docker/remote — so no agent is special-cased
(`multi-agent-support` preserved).

**Documentation (mandatory — `documentation` standard).** This change adds a
user-facing config key and env var and alters documented runtime timeout behavior, so
the documentation task is a required, blocking task:
- `docs/configuration/config-yaml.md`: add a `batch.agentTimeoutMs` row to the batch
  settings table (Type/Default/Description) and document the `RATCHET_AGENT_TIMEOUT_MS`
  env override and the env > config precedence.
- `docs/engine/agent-runtime.md`: update the "overall run timeout is 10 minutes"
  statements (currently in the `local` and `remote` sections) to state that 600000ms is
  the default and is configurable, and document the resolution precedence. Add a small
  vertical, high-contrast Mermaid flowchart (every `classDef` setting `color:`) showing
  the `env → manifest → project → default` precedence for the timeout-resolution flow.
- `README.md`: update the batch-configuration surface to mention the new key and env
  var so the README does not describe stale behavior.

## Tasks

- [x] 1.1 Add `agentTimeoutMs?: number` to `BatchSettings` and register it in
  `SETTING_KEYS`, the `sources` record literal in `resolveBatchSettings`, and
  `ALLOWED_VALUES` (`src/core/batch/config.ts`).
- [x] 1.2 Add `agentTimeoutMs: z.number().int().positive().optional()` to
  `ProjectConfigSchema.batch` (`src/core/project-config.ts`), and to the manifest
  `settings` schema if it is defined separately.
- [x] 1.3 Implement the pure helper `resolveAgentTimeoutMs(settings, env)` (env >
  config > undefined; ignore non-positive/non-numeric env values), exported for tests.
- [x] 2.1 Thread the resolved timeout through `selectRuntime()` into both
  `makeRexRemoteRuntime` and `makeRexSidecarRuntime`, omitting `timeoutMs` when
  unset (`src/core/batch/engine/engine.ts`).
- [x] 3.1 Unit-test `resolveAgentTimeoutMs`: default-unset, config-set, env-set,
  env-overrides-config, and the invalid-value fallbacks (0, -1, non-numeric, empty) —
  one assertion per feature scenario.
- [x] 3.2 Test that `selectRuntime` passes the resolved `timeoutMs` to both the
  sidecar and remote runtime option objects (and omits it when unset).
- [x] 4.1 (documentation — `documentation` standard) Update
  `docs/configuration/config-yaml.md` with the `batch.agentTimeoutMs` row and the
  `RATCHET_AGENT_TIMEOUT_MS` env override + precedence.
- [x] 4.2 (documentation — `documentation` standard) Update
  `docs/engine/agent-runtime.md`: correct the "10 minutes" statements to "default,
  configurable", document the precedence, and add the vertical high-contrast Mermaid
  precedence diagram.
- [x] 4.3 (documentation — `documentation` standard) Update `README.md` batch
  configuration to mention `batch.agentTimeoutMs` and `RATCHET_AGENT_TIMEOUT_MS`.
