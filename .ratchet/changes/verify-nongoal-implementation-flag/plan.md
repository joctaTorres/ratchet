# verify-nongoal-implementation-flag

## Why

Plans now record what a change deliberately will not do in a `## Non-goals`
section (sibling change `plan-template-nongoals-approaches`), but nothing
notices when the implementation does the ruled-out work anyway: verify checks
tasks, scenarios, design adherence, and standards, and never reads the
section. This change makes verify read `## Non-goals` and flag each listed
Non-goal the implementation implements, so scope decided against with the
user, an issue, or a brainstorm surfaces in the report instead of passing
silently.

## What Changes

- `src/core/templates/workflows/verify-change.ts` `VERIFY_BODY` — the single
  body consumed by both the `ratchet-verify-change` skill template and the
  `rct-verify` command template:
  - Step 8 (**Verify Coherence**) gains a **Non-goals Adherence** block beside
    **Design Adherence**: when plan.md carries a `## Non-goals` section, read
    its entries; for each listed Non-goal, check whether the implementation
    implements it anyway; if so, add a WARNING issue
    `Non-goal implemented: <entry>` with a specific recommendation (remove the
    out-of-scope implementation, or confirm the reversed decision with the
    user and update plan.md's `## Non-goals`). When the plan has no
    `## Non-goals` section, or the section states explicitly that nothing was
    ruled out, there is nothing to check — skip it, and never fail a plan for
    lacking the section.
  - Step 11's **WARNING** report category gains the corresponding entry:
    "Non-goals the implementation implements".
  - The honesty guardrails (uncovered scenario is CRITICAL, "Not verified"
    reporting and gating, fresh test-command evidence), the @holdout
    handling, and every other step stay intact — this change adds the
    Non-goals check only.
- `test/core/shared/plan-nongoals.test.ts` (appended; created by
  `plan-template-nongoals-approaches`): a pure-string
  `findVerifyNongoalViolations(body): string[]` predicate over a rendered
  verify body with unit cases rejecting the pre-change body shape (no
  Non-goals check) on every dimension and accepting a well-formed body, and
  render loops asserting the predicate holds of the verify skill and command
  rendered for every registered agent. The file header gains the new feature
  reference.
- Documents the new verify behavior in `docs/commands/verify.md` (per the
  `documentation` standard).
- Implements `features/plan-nongoals/verify-implemented-nongoal-flag.feature`.

The phase's sibling behaviors are separate batch changes by the approved
decomposition, not part of this one: the template, schema instruction, and
propose-body sections (`plan-template-nongoals-approaches`, already applied)
and the validate-on-missing-Non-goals warning (`validate-nongoals-warning`,
already applied).

## Non-goals

- CLI- or engine-side machinery for the flag (a validator rule or a computed
  check in the verify command) — decided by the user-approved phase
  decomposition in `.ratchet/batches/upstream-absorption/batch.yaml`: this
  change's done criterion pins the verify *body* as the check site, and
  judging whether code implements a Non-goal requires codebase comprehension
  only the verifying agent has.
- CRITICAL-level classification of an implemented Non-goal — the phase goal
  pins "verify flags an implemented Non-goal" (flag, not block), and the
  verify body's own false-positives heuristic prefers WARNING over CRITICAL;
  reversing a recorded decision is the user's call, so the report surfaces it
  as a WARNING with a recommendation.
- Content linting of the `## Non-goals` section (judging whether an entry
  really traces to a user/issue/brainstorm decision, or whether its prose is
  well-formed) — the user-approved batch manifest scopes this change to
  flagging implemented Non-goals; provenance guidance lives in the template
  and instruction text owned by `plan-template-nongoals-approaches`.
- The plan template, schema instruction, propose-body guidance, and the
  validate warning — owned by the sibling changes
  `plan-template-nongoals-approaches` and `validate-nongoals-warning` per the
  approved decomposition; both are already applied.

## Design

- **One author of lifecycle text (delegated-lifecycle).** The only
  lifecycle-template edit lands in the shared `VERIFY_BODY` constant;
  `getVerifyChangeSkillTemplate` and `getRctVerifyCommandTemplate` keep
  consuming that one constant, so the skill and command surfaces cannot
  drift. No engine, CLI, or batch code changes: the check is performed by the
  verifying agent following the shared body, which is exactly where the
  phase's done criterion puts it.
- **The check rides Coherence, beside Design Adherence.** Both read a plan.md
  section and check the implementation respects it: Design Adherence catches
  contradiction of what the plan says to do; Non-goals Adherence catches
  implementation of what the plan says not to do. Placing the check inside
  step 8 keeps the report's four-dimension structure unchanged — no new
  dimension, no scorecard shape change — which is the thinnest slice that
  proves the phase goal end to end.
- **WARNING by decision, with a user-decision recommendation.** An
  implemented Non-goal is scope creep against a decision the user, an
  originating issue, or a brainstorm made — the same severity as the
  neighboring "Design decision not followed" WARNING. The recommendation
  names both resolutions (remove the out-of-scope implementation, or confirm
  the reversed decision with the user and update the plan) because the entry
  traces to a recorded decision and reversing it is never the agent's call —
  the same contract the propose body's scope-reconciliation guardrail
  enforces.
- **Skip semantics keep pre-section plans passing.** The check fires only
  when the section is present and lists entries; the explicit
  nothing-ruled-out one-liner is a section with no entries to check. Plans
  authored before the section existed (the sibling validate change's sweep
  counts dozens of active and archived ones) are never failed for the
  absence — validate already nudges on that axis with its own WARNING.
- **Enforcement at the unit layer (testing standard).**
  `test/core/shared/plan-nongoals.test.ts` gains: (a) a pure-string
  `findVerifyNongoalViolations(body): string[]` predicate asserting each
  dimension — the read-the-section direction, the per-entry implementation
  check, the WARNING flag naming the entry, the specific recommendation, the
  skip-when-absent rule, the nothing-ruled-out one-liner rule, and the
  WARNING report-category entry; (b) unit cases feeding the predicate the
  pre-change body shape (no Non-goals check) and asserting rejection on every
  dimension, plus one well-formed body asserted clean; (c) render loops
  iterating the verify skill template (`getSkillTemplates(['verify'])` /
  `generateSkillContent`) and command template (`getCommandContents(['verify'])`
  / per-adapter `generateCommand`) for each agent in the supported-tools
  registry (`AI_TOOLS`, `CommandAdapterRegistry`), asserting the predicate
  holds and the checked agent set is non-empty and equal to the registry
  length — the same loop pattern the file's propose blocks already use. The
  file header gains
  `features/plan-nongoals/verify-implemented-nongoal-flag.feature`. No CLI
  behavior changes, so no E2E layer is exercised.
- **Per-agent outputs covered (multi-agent-support).** The verify skill
  renders to `<skillsDir>/skills/ratchet-verify-change/SKILL.md` for every
  registry agent (`.claude`, `.codex`, `.cursor`, `.gemini`, `.github`,
  `.opencode`); the command renders to each adapter's path
  (`.claude/commands/rct/verify.md`, `<CODEX_HOME>/prompts/rct-verify.md`,
  `.cursor/commands/rct-verify.md`, `.gemini/commands/rct-verify.md`,
  `.github/prompts/rct-verify.prompt.md`,
  `.opencode/commands/rct-verify.md`). The render loop iterates the registry,
  so a newly registered agent is covered automatically. The new prose names
  no agent and no agent-specific capability and branches on no agent.
- **Ecosystem-agnostic default text (generalizable-defaults).** The new
  verify-body prose names only ratchet's own plan format (`## Non-goals`,
  plan.md) — no package manager, test runner, build tool, language, command
  string, or tool-specific path — so the shipped default stays
  ecosystem-agnostic.
- **Not engaged.** `instruction-fed-config` (no new config and nothing reads
  config — plan.md is a change artifact the verify body already reads, not
  configuration), `security-remediation` (not security-relevant).
- **Verification.** `pnpm vitest run test/core/shared/plan-nongoals.test.ts`
  is green alongside `test/core/shared/lifecycle-honesty.test.ts` (which pins
  the same verify body and must stay green); the phase proof-of-work grep
  this change owns
  (`grep -qi 'non-goal' src/core/templates/workflows/verify-change.ts`)
  passes; and per the testing standard the full suite (`pnpm test`) and the
  coverage gate (`pnpm test:coverage`) stay green.

### Approaches considered

- **A Coherence block in the shared verify body (chosen).** The check lands
  beside Design Adherence in step 8 of the one `VERIFY_BODY` constant every
  verify surface consumes — one author, every registered agent rendered, no
  CLI code, and the report's dimension structure unchanged.
- **A CLI-side computed check (validator rule or verify-command pass).**
  Rejected: whether the implementation implements a Non-goal is a
  codebase-comprehension judgment no deterministic CLI rule can make — it is
  inherently the verifying agent's work; and a second, engine-local check
  site would duplicate lifecycle meaning the shared body already owns, the
  drift the delegated-lifecycle standard forbids.
- **A new top-level verify step and fifth report dimension.** Rejected:
  heavier than the slice needs — a new dimension changes the scorecard shape
  and the honesty text for no behavior gain, while Coherence already owns
  plan-implementation alignment.

## Tasks

- [x] 1.1 Edit `VERIFY_BODY` in `src/core/templates/workflows/verify-change.ts`:
  add a **Non-goals Adherence** block to step 8 (Verify Coherence) directing
  that when plan.md carries a `## Non-goals` section the agent reads its
  entries and, for each listed Non-goal, checks whether the implementation
  implements it anyway — adding a WARNING issue
  `Non-goal implemented: <entry>` with the recommendation to remove the
  out-of-scope implementation or confirm the reversed decision with the user
  and update plan.md's `## Non-goals` — and directing that when the plan has
  no `## Non-goals` section, or the section states explicitly that nothing
  was ruled out, the check is skipped and a plan is never failed for lacking
  the section; add "Non-goals the implementation implements" to step 11's
  WARNING report category; keep the honesty guardrails, @holdout handling,
  and every other step intact (features:
  `plan-nongoals/verify-implemented-nongoal-flag.feature`)
- [x] 2.1 Append to `test/core/shared/plan-nongoals.test.ts` (file header
  gains `features/plan-nongoals/verify-implemented-nongoal-flag.feature`):
  the pure-string `findVerifyNongoalViolations(body): string[]` predicate
  over a rendered verify body (read-the-section direction, per-entry
  implementation check, WARNING flag naming the entry, specific
  recommendation, skip-when-absent rule, nothing-ruled-out one-liner rule,
  WARNING report-category entry); unit cases asserting the predicate rejects
  the pre-change body shape (no Non-goals check) on every dimension and
  accepts a well-formed body; and render loops over the verify skill and
  command templates for every registered agent asserting the predicate
  holds, with the checked agent set non-empty and equal to the registry
  length
- [x] 2.2 Run `pnpm vitest run test/core/shared/plan-nongoals.test.ts
  test/core/shared/lifecycle-honesty.test.ts` plus the phase proof-of-work
  grep this change owns
  (`grep -qi 'non-goal' src/core/templates/workflows/verify-change.ts`); per
  the testing standard also run the full suite (`pnpm test`) and the coverage
  gate (`pnpm test:coverage`); all must be green
- [x] 3.1 Documentation (per the `documentation` standard): update
  `docs/commands/verify.md` — the **Verify report honesty** list gains an
  entry stating that when plan.md carries a `## Non-goals` section the
  report flags as a WARNING each listed Non-goal the implementation
  implements (naming the entry, with the remove-or-re-decide recommendation),
  and that a plan without the section or with the explicit
  nothing-ruled-out one-liner skips the check — and the Overview diagram's
  COHERENCE node label gains the Non-goals check so the diagram stays
  accurate. No README change: its verify mentions stay at the
  command-surface level and remain accurate. No new Mermaid diagram: the
  change adds one check to an existing flow already diagrammed, and the
  standard reserves new diagrams for new flows or components
