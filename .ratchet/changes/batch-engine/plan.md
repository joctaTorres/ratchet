# batch-engine

## Why

The open CLI (`batch-orchestration`) models batches, phases, and the DAG but
deliberately does not execute anything — it hands each ready step to an engine
through a versioned interface. This change builds that engine: a licensed
component that spawns the selected coding agent as a subprocess to drive one
transition forward, runs phase proof-of-work, honors gates and blockers, and
persists resumable run state. Keeping it separate protects the IP and keeps the
CLI fully usable on its own.

## What Changes

This change implements the `BatchEngine` contract defined by
`batch-orchestration`. It is distributed separately from the open CLI.

- **Single-step executor** — pick the next ready step from the batch DAG, run
  exactly one transition, return. No internal loop (looping is a later change).
  `features/engine-step/`.
- **Agent adapter** — spawn the configured coding agent as a subprocess,
  inject the resolved step context, and capture its reported outcome from the
  run journal. Pluggable so any supported agent works. `features/agent-adapter/`.
- **Transitions** — drive a change through propose → apply → verify, one per
  step; propose creates the change lazily toward the active phase goal under
  the resolved strategy (vertical-slice by default). `features/workflow/`.
- **Proof-of-work execution** — run a phase's `integration`/`blackbox` check
  via bash or an `llm-judge` that exercises the software directly, and gate
  phase completion on the result (hard-gate by default). `features/proof-of-work/`.
- **Halt & resume** — park steps on voluntary blockers and on the
  `after-propose`/`every-phase` gates; resume with the user's answer;
  reject-with-feedback re-runs propose without rollback. `features/halt-resume/`.
- **Run state & journal** — append-only journal + on-disk run state so a batch
  survives stop/resume across many `apply` invocations; single-flight per
  batch. `features/run-state/`.
- **Licensing** — the engine authenticates and obtains run authorization before
  spawning any agent; without a valid license it refuses to run. The open CLI
  is unaffected. `features/licensing/`.

## Design

**Implements the contract, owns the execution.** The engine registers against
the `BatchEngine` interface from `batch-orchestration`. The CLI passes a
resolved step context (change name, transition, phase goal/success/proof-of-work,
resolved settings, prior journal) and persists the structured result the engine
returns. The engine never reads project config or manifests directly — it
receives a resolved context, keeping the boundary clean and the contract
testable in isolation.

**Step selection.** Given the context's view of ready/blocked/gated changes,
the engine selects one runnable change and computes its next transition from
on-disk state (no change dir → propose; plan present & ungated → apply; applied
→ verify). One transition per invocation; "nothing runnable" is a normal
result, not an error.

**Agent subprocess + report channel.** Each transition spawns a fresh agent
process (good context hygiene) with instructions built from the step context.
The agent communicates back only through `ratchet batch report` (defined in the
CLI change) — progress, blockers, completion — so the adapter needs nothing
more than an agent that can run a shell command. The engine maps journal
entries written during the session to a structured step result. A non-zero
exit without a completion report is a failed step; run state stays consistent.

**Proof-of-work as the phase gate.** Once a phase's changes are all done, the
engine runs its proof-of-work. `integration`/`blackbox` run a command and check
the pass condition; `llm-judge` spawns an agent that drives the software
directly (bash or MCP browser tool) and returns a verdict against the success
criteria. Under `hard-gate` (default) a failure blocks the phase and the next
phase; under `warn` it records a warning and proceeds. Proof-of-work never runs
while a phase still has in-progress changes.

**Halt/resume and gates.** Default `voluntary`: only agent blockers park a
step. `after-propose` adds an awaiting-approval park after propose;
`every-phase` parks at each phase boundary; `autonomous` never parks for
approval but still parks on blockers. Resume re-spawns the agent with the
recorded answer or feedback in context. Reject-with-feedback re-runs propose
against the prior draft — cheap revision, no phase rollback.

**Run state.** Append-only journal plus a small run-state record reconstructed
from journal + changes on disk, so any single `apply` invocation can resume
mid-batch. A partial trailing entry from a crash is ignored. A per-batch lock
prevents two concurrent steps on the same batch.

**Licensing — make the server load-bearing.** A boolean license check is
patchable once the blob is lifted, so authorization is designed so the server
response is *functional input the engine cannot run without* (e.g.
run-authorization material obtained per run/step), not a yes/no flag. The
engine authenticates with the license key, obtains a signed run authorization
with a short-lived offline-grace lease, and refreshes within the lease. Without
valid authorization it refuses to spawn any agent. Deep server-side choreography
(serving phase/transition material) is the intended direction and is kept
behind the authorization seam so it can harden without reworking the engine.
The open CLI's `status`/`view`/`config` never touch licensing.

**Packaging.** Distributed as a separate, privately published package the CLI
loads through the contract; engine-absent is already a first-class CLI state.
Compiled-binary distribution for stronger blob protection is a later option.

## Tasks

- [x] 1.1 Scaffold the engine package and register it against the `BatchEngine` contract version from `batch-orchestration`
- [x] 1.2 Implement the resolved-step-context input type and structured step-result output type
- [x] 2.1 Implement next-transition computation from on-disk change state (propose/apply/verify) and runnable-step selection
- [x] 2.2 Implement the single-step executor: run one transition, return, with a clean "nothing runnable" result
- [x] 3.1 Define the agent adapter interface and a default adapter for the configured coding agent
- [x] 3.2 Spawn the agent subprocess with step-context-derived instructions and capture exit status
- [x] 3.3 Map run-journal entries written by the agent to a structured step result; treat non-zero-without-completion as failed
- [x] 3.4 Reject unknown agent adapters before spawning, listing available adapters
- [x] 4.1 Implement propose/apply/verify transition orchestration, including vertical-slice vs feature strategy in the propose instructions
- [x] 5.1 Implement proof-of-work execution for integration/blackbox (bash) kinds with pass-condition evaluation
- [x] 5.2 Implement the llm-judge proof-of-work (agent exercises software via bash/MCP, returns verdict)
- [x] 5.3 Implement phase gating on proof-of-work with hard-gate vs warn policy
- [ ] 6.1 Implement gate handling (voluntary, after-propose, every-phase, autonomous) and step parking
- [ ] 6.2 Implement resume with recorded answer and reject-with-feedback re-running propose without rollback
- [x] 7.1 Implement the append-only journal and run-state reconstruction (ignore partial trailing entry)
- [x] 7.2 Implement the per-batch single-flight lock
- [ ] 8.1 Implement license authentication and per-run authorization with a signed offline-grace lease
- [ ] 8.2 Refuse to spawn any agent without valid authorization; surface licensing errors clearly
- [ ] 8.3 Confirm the open CLI status/view/config paths remain fully functional with the engine absent or unlicensed
- [ ] 9.1 Tests: step selection, transition order, proof-of-work pass/fail gating, gate parking/resume, journal resume, license-absent refusal
