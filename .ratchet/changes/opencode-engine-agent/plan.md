# opencode-engine-agent

## Why

OpenCode is registered as an init tool and has a command-generation adapter
(`.opencode/commands/rct-*.md`), but it is not a *spawnable* batch-engine
agent: its `AI_TOOLS` entry has no `agentBinary`, there is no `opencode` entry
in `BUILTIN_ADAPTERS`, and `resolvePermissionFlags` does not map a posture to
opencode's native flags. As a result `--agent opencode` on the headless verbs
(propose/apply/verify) and `batch apply` rejects opencode with
`UnknownAgentError`, and `ratchet doctor` never probes the opencode binary —
so none of ratchet's automated workflows can be driven by opencode. This
change promotes opencode to a first-class engine agent so batch, propose,
apply, and verify workflows can run under opencode, matching how claude,
codex, cursor, and gemini already work.

## What Changes

- Add `agentBinary: 'opencode'` to the opencode `AI_TOOLS` entry in
  `src/core/config.ts`, making init the single source of truth that opencode is
  a spawnable coding agent (not merely a config target).
- Register an `opencode` `CommandAgentAdapter` in `BUILTIN_ADAPTERS`
  (`src/core/batch/engine/agent.ts`) with the verified headless argv
  `['run', '--format', 'json']`, instructions on stdin (`passOnStdin: true`),
  and `emitsStreamJson: true` (opencode `run --format json` emits one NDJSON
  event per line — verified empirically). Because the existing stream-json
  renderer parses **claude's** event schema only, this flag is backed by a
  real renderer extension (see next bullet), not a bare flag flip.
- Extend `src/core/batch/engine/runtime/stream-json-renderer.ts` with
  `dispatch` branches for opencode's top-level event types: `step_start`
  (control noise, dropped), `text` (read `part.text`, stream prose live,
  accumulating like claude's deltas), and `step_finish` (read `part.reason`,
  `part.tokens.{total,input,output}`, `part.cost`; render a closing usage
  summary mirroring the claude `result` summary). The renderer stays
  capability-gated (never agent-named) and multi-schema: claude's branches
  are untouched, and unknown opencode `part.type` values fall through to the
  existing raw-line contract (`graceful-degradation.feature`).
- Add an `opencodeFlags` posture mapper in
  `src/core/batch/runtime/agent-permissions.ts` and register it in
  `AGENT_MAPPERS`: `full-autonomy` → `--dangerously-skip-permissions`;
  `repo-sandboxed-permissive` and `curated-allowlist` are best-effort (opencode
  exposes no argv-only bounded auto-edit mode in `run --help`), mirroring the
  cursor pattern with a one-time-per-process warning.
- Add `'opencode'` to `PERMISSION_RAW_AGENTS` and the `raw` override object in
  `src/core/batch/permissions-policy.ts` so the per-agent escape hatch
  recognizes opencode.
- Add stream-json renderer unit tests to
  `test/batch-engine/stream-json-renderer.test.ts` for the new opencode
  branches (`step_start` dropped; `text` prose streamed; `step_finish`
  summary with usage/cost; error `reason` flagged; unknown `part.type`
  raw-fallback) and a regression that claude's branches are unchanged.
- Update the drift-guard / derivation tests in
  `test/core/batch/agent-init-link.test.ts` so opencode is now an included
  spawnable agent (flipping the assertions that previously excluded it).
- Update `test/batch-engine/agent.test.ts` so opencode is asserted
  stream-json-capable with the `run --format json` argv (the "codex, gemini,
  cursor are NOT capable" group keeps excluding those three but no longer
  implicitly covers opencode; add an opencode stream-json-capable assertion).
- Add opencode permission-flag unit tests to
  `test/batch-engine/agent-permissions.test.ts` (full-autonomy emits
  `--dangerously-skip-permissions`; sandboxed/curated do not; the `raw.opencode`
  override is appended).
- Update Reference docs: `docs/engine/agent-runtime.md` (spawnable-agents table
  now lists opencode `.opencode/commands/rct-<id>.md`; remove the "opencode has
  no batch-engine spawn adapter" exclusion note), `docs/commands/init.md`
  (opencode is now a spawnable agent), and `README.md` (batch-supported
  agents). This is the mandatory documentation task per the `documentation`
  standard.
- **BREAKING**: none for callers — opencode was previously rejected by
  `resolveAdapter`, so promoting it to a spawnable adapter only *adds* a
  capability. The only behavior that changes is `ratchet doctor` now reports
  opencode in its agent preflight (previously it was silently out of scope).

Implements:
- `features/opencode-engine-agent/spawn-adapter.feature`
- `features/opencode-engine-agent/stream-json-output.feature`
- `features/opencode-engine-agent/opencode-event-schema.feature`
- `features/opencode-engine-agent/permission-flags.feature`
- `features/opencode-engine-agent/doctor-preflight.feature`
- `features/opencode-engine-agent/skill-locus.feature`

## Design

The architecture is explicitly built so adding a coding agent is mechanical and
touches three single-source-of-truth seams (per the `multi-agent-support`
standard): an `AI_TOOLS` entry with `agentBinary`, a `BUILTIN_ADAPTERS` spawn
adapter, and a permission-posture mapper (+ a `raw` agent id). The
drift-guard test (`test/core/batch/agent-init-link.test.ts`) already enforces
the invariant `AGENT_BINARIES keys === agentBinary-marked AI_TOOLS ids ===
BUILTIN_ADAPTERS keys`, so this change is guarded: forgetting any one of the
three edits fails the suite loudly.

### Headless argv (verified)

OpenCode's CLI is `opencode run [message..]`. Empirically, when no positional
message is given, `opencode run` reads the prompt from **stdin**, and
`--format json` emits structured NDJSON (one event per line). The spawn adapter
mirrors the others exactly: a `CommandAgentAdapter` whose command comes from
`agentBinaryFor('opencode')` (so init stays the single source of truth for the
binary name), argv `['run', '--format', 'json']`, `passOnStdin: true`.

### Renderer extension (why emitsStreamJson is backed by real work)

The existing stream-json renderer (`stream-json-renderer.ts`) is capability-
gated (on `emitsStreamJson`, never the agent name — per `multi-agent-support`),
but its `dispatch` switch parses **claude's** event schema only:
`system`/`stream_event`/`assistant`/`user`/`result`, with `message.content[]`
content blocks and `stream_event.event.delta.text` deltas. OpenCode emits a
**different** envelope: top-level `type` of `step_start`/`text`/`step_finish`,
each carrying a nested `part` object (`part.text`, `part.reason`,
`part.tokens.{total,input,output}`, `part.cost`). Without extension, every
opencode line would hit the renderer's `default` branch and raw-dump as JSON
— no crash (guaranteed by `graceful-degradation.feature`), but no prose
streaming, no tool labels, no closing summary. Shipping a "capable" adapter
whose output is not actually rendered would contradict the rationale, so the
flag is backed by a real renderer extension in this same change:

- `case 'step_start'` → control noise, dropped (mirrors claude's `system`).
- `case 'text'` → read `obj.part.text`, accumulate/print prose live, so
  consecutive `text` events stream incrementally like claude's deltas.
- `case 'step_finish'` → read `part.reason`, `part.tokens.{total,input,output}`,
  `part.cost`; render a closing usage summary mirroring the claude `result`
  summary; an error `reason` is flagged.
- Unknown opencode `part.type` under a recognized top-level `type` falls
  through to the existing raw-line contract — no new failure mode.

The renderer stays **multi-schema, not agent-named**: claude's branches are
untouched (a regression test asserts this), and the capability flag remains
the only gate. No `--settings`/config-file lifecycle is introduced.

### Permission posture (best-effort, documented)

`opencode run --help` exposes a single permission knob,
`--dangerously-skip-permissions` ("auto-approve permissions that are not
explicitly denied"). There is **no argv-only bounded auto-edit mode** analogous
to claude's `acceptEdits` or gemini's `auto_edit`. This mirrors the cursor
situation (config-file-only allow/deny, argv cannot express a bounded posture),
so the opencode mapper follows the same honest, strictly-narrower approach
already established for cursor:

- `full-autonomy` → `--dangerously-skip-permissions` (the bypass, reserved
  for full autonomy only — identical semantic to claude).
- `repo-sandboxed-permissive` / `curated-allowlist` → no bypass flag; emit a
  one-time-per-process warning that the posture is bounded only by opencode's
  own default gating, NOT silently equivalent to full autonomy. This is the
  accepted, documented limitation under the locked argv-only decision in
  `agent-permissions.ts` (no `--settings`/config-file lifecycle).

This keeps opencode strictly narrower than full autonomy under the sandboxed
default, rather than silently promoting it to the bypass. The mapper is pure
(policy in, argv fragment out), so it is fully unit-testable without spawning.

### Delegation preserved

The engine's spawn path already delegates every transition to the canonical
`/rct-<transition> <change>` skill (`buildAgentInstructions` in
`instructions.ts`) and injects the step context (change name, phase
goal/success/proof-of-work, guidance) alongside it. Adding opencode changes
**none** of that — it only adds the argv shape and permission flags for the
opencode binary. No parallel inline lifecycle prompt is introduced (per the
`delegated-lifecycle` standard). The skill-in-spawn-locus guarantee
(`skill-locus.ts`) already renders `.opencode/commands/rct-<id>.md` via the
existing opencode `ToolCommandAdapter`, so opencode needs no special
spawn-time rendering — only its adapter registration.

### Doctor, automatically

`ratchet doctor`'s agent preflight iterates `AGENT_BINARIES` (derived from
`AI_TOOLS`), so adding `agentBinary: 'opencode'` automatically makes doctor
probe the `opencode` binary on PATH — no doctor code edit is required (and the
existing doctor test asserts the "at least one installed" rule still passes).

### Trade-offs

- **Bounded-unattended-shell for opencode is not expressible in argv.** The
  sandboxed posture may prompt/stall on shell steps in headless mode, exactly
  as documented for gemini and cursor. Operators needing unattended shell for
  opencode must use `full-autonomy` or a `raw.opencode` override. This is
  honest and strictly narrower than defaulting to the bypass.
- **No new execution locus.** opencode runs under the existing `local`/`docker`
  ReX sidecar and `remote` REST loci unchanged; only the per-agent argv differs.
- **The renderer is now multi-schema, not claude-only.** This is a deliberate
  widening: the `dispatch` switch gains a second event envelope (opencode's)
  alongside claude's. The capability flag stays the single gate, so a future
  stream-json agent reuses the renderer by setting `emitsStreamJson: true` and
  adding its own `dispatch` branches — never by special-casing the agent name.

## Tasks

- [x] 1.1 Add `agentBinary: 'opencode'` to the opencode entry in `AI_TOOLS` (`src/core/config.ts`)
- [x] 1.2 Register the `opencode` `CommandAgentAdapter` in `BUILTIN_ADAPTERS` (`src/core/batch/engine/agent.ts`) with argv `['run', '--format', 'json']`, `passOnStdin: true`, `emitsStreamJson: true`
- [x] 1.3 Add `opencodeFlags` posture mapper to `src/core/batch/runtime/agent-permissions.ts` and register it in `AGENT_MAPPERS` (full-autonomy → `--dangerously-skip-permissions`; sandboxed/curated best-effort + one-time warning)
- [x] 1.4 Add `'opencode'` to `PERMISSION_RAW_AGENTS` and the `raw` object in `PermissionsPolicySchema` (`src/core/batch/permissions-policy.ts`)
- [x] 2.1 Extend `src/core/batch/engine/runtime/stream-json-renderer.ts` `dispatch` with opencode branches: `step_start` (dropped), `text` (stream `part.text` prose), `step_finish` (closing summary from `part.reason`/`part.tokens`/`part.cost`); unknown `part.type` falls through to the raw-line contract. Leave claude's branches untouched.
- [x] 2.2 Add stream-json renderer unit tests to `test/batch-engine/stream-json-renderer.test.ts` for each opencode branch (`step_start` dropped; `text` prose streamed; `step_finish` summary with usage/cost; error `reason` flagged; unknown `part.type` raw-fallback) and a regression asserting claude's branches are unchanged
- [x] 3.1 Update `test/core/batch/agent-init-link.test.ts`: opencode is now an included spawnable agent (flip the "excludes opencode" assertions; add `AGENT_BINARIES.opencode === 'opencode'`)
- [x] 3.2 Update `test/batch-engine/agent.test.ts`: assert opencode is stream-json-capable with argv `['run', '--format', 'json']`; keep codex/gemini/cursor non-capable
- [x] 3.3 Add opencode permission-flag unit tests to `test/batch-engine/agent-permissions.test.ts` (full-autonomy emits `--dangerously-skip-permissions`; sandboxed/curated do not; `raw.opencode` fragment appended; other-agent `raw` ignored)
- [x] 3.4 Verify `test/core/available-tools.test.ts` opencode detection still passes unchanged (skillsDir-based detection unaffected by agentBinary)
- [x] 4.1 Update `docs/engine/agent-runtime.md`: add opencode to the spawnable-agents table (`.opencode/commands/rct-<id>.md`) and remove the "opencode has no batch-engine spawn adapter" exclusion note; document the multi-schema renderer extension (opencode event branches) per the `documentation` standard; update any agent overview table/Mermaid node set to include opencode
- [x] 4.2 Update `docs/commands/init.md` so opencode is listed as a spawnable coding agent
- [x] 4.3 Update `README.md` so the batch-supported agents list includes opencode (per the `documentation` standard's README requirement)
- [x] 5.1 Run `pnpm run build` then `pnpm test` and confirm the suite + coverage gate are green at or above the enforced threshold (per the `testing` standard)
