# standalone-agent-flag-error

## Why

PR #95 review finding 4: pre-fix, a malformed standalone `--agent` value (e.g.
`claude:`) sailed past `resolveChangeStepSettings` and blew up later as a plain
`Error` thrown by `parseAgentSpec` inside `ensureCommandInSpawnLocus`
(`src/core/batch/engine/skill-locus.ts:205`) — the engine's catch blocks handle
only `SkillLocusError`/`UnknownAgentError`, so the throw escaped raw with no
structured, journaled failed step. The sibling `config-write-load-honesty`
change has since routed the `--agent` override through `validateSetting` in
`resolveChangeStepSettings` (throwing an actionable error naming the value
before any spawn), but finding 4 is not closed: nothing proves that behavior
end-to-end at the command seams the operator actually drives, and the
skill-locus `parseAgentSpec` call is still a bare raw-throw seam — any spec
that slips past upstream validation (or a future regression that removes it)
crashes the engine instead of failing the step structurally.

## What Changes

Implements `features/standalone-agent-flag/fail-before-spawn.feature` and
`features/standalone-agent-flag/engine-structured-failure.feature`.

- Harden the residual engine seam: `ensureCommandInSpawnLocus`
  (`src/core/batch/engine/skill-locus.ts:205`) wraps its `parseAgentSpec` call
  so a malformed resolved spec throws `SkillLocusError` — actionable, naming
  the offending value, stating the agent is not spawned — instead of a plain
  `Error`. The engine's existing `SkillLocusError` catch blocks then map it to
  a structured `failed` step with no code change.
- Prove the flag boundary at the command layer: integration tests in
  `test/commands/{propose,apply,verify}.test.ts` drive each standalone verb
  with `--agent "claude:"` through injected `EngineDeps` and assert the
  rejection names the value and the spawn seam is never invoked.
- Extend the phase-proof suite `test/batch-engine/agent-model-selection.test.ts`
  with the standalone-flag scenarios: malformed values (`"claude:"`,
  `" claude"`, `"claude:-flag"`) throw from `resolveChangeStepSettings` naming
  each value; valid bare (`claude`) and spec-form (`claude:fable`) overrides
  behave byte-for-byte unchanged (no model flag vs `--model fable`).
- Unit-test the skill-locus wrap in `test/batch-engine/skill-locus.test.ts`
  (malformed spec → `SkillLocusError` naming the value; valid spec → adapter
  resolved unchanged) and the engine mapping in
  `test/batch-engine/engine-skill-locus.test.ts` (structured `failed` step,
  no raw escape, no spawn).
- Documentation: update `docs/commands/{propose,apply,verify}.md` so the
  invalid-flag bullet states that a malformed `agent[:model]` spec is rejected
  with an actionable error naming the offending value before any spawn, and
  confirm the `README.md` headless-verbs section stays accurate.

No breaking changes: every previously-valid `--agent` value (bare name or
spec form) resolves and spawns exactly as before.

## Design

**Fail at the earliest boundary; never crash at a later one.** The primary
defense is already in place at the flag boundary (`resolveChangeStepSettings`
→ `validateSetting` → shared `AgentSettingSchema`/`parseAgentSpec`), matching
the `src/commands/apply.ts` "actionable error" contract: a plain `Error` with
a message naming the value, thrown before any settings mutation or spawn —
the same contract `assertApplyPreconditions` uses. This change deliberately
adds no second validation pass at the command layer (the write path and flag
path must never diverge from the loader; one shared schema stays the single
authority) — it *proves* the seam instead.

**Wrap, don't re-validate, in the engine.** `ensureCommandInSpawnLocus` runs
before instruction-building and spawn on every step path, and its
`SkillLocusError` is already caught and mapped to a structured `failed` step
(resumable, journaled, "agent is NOT spawned") at all four engine call sites.
Wrapping the `parseAgentSpec` call there in a try/catch that rethrows
`SkillLocusError` (message: the parser's own value-naming text plus the
no-spawn statement) is the thinnest change that makes "never a raw unhandled
Error from skill-locus or engine internals" true: any malformed spec that
reaches the engine — whatever its origin — funnels into the one structured
failure channel that already exists. The later `parseAgentSpec` call sites
(`instructions.ts`, `engine.ts:831`) sit behind this guarantee for the same
stage resolution, so hardening the first seam covers the step flow without
scattering try/catch through the engine.

**Agent-neutral by construction** (multi-agent-support standard): the wrap
and the error text operate on the spec string; no agent name is
special-cased, and the tests exercise a non-default agent spec alongside the
default. **No lifecycle re-authoring** (delegated-lifecycle standard): the
change touches only the mechanical spawn-guarantee seam; instruction content,
transitions, and done-rules are untouched.

**Test layers** (testing standard): the wrap and the settings resolution are
unit-tested over in-memory inputs/tmpdir fixtures; the command verbs get
integration tests through injected `EngineDeps` (no real spawn, tmpdir
fixture, mirrored `.feature` header); the phase proof stays at
`test/batch-engine/agent-model-selection.test.ts` driving the real
resolution seams — no hand-rolled re-parse.

## Tasks

- [x] 1.1 Wrap the `parseAgentSpec` call in `ensureCommandInSpawnLocus`
      (`src/core/batch/engine/skill-locus.ts`) so a malformed resolved spec
      rethrows as `SkillLocusError` naming the offending value and stating the
      agent is not spawned
- [x] 1.2 Unit tests in `test/batch-engine/skill-locus.test.ts`: malformed
      spec (`claude:`) → `SkillLocusError` naming the value; valid spec
      (`claude:fable`) resolves the adapter unchanged (mirror
      `engine-structured-failure.feature` in the header)
- [x] 1.3 Engine-mapping test in `test/batch-engine/engine-skill-locus.test.ts`:
      a change step whose settings carry a malformed spec yields a structured
      `failed` step with a blocker naming the spec, no raw escape, and zero
      spawn attempts
- [x] 2.1 Integration tests in `test/commands/propose.test.ts`,
      `test/commands/apply.test.ts`, and `test/commands/verify.test.ts`: each
      standalone verb with `--agent "claude:"` rejects with an error naming
      the value before the injected spawn seam is ever invoked (mirror
      `fail-before-spawn.feature`)
- [x] 2.2 Extend `test/batch-engine/agent-model-selection.test.ts` with the
      standalone-flag scenarios: `resolveChangeStepSettings` throws naming
      `"claude:"`, `" claude"`, and `"claude:-flag"`; valid `--agent claude`
      and `--agent claude:fable` behave byte-for-byte unchanged (no model
      flag vs `--model fable`)
- [x] 3.1 Documentation (documentation standard, mandatory): update
      `docs/commands/propose.md`, `docs/commands/apply.md`, and
      `docs/commands/verify.md` so the invalid-`--agent` bullet states that a
      malformed `agent[:model]` spec is rejected with an actionable error
      naming the offending value before any spawn; verify the `README.md`
      headless-verbs section (standalone settings flags) still matches and
      update it if stale
- [x] 3.2 Run the phase proof `pnpm test test/batch-engine/agent-model-selection.test.ts`
      and the full suite with the coverage gate; both green
