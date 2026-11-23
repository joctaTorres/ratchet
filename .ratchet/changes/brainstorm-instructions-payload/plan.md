# brainstorm-instructions-payload

## Why

The brainstorm workflow's spike opt-in must reach the skill as payload data,
never as a config read inside skill prose (instruction-fed-config). Today
`ratchet instructions brainstorm --json` fails ("Missing required option
--change") because `instructions` only knows change-scoped artifacts, so there
is no seam to deliver the opt-in. This change adds that seam: a `brainstorm`
special case that resolves `brainstorm.spikes` from `.ratchet/config.yaml`
into a `spikes.enabled` payload, defaulting to off and never throwing.

## What Changes

- Add an optional `brainstorm` section to the project config schema in
  `src/core/project-config.ts`: `brainstorm.spikes` boolean, parsed with the
  same per-section resilience as `eval` (a malformed section is dropped with a
  warning while valid sibling fields load). Absent section ⇒ spikes off.
- Add `buildBrainstormInstructionsPayload(startPath?)` in a new core module
  `src/core/brainstorm-instructions.ts`: finds the nearest ratchet planning
  root (`findRepoPlanningRootSync`), reads the project config, and returns
  `{ spikes: { enabled } }` — `enabled` is `true` only when the loaded config
  carries `brainstorm.spikes: true`. The builder never throws: no planning
  root, an unreadable config, or any internal failure resolves to
  `{ spikes: { enabled: false } }`.
- Add `brainstormInstructionsCommand(options)` to
  `src/commands/workflow/instructions.ts` and wire a `brainstorm` special case
  into the `instructions [artifact]` action in `src/cli/index.ts`, beside the
  existing `apply` special case. With `--json` it prints the payload object;
  without `--json` it prints one line, `spikes.enabled: <true|false>`. Both
  forms exit zero always — the command requires no `--change` and no ratchet
  root.
- Implements `features/brainstorm/instructions-payload.feature`.

Sibling behaviors in the phase are separate batch changes by approved
decomposition, not part of this one: the v7 behavior restatement of the
brainstorm body (`brainstorm-v7-behaviors`), the payload-conditional spike
guidance in the skill (`brainstorm-spike-guidance`), and the README upstream
baseline credits (`upstream-baseline-credits`).

## Non-goals

- No spike guidance, spike mechanics, or any mention of spikes in the
  brainstorm skill/command template bodies — decided at phase decomposition:
  that is the `brainstorm-spike-guidance` change, which consumes this payload.
- No v7 restatement of the brainstorm body — that is the
  `brainstorm-v7-behaviors` change.
- No README credits/provenance edit recording upstream baselines — that is
  the `upstream-baseline-credits` change.
- No user/global-level `brainstorm.spikes` key: the batch definition of done
  scopes the key to project config (`.ratchet/config.yaml`) only.
- No change to the change-scoped artifact instructions flow: `instructions
  <artifact> --change <id>` behaves byte-for-byte as before for every other
  artifact id.

### Approaches considered

- **CLI-action special case (chosen).** Add `brainstorm` beside `apply` in the
  `instructions` action and resolve the payload in a small core builder. This
  mirrors the one existing non-artifact precedent, keeps assembly at the
  command/loader layer where it is unit-testable (instruction-fed-config),
  and touches nothing in the change-scoped flow.
- **A first-class schema artifact named `brainstorm`.** Dropped: artifacts are
  change-scoped by construction (`--change` is required to load the graph),
  while this payload must work with no change and no ratchet root.
- **Let the brainstorm skill read `.ratchet/config.yaml` directly.** Dropped:
  it violates instruction-fed-config — config-driven behavior must arrive as
  payload data assembled at the command layer, never as a skill-side config
  read or config-branching template prose.

## Design

- **Assembly at the command/loader layer (instruction-fed-config).** The one
  new assembly point is `buildBrainstormInstructionsPayload` in
  `src/core/brainstorm-instructions.ts`. It composes two existing,
  already-tested pieces — `findRepoPlanningRootSync` (returns `null` when no
  `.ratchet` root exists, which maps to disabled) and `readProjectConfig`
  (field-by-field resilient; returns `null` on an unreadable/malformed file,
  which maps to disabled) — and wraps them in a catch-all so the builder can
  never throw. The skill side (a later change) will read `spikes.enabled` from
  this payload as data; nothing in this change lets any skill touch config.
- **Config schema addition mirrors the `eval` precedent.** `ProjectConfigSchema`
  gains `brainstorm: z.object({ spikes: z.boolean().optional() }).partial()
  .optional()`; `readProjectConfig` parses `raw.brainstorm` exactly like
  `raw.eval` — `safeParse` the section, keep it when valid (and defined), warn
  and drop it when invalid — so a malformed `brainstorm:` never takes valid
  siblings down with it. Default-off is a resolution rule
  (`config?.brainstorm?.spikes === true`), not a schema default, so a loaded
  config stays faithful to what the user wrote.
- **The special case cannot fail.** `brainstormInstructionsCommand` builds the
  payload and prints it; it performs no planning-home validation, no schema
  resolution, and no change lookup. `readProjectConfig`'s own warnings go to
  stderr, so the `--json` stdout stays parse-clean. Exit-zero-always is the
  contract: an agent harness can call it unconditionally at skill-invocation
  time.
- **Agent-neutral by construction (multi-agent-support).** The payload is data,
  identical for every registered agent; there are no per-agent output files to
  enumerate because no template or generated artifact changes in this change.
  The payload-conditional spike prose that will consume it
  (`brainstorm-spike-guidance`) is where per-agent rendered-output assertions
  land.
- **Testing at the right layers (testing standard).** Unit:
  `test/core/brainstorm-instructions.test.ts` pins the builder's resolution
  matrix over `fs.mkdtemp(os.tmpdir())` fixture repos (spikes true / false /
  section absent / no `.ratchet` root / unparseable config / malformed
  `brainstorm` section) and the command's JSON and text emission (exit-clean,
  stdout shape), with the feature mirrored in the file header;
  `test/core/project-config.test.ts` gains the section-parse cases beside the
  existing `eval` ones (typed load; malformed section dropped with a warning
  while valid siblings load). E2E: `test/cli-e2e/brainstorm-instructions.test.ts`
  drives the built CLI with the on / off / no-root fixtures and asserts exit
  code 0 and the parsed `spikes.enabled` value on stdout. Full suite
  (`pnpm test`) and the coverage gate (`pnpm test:coverage`) stay green.
- **Verification.** `pnpm vitest run test/core/brainstorm-instructions.test.ts
  test/core/project-config.test.ts test/cli-e2e/brainstorm-instructions.test.ts`
  is green, and the phase proof-of-work's first two clauses —
  `pnpm build && node bin/ratchet.js instructions brainstorm --json | grep -q
  '"spikes"'` — pass against the built CLI.

## Tasks

- [x] 1.1 Add the optional `brainstorm` section (`spikes` boolean) to
  `ProjectConfigSchema` in `src/core/project-config.ts` and parse
  `raw.brainstorm` in `readProjectConfig` with the `eval`-pattern resilience
  (valid section kept, malformed section dropped with a warning, valid
  siblings preserved) (features:
  `brainstorm/instructions-payload.feature`)
- [x] 1.2 Create `src/core/brainstorm-instructions.ts` exporting
  `BrainstormInstructionsPayload` and
  `buildBrainstormInstructionsPayload(startPath?)`: nearest planning root via
  `findRepoPlanningRootSync`, config via `readProjectConfig`, `enabled` true
  only on `brainstorm.spikes: true`, and a catch-all guaranteeing
  `{ spikes: { enabled: false } }` on no root, unreadable config, or any
  failure — never throwing (features:
  `brainstorm/instructions-payload.feature`)
- [x] 1.3 Add `brainstormInstructionsCommand(options)` to
  `src/commands/workflow/instructions.ts` (JSON payload with `--json`, else
  one `spikes.enabled: <true|false>` line, always exit zero, no `--change`
  required) and wire the `brainstorm` special case into the `instructions
  [artifact]` action in `src/cli/index.ts` beside `apply` (features:
  `brainstorm/instructions-payload.feature`)
- [x] 2.1 Add `test/core/brainstorm-instructions.test.ts` (header mirrors
  `features/brainstorm/instructions-payload.feature`): tmpdir-fixture unit
  tests for the builder's resolution matrix — spikes true, spikes false,
  section absent, no `.ratchet` root, unparseable config, malformed
  `brainstorm` section — and for the command's JSON/text emission, plus the
  `brainstorm` section-parse cases in `test/core/project-config.test.ts`
  beside the `eval` ones (typed optional load; malformed section dropped with
  a warning while valid sibling fields load)
- [x] 2.2 Add `test/cli-e2e/brainstorm-instructions.test.ts` driving the built
  CLI (`test/helpers/run-cli.js`) over three fixtures — `brainstorm.spikes:
  true`, `brainstorm.spikes: false`, and no ratchet root (empty tmpdir cwd) —
  asserting exit code 0 and the parsed `spikes.enabled` value on stdout
- [x] 2.3 Run `pnpm build` and `pnpm vitest run
  test/core/brainstorm-instructions.test.ts
  test/core/project-config.test.ts
  test/cli-e2e/brainstorm-instructions.test.ts`, then confirm
  `node bin/ratchet.js instructions brainstorm --json | grep -q '"spikes"'`;
  per the testing standard also run the full suite (`pnpm test`) and the
  coverage gate (`pnpm test:coverage`); all must be green
- [x] 3.1 Documentation (per the `documentation` standard): update
  `docs/commands/instructions.md` (the `brainstorm` special case — no
  `--change` needed, the `spikes.enabled` JSON shape, exit-zero-always
  contract, and the `--change`-required statement corrected for it),
  `docs/configuration/config-yaml.md` (`brainstorm` top-level key row plus a
  `brainstorm:` settings section: `spikes`, boolean, default `false`, opt-in
  for throwaway brainstorm spikes), and `README.md` (the
  `instructions [artifact|apply]` command-table row and any prose the new
  surface makes stale). No new Mermaid diagram: this is a leaf addition to an
  already-documented command, which the standard's diagram guidance reserves
  no diagram for
