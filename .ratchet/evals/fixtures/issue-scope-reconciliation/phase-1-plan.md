# gate-and-mark-agent-cmd-override

Phase-one change plan excerpt, as reported in issue #100's worked example. This
is the plan AS AUTHORED (shipped in PR #97) — the input to the check, not a
model to copy. The `## Out of scope` bullet below is the self-approved de-scope:
no tracking issue was filed, no owner was named, and no human was asked.

## Why

The env override seams are read unconditionally at spawn time in production
code, so a leftover `RATCHET_BATCH_AGENT_CMD` silently replaces the configured
coding agent with no signal in the console or the journal.

## What Changes

- A loud one-line notice on every spawn made while an override is active, in
  both text and `--json` output (an `agentOverride: true` field).
- Override provenance (`via: "env-override"`) stamped into every journal entry
  and run record produced under an override.
- A single shared `buildAgentSpawnRequest` helper replacing the three duplicated
  override+resolveAdapter copies in the engine, the judge, and the mutation
  harness.

## Design

Out of scope (kept thin per the vertical-slice strategy): the issue's "consider
an explicit opt-in flag / NODE_ENV gate" (proposal item 3) — … an opt-in gate
would break every existing e2e/eval harness invocation; revisit if #78's
corroboration work (phase 2) still needs it.

## Tasks

- [x] Print the override notice on every spawn (text and `--json`).
- [x] Stamp `via: "env-override"` into journal entries and run records.
- [x] Extract `buildAgentSpawnRequest` and route all three call sites through it.
