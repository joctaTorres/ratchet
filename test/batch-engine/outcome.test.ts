import { describe, it, expect } from 'vitest';
import type { JournalEntry } from 'ratchet';
import { mapSessionToOutcome, type MapOutcomeInput } from '../../src/core/batch/engine/outcome.js';
import type { ChangeDiskState } from '../../src/core/batch/engine/transition.js';
import type { AgentSpawnResult } from '../../src/core/batch/engine/agent.js';

function disk(over: Partial<ChangeDiskState> = {}): ChangeDiskState {
  return {
    exists: false,
    archived: false,
    hasPlan: false,
    tasksTotal: 0,
    tasksComplete: 0,
    applied: false,
    ...over,
  };
}

function spawn(over: Partial<AgentSpawnResult> = {}): AgentSpawnResult {
  return { exitCode: 0, signal: null, stdout: '', stderr: '', ...over };
}

function input(over: Partial<MapOutcomeInput> = {}): MapOutcomeInput {
  return {
    change: 'add-login-api',
    transition: 'propose',
    sessionEntries: [] as JournalEntry[],
    sessionIndices: [],
    spawn: spawn(),
    parkForApproval: false,
    diskEvidence: { before: disk(), after: disk() },
    ...over,
  };
}

describe('mapSessionToOutcome — zero-exit-no-report transcript', () => {
  it('attaches the truncated captured transcript on a bare zero-exit', () => {
    const outcome = mapSessionToOutcome(
      input({ spawn: spawn({ stdout: 'I considered the change and stopped.' }) })
    );
    expect(outcome.state).toBe('blocked');
    expect(outcome.detail).toContain('I considered the change and stopped.');
  });

  it('falls back to stderr when stdout is empty', () => {
    const outcome = mapSessionToOutcome(
      input({ spawn: spawn({ stdout: '', stderr: 'an error trace' }) })
    );
    expect(outcome.state).toBe('blocked');
    expect(outcome.detail).toContain('an error trace');
  });

  it('truncates a long transcript with the same marker as the non-zero path', () => {
    const long = 'x'.repeat(5000);
    const outcome = mapSessionToOutcome(input({ spawn: spawn({ stdout: long }) }));
    expect(outcome.detail).toContain('… (truncated)');
    expect((outcome.detail ?? '').length).toBeLessThan(long.length);
  });

  it('produces a defined (empty) detail for an empty transcript and claims no transcript', () => {
    const outcome = mapSessionToOutcome(input({ spawn: spawn({ stdout: '', stderr: '' }) }));
    expect(outcome.state).toBe('blocked');
    expect(outcome.detail).toBe('');
    expect(outcome.blocker).toMatch(/without reporting completion or a blocker/i);
  });
});

describe('mapSessionToOutcome — on-disk evidence surfaced as progress (still blocked)', () => {
  it('surfaces a created change directory + plan for propose, without auto-advancing', () => {
    const outcome = mapSessionToOutcome(
      input({
        transition: 'propose',
        diskEvidence: {
          before: disk({ exists: false, hasPlan: false }),
          after: disk({ exists: true, hasPlan: true }),
        },
        spawn: spawn({ stdout: 'wrote plan' }),
      })
    );
    expect(outcome.state).toBe('blocked'); // never auto-advanced
    expect(outcome.message ?? '').toMatch(/change directory|plan/i);
    expect(outcome.message ?? '').not.toMatch(/did nothing/i);
    expect(outcome.message ?? '').not.toMatch(/No completion reported/i);
    // The transcript is still carried alongside the evidence note.
    expect(outcome.detail).toContain('wrote plan');
  });

  it('surfaces advanced task checkboxes for apply as a delta, without auto-advancing', () => {
    const outcome = mapSessionToOutcome(
      input({
        transition: 'apply',
        diskEvidence: {
          before: disk({ exists: true, hasPlan: true, tasksTotal: 4, tasksComplete: 1 }),
          after: disk({ exists: true, hasPlan: true, tasksTotal: 4, tasksComplete: 3 }),
        },
      })
    );
    expect(outcome.state).toBe('blocked');
    expect(outcome.message ?? '').toMatch(/2 tasks/i);
    expect(outcome.message ?? '').not.toMatch(/No completion reported/i);
  });

  it('does NOT report progress for apply when no checkboxes advanced', () => {
    const outcome = mapSessionToOutcome(
      input({
        transition: 'apply',
        diskEvidence: {
          before: disk({ exists: true, hasPlan: true, tasksTotal: 4, tasksComplete: 2 }),
          after: disk({ exists: true, hasPlan: true, tasksTotal: 4, tasksComplete: 2 }),
        },
      })
    );
    expect(outcome.state).toBe('blocked');
    expect(outcome.message ?? '').toMatch(/No completion reported/i);
  });
});

describe('mapSessionToOutcome — truly silent run with no evidence parks bare', () => {
  it('parks as a bare blocked with the unreported message when nothing changed on disk', () => {
    const outcome = mapSessionToOutcome(
      input({
        transition: 'propose',
        diskEvidence: { before: disk(), after: disk() },
        spawn: spawn({ stdout: '', stderr: '' }),
      })
    );
    expect(outcome.state).toBe('blocked');
    expect(outcome.blocker).toMatch(/exited.*without reporting completion or a blocker/i);
    expect(outcome.message).toMatch(/No completion reported/i);
  });
});
