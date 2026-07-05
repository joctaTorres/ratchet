/**
 * PR-open guided workflow skill + command templates.
 *
 * `/rct:pr-open` is the instruction a spawned PR agent follows to open ONE pull
 * request for the work on its branch. It is authored ONCE here as a shared body
 * constant that both the skill and command templates return — the exact "one
 * shared body" pattern `decompose-phase.ts` uses for an engine-spawned command.
 * The body instructs the agent to read `git log` for the repo's commit-message
 * style (defaulting to semantic / Conventional Commits), commit the accumulated
 * uncommitted work of the prior stage agents in that style, push the work branch
 * to its remote, and open EXACTLY ONE pull request from the work branch to the
 * base branch the surrounding instructions supply, using whichever forge CLI the
 * environment provides.
 *
 * The base branch is a GENERAL supplied value carried in the surrounding
 * instructions as data — the repository's default branch for a whole-batch PR, or
 * an arbitrary stacked sibling branch (the previous group's branch) for a
 * per-phase / per-change stacked PR. The body targets exactly that supplied base
 * and never invents, infers, or re-derives it (from the repo default, the work
 * branch's upstream, or config), so a later change can inject a stacked base with
 * no edit to this shared command (`instruction-fed-config` / `generalizable-defaults`).
 *
 * This is the instruction-authoring slice: the engine will later (in
 * `pr-spawn-at-completion`) orchestrate the PR step — select it, spawn one agent,
 * journal the outcome — but must never re-author these steps inline. It delegates
 * to `/rct:pr-open` (the shared command guaranteed into the spawn locus by the
 * render-or-fail skill-locus path), never a parallel engine-local prompt.
 *
 * The body is forge-agnostic and toolchain-agnostic: it names no single forge CLI
 * as required (gh / glab / others appear only as non-exhaustive examples) and
 * carries none of ratchet's own toolchain. It is agent-neutral: it refers to the
 * coding agent generically and assumes no capability unique to a single agent.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const PR_OPEN_BODY = `Open the single pull request for the work on this branch. The prior stage agents
have left their work uncommitted on the current work branch; your job is to commit
that work in the repository's own commit style, push the branch, and open EXACTLY
ONE pull request from the work branch to the base branch the surrounding
instructions supply — using whichever forge CLI the environment already provides.

You are the coding agent spawned for the PR step. Everything below is plain prose
that works in any agent — assume no capability unique to a single agent.

---

**Input**: The surrounding instructions supply the work branch and the base branch
this PR targets. Open the PR against exactly that supplied base — do NOT invent,
infer, or re-derive it. Do not fall back to the repository's default branch, the
work branch's upstream, or any configuration file to choose a base: the base is
only ever the value the surrounding instructions give you.

**Steps**

1. **Derive the repository's commit-message style from \`git log\`**

   Read the recent history with \`git log\` (e.g. \`git log --oneline -n 30\`) and
   infer the convention the repository actually uses: subject-line format, prefix
   scheme, capitalization, and whether it follows semantic / Conventional Commits
   (\`type(scope): summary\`). Match that style for the commit you author.

   If the history is inconclusive or mixed, DEFAULT to semantic / Conventional
   Commits — a neutral, ecosystem-agnostic convention — rather than guessing.

2. **Commit the accumulated uncommitted work**

   Stage and commit the accumulated uncommitted work of the prior stage agents on
   the work branch, in the commit-message style you derived in step 1. Write a
   clear message describing the batch's change as a whole.

3. **Push the work branch to its remote**

   Push the work branch to its remote (setting the upstream if it is not yet
   tracked) so the forge can open a pull request from it.

4. **Open exactly one pull request to the supplied base branch**

   Detect whichever forge CLI the environment provides (for example \`gh\` for
   GitHub or \`glab\` for GitLab — these are examples, not the required tool) and
   use it to open EXACTLY ONE pull request from the work branch to the base branch
   the surrounding instructions supplied. Do NOT invent, infer, or re-derive the
   base branch — not from the repository's default branch, the work branch's
   upstream, or config; target the supplied base verbatim. Give the PR a title and
   body consistent with the commit style and the change. Open one PR only — never
   more than one.

**If no forge CLI is available**

   If the environment provides no usable forge CLI, STOP and report the failure —
   name what you looked for and why the PR could not be opened. Do NOT silently
   fall back to any ratchet-specific command or fabricate a substitute; the engine
   surfaces this as a reported step failure.

**Output**

After opening the PR, summarize:
- The commit-message style you derived (and whether you defaulted to semantic /
  Conventional Commits).
- The commit you authored on the work branch.
- The work branch you pushed and its remote.
- The single pull request you opened, from the work branch to the supplied base
  branch, and the forge CLI you used.

**Guardrails**
- Open EXACTLY ONE pull request — never more than one.
- Open the PR against the base branch the surrounding instructions supply; never
  invent, infer, or re-derive it (not from the repo default branch, the work
  branch's upstream, or config).
- Match the repository's own \`git log\` commit style; default to semantic /
  Conventional Commits only when the history is inconclusive.
- Use whichever forge CLI the environment provides; hard-code no single forge CLI
  and no ratchet-specific toolchain command as the required tool.
- If no forge CLI is available, stop and report — never silently substitute a
  ratchet command.`;

export function getPrOpenSkillTemplate(): SkillTemplate {
  return {
    name: 'ratchet-pr-open',
    description:
      "Open the single whole-batch pull request at batch completion: read `git log` for the repo's commit style (semantic default), commit the prior stage agents' accumulated work, push the work branch, and open exactly one PR to its base branch via whichever forge CLI the environment provides.",
    instructions: PR_OPEN_BODY,
    license: 'MIT',
    compatibility: 'Requires the ratchet CLI; pairs with the batch workflow.',
    metadata: { author: 'ratchet', version: '1.0' },
  };
}

export function getRctPrOpenCommandTemplate(): CommandTemplate {
  return {
    name: 'RCT: Open PR',
    description:
      "Open the single whole-batch pull request at batch completion — commit the accumulated work in the repo's git-log style and open exactly one forge-agnostic PR (Experimental)",
    category: 'Workflow',
    tags: ['workflow', 'batch', 'experimental'],
    content: PR_OPEN_BODY,
  };
}
