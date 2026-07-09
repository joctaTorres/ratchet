# doctor-spec-awareness

## Why

Phase 1 of the `agent-model-selection` batch widened every `agent` setting value to an
`agent[:model]` spec, but `ratchet doctor` still knows nothing about configured agent
values: its `agent` check only sweeps the registry of every supported CLI and passes
when ANY one binary is present. A user who configured `agent: opencode:zai/glm-5.2`
can therefore get a passing doctor report with `opencode` not installed — the batch
then fails at spawn with the very ENOENT doctor exists to preflight. Doctor must
consult the configured agent values spec-aware: parse each through `parseAgentSpec`
and probe the agent-part binary, never the whole spec string, and never validate the
model part.

## What Changes

- `checkAgents` (`src/core/doctor/checks/agents.ts`) gains a configured-agent
  consultation: it resolves the project-scope `batch.agent` setting, parses every
  string value (scalar, or each entry of a per-stage map) through `parseAgentSpec`,
  and probes the binary of each parsed **agent part** via the existing
  `AGENT_BINARIES` registry mapping.
- A configured agent whose binary is not on PATH fails the `agent` check (required
  severity) naming that agent and its binary with an install remedy — even when other
  supported binaries are detected.
- The whole spec string is never treated as a binary name, and the model part is
  never validated or mentioned: the report emits no model-related check.
- The registry-wide sweep is unchanged: every supported agent CLI is still probed,
  detected agents are still listed with best-effort versions, and the
  no-binary-at-all failure keeps today's shape.
- An agent part not present in `AGENT_BINARIES` is skipped by doctor — unknown-agent
  rejection stays at resolution time (`UnknownAgentError` in `resolveAdapter`),
  doctor does not duplicate it.
- `runDoctorChecks` (`src/core/doctor/index.ts`) passes its existing `projectRoot`
  through to `checkAgents`.
- Implements `features/doctor-spec-awareness/spec-form-binary-probe.feature` and
  `features/doctor-spec-awareness/no-model-validation.feature`.
- Reference docs: `docs/commands/doctor.md` `agent` check section updated;
  `README.md` doctor paragraph updated.

## Design

**Where the consultation lives.** Inside `checkAgents`, not a new check. The phase
requires doctor to emit no model-related check and to keep the registry-wide probe
unchanged; folding configured-agent awareness into the existing `agent` check keeps
one check id (`agent`), one label, and one pass/fail rule for "can a batch spawn its
agents", so the report vocabulary does not grow. `checkAgents(deps)` becomes
`checkAgents(deps, projectRoot)`; `runDoctorChecks` already has `projectRoot` in hand
and threads it through (same pattern as `checkPrRemote`).

**Reading the configured values.** `resolveBatchSettings(projectRoot).settings.agent`
— the same project-scope resolution `checkPrRemote` already uses. Doctor runs outside
any batch, so no manifest is passed: the values doctor consults are the project
config's, which is exactly "every configured `agent` value doctor consults". Values
reaching doctor are schema-valid (`AgentSettingSchema` refines every string position
through `parseAgentSpec` at config load), so the parse cannot throw here.

**Spec-aware probing.** Each configured value — the scalar, or each stage entry of a
map — goes through `parseAgentSpec(value).agent`; agent parts are deduped, mapped to
binaries via `AGENT_BINARIES`, and probed with `deps.hasOnPath`. The model part is
read from nowhere: no validation, no report text, no check. An agent part missing
from `AGENT_BINARIES` is skipped (spawn-time `UnknownAgentError` owns that failure;
doctor probing an unknown binary name would just duplicate it with a vaguer message).

**Failure shape.** Missing configured agent ⇒ `status: 'fail'`, `severity:
'required'` on the `agent` check, detail naming the configured agent id and its
binary, remedy naming the binary to install. This mirrors the check's charter (the
"actual ENOENT a batch run would otherwise hit, surfaced early") — a configured agent
that cannot spawn is a harder guarantee of failure than the current "no binary at
all" case. With no `agent` configured, or with every configured agent's binary
present, the check's pass/fail behavior and detail are today's, byte-for-byte in the
unconfigured case.

**Multi-agent support (multi-agent-support standard).** No agent is special-cased:
the consultation iterates whatever agent parts the user configured and maps them
through the registry-derived `AGENT_BINARIES`, and the registry-wide sweep still
iterates every supported agent. No skill/command/template surface is touched, so
there are no per-agent generated outputs to enumerate.

**Generalizable defaults.** The check ships no command or toolchain default into
consuming repositories — its detail/remedy name only the user's own configured agent
ids and the registry's binary names, as the check already does today.

**Testing (testing standard).** Unit layer: a new
`test/core/doctor/agent-spec-awareness.test.ts` following the `doctor.test.ts`
conventions — `FakeDeps` with a programmable PATH set, plus a tmpdir fixture repo
(`fs.mkdtemp`, minimal `.ratchet/config.yaml`, removed in `afterEach`) so
`resolveBatchSettings` reads real project config. The file header names both
`.feature` files. Covered: spec-form value probes the agent-part binary (pass);
whole-spec-string-on-PATH still fails (proves the spec is never a binary name);
configured-missing fails naming the agent while another agent is detected; per-stage
map probes every entry's agent part; unknown agent part skipped; bogus model id with
binary present passes and no check text mentions the model string; unset agent keeps
today's pass and fail shapes over the registry sweep. The phase's integration proof
(`test/batch-engine/model-failure-attribution.test.ts`) gains its doctor coverage in
the `model-failure-proof-and-docs` sibling, which extends that file. Full suite and
coverage gate stay green.

**Documentation (documentation standard — mandatory task 3.1).** The component
touched is the doctor `agent` check, documented in `docs/commands/doctor.md`: its
"Coding-agent CLI (`agent`)" section gains the configured-agent consultation — a
spec-form `agent[:model]` value is parsed and the agent part's binary probed, a
missing configured agent fails the check, the model part is never validated and no
model-related check exists. `README.md`'s `ratchet doctor` paragraph (line ~147) is
updated to state that doctor also verifies any agent CLIs named by the project's
`batch.agent` setting. This is a leaf behavior of one existing check, not a core
component or flow, so no new Mermaid diagram is added and no existing diagram is made
stale.

## Tasks

- [x] 1.1 Extend `checkAgents` in `src/core/doctor/checks/agents.ts` to accept
      `projectRoot`, resolve the project-scope `batch.agent` setting via
      `resolveBatchSettings`, parse every configured string value (scalar or each
      stage-map entry) through `parseAgentSpec`, dedupe the agent parts, map each to
      its binary via `AGENT_BINARIES` (skipping agent parts not in the registry), and
      probe each with `deps.hasOnPath`; a configured agent whose binary is missing
      fails the check naming the agent and binary with an install remedy; the
      registry-wide sweep, detected-version detail, and no-binary failure are
      unchanged; the model part is never read into any report text.
- [x] 1.2 Thread `projectRoot` from `runDoctorChecks` in `src/core/doctor/index.ts`
      into `checkAgents`.
- [x] 2.1 Add `test/core/doctor/agent-spec-awareness.test.ts` (unit, `FakeDeps` +
      tmpdir fixture config, header naming both `.feature` files) covering: spec-form
      probe of the agent-part binary; whole-spec-string never treated as a binary
      name; configured-missing failure alongside a detected agent; per-stage map
      probing; unknown agent part skipped; no model validation or model-related check
      (bogus model id passes, model string absent from every check); unset-agent
      registry-sweep pass and fail shapes unchanged. Full suite and coverage gate
      green.
- [x] 3.1 Documentation (documentation standard, mandatory): update
      `docs/commands/doctor.md`'s "Coding-agent CLI (`agent`)" section with the
      configured-agent consultation (spec parsing, agent-part probe, failure shape,
      no model validation) and update `README.md`'s `ratchet doctor` paragraph to
      match; no new diagram (leaf behavior of one existing check) and no existing
      diagram goes stale.
