# standalone-report-channel

## Why

The standalone headless verbs (`ratchet propose|apply|verify <change>`) run with no batch, yet the agent prompt interpolates `context.batch` and tells the agent to report via `ratchet batch report undefined --change <change> …`. That command fails, so no standalone step can ever record a completion and every finished run parks as "unreported" (issue #116). This is a functional defect, not a classified security exposure, so the `security-remediation` standard does not apply.

## What Changes

- New top-level CLI command `ratchet report <change> [--status|--blocker|--needs-input|--complete] <message>` that appends to the change-local run journal `.ratchet/changes/<change>/.run/journal.jsonl` (features/standalone-report-channel/report-command.feature).
- `buildAgentInstructions` and `reportChannel` branch on `context.batch`: a standalone step's prompt names the change (not a batch) and the `ratchet report <change> …` channel; a batch step's prompt is unchanged byte-for-byte (features/standalone-report-channel/standalone-prompt.feature).
- A standalone `apply` whose agent reports via the prompted command now ends `advanced` (features/standalone-report-channel/standalone-completion.feature).
- `batch report`'s kind switch is refactored to take a `RunLocus` so both commands share one implementation; `batch report`'s behavior and flags are unchanged.
- Reference docs and README updated for the new command and the standalone report channel.

## Design

**Dedicated command, not a batch-less mode on `batch report`.** `resolveBatchName` auto-selects the sole batch when `[name]` is omitted, so a batch-less `batch report --change x` would silently journal into an unrelated batch whenever the project has exactly one. A top-level `ratchet report <change>` mirrors the `ratchet apply <change>` verb shape, always resolves to the `{ change }` `RunLocus`, and cannot be captured by a batch.

**Shared report core over `RunLocus`.** Extract the per-kind logic of `src/commands/batch/report.ts` into a locus-parameterized helper using `appendJournalForLocus`. `batch report` calls it with `{ batch }` (keeping its `parkStep` / `recordAnswer` / `recordReject` side effects, which are batch-keyed); `ratchet report` calls it with `{ change }`. The one-kind-exactly validation is shared.

**Scope of the standalone kinds.** `ratchet report` supports `--status`, `--blocker`, `--needs-input`, `--complete` — the four kinds the engine's outcome mapper (`outcome.ts`) reads from the session journal delta to yield progress / blocked / advanced. It does NOT offer `--answer`/`--reject`/`--awaiting-approval`: `buildChangeStepContext` never sets `resume` and the engine performs no change-locus parking (verified: no `parkStep` call in `src/core/batch/engine/`), so a standalone park/resume path does not exist today and is out of scope. `--blocker`/`--needs-input` therefore journal only (no `state.json`), which is exactly what the outcome mapper consumes.

**Guard against stray run dirs.** `ratchet report` calls `assertChangeExists` before writing, so a typo'd change name fails with an actionable error and creates no `.run/` directory.

**Prompt branching (`src/core/batch/engine/instructions.ts`).** With a batch: the existing header `You are advancing the ratchet batch "<batch>".` and `ratchet batch report <batch> --change <change> …` lines stay identical. Without a batch: the header reads `You are advancing the ratchet change "<change>" (standalone, no batch).`, the MUST-finish line names `ratchet report <change> --complete "<summary>"`, and `reportChannel` lists the four `ratchet report <change> --<kind>` commands. The decomposition and PR prompts always carry a batch and are untouched.

**Standards embedded.**
- `delegated-lifecycle`: the prompt still delegates the transition to `/rct:<transition> <change>` with the same context block; only the report channel wording changes — no lifecycle steps are re-authored inline.
- `multi-agent-support`: the prompt and the new command are agent-neutral plain CLI; the change adds no skill/command template, so per-agent generated outputs (`.claude/`, `.cursor/`, `.codex/`, `.github/`, `.opencode/`) are unaffected. The prompt is shared across every adapter.
- `generalizable-defaults`: no ecosystem-specific commands are introduced into shipped prompts.
- `testing`: unit tests for the prompt builder (pure), integration tests for `reportCommand` and `applyCommand` over a tmpdir fixture, and a CLI e2e under `test/cli-e2e/` that drives the built CLI with a `RATCHET_BATCH_AGENT_CMD` stub agent that executes the report command parsed from its instructions. Test headers name their `.feature` files. Full suite and coverage gate stay green.
- `documentation`: mandatory documentation task below.

## Tasks

- [x] 1.1 Refactor `src/commands/batch/report.ts` so the kind validation and journal append logic take a `RunLocus` (via `appendJournalForLocus`); keep `batch report` behavior and output identical
- [x] 1.2 Add `src/commands/report.ts` (`reportCommand(change, options)`) supporting `--status|--blocker|--needs-input|--complete` and `--json`, guarded by `assertChangeExists`, writing to the `{ change }` locus
- [x] 1.3 Register top-level `report <change>` in `src/cli/index.ts` with the four kind options and `--json`, erroring like the other verbs
- [x] 2.1 Branch `buildAgentInstructions` header / MUST-finish line and `reportChannel` on `context.batch` in `src/core/batch/engine/instructions.ts`; batch output byte-identical
- [x] 3.1 Unit tests (features/standalone-report-channel/standalone-prompt.feature): standalone prompt for propose/apply/verify has no `undefined`, no `ratchet batch report`, and names `ratchet report <change>` for all four kinds; batch prompt keeps the batch channel
- [x] 3.2 Integration tests (features/standalone-report-channel/report-command.feature): each kind appends to `.ratchet/changes/<c>/.run/journal.jsonl`; missing change fails with no `.run/`; zero/multiple kinds fail; a lone batch does not capture the report
- [x] 3.3 Integration test (features/standalone-report-channel/standalone-completion.feature): `applyCommand` with a spawner that invokes `reportCommand` using the command parsed from the instructions ends `advanced`
- [x] 3.4 CLI e2e under `test/cli-e2e/` (features/standalone-report-channel/standalone-completion.feature): built-CLI `ratchet apply <change> --json` with a `RATCHET_BATCH_AGENT_CMD` stub that runs the prompted `ratchet report … --complete` ends `advanced`; a non-reporting stub ends `blocked`
- [x] 3.5 Run lint, the full vitest suite and the coverage gate; all green
- [x] 4.1 Documentation (mandatory, per the `documentation` standard / "Reference documentation"): create `docs/commands/report.md` (Reference entry for `ratchet report`); update `docs/commands/apply.md`, `docs/commands/propose.md`, `docs/commands/verify.md` and `docs/engine/change-step.md` / `docs/engine/run-state.md` to describe the standalone report channel; cross-reference it from the `batch report` section of `docs/commands/batch.md`; update `README.md`'s command list
