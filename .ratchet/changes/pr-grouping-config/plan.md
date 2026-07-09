# pr-grouping-config

## Why

Phase 2 of the `per-stage-agents-and-prs` batch spawns a dedicated PR agent at
batch completion to open a single whole-batch PR. Before any spawn or engine
orchestration exists, the config surface it will read must exist and validate:
a `prGrouping` mode (`off` default, or `whole-batch`) and a fourth routable
`pr` agent stage. This is the schema-only foundation slice — validated shape
only, spawned nowhere yet — mirroring how Phase 1's `agent-stage-map-schema`
landed the stage-map before `agent-stage-resolution` consumed it.

## What Changes

- A new batch setting `prGrouping` accepts **either** `off` (the default) **or**
  `whole-batch`, validated at both project-config scope
  (`src/core/project-config.ts`) and per-change manifest scope
  (`src/core/batch/manifest.ts`). Any other value (e.g. `per-change`, `bogus`)
  is rejected by the schema. `per-change`/`per-phase` are deliberately NOT yet
  accepted — they arrive with Phase 3 (`stacked-pr-grouping-modes`).
- `prGrouping` resolves as a nearest-wins scalar (default ← project ← manifest)
  with a built-in default of `off`, so an unset setting resolves to `off` and
  behavior is unchanged.
- The shared `agent` stage-map vocabulary
  (`AGENT_STAGE_KEYS` in `src/core/batch/agent-setting.ts`) gains `pr` as a
  fourth routable stage alongside `propose`, `apply`, `verify`. A stage-map that
  names `pr` validates and resolves at both scopes; an unknown stage key (e.g.
  `deploy`) is still rejected.
- Documents the new `prGrouping` key and the `pr` stage in
  `docs/configuration/config-yaml.md` and `README.md`.
- Implements `features/pr-grouping-config/schema.feature`.

Not a breaking change: no existing config uses `prGrouping` (it defaults to
`off`), and adding `pr` only widens the set of accepted stage keys — every
existing scalar/partial-map `agent` value validates and resolves exactly as
before.

## Design

**`prGrouping` mirrors the existing scalar-enum settings (single vocabulary per
scope, one default, one allowed-value list).** `prGrouping` is a small closed
enum exactly like `gate`/`strategy`/`proofOfWork`/`locus`, so it follows their
established shape rather than inventing a new pattern:

- A `PR_GROUPING_VALUES = ['off', 'whole-batch'] as const` tuple and a
  `PrGrouping` type in `src/core/batch/config.ts`, the single source of truth
  for the vocabulary (the two schemas key off it, and Phase 3 extends this one
  tuple).
- The project-config `batch` object and the manifest
  `BatchSettingsOverrideSchema` each add
  `prGrouping: z.enum(PR_GROUPING_VALUES).optional()`, so an invalid mode is
  rejected identically at both scopes. The manifest object stays `.strict()`
  (`prGrouping` is a known key). Both schemas already import from sibling
  `batch/*` modules, so importing the tuple introduces no new import cycle
  (`project-config.ts` may import `batch/config.ts`'s value-only exports the
  same way it already imports `batch/agent-setting.ts` and
  `batch/permissions-policy.ts`; if a cycle is observed at build time, the tuple
  is hoisted into `agent-setting.ts` or a tiny sibling module, matching the
  `permissions-policy.ts` precedent — decided at implementation by what the
  compiler accepts).
- `BatchSettings.prGrouping: PrGrouping` is added with default `'off'` in
  `DEFAULT_BATCH_SETTINGS`, `'prGrouping'` is added to `SETTING_KEYS`, the
  `sources` map, and `ALLOWED_VALUES.prGrouping = PR_GROUPING_VALUES` (so
  `batch config --set prGrouping=…` validates the enum and rejects a bad value
  before writing). Resolution needs no new code: the generic nearest-wins loop
  over `SETTING_KEYS` already cascades default ← project ← manifest, so an unset
  value stays `off` and a nearer scope wins.

**`pr` is added to the ONE shared stage vocabulary, not special-cased.** Per
`multi-agent-support`, the stage *keys* are the agent-neutral lifecycle stages
and the stage *values* stay free-form agent-name strings — no `z.enum` of agent
names, no per-agent branching. Adding `pr` is a single edit to
`AGENT_STAGE_KEYS = ['propose', 'apply', 'verify', 'pr']`: the derived
`AgentStageMapSchema` (`.partial().strict()` of `z.string()`) then accepts `pr`
and still rejects unknown keys, `AgentStage` widens to include `'pr'`, and the
`resolveAgentSetting` merge loop and `resolveAgentForStage` lookup (which
already iterate `AGENT_STAGE_KEYS`) cover `pr` with no further change. This stays
schema-only: `Transition` (`propose|apply|verify`) is a strict subset of the
widened `AgentStage`, so every existing engine call site
(`instructions.ts`, `skill-locus.ts`, `engine.ts`) that passes a `Transition`
where an `AgentStage` is expected still type-checks — no current transition maps
to `pr`, so nothing spawns a PR agent yet (that is `pr-spawn-at-completion`).

**Generalizable defaults (`generalizable-defaults`).** `prGrouping` introduces a
new config-key default that ships into consuming repositories, so its default
must be ecosystem-agnostic. `off` and `whole-batch` are neutral mode names — no
package manager, test runner, forge CLI, or toolchain string is baked in, and
`off` (do-nothing) is the safe, behavior-unchanged default. The forge-specific
work (which CLI opens the PR) stays entirely out of this schema slice; the
setting names *whether* to group, never *how* to push.

**Resolution stays generic; no engine behavior added.** No `buildSpawnRequest`,
locus, or spawn code changes here. `prGrouping` rides the existing scalar
cascade and `pr` rides the existing stage-map machinery, keeping the slice to
config shape + vocabulary only.

**Testing (`testing`).** Pure schema/resolution logic, proven at the unit layer
(no filesystem, no spawn):
- A new `test/core/batch/pr-grouping-config.test.ts` (header names
  `features/pr-grouping-config/schema.feature`) exercises, for both
  `ProjectConfigSchema.shape.batch` and `BatchSettingsOverrideSchema`:
  `prGrouping` `off`/`whole-batch` accepted, an invalid mode rejected, an
  `agent` stage-map naming `pr` accepted, and an unknown stage key rejected.
- It also asserts `resolveBatchSettings` yields `prGrouping: 'off'` with source
  `default` when unset, and honors a project/manifest override — reusing the
  tmpdir fixture pattern already used in `config.test.ts`.
- Existing `test/core/batch/agent-setting.test.ts` /
  `agent-stage-resolution.test.ts` are extended where they assert the stage
  vocabulary so the fourth `pr` key is covered; the full suite and the coverage
  gate stay green at or above the enforced `COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** `prGrouping` and the `pr` stage
are user-facing config surfaces described in `docs/configuration/config-yaml.md`
(the `batch:` settings tables) and referenced in `README.md`. The doc task adds
a `prGrouping` row to the Gate-and-orchestration table (type/default/accepted
values/description) and updates the "Per-stage agent map" section and its
validation prose to list `pr` as a fourth stage; the `README.md` agent-map
sentence is updated to `{propose, apply, verify, pr}`. This updates existing
Reference table rows / an existing section rather than introducing a new core
component or flow, so — per the standard's "do not over-document visually"
guidance — no new overview Mermaid diagram is warranted (the Phase 2 flow
diagram lands with `whole-batch-pr-e2e-and-docs`); existing docs' structure and
terminology are matched.

## Tasks

- [x] 1.1 Add `PR_GROUPING_VALUES = ['off', 'whole-batch'] as const` and the
  `PrGrouping` type to `src/core/batch/config.ts`; add `prGrouping: PrGrouping`
  to `BatchSettings`, `'off'` to `DEFAULT_BATCH_SETTINGS`, `'prGrouping'` to
  `SETTING_KEYS`, the `sources` initializer, and
  `ALLOWED_VALUES.prGrouping = PR_GROUPING_VALUES`. Confirm the generic
  nearest-wins resolution loop cascades `prGrouping` with no bespoke code.
- [x] 1.2 Add `prGrouping: z.enum(PR_GROUPING_VALUES).optional()` to the `batch`
  object in `src/core/project-config.ts` (project-config scope).
- [x] 1.3 Add `prGrouping: z.enum(PR_GROUPING_VALUES).optional()` to
  `BatchSettingsOverrideSchema` in `src/core/batch/manifest.ts`, keeping the
  object `.strict()`.
- [x] 1.4 Add `'pr'` to `AGENT_STAGE_KEYS` in `src/core/batch/agent-setting.ts`
  (fourth routable stage), updating the module/doc comments to name
  `propose | apply | verify | pr`; confirm `AgentStageMapSchema`,
  `resolveAgentForStage`, and `resolveAgentSetting` cover `pr` unchanged and the
  engine call sites still type-check (`Transition` ⊆ `AgentStage`).
- [x] 2.1 Add unit test `test/core/batch/pr-grouping-config.test.ts` (header
  names `features/pr-grouping-config/schema.feature`) covering, for both the
  project-config `batch` schema and the manifest override schema:
  `prGrouping` `off`/`whole-batch` accepted, invalid mode rejected, an `agent`
  map naming `pr` accepted, unknown stage key rejected; plus `resolveBatchSettings`
  defaulting `prGrouping` to `off` (source `default`) and honoring an override.
- [x] 2.2 Extend existing `test/core/batch/agent-setting.test.ts` and
  `agent-stage-resolution.test.ts` where they assert the stage vocabulary to
  cover the fourth `pr` key; confirm the full suite + coverage gate stay green.
- [x] 3.1 (`documentation`, mandatory) Add a `prGrouping` row to the
  Gate-and-orchestration table in `docs/configuration/config-yaml.md`
  (type `string`, default `off`, accepted `off` `whole-batch`, description of
  whole-batch PR grouping), update the "Per-stage agent map" section + its
  validation prose to list `pr` as a fourth lifecycle stage, and update the
  `README.md` agent-map sentence to `{propose, apply, verify, pr}`; keep tone
  and terminology consistent with the existing docs.
