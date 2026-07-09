# agent-stage-map-schema

## Why

The batch `agent` setting is a single scalar string, so a batch can only run
every lifecycle stage on one coding agent. Phase 1 of the
`per-stage-agents-and-prs` batch wants a user to route stages independently
(e.g. `claude` proposes while `opencode` applies and verifies). This change is
the first, schema-only slice: teach the `agent` setting to accept a per-stage
`{propose, apply, verify}` map (or a scalar, as today) and validate it at both
config scopes — before any resolution or spawn logic is touched (that is the
sibling change `agent-stage-resolution`).

## What Changes

- The batch `agent` setting accepts **either** a scalar agent name (unchanged)
  **or** a partial `{propose, apply, verify}` stage-map. An unset `agent` still
  means "default agent for all stages".
- A new shared schema/type module (`src/core/batch/agent-setting.ts`) defines
  the stage-key vocabulary once and exports the union schema + resolved type, so
  the two config scopes validate identically and the vocabulary is never
  duplicated.
- The project-config batch schema (`src/core/project-config.ts`) and the
  per-change manifest override schema (`src/core/batch/manifest.ts`) both use the
  shared schema for `agent`.
- The resolved `BatchSettings.agent` TypeScript type
  (`src/core/batch/config.ts`) widens from `string` to
  `string | AgentStageMap`; nearest-wins whole-value resolution is unchanged
  (per-stage *merge* is deliberately out of scope — it is the sibling
  `agent-stage-resolution` change).
- Invalid stage keys (e.g. `deploy`) and non-string stage values (e.g. `42`) are
  rejected by the schema at both scopes, via a `.partial().strict()` object of
  `z.string()` stage values.
- Implements `features/agent-stage-map/schema.feature`.

Not a breaking change: every existing scalar `agent` value and every unset
`agent` validates and resolves exactly as before.

## Design

**One shared schema, two scopes (single source of truth).** Both the
project-config `batch.agent` field and the manifest
`BatchSettingsOverrideSchema.agent` field currently declare
`z.string().optional()` independently. To satisfy the definition of done ("at
both project-config and manifest scope") without divergence, the union schema is
defined once in a small standalone module and imported by both. A standalone
module (mirroring `permissions-policy.ts`) avoids the existing
`project-config ↔ batch/config` import cycle: `project-config.ts` may import
`batch/agent-setting.ts` but must not import `batch/config.ts`.

**Shape of the union.**

```ts
export const AGENT_STAGE_KEYS = ['propose', 'apply', 'verify'] as const;
export type AgentStage = (typeof AGENT_STAGE_KEYS)[number];

export const AgentStageMapSchema = z
  .object(Object.fromEntries(AGENT_STAGE_KEYS.map((k) => [k, z.string()])))
  .partial()   // any subset of stages may be provided
  .strict();   // an unknown stage key (e.g. `deploy`) is rejected

export const AgentSettingSchema = z.union([z.string(), AgentStageMapSchema]);
export type AgentStageMap = z.infer<typeof AgentStageMapSchema>;
export type AgentSetting = z.infer<typeof AgentSettingSchema>;
```

- `z.union([z.string(), …])` keeps the scalar path byte-for-byte compatible.
- `.partial()` accepts a partial map (only the stages the user overrides);
  `.strict()` rejects unknown stage keys.
- Each stage value is `z.string()`, so a non-string value (number, boolean,
  object) fails validation — satisfying "non-string agent values are rejected".
- The stage vocabulary is derived from the same `propose|apply|verify` lifecycle
  the engine already models (`Transition` in
  `src/core/batch/engine/contract.ts`); this change keeps `AGENT_STAGE_KEYS` as a
  local constant to stay schema-only, and the sibling resolution change keys off
  the same three stages.

**Agent-neutral by construction (`multi-agent-support`).** Stage *values* stay
free-form strings — the schema does not enumerate or special-case any single
agent (no `z.enum(['claude', …])`), so every agent in the supported-tools
registry is equally valid and the "unknown agent name" check remains a
resolution/spawn-time concern (the phase's later slice), not a schema concern.
The stage *keys* are the agent-neutral lifecycle stages. Nothing here renders or
depends on one agent's invocation syntax.

**Resolution stays whole-value (scope kept thin).** `resolveBatchSettings`
copies `agent` nearest-wins over `SETTING_KEYS`; with the widened union type this
assignment still type-checks and behaves as before (a nearer scope replaces the
whole value). Per-stage cross-scope *merge* — the interesting resolution work —
is explicitly deferred to `agent-stage-resolution`, so this change adds no
resolution behavior and no `buildSpawnRequest` change. The `batch config --set`
CLI setter (`ALLOWED_VALUES.agent = null`, free-form string) is likewise
unchanged: a stage-map is authored directly in config/manifest YAML, not via
`--set`; documenting that boundary keeps the slice minimal.

**Testing (`testing`).** The behavior is pure schema validation, so it is proven
at the unit layer (no filesystem, no spawn): a new
`test/core/batch/agent-setting.test.ts` exercises `AgentSettingSchema` and the
two scopes' schemas directly — scalar accepted, full map accepted, partial map
accepted, unset accepted, unknown stage key rejected, non-string value rejected —
for both `ProjectConfigSchema.shape.batch` and `BatchSettingsOverrideSchema`. The
test header names `features/agent-stage-map/schema.feature`. Existing
`test/core/batch/config.test.ts` and `manifest.test.ts` are extended where they
assert the `agent` field so the widened type is covered. The full suite and the
coverage gate stay green at or above the enforced `COVERAGE_THRESHOLD`.

**Documentation (`documentation`).** The `agent` config key is a user-facing
surface described in `docs/configuration/config-yaml.md` (the batch-settings
table row) and referenced in `README.md`. Both are updated in the same change to
describe the new union (scalar name **or** `{propose, apply, verify}` map),
partial maps, and the validation rules. This change updates an existing Reference
table row rather than introducing a new core component/flow, so — per the
standard's "do not over-document visually" guidance — no new overview Mermaid
diagram is warranted; the existing docs' structure and terminology are matched.

## Tasks

- [x] 1.1 Add `src/core/batch/agent-setting.ts` exporting `AGENT_STAGE_KEYS`,
  `AgentStageMapSchema` (`.partial().strict()` of `z.string()` stage values),
  `AgentSettingSchema` (`z.union([z.string(), AgentStageMapSchema])`), and the
  inferred `AgentStage` / `AgentStageMap` / `AgentSetting` types.
- [x] 1.2 Use `AgentSettingSchema` for `batch.agent` in
  `src/core/project-config.ts` (project-config scope).
- [x] 1.3 Use `AgentSettingSchema` for `agent` in `BatchSettingsOverrideSchema`
  in `src/core/batch/manifest.ts` (manifest scope), keeping the object `.strict()`.
- [x] 1.4 Widen `BatchSettings.agent` in `src/core/batch/config.ts` from
  `string` to `string | AgentStageMap` (import the type from the shared module),
  confirming nearest-wins resolution still type-checks with no behavior change.
- [x] 2.1 Add unit test `test/core/batch/agent-setting.test.ts` (header names
  `features/agent-stage-map/schema.feature`) covering scalar/full-map/partial-map/
  unset accepted and unknown-stage-key/non-string-value rejected, for both the
  project-config `batch` schema and the manifest override schema.
- [x] 2.2 Extend existing `test/core/batch/config.test.ts` and
  `test/core/batch/manifest.test.ts` where they assert the `agent` field to cover
  the union type, and confirm the full suite + coverage gate stay green.
- [x] 3.1 (`documentation`, mandatory) Update the batch-settings `agent` row in
  `docs/configuration/config-yaml.md` and the corresponding `README.md` mention
  to document the scalar-or-`{propose, apply, verify}`-map union, partial maps,
  and the stage-key / non-string validation rules; keep the entry consistent with
  the existing table's tone and terminology.
