/**
 * Build the agent's instructions from the resolved step context.
 *
 * Instructions are plain text injected into the spawned agent. They direct the
 * agent to perform exactly one transition (propose | apply | verify) toward the
 * active phase goal, reference the phase success criteria and proof-of-work, and
 * report progress/blockers/completion back only through `ratchet batch report`
 * (the agent's single communication channel — no interactive prompt required).
 */

import { CommandAdapterRegistry } from '../../command-generation/index.js';
import { rctCommandIdForTransition, DECOMPOSE_COMMAND_ID, PR_OPEN_COMMAND_ID } from './skill-locus.js';
import { DEFAULT_AGENT } from './agent.js';
import { resolveAgentForStage, parseAgentSpec } from '../agent-setting.js';
import type { ChangeStepContext, DecompositionStepContext, PrStepContext } from './contract.js';
import type { PrGroupBoundary } from './boundary.js';

/**
 * Resolve the `/rct:<transition> <change>` skill-invocation token the spawned
 * agent should run for this step. The command id comes from the SINGLE-SOURCE
 * transition → command-id map (`rctCommandIdForTransition`) the spawn-locus
 * guarantee also uses, so the invocation and the rendered command can never
 * drift. The invocation TOKEN is resolved from the CONFIGURED spawn agent's
 * command adapter — claude `/rct:<id>`, cursor/gemini/codex `/rct-<id>` — never a
 * hard-coded literal, because the syntax genuinely differs per agent
 * (`multi-agent-support` / `delegated-lifecycle`).
 *
 * A synthetic spawn stand-in (a test fake or `RATCHET_BATCH_AGENT_CMD` override)
 * has no command adapter; it falls back to the DEFAULT_AGENT's adapter so the
 * shared path always resolves a token through an adapter, never an inline string.
 *
 * Delegation is context-PRESERVING (`delegated-lifecycle`): the caller's `-m`
 * guidance and any resolved resume answer/feedback are appended to the
 * invocation AS ARGUMENTS (`$ARGUMENTS`) the skill consumes — handed WITH the
 * invocation, never floated off in a detached prose block. Agent-neutrality is
 * preserved by construction: only the trailing arguments are appended; the
 * invocation TOKEN still comes from the configured spawn agent's adapter. When
 * the caller supplied no guidance and the step is not resuming, the invocation
 * stays the bare `/rct:<transition> <change>` with no trailing argument noise
 * (the plain `batch apply` path).
 */
function rctInvocation(context: ChangeStepContext): string {
  const commandId = rctCommandIdForTransition(context.transition);
  // Resolve the invocation token for the SAME per-stage agent the engine spawns
  // for this transition, so a stage routed to a non-default agent is handed that
  // agent's invocation syntax (not the default agent's). Falls back to
  // `DEFAULT_AGENT` for an unmapped stage / unset agent exactly as before. The
  // resolved value is a whole `agent[:model]` spec string; the invocation token
  // keys on the AGENT PART alone, so a spec-form value routes exactly like its
  // bare name — never the default agent's syntax for a spec-form stage.
  const resolved = resolveAgentForStage(context.settings.agent, context.transition);
  const agentId =
    (resolved !== undefined ? parseAgentSpec(resolved).agent : undefined) ?? DEFAULT_AGENT;
  const adapter =
    CommandAdapterRegistry.get(agentId) ?? CommandAdapterRegistry.get(DEFAULT_AGENT)!;
  const base = `${adapter.getInvocation(commandId)} ${context.change}`;
  const args = invocationArguments(context);
  return args ? `${base} ${args}` : base;
}

/**
 * The argument payload appended to the `/rct:<transition> <change>` invocation:
 * the caller's `-m` guidance and the resolved resume answer/feedback, in that
 * order, both present when both exist (neither dropped). Each is the raw text
 * the CLI already resolved, handed to the skill as `$ARGUMENTS`. Empty (no
 * trailing argument) when the caller supplied no guidance and the step is not
 * resuming — so the plain `batch apply` invocation stays bare.
 *
 * Parts join with a SINGLE newline so the whole payload is one CONTIGUOUS block
 * glued to the invocation — distinct from the blank-line-separated prose
 * sections around it. That keeps the arguments unambiguously "attached to the
 * invocation" rather than floating off as a detached block.
 */
function invocationArguments(context: ChangeStepContext): string {
  const parts: string[] = [];
  const guidance = context.guidance?.trim();
  if (guidance) parts.push(guidance);
  const resume = context.resume;
  if (resume?.kind === 'blocked' && resume.answer?.trim()) {
    parts.push(resume.answer.trim());
  } else if (resume?.kind === 'awaiting-approval' && resume.feedback?.trim()) {
    parts.push(resume.feedback.trim());
  }
  return parts.join('\n');
}

function reportChannel(batch: string | undefined, change: string): string {
  return [
    'Communicate ONLY by running these shell commands (do not prompt interactively):',
    `  ratchet batch report ${batch} --change ${change} --status "<progress note>"`,
    `  ratchet batch report ${batch} --change ${change} --blocker "<question you need answered>"`,
    `  ratchet batch report ${batch} --change ${change} --needs-input "<what you need>"`,
    `  ratchet batch report ${batch} --change ${change} --complete "<summary of what you did>"`,
    'Raise a blocker instead of guessing when a decision is required.',
    'Post a completion ONLY when this single transition is genuinely finished.',
  ].join('\n');
}

function strategyGuidance(context: ChangeStepContext): string {
  if (context.transition !== 'propose') return '';
  if (context.settings.strategy === 'vertical-slice') {
    return [
      'Strategy: vertical-slice. Scope a THIN end-to-end slice that exercises the',
      'whole stack for the phase goal — not a complete feature. Prefer the',
      'smallest change that proves the goal end to end.',
    ].join('\n');
  }
  return [
    'Strategy: feature. Scope a complete, self-contained feature toward the phase',
    'goal.',
  ].join('\n');
}

/**
 * Delegate the transition to the canonical rct skill instead of re-describing
 * the propose/apply/verify steps inline (`delegated-lifecycle`: the engine
 * orchestrates the lifecycle, it does not re-author it). The prompt tells the
 * agent to invoke the resolved `/rct:<transition> <change>` skill, which loads
 * `.ratchet/standards/` and authors/advances the change to the canonical
 * definition of done — the engine no longer carries a parallel inline copy of
 * the lifecycle instructions.
 *
 * The prose is agent-neutral (names no coding agent); only the invocation TOKEN
 * is agent-specific, and that is resolved through the configured spawn agent's
 * adapter in {@link rctInvocation}. The resolved phase goal/success/proof-of-work
 * and the per-change `Definition of done:` stay in the prompt's top block (see
 * {@link buildAgentInstructions}), so the delegation is context-preserving. Any
 * caller `-m` guidance and resolved resume answer/feedback ride along as the
 * invocation's trailing arguments (see {@link invocationArguments}), so the
 * agent passes them to the skill as `$ARGUMENTS` rather than reading them from a
 * detached block.
 */
function transitionGuidance(context: ChangeStepContext): string {
  // The invocation may carry a multi-line argument payload; indent every line so
  // the trailing arguments render as an attached continuation of the call.
  const invocation = rctInvocation(context)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  const lines = [
    `Advance this change by invoking the ratchet ${context.transition} skill — run:`,
    invocation,
    'It loads the project standards under ".ratchet/standards/" and is the single',
    `author of the ${context.transition} lifecycle. Do NOT hand-build or re-describe`,
    `the ${context.transition} steps yourself — delegate to the skill and let it`,
    'author/advance the change to its canonical definition of done.',
  ];
  if (invocationArguments(context)) {
    lines.push(
      'Anything after the change name above is the caller guidance / resume',
      'context the engine already resolved — pass it to the skill as its',
      'arguments ($ARGUMENTS); do not treat it as a separate, optional note.'
    );
  }
  return lines.join('\n');
}

/**
 * Resume INTENT framing for a step that was parked. The answer/feedback TEXT
 * itself now rides on the invocation as a trailing argument (see
 * {@link invocationArguments}); this block keeps only the directive — what the
 * resume means and how to act on it (incorporate the answer / revise the draft,
 * do not start over) — plus the original question/proposal for context. It never
 * re-emits the answer as a detached block. Absent resume → empty.
 */
function resumeGuidance(context: ChangeStepContext): string {
  const resume = context.resume;
  if (!resume) return '';
  if (resume.kind === 'blocked' && resume.answer?.trim()) {
    return [
      'This step was previously parked on a blocker:',
      `  Question: ${resume.reason}`,
      'The resolved answer is attached to the invocation above as an argument —',
      'incorporate it and continue the transition. Do not start over.',
    ].join('\n');
  }
  if (resume.kind === 'awaiting-approval' && resume.feedback?.trim()) {
    const transitionName = context.transition;
    const gerund =
      transitionName === 'propose'
        ? 'proposal'
        : transitionName === 'apply'
          ? 'apply work'
          : transitionName === 'verify'
            ? 'verify pass'
            : transitionName;
    return [
      `The prior ${gerund} was REJECTED with feedback. Re-run ${transitionName} against the`,
      'existing work (do NOT start over and do NOT roll back other work):',
      `  Prior ${gerund}: ${resume.reason}`,
      'The reviewer feedback is attached to the invocation above as an argument —',
      `revise the ${gerund} to address it.`,
    ].join('\n');
  }
  return '';
}

export function buildAgentInstructions(context: ChangeStepContext): string {
  const sections = [
    `You are advancing the ratchet batch "${context.batch}".`,
    `Perform EXACTLY ONE transition: ${context.transition.toUpperCase()} for change "${context.change}".`,
    `You MUST finish by running \`ratchet batch report ${context.batch} --change ${context.change} --complete "<summary>"\` — without it this step is treated as unreported and parked.`,
    '',
    `Active phase: ${context.phase.name}`,
    `Phase goal: ${context.phase.goal}`,
    `Phase success criteria: ${context.phase.success}`,
    `Phase proof-of-work (${context.phase.proofOfWork.kind}): run \`${context.phase.proofOfWork.run}\`, passes when ${context.phase.proofOfWork.pass}`,
    // Per-change definition of done (required, always present). Agent-neutral:
    // it states what "done" means for THIS change alongside the broader phase
    // bar, naming no specific coding agent.
    `Definition of done: ${context.changeDone}`,
  ];

  sections.push('', transitionGuidance(context));

  // Verify-only reporting requirement: the verify `--complete` summary MUST
  // carry the verification report's final-assessment verdict. The mapper
  // corroborates a verify completion against the verdict (VERIFY_VERDICT_PATTERN
  // in outcome.ts), so telling the agent the contract here is the
  // transition-level reporting requirement (the delegated rct:verify lifecycle
  // authors the verdict; the engine instruction only adds the requirement to
  // surface it in `--complete`). Agent-neutral wording (multi-agent-support).
  if (context.transition === 'verify') {
    sections.push(
      '',
      'When you `--complete` the verify step, the summary MUST include the ' +
        'verification report\'s final-assessment verdict (the "Ready for archive" ' +
        'or "N critical issue(s) found" line). The engine corroborates a verify ' +
        'completion against that verdict and parks a verdict-free completion.'
    );
  }

  const strategy = strategyGuidance(context);
  if (strategy) sections.push('', strategy);

  // The caller's `-m` guidance is NOT emitted as a detached block any more:
  // it rides on the invocation as a trailing argument (see invocationArguments),
  // so delegation hands it to the skill as `$ARGUMENTS` rather than floating it
  // off where the skill has no contract to read it (`delegated-lifecycle`).
  const resume = resumeGuidance(context);
  if (resume) sections.push('', resume);

  sections.push('', reportChannel(context.batch, context.change));
  return sections.join('\n');
}

/**
 * The journal key a decomposition step reports under. A decomposition has no
 * `change`, so its journal entries (progress/blocker/completion) and the engine's
 * outcome mapping key off the PHASE name instead. The decomposition agent reports
 * with `ratchet batch report <batch> --change <phase> ...` and the engine
 * snapshots that key — the same single channel a change step uses, just keyed by
 * phase rather than change.
 *
 * The identity (returns the phase name unchanged) is intentional: this function
 * exists as the single seam for the key-derivation rule, so callers never inline
 * it and a future derivation change has one place to edit.
 */
export function decompositionJournalKey(phase: string): string {
  return phase;
}

/**
 * Resolve the `/rct:decompose-phase <phase>` skill-invocation token the spawned
 * decomposition agent should run. The command id is the single-source
 * {@link DECOMPOSE_COMMAND_ID} the spawn-locus guarantee also renders, and the
 * invocation TOKEN is resolved through the CONFIGURED spawn agent's command
 * adapter (claude `/rct:<id>`, others `/rct-<id>`) — never a hard-coded literal,
 * exactly as {@link rctInvocation} does for transitions. A synthetic spawn
 * stand-in (a test fake or `RATCHET_BATCH_AGENT_CMD` override) with no adapter
 * falls back to the DEFAULT_AGENT's adapter, so the token always comes from an
 * adapter rather than an inline string.
 */
function rctDecomposeInvocation(context: DecompositionStepContext): string {
  // Resolve the invocation token for the SAME per-stage agent the engine spawns
  // for the decompose step, so a stage routed to a non-default agent is handed
  // that agent's invocation syntax (not the default agent's). Falls back to
  // `DEFAULT_AGENT` for an unmapped stage / unset agent exactly as before. The
  // resolved value is a whole `agent[:model]` spec string; the invocation token
  // keys on the AGENT PART alone, so a spec-form value routes exactly like its
  // bare name — never the default agent's syntax for a spec-form setting.
  const resolved = resolveAgentForStage(context.settings.agent, 'decompose');
  const agentId =
    (resolved !== undefined ? parseAgentSpec(resolved).agent : undefined) ?? DEFAULT_AGENT;
  const adapter =
    CommandAdapterRegistry.get(agentId) ?? CommandAdapterRegistry.get(DEFAULT_AGENT)!;
  const base = `${adapter.getInvocation(DECOMPOSE_COMMAND_ID)} ${context.phase.name}`;
  const args = decompositionInvocationArguments(context);
  return args ? `${base} ${args}` : base;
}

/**
 * The argument payload appended to the `/rct:decompose-phase <phase>` invocation:
 * the resolved resume answer/feedback (W1), handed to the skill as `$ARGUMENTS`
 * exactly as a change step's {@link invocationArguments} does. Empty when the step
 * is not resuming, so the plain decomposition invocation stays bare.
 */
function decompositionInvocationArguments(context: DecompositionStepContext): string {
  const resume = context.resume;
  if (resume?.kind === 'blocked' && resume.answer?.trim()) {
    return resume.answer.trim();
  }
  if (resume?.kind === 'awaiting-approval' && resume.feedback?.trim()) {
    return resume.feedback.trim();
  }
  return '';
}

/**
 * Resume INTENT framing for a parked decomposition step (W1), mirroring a change
 * step's {@link resumeGuidance}: the answer/feedback TEXT rides on the invocation
 * as a trailing argument; this block keeps only the directive (incorporate the
 * answer / revise per feedback, do not start over) plus the original
 * question/proposal for context. Absent resume → empty.
 */
function decompositionResumeGuidance(context: DecompositionStepContext): string {
  const resume = context.resume;
  if (!resume) return '';
  if (resume.kind === 'blocked' && resume.answer?.trim()) {
    return [
      'This decomposition step was previously parked on a blocker:',
      `  Question: ${resume.reason}`,
      'The resolved answer is attached to the invocation above as an argument —',
      'incorporate it and author the change intents. Do not start over.',
    ].join('\n');
  }
  if (resume.kind === 'awaiting-approval' && resume.feedback?.trim()) {
    return [
      'The prior decomposition was REJECTED with feedback. Re-author the phase',
      'intents against the existing draft (do NOT start over):',
      `  Prior proposal: ${resume.reason}`,
      'The reviewer feedback is attached to the invocation above as an argument —',
      'revise the intents to address it.',
    ].join('\n');
  }
  return '';
}

/**
 * The prior phases' shipped results, rendered as the decomposition's grounding
 * context: each shipped change intent and its definition of done, grouped by
 * phase. This is the basis the canonical skill authors the new phase's intents
 * from (`delegated-lifecycle`: the delegation is context-preserving — the engine
 * hands the skill the real shipped results, never a bare, context-free call).
 */
function priorResultsContext(context: DecompositionStepContext): string {
  const lines: string[] = ['Prior phase shipped results (the basis for decomposition):'];
  if (context.priorResults.length === 0) {
    lines.push('  (none — this is the first reachable phase)');
    return lines.join('\n');
  }
  for (const prior of context.priorResults) {
    lines.push(`  Phase "${prior.phase}":`);
    if (prior.changes.length === 0) {
      lines.push('    (no change intents)');
      continue;
    }
    for (const change of prior.changes) {
      lines.push(`    - ${change.name}: ${change.done}`);
    }
  }
  return lines.join('\n');
}

/**
 * Delegate the phase decomposition to the canonical decomposition skill rather
 * than re-describing the authoring steps inline (`delegated-lifecycle`: the
 * engine orchestrates the spawn; the canonical skill authors the change intents).
 * The prose is agent-neutral; only the invocation TOKEN is agent-specific, and
 * that is resolved through the configured spawn agent's adapter in
 * {@link rctDecomposeInvocation}.
 */
function decompositionGuidance(context: DecompositionStepContext): string {
  // The invocation may carry a trailing resume argument; indent every line so the
  // argument renders as an attached continuation of the call (mirrors the change
  // path's transition guidance).
  const invocation = rctDecomposeInvocation(context)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  const lines = [
    'Decompose this phase by invoking the ratchet decompose-phase skill — run:',
    invocation,
    'It loads the project standards under ".ratchet/standards/" and is the single',
    'author of phase decomposition. Do NOT hand-build or re-describe the',
    'decomposition steps yourself — delegate to the skill and let it author this',
    "phase's concrete change intents into batch.yaml from the prior phase's shipped",
    'results. Author ONLY the manifest edit — never change directories.',
  ];
  if (decompositionInvocationArguments(context)) {
    lines.push(
      'Anything after the phase name above is the resume context the engine already',
      'resolved — pass it to the skill as its arguments ($ARGUMENTS); do not treat',
      'it as a separate, optional note.'
    );
  }
  return lines.join('\n');
}

/**
 * Build the spawned agent's instructions for ONE phase-decomposition step. Unlike
 * {@link buildAgentInstructions} (a per-change transition), this directs the agent
 * to author the reachable empty phase's concrete change intents into `batch.yaml`
 * by delegating to the canonical decomposition skill. The empty phase's
 * goal/success/proof-of-work and the prior phases' shipped results are injected as
 * the delegation context, so the delegation is context-preserving and never a
 * bare, context-free skill call (`delegated-lifecycle`).
 */
export function buildDecompositionInstructions(context: DecompositionStepContext): string {
  const key = decompositionJournalKey(context.phase.name);
  const sections = [
    `You are advancing the ratchet batch "${context.batch}".`,
    `Perform EXACTLY ONE step: DECOMPOSE the phase "${context.phase.name}" — author its concrete change intents into batch.yaml.`,
    `You MUST finish by running \`ratchet batch report ${context.batch} --change ${key} --complete "<summary>"\` — without it this step is treated as unreported and parked.`,
    '',
    `Phase to decompose: ${context.phase.name}`,
    `Phase goal: ${context.phase.goal}`,
    `Phase success criteria: ${context.phase.success}`,
    `Phase proof-of-work (${context.phase.proofOfWork.kind}): run \`${context.phase.proofOfWork.run}\`, passes when ${context.phase.proofOfWork.pass}`,
    '',
    priorResultsContext(context),
    '',
    decompositionGuidance(context),
  ];

  // Resume framing (W1): when the step was parked and the user answered, surface
  // the resume intent — the answer text itself rides on the invocation argument.
  const resume = decompositionResumeGuidance(context);
  if (resume) sections.push('', resume);

  sections.push('', reportChannel(context.batch, key));
  return sections.join('\n');
}

/**
 * The journal `change` key a PR-open step reports under. A PR step has no
 * `change`, so — like a decomposition or proof-of-work entry — it is keyed off the
 * BATCH; the `pr:` prefix keeps it from colliding with a change's own name
 * (mirroring {@link decompositionJournalKey} and the `proof-of-work:` prefix). The
 * PR agent reports with `ratchet batch report <batch> --change <prJournalKey> ...`
 * and the engine snapshots that key — the same single channel a change step uses,
 * keyed by batch rather than change.
 *
 * Under a STACKED grouping mode (`per-phase`/`per-change`) each fired group needs
 * its OWN key so a resumed loop opens every group exactly once and distinct groups
 * are guarded independently. Passing the fired `boundary` returns
 * `pr:<batch>:<groupId>` for a `phase`/`change` group; the whole-batch group (no
 * boundary, or `kind: 'batch'`) keeps its existing `pr:<batch>` key UNCHANGED, so
 * Phase 2 whole-batch behavior and its tests are byte-identical. The boundary
 * carries only the group IDENTITY; the engine reads it here rather than
 * re-deriving which group fired.
 */
export function prJournalKey(batch: string, boundary?: PrGroupBoundary): string {
  if (!boundary || boundary.kind === 'batch') return `pr:${batch}`;
  return `pr:${batch}:${boundary.groupId}`;
}

/**
 * Resolve the `/rct:open-pr` skill-invocation token the spawned PR agent should
 * run. The command id is the single-source {@link PR_OPEN_COMMAND_ID} the
 * spawn-locus guarantee also renders, and the invocation TOKEN is resolved through
 * the agent the `pr` STAGE maps to (`resolveAgentForStage(settings.agent, 'pr')`) —
 * claude `/rct:<id>`, others `/rct-<id>` — never a hard-coded literal, so a `pr`
 * stage routed to a non-default agent is handed that agent's own invocation syntax
 * (`multi-agent-support`). Falls back to `DEFAULT_AGENT`'s adapter for an
 * unmapped/unset agent (or a synthetic spawn stand-in with no adapter), exactly as
 * {@link rctDecomposeInvocation} does. The `open-pr` command takes no positional
 * argument — the work/base branch ride in the prompt as Input data, not the
 * invocation — so the token stays the bare `/rct:open-pr`.
 */
function rctPrOpenInvocation(context: PrStepContext): string {
  // The `pr` stage value is a whole `agent[:model]` spec string; the invocation
  // token keys on the AGENT PART alone, so a spec-form value routes exactly like
  // its bare name — never the default agent's syntax for a spec-form `pr` stage.
  const resolved = resolveAgentForStage(context.settings.agent, 'pr');
  const agentId =
    (resolved !== undefined ? parseAgentSpec(resolved).agent : undefined) ?? DEFAULT_AGENT;
  const adapter =
    CommandAdapterRegistry.get(agentId) ?? CommandAdapterRegistry.get(DEFAULT_AGENT)!;
  return adapter.getInvocation(PR_OPEN_COMMAND_ID);
}

/**
 * The resolved work/base branch delivered to the PR agent as the "Input" data the
 * `open-pr` body expects (`instruction-fed-config`): the static skill body says the
 * surrounding instructions supply the work and base branch, and this supplies
 * exactly that. The base is a GENERAL supplied value passed through VERBATIM —
 * whatever the `PrStepContext` carries: the repository's default branch for a
 * whole-batch PR, or an arbitrary stacked sibling branch (the previous group's
 * branch) for a per-phase / per-change stacked PR. This assembly derives nothing
 * from git and never falls back to the default branch or the work branch's
 * upstream; the resolved base is the SOLE PR target, delivered as prompt data. The
 * engine never bakes an "if config says X" branch into the skill body — resolved
 * behavior arrives here as data, so a later change can inject the computed stacked
 * base with no edit to the shared command.
 */
function prInputContext(context: PrStepContext): string {
  return [
    'Input for the open-pr command (the branches are already resolved for you):',
    `  Work branch: ${context.workBranch}`,
    `  Base branch: ${context.baseBranch}`,
    `Open EXACTLY ONE pull request FROM the work branch "${context.workBranch}" TO`,
    `the supplied base branch "${context.baseBranch}". This base is the sole target —`,
    'do not invent, infer, or re-derive it from git, the repository default branch,',
    "the work branch's upstream, or config; use exactly the base given here.",
  ].join('\n');
}

/**
 * Delegate the whole-batch PR-open step to the canonical `/rct:open-pr` skill
 * rather than re-authoring the commit/push/PR-open steps inline
 * (`delegated-lifecycle`: the engine orchestrates the spawn; the shared skill
 * authors the PR steps). The prose is agent-neutral (names no coding agent and no
 * forge CLI); only the invocation TOKEN is agent-specific, resolved through the
 * `pr` stage's adapter in {@link rctPrOpenInvocation}.
 */
function prDelegationGuidance(context: PrStepContext): string {
  const invocation = `  ${rctPrOpenInvocation(context)}`;
  return [
    'Open the pull request by invoking the ratchet open-pr skill — run:',
    invocation,
    'It loads the project standards under ".ratchet/standards/" and is the single',
    "author of the PR-open steps: read `git log` for the repository's commit style",
    '(defaulting to semantic / Conventional Commits), commit the prior stage agents\'',
    'accumulated work, push the work branch, and open EXACTLY ONE pull request to its',
    'base branch using whichever forge CLI the environment provides. Do NOT hand-build',
    'or re-describe the commit/push/PR-open steps yourself — delegate to the skill and',
    'use the work/base branch identified above as its Input.',
  ].join('\n');
}

/**
 * A short, human-readable scope for the PR step's intro line, derived from the
 * fired group boundary: the completed batch for a whole-batch step (no boundary or
 * `kind: 'batch'`), or the completed phase/change group otherwise. Framing only —
 * the authoritative branches ride in {@link prInputContext} as data.
 */
function prScopeDescription(boundary?: PrGroupBoundary): string {
  if (!boundary || boundary.kind === 'batch') return 'the completed batch';
  return `the completed ${boundary.kind} group "${boundary.groupId}"`;
}

/**
 * Build the spawned agent's instructions for ONE PR-open step. Unlike
 * {@link buildAgentInstructions} (a per-change transition) it directs the agent to
 * commit the accumulated work and open a single pull request by delegating to the
 * canonical `/rct:open-pr` skill. The terminal phase framing and the resolved
 * work/base branch are injected as the delegation's Input, so the delegation is
 * context-preserving and never a bare, context-free skill call
 * (`delegated-lifecycle` / `instruction-fed-config`).
 *
 * Under a stacked grouping mode the step opens ONE group's PR (the fired
 * `boundary`), stacked on the previous group via the resolved `baseBranch`; a
 * whole-batch step (no boundary) opens the single batch-wide PR. Either way the
 * agent still delegates to the shared command — the group scope is data, not a
 * re-authored prompt.
 */
export function buildPrInstructions(context: PrStepContext): string {
  const key = prJournalKey(context.batch, context.boundary);
  const scope = prScopeDescription(context.boundary);
  const sections = [
    `You are advancing the ratchet batch "${context.batch}".`,
    `Perform EXACTLY ONE step: open the single pull request for ${scope}.`,
    `You MUST finish by running \`ratchet batch report ${context.batch} --change ${key} --complete "<summary>"\` — without it this step is treated as unreported and parked.`,
    '',
    `Active phase: ${context.phase.name}`,
    `Phase goal: ${context.phase.goal}`,
    `Phase success criteria: ${context.phase.success}`,
    '',
    prInputContext(context),
    '',
    prDelegationGuidance(context),
    '',
    reportChannel(context.batch, key),
  ];
  return sections.join('\n');
}
