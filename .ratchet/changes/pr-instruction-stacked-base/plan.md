# pr-instruction-stacked-base

## Why

Phase 2 already carries a `baseBranch` into the PR agent's instructions, but that
base is always the repository's default branch (`resolveBranches` → `origin/HEAD`),
so a *supplied* base and an *implicit, git-derived* base are indistinguishable. Stacked
PRs (`per-phase`/`per-change`) require the base to be an arbitrary sibling branch — the
previous group's branch computed by `selectStackedBases` — and the delegated PR-open
path must open against exactly that supplied value. This change makes the supplied base
the sole authority end-to-end so `engine-spawn-at-boundaries` can later inject the
computed stacked base with no further edits to the shared command.

## What Changes

Implements `features/pr-instruction-stacked-base/supplied-base.feature`.

- The `ratchet instructions` payload the engine builds for the PR-open command
  (`buildPrInstructions` → `prInputContext`) carries whatever base branch the
  `PrStepContext` supplies — including an arbitrary stacked sibling branch that is not
  the repository's default — verbatim as data, deriving nothing from git.
- The shared, forge-agnostic PR-open command body (`PR_OPEN_BODY` in
  `src/core/templates/workflows/pr-open.ts`) is tightened so it opens its single PR
  strictly against the base the surrounding instructions supply and explicitly must not
  invent, infer, or re-derive the base (from the repo default, the work branch's
  upstream, or config). No new capability, no forge/agent special-casing.
- The command still renders for every registered agent and is still guaranteed into the
  spawn locus by the render-or-fail skill-locus path — both unchanged by carrying the
  base as data.
- No inline config read is added to the skill; the base arrives only as payload data.
- No new user-facing CLI surface (command/flag) is introduced — the `per-phase`/
  `per-change` and stacked-base user docs land in the dedicated
  `grouping-modes-e2e-and-docs` change.

## Design

**Single-author, instruction-fed base (`instruction-fed-config`, `delegated-lifecycle`).**
The base branch is resolved upstream (CLI/engine) and delivered as `PrStepContext.baseBranch`
data; the engine's `buildPrInstructions` is the single assembly point that folds it into
the payload prose, and the shared `/rct:pr-open` body — the one author of the commit/push/
PR-open steps — merely consumes it. We keep the base a plain supplied field on the context
(already present) and pass it through verbatim: `prInputContext` must not fall back to a
git-derived or default branch, and the body must not re-derive it. This is precisely the
seam that lets `engine-spawn-at-boundaries` substitute `selectStackedBases(...).baseBranch`
without touching the shared command.

**Generalizable over any base (`generalizable-defaults`).** The same body and payload must
work identically whether the base is the repo default (whole-batch) or a sibling branch
(stacked). We therefore remove any whole-batch- or default-branch-only assumption from the
body prose so it reads as "open one PR from the work branch to the supplied base," making
the repo-default case just one value of a general parameter.

**Skill reads no config (`instruction-fed-config`).** The body carries no instruction to
open a ratchet config file and no "if config says X then target Y" branching over the base;
verification treats an inline config read as a defect. The base is data in the payload only.

**Agent-neutral, multi-agent surface (`multi-agent-support`).** The base is carried as data
identical for every agent; only the shared command's *invocation token* differs per agent's
syntax. The agent-facing surface is the rendered `pr-open` command file per registered
agent — `claude` (`.claude`), `codex` (`.codex`), `cursor` (`.cursor`), `gemini`
(`.gemini`), `github-copilot` (`.github`), `opencode` (`.opencode`) — produced from the one
shared body through the adapter registry; no agent-specific copy is hand-authored and no
agent is special-cased in base resolution. Tests iterate the registry rather than hard-coding
one agent.

**Render-or-fail preserved.** Carrying the base as data does not change the skill-locus
guarantee: an absent command is rendered from the shared definition; an unrenderable locus
fails with an actionable error before any agent is spawned.

**Testing (`testing`).** Behavior is proven by targeted unit tests over `buildPrInstructions`
and the shared body: an arbitrary non-default supplied base flows verbatim into the payload;
the same command produces default-base and sibling-base instructions identically; the body
directs opening against the supplied base only and reads no config; the base flows for every
registered agent; and the render-or-fail guarantee is unaffected. No behavior is asserted
only through prose.

## Tasks

- [x] 1.1 Tighten `PR_OPEN_BODY` in `src/core/templates/workflows/pr-open.ts` so its
  "Input" and step 4 state the PR opens against the base the surrounding instructions
  supply, and that the agent must not invent, infer, or re-derive the base (from the repo
  default branch, the work branch's upstream, or config), removing any whole-batch- or
  default-branch-only wording while keeping it forge- and agent-neutral.
- [x] 1.2 Ensure `prInputContext`/`buildPrInstructions` in `src/core/batch/engine/instructions.ts`
  pass `PrStepContext.baseBranch` through verbatim as the sole PR target, with no git read
  or default-branch fallback in the delegated path, and update the developer doc-comments to
  frame the base as a general supplied value (default or stacked sibling).
- [x] 2.1 Add unit tests asserting `buildPrInstructions` carries an arbitrary non-default
  supplied base (a stacked sibling branch) verbatim as the PR target and the supplied work
  branch as the source, and that a default-base context and a sibling-base context yield the
  same shared body with only the base value differing.
- [x] 2.2 Add tests over the shared `PR_OPEN_BODY` asserting it directs opening exactly one
  PR against the supplied base only, instructs against inventing/re-deriving the base, and
  reads no ratchet config to resolve it.
- [x] 2.3 Add a test that iterates the command-generation adapter registry proving the
  supplied base flows into PR instructions for every registered agent (only the invocation
  token differs), and a test that the render-or-fail skill-locus guarantee for the PR-open
  command is unchanged (renders when absent; fails actionably on an unrenderable locus).
