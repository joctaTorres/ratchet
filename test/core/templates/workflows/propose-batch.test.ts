import { describe, it, expect } from 'vitest';
import {
  getProposeBatchSkillTemplate,
  getRctProposeBatchCommandTemplate,
} from '../../../../src/core/templates/workflows/propose-batch.js';

describe('propose-batch workflow templates', () => {
  it('exposes a skill template that guides authoring a batch manifest', () => {
    const skill = getProposeBatchSkillTemplate();

    expect(skill.name).toBe('ratchet-propose-batch');
    expect(skill.description).toBeTruthy();

    const body = skill.instructions;
    // Writes a manifest via the existing batch machinery, not change directories.
    expect(body).toContain('ratchet new batch');
    expect(body).toContain('.ratchet/batches/<name>/batch.yaml');
    expect(body).toMatch(/never change directories|no change directories|not change directories/i);

    // The five-step guided flow.
    expect(body).toMatch(/explore the objective/i);
    expect(body).toMatch(/vertical-slice phase/i);
    expect(body).toMatch(/reject horizontal/i);
    expect(body).toContain('proof-of-work');

    // The three allowed proof-of-work kinds.
    expect(body).toContain('integration');
    expect(body).toContain('blackbox');
    expect(body).toContain('llm-judge');

    // Phase-one concrete proof vs later-phase refinable proof.
    expect(body).toMatch(/refined at phase entry/i);

    // Shallow DAG: only phase one decomposed.
    expect(body).toMatch(/shallow dag/i);
    expect(body).toContain('after');

    // Non-default gate/strategy recorded under settings.
    expect(body).toContain('settings');
    expect(body).toContain('gate');
    expect(body).toContain('strategy');

    // Gated chain-in into propose-change.
    expect(body).toMatch(/gate/i);
    expect(body).toContain('/rct:propose');
    expect(body).toMatch(/ratchet batch apply/);

    // The four waterfall traps appear as rationale.
    expect(body).toMatch(/inflexibility to change/i);
    expect(body).toMatch(/late error detection/i);
    expect(body).toMatch(/early customer feedback/i);
    expect(body).toMatch(/planning fallacy/i);

    // Agent-neutral, per multi-agent-support standard.
    expect(body.toLowerCase()).toContain('your agent');
    expect(body).toContain('AskUserQuestion');
  });

  it('exposes a command template sharing the same authoring body', () => {
    const command = getRctProposeBatchCommandTemplate();

    expect(command.name).toBeTruthy();
    expect(command.category).toBe('Workflow');
    expect(command.tags).toEqual(['workflow', 'batch', 'experimental']);
    // Same shared body as the skill.
    expect(command.content).toBe(getProposeBatchSkillTemplate().instructions);
  });
});
