/**
 * Build the agent's instructions from the resolved step context.
 *
 * Instructions are plain text injected into the spawned agent. They direct the
 * agent to perform exactly one transition (propose | apply | verify) toward the
 * active phase goal, reference the phase success criteria and proof-of-work, and
 * report progress/blockers/completion back only through `ratchet batch report`
 * (the agent's single communication channel — no interactive prompt required).
 */

import type { ResolvedStepContext } from './contract.js';

function reportChannel(batch: string, change: string): string {
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

function strategyGuidance(context: ResolvedStepContext): string {
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

function transitionGuidance(context: ResolvedStepContext): string {
  switch (context.transition) {
    case 'propose':
      return [
        `Create the change "${context.change}" and its artifacts (features + plan).`,
        'Use the ratchet propose workflow to scaffold the change directory, its',
        'feature files, and a plan.md with a ## Tasks checklist.',
        'Do NOT implement tasks in this step — only propose.',
      ].join('\n');
    case 'apply':
      return [
        `Implement the planned tasks for change "${context.change}".`,
        'Work through the plan.md ## Tasks checklist and check off each box as you',
        'complete it. Do NOT re-propose or change the plan scope.',
      ].join('\n');
    case 'verify':
      return [
        `Verify change "${context.change}" against its feature scenarios.`,
        'Run the relevant checks/tests and confirm the implementation satisfies',
        'the feature files. Report completion only if verification passes; raise a',
        'blocker if it does not.',
      ].join('\n');
  }
}

function resumeGuidance(context: ResolvedStepContext): string {
  const resume = context.resume;
  if (!resume) return '';
  if (resume.kind === 'blocked' && resume.answer) {
    return [
      'This step was previously parked on a blocker. Resume with the answer:',
      `  Question: ${resume.reason}`,
      `  Answer:   ${resume.answer}`,
      'Incorporate the answer and continue the transition.',
    ].join('\n');
  }
  if (resume.kind === 'awaiting-approval' && resume.feedback) {
    return [
      'The prior proposal was REJECTED with feedback. Re-run propose against the',
      'existing draft (do NOT start over and do NOT roll back other work):',
      `  Prior proposal: ${resume.reason}`,
      `  Feedback:       ${resume.feedback}`,
      'Revise the draft to address the feedback.',
    ].join('\n');
  }
  return '';
}

export function buildAgentInstructions(context: ResolvedStepContext): string {
  const sections = [
    `You are advancing the ratchet batch "${context.batch}".`,
    `Perform EXACTLY ONE transition: ${context.transition.toUpperCase()} for change "${context.change}".`,
    '',
    `Active phase: ${context.phase.name}`,
    `Phase goal: ${context.phase.goal}`,
    `Phase success criteria: ${context.phase.success}`,
    `Phase proof-of-work (${context.phase.proofOfWork.kind}): run \`${context.phase.proofOfWork.run}\`, passes when ${context.phase.proofOfWork.pass}`,
    '',
    transitionGuidance(context),
  ];

  const strategy = strategyGuidance(context);
  if (strategy) sections.push('', strategy);

  const resume = resumeGuidance(context);
  if (resume) sections.push('', resume);

  sections.push('', reportChannel(context.batch, context.change));
  return sections.join('\n');
}
