# scope-local-agent-env

## Why

Engine-spawned agents currently see the operator's entire host environment — every
secret in `process.env` — through two spread sites: the engine builds
`AgentSpawnRequest.env` as `{ ...process.env }` (`src/core/batch/engine/engine.ts:347/488/668`,
serialized into `export` statements in the agent's shell command), and the ReX
bootstrap spreads `...process.env` into the sidecar process env
(`src/core/batch/engine/runtime/rex-bootstrap.ts:540`), which the local-locus agent
inherits. Scoping this to an allowlist is the one real containment improvement
available to the local locus and closes the env-scoping half of issue #86
(`Fixes #86`, env-scoping half; the eval judge gets the same treatment in #59,
out of scope here).

## What Changes

Implements `features/agent-env-scoping/*.feature`.

- New pure scoping helper (`scopeAgentEnv`) that filters a host environment down to
  an allowlist: baseline process vars (PATH, HOME, TMPDIR, locale/terminal, proxy
  vars, Windows basics), `RATCHET_*` control vars, forge auth (`GH_TOKEN`,
  `GITHUB_TOKEN` — the PR stage drives a forge CLI), and the union of
  adapter-declared env keys across the registered agents.
- Every `AgentAdapter` in the built-in registry declares an `envPassthrough` list
  (exact names or `PREFIX_*` patterns) — claude, codex, gemini, cursor, opencode —
  with a drift guard asserting every registered adapter declares one.
- The three engine spawn sites (change transition, decompose, pr) build the request
  env from `scopeAgentEnv(process.env)` plus `RATCHET_BATCH_NAME` instead of
  spreading full `process.env`. **BREAKING**: agents no longer see non-allowlisted
  host vars; the `RATCHET_AGENT_ENV_ALLOW` escape hatch (comma-separated extra
  names) restores specific vars when an operator needs them.
- The ReX bootstrap builds the sidecar launch env from the scoped base instead of
  `...process.env`, preserving the venv PATH prefix, `VIRTUAL_ENV`, and all
  `REX_*` threading vars.
- Tests assert a planted non-allowlisted host secret is NOT visible in the spawn
  request env nor in the sidecar launch env.
- Reference docs: `docs/engine/agent-runtime.md` documents the agent environment
  contract (what passes, per-agent keys, the escape hatch).

## Design

**One scoping policy, applied at both leak sites.** A single pure module
`src/core/batch/engine/agent-env.ts` owns the allowlist so the engine seam and the
bootstrap seam cannot drift. It is a deterministic function over an in-memory env
object — unit-testable with no filesystem or spawn (testing standard: prove at the
unit level, wire at integration).

**Union of adapter keys, not per-active-agent.** The engine builds the env before
the adapter is resolved (and the `RATCHET_BATCH_AGENT_CMD` override path has no
adapter at all), so the scoped env is the union of every registered adapter's
declared keys. This keeps the env identical for every agent (multi-agent-support:
no agent special-cased in shared paths) and matters in practice: opencode is
multi-provider and legitimately needs other agents' provider keys. Adapter
declarations live on the adapter (`envPassthrough`), next to the argv they already
own, and the existing registry drift-guard pattern is extended so a newly added
agent cannot silently ship without a declaration. Tests iterate the registry, never
hard-code one agent.

**Layering is unchanged; only the contents narrow.** Phase 1 built the seam: the
per-step `AgentSpawnRequest.env` is exported over the runtime session's base env
(`buildEnvExports`, overlay semantics). This change does not alter that mechanism —
it narrows WHAT the engine puts in `request.env` and WHAT the bootstrap passes as
the session base, exactly the follow-up `spawn-command.ts` documents as issue #86.
The legacy in-process spawner (`realSpawner`) already uses `request.env` wholesale,
so it is scoped for free via the engine seam.

**Escape hatch is operator-owned.** `RATCHET_AGENT_ENV_ALLOW` is read from the host
environment (set by the operator invoking ratchet), never from a repo-committed
manifest — consistent with the phase rule that repo-committed config can only
narrow, not escalate. Baseline vars include proxy settings (`HTTP_PROXY`/
`HTTPS_PROXY`/`NO_PROXY` and lowercase forms) because agents must reach their APIs
through corporate proxies; Windows basics (`SYSTEMROOT`, `COMSPEC`, `PATHEXT`,
`USERPROFILE`, `TEMP`, `TMP`, `APPDATA`, `LOCALAPPDATA`, `PROGRAMDATA`) are listed
unconditionally — absent vars are simply skipped. The allowlist names no package
manager, test runner, or toolchain (generalizable-defaults).

**Out of scope (thin slice).** The eval judge's identical spread (#59), the venv
*build* step's env (`realRun` during `pip install` — a Node-side build concern,
not agent-visible), and the posture-naming half of #86 (separate change in this
phase).

## Tasks

- [x] 1.1 Add `src/core/batch/engine/agent-env.ts`: `scopeAgentEnv(hostEnv)` with the
      baseline allowlist, `RATCHET_*`/`LC_*` prefixes, forge keys, adapter-key union,
      and the `RATCHET_AGENT_ENV_ALLOW` escape hatch; unit tests
      (`test/batch-engine/agent-env.test.ts`, header referencing
      `agent-env-scoping/allowlist.feature`) covering secret-dropped, baseline-kept,
      ratchet-vars-kept, escape hatch, and per-registry adapter keys.
- [x] 1.2 Declare `envPassthrough` on `AgentAdapter` and every `BUILTIN_ADAPTERS`
      entry; extend the registry drift guard so each registered adapter declares one
      (iterating the registry, not naming one agent).
- [x] 2.1 Replace the three `{ ...process.env }` spreads in
      `src/core/batch/engine/engine.ts` (change transition :347, decompose :488,
      pr :668) with the scoped env + `RATCHET_BATCH_NAME`; integration tests assert a
      planted `SUPER_SECRET_TOKEN` is absent from the captured spawn-request env for
      all three stages, `RATCHET_BATCH_NAME` present, and the
      `RATCHET_BATCH_AGENT_CMD` override still honored
      (`agent-env-scoping/engine-spawn-env.feature`).
- [x] 2.2 Replace the `...process.env` spread in `bootstrapRexRuntime`
      (`src/core/batch/engine/runtime/rex-bootstrap.ts:540`) with the scoped base,
      keeping the venv PATH prefix, `VIRTUAL_ENV`, and `REX_*` threading; update
      `test/batch-engine/rex-bootstrap.test.ts` to assert the launch env drops a
      planted secret and keeps the venv/REX wiring
      (`agent-env-scoping/sidecar-bootstrap-env.feature`).
- [x] 3.1 Documentation task (per the `documentation` standard, mandatory): add an
      "Agent environment" reference section to `docs/engine/agent-runtime.md`
      describing the allowlist contract (baseline vars, `RATCHET_*`, forge keys,
      per-agent `envPassthrough`, `RATCHET_AGENT_ENV_ALLOW`), accurate to the code in
      this change; verify `README.md` describes no now-stale env behavior and update
      it if it does.
- [x] 3.2 Run `npm test -- test/batch-engine/` (phase proof-of-work) and the full
      suite with the coverage gate; all green.
