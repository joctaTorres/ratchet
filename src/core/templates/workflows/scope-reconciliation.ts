/**
 * Scope-reconciliation fragments shared by every change-authoring workflow.
 *
 * `propose`, `propose-batch`, and `decompose-phase` must all carry the same
 * originating-issue reconciliation procedure, the same close-claim rule, and the
 * same stop-and-surface guardrail. This module is the SINGLE AUTHOR of those
 * rules: each workflow body interpolates the constants below rather than
 * restating them, so the three workflows cannot drift apart.
 *
 * That is the point rather than a convenience. The failure this module exists to
 * prevent is a scope reduction that survived because the rule governing it lived
 * in one workflow's prose and not the next one's: a security-relevant half of an
 * issue was dropped in a plan bullet, the issue was claimed closed anyway, and
 * the phase that promised to "revisit" it never saw the deferral. Three
 * hand-written copies of a rule are exactly that drift mechanism, so there is
 * one copy and every body embeds it. It also makes "the rule is present in all
 * three workflows, verbatim" a mechanical assertion (`toContain(CONSTANT)`)
 * instead of a prose review.
 *
 * These fragments operationalize the `security-remediation` standard, which
 * already states the policy (no partial remediation of severe exposures,
 * severity governs over hedged source wording, honest close-claims, no silent
 * scope drops) but had no enforcement point in the authoring workflows.
 *
 * Authoring constraints these constants must keep:
 *
 * - **Agent-neutral** (`multi-agent-support`): the prose says "your agent", and
 *   any agent-specific capability (Claude Code's `AskUserQuestion`) is phrased as
 *   optional with a plain-prose fallback that works in any agent.
 * - **Tracker-neutral** (`generalizable-defaults`): these skills ship into
 *   arbitrary repositories, so no tracker is required and no command string is
 *   baked in. `gh issue view <n>` appears only as a named GitHub example, with a
 *   paste-the-issue-text fallback when no tracker client is available.
 * - **No config reads** (`instruction-fed-config`): the procedure consumes only
 *   the issue references the user, the manifest, or the injected `done` already
 *   provides. It reads no config file and branches on no config key.
 * - **Interpolated verbatim, never re-indented.** {@link ISSUE_RECONCILIATION_STEP}
 *   is indented three spaces so it drops in as the body of a numbered step (the
 *   indentation every workflow body already uses); the two guardrail constants
 *   are column-zero bullet lists so they drop into a **Guardrails** bullet list.
 *   Re-indenting either at a call site breaks the verbatim-containment tests.
 */

/**
 * The originating-issue reconciliation procedure, embedded by `propose` and
 * `propose-batch` as the body of a numbered step that runs BEFORE any artifact
 * is authored.
 *
 * Indented three spaces: it is the continuation body of a numbered list item,
 * matching the step formatting all workflow bodies already use.
 */
export const ISSUE_RECONCILIATION_STEP = `   Work that originates from a tracked issue is reconciled against that issue
   BEFORE any artifact is written. Nothing below is optional, and no step of it
   may be replaced by your own reading of what the issue "really" wants.

   a. **Identify every originating issue.** An issue is originating when the user
      references it, when a batch manifest phase or change intent references it,
      or when an injected \`done\` criterion references it. Collect every such
      reference — there is often more than one.

   b. **Fetch each originating issue through the project's issue tracker.** Read
      the real issue text. Never work from a paraphrase, and never from an
      injected \`done\` criterion alone — that criterion is itself a paraphrase, and
      whatever it left out is invisible in it. On GitHub, for example,
      \`gh issue view <n>\` prints an issue; other trackers have their own client.
      If your agent has no tracker client for this project, ask the user to paste
      the issue text and wait for it. Do not proceed on a summary.

   c. **Enumerate the issue's material requirements.** Read the whole issue, not
      only its checklist. A material requirement comes from either of two places:
      - its **explicit fix items** — the numbered or bulleted things it asks for;
        and
      - the **problems named in its narrative** — its Why, background, or body
        prose — that the fix items never restate. A problem described only in
        prose is still a requirement.

      **Hedged source wording does not lower the bar.** "Consider", "maybe",
      "optionally", "could", and "nice to have" describe the issue author's
      confidence, not the requirement's weight. For anything security-,
      permission-, or integrity-relevant, severity governs and a hedged item is
      enumerated as material exactly like an imperative one.

   d. **Map every enumerated requirement to authored scope.** Build an explicit
      requirement-to-artifact map: each requirement names the feature scenario or
      the plan task that covers it. A requirement with nothing pointing at it is
      uncovered.

   e. **List every requirement the authored scope does not cover.** Write the
      uncovered set out explicitly. An empty list is a valid outcome, but it is
      stated rather than assumed.

   f. **Surface every uncovered requirement to the user as a decision point.**
      Before the artifacts are finalized, present the uncovered set as an
      enumerated list in the form "issue asks X, this proposal does not include
      X", and ask what to do about each one — use a structured-question tool such
      as AskUserQuestion if your agent has one, otherwise ask in plain prose and
      wait for an answer.

      You MUST NOT self-approve an omission by writing it into plan prose. An
      "Out of scope", "deferred", or "revisit later" bullet in a plan records a
      decision the user already made; it is never a substitute for asking them.`;

/**
 * The close-claim rule, embedded by all three change-authoring workflows in
 * their **Guardrails** section.
 *
 * A column-zero bullet list: it appends to an existing `- `-item Guardrails list.
 */
export const CLOSE_CLAIM_RULES = `- **A close-claim is earned, never assumed.** A \`Fixes #N\` / \`Closes #N\` claim —
  in a batch manifest \`done\`, in a plan, or in a pull-request body — is permitted
  only when the issue's material requirements are actually implemented. A
  close-claim is an output of verification, never an input of planning: it is
  written once the requirements are confirmed implemented, never before the work
  is scoped.
- **Partial work says it is partial.** Work covering only part of an issue MUST
  say "partially addresses #N", and MUST NOT say "Fixes #N" or "Closes #N".
  Naming what remains uncovered is part of that claim.`;

/**
 * The stop-and-surface guardrail for security-relevant de-scopes, embedded by
 * all three change-authoring workflows in their **Guardrails** section.
 *
 * A column-zero bullet list: it appends to an existing `- `-item Guardrails list.
 */
export const STOP_AND_SURFACE_GUARDRAIL = `- **A security-relevant de-scope is a stop-and-surface event.** Any de-scope of
  security-, permission-, or integrity-relevant work halts this workflow and asks
  the user. It is never taken on momentum, never taken because the narrower scope
  is easier to ship, and never settled inside the run without a human answering.
  Halt, present the de-scope, and wait for the user.
- **An approved deferral requires a filed, linked, owned tracking issue.** When
  the user approves deferring such a requirement, a tracking issue for the
  deferred scope MUST be explicitly filed with a named owner, and MUST be linked
  from the change plan, before you proceed. A prose bullet in \`plan.md\` is not a
  deferral mechanism — an unlinked, unowned "revisit later" note is exactly how
  deferred security scope disappears at the next phase boundary.`;
