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
    // Fetches the canonical template at runtime instead of embedding a copy
    // (single source of truth = schemas/ratchet/templates/standard.md).
    expect(skill.instructions).toContain('ratchet template standard');
    expect(skill.instructions).not.toContain('> Concern:');
  });

  it('requires standards to be authored atemporally and self-contained (skill)', () => {
    const skill = getRctProposeStandardSkillTemplate();
    const body = skill.instructions;

    // Atemporal wording: no internal paths, line numbers, symbol names, or a
    // "current flow" walk-through that goes stale when the implementation moves.
    expect(body).toMatch(/atemporal/i);
    expect(body).toContain('line numbers');
    expect(body).toContain('which part does what today');
    // Self-containment: no cross-references to other standards, because there is
    // no cascading update or deletion between standards.
    expect(body).toContain('cross-reference other standards');
    expect(body).toMatch(/no cascading update or deletion between standards/i);
    // The rationale: a standard has no lifecycle / is never auto-updated.
    expect(body).toMatch(/has no lifecycle/i);
    expect(body).toMatch(/never automatically updated/i);
  });

  it('exposes a command template sharing the same authoring body', () => {
    const command = getRctProposeStandardCommandTemplate();

    expect(command.name).toBeTruthy();
    expect(command.category).toBe('Workflow');
    expect(command.content).toContain('.ratchet/standards/');
  });

  it('carries the same atemporal, self-contained rules in the command form', () => {
    const command = getRctProposeStandardCommandTemplate();
    const body = command.content;

    // The command is rendered from the same shared body, so the atemporal rules
    // must reach it identically to the skill.
    expect(body).toMatch(/atemporal/i);
    expect(body).toContain('line numbers');
    expect(body).toContain('which part does what today');
    expect(body).toContain('cross-reference other standards');
    expect(body).toMatch(/has no lifecycle/i);
    expect(body).toMatch(/never automatically updated/i);
  });
});
