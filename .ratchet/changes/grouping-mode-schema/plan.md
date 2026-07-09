# grouping-mode-schema

## Why

Phase 3 (`stacked-pr-grouping-modes`) of the `per-stage-agents-and-prs` batch
extends PR grouping from a single whole-batch PR to stacked `per-phase` and
`per-change` PRs. Before any engine boundary-detection or stacked-branch spawn
logic can consume them, the config surface must accept and validate the two new
`prGrouping` modes — otherwise a user who sets `per-phase` is rejected at load
before the feature can ever run. This is the schema-only foundation slice
(validated vocabulary + shared active-predicate only, no stacked spawn yet),
mirroring how Phase 2's `pr-grouping-config` landed `off`/`whole-batch` before
`pr-spawn-at-completion` consumed them.

## What Changes

- The batch `prGrouping` setting additionally accepts **`per-phase`** and
  **`per-change`** alongside the existing `off` (default) and `whole-batch`,
  validated identically at both project-config scope
  (`src/core/project-config.ts`) and per-change manifest scope
  (`src/core/batch/manifest.ts`). Any value outside the four-member set (e.g.
  `per-batch`, `bogus`) is still rejected at both scopes.
- The vocabulary source of truth `PR_GROUPING_VALUES` in
  `src/core/batch/config.ts` grows to
  `['off', 'whole-batch', 'per-phase', 'per-change']`, so
  `ALLOWED_VALUES.prGrouping` (and therefore `batch config --set prGrouping=…`)
  accepts the new modes and rejects anything else. Resolution needs no new code —
  the generic nearest-wins cascade already handles the widened enum, and the
  default stays `off` (unset → behavior unchanged).
- A single shared **grouping-active predicate**
  `isPrGroupingActive(mode: PrGrouping): boolean` (= `mode !== 'off'`) is added
  to `src/core/batch/config.ts` as the one home for "is PR grouping active?".
  The doctor PR-remote check (`src/core/doctor/checks/pr-remote.ts`) is
  refactored to consume it in place of its inline `=== 'off'` test, so its
  missing-remote warning **already covers** `per-phase`/`per-change` with no
  doctor-specific edit.
- Documents the two new modes: the `prGrouping` row in
  `docs/configuration/config-yaml.md` gains `per-phase` `per-change` in its
  accepted-values column with a one-line description, and the README's PR-opening
  section notes the stacked modes are additionally accepted (behavior wired in a
  later Phase 3 change).
- Implements `features/grouping-mode-schema/schema.feature`.

Not a breaking change: no existing config uses the new modes, the default is
still `off`, and every current `off`/`whole-batch`/unset config validates and
resolves exactly as before. The engine's whole-batch spawn gate
(`=== 'whole-batch'`) is untouched, so setting a new mode validates but spawns
nothing yet — the intended intermediate state until the stacked-spawn changes
land later in this phase.

## Design

**Extend the ONE vocabulary, keep the three deliberately-inlined enums in sync
(`generalizable-defaults`, `instruction-fed-config`).** `prGrouping` stays a
small closed scalar-enum exactly like `gate`/`strategy`/`proofOfWork`/`locus`.
`src/core/batch/config.ts` imports `readProjectConfig` from `project-config.ts`
and `BatchManifest` from `manifest.ts`, so those two schema modules cannot
import value exports back from `config.ts` without a cycle — which is why
`pr-grouping-config` deliberately **inlined** the `z.enum([...])` literal at both
schema scopes rather than referencing `PR_GROUPING_VALUES`. This slice preserves
that structure: the extension edits three vocabulary sites that must stay in
sync — the `PR_GROUPING_VALUES` tuple in `config.ts` (source of truth for
`ALLOWED_VALUES` / the `batch config --set` validator) and the two inline
`z.enum` literals in `project-config.ts` and `manifest.ts`. A unit assertion
guards the drift: each schema must accept exactly the members of
`PR_GROUPING_VALUES` and reject a value outside it, so an out-of-sync list fails
CI rather than silently diverging. (No cycle is introduced — the schemas keep
inlining; only value-only consumers that already import `config.ts`, like the
doctor check, reference the tuple/predicate.)

**One shared grouping-active predicate is the single home for "is grouping
active?" (`delegated-lifecycle`, DRY).** Today the doctor PR-remote check inlines
the rule as `if (prGrouping === 'off') return null;`. Because the two new modes
are non-`off`, that inline test *happens* to cover them — but the DoD wants the
rule to live in exactly one shared place so every consumer inherits the correct
answer as the vocabulary grows. `isPrGroupingActive(mode) => mode !== 'off'` is
added beside `PR_GROUPING_VALUES`/`PrGrouping` in `config.ts` (a value-only
export; the doctor module already imports `resolveBatchSettings` from there, so
no new import edge and no cycle). The doctor check calls
`isPrGroupingActive(prGrouping)` instead of its inline comparison — a behavior-
preserving refactor for `off`/`whole-batch` that automatically returns `true`
for `per-phase`/`per-change`, so the existing missing-remote warning fires for
them with no doctor-specific change. The predicate is defined against the whole
`PrGrouping` enum (`!== 'off'`), not a hardcoded active-list, so future modes are
covered by construction. The engine's `whole-batch`-specific *spawn* gate is a
different question (which grouping unit to spawn, out of scope here) and is left
untouched — this predicate answers only "is any grouping active?", the exact
question doctor's advisory needs.

**Generalizable, forge-agnostic defaults (`generalizable-defaults`).**
`per-phase` and `per-change` are neutral, ecosystem-agnostic mode names — no
package manager, forge CLI, or toolchain string is baked in, and the default is
unchanged (`off`, do-nothing). The setting still names *whether/how* to group,
never *how* to push; the forge-specific stacked-branch work stays entirely out of
this schema slice.

**Resolution and engine behavior are untouched.** No `buildSpawnRequest`, locus,
`pickNextStep`, or engine-transition code changes here. `prGrouping` rides the
existing scalar cascade over `SETTING_KEYS`; widening the enum needs no resolver
edit. Setting a new mode is validated-but-inert until the later stacked-spawn
changes in this phase consume it.

**Testing (`testing`).** Pure schema/predicate logic, proven at the unit layer
(no filesystem spawn, no ReX):
- A new `test/core/batch/grouping-mode-schema.test.ts` (header names
  `features/grouping-mode-schema/schema.feature`) exercises, for both
  `ProjectConfigSchema.shape.batch` and `BatchSettingsOverrideSchema`:
  `prGrouping` `per-phase`/`per-change` accepted, `off`/`whole-batch` still
  accepted, an invalid mode (`per-batch`, `bogus`) rejected, and — the drift
  guard — that each schema accepts exactly the members of `PR_GROUPING_VALUES`.
  It also asserts `isPrGroupingActive` returns `false` for `off` and `true` for
  `whole-batch`/`per-phase`/`per-change`, and that `resolveBatchSettings` still
  defaults `prGrouping` to `off` (source `default`) and honors a project/manifest
  override to a new mode.
- `test/core/doctor/pr-remote.test.ts` is extended so the missing-remote warning
  is asserted to fire under `per-phase`/`per-change` (no remote) and stay silent
  when a remote exists, proving the predicate refactor covers the new modes.
- The full suite and the coverage gate stay green at or above the enforced
  `COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** `prGrouping`'s accepted values are
a user-facing config surface. The `prGrouping` row in the Gate-and-orchestration
table of `docs/configuration/config-yaml.md` is updated to list
`off` `whole-batch` `per-phase` `per-change` and to add a one-line gloss that
`per-phase` opens one stacked PR per completed phase and `per-change` one stacked
PR per change (wired later in Phase 3). The README's PR-opening section gains a
sentence noting the two stacked modes are additionally accepted alongside
`whole-batch`. This updates existing reference rows / prose rather than
introducing a new core component or flow, so — per the standard's "do not
over-document visually" guidance — no new Mermaid diagram is added here (the
stacked-flow diagram lands with the change that implements stacked spawning);
existing docs' structure and terminology are matched.

## Tasks

- [x] 1.1 Extend `PR_GROUPING_VALUES` in `src/core/batch/config.ts` to
  `['off', 'whole-batch', 'per-phase', 'per-change'] as const` and update the
  doc comment (drop the "not yet accepted" note for the stacked modes). Confirm
  `PrGrouping`, `DEFAULT_BATCH_SETTINGS.prGrouping` (`off`), `SETTING_KEYS`, and
  `ALLOWED_VALUES.prGrouping = PR_GROUPING_VALUES` all follow automatically and
  the nearest-wins resolution loop needs no change.
- [x] 1.2 Add the inline `per-phase`/`per-change` members to the `prGrouping`
  `z.enum([...])` in the `batch` object of `src/core/project-config.ts`
  (project-config scope), keeping the comment that `PR_GROUPING_VALUES` is the
  source of truth and this is inlined to avoid the config↔project-config cycle.
- [x] 1.3 Add the same two members to the inline `prGrouping` `z.enum([...])` in
  `BatchSettingsOverrideSchema` in `src/core/batch/manifest.ts`, keeping the
  object `.strict()`.
- [x] 1.4 Add `export function isPrGroupingActive(mode: PrGrouping): boolean`
  (`= mode !== 'off'`) beside `PR_GROUPING_VALUES`/`PrGrouping` in
  `src/core/batch/config.ts`, with a doc comment naming it the single home for
  "is PR grouping active?".
- [x] 1.5 Refactor `src/core/doctor/checks/pr-remote.ts` to call
  `isPrGroupingActive(prGrouping)` (return `null` when not active) in place of
  its inline `=== 'off'` test; import the predicate from `batch/config.js`
  (already the source of `resolveBatchSettings`). Behavior is unchanged for
  `off`/`whole-batch`.
- [x] 2.1 Add unit test `test/core/batch/grouping-mode-schema.test.ts` (header
  names `features/grouping-mode-schema/schema.feature`) covering, for both the
  project-config `batch` schema and the manifest override schema: `per-phase`/
  `per-change` accepted, `off`/`whole-batch` still accepted, invalid mode
  (`per-batch`, `bogus`) rejected, and a drift guard that each schema accepts
  exactly the members of `PR_GROUPING_VALUES`; plus `isPrGroupingActive`
  false-for-`off`/true-for-the-rest, and `resolveBatchSettings` defaulting to
  `off` (source `default`) and honoring a new-mode override.
- [x] 2.2 Extend `test/core/doctor/pr-remote.test.ts` to assert the
  missing-remote warning fires for `per-phase`/`per-change` with no remote and
  stays silent when a remote exists; confirm the full suite + coverage gate stay
  green.
- [x] 3.1 (`documentation`, mandatory) Update the `prGrouping` row in the
  Gate-and-orchestration table of `docs/configuration/config-yaml.md` to list
  `off` `whole-batch` `per-phase` `per-change` with a one-line gloss of the two
  stacked modes, and add a sentence to the README PR-opening section noting
  `per-phase`/`per-change` are additionally accepted (behavior wired in a later
  Phase 3 change); keep tone and terminology consistent with the existing docs.
