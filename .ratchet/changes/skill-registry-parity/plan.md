# skill-registry-parity

## Why

`ratchet init` generates twelve skill directories and twelve commands (one per
workflow in `ALL_WORKFLOWS`), but the detection registry in
`src/core/shared/tool-detection.ts` only lists ten skill names and omits the
`open-pr` command id. As a result `ratchet update`'s smart detection and the
profile drift check are blind to `ratchet-decompose-phase`, `ratchet-open-pr`,
and the `open-pr` command, and nothing stops the two registries from drifting
apart again when a workflow is added.

## What Changes

- `SKILL_NAMES` in `src/core/shared/tool-detection.ts` gains
  `ratchet-decompose-phase` and `ratchet-open-pr` (10 → 12 entries), so skill
  detection counts every generated skill directory.
- `COMMAND_IDS` in the same file gains `open-pr` (12 → 13 entries); the legacy
  `explore` id stays — legacy ids are allowed.
- A new parity test ties the detection registry to the workflow profiles: it
  fails if any workflow in `ALL_WORKFLOWS` loses its detection entry, and it
  tolerates legacy-only entries.
- Implements `features/update-sync/detection-registry-parity.feature`.

## Design

The fix is data-only: two missing entries in two `as const` lists. No logic in
`getToolSkillStatus`, `toolHasAnyConfiguredCommand`, or anywhere else changes —
those functions already iterate the lists, so extending the lists extends
detection (e.g. `toolHasAnyConfiguredCommand` picks up `open-pr` for free).

The parity test lives in `test/core/shared/tool-detection.test.ts` (the home of
the existing registry tests, inside the phase proof-of-work path
`pnpm vitest run test/core/shared`). It asserts one direction only — coverage:
for every workflow in `ALL_WORKFLOWS` (`src/core/profiles.ts`), the workflow's
generated skill directory name (resolved via `getSkillTemplates()` in
`src/core/shared/skill-generation.ts`, consistent with `WORKFLOW_TO_SKILL_DIR`
in `src/core/profile-sync-drift.ts`) is in `SKILL_NAMES`, and its command id
(resolved via `getCommandTemplates()`) is in `COMMAND_IDS`. The reverse
direction is deliberately not asserted, so the legacy `explore` command id
passes — this is the "legacy ids allowed" clause. Because the test iterates
`ALL_WORKFLOWS` rather than hard-coding names, adding a future workflow without
updating the detection registry fails the test (multi-agent-support: the
generated surface is defined once and every workflow renders for every
registered agent; the test enumerates that shared surface instead of a
per-agent copy).

Per-agent surface (multi-agent-support enumeration): this change alters no
generated artifact — bodies, paths, and frontmatter are unchanged for every
tool. It only widens which already-generated files detection recognizes:
`<skillsDir>/skills/ratchet-decompose-phase/SKILL.md`,
`<skillsDir>/skills/ratchet-open-pr/SKILL.md`, and the `open-pr` command at
each tool's command path (`.claude/commands/rct/open-pr.md`,
`.cursor/commands/rct-open-pr.md`, `~/.codex/prompts/rct-open-pr.md`,
`.gemini/commands/rct-open-pr.md`, `.github/prompts/rct-open-pr.prompt.md`,
`.opencode/commands/rct-open-pr.md`), exactly as already documented in
`docs/configuration/generated-artifacts.md`.

Testing per the testing standard: unit-level assertions over in-memory
registries plus the existing tmpdir fixture pattern for the filesystem
counting behavior; the test file header names the implemented `.feature`; the
full suite and the coverage gate must stay green.

## Tasks

- [x] 1.1 Add `ratchet-decompose-phase` and `ratchet-open-pr` to `SKILL_NAMES` and add `open-pr` to `COMMAND_IDS` in `src/core/shared/tool-detection.ts` (keep the legacy `explore` entry)
- [x] 1.2 Update the existing `SKILL_NAMES` expectations in `test/core/shared/tool-detection.test.ts` (length 10 → 12; containment of the two new names)
- [x] 2.1 Add the parity test to `test/core/shared/tool-detection.test.ts` (header names `features/update-sync/detection-registry-parity.feature`): every workflow in `ALL_WORKFLOWS` has its generated skill dirName in `SKILL_NAMES` and its command id in `COMMAND_IDS` (resolved via `getSkillTemplates()` / `getCommandTemplates()`), the generation registries cover every workflow, and a legacy-only command id (`explore`) does not fail the check. The test must FAIL when a workflow has no skill or command template — it must never skip such a workflow (no conditional continue/pass): a missing template or a missing detection entry is a hard assertion failure
- [x] 2.2 Add the Scenario 1 test ("Decompose-phase and open-pr skills count toward skill detection") to `test/core/shared/tool-detection.test.ts`: in a tmpdir, for each tool id from `getToolsWithSkillsDir()`, write only `ratchet-decompose-phase/SKILL.md` and `ratchet-open-pr/SKILL.md` under that tool's skills dir, and assert `getToolSkillStatus` returns `skillCount` 2, `configured` true, and `fullyConfigured` false
- [x] 2.3 Add the Scenario 2 test ("Open-pr command is part of command detection") to `test/core/shared/tool-detection.test.ts`: for each registered adapter in `CommandAdapterRegistry.getAll()` whose tool has a `skillsDir`, assert `toolHasAnyConfiguredCommand` is false before anything is written, then write only the `open-pr` command file at `adapter.getFilePath('open-pr')` (absolute paths — e.g. codex under a redirected `CODEX_HOME` — used as-is) and assert `toolHasAnyConfiguredCommand` becomes true
- [x] 3.1 Documentation (per the `documentation` standard): update `docs/commands/update.md` so the smart-update detection / drift description states detection covers the full generated skill and command set, including `ratchet-decompose-phase`, `ratchet-open-pr`, and the `open-pr` command; fix the core-profile workflow list at `docs/commands/update.md` line 31 so it matches `CORE_WORKFLOWS`, adding `decompose-phase` and `open-pr`; verify `docs/configuration/generated-artifacts.md` (already lists all twelve workflows) and `README.md` remain accurate
- [x] 3.2 Run `pnpm vitest run test/core/shared`, then the full suite `pnpm test` and the coverage gate `pnpm test:coverage` — all green
