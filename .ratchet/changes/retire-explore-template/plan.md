# retire-explore-template

## Why

The explore workflow template is dead code: nothing imports it, yet its
`skill-templates.ts` re-export and two comments in the skill-generation module
claim propose reuses its prose — false, since propose authors its own
clarify-first step inline and imports nothing from the explore module — and
the README agent-workflows section repeats that false claim. This phase retires
the template; the one behavior that must provably survive is legacy cleanup of
old explore artifacts on update.

## What Changes

- Delete `src/core/templates/workflows/explore.ts` (dead module) and its
  re-export in `src/core/templates/skill-templates.ts`.
- Correct the two stale comments in `src/core/shared/skill-generation.ts` so
  they no longer claim propose reuses the explore template's prose.
- Correct the README agent-workflows footnote so it no longer claims explore
  exists as an internal stance used by propose.
- Add update-level tests proving legacy explore artifacts (directory-based
  `.claude/commands/ratchet/explore.md`, file-based
  `.cursor/commands/ratchet-explore.md`) are still cleaned up on
  `ratchet update --force`.
- Implements `features/agent-workflows/explore-template-retired.feature` and
  `features/update-sync/legacy-explore-cleanup.feature`; removes the retired
  `agent-workflows/explore-stance.feature` store spec via the `features/.deleted`
  tombstone.

## Design

- **Deletion is reference-free.** The only references to the explore module are
  its own file and the `skill-templates.ts` re-export —
  `getSkillTemplates()`/`getCommandTemplates()` never list it (explore is not
  in the workflow profiles), so the generated surface is unchanged for every
  registered agent. TypeScript compilation of the trimmed re-export is the
  deletion pin; the phase proof-of-work's `test ! -e` check pins the file
  removal.
- **`explore` stays as a legacy id — do not remove it.** The string `'explore'`
  remains in `src/core/update.ts` `OLD_CORE_WORKFLOWS` (the pre-sync core set
  the old-core custom-profile note keys on) and in the tool-detection
  `COMMAND_IDS` list (legacy ids are allowed — see skill-registry-parity:
  detection of old explore installs is deliberately untouched). The existing
  `update.test.ts` "old-core custom profile note" test, which sets
  `workflows: ['propose', 'explore', 'apply', 'archive']`, must keep passing
  unchanged; removing the legacy id from either list would break it and would
  regress detection of legacy explore installs on update.
- **Comment correction.** The two comments in the skill-generation module
  currently read "explore is internal-only: its prose is reused by propose …".
  With the module gone there is nothing to carve out, so the comments are
  removed; the existing skill-generation tests asserting no explore
  skill/command is generated (even when requested in the filter) keep passing
  and pin the registry exclusion.
- **README correction.** The agent-workflows footnote claims explore exists as
  an internal stance used by propose. It is rewritten to state brainstorm is
  the standalone front door for open-ended design and that no standalone
  explore command ships, keeping the profile note (core set, eval opt-in)
  intact.
- **Legacy cleanup stays pattern-based.** Legacy cleanup detects the old
  directory-based command dir and the old file-based command patterns and
  removes them on `ratchet update --force`; it never resolved through the
  template registry, so deleting the module cannot regress it. The new
  integration tests pin exactly that: a fixture project carrying a legacy
  directory-based explore command and a legacy file-based explore command is
  cleaned by `ratchet update --force`. Tests live in `test/core/update.test.ts`
  (the legacy-cleanup describe block — integration layer per the testing
  standard, tmpdir fixture, header names the feature file).
- **Tombstone.** The store's `agent-workflows/explore-stance.feature` describes
  the stance the template carried; with the template and the reuse claims gone,
  the spec is removed via the change's `features/.deleted` tombstone (the
  existing whole-file-removal mechanism), so the store does not keep asserting
  a surface nothing ships. The change's `features/.deleted` must list exactly
  `agent-workflows/explore-stance.feature`, and that file must still exist in
  `.ratchet/features/` until archive — a new test pins the tombstone applying
  to that store-relative path (scenario 3 of
  `explore-template-retired.feature`).
- **Per-agent surface (multi-agent-support enumeration):** no generated output
  changes for any registered agent — explore is never emitted to any agent's
  skill directory or command path. The only per-agent paths touched are legacy
  cleanups already covered by pattern matching: `.claude/commands/ratchet/`
  (directory-based) and the file-based `ratchet-explore.*` / `rct-explore.*`
  patterns for cursor, codex, github-copilot, and opencode — identical for
  every agent, no per-agent branching.

## Tasks

- [x] 1.1 Delete `src/core/templates/workflows/explore.ts` and its re-export in `src/core/templates/skill-templates.ts`; remove the stale "reused by propose" comments in `src/core/shared/skill-generation.ts` (both the skill and command registry comments)
- [x] 1.2 Verify the removal breaks nothing: `pnpm build` (tsc) green and the existing skill-generation and tool-detection registry tests pass unchanged. Explicitly confirm `explore` STAYS as a legacy id in `src/core/update.ts` `OLD_CORE_WORKFLOWS` and in tool-detection `COMMAND_IDS` (it must NOT be removed), and the existing `update.test.ts` "old-core custom profile note" test keeps passing unchanged
- [x] 2.1 Add the legacy-explore cleanup tests to `test/core/update.test.ts` (header names `features/update-sync/legacy-explore-cleanup.feature`): in a tmpdir fixture, `ratchet update --force` removes a legacy directory-based explore command (`.claude/commands/ratchet/explore.md`) and a legacy file-based explore command (`.cursor/commands/ratchet-explore.md`)
- [x] 2.2 Add a per-agent assertion to `test/core/shared/agent-neutral-rendered-output.test.ts` (implements `features/agent-workflows/explore-template-retired.feature` scenario 1): reuse the existing loop over `AI_TOOLS` entries with a `skillsDir` and the `CommandAdapterRegistry` — for every registered agent, assert no `ratchet-explore` skill directory and no explore command file is generated (no skill template with `dirName: 'ratchet-explore'`; no command content with `id: 'explore'` rendered through the agent's adapter). Keep the existing skill-generation exclusion tests green as well
- [x] 2.3 Prove the tombstone applies to the retired store spec (implements `features/agent-workflows/explore-template-retired.feature` scenario 3): confirm the change's `features/.deleted` lists `agent-workflows/explore-stance.feature` and that file exists in `.ratchet/features/`; add a test (in `test/core/features-apply.test.ts`, reusing its tmpdir store/change fixtures) proving a `features/.deleted` entry removes the store-relative path `agent-workflows/explore-stance.feature` when the feature delta is applied on archive
- [x] 3.1 Documentation (per the `documentation` standard): rewrite the README agent-workflows footnote so it no longer claims an internal explore stance used by propose; verify `docs/` needs no update (no explore references exist there today)
- [x] 3.2 Run the phase proof-of-work (`pnpm vitest run test/core/shared && test ! -e src/core/templates/workflows/explore.ts && ! grep -rnE '\*\*(AskUserQuestion|TodoWrite) tool\*\*' src/core/templates/workflows`), then the full suite `pnpm test` and the coverage gate `pnpm test:coverage` — all green
