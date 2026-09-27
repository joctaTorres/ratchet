# pr113-review-reconciliation-2

## Why

The owner's review of PR #113 found two places where `scope-reconciliation.ts` is not yet
the single author of its rules. First, `ISSUE_RECONCILIATION_STEP` combines pre-authoring
work (identify, fetch, enumerate) with post-authoring work (map, list uncovered, surface). Its
own text says it runs "BEFORE any artifact is written", so both callers have to work around
it. Second, `decompose-phase` step 1d restates the fetch-and-enumerate procedure by hand and
leaves out the hedged-wording clause. That reopens the #80 failure mode at the phase boundary.
The review also found that decompose-phase's "tracked" outcome sets a lower bar than the
stop-and-surface guardrail interpolated into the same body. This change is a narrow follow-up
on top of `issue-scope-reconciliation`, which describes the original behavior.

## What Changes

- **`src/core/templates/workflows/scope-reconciliation.ts`**: replace `ISSUE_RECONCILIATION_STEP`
  with three constants:
  - `ISSUE_REQUIREMENT_ENUMERATION`: fetch each issue through the project's tracker (with the
    `gh issue view <n>` example and the paste-the-text fallback), then enumerate material
    requirements from both the explicit fix items and the narrative. This includes the
    hedged-wording clause. It is the only copy of that procedure.
  - `ISSUE_RECONCILIATION_PRE_AUTHORING`: identify every originating issue, then
    `ISSUE_REQUIREMENT_ENUMERATION`, built by composition inside the module. It contains no
    mapping or surfacing language.
  - `ISSUE_RECONCILIATION_POST_AUTHORING`: map each enumerated requirement to authored scope,
    list what is uncovered, surface each gap as an "issue asks X, this proposal does not
    include X" decision point, and prohibit self-approved omissions in plan prose. The wording
    is target-neutral ("the authored scope").
  - `STOP_AND_SURFACE_GUARDRAIL` / `CLOSE_CLAIM_RULES` keep their text unchanged.
  Implements `features/scope-reconciliation/reconciliation-timing.feature` and
  `earned-close-enumeration.feature`.
- **`propose.ts`**: step 2 interpolates the pre-authoring half. A new numbered step after the
  artifact loop interpolates the post-authoring half and replaces the hand-written "Complete the
  reconciliation map from step 2" bullet in step 5a. The docstring nit is fixed by removing the
  "used to be duplicated verbatim" history and keeping the invariant. Implements
  `reconciliation-timing.feature` and `generated-parity.feature` (skill/command two-delta
  identity).
- **`propose-batch.ts`**: the pre-authoring half moves ahead of phase slicing. Step 4 becomes
  the post-authoring reconciliation: one caller-specific preface line names the targets
  (phase `goal`, phase `success`, change-level `done`), then the shared post-authoring
  constant. The hand-written "Map each enumerated requirement onto…" paragraph is removed. The
  no-premature-close text stays as it is. Implements `reconciliation-timing.feature`.
- **`decompose-phase.ts`**: the earned-close check becomes its own numbered step and
  interpolates `ISSUE_REQUIREMENT_ENUMERATION` instead of the hand-written restatement. Outcome
  (b) "tracked" defers to `STOP_AND_SURFACE_GUARDRAIL` for security-, permission-, or
  integrity-relevant items (filed, open, named owner, linked from the plan). Implements
  `earned-close-enumeration.feature` and `tracked-deferral-bar.feature`.
- **Tests**: update the existing template and init tests for the split constants, and add the
  regression assertions the review named. Implements `generated-parity.feature`.
- **Docs**: `docs/configuration/generated-artifacts.md` and `README.md` describe the two-phase
  timing and the security bar for "tracked".
- No **BREAKING** changes. The renamed constants are internal. There are no CLI, config, or
  schema changes, and regeneration through `ratchet init` / `ratchet update` picks up the new
  prose.

## Design

**Split by time, not by workflow (`delegated-lifecycle`).** The review's CoN-Meaning finding is
that one constant described work belonging to two different moments. The split follows those
moments: enumeration can only happen before authoring, and mapping can only happen after it. Each
workflow interpolates each half at the point where it applies, so no caller has to patch around
the constant. The module stays the single author of lifecycle instruction text, and the old
`ISSUE_RECONCILIATION_STEP` is **removed** rather than kept as a composed alias. An alias would
put back a constant that claims one moment and describes two.

**`ISSUE_REQUIREMENT_ENUMERATION` is a separate constant because decompose-phase needs exactly
that piece.** Decompose-phase does not identify originating issues and does not map to authored
scope. It fetches a known issue and enumerates its requirements to test a prior close-claim.
Giving it the shared piece removes the fourth hand-written copy (CoN-Algorithm) and brings the
hedged-wording clause with it. The pre-authoring constant is built from it by composition, so
there is still one textual copy.

**Indentation: hoist rather than re-indent.** The module header forbids re-indenting a constant
at a call site, because that would break the verbatim `toContain` tests. The earned-close check
is currently a 6-space-indented lettered sub-item (1d), and a 3-space constant cannot be nested
there. The earned-close check therefore becomes its own numbered step in decompose-phase, placed
right after grounding and before slicing, with a 3-space body. Later steps are renumbered. All
three new constants use the same 3-space step-body indent. Each constant starts its own
sub-lettering at `a.` or uses unlettered bold lead-ins, so lettering stays correct wherever it is
interpolated. Apply picks one convention and uses it for all three constants.

**Post-authoring vocabulary: neutral constant plus a one-line caller preface.** The mapping target
differs by workflow (feature scenario or plan task in propose; phase `goal`, `success`, or
change-level `done` in propose-batch). The constant says "the authored scope", and each caller
states its target in one preface line. A builder function parameterized by target nouns was
considered and rejected: it would turn a verbatim-containable constant into a template, and the
tests could no longer assert containment of a single string.

**Propose-batch timing.** The manifest is drafted across steps 2 and 3 (slicing and success
criteria), so the enumeration must come before step 2. The pre-authoring half goes at the end of
step 1 (explore), or in a new step between 1 and 2, whichever reads cleaner. The post-authoring
half stays at step 4, which is still before `ratchet new batch`. The existing propose-batch test
constraints stay intact: no literal `/rct:propose ` with a trailing space, and no "per-change
success".

**Tracked has one definition (`security-remediation`).** Outcome (b) currently says "matched to
an existing OPEN tracking issue". For a security-, permission-, or integrity-relevant item it
must instead point at the guardrail's bar: the issue is filed, open, has a named owner, and is
linked from the plan. An open but unowned issue does not qualify, and the item goes back to the
user. Non-security items keep the lighter bar. The text refers to the guardrail and does not
restate it, so there is no fifth copy.

**Unchanged constraints.** The text stays agent-neutral (`multi-agent-support`; `AskUserQuestion`
is optional and has a prose fallback) and tracker-neutral (`generalizable-defaults`). It adds no
config reads (`instruction-fed-config`). `.claude/` and `.opencode/` are generated, so the only
edits are to the template modules, and parity is proven through `InitCommand`.

**Scope of this change.** Every finding from the PR #113 review maps to a task below: the split
(1.x–3.x), decompose reuse and the hedged-wording test gap (4.1, 5.3), the tracked-bar alignment
(4.2), and the docstring nit (2.3). No review finding is left unaddressed.

## Tasks

- [x] 1.1 In `scope-reconciliation.ts`, add `ISSUE_REQUIREMENT_ENUMERATION`: the fetch sub-step
      and the enumerate sub-step from today's (b)–(c), moved verbatim, including the
      hedged-wording paragraph and the `gh issue view <n>` example with its paste fallback.
- [x] 1.2 Add `ISSUE_RECONCILIATION_PRE_AUTHORING`: the "identify every originating issue" text,
      then `${ISSUE_REQUIREMENT_ENUMERATION}` by composition. The lead sentence says it runs
      before any artifact is written. It contains no mapping, "uncovered", or "decision point"
      language.
- [x] 1.3 Add `ISSUE_RECONCILIATION_POST_AUTHORING`: today's (d)–(f), reworded to be
      target-neutral ("the authored scope"). Keep the "issue asks X, this proposal does not
      include X" form and the prohibition on self-approving an omission in plan prose. Its lead
      sentence says it runs after the artifacts are authored and before they are called done.
- [x] 1.4 Remove `ISSUE_RECONCILIATION_STEP` and update the module docstring. It should describe
      the three constants, the time-based split, and the rule that each constant is interpolated
      verbatim at 3-space step-body indent. Use one sub-lettering convention across all three.
- [x] 2.1 In `propose.ts`, step 2 interpolates `ISSUE_RECONCILIATION_PRE_AUTHORING`. Rename the
      step heading if needed so it describes enumeration rather than reconciling authored scope.
- [x] 2.2 Remove the hand-written "Complete the reconciliation map from step 2" bullet from step
      5a. Add a numbered step after the artifact loop and before "Show final status": one
      preface line naming the targets (feature scenario or plan task), then
      `${ISSUE_RECONCILIATION_POST_AUTHORING}`. Renumber the later steps.
- [x] 2.3 Remove the history sentence from the `propose.ts` module docstring ("The body used to
      be duplicated verbatim…"). Keep the invariant: one body, two deltas, so the surfaces cannot
      diverge.
- [x] 3.1 In `propose-batch.ts`, interpolate `ISSUE_RECONCILIATION_PRE_AUTHORING` before phase
      slicing (step 2). Step 4 then contains one preface line naming phase `goal`, phase
      `success`, and change-level `done`, followed by `${ISSUE_RECONCILIATION_POST_AUTHORING}`.
      Remove the hand-written "Map each enumerated requirement onto…" paragraph and keep the
      no-premature-close paragraph.
- [x] 3.2 Confirm the propose-batch body still contains no literal `/rct:propose ` (trailing
      space) and no "per-change success".
- [x] 4.1 In `decompose-phase.ts`, turn sub-step 1d into its own numbered step ("Verify each
      prior close-claim was earned") placed after grounding. Its body interpolates
      `${ISSUE_REQUIREMENT_ENUMERATION}` in place of the hand-written fetch/enumerate sentence,
      then keeps the compare / unearned / carry-forward text. Renumber the later steps and
      update any internal step cross-references.
- [x] 4.2 Change outcome (b) "tracked" so that a security-, permission-, or integrity-relevant
      item counts as tracked only when its tracking issue meets the bar in the stop-and-surface
      guardrail below (filed, open, named owner, linked from the plan). An item that falls
      short is surfaced to the user. Refer to the guardrail; do not restate it.
- [x] 5.1 Update `test/core/templates/workflows/scope-reconciliation.test.ts`. Assert the content
      of each new constant. Assert the pre-authoring constant contains the enumeration constant
      and contains no mapping or surfacing language. Assert the post-authoring constant contains
      the decision-point form and the self-approval prohibition.
- [x] 5.2 Update `propose.test.ts` and `propose-batch.test.ts`. Assert containment of both
      halves, and use `indexOf` ordering to check that the pre half precedes change or manifest
      creation and the post half follows the artifact loop (propose) or the drafted phases while
      preceding `ratchet new batch` (propose-batch). Assert that no hand-written mapping
      paragraph remains. Keep the two-delta skill/command identity test and the adapter-render
      assertions over `CommandAdapterRegistry.getAll()`.
- [x] 5.3 Update `decompose-phase.test.ts`. Assert the body contains
      `ISSUE_REQUIREMENT_ENUMERATION` verbatim, which closes the hedged-wording gap the review
      named. Assert it contains the hedged-wording clause. Assert outcome (b) refers to the
      guardrail's owner and plan-link bar for security-relevant items.
- [x] 5.4 Update `test/core/init-scope-reconciliation.test.ts`. Assert both halves are in the
      claude and opencode `ratchet-propose` and `ratchet-propose-batch` skills, and the
      enumeration constant is in both `ratchet-decompose-phase` skills. Keep the claude/opencode
      parity check.
- [x] 6.1 Documentation (required by the `documentation` standard). Update the
      "Originating-issue reconciliation" section of `docs/configuration/generated-artifacts.md`
      to describe the two-phase timing: identify/fetch/enumerate before authoring,
      map/list/surface after authoring. Name where each half sits in each workflow, and state
      that decompose-phase's earned-close check uses the same enumeration, including the
      hedged-wording rule. Update the decompose-phase "tracked" bullet with the security bar.
- [x] 6.2 Update the matching `README.md` bullets (the "Deferrals survive phase boundaries" /
      tracked wording, and any reconciliation timing wording) so they agree with the new prose.
- [x] 7.1 Run the full test suite and the coverage gate (`testing` standard). All tests must
      pass, and the enforced threshold must not be lowered.
- [x] 7.2 Run `ratchet validate pr113-review-reconciliation-2` and confirm the change validates.
- [x] 7.3 Reconcile against the PR #113 review before finishing. Walk each finding (the split,
      decompose reuse with hedged wording, the tracked-bar alignment, the hedged-wording test
      gap, and the docstring nit) and confirm each maps to a completed task. Any finding that
      cannot be completed is surfaced, not silently dropped.
