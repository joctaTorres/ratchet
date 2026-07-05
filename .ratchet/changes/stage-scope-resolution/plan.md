# stage-scope-resolution

## Why

The upcoming model-failure attribution hint must name which config scope — project
config vs the batch manifest — supplied the exact `agent[:model]` spec that a failed
stage ran under. Today `resolveAgentSetting` in `src/core/batch/config.ts` reports only
the single nearest scope that contributed ANY agent value, but under the
nearest-wins-per-stage merge each stage's winning spec can come from a different scope,
so per-stage attribution is impossible with what resolution currently exposes.

## What Changes

- Add an exported, pure per-stage scope lookup beside `resolveAgentSetting` in
  `src/core/batch/config.ts`: given the same low→high layers input
  (`{ scope, agent }[]`), it returns which scope supplied each stage's resolved
  `agent[:model]` spec string (`Partial<Record<AgentStage, SettingSource>>`; a stage
  nothing supplied is absent).
- Export the existing module-private `resolveAgentSetting` so the
  attribution-agrees-with-merge invariant is unit-testable over in-memory layers.
- No behavior change anywhere else: `resolveBatchSettings`, the merge semantics, and
  every resolved settings/sources value stay byte-for-byte unchanged.
- Implements `features/agent-scope-attribution/stage-scope-lookup.feature`.

## Design

**A pure sibling lookup, not a widened merge.** The lookup
(`resolveAgentStageScopes`) replays the exact fold `resolveAgentSetting` already
performs, tracking scopes instead of values: a **scalar** layer sets a base scope and
resets the accumulated per-stage scopes (a scalar covers every stage, nearest-wins); a
**map** layer records its own scope for each stage it names (nearer stage wins). The
attribution for a stage is its per-stage scope, falling back to the base scope when a
scalar contributed, and absent when nothing supplied that stage — exactly mirroring the
merge's `stages[stage] ?? base` materialization, so an attributed scope always names
the layer whose value IS that stage's resolved spec string.

Returning scopes from `resolveAgentSetting` itself was rejected: the definition of done
requires resolved settings and merge results byte-for-byte unchanged, and a separate
pure function keeps zero risk of drift in the shipping merge while staying
unit-testable over in-memory inputs with no filesystem or spawn. The lookup is
default-free (`undefined`/absent means "the caller's default agent supplied the stage,
no config scope did"), mirroring how `resolveAgentForStage` keeps defaults out of
resolution. It hardcodes no agent name and consumes only spec strings opaquely, so it
is agent-neutral by construction (multi-agent-support standard); it ships no default
value into consuming repositories (generalizable-defaults is not implicated).

**Testing (testing standard).** This is a pure evaluator, so coverage lands at the
unit layer — deterministic in-memory layer inputs, no filesystem, no fixture repo —
in `test/core/batch/agent-scope-resolution.test.ts`, with the `.feature` named in the
test file header. Scenarios cover scalar, partial-map, mixed-scope (scalar +
partial-map), map-over-map, nearer-scalar-reset, and unset layerings, plus the
agreement invariant that pairs the lookup with `resolveAgentSetting` over the same
layers and asserts (a) the merge result is unchanged and (b) each attributed scope's
layer supplies exactly that stage's resolved spec string. The full suite and the
coverage gate stay green.

**Documentation (documentation standard).** The component touched is the batch
`agent` setting's cross-scope merge, documented in
`docs/configuration/config-yaml.md`; its "Cross-scope merge (nearest-wins per
stage)" section gains a factual sentence that resolution attributes each stage's
winning spec to the scope that supplied it (project config vs manifest). No
user-facing command, flag, config key, or behavior changes, so `README.md` is
reviewed for staleness but needs no content change.

## Tasks

## 1. Per-stage scope lookup

- [x] 1.1 Add exported pure `resolveAgentStageScopes(layers: { scope: SettingSource; agent: AgentSetting | undefined }[]): Partial<Record<AgentStage, SettingSource>>` beside `resolveAgentSetting` in `src/core/batch/config.ts`, replaying the same scalar-resets / map-merges-per-stage fold over scopes (base-scope fallback for scalar-covered stages; absent when nothing supplied a stage), with no agent name hardcoded and no change to `resolveAgentSetting`'s or `resolveBatchSettings`'s logic or results
- [x] 1.2 Export the existing `resolveAgentSetting` function (module-private today) unchanged, so the agreement invariant can be unit-tested over in-memory layers

## 2. Unit tests (testing standard, unit layer)

- [x] 2.1 Create `test/core/batch/agent-scope-resolution.test.ts` (header names `features/agent-scope-attribution/stage-scope-lookup.feature`) covering: scalar-only layering (every stage `project`), nearer scalar (every stage `manifest`), partial-map-only (named stage attributed, others absent), mixed scalar+map (map stage `manifest`, scalar-covered stages `project`), map-over-map (per-stage nearest-wins, unmapped stages absent), nearer-scalar reset (all `manifest`), and unset (no attribution) — all pure in-memory inputs, no filesystem
- [x] 2.2 Add the agreement-invariant test: for each layering above, run `resolveAgentSetting` and `resolveAgentStageScopes` over the same layers and assert the merge output equals the pre-change expected value byte-for-byte and every attributed stage's scope layer supplies exactly that stage's resolved spec string (undefined resolved spec ⇔ no attribution)
- [x] 2.3 Run `pnpm test test/core/batch/agent-scope-resolution.test.ts` and the full `pnpm test` suite; both green with the coverage gate satisfied

## 3. Documentation (documentation standard)

- [x] 3.1 Update `docs/configuration/config-yaml.md` — in the "Cross-scope merge (nearest-wins per stage)" section, add a factual note that resolution records, per stage, which scope (project config vs manifest) supplied the winning `agent[:model]` spec; review `README.md` and confirm no described behavior went stale (no user-facing surface changed)
