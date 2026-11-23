# apply-honest-scope

## Why

The apply workflow can claim more than it proved: its skill and command bodies
are two near-duplicate hand-maintained copies that have already drifted (one
says "suggest using ratchet-propose", the other "suggest using `/rct:propose`";
their completion outputs differ), nothing forbids silently implementing a
narrower behavior than a scenario or task specifies, a task can be ticked `[x]`
on inference or intention rather than evidence, and completion points straight
at archive with no verify gate in between. Absorb the batch-approved honesty
sharpening for apply: one shared body, stop-name-ask on scope narrowing,
evidence before every tick, and `/rct:verify` suggested when all tasks are
done.

## What Changes

- Rewrite `src/core/templates/workflows/apply-change.ts` to collapse the skill
  body and the command body into one shared `APPLY_BODY` constant (mirroring
  `VERIFY_BODY` in `verify-change.ts`), consumed by both
  `getApplyChangeSkillTemplate().instructions` and
  `getRctApplyCommandTemplate().content`. While collapsing, reconcile the two
  copies' existing drift to the canonical form (`/rct:propose`,
  `/rct:archive`, one shared completion output).
- Add the scope-honesty rules to `APPLY_BODY`
  (features: `apply-scope-honesty/honest-scope.feature`):
  - **No silent scope narrowing.** When the specified behavior cannot be
    implemented as written, the agent must STOP, name the scope it would have
    to narrow, and ask the user before proceeding — never silently implement
    a narrower behavior than the scenario or task specifies. Stated as
    consistent with scope reconciliation: an unwritten intention is an
    omission, and omissions are the user's decision, never the agent's.
  - **Evidence before `[x]`.** A task is marked complete in `plan.md` only
    with concrete evidence the specified behavior is fully implemented (the
    related Scenario's Given/When/Then holds in the code just written) —
    never on partial, inferred, or intended work; partial work stays unticked
    and is named in the session status.
  - **Suggest `/rct:verify` on completion.** When all tasks are done, step
    3's `all_done` handling, the status step, and the completion output
    suggest running `/rct:verify` so completion claims are checked before
    any archive, instead of presenting archive as the immediate next step.
- Align the runtime apply payload minimally with the same honesty rules — a
  short pointer, not a second copy of the rules (features:
  `apply-scope-honesty/honest-scope.feature`):
  - `schemas/ratchet/schema.yaml` `apply.instruction`: replace "marking them
    complete as you go" with ticking a task only once its specified behavior
    is fully implemented with evidence, deferring to the apply workflow.
  - `src/commands/workflow/instructions.ts`: the `all_done` instruction
    suggests running `/rct:verify` instead of declaring the change "ready to
    be archived", and the ready-state fallback carries the same evidence
    wording. Both strings stay short and do not restate the stop-name-ask
    rule.
- Extend `test/core/shared/lifecycle-honesty.test.ts` — the shared phase file
  created by `verify-honest-report` — with the apply slice: an apply-honesty
  predicate, source-level assertions that both getters consume `APPLY_BODY`,
  a render loop over every registered agent's apply skill and command output,
  and unit cases proving the assertions reject the pre-change body shape
  (features: `lifecycle-honesty/apply-rendered-output.feature`). The existing
  verify slice stays green untouched.
- Documents the new apply rules in `docs/commands/apply.md`: a new lead
  `## Overview` section whose first artifact is a Mermaid `flowchart TD` of
  the apply loop — including the stop-name-ask branch and the verify handoff
  (per the `documentation` standard's Overview rule; apply is a core
  lifecycle flow this change alters) — plus a Reference-style "Apply scope
  honesty" section. `README.md` is unchanged: its apply row ("Implements
  against each scenario's `Given/When/Then`, checking off plan tasks")
  describes no behavior this change removes — tasks are still checked off,
  now evidence-gated — and names no completion suggestion.

## Design

- **One author of lifecycle text (delegated-lifecycle).** Every workflow-body
  edit lands in one `APPLY_BODY` constant in
  `src/core/templates/workflows/apply-change.ts`;
  `getApplyChangeSkillTemplate` and `getRctApplyCommandTemplate` both consume
  it, so skill and command cannot drift. No CLI or engine changes, and no
  schema-structure changes: the shipped ratchet schema's `apply.instruction`
  text is minimally reworded (below), but no schema keys, payload keys, or
  payload shapes change. The engine keeps delegating to the canonical
  `/rct:apply` skill untouched.
- **Stop-name-ask, phrased to the reconciliation principle.** The
  scope-narrowing rule is authored in `APPLY_BODY` prose as
  stop → name the narrowed scope → ask the user, and cites the same principle
  scope reconciliation enforces (an unwritten intention is an omission;
  omissions are the user's decision to make). It does not interpolate the
  `scope-reconciliation.ts` constants: those are authoring-moment constants
  (pre/post-artifact issue reconciliation for propose/propose-batch/
  decompose-phase), while apply is the implementation moment — the rule is
  consistent with them, not a reuse of text written for a different step.
- **Evidence before tick.** Step 6's "mark task complete" instruction and the
  Guardrails gain the evidence bar: tick `[x]` only when the specified
  behavior — the task text and each related Scenario's Given/When/Then — is
  fully implemented in the code just written, with the concrete evidence in
  hand (the files changed and the behavior observed). Inference, intention,
  and partial work do not tick; partial work is reported as partial in the
  session status instead.
- **Verify before archive.** Step 3's `state: "all_done"` handling, step 7's
  all-done branch, and the "Output On Completion" block suggest `/rct:verify`
  (canonical form, multi-agent-support) so the verify gate sits between
  "tasks ticked" and "archive", and the archive-first completion wording is
  removed. The archive skill itself is untouched.
- **Runtime payload: minimal alignment, not a second copy.** The
  `ratchet instructions apply --json` payload is the apply workflow's runtime
  echo, so it gets the smallest honest wording: the schema instruction and
  the ready-state fallback tick a task only once its specified behavior is
  fully implemented with evidence and defer to the apply workflow for the
  rule itself, and the `all_done` instruction suggests `/rct:verify` before
  any archive. The strings stay short, do not restate the stop-name-ask
  scope rule, and introduce no new payload keys — `APPLY_BODY` remains the
  single author of the rules.
- **Enforcement at the unit layer (testing standard).** The apply slice
  appends to `test/core/shared/lifecycle-honesty.test.ts`, mirroring the
  verify slice: pure string predicates over a rendered apply body for each
  guardrail (stop-name-ask on scope narrowing; evidence-before-tick and its
  partial-work corollary; `/rct:verify` suggested on completion and the
  archive-first completion wording gone), source-level collapse assertions
  (the apply-change.ts source names one `APPLY_BODY` consumed by both
  getters, and both getters render byte-identical bodies), a render loop over
  every apply skill template (`getSkillTemplates(['apply'])` /
  `generateSkillContent`) and command template (`getCommandContents(['apply'])`
  / per-adapter `generateCommand`) for each agent in the supported-tools
  registry (`AI_TOOLS`, `CommandAdapterRegistry`) asserting the checked agent
  set is non-empty and equal to the registry length, and unit cases feeding
  the predicate the pre-change body shape (silent narrowing allowed, ticking
  without evidence, archive suggested on completion) and asserting rejection.
  Source-level payload assertions pin the minimal runtime alignment: the
  shipped `schemas/ratchet/schema.yaml` apply instruction and the
  `instructions.ts` strings carry the new evidence and `/rct:verify` wording,
  and the old phrases ("marking them complete as you go", "mark complete as
  you go", "ready to be archived") are gone from both files.
  `test/commands/workflow/instructions.test.ts` pins the runtime behavior:
  the `all_done` instruction suggests `/rct:verify`, and a ready-state schema
  with a tracks file but no apply instruction falls back to the evidence
  wording. The file header is updated to also name
  `apply-scope-honesty/honest-scope.feature` and
  `lifecycle-honesty/apply-rendered-output.feature`.
- **Per-agent outputs covered (multi-agent-support).** The apply skill renders
  to `<skillsDir>/skills/ratchet-apply-change/SKILL.md` for every registry
  agent (`.claude`, `.codex`, `.cursor`, `.gemini`, `.github`, `.opencode`);
  the command renders to each adapter's path (`.claude/commands/rct/apply.md`,
  `<CODEX_HOME>/prompts/rct-apply.md`, `.cursor/commands/rct-apply.md`,
  `.gemini/commands/rct-apply.md`, `.github/prompts/rct-apply.prompt.md`,
  `.opencode/commands/rct/apply.md`). The render loop iterates the registry,
  so a newly registered agent is covered automatically. All new ask-the-user
  prose uses the capability-plus-fallback form ("use a structured-question
  capability such as AskUserQuestion if your agent has one, otherwise ask in
  plain prose"), keeping `agent-neutral-rendered-output.test.ts` green;
  cross-workflow references stay in the canonical `/rct:<name>` form.
- **Static body, no new dynamic inputs (instruction-fed-config).** The honesty
  rules are static template text; apply keeps consuming the same
  `ratchet instructions apply --json` payload (`contextFiles`, progress,
  state) and reads no config and no new payload keys.
- **No shipped toolchain literals (generalizable-defaults).** The new prose
  names no test command, package manager, or tool-specific path; evidence is
  described as behavior observation, not a ratchet-specific command string.
- **Verification.** `pnpm vitest run test/core/shared/lifecycle-honesty.test.ts`
  is green (both the apply slice and the pre-existing verify slice);
  `agent-neutral-rendered-output.test.ts` stays green; and per the testing
  standard the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`) stay green. The phase proof-of-work's grep halves
  (`Not verified` in verify-change.ts, `force-push` in open-pr.ts) belong to
  the sibling changes; this change's contribution is the extended shared test
  file passing.

## Tasks

- [x] 1.1 In `src/core/templates/workflows/apply-change.ts`, collapse the
  skill and command bodies into one shared `APPLY_BODY` constant consumed by
  both `getApplyChangeSkillTemplate().instructions` and
  `getRctApplyCommandTemplate().content`, reconciling the existing drift to
  the canonical `/rct:` form (features:
  `apply-scope-honesty/honest-scope.feature`)
- [x] 1.2 Add the no-silent-scope-narrowing rule to `APPLY_BODY` (step 6 and
  Guardrails): STOP when the specified behavior cannot be implemented as
  written, name the scope that would have to be narrowed, and ask the user —
  capability-plus-fallback phrasing — before proceeding; state its
  consistency with scope reconciliation (an unwritten intention is an
  omission; omissions are the user's decision)
- [x] 1.3 Add the evidence-before-`[x]` rule to `APPLY_BODY` (step 6 and
  Guardrails): tick a task only with concrete evidence the specified behavior
  is fully implemented; partial, inferred, or intended work stays unticked
  and is reported as partial in the session status
- [x] 1.4 Change the completion path in `APPLY_BODY` (step 3's
  `state: "all_done"` handling, step 7, and "Output On Completion") to
  suggest running `/rct:verify` when all tasks are done, removing the
  archive-first completion wording, so only one copy of the completion rule
  remains after the collapse
- [x] 1.5 Align the runtime apply payload minimally (features:
  `apply-scope-honesty/honest-scope.feature`): in `schemas/ratchet/schema.yaml`,
  replace `apply.instruction`'s "marking them complete as you go" with
  ticking a task only once its specified behavior is fully implemented with
  evidence, deferring to the apply workflow; in
  `src/commands/workflow/instructions.ts`, replace the `all_done` instruction
  ("ready to be archived") with a suggestion to run `/rct:verify`, and the
  ready-state fallback ("mark complete as you go") with the same evidence
  wording — short strings, no stop-name-ask restatement, no new payload keys
- [x] 2.1 Extend `test/core/shared/lifecycle-honesty.test.ts` with the apply
  slice (header naming `apply-scope-honesty/honest-scope.feature` and
  `lifecycle-honesty/apply-rendered-output.feature`): an apply-honesty
  predicate over a rendered apply body, source-level collapse assertions
  (one `APPLY_BODY`, both getters consume it, both render byte-identical
  bodies), a render loop over every apply skill and command template for
  every registered agent asserting the predicates hold and the checked agent
  set is non-empty and equal to the registry length, unit cases asserting
  the predicate rejects the pre-change body shape, and source-level payload
  assertions that `schemas/ratchet/schema.yaml` and
  `src/commands/workflow/instructions.ts` carry the new wording and the old
  phrases ("marking them complete as you go", "mark complete as you go",
  "ready to be archived") are gone; extend
  `test/commands/workflow/instructions.test.ts` to pin the `all_done`
  instruction's `/rct:verify` suggestion and the ready-state fallback's
  evidence wording
- [x] 2.2 Run `pnpm vitest run test/core/shared/lifecycle-honesty.test.ts` and
  `pnpm vitest run test/core/shared/agent-neutral-rendered-output.test.ts`;
  both must pass. Per the testing standard, also run the full suite
  (`pnpm test`) and the coverage gate (`pnpm test:coverage`); both must be
  green
- [x] 3.1 Documentation (per the `documentation` standard, including its
  Overview rule): `docs/commands/apply.md` currently has no Overview and no
  Mermaid diagram, and apply is a core lifecycle flow whose behavior this
  change alters.
  - Add an `## Overview` section as the lead of `docs/commands/apply.md`
    whose first artifact is one valid Mermaid `flowchart TD` showing the
    apply loop. The Overview states which surface the diagram covers: the
    `/rct:apply` skill loop (the agent-facing apply workflow this change
    alters), as distinct from the headless `ratchet apply` CLI command the
    page otherwise documents. The loop: select the change and load context;
    implement each task
    against its scenarios' Given/When/Then; a task that cannot be implemented
    as written stops, names the narrowed scope, and asks the user; a task
    ticks `[x]` only with concrete evidence the specified behavior is fully
    implemented; when all tasks are done, suggest `/rct:verify` before any
    archive. Every `classDef` must set `color:`, use high-contrast fills, and
    label nodes with semantic Unicode symbols; the diagram must match the new
    `APPLY_BODY` exactly.
  - Add a Reference-style "Apply scope honesty" section stating the rules
    (one shared body authors skill and command; scope narrowing is a
    stop-name-ask event, never silent; `[x]` requires concrete evidence of
    the fully implemented specified behavior; completion suggests
    `/rct:verify`) — facts only, matching the existing entry's tone.
  - No `README.md` change: the README's apply row describes implementing
    against scenarios and checking off plan tasks, behavior this change
    keeps (now evidence-gated), and names no completion suggestion.
