# rename-binding-kinds

## Why

The eval system's binding kinds are named `check` and `agent`, but the
foundation-verdict-core phase reframes a run's verdict as an AND over named
*contributors* (deterministic / llm-judge / invariants / regression). The binding
vocabulary must speak that tier language before the aggregation core lands, so a
binding's kind names the verdict contributor it feeds. This is the foundational,
thin vertical slice for the phase: rename the kind vocabulary end-to-end
(parser → judge dispatch → `eval set` labels → migrated specs → shipped skill
template → docs) without yet building the gate/aggregation core, which later
changes in the phase own.

## What Changes

Implements `features/eval-binding-kinds/tier-vocabulary.feature` and
`features/eval-binding-kinds/migrated-vocabulary.feature`.

- **BREAKING**: eval-spec binding kind `check` is renamed to `deterministic` and
  `agent` to `llm-judge`. The discriminated-union parser accepts only the new
  names; a binding declaring the legacy kind is invalid (warned, treated as
  unbound). This is a clean rename with no back-compat alias — eval specs are
  new and internal-only in this beta, and a later change can add migration if a
  user need appears.
- `BindingKind`, the exported binding interfaces, and the `JudgeMode` values are
  renamed to the new vocabulary so judge-mode filtering stays coherent with the
  binding kind it selects. The `--judge auto|deterministic|llm-judge` flag keeps
  its name (a later phase change generalizes it into `--only`/`--no-llm-judge`/
  `--gate`); only its accepted values change.
- The `eval.judge` config enum in `.ratchet/config.yaml` accepts the new values.
- `ratchet eval set` reports `[deterministic]` / `[llm-judge]` / `[unbound]`.
- Ratchet's own `.ratchet/evals/specs/*.yaml` (and the `eval-self-run` fixture's
  own binding) are migrated to the new kinds and run green under the new system.
- The shipped eval skill/workflow template
  (`src/core/templates/workflows/eval.ts`) is migrated to the new vocabulary so
  every supported agent's generated eval skill speaks the new tier language.
- Reference docs and `README.md` are updated to the new vocabulary.

Out of scope (later phase changes): the single aggregation core (AND over
contributors), `eval.gate` config, the `--only`/`--no-llm-judge`/`--gate` CLI
overrides, the invariants/regression contributors, and blocking incomplete runs
from baseline promotion.

## Design

The kind is the discriminator of `BindingSchema` (a Zod
`discriminatedUnion('kind', …)` in `src/core/eval/spec.ts`). The rename is a
mechanical but cross-cutting vocabulary swap that must stay internally coherent
because three things are coupled to the kind literals:

1. **Parsing** — `CheckBindingSchema`/`AgentBindingSchema` `kind` literals and
   the `BindingKind` union (`spec.ts:22,24,36,46`). The *detail* block keys
   (`check:` with `check.run`/`check.pass`, and `success:`/`agentVotes:`) are
   left unchanged: the definition of done is scoped to the `kind` vocabulary, and
   touching the detail schema would widen the slice without serving the phase
   goal. The exported interfaces `CheckBinding`/`AgentBinding` are renamed to
   `DeterministicBinding`/`LlmJudgeBinding` (re-exported from `index.ts`,
   consumed by `judge.ts`) so the type names match the vocabulary.
2. **Judge dispatch + mode** — `judgeCase` branches on `binding.kind` and
   compares it to `JudgeMode` (`judge.ts:262-280`). `JudgeMode` becomes
   `'auto' | 'deterministic' | 'llm-judge'`; the dispatch comparisons and the
   `unjudged` mode-mismatch reasons are updated in lockstep. `resolveJudgeMode`
   and `VALID_MODES` (`commands/eval/shared.ts`) and the `eval.judge` enum
   (`core/project-config.ts`) follow.
3. **Reporting** — `CaseSnapshot.bindingKind` is typed `BindingKind` already, so
   it flows automatically; `SetCaseView.binding` and the `renderSet` labels in
   `commands/eval/set.ts` are updated to the new strings.

The migration of ratchet's own checked-in specs, the `eval-self-run` fixture
binding, and the test fixtures (`test/commands/eval/eval-fixture.ts` `CHECK_SPEC`)
keeps the dogfood suite green and is what `features/eval-binding-kinds/
migrated-vocabulary.feature` asserts. The archived change under
`.ratchet/changes/archive/` is a historical record and is **not** touched.

**Standards embedded in this plan:**

- **multi-agent-support** — the eval skill body is shared, tool-agnostic content
  in `src/core/templates/workflows/eval.ts`, rendered per agent through the
  command-generation registry. The vocabulary is changed once in that shared
  template (never in per-agent copies), so every supported agent
  (Claude Code, Cursor, Codex, GitHub Copilot, OpenCode — the registry in
  `src/core/config.ts`) gets the new wording. Per-agent generated outputs:
  `.claude/skills/…`, `.cursor/…`, `.codex/…`, `.github/…`, and `.opencode/…`
  eval-skill files produced by `ratchet init`. Skill-generation tests iterate
  the registry (or assert all registered agents) rather than hard-coding one
  agent.
- **testing** — new/changed behavior is proven at the lowest sufficient pyramid
  layer: unit tests over `spec.ts` parsing (new kinds resolve; legacy kinds warn)
  and `judge.ts` dispatch/mode; updated integration tests over the `eval set`
  labels and `eval run` mode-filtering; the existing CLI E2E
  (`test/cli-e2e/eval.test.ts`) migrated to the new vocabulary. Existing eval
  tests asserting `check`/`agent` are migrated, not duplicated. The full suite
  and the coverage gate stay green at or above the enforced `COVERAGE_THRESHOLD`
  (95% floor); no check is pushed up the pyramid when provable as a unit.
- **documentation** — Reference docs and the README are updated in this change:
  `docs/commands/eval.md` (kind discriminant table, `--judge` modes, binding
  examples), `docs/configuration/config-yaml.md` (`eval.judge` values),
  `.ratchet/evals/README.md` (authoring vocabulary), and `README.md` (the
  `eval run`/`eval set` rows and the binding examples). This is a Reference-style
  update to existing docs (no new core component or flow is introduced), so no
  new overview/Mermaid diagram is required; the documentation task is mandatory
  and blocking, enumerated below.

## Tasks

- [x] 1.1 Rename the kind vocabulary in `src/core/eval/spec.ts`: `BindingKind`
  to `'deterministic' | 'llm-judge'`, the two schema `kind` literals, and the
  exported interfaces (`CheckBinding`→`DeterministicBinding`,
  `AgentBinding`→`LlmJudgeBinding`); keep the `check:`/`success:` detail blocks.
- [x] 1.2 Update `src/core/eval/judge.ts`: `JudgeMode` values, the `judgeCase`
  dispatch comparisons, the imported binding type names, and the `unjudged`
  mode-mismatch reason strings.
- [x] 1.3 Update `src/commands/eval/shared.ts` (`VALID_MODES`, `resolveJudgeMode`
  error text) and `src/core/project-config.ts` (`eval.judge` enum values).
- [x] 1.4 Update `src/commands/eval/set.ts` (`SetCaseView.binding` type and the
  `renderSet` labels) and re-exports in `src/core/eval/index.ts` as needed so the
  package builds.
- [x] 2.1 Migrate ratchet's own specs to the new kinds:
  `.ratchet/evals/specs/{archive-change,batch-orchestration,batch-propose-metadata,eval-self}.yaml`
  and the `eval-self-run` fixture binding at
  `.ratchet/evals/fixtures/eval-self-run/.ratchet/evals/specs/demo.yaml`.
- [x] 2.2 Migrate the shipped eval skill template
  `src/core/templates/workflows/eval.ts` to the new vocabulary (shared,
  tool-agnostic content rendered per agent — multi-agent-support).
- [x] 3.1 Migrate the test fixtures and existing eval tests to the new
  vocabulary: `test/commands/eval/eval-fixture.ts` (`CHECK_SPEC`),
  `test/core/eval/spec.test.ts`, `test/cli-e2e/eval.test.ts`, and any other
  `test/**/eval` tests asserting `check`/`agent` or judge modes.
- [x] 3.2 Add unit tests asserting the new vocabulary: `spec.ts` resolves
  `kind: deterministic` and `kind: llm-judge` and warns (treats as unbound) on a
  legacy `kind: check`; `judge.ts` mode-filtering with the new mode values.
- [x] 3.3 Add/extend an integration or E2E assertion that `eval set` tags cases
  `[deterministic]`/`[llm-judge]`/`[unbound]` and never `[check]`/`[agent]`.
- [x] 3.4 Assert the shipped eval skill renders the new vocabulary for all
  registered agents (iterate the supported-tools registry — multi-agent-support).
- [x] 4.1 **Documentation (mandatory — `documentation` standard).** Update
  `docs/commands/eval.md`, `docs/configuration/config-yaml.md`,
  `.ratchet/evals/README.md`, and `README.md` to the new kind vocabulary and the
  `--judge auto|deterministic|llm-judge` values; verify no stale `check`/`agent`
  kind references remain in docs.
- [x] 5.1 Run the phase proof-of-work `pnpm build && pnpm vitest run eval` to a
  green exit, plus a repo-wide grep confirming no `kind: check`/`kind: agent`
  (or `[check]`/`[agent]` labels) survive outside the historical archive.
