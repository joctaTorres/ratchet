# propose-planning-only

## Why

The propose workflow can claim more than its role allows: nothing in its
rendered body stops the agent from continuing past authoring the change
artifacts and implementing the plan in the very same response, and the skill
surface's closing prompt actively invites it ("Run `/rct:apply` or ask me to
implement to start working on the tasks"). A proposal that silently becomes an
implementation session skips the apply/verify gates that give the lifecycle its
meaning. Absorb the batch-approved honesty sharpening for propose: the template
states a hard planning boundary — it authors the change artifacts and its work
ends there — and enforces it, so implementation is always a separate
`/rct:apply` step.

## What Changes

- Add the planning-boundary statement and its enforcement to the shared
  propose body in `src/core/templates/workflows/propose.ts` (built by
  `buildProposeBody`, consumed by both the skill and the command surface)
  (features: `propose-planning-boundary/planning-only.feature`):
  - **Stated boundary.** The body states that the workflow's job is to author
    the change artifacts — the executable Gherkin features and `plan.md` —
    and that its work ends there, named explicitly as a planning boundary.
  - **Enforced boundary.** The body forbids implementing any of the plan's
    tasks in the same response that authored them — not partially, not one
    task, not a head start, and not even when the user asks in the same
    breath — and directs the agent to end its turn after authoring,
    reconciliation, and the final status, handing implementation to
    `/rct:apply` as a separate step.
  - **Boundary-safe closing prompt.** The skill surface's closing prompt
    line no longer invites same-response implementation ("or ask me to
    implement" is removed); both surfaces' closing prompts route to
    `/rct:apply` to start implementing.
- Extend `test/core/shared/lifecycle-honesty.test.ts` — the shared phase file
  created by `verify-honest-report` and extended by `apply-honest-scope` —
  with the propose slice: a planning-boundary predicate, source-level
  assertions that both propose getters render the shared body carrying the
  boundary, a render loop over every registered agent's propose skill and
  command output, and unit cases proving the assertions reject the
  pre-change body shape (features:
  `lifecycle-honesty/propose-rendered-output.feature`). The existing verify
  and apply slices stay green untouched.
- Documents the boundary in `docs/commands/propose.md`: a new lead
  `## Overview` section whose first artifact is a Mermaid `flowchart TD` of
  the `/rct:propose` skill loop ending at the planning boundary (per the
  `documentation` standard's Overview rule; propose is a core lifecycle flow
  this change alters), plus a Reference-style "Planning boundary" section.
  `README.md`'s workflow-table `propose` row gains the boundary clause: the
  row describes propose's behavior, which this change alters by ending the
  workflow at authoring.

## Design

- **One author of lifecycle text (delegated-lifecycle).** The boundary is
  authored once in the shared body inside `buildProposeBody` in
  `src/core/templates/workflows/propose.ts`;
  `getRctProposeSkillTemplate().instructions` and
  `getRctProposeCommandTemplate().content` both render it, so the skill and
  command cannot drift on the rule — the existing two-delta structure (the
  **Input** line and the closing **Prompt** line) stays the only difference
  between the surfaces. No CLI or engine changes, and no schema changes: the
  boundary is agent-facing skill text, not orchestration semantics, and the
  engine keeps delegating to the canonical `/rct:propose` skill untouched.
- **Stated and enforced — the boundary's two halves.** The statement half
  (the workflow authors the change artifacts and its work ends there, named
  as a planning boundary) lands near the top of the shared body so it frames
  every step; the enforcement half lands where the agent could otherwise
  drift — the closing of the steps and the Guardrails: never implement any
  of the plan's tasks in this same response, not partially and not even when
  asked in the same breath; after authoring, reconciliation, and the final
  status, end the turn and hand implementation to `/rct:apply` as a separate
  step. Both halves are required: a stated boundary without the enforcement
  rule is advice, and an enforcement rule without the statement is
  unmotivated.
- **Boundary-safe closing prompts.** The skill's closing
  `SKILL_PROMPT_LINE` is reworded so it routes to `/rct:apply` without
  inviting the agent to implement in the same response — the current "or ask
  me to implement" clause is exactly the invitation the boundary forbids.
  The command's closing `COMMAND_PROMPT_LINE` ("Run `/rct:apply` to start
  implementing.") already routes to the separate step and stays in the
  canonical `/rct:` form (multi-agent-support).
- **Enforcement at the unit layer (testing standard).** The propose slice
  appends to `test/core/shared/lifecycle-honesty.test.ts`, mirroring the
  verify and apply slices: pure string predicates over a rendered propose
  body for each guardrail (boundary stated and named; same-response
  implementation forbidden, including the partial and asked-for corollaries;
  turn ends after the final status with implementation handed to
  `/rct:apply`; no closing-prompt invitation to same-response
  implementation), source-level assertions that the propose.ts source keeps
  one shared body builder consumed by both getters and that both getters
  render the boundary text, a render loop over every propose skill template
  (`getSkillTemplates(['propose'])` / `generateSkillContent`) and command
  template (`getCommandContents(['propose'])` / per-adapter
  `generateCommand`) for each agent in the supported-tools registry
  (`AI_TOOLS`, `CommandAdapterRegistry`) asserting the checked agent set is
  non-empty and equal to the registry length, and unit cases feeding the
  predicate the pre-change body shape (no planning boundary; a closing
  prompt inviting same-response implementation) and asserting rejection. The
  file header is updated to also name
  `propose-planning-boundary/planning-only.feature` and
  `lifecycle-honesty/propose-rendered-output.feature`.
- **Per-agent outputs covered (multi-agent-support).** The propose skill
  renders to `<skillsDir>/skills/ratchet-propose/SKILL.md` for every registry
  agent (`.claude`, `.codex`, `.cursor`, `.gemini`, `.github`, `.opencode`);
  the command renders to each adapter's path
  (`.claude/commands/rct/propose.md`, `<CODEX_HOME>/prompts/rct-propose.md`,
  `.cursor/commands/rct-propose.md`, `.gemini/commands/rct-propose.md`,
  `.github/prompts/rct-propose.prompt.md`,
  `.opencode/commands/rct/propose.md`). The render loop iterates the
  registry, so a newly registered agent is covered automatically. The new
  prose adds no agent-specific tool references (keeping
  `agent-neutral-rendered-output.test.ts` green), and the hand-off reference
  stays in the canonical `/rct:apply` form.
- **Static body, no new dynamic inputs (instruction-fed-config).** The
  boundary is static template text; propose keeps consuming the same
  `ratchet instructions <artifact-id> --json` payload and reads no config
  and no new payload keys.
- **No shipped toolchain literals (generalizable-defaults).** The new prose
  names no test command, package manager, or tool-specific path; the
  hand-off names only the canonical `/rct:apply` workflow.
- **Verification.** `pnpm vitest run test/core/shared/lifecycle-honesty.test.ts`
  is green (the propose slice plus the pre-existing verify and apply slices);
  `agent-neutral-rendered-output.test.ts` stays green; and per the testing
  standard the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`) stay green. The phase proof-of-work's grep halves
  (`Not verified` in verify-change.ts, `force-push` in open-pr.ts) belong to
  the sibling changes; this change's contribution is the extended shared test
  file passing.

## Tasks

- [x] 1.1 In `src/core/templates/workflows/propose.ts`, add the
  planning-boundary statement to the shared body built by
  `buildProposeBody`: the workflow's job is to author the change artifacts —
  the executable Gherkin features and `plan.md` — and its work ends there,
  named explicitly as a planning boundary (features:
  `propose-planning-boundary/planning-only.feature`)
- [x] 1.2 Add the boundary enforcement to the shared body (closing of the
  steps and the Guardrails): never implement any of the plan's tasks in the
  same response that authored them — not partially, not one task, not a head
  start, and not even when the user asks in the same breath; after
  authoring, reconciliation, and the final status, end the turn and hand
  implementation to `/rct:apply` as a separate step
- [x] 1.3 Reword the skill surface's closing `SKILL_PROMPT_LINE` in
  `propose.ts` so it routes to `/rct:apply` without inviting same-response
  implementation (remove the "or ask me to implement" clause); keep the
  command surface's `COMMAND_PROMPT_LINE` in the canonical `/rct:` form
- [x] 2.1 Extend `test/core/shared/lifecycle-honesty.test.ts` with the
  propose slice (header naming
  `propose-planning-boundary/planning-only.feature` and
  `lifecycle-honesty/propose-rendered-output.feature`): a planning-boundary
  predicate over a rendered propose body, source-level assertions that
  `propose.ts` keeps one shared body builder consumed by both getters and
  that both getters render the boundary text, a render loop over every
  propose skill and command template for every registered agent asserting
  the predicates hold and the checked agent set is non-empty and equal to
  the registry length, and unit cases asserting the predicate rejects the
  pre-change body shape (no planning boundary; a closing prompt inviting
  same-response implementation)
- [x] 2.2 Run `pnpm vitest run test/core/shared/lifecycle-honesty.test.ts`
  and `pnpm vitest run test/core/shared/agent-neutral-rendered-output.test.ts`;
  both must pass. Per the testing standard, also run the full suite
  (`pnpm test`) and the coverage gate (`pnpm test:coverage`); both must be
  green
- [x] 3.1 Documentation (per the `documentation` standard, including its
  Overview rule): `docs/commands/propose.md` currently has no Overview and
  no Mermaid diagram, and propose is a core lifecycle flow whose behavior
  this change alters.
  - Add an `## Overview` section as the lead of `docs/commands/propose.md`
    whose first artifact is one valid Mermaid `flowchart TD` showing the
    propose loop. The Overview states which surface the diagram covers: the
    `/rct:propose` skill loop (the agent-facing propose workflow this
    change alters), as distinct from the headless `ratchet propose` CLI
    command the page otherwise documents. The loop: clarify intent and
    derive a name; enumerate every originating issue's requirements;
    scaffold the change and author the artifacts (features, then plan);
    reconcile the artifacts against every originating issue; show the final
    status; STOP at the planning boundary — implementation is a separate
    `/rct:apply` step, never the same response. Every `classDef` must set
    `color:`, use high-contrast fills, and label nodes with semantic
    Unicode symbols; the diagram must match the new shared body exactly.
  - Add a Reference-style "Planning boundary" section stating the rules
    (propose authors the change artifacts and its work ends there; it never
    implements the plan's tasks in the same response, not partially and not
    even when asked; implementation is a separate `/rct:apply` step) —
    facts only, matching the existing entry's tone.
  - `README.md`: the workflow-table `propose` row gains the boundary clause
    (the workflow generates `features/` + `plan.md`, reconciles them, and
    stops — implementation is `/rct:apply`'s job, never the same response),
    since the row describes propose's behavior, which this change alters.
