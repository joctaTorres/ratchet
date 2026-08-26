import { describe, it, expect } from 'vitest';
import {
  ISSUE_RECONCILIATION_STEP,
  CLOSE_CLAIM_RULES,
  STOP_AND_SURFACE_GUARDRAIL,
} from '../../../../src/core/templates/workflows/scope-reconciliation.js';
import { getRctProposeSkillTemplate } from '../../../../src/core/templates/workflows/propose.js';
import { getProposeBatchSkillTemplate } from '../../../../src/core/templates/workflows/propose-batch.js';
import { getDecomposePhaseSkillTemplate } from '../../../../src/core/templates/workflows/decompose-phase.js';

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('scope-reconciliation shared fragments', () => {
  describe('ISSUE_RECONCILIATION_STEP', () => {
    const step = ISSUE_RECONCILIATION_STEP;

    it('requires identifying every originating issue from all three sources', () => {
      expect(step).toMatch(/identify every originating issue/i);
      // The user, the manifest, and the injected `done` each originate issues.
      expect(step).toMatch(/the user\s+references it/i);
      expect(step).toMatch(/manifest phase or change intent references it/i);
      expect(step).toMatch(/injected `done` criterion references it/i);
    });

    it('requires fetching each issue through the project tracker before authoring', () => {
      expect(step).toMatch(/fetch each originating issue through the project's issue tracker/i);
      expect(step).toMatch(/BEFORE any artifact is written/);
      expect(step).toMatch(/never work from a paraphrase/i);
    });

    it('names gh only as a GitHub example and offers a paste fallback', () => {
      // generalizable-defaults: no tracker is required and no command is baked in.
      expect(step).toContain('gh issue view <n>');
      expect(step).toMatch(/on github, for example/i);
      expect(step).toMatch(/other trackers have their own client/i);
      expect(step).toMatch(/ask the user to paste\s+the issue text/i);
    });

    it('enumerates material requirements from both fix items and narrative', () => {
      expect(step).toMatch(/enumerate the issue's material requirements/i);
      expect(step).toMatch(/explicit fix items/i);
      expect(step).toMatch(/problems named in its narrative/i);
      expect(step).toMatch(/A problem described only in\s+prose is still a requirement/i);
    });

    it('states that hedged wording does not lower the bar', () => {
      expect(step).toMatch(/hedged source wording does not lower the bar/i);
      expect(step).toContain('"Consider"');
      expect(step).toContain('"maybe"');
      expect(step).toContain('"optionally"');
      expect(step).toMatch(/security-,\s+permission-, or integrity-relevant, severity governs/i);
    });

    it('requires mapping every requirement and listing what is uncovered', () => {
      expect(step).toMatch(/map every enumerated requirement to authored scope/i);
      expect(step).toMatch(/feature scenario or\s+the plan task that covers it/i);
      expect(step).toMatch(/list every requirement the authored scope does not cover/i);
    });

    it('requires the enumerated decision point and forbids self-approval', () => {
      expect(step).toMatch(/surface every uncovered requirement to the user as a decision point/i);
      expect(step).toContain('"issue asks X, this proposal does not include');
      expect(step).toMatch(/before the artifacts are finalized/i);
      expect(step).toMatch(/MUST NOT self-approve an omission by writing it into plan prose/i);
    });

    it('stays agent-neutral with a plain-prose fallback', () => {
      // multi-agent-support: AskUserQuestion is optional, never assumed.
      expect(step).toContain('AskUserQuestion');
      expect(step).toMatch(/if your agent has one, otherwise ask in plain prose/i);
      expect(step).not.toMatch(/\bClaude\b/);
    });
  });

  describe('CLOSE_CLAIM_RULES', () => {
    const rules = CLOSE_CLAIM_RULES;

    it('permits a close-claim only when material requirements are implemented', () => {
      expect(rules).toContain('`Fixes #N`');
      expect(rules).toContain('`Closes #N`');
      expect(rules).toMatch(/only when the issue's material requirements are actually implemented/i);
    });

    it('covers a manifest done, a plan, and a pull-request body', () => {
      expect(rules).toMatch(/batch manifest `done`/i);
      expect(rules).toMatch(/in a plan/i);
      expect(rules).toMatch(/pull-request body/i);
    });

    it('requires partial work to say "partially addresses #N"', () => {
      expect(rules).toContain('"partially addresses #N"');
      expect(rules).toMatch(/MUST NOT say "Fixes #N" or "Closes #N"/);
    });

    it('states a close-claim is an output of verification, never an input of planning', () => {
      expect(rules).toMatch(/output of verification, never an input of planning/i);
    });
  });

  describe('STOP_AND_SURFACE_GUARDRAIL', () => {
    const guardrail = STOP_AND_SURFACE_GUARDRAIL;

    it('makes a security-relevant de-scope halt the workflow and ask', () => {
      expect(guardrail).toMatch(/stop-and-surface event/i);
      expect(guardrail).toMatch(/security-,\s+permission-, or integrity-relevant work halts this workflow and asks/i);
      expect(guardrail).toMatch(/never taken on momentum/i);
    });

    it('requires an approved deferral to have a filed, owned, linked tracking issue', () => {
      expect(guardrail).toMatch(/MUST be explicitly filed with a named owner/i);
      expect(guardrail).toMatch(/MUST be linked\s+from the change plan, before you proceed/i);
    });

    it('states a prose bullet in a plan is not a deferral mechanism', () => {
      expect(guardrail).toMatch(/prose bullet in `plan\.md` is not a\s+deferral\s+mechanism/i);
    });
  });

  describe('the shared rules are carried by every change-authoring workflow', () => {
    const bodies: Array<[string, string]> = [
      ['propose', getRctProposeSkillTemplate().instructions],
      ['propose-batch', getProposeBatchSkillTemplate().instructions],
      ['decompose-phase', getDecomposePhaseSkillTemplate().instructions],
    ];

    it.each(bodies)('%s embeds the close-claim rule verbatim', (_name, body) => {
      expect(body).toContain(CLOSE_CLAIM_RULES);
    });

    it.each(bodies)('%s embeds the stop-and-surface guardrail verbatim', (_name, body) => {
      expect(body).toContain(STOP_AND_SURFACE_GUARDRAIL);
    });

    it.each(bodies)('%s embeds each shared rule exactly once, never as a hand-authored copy', (_name, body) => {
      // "The guardrail is defined exactly once": a second occurrence would mean a
      // body restated the rule instead of interpolating the shared constant.
      expect(occurrences(body, CLOSE_CLAIM_RULES)).toBe(1);
      expect(occurrences(body, STOP_AND_SURFACE_GUARDRAIL)).toBe(1);
    });

    it('embeds the reconciliation step verbatim in the two issue-reconciling workflows', () => {
      expect(getRctProposeSkillTemplate().instructions).toContain(ISSUE_RECONCILIATION_STEP);
      expect(getProposeBatchSkillTemplate().instructions).toContain(ISSUE_RECONCILIATION_STEP);
    });
  });
});
