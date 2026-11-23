# multi-agent-standard-neutrality

## Why

The multi-agent-support standard names an enumerated agent list (which already
omits Gemini) and cites internal file paths, so it rots as the registry and the
code move; meanwhile five rendered workflow bodies still instruct a bare
agent-specific tool (`**AskUserQuestion tool**` ×4 in apply/archive-change,
`**TodoWrite tool**` in propose) and one propose mention of a structured-question
tool lacks the plain-prose fallback. No test renders the shipped skills/commands
per registered agent, so these violations ship silently and can reappear.

## What Changes

- Rewrite `.ratchet/standards/multi-agent-support.md` atemporally: no enumerated
  agent list, no internal file paths; it requires capability phrasing with a
  plain-prose fallback instead of bare tool names, requires canonical
  `/rct:<name>` references, and forbids agent-branching prose.
- Fix the six phrasing violations in `src/core/templates/workflows/`
  (apply-change ×2, archive-change ×2, propose TodoWrite, propose's missing
  fallback) so every agent-specific capability reference uses the
  capability-plus-fallback form.
- Add a rendered-output neutrality test under `test/core/shared/` that renders
  every skill and command template for every registered agent and fails on a
  bare agent-specific tool name, plus a unit test proving the assertion itself
  rejects a violating sample.
- Implements `features/multi-agent-standard/neutral-wording.feature` and
  `features/agent-neutral-rendered-output/no-bare-tool-names.feature`.

## Design

- **Standard rewrite (atemporal).** The standard refers to the supported-tools
  registry only as a concept, describes the shared-template and adapter layers
  by role rather than by file location, and anchors rules to stable public
  surfaces (`/rct:<name>` invocations, rendered skill/command bodies). The
  generated `## Implemented by` block is preserved verbatim (it is
  machine-maintained). The rewrite keeps two existing rules, reworded by role
  with no file paths: the rule that generation tests iterate the registry
  rather than hard-coding one agent, and the rule that a proposal with an
  agent-facing surface enumerates its per-agent outputs in the plan. The
  adding-a-new-agent guideline is rewritten by role (a registry entry, a
  command adapter, rendered outputs) rather than by file. The standard names
  no other standard, carries no upstream version labels, and names tools only
  as optional examples of a capability (e.g. a structured-question capability
  such as AskUserQuestion, a progress-tracking capability such as TodoWrite).
  The capability rule is phrased harness-neutrally: "use a structured-question
  capability such as AskUserQuestion if your agent has one, otherwise ask in
  plain prose" — never "use the **AskUserQuestion tool**".
- **Violation fixes are text-only.** Each fix rewrites the offending sentence
  into the capability-plus-fallback form already used by the compliant
  templates (brainstorm, propose-batch, scope-reconciliation). No template
  structure, ordering, or other wording changes. This keeps the slice thin and
  the rendered-output diff minimal.
- **Enforcement at the unit layer.** The neutrality check is a pure predicate
  over a rendered body (per the testing standard's pyramid), exercised in two
  ways: (a) an integration-style loop that renders every skill template
  (`getSkillTemplates` / `generateSkillContent`) and every command template
  (`getCommandTemplates` / per-adapter `generateCommand`) for each agent in the
  supported-tools registry and asserts the predicate holds; (b) unit tests
  feeding the predicate known shapes and asserting accept/reject. The test
  file header names the two `.feature` files it proves.
- **Neutrality predicate shape.** The predicate is defined over an explicit
  list of known agent-specific tool names (at least `AskUserQuestion` and
  `TodoWrite`). For each mention of a listed tool name in a rendered body, the
  mention FAILS when either:
  1. it is a bare instruction — the `**<tool> tool**` form or an equivalent
     bare "use <tool>" instruction; or
  2. it lacks, in the same sentence/window, either the optional-capability
     qualifier ("if your agent has one") or a plain-prose fallback
     ("otherwise …"). This is exactly the shape at propose.ts step 5c
     (capability qualifier present, fallback missing), so the predicate fails
     on that line before the fix and passes after.
  The capability-plus-fallback form ("such as <tool> if your agent has one,
  otherwise <plain prose>") passes. Unit cases pin all three shapes: bare
  form fails; capability-without-fallback fails; capability-plus-fallback
  passes.
- **Per-agent outputs covered by the render loop.** Skills render to
  `<skillsDir>/skills/ratchet-<name>/SKILL.md` for every registry agent
  (`.claude`, `.codex`, `.cursor`, `.gemini`, `.github`, `.opencode`); commands
  render to each adapter's path (`.claude/commands/rct/<id>.md`,
  `<CODEX_HOME>/prompts/rct-<id>.md`, `.cursor/commands/rct-<id>.md`,
  `.gemini/commands/rct-<id>.md`, `.github/prompts/rct-<id>.prompt.md`,
  `.opencode/commands/rct-<id>.md`). The test iterates the registry rather than
  hard-coding one agent, so a newly registered agent is covered automatically.
  The render loop also asserts the checked set is non-empty and covers every
  registered agent: the number of agents iterated equals the supported-tools
  registry length, so a registry entry silently skipped by the loop fails the
  test.
- **Verification.** `pnpm vitest run test/core/shared` is green;
  `grep -rnE '\*\*(AskUserQuestion|TodoWrite) tool\*\*' src/core/templates/workflows`
  matches nothing (phase proof-of-work, minus the explore.ts clauses owned by
  the sibling changes in this phase); and per the testing standard the full
  suite (`pnpm test`) and the coverage gate (`pnpm test:coverage`) are green —
  a change is not done until its tests are, and the new test file must not
  lower coverage below the enforced threshold.

## Tasks

- [x] 1.1 Rewrite `.ratchet/standards/multi-agent-support.md` atemporally:
  remove the enumerated agent list and all internal file paths; require
  capability phrasing with a plain-prose fallback, canonical `/rct:<name>`
  references, and a ban on agent-branching prose. Preserve the generated
  `## Implemented by` block verbatim; keep (reworded by role, without file
  paths) the registry-iterating-tests rule and the
  enumerate-per-agent-outputs-at-proposal rule; rewrite the
  adding-a-new-agent guideline by role, not by file; include no references to
  other standards and no upstream version labels; name tools only as optional
  examples of a structured-question / progress-tracking capability (features:
  `multi-agent-standard/neutral-wording.feature`)
- [x] 1.2 Fix the two `**AskUserQuestion tool**` violations in
  `src/core/templates/workflows/apply-change.ts` (skill body and command body)
  using the capability-plus-fallback form
- [x] 1.3 Fix the two `**AskUserQuestion tool**` violations in
  `src/core/templates/workflows/archive-change.ts` the same way
- [x] 1.4 Fix `src/core/templates/workflows/propose.ts`: replace the bare
  `**TodoWrite tool**` instruction with the capability-plus-fallback form, and
  add the missing plain-prose fallback to the step-5c structured-question
  mention
- [x] 2.1 Add the rendered-output neutrality test under `test/core/shared/`
  (header naming both `.feature` files): a pure predicate defined over an
  explicit list of known agent-specific tool names (at least `AskUserQuestion`
  and `TodoWrite`) where a mention fails when it is (a) a bare instruction
  (`**<tool> tool**` or bare "use <tool>") or (b) missing the
  optional-capability qualifier ("if your agent has one") or the plain-prose
  fallback ("otherwise …") in the same sentence/window — the current
  propose.ts step-5c shape must fail before the fix; a render loop over every
  skill and command template for every registered agent asserting the
  predicate and asserting the checked agent set is non-empty with count equal
  to the registry length; and unit cases pinning the three shapes (bare form
  fails; capability-without-fallback fails; capability-plus-fallback passes)
- [x] 2.2 Run `pnpm vitest run test/core/shared` and the proof-of-work grep;
  both must pass. Per the testing standard, also run the full suite
  (`pnpm test`) and the coverage gate (`pnpm test:coverage`); both must be
  green
- [x] 3.1 Documentation (per the `documentation` standard): update the
  "Per-tool skills and commands" section of
  `docs/configuration/generated-artifacts.md` to state that rendered skill and
  command bodies are agent-neutral — agent-specific capabilities appear only
  in the capability-plus-fallback form and cross-workflow references use the
  canonical `/rct:<name>` form. Keep the addition Reference-style: facts only,
  no rationale or tutorial prose. No `README.md` change: the README does not
  describe template phrasing, and its supported-agent prerequisite table is an
  install surface, not shared content.
