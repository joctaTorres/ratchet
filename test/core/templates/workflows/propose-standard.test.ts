import { describe, it, expect } from 'vitest';
import {
  getRctProposeStandardSkillTemplate,
  getRctProposeStandardCommandTemplate,
} from '../../../../src/core/templates/workflows/propose-standard.js';

describe('propose-standard workflow templates', () => {
  it('exposes a skill template that writes to the standards library', () => {
    const skill = getRctProposeStandardSkillTemplate();

    expect(skill.name).toBe('ratchet-propose-standard');
    expect(skill.description).toBeTruthy();
    // Writes directly to the standards library...
    expect(skill.instructions).toContain('.ratchet/standards/');
    // ...and never creates a change.
    expect(skill.instructions).toMatch(/do not create a change/i);
  });

  it('exposes a command template sharing the same authoring body', () => {
    const command = getRctProposeStandardCommandTemplate();

    expect(command.name).toBeTruthy();
    expect(command.category).toBe('Workflow');
    expect(command.content).toContain('.ratchet/standards/');
  });
});
