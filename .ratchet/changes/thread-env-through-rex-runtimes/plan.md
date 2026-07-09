# thread-env-through-rex-runtimes

## Why

The engine builds `AgentSpawnRequest.env` for every step (`src/core/batch/engine/engine.ts:332/470/643` → `buildSpawnRequest` → `agent.ts:67`), and `docs/engine/agent-runtime.md` presents `env` as part of the spawn contract — but both rex runtimes silently drop it: the sidecar runtime reads `req.env` only for `RATCHET_BATCH_NAME` dir naming (`rex-sidecar-runtime.ts:413`) and the remote runtime never references it at all. Only the legacy in-process `realSpawner` (`agent.ts:288`) honors it. This is a live doc/code contract violation (issue #89) and blocks every env-based hardening step that follows (e.g. the #86 allowlist).

## What Changes

- Both rex runtimes apply `AgentSpawnRequest.env` to the agent command they launch: the env is serialized as shell `export` statements prefixed to the launch command, on the sidecar path (`buildRunCommand`, `rex-sidecar-runtime.ts:144-152`) and the remote path (`buildRemoteRunCommand`, `rex-remote-runtime.ts:124-127`).
- Env serialization lives in ONE shared helper used by both runtimes (also consolidating the two identical `shquote` copies at `rex-sidecar-runtime.ts:126` and `rex-remote-runtime.ts:115` into that shared module). Implements `features/rex-env-threading/env-serialization-safety.feature`.
- Merge semantics are decided and documented: **request env overlays the runtime session's base environment** (exported on top of it; request value wins on collision, base vars absent from the request remain visible). Implements `features/rex-env-threading/env-reaches-spawned-agent.feature`.
- Tests assert a per-step env var set by the engine is visible to the spawned command on BOTH runtimes (`test/batch-engine/rex-sidecar-runtime.test.ts`, `test/batch-engine/rex-remote-runtime.test.ts`).
- `docs/engine/agent-runtime.md` is corrected: the env-threading contract (overlay semantics) is documented, the run-op command description reflects the env exports, and the `insecure` (settings key) vs `allowInsecure` (runtime option, `rex-remote-runtime.ts:89`, mapped at `engine.ts:218`) naming drift is clarified.
- No protocol change: `sidecar.py` and the Node→sidecar run-op shape (`{op, id, command}`) are untouched; env rides inside the command string. The swe-rex REST protocol is likewise untouched.

## Design

**Serialize env into the command string; no sidecar/remote protocol change.** Issue #89 offers two routes for the sidecar (an additive `env` field on the run op consumed by `sidecar.py`, or exports embedded in the launcher command). We embed exports in the command because it is the thinnest end-to-end slice: one serialization helper works identically for both runtimes, requires no Python change, no cross-language protocol contract, and is directly assertable by the existing test harnesses (the sidecar `FakeChild` captures the run-op `command`; the remote `fakeServer` captures the `/execute` body command).

**One shared helper.** A new shared runtime module (e.g. `src/core/batch/engine/runtime/spawn-command.ts`) exports `shquote` and `buildEnvExports(env): string`. `buildEnvExports` emits `export NAME='value'; ` per entry with values shell-quoted via `shquote`, and **skips entries whose name is not a valid shell identifier** (`/^[A-Za-z_][A-Za-z0-9_]*$/` — such names are unreachable in shell anyway and would break `export`). Entries with `undefined` values are skipped. Both runtimes import from this module; the two local `shquote` copies are deleted. This is the seed of the phase-level "spawn-request construction lives in one shared helper" criterion (change `gate-and-mark-agent-cmd-override` extends it) and pre-dedups part of #91.

**Command shape.** Sidecar: `cd '<cwd>'; <exports> cat '<prompt>' | '<agent>' '<args>'` (exports inserted after the cwd prefix, before the pipeline). Remote: same insertion in `buildRemoteRunCommand`'s output, which is then wrapped by the existing nohup/log/exit-sentinel launcher unchanged. Quoting nests safely: the run-op command is JSON-encoded on the wire and `sidecar.py` re-wraps it via its own `_shquote`; single-quote escaping preserves newlines and metacharacters byte-for-byte.

**Overlay, not replace.** The legacy `realSpawner` replaces the child env wholesale, but a shell-session runtime cannot sanely replace (`env -i` would strip the session `PATH` the agent needs for command resolution on docker/remote loci). Exports on top of the session base env give deterministic, documentable semantics: request wins on collision, base survives otherwise. Note `req.env` today is `{...process.env, RATCHET_BATCH_NAME}`; narrowing WHAT the engine puts in it (host-env leakage to docker/remote) is explicitly out of scope here — that is issue #86 (allowlist), which this change unblocks.

**Testing (per the `testing` standard — right layer, pyramid-weighted).** Unit tests with no fs/spawn cover `buildEnvExports` (metacharacter quoting, identifier filtering, undefined skipping) and the string-level output of both command builders. One small execution test per builder runs the built command through the system shell (`sh -c`) with a controlled base env and asserts the spawned command observes the request value (collision → request wins; base var absent from request → still visible) — this proves actual visibility, not just string shape, satisfying the definition of done on both runtimes. Runtime-level tests assert via the existing fakes that the run-op / `/execute` command carries the exports. Test file headers name the `.feature` files they implement. Full suite and the coverage gate stay green.

**Documentation (per the `documentation` standard).** `docs/engine/agent-runtime.md` is an existing Reference doc for a core flow; it is updated in this same change — env contract, run-op command description, `insecure`/`allowInsecure` clarification — and any existing diagram/table touched by the flow is re-verified for accuracy. `README.md` is checked for surfaces this change alters and updated if it describes agent env behavior.

## Tasks

**1. Shared env serialization helper**

- [x] 1.1 Create the shared runtime module (e.g. `src/core/batch/engine/runtime/spawn-command.ts`) exporting `shquote` and `buildEnvExports(env)`: shell-quoted `export` statements, invalid-identifier names skipped, `undefined` values skipped; both rex runtimes import `shquote` from it (local copies removed)
- [x] 1.2 Add unit tests (no fs, no spawn) for `buildEnvExports`: metacharacter/quote/`$`/space/newline values survive quoting, invalid-identifier entries are omitted while valid ones remain, empty env yields empty prefix; header names `features/rex-env-threading/env-serialization-safety.feature`

**2. Thread env through the sidecar runtime**

- [x] 2.1 `buildRunCommand` (`rex-sidecar-runtime.ts`) prefixes `buildEnvExports(request.env)` to the agent pipeline (after the cwd prefix); run-op construction passes the request through unchanged
- [x] 2.2 Extend `test/batch-engine/rex-sidecar-runtime.test.ts`: run-op command carries the export of a per-step var set on the request env, and an execution test runs the built command via `sh -c` proving the spawned command observes the request value with overlay semantics (request wins over a colliding base var; base vars absent from the request stay visible); header names `features/rex-env-threading/env-reaches-spawned-agent.feature`

**3. Thread env through the remote runtime**

- [x] 3.1 `buildRemoteRunCommand` (`rex-remote-runtime.ts`) prefixes `buildEnvExports(request.env)` the same way; the nohup launcher wrapping stays unchanged
- [x] 3.2 Extend `test/batch-engine/rex-remote-runtime.test.ts`: the `/execute` nohup body command carries the export of a per-step var, plus the same `sh -c` execution/overlay assertion for the remote builder; header names `features/rex-env-threading/env-reaches-spawned-agent.feature`

**4. Documentation (mandatory — `documentation` standard, Reference docs)**

- [x] 4.1 Update `docs/engine/agent-runtime.md`: document that both rex runtimes export `AgentSpawnRequest.env` before launching the agent with overlay merge semantics (request overlays session base; legacy in-process spawner replaces instead), update the run-op command description to show the env exports, and fix the `insecure`/`allowInsecure` drift by stating the settings key `insecure` maps to the runtime option `allowInsecure`; re-verify the env table and any Mermaid diagram in the doc still depict the code accurately and update them if the flow change made them stale
- [x] 4.2 Check `README.md` for any description of agent env/runtime behavior affected by this change and update it to match (no-op if it describes none)
- [x] 5.1 Run `npm test -- test/batch-engine/rex-sidecar-runtime.test.ts test/batch-engine/rex-remote-runtime.test.ts` — exit code 0 with the new env-threading assertions in place (phase proof-of-work)
- [x] 5.2 Run the full test suite and the coverage gate — green, coverage at or above the enforced `COVERAGE_THRESHOLD` (`testing` standard)
