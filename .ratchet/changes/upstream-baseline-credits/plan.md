# upstream-baseline-credits

## Why

The upstream-absorption batch restated OpenSpec (v1.4.1 fork point → 2.0.0)
and superpowers (brainstorming adapted ≈v6.1 → 7.0.2) in ratchet terms, but
the README's `## Credits & license` section still carries only the original
fork line — a reader cannot see which upstream baselines were absorbed. The
phase goal and this change's definition of done require the README credits to
record the exact strings `OpenSpec 2.0.0` and `superpowers 7.0.2` as the
absorbed upstream baselines, alongside the existing fork attribution.

## What Changes

- Edit `README.md`'s `## Credits & license` section so it records the exact
  strings `OpenSpec 2.0.0` and `superpowers 7.0.2` as the absorbed upstream
  baselines, keeping the existing attribution ("fork of OpenSpec by
  Fission-AI. Licensed under MIT.") alongside them. This README edit is the
  change's entire user-facing surface and doubles as the mandatory
  documentation task (see Tasks).
- Append a README-credits assertion block to the phase's shared test file
  `test/core/shared/brainstorm-v7-rendered-output.test.ts` (the file the
  phase proof-of-work runs), pinning the shipped README wording: both exact
  baseline strings, labelled as absorbed upstream baselines, with the fork
  attribution and MIT license statement preserved.
- Implements `features/upstream-credits/readme-baselines.feature`.

## Non-goals

- No edit to the brainstorm template's provenance header — decided at phase
  decomposition: recording `superpowers 7.0.2` in
  `src/core/templates/workflows/brainstorm.ts` is the
  `brainstorm-v7-behaviors` change (already shipped); this change owns only
  the README credits.
- No restatement or port of any upstream behavior — the batch header requires
  upstream improvements restated in ratchet terms by the phase's other
  changes; this change records version provenance only, no skill, template,
  CLI, or config surface changes.
- No `/rct:update`, skills-only delivery, or other batch-declared non-goals —
  ruled out by the user in the batch manifest header and out of this change's
  scope by decomposition.

## Design

- **One prose edit, exact strings (documentation standard).** The two
  baseline credits are added to the existing `## Credits & license` section
  rather than a new top-level section: that section is where readers already
  look for attribution, and the done criterion names "README's credits
  section" specifically. The exact strings `OpenSpec 2.0.0` and
  `superpowers 7.0.2` appear verbatim so the phase proof-of-work greps
  (`grep -q 'OpenSpec 2.0.0' README.md`, `grep -q 'superpowers 7.0.2'
  README.md`) pass, and the prose labels them as the absorbed upstream
  baselines (the versions the upstream-absorption batch restated in ratchet
  terms), keeping the existing fork attribution and MIT license statement
  intact. The documentation standard's `docs/` Reference requirement is
  scoped to changes that touch code; this change touches no code, command,
  flag, config key, or generated artifact, so no `docs/` entry is created —
  the README credits edit is itself the change's documentation surface.
- **Pinned at the unit layer (testing standard).** The assertion block is
  appended to `test/core/shared/brainstorm-v7-rendered-output.test.ts`,
  which already reads the shipped `README.md` from the repo root to pin
  user-facing wording for this phase ("the restated surface is
  Reference-documented" block). Appending there keeps the phase's README
  pins in one file, runs the assertions under the phase proof-of-work
  (`pnpm vitest run test/cli-e2e
  test/core/shared/brainstorm-v7-rendered-output.test.ts`), and stays at the
  unit layer: pure content assertions over a real shipped file, no fixture
  repo or process spawn. The test header comment notes it mirrors
  `features/upstream-credits/readme-baselines.feature`.
- **Agent-neutral by construction (multi-agent-support).** The README is a
  single shared file, not rendered per agent; the change adds no skill,
  command, template, or per-agent output, so there are no per-agent outputs
  to enumerate and no rendered-surface assertions to iterate over the
  supported-tools registry.

### Approaches considered

- **Extend the existing `## Credits & license` section (chosen).** One
  minimal edit where attribution already lives; preserves the fork line;
  satisfies the exact-string greps. This is the smallest change that proves
  the goal end to end.
- **Add a separate top-level "Upstream baselines" README section.** Dropped:
  it fragments the credit surface across two sections for two lines of
  prose, and the done criterion names the credits section.
- **Record the baselines only in the batch manifest or change plans.**
  Dropped: the phase success criterion and this change's definition of done
  require the README credits section specifically; manifest prose is not the
  user-facing credit surface.

## Tasks

- [x] 1.1 Documentation (per the `documentation` standard; this task IS the
  mandatory documentation task and there is no separate implementation task —
  the change is a README edit): update `README.md`'s `## Credits & license`
  section to record the exact strings `OpenSpec 2.0.0` and `superpowers
  7.0.2`, labelled as the absorbed upstream baselines (the versions the
  upstream-absorption batch restated in ratchet terms), while keeping the
  existing fork attribution ("fork of OpenSpec by Fission-AI") and the MIT
  license statement. No `docs/` Reference entry: the change touches no code,
  command, flag, config key, or generated artifact. No Mermaid diagram:
  credits prose is not a core component, flow, or behavior (features:
  `upstream-credits/readme-baselines.feature`)
- [x] 2.1 Append a README-credits `describe` block to
  `test/core/shared/brainstorm-v7-rendered-output.test.ts` (header comment
  mirroring `features/upstream-credits/readme-baselines.feature`), reading
  the shipped `README.md` from the repo root like the existing README pins in
  that file, and asserting: the credits section contains the exact strings
  `OpenSpec 2.0.0` and `superpowers 7.0.2`; they are labelled as absorbed
  upstream baselines; and the fork attribution (fork of OpenSpec by
  Fission-AI) and MIT license statement are still present (features:
  `upstream-credits/readme-baselines.feature`)
- [x] 2.2 Run the change's verification: `grep -q 'OpenSpec 2.0.0' README.md
  && grep -q 'superpowers 7.0.2' README.md`, the focused test (`pnpm vitest
  run test/core/shared/brainstorm-v7-rendered-output.test.ts`), then per the
  testing standard the full suite (`pnpm test`) and the coverage gate (`pnpm
  test:coverage`); all must be green. Stay inside the repository — no shell
  access to /tmp or external directories (features:
  `upstream-credits/readme-baselines.feature`)
