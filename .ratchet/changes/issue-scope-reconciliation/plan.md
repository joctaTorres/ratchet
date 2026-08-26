# issue-scope-reconciliation

## Why

The change-authoring workflows (`propose`, `propose-batch`, `decompose-phase`) have no step
that reconciles authored scope against the originating GitHub issue, no rule governing
`Closes #N` claims, and no mechanism that carries a deferral across a phase boundary — so
issue #80 lost its security-relevant half to a self-approved plan-prose de-scope, was claimed
`Closes`d anyway, and the next phase never saw the deferral. This change hardens all three
workflows so that failure chain is structurally impossible, and closes out the #80 remainder
that the chain left untracked.

## What Changes

- **New shared fragment module** `src/core/templates/workflows/scope-reconciliation.ts`
  exporting three constants that all three workflow bodies embed, so the rules are authored
  once and cannot drift between workflows:
  - `ISSUE_RECONCILIATION_STEP` — fetch every originating issue, enumerate its material
    requirements, map each to an authored feature/task, surface every gap as an explicit
    decision point.
  - `CLOSE_CLAIM_RULES` — a `Fixes #N` / `Closes #N` claim is permitted only when the issue's
    material requirements are actually implemented; partial work says "partially addresses #N".
  - `STOP_AND_SURFACE_GUARDRAIL` — a de-scope of security-, permission-, or integrity-relevant
    work halts the workflow and asks the user; an approved deferral requires a filed, linked
    tracking issue with a named owner.
- **`src/core/templates/workflows/propose.ts`**: its two verbatim-duplicated bodies (skill
  `instructions` and command `content`) collapse into one shared body builder, and that body
  gains the originating-issue reconciliation step plus the close-claim and stop-and-surface
  guardrails. Implements `features/scope-reconciliation/issue-reconciliation.feature`,
  `close-claim-honesty.feature`, `stop-and-surface-guardrail.feature`.
- **`src/core/templates/workflows/propose-batch.ts`**: gains the reconciliation step, a
  prohibition on hard-coding `Closes #N` in a phase `goal`/`success` or a change-level `done`,
  the required "targets #N" / "addresses #N" / "partially addresses #N" phrasing, and the
  shared guardrails. Implements `issue-reconciliation.feature`, `close-claim-honesty.feature`,
  `stop-and-surface-guardrail.feature`.
- **`src/core/templates/workflows/decompose-phase.ts`**: gains a prior-phase plan sweep
  (read each prior phase's `plan.md`, extract every out-of-scope / deferred / revisit item,
  and resolve each as carried-forward | tracked | explicitly-dropped), an earned-close
  verification before treating an issue as shipped, and the shared guardrails. Implements
  `deferral-carry-forward.feature`, `close-claim-honesty.feature`,
  `stop-and-surface-guardrail.feature`.
- **Tests**: new `test/core/templates/workflows/{scope-reconciliation,propose,decompose-phase}.test.ts`,
  extensions to `test/core/templates/workflows/propose-batch.test.ts`, and an `init`-level
  assertion that the hardened text lands in **both** `.claude/skills/…/SKILL.md` and
  `.opencode/skills/…/SKILL.md`.
- **Worked-example check**: a new eval fixture (`.ratchet/evals/fixtures/issue-scope-reconciliation/`)
  holding issue #80's text, the phase-one manifest excerpt, and the phase-one plan excerpt, plus an
  `llm-judge` eval spec binding `features/scope-reconciliation/worked-example-check.feature`.
  Implements `worked-example-check.feature`.
- **Docs**: `docs/configuration/generated-artifacts.md` and `README.md` describe the new
  reconciliation step, the close-claim rules, and the deferral carry-forward trichotomy.
- **Issue-#80 remainder remediation** (not a code behavior): a tracking issue with a named owner
  for the ungated override seam, the voided permission posture under override, and `batch
  config`'s override-unaware enforcement display; and PR #97's body corrected from `Closes #80`
  to a partial-address claim linking that tracking issue.
- No **BREAKING** changes: no CLI surface, flag, config key, or manifest schema changes. The
  generated skill/command prose grows; regenerating via `ratchet init` / `ratchet update` picks
  it up.

## Design

**Templates are the single source of truth; both trees come for free.** `.claude/` and
`.opencode/` are gitignored in this repo — they are *generated* into a consuming project by
`ratchet init`/`update` from `getSkillTemplates()` / `getCommandTemplates()` in
`src/core/shared/skill-generation.ts`, which read the workflow template modules. Editing the
three modules under `src/core/templates/workflows/` is therefore the only edit that satisfies
the issue's "both trees **and** the generator" requirement; hand-editing a generated tree would
be reverted on the next regeneration and is explicitly not what this change does. This is also
what `delegated-lifecycle` requires: exactly one author of lifecycle instruction text.

**Why a shared fragment module rather than three hand-written copies.** The cross-cutting
requirement is that the stop-and-surface guardrail and the close-claim rule appear in all three
workflows *verbatim*. Three prose copies are exactly the drift mechanism this issue is about, so
the rules live in one module and each body interpolates the constant. That also makes the
"verbatim in all three" requirement a mechanical assertion — `expect(body).toContain(CONSTANT)`
— instead of a prose review. `multi-agent-support` requires shared content be defined once and
rendered per agent through the adapter registry; the fragment module sits inside that shared
layer, so every agent's rendering carries the identical rules.

**Why `propose.ts` is deduplicated first.** Today `propose.ts` carries the same body twice —
once as the skill's `instructions`, once as the command's `content` — differing in exactly two
lines. Adding the reconciliation rules to only one of them would reproduce, inside this very
change, the divergence the issue is about. The body becomes a single builder parameterized by
the two known deltas:
1. the **Input** line — skill: "The user's request should include a change name (kebab-case) OR
   a description of what they want to build."; command: "The argument after `/rct:propose` is
   the change name (kebab-case), OR a description of what the user wants to build."
2. the closing **Prompt** line — skill: "Run `/rct:apply` or ask me to implement to start
   working on the tasks."; command: "Run `/rct:apply` to start implementing."
Everything else must stay byte-identical to today's text apart from the new sections. This
mirrors the shape `propose-batch.ts` and `decompose-phase.ts` already use (one body constant
shared by skill and command).

**Ecosystem-agnostic issue fetching (`generalizable-defaults`).** These skills ship into
arbitrary user repositories, so the reconciliation step must not hard-require GitHub or the
`gh` binary. The prose instructs the author to fetch each originating issue *through the
project's issue tracker*, names `gh issue view <n>` only as a GitHub example, and requires
asking the user to paste the issue text when no tracker client is available. No default command
string is baked in.

**No config reads in skill prose (`instruction-fed-config`).** The reconciliation step consumes
the issue reference the user / manifest / injected `done` already provides plus the standards
array the `ratchet instructions` payload already delivers. It adds no config-file read and no
"if config says X" branching to any template body, and it introduces no new schema.

**`security-remediation` is the policy this change operationalizes.** That standard already
states the rules (no partial remediation of severe exposures, severity governs over hedged
source wording, honest close-claims, no silent scope drops, no lying security controls). It had
no enforcement point in the authoring workflows — this change adds it: the reconciliation step
is where "enumerate the exposure's material requirements before writing tasks or close-claims"
actually happens, and the stop-and-surface guardrail is where "a de-scope is a stop-and-surface
event" actually halts a run. The hedged-wording rule is carried explicitly, because issue #80's
own "**Consider** requiring…" is what handed the original propose agent its de-scope
justification.

**Why the worked-example check is an `llm-judge` eval, not a unit test.** The behavior being
demonstrated is an agent applying a procedure to prose — there is no pure function to assert
over, and a `deterministic` binding could only re-grep the skill text, which the vitest suite
already does. The repo's existing precedent for judging agent behavior over a fixture is
`.ratchet/evals/specs/eval-self.yaml` (`kind: llm-judge`, spawned agent, self-contained
fixture); this change follows it. Deterministic coverage of criteria 1–5 stays in vitest, so CI
never depends on a live agent spawn; the eval is the *demonstration* required by acceptance
criterion 6 and must be run once with its verdict recorded as evidence. Known limitation, not
solved here: eval case ids embed the feature file's location (issue #55), so this binding will
need re-keying when the change is archived.

**Trade-off accepted.** The three skill bodies get materially longer. That is the intended cost:
the alternative — a short body plus a reviewer expected to remember the rule — is what failed on
#80. Length is bounded by putting the shared rules in one fragment each body interpolates once.

## Tasks

- [x] 1.1 Create `src/core/templates/workflows/scope-reconciliation.ts` exporting
      `ISSUE_RECONCILIATION_STEP`, `CLOSE_CLAIM_RULES`, and `STOP_AND_SURFACE_GUARDRAIL` as
      string constants, with a module docstring stating they are the single author of these
      rules for all three change-authoring workflows. Keep the prose agent-neutral ("your
      agent", optional `AskUserQuestion` with a plain-prose fallback) per `multi-agent-support`,
      and tracker-neutral (`gh issue view <n>` named only as a GitHub example, with a
      paste-the-issue-text fallback) per `generalizable-defaults`.
- [x] 1.2 `ISSUE_RECONCILIATION_STEP` must require: identifying every originating issue
      (referenced by the user, the manifest, or the injected `done`); fetching each one;
      enumerating its material requirements from **both** its explicit fix items **and** the
      problems named in its narrative/Why; mapping each requirement to an authored feature
      scenario or plan task; and listing every requirement the authored scope does not cover.
      It must state that hedged source wording ("consider", "maybe", "optionally") does not
      lower the bar for a security-relevant requirement, and that every uncovered requirement
      is surfaced to the user as an enumerated "issue asks X, this proposal does not include X"
      decision point before artifacts are finalized — never self-approved in plan prose.
- [x] 1.3 `CLOSE_CLAIM_RULES` must state that a `Fixes #N` / `Closes #N` claim — in a manifest
      `done`, a plan, or a PR body — is permitted only when the issue's material requirements
      are actually implemented; that partial work MUST use "partially addresses #N"; and that a
      close-claim is an output of verification, never an input of planning.
- [x] 1.4 `STOP_AND_SURFACE_GUARDRAIL` must state that any de-scope of security-, permission-,
      or integrity-relevant work is a stop-and-surface event — the workflow halts and asks the
      user, never proceeding on momentum — and that an approved deferral requires an explicitly
      filed tracking issue with a named owner, linked from the plan, before proceeding; a prose
      bullet in `plan.md` is not a deferral mechanism.
- [x] 2.1 Refactor `src/core/templates/workflows/propose.ts` so the skill `instructions` and the
      command `content` derive from ONE shared body builder parameterized by exactly the two
      known deltas (the **Input** line and the closing **Prompt** line, both quoted verbatim in
      this plan's Design section). Assert by inspection that no other text changed relative to
      the current file apart from the new sections added in 2.2.
- [x] 2.2 Add to the propose body: the `ISSUE_RECONCILIATION_STEP` as an explicit numbered step
      that runs BEFORE artifacts are authored, and `CLOSE_CLAIM_RULES` +
      `STOP_AND_SURFACE_GUARDRAIL` embedded in its **Guardrails** section.
- [x] 3.1 Add to `src/core/templates/workflows/propose-batch.ts`: the
      `ISSUE_RECONCILIATION_STEP` as an explicit step that runs before the manifest is
      scaffolded, reconciling each phase `goal`/`success` and each change-level `done` against
      the originating issues' material requirements.
- [x] 3.2 Add to `propose-batch.ts` the no-premature-close rule: the manifest MUST NOT hard-code
      `Closes #N` / `Fixes #N` in a phase `goal`, a phase `success`, or a change-level `done`
      for work not yet scoped and verified; phase contracts use "targets #N" / "addresses #N";
      a `done` covering only part of an issue says "partially addresses #N". Embed
      `CLOSE_CLAIM_RULES` + `STOP_AND_SURFACE_GUARDRAIL` in its **Guardrails** section.
- [x] 3.3 Verify the new propose-batch text does not trip the existing assertions in
      `test/core/templates/workflows/propose-batch.test.ts`: it must not introduce the literal
      `/rct:propose ` (with trailing space) and must not introduce the phrase "per-change
      success".
- [x] 4.1 Add to `src/core/templates/workflows/decompose-phase.ts` a grounding sub-step that
      requires reading each prior phase's shipped change `plan.md` files in addition to the
      injected `done` criteria, stating explicitly that the injected criteria are a paraphrase
      in which plan-prose deferrals are invisible.
- [x] 4.2 Require extracting from those plans every `## Out of scope`, "deferred", "revisit", or
      equivalent item, and resolving EACH extracted item as exactly one of: (a) carried forward
      as a change intent in the phase being decomposed, (b) matched to an existing open tracking
      issue and reported as tracked, or (c) surfaced to the user as an explicit drop decision.
      State that silently ignoring an item is not an available outcome.
- [x] 4.3 Require earned-close verification: before treating an issue as shipped, compare the
      issue's material requirements against what the prior phase's `done` and `plan.md` describe
      as implemented; surface an unearned `Fixes/Closes #N` and carry the remaining scope
      forward rather than inheriting the claim as fact. Embed `CLOSE_CLAIM_RULES` +
      `STOP_AND_SURFACE_GUARDRAIL` in its **Guardrails** section.
- [ ] 5.1 Add `test/core/templates/workflows/scope-reconciliation.test.ts`: assert each of the
      three constants contains its required rules, and assert all three workflow bodies
      (`getRctProposeSkillTemplate`, `getProposeBatchSkillTemplate`,
      `getDecomposePhaseSkillTemplate`) `toContain` `STOP_AND_SURFACE_GUARDRAIL` and
      `CLOSE_CLAIM_RULES` **verbatim** (acceptance criterion 5).
- [ ] 5.2 Add `test/core/templates/workflows/propose.test.ts`: assert the skill and command
      bodies are identical except for the two known deltas; assert the reconciliation step and
      the no-self-approved-omission rule are present (criterion 1); assert the body stays
      agent-neutral and tracker-neutral; and render the command through every adapter in
      `CommandAdapterRegistry.getAll()` asserting the reconciliation text survives each
      rendering (mirroring the existing propose-batch adapter test).
- [ ] 5.3 Extend `test/core/templates/workflows/propose-batch.test.ts` with the reconciliation
      step (criterion 1) and the no-premature-`Closes` / "targets #N" / "partially addresses #N"
      rules (criterion 2), including an adapter-render assertion.
- [ ] 5.4 Add `test/core/templates/workflows/decompose-phase.test.ts` covering the prior-plan
      sweep and the carry-forward/tracked/explicit-drop trichotomy (criterion 3), the
      earned-close verification (criterion 4), the shared guardrail (criterion 5), the
      skill/command shared-body identity, and an adapter-render assertion.
- [ ] 5.5 Extend `test/core/init.test.ts` (or add a sibling test using the same fixture pattern)
      asserting that after `init`, the reconciliation step and the stop-and-surface guardrail
      are present in BOTH `.claude/skills/ratchet-propose/SKILL.md` and
      `.opencode/skills/ratchet-propose/SKILL.md`, and likewise for `ratchet-propose-batch` and
      `ratchet-decompose-phase` — the acceptance criteria's "both trees" clause, proven through
      the generator rather than by hand-editing a tree.
- [ ] 6.1 Create the eval fixture `.ratchet/evals/fixtures/issue-scope-reconciliation/` as a
      self-contained ratchet project containing: `issue-80.md` (issue #80's text, including its
      hedged "Consider requiring an explicit opt-in pairing flag…" item and the permission-posture
      problem named in its Why), `manifest-excerpt.yaml` (the phase-one contract that hard-codes
      `Closes #80` plus the `gate-and-mark-agent-cmd-override` change `done` ending "Fixes #80."),
      and `phase-1-plan.md` (the "Out of scope (kept thin per the vertical-slice strategy)…"
      bullet). Fixture content is quoted from issue #100's worked example — do not invent
      variants.
- [ ] 6.2 Add `.ratchet/evals/specs/issue-scope-reconciliation.yaml` binding the
      `worked-example-check` scenario "Replaying the worked example flags all three escapes" to
      that fixture with `kind: llm-judge`. Its `success` prose must require the spawned judge to
      PASS only if the reconciliation procedure flags ALL THREE: (a) the unimplemented gate,
      (b) the unaddressed permission-posture bypass, (c) the premature `Closes #80` — failing
      closed if any is missing. Confirm the bound case id against the ids the eval CLI actually
      derives (format: `<feature-path-sans-ext>#<scenario-slug>`) rather than assuming it.
- [ ] 6.3 Run the eval once for that case (e.g. `ratchet eval run --only <case-id>`) and record
      the resulting run id and verdict in the change's session evidence. A headless agent spawn
      needs its auth env present (for the default Claude agent, `CLAUDE_CODE_OAUTH_TOKEN`); if
      the spawn cannot be authenticated in this environment, say so explicitly in the completion
      report rather than marking this task done.
- [ ] 7.1 Documentation task (REQUIRED by the `documentation` standard — not optional): update
      `docs/configuration/generated-artifacts.md` to describe the originating-issue
      reconciliation step, the close-claim rules, and the deferral carry-forward trichotomy as
      part of the generated propose / propose-batch / decompose-phase artifacts.
- [ ] 7.2 Update `README.md` wherever it describes the propose / propose-batch / decompose-phase
      workflows so the described behavior matches the hardened prose.
- [ ] 8.1 File the tracking issue for issue #80's remainder (acceptance criterion 7): the
      ungated `RATCHET_BATCH_AGENT_CMD` / `RATCHET_EVAL_AGENT_CMD` override seam, the voided
      permission posture under an override (`buildAgentSpawnRequest`'s override branch returns a
      bare `bash -c <override>` request with no adapter and no permission flags), and `batch
      config` (`src/core/batch/config.ts`) reporting the posture as enforced while an override
      voids it. Assign a named owner (`--assignee joctaTorres`) and link it to #80 and #100.
- [ ] 8.2 Correct #80's close-claim in the open PR stack (acceptance criterion 7): edit PR #97's
      body so `Closes #80` becomes "Partially addresses #80 — remainder tracked in #<new issue>",
      leaving `Closes #89` intact.
- [ ] 9.1 Run the full test suite and the coverage gate; all tests pass and the enforced coverage
      threshold is not lowered (`testing` standard).
- [ ] 9.2 Run `ratchet validate issue-scope-reconciliation` and confirm the change validates.
- [ ] 9.3 Reconcile this change against issue #100 itself before declaring it done: walk its
      seven acceptance criteria and confirm each maps to a completed task. Any criterion that
      cannot be completed is a stop-and-surface event — report it, do not silently drop it.
