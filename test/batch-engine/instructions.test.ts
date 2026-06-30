import { describe, it, expect } from 'vitest';
import type { ResolvedStepContext, BatchSettings, ProofOfWork, Transition } from 'ratchet-ai';
import { buildAgentInstructions } from '../../src/core/batch/engine/instructions.js';

const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return { gate: 'voluntary', strategy: 'vertical-slice', proofOfWork: 'hard-gate', locus: 'local', agent: 'claude', ...over };
}

function context(transition: Transition, over: Partial<ResolvedStepContext> = {}): ResolvedStepContext {
  return {
    batch: 'rex-agent-runtime',
    change: 'add-login-api',
    changeDone: 'the login endpoint authenticates a user',
    transition,
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: settings(),
    journal: [],
    ...over,
  };
}

// The change-verb prompt now DELEGATES to the canonical rct skill: it must emit
// the `/rct:<transition> <change>` invocation rather than describe the lifecycle
// steps inline. This contract is the inverse of the pre-delegation one.
describe('buildAgentInstructions — propose delegates to the rct skill', () => {
  it('emits the /rct:propose <change> invocation (claude spawn)', () => {
    const text = buildAgentInstructions(context('propose'));
    expect(text).toContain('/rct:propose add-login-api');
  });

  it('no longer describes the hand-built propose steps inline', () => {
    const text = buildAgentInstructions(context('propose'));
    // The inline recipe is gone: no "write files directly on disk", no inline
    // change-directory / feature-file / plan.md authoring instructions.
    expect(text.toLowerCase()).not.toContain('write files directly on disk');
    expect(text).not.toMatch(/features\/\*\*\/\*\.feature/);
    expect(text).not.toContain('## Tasks');
    // The delegated skill is the single author of the lifecycle.
    expect(text).toContain('/rct:propose add-login-api');
  });

  it('stays tool-agnostic (names no specific coding agent)', () => {
    const text = buildAgentInstructions(context('propose'));
    expect(text).not.toMatch(/\bClaude\b/);
    expect(text).not.toMatch(/\bCursor\b/);
    expect(text).not.toMatch(/\bCodex\b/);
    expect(text).not.toMatch(/\bGemini\b/);
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

describe('buildAgentInstructions — apply/verify delegate to the rct skill', () => {
  it('apply emits /rct:apply <change> and drops the inline ## Tasks recipe', () => {
    const text = buildAgentInstructions(context('apply'));
    expect(text).toContain('/rct:apply add-login-api');
    // The inline "work through the ## Tasks checklist" recipe is gone.
    expect(text).not.toContain('## Tasks');
    expect(text.toLowerCase()).not.toContain('checking off each');
  });

  it('verify emits /rct:verify <change> and drops the inline check recipe', () => {
    const text = buildAgentInstructions(context('verify'));
    expect(text).toContain('/rct:verify add-login-api');
    expect(text.toLowerCase()).not.toContain('against its feature scenarios');
  });
});

// multi-agent-support + delegated-lifecycle: the invocation TOKEN is resolved
// from the CONFIGURED spawn agent's command adapter, never a single hard-coded
// literal. claude namespaces with ':', the file-based agents use '-'.
describe('buildAgentInstructions — invocation token matches the spawn agent', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['claude', '/rct:propose add-login-api'],
    ['cursor', '/rct-propose add-login-api'],
    ['gemini', '/rct-propose add-login-api'],
    ['codex', '/rct-propose add-login-api'],
  ];
  for (const [agent, invocation] of cases) {
    it(`${agent} spawn emits "${invocation}"`, () => {
      const text = buildAgentInstructions(
        context('propose', { settings: settings({ agent }) })
      );
      expect(text).toContain(invocation);
    });
  }

  it('does not hard-code claude\'s "/rct:propose" for a hyphen-syntax agent', () => {
    const text = buildAgentInstructions(
      context('propose', { settings: settings({ agent: 'cursor' }) })
    );
    // The cursor spawn must NOT carry claude's colon-namespaced token.
    expect(text).not.toContain('/rct:propose');
    expect(text).toContain('/rct-propose add-login-api');
  });
});

// delegated-lifecycle: "Delegation must be context-preserving, not context-free."
// The new invocation must sit ALONGSIDE the resolved phase context and the
// per-change definition of done — never reduced to a bare skill call.
describe('buildAgentInstructions — delegation is context-preserving', () => {
  it('keeps the phase context and definition of done alongside the invocation', () => {
    const text = buildAgentInstructions(context('apply'));
    expect(text).toContain('/rct:apply add-login-api');
    expect(text).toContain('Phase goal:');
    expect(text).toContain('Phase success criteria:');
    expect(text).toContain('Phase proof-of-work');
    expect(text).toContain('Definition of done: the login endpoint authenticates a user');
  });

  it('is never reduced to only the /rct:<transition> <change> line', () => {
    const text = buildAgentInstructions(context('verify'));
    const nonEmpty = text.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(nonEmpty.length).toBeGreaterThan(1);
    // The phase context the engine already resolved is still present.
    expect(text).toContain('Phase goal:');
    expect(text).toContain('Definition of done:');
  });
});

// delegated-lifecycle: "it hands that context to the skill as arguments, rather
// than reducing the step to a bare, context-free skill call." The caller's `-m`
// guidance and any resolved resume answer/feedback travel WITH the invocation as
// trailing arguments the skill consumes — never as a detached prose block.
describe('buildAgentInstructions — caller guidance is injected as an invocation argument', () => {
  // The line carrying the invocation, with surrounding whitespace stripped.
  function invocationLine(text: string, token: string): string {
    const line = text.split('\n').find((l) => l.includes(token));
    expect(line, `expected an invocation line containing "${token}"`).toBeDefined();
    return line!.trim();
  }

  it('attaches the `-m` guidance to the /rct:<transition> <change> invocation', () => {
    const text = buildAgentInstructions(
      context('apply', { guidance: 'focus the slice on the deny path' })
    );
    // The guidance rides on the invocation line itself, after the change name.
    const line = invocationLine(text, '/rct:apply add-login-api');
    expect(line).toBe('/rct:apply add-login-api focus the slice on the deny path');
  });

  it('no longer emits a detached "Additional guidance:" block', () => {
    const text = buildAgentInstructions(
      context('apply', { guidance: 'focus the slice on the deny path' })
    );
    // The guidance text is present (on the invocation), but the old orphaned
    // "Additional guidance:" carrier is gone.
    expect(text).toContain('focus the slice on the deny path');
    expect(text).not.toContain('Additional guidance:');
  });

  it('is never reduced to only the invocation line when guidance is present', () => {
    const text = buildAgentInstructions(
      context('verify', { guidance: 'focus the slice on the deny path' })
    );
    const nonEmpty = text.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(nonEmpty.length).toBeGreaterThan(1);
    // The resolved phase context + per-change done stay alongside the invocation.
    expect(text).toContain('Phase goal:');
    expect(text).toContain('Phase success criteria:');
    expect(text).toContain('Phase proof-of-work');
    expect(text).toContain('Definition of done: the login endpoint authenticates a user');
  });

  it('preserves the per-agent token when injecting guidance (cursor, not /rct:propose)', () => {
    const text = buildAgentInstructions(
      context('propose', {
        settings: settings({ agent: 'cursor' }),
        guidance: 'focus the slice on the deny path',
      })
    );
    const line = invocationLine(text, '/rct-propose add-login-api');
    expect(line).toBe('/rct-propose add-login-api focus the slice on the deny path');
    // Argument injection did not smuggle in claude's colon-namespaced token.
    expect(text).not.toContain('/rct:propose');
  });

  it('leaves the invocation clean (bare change name) when no guidance is supplied', () => {
    const text = buildAgentInstructions(context('apply'));
    const line = invocationLine(text, '/rct:apply add-login-api');
    // No trailing empty-argument noise after the change name.
    expect(line).toBe('/rct:apply add-login-api');
  });
});

describe('buildAgentInstructions — resume answer is injected as an invocation argument', () => {
  function invocationLine(text: string, token: string): string {
    const line = text.split('\n').find((l) => l.includes(token));
    expect(line, `expected an invocation line containing "${token}"`).toBeDefined();
    return line!.trim();
  }

  it('attaches a parked-blocker answer to the invocation on resume', () => {
    const text = buildAgentInstructions(
      context('apply', {
        resume: { kind: 'blocked', reason: 'which auth scheme?', answer: 'use bearer tokens' },
      })
    );
    const line = invocationLine(text, '/rct:apply add-login-api');
    expect(line).toBe('/rct:apply add-login-api use bearer tokens');
    // Resume intent framing survives (the original question + the directive),
    // but the answer is no longer re-emitted as a detached "Answer:" line.
    expect(text).toContain('which auth scheme?');
    expect(text).not.toMatch(/Answer: +use bearer tokens/);
    // Not reduced to only the invocation line.
    const nonEmpty = text.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(nonEmpty.length).toBeGreaterThan(1);
  });

  it('attaches rejected-proposal feedback to the invocation on a propose re-run', () => {
    const text = buildAgentInstructions(
      context('propose', {
        resume: {
          kind: 'awaiting-approval',
          reason: 'draft v1',
          feedback: 'the slice is too broad — narrow it to the deny path',
        },
      })
    );
    const line = invocationLine(text, '/rct:propose add-login-api');
    expect(line).toBe('/rct:propose add-login-api the slice is too broad — narrow it to the deny path');
    // The revise-don't-restart intent framing remains.
    expect(text).toContain('do NOT start over');
  });

  it('injects caller guidance AND a resume answer together — neither dropped', () => {
    const text = buildAgentInstructions(
      context('apply', {
        guidance: 'keep the public API unchanged',
        resume: { kind: 'blocked', reason: 'which auth scheme?', answer: 'use bearer tokens' },
      })
    );
    const lines = text.split('\n');
    const idx = lines.findIndex((l) => l.includes('/rct:apply add-login-api'));
    expect(idx).toBeGreaterThanOrEqual(0);
    // Guidance rides on the invocation line itself, after the change name.
    expect(lines[idx].trim()).toBe('/rct:apply add-login-api keep the public API unchanged');
    // The resume answer is glued to it as the very next line — one contiguous
    // argument block, NOT separated by a blank line (which would detach it).
    expect(lines[idx + 1].trim()).toBe('use bearer tokens');
  });

  it('leaves the invocation clean when there is no resume context and no guidance', () => {
    const text = buildAgentInstructions(context('apply'));
    const line = invocationLine(text, '/rct:apply add-login-api');
    expect(line).toBe('/rct:apply add-login-api');
  });
});

// multi-agent-support: argument injection special-cases no agent — the token is
// resolved per the configured spawn agent's adapter and only the trailing
// arguments are appended. Iterate the spawnable set with guidance present.
describe('buildAgentInstructions — argument injection preserves every spawn agent token', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['claude', '/rct:propose add-login-api'],
    ['codex', '/rct-propose add-login-api'],
    ['gemini', '/rct-propose add-login-api'],
    ['cursor', '/rct-propose add-login-api'],
  ];
  for (const [agent, token] of cases) {
    it(`${agent} keeps its token with the guidance argument attached`, () => {
      const text = buildAgentInstructions(
        context('propose', {
          settings: settings({ agent }),
          guidance: 'focus the slice on the deny path',
        })
      );
      const line = text.split('\n').find((l) => l.includes(token));
      expect(line, `expected an invocation line containing "${token}"`).toBeDefined();
      expect(line!.trim()).toBe(`${token} focus the slice on the deny path`);
    });
  }
});

describe('buildAgentInstructions — per-change definition of done', () => {
  it('always includes the definition-of-done line alongside the phase block', () => {
    const text = buildAgentInstructions(
      context('apply', { changeDone: 'module returns DENY unless all gates green' })
    );
    expect(text).toContain('Definition of done: module returns DENY unless all gates green');
    // The phase goal and phase success criteria are still present.
    expect(text).toContain('Phase goal:');
    expect(text).toContain('Phase success criteria:');
  });

  it('emits no "Change success criteria" line', () => {
    const text = buildAgentInstructions(context('apply'));
    expect(text).not.toContain('Change success criteria');
    // The definition-of-done line is always present (required field).
    expect(text).toContain('Definition of done:');
  });

  it('keeps the definition-of-done line agent-neutral (names no coding agent)', () => {
    const text = buildAgentInstructions(
      context('apply', { changeDone: 'the gate denies on a non-main branch' })
    );
    const line = text
      .split('\n')
      .find((l) => l.startsWith('Definition of done:'));
    expect(line).toBeDefined();
    expect(line!).not.toMatch(/\bClaude\b/);
    expect(line!).not.toMatch(/\bCursor\b/);
    expect(line!).not.toMatch(/\bCodex\b/);
  });
});
