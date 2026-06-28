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
import { rctCommandIdForTransition, DECOMPOSE_COMMAND_ID } from './skill-locus.js';
import { DEFAULT_AGENT } from './agent.js';
import type { ChangeStepContext, DecompositionStepContext } from './contract.js';

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
  const agentId = context.settings.agent ?? DEFAULT_AGENT;
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
    return [
      'The prior proposal was REJECTED with feedback. Re-run propose against the',
      'existing draft (do NOT start over and do NOT roll back other work):',
      `  Prior proposal: ${resume.reason}`,
      'The reviewer feedback is attached to the invocation above as an argument —',
      'revise the draft to address it.',
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
  const agentId = context.settings.agent ?? DEFAULT_AGENT;
  const adapter =
    CommandAdapterRegistry.get(agentId) ?? CommandAdapterRegistry.get(DEFAULT_AGENT)!;
  return `${adapter.getInvocation(DECOMPOSE_COMMAND_ID)} ${context.phase.name}`;
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
  const invocation = `  ${rctDecomposeInvocation(context)}`;
  return [
    'Decompose this phase by invoking the ratchet decompose-phase skill — run:',
    invocation,
    'It loads the project standards under ".ratchet/standards/" and is the single',
    'author of phase decomposition. Do NOT hand-build or re-describe the',
    'decomposition steps yourself — delegate to the skill and let it author this',
    "phase's concrete change intents into batch.yaml from the prior phase's shipped",
    'results. Author ONLY the manifest edit — never change directories.',
  ].join('\n');
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
    '',
    reportChannel(context.batch, key),
  ];
  return sections.join('\n');
}
