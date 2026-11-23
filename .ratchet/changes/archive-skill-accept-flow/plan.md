# archive-skill-accept-flow

## Why

The archive skill runs `ratchet archive -y` and says nothing about the
scenario-loss guard: on a refusal the agent has no canonical guidance and
could retry with `--accept-removed-scenarios` on its own initiative — the
exact silent loss the guard exists to prevent. The skill must run the guard,
name the lost scenarios, and put the accept decision in the user's hands.

## What Changes

- Rewrite the archive step of `ARCHIVE_BODY` in
  `src/core/templates/workflows/archive-change.ts` (the single body consumed
  by both the `ratchet-archive-change` skill template and the `archive`
  command template):
  - The first archive attempt runs `ratchet archive "<name>"` **without
    `-y`**, so the CLI's own confirmations and the scenario guard surface to
    the user, and never with `--accept-removed-scenarios`.
  - New scenario-loss refusal handling: recognize the guard refusal (non-zero
    exit listing each lost scenario per store file), name each lost scenario
    and its store file back to the user exactly as listed, and ask whether
    the removal is intentional — capability-plus-fallback phrasing (a
    structured-question capability such as AskUserQuestion if the agent has
    one, otherwise plain prose).
  - The `features/.deleted` tombstone is presented as the intentional
    whole-file-removal route: list the store-relative path there and re-run
    plain `ratchet archive`, no flag needed.
  - The retry `ratchet archive "<name>" --accept-removed-scenarios` happens
    only after explicit user approval, never on the agent's own initiative;
    the "inform and confirm, then pass `-y`" guardrail is rewritten to match.
- Create the phase's shared rendered-output test
  `test/core/shared/scenario-safe-archive-rendered-output.test.ts` pinning
  the flow on every registered agent's rendered archive skill and command
  output, plus unit cases proving the assertions reject the pre-change body
  shape. Later phase changes (`propose-store-seeded-features`,
  `archive-batch-guard-halt`) append their own assertions to this file.
- Documents the archive workflow's scenario-loss accept flow in
  `docs/configuration/generated-artifacts.md`, where generated skill/command
  behavior is Reference-documented (the scope-reconciliation section is the
  precedent). `docs/commands/archive.md` and `README.md` already describe the
  CLI flag and refusal accurately from `scenario-loss-guard` — unchanged.
- Implements `features/archive-change/skill-accept-flow.feature`.

## Design

- **One author of lifecycle text (delegated-lifecycle).** Every edit lands in
  the shared `ARCHIVE_BODY` constant; `getArchiveChangeSkillTemplate` and
  `getRctArchiveCommandTemplate` keep consuming that one constant, so skill
  and command cannot drift. No CLI, engine, or schema changes — the guard
  itself (`scenario-loss-guard`) is untouched.
- **Without `-y` first, ask before the flag.** `-y` pre-answers every CLI
  confirmation, so the first attempt must not carry it: warnings and the
  guard surface to the user instead of being pre-approved. The guard trips
  under `-y` regardless, so dropping `-y` from the first attempt costs no
  safety — the behavior that matters lives in the refusal path: the agent
  surfaces the CLI's lost-scenario list verbatim and asks; only an explicit
  user yes authorizes the retry with the flag. The tombstone route keeps an
  intentional whole-file removal flag-free.
- **Refusal recognition by shape.** The body keys the flow on the guard's
  refusal output ("Refusing to apply features: N store scenario(s) would be
  lost." followed by the per-file `- <name>` list, non-zero exit) — output
  the CLI already prints — so the agent needs no new flags or JSON to drive
  the flow, and the names it relays are the guard's own.
- **Enforcement at the unit layer (testing standard).** The new shared test
  mirrors `agent-neutral-rendered-output.test.ts` and
  `lifecycle-honesty.test.ts`: pure string predicates over a rendered body
  plus a render loop — every archive skill template
  (`getSkillTemplates`/`generateSkillContent`) and command template
  (`getCommandContents`/per-adapter `generateCommand`) for each agent in the
  supported-tools registry (`AI_TOOLS`, `CommandAdapterRegistry`) — asserting
  each flow element is present and the checked agent set is non-empty and
  equal to the registry length; unit cases feed the predicates the pre-change
  body shape (`ratchet archive "<name>" -y`, no refusal handling) and assert
  rejection. The file header names the `.feature` file. No CLI behavior
  changes, so no integration or E2E layer is exercised.
- **Per-agent outputs covered (multi-agent-support).** The archive skill
  renders to `<skillsDir>/skills/ratchet-archive-change/SKILL.md` for every
  registry agent (`.claude`, `.codex`, `.cursor`, `.gemini`, `.github`,
  `.opencode`); the command renders to each adapter's path
  (`.claude/commands/rct/archive.md`, `<CODEX_HOME>/prompts/rct-archive.md`,
  `.cursor/commands/rct-archive.md`, `.gemini/commands/rct-archive.md`,
  `.github/prompts/rct-archive.prompt.md`,
  `.opencode/commands/rct-archive.md`). The render loop iterates the
  registry, so a newly registered agent is covered automatically. The one
  agent-specific capability mention (the ask) uses the capability-plus-
  fallback form; cross-workflow references stay in the canonical
  `/rct:<name>` form; no agent-branching prose is added.
- **Verification.** `pnpm vitest run
  test/core/shared/scenario-safe-archive-rendered-output.test.ts` is green;
  the phase proof-of-work (the two `accept-removed-scenarios` greps plus
  `pnpm vitest run test/core/features-apply-scenario-guard.test.ts
  test/cli-e2e/scenario-safe-archive.test.ts`) stays green; and per the
  testing standard the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`) stay green.

## Tasks

- [x] 1.1 Rewrite step 4 ("Run the archive command") of `ARCHIVE_BODY` in
  `src/core/templates/workflows/archive-change.ts`: the first attempt is
  `ratchet archive "<name>"` without `-y`; keep the what-it-does bullets;
  rewrite the "inform and confirm, then pass `-y`" guardrail so `-y` is no
  longer the default posture (features:
  `archive-change/skill-accept-flow.feature`)
- [x] 1.2 Add the scenario-loss refusal flow to `ARCHIVE_BODY`: recognize the
  guard refusal by its output shape; name each lost scenario and its store
  file as listed; ask whether the removal is intentional (capability-plus-
  fallback: a structured-question capability such as AskUserQuestion if your
  agent has one, otherwise ask in plain prose); present the
  `features/.deleted` tombstone as the whole-file-removal route with a plain
  re-run; retry `ratchet archive "<name>" --accept-removed-scenarios` only on
  explicit user approval, never on the agent's own initiative
- [x] 2.1 Create
  `test/core/shared/scenario-safe-archive-rendered-output.test.ts` (header
  naming `archive-change/skill-accept-flow.feature`): pure predicates over a
  rendered archive body for each flow element (first attempt without `-y` and
  without the flag; names the lost scenarios; asks with capability-plus-
  fallback phrasing; approval-gated `--accept-removed-scenarios` retry;
  `features/.deleted` tombstone route), a render loop over every archive
  skill and command template for every registered agent asserting the
  predicates hold and the checked agent set is non-empty and equal to the
  registry length, and unit cases asserting the predicates reject the
  pre-change body shape
- [x] 2.2 Run `pnpm vitest run
  `test/core/shared/scenario-safe-archive-rendered-output.test.ts` plus the
  phase proof-of-work command (the two greps and `pnpm vitest run
  test/core/features-apply-scenario-guard.test.ts
  test/cli-e2e/scenario-safe-archive.test.ts`); per the testing standard also
  run the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`); all must be green
- [x] 3.1 Documentation (per the `documentation` standard): add a
  Reference-style section on the archive workflow's scenario-loss accept
  flow to `docs/configuration/generated-artifacts.md` (the
  scope-reconciliation section is the precedent), lead it with one valid
  vertical Mermaid `flowchart TD` of the flow (first attempt without `-y` →
  guard refusal → name lost scenarios → ask the user → approval-gated
  `--accept-removed-scenarios` retry or the `features/.deleted` tombstone
  route), every `classDef` setting `color:` with high-contrast fills and
  semantic Unicode node symbols, followed by factual prose matching the new
  body. Confirm `docs/commands/archive.md` and `README.md` still match the
  CLI (the flag and refusal are unchanged since `scenario-loss-guard`), so
  no edits there
