# Issue #80 — engine: RATCHET_BATCH_AGENT_CMD / RATCHET_EVAL_AGENT_CMD silently replace the agent in production — no gating, no notice, no journal marker, permissions bypassed

> Source: https://github.com/joctaTorres/ratchet/issues/80
>
> Quoted verbatim. This is the originating issue from issue #100's worked example;
> it is fixture input, not a task list for the reader.

## Why

The env override seams are read unconditionally at spawn time in production code: any value is executed as `bash -c <value>` (`src/core/batch/engine/engine.ts:609-616`; `src/core/eval/judge.ts:274-277`; `src/core/eval/mutation-harness.ts:146-154`). If the var is set in any environment where a user runs `batch apply` or `eval run` — leftover from an eval session, CI, a `.envrc` — the configured coding agent is silently replaced. Three compounding problems:

1. **No signal**: no console notice, and journal entries produced under an override are indistinguishable from real agent work. A stub that appends a verify completion drives every change to `done` (see #78) with nothing marking the run synthetic.
2. **Permissions bypassed**: the override path never consults an adapter, so `resolvePermissionFlags` posture/deny output (`src/core/batch/runtime/agent-permissions.ts:252-262`) is moot while the var is set — `batch config`'s displayed posture is a lie.
3. **Triplication**: the same override+resolveAdapter logic exists in three copies (engine, judge, mutation harness), so any gating fix must land three times or be extracted first (overlaps the dedup in #67).

## Fix proposal

1. Print a loud, unmissable one-line notice on every spawn while an override is active (`⚠ agent overridden by RATCHET_BATCH_AGENT_CMD`), in both text and `--json` output (a `agentOverride: true` field).
2. Stamp override provenance into every journal entry/run record produced under it (e.g. `via: "env-override"`), so synthetic runs are auditable after the fact.
3. Consider requiring an explicit opt-in pairing flag (`--allow-agent-override`) outside of test environments, or gating the seam on `NODE_ENV`/an explicit `RATCHET_TEST=1`.
4. Extract the single `buildAgentSpawnRequest` helper (shared with #67's dedup) so the gating exists in exactly one place.

## Implementation route

Alters spawn semantics and journal/record shape — implement via `rct:propose` → `apply` → `verify`.
