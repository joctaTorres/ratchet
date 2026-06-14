import { describe, it, expect } from 'vitest';
import type { ResolvedStepContext, BatchSettings, ProofOfWork, Transition } from 'ratchet';
import { buildAgentInstructions } from '../../src/core/batch/engine/instructions.js';

const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return { gate: 'voluntary', strategy: 'vertical-slice', proofOfWork: 'hard-gate', locus: 'local', agent: 'fake', ...over };
}

function context(transition: Transition, over: Partial<ResolvedStepContext> = {}): ResolvedStepContext {
  return {
    batch: 'rex-agent-runtime',
    change: 'add-login-api',
    transition,
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: settings(),
    journal: [],
    ...over,
  };
}

const SLASH_COMMAND = /\/rct\b|\/rct:/;

describe('buildAgentInstructions — propose contract', () => {
  it('references no slash-command, skill, or "propose workflow"', () => {
    const text = buildAgentInstructions(context('propose'));
    expect(text).not.toMatch(SLASH_COMMAND);
    expect(text.toLowerCase()).not.toContain('propose workflow');
    expect(text.toLowerCase()).not.toContain('skill');
    // No "use the <named> workflow" instruction.
    expect(text).not.toMatch(/use the ratchet propose/i);
  });

  it('describes concrete filesystem and CLI steps', () => {
    const text = buildAgentInstructions(context('propose'));
    expect(text).toContain('.ratchet/changes/add-login-api/');
    expect(text).toMatch(/features\/\*\*\/\*\.feature/);
    expect(text).toContain('plan.md');
    expect(text).toContain('## Tasks');
  });

  it('stays tool-agnostic (names no specific coding agent)', () => {
    const text = buildAgentInstructions(context('propose'));
    expect(text).not.toMatch(/\bClaude\b/);
    expect(text).not.toMatch(/\bCursor\b/);
    expect(text).not.toMatch(/\bCodex\b/);
  });
});

describe('buildAgentInstructions — completion requirement up front', () => {
  for (const transition of ['propose', 'apply', 'verify'] as const) {
    it(`states the completion requirement near the top for ${transition}`, () => {
      const text = buildAgentInstructions(context(transition));
      const lines = text.split('\n');
      const idx = lines.findIndex(
        (l) => /You MUST finish/.test(l) && l.includes('--complete')
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      // "Near the top" — within the first few lines, ahead of the phase block.
      expect(idx).toBeLessThan(3);
      expect(lines[idx]).toContain('ratchet batch report');
      // The full report channel still carries --complete at the bottom.
      const lastComplete = text.lastIndexOf('--complete');
      expect(lastComplete).toBeGreaterThan(text.indexOf('--complete'));
    });
  }
});

describe('buildAgentInstructions — apply/verify avoid slash-commands', () => {
  it('apply names no slash-command and describes the ## Tasks checklist concretely', () => {
    const text = buildAgentInstructions(context('apply'));
    expect(text).not.toMatch(SLASH_COMMAND);
    expect(text.toLowerCase()).not.toContain('skill');
    expect(text).toContain('## Tasks');
    expect(text).toContain('plan.md');
  });

  it('verify names no slash-command', () => {
    const text = buildAgentInstructions(context('verify'));
    expect(text).not.toMatch(SLASH_COMMAND);
    expect(text.toLowerCase()).not.toContain('skill');
  });
});
