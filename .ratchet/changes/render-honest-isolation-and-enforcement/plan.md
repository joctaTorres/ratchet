# render-honest-isolation-and-enforcement

## Why

The batch runtime's displayed security story overstates reality: `batch config`
prints a posture like `repo-sandboxed-permissive` bare, even for agents (cursor,
opencode) whose posture maps to an EMPTY argv fragment — a silent no-op — and
says nothing about what the resolved locus actually isolates (`local` isolates
nothing). Nothing nudges an operator running permissive/full-autonomy batches on
`local` toward the docker locus that phase-mate #85 hardened. This closes the
posture-honesty half of #86 and all of #88.

## What Changes

Implements `features/runtime-honesty/*.feature`.

- `ratchet batch config` renders an **isolation** line stating the real
  isolation of the resolved locus (local = advisory, no filesystem/network
  isolation, env scoped to the allowlist; docker = container isolation with the
  resolved uid/memory/pids/network contract, repo mount writable by design;
  remote = the server's boundary, not ratchet's)
  (`config-isolation-per-locus.feature`).
- `ratchet batch config` never displays a posture bare: the permissions block
  gains one enforcement line per distinct resolved stage agent
  (`claude: enforced via flags` / `cursor: NOT ENFORCED — agent defaults apply`),
  and a manifest-sourced posture renders its escalation source
  (`full-autonomy (set by batch manifest — repo-controlled)`)
  (`posture-enforcement-rendering.feature`).
- `ratchet batch config --json` carries `isolation` and per-agent `enforcement`
  fields machine-readably.
- `ratchet batch view` gains a runtime summary line reusing the same
  descriptors (`view-runtime-summary.feature`).
- `ratchet doctor` gains an optional **batch-isolation** check: warn on
  `local` + `full-autonomy`, advisory note on `local` + the permissive default,
  absent/pass on docker/remote; it never fails doctor
  (`doctor-local-locus-nudge.feature`).
- `docs/engine/agent-runtime.md` documents the threat model per locus and
  reframes the argv denylist (`REPO_SANDBOX_DENY_PATTERNS`) as best-effort
  damage reduction — real containment is the docker locus.

## Design

**Enforcement is derived from the real translator, never a parallel table.**
`src/core/batch/runtime/agent-permissions.ts` is the single place agent flags
live (its own header contract). A new exported pure query
`resolvePostureEnforcement(agentName, policy, repoRoot)` computes
`{ agent, enforced, detail }` by consulting the same per-agent mappers that
build spawn argv: a posture that yields a non-empty posture-flag fragment (or
the full-autonomy bypass flag) is `enforced via flags`; an empty fragment is
`NOT ENFORCED — agent defaults apply`. Deriving from the mappers means the
rendering can never drift from what actually reaches the agent — the exact
failure mode #88 names. The mappers' one-time `console.warn` side effects
(cursor/opencode) are gated behind an internal option so the pure query never
warns; the spawn path keeps warning exactly as today.

**Isolation descriptions are pure data over resolved settings.** A new module
`src/core/batch/runtime/isolation.ts` exports
`describeLocusIsolation(settings)` returning a short honest description per
locus, parameterized by the resolved docker knobs (`dockerUser`,
`dockerMemory`, `dockerPidsLimit`, `network`) so the docker line states the
actual #85 contract, not a generic claim. Pure function → unit tests, no
filesystem (testing standard: prove at the unit level).

**Rendering stays in the command layer.** `src/commands/batch/config.ts`
(`printResolved` + the `--json` branch) and `src/commands/batch/view.ts`
consume the two pure helpers; `resolveBatchSettings` already exposes
`sources.permissions` for the escalation-source phrasing and the per-stage
agent resolution for distinct-agent enforcement lines. No new config reads —
everything renders from the already-resolved `ResolvedBatchSettings`.

**Doctor check follows the existing check-engine pattern.** A new
`src/core/doctor/checks/batch-isolation.ts` resolves project batch settings via
`resolveBatchSettings(projectRoot, null)` and reports through the same
`DoctorCheck` shape as `checkDocker`; it is `optional` severity so
`exitCodeFor` never turns the nudge into a failure. Registered in
`runDoctorChecks` after the docker check.

**Multi-agent support (standard: multi-agent-support).** Enforcement lines are
produced by iterating the resolved stage agents and the translator registry —
no agent name is special-cased in shared render code, and the enforcement unit
tests iterate every agent in `PERMISSION_RAW_AGENTS` × every posture rather
than hard-coding claude. Per-agent outputs: this change touches CLI output and
docs only — no generated skills/commands — so no per-agent artifact files are
produced.

**Testing (standard: testing, 95% floor).** Unit: enforcement query and
isolation descriptor (pure, no fs). Integration: `batch config` /
`batch view` rendering and JSON over a tmpdir fixture repo
(`fs.mkdtemp` + `afterEach` cleanup, per the fixture pattern), and the doctor
check over injected fake deps. Each test file header names the `.feature` it
proves. Phase proof-of-work: `npm test -- test/batch-engine/` exits 0.

**Documentation (standard: documentation — mandatory, blocking).** Tasks 5.x
update `docs/engine/agent-runtime.md` (threat model per locus, denylist
reframed as best-effort damage reduction), `docs/commands/batch.md`
(config/view output incl. isolation + enforcement lines), and
`docs/commands/doctor.md` (batch-isolation check); `README.md` is updated iff
it describes the changed surfaces.

## Tasks

## 1. Pure descriptors

- [x] 1.1 Add `resolvePostureEnforcement(agentName, policy, repoRoot)` to `src/core/batch/runtime/agent-permissions.ts`, derived from the existing per-agent mappers with the cursor/opencode one-time warnings gated so the query is side-effect-free; unit tests iterate all `PERMISSION_RAW_AGENTS` × all postures (header names `posture-enforcement-rendering.feature`)
- [x] 1.2 Add `src/core/batch/runtime/isolation.ts` with `describeLocusIsolation(settings)` covering local/docker/remote, docker parameterized by resolved uid/memory/pids/network; unit tests for all three loci (header names `config-isolation-per-locus.feature`)

## 2. batch config rendering

- [x] 2.1 Render the isolation line and per-distinct-stage-agent enforcement lines in `printResolved` (`src/commands/batch/config.ts`), and phrase a manifest-sourced posture as `full-autonomy (set by batch manifest — repo-controlled)`; integration tests over a tmpdir fixture for local/docker/remote and enforced/unenforced agents
- [x] 2.2 Add `isolation` and `enforcement` fields to the `batch config --json` payload; integration test asserts the not-enforced entry for cursor

## 3. batch view + doctor

- [x] 3.1 Add the runtime summary line to `ratchet batch view` reusing the same descriptors; integration test (header names `view-runtime-summary.feature`)
- [x] 3.2 Add `src/core/doctor/checks/batch-isolation.ts` (optional severity: warn on local+full-autonomy, advisory on local+permissive default, pass/absent otherwise), register it in `runDoctorChecks`, and unit-test statuses plus that `exitCodeFor` stays 0 (header names `doctor-local-locus-nudge.feature`)

## 4. Verification

- [x] 4.1 Run `npm test -- test/batch-engine/` and the new suites to exit 0 (phase proof-of-work), fixing regressions

## 5. Documentation (documentation standard — required, blocking)

- [x] 5.1 Update `docs/engine/agent-runtime.md`: add the per-locus threat model (local advisory / docker contract / remote server boundary) and reframe `REPO_SANDBOX_DENY_PATTERNS` as best-effort damage reduction with the docker locus as real containment
- [x] 5.2 Update `docs/commands/batch.md` (config/view isolation + enforcement + escalation-source output) and `docs/commands/doctor.md` (batch-isolation check); update `README.md` iff it describes these surfaces
