/**
 * Unit tests for `mapSessionToOutcome`.
 *
 * Implements:
 *  - features/model-failure-attribution/attribution-hint.feature
 *  - features/model-failure-attribution/unchanged-surfaces.feature
 *
 * The attribution enrichment is pure, so it lands at the unit layer: the hint
 * fires only on the full argv-rejection signature (explicit model + supplying
 * scope + non-zero exit + no completion + zero session journal entries), and
 * every other input surfaces byte-for-byte what today's mapping produces.
 */

import { describe, it, expect } from 'vitest';
import type { JournalEntry } from 'ratchet-ai';
import {
  mapSessionToOutcome,
  type MapOutcomeInput,
  type ModelAttribution,
} from '../../src/core/batch/engine/outcome.js';
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

// -----------------------------------------------------------------------------
// Model-failure attribution (features/model-failure-attribution/*.feature).
// The hint fires only on the full argv-rejection signature: an explicit model
// (attribution present), a non-zero exit, no completion, and zero session
// journal entries. Every other input is byte-for-byte today's output.
// -----------------------------------------------------------------------------
const attribution: ModelAttribution = {
  stage: 'apply',
  agent: 'opencode',
  model: 'zai/glm-5.2',
  scope: 'project',
};

describe('mapSessionToOutcome — attributed model-failure hint', () => {
  it('prepends the hint naming stage, agent, model, and scope above the stderr tail', () => {
    const outcome = mapSessionToOutcome(
      input({
        transition: 'apply',
        spawn: spawn({ exitCode: 2, stderr: 'error: unknown model id' }),
        modelAttribution: attribution,
      })
    );
    expect(outcome.state).toBe('failed');
    expect(outcome.detail).toContain('The "apply" stage ran the "opencode" agent');
    expect(outcome.detail).toContain('with model "zai/glm-5.2"');
    expect(outcome.detail).toContain('the project config');
    expect(outcome.detail).toMatch(/if this model id is invalid/i);
    // The stderr tail follows verbatim below the hint.
    expect(outcome.detail).toContain('error: unknown model id');
    // The hint sits ABOVE the stderr tail.
    expect(outcome.detail!.indexOf('if this model id is invalid')).toBeLessThan(
      outcome.detail!.indexOf('error: unknown model id')
    );
    // blocker/message are untouched by the hint.
    expect(outcome.blocker).toBe('Agent exited with code 2 without reporting completion.');
    expect(outcome.message).toBe('Agent failed during apply.');
  });

  it('names the batch manifest scope when the manifest supplied the spec', () => {
    const outcome = mapSessionToOutcome(
      input({
        transition: 'apply',
        spawn: spawn({ exitCode: 1, stderr: 'boom' }),
        modelAttribution: { ...attribution, scope: 'manifest' },
      })
    );
    expect(outcome.detail).toContain('the batch manifest');
  });

  it('is phrased as "if this model id is invalid" guidance, never a diagnosis', () => {
    const outcome = mapSessionToOutcome(
      input({
        transition: 'verify',
        spawn: spawn({ exitCode: 1, stderr: 'whatever' }),
        modelAttribution: { ...attribution, stage: 'verify' },
      })
    );
    expect(outcome.detail).toMatch(/if this model id is invalid or not available/i);
    // Asserts nothing about why the agent died — no stderr interpretation.
    expect(outcome.detail).not.toMatch(/because|reason:|caused by/i);
  });

  it('hint text is identical regardless of stderr content, with stderr verbatim below', () => {
    const a = mapSessionToOutcome(
      input({
        spawn: spawn({ exitCode: 1, stderr: 'one kind of error' }),
        modelAttribution: attribution,
      })
    );
    const b = mapSessionToOutcome(
      input({
        spawn: spawn({ exitCode: 1, stderr: 'totally different error text' }),
        modelAttribution: attribution,
      })
    );
    // The hint portion (everything above the stderr tail) is identical.
    const hintA = a.detail!.split('\n\n')[0];
    const hintB = b.detail!.split('\n\n')[0];
    expect(hintA).toBe(hintB);
    // The stderr tail is surfaced verbatim below.
    expect(a.detail).toContain('one kind of error');
    expect(b.detail).toContain('totally different error text');
  });

  it('emits only the hint when the stderr tail is empty', () => {
    const outcome = mapSessionToOutcome(
      input({
        spawn: spawn({ exitCode: 1, stdout: '', stderr: '' }),
        modelAttribution: attribution,
      })
    );
    expect(outcome.detail).not.toContain('\n\n');
    expect(outcome.detail).toMatch(/if this model id is invalid/i);
  });
});

describe('mapSessionToOutcome — attribution gate (byte-for-byte today without the signature)', () => {
  // The unattributed mapping for the same failed-shape input — the baseline
  // every gate case must equal byte-for-byte (no hint).
  function failedBaseline(over: Partial<MapOutcomeInput> = {}): ReturnType<typeof mapSessionToOutcome> {
    return mapSessionToOutcome(
      input({
        transition: 'apply',
        spawn: spawn({ exitCode: 2, stderr: 'error: unknown model id' }),
        ...over,
      })
    );
  }

  it('a bare-name (no attribution) failure surfaces byte-for-byte today', () => {
    // No modelAttribution supplied → bare-name / no-scope path.
    const attributed = failedBaseline({ modelAttribution: undefined });
    const today = failedBaseline();
    expect(attributed.detail).toBe(today.detail);
    expect(attributed.blocker).toBe(today.blocker);
    expect(attributed.message).toBe(today.message);
  });

  it('a failure with session journal progress surfaces unchanged (hint does not fire)', () => {
    const progressed = mapSessionToOutcome(
      input({
        transition: 'apply',
        spawn: spawn({ exitCode: 2, stderr: 'error: unknown model id' }),
        sessionEntries: [
          { at: '', kind: 'progress', message: 'made some progress', change: 'add-login-api', transition: 'apply' },
        ],
        sessionIndices: [0],
        modelAttribution: attribution,
      })
    );
    const today = failedBaseline();
    expect(progressed.detail).toBe(today.detail);
    expect(progressed.blocker).toBe(today.blocker);
    expect(progressed.message).toBe(today.message);
  });

  it('a zero-exit failure surfaces unchanged', () => {
    // Zero exit with no completion takes the zero-exit-no-report branch, not the
    // failed branch — attribution never touches it.
    const outcome = mapSessionToOutcome(
      input({
        transition: 'apply',
        spawn: spawn({ exitCode: 0, stderr: '' }),
        modelAttribution: attribution,
      })
    );
    const today = mapSessionToOutcome(
      input({ transition: 'apply', spawn: spawn({ exitCode: 0, stderr: '' }) })
    );
    expect(outcome.detail).toBe(today.detail);
    expect(outcome.blocker).toBe(today.blocker);
    expect(outcome.message).toBe(today.message);
  });

  it('a reported blocker surfaces unchanged (blocker branch precedes failed)', () => {
    const blockerEntry: JournalEntry = {
      at: '',
      kind: 'blocker',
      message: 'need an answer',
      change: 'add-login-api',
      transition: 'apply',
    };
    const outcome = mapSessionToOutcome(
      input({
        transition: 'apply',
        spawn: spawn({ exitCode: 1, stderr: 'boom' }),
        sessionEntries: [blockerEntry],
        sessionIndices: [0],
        modelAttribution: attribution,
      })
    );
    const today = mapSessionToOutcome(
      input({
        transition: 'apply',
        spawn: spawn({ exitCode: 1, stderr: 'boom' }),
        sessionEntries: [blockerEntry],
        sessionIndices: [0],
      })
    );
    expect(outcome).toEqual(today);
  });

  it('a completion surfaces unchanged (completion branch precedes failed)', () => {
    const completionEntry: JournalEntry = {
      at: '',
      kind: 'completion',
      message: 'done',
      change: 'add-login-api',
      transition: 'apply',
    };
    const outcome = mapSessionToOutcome(
      input({
        transition: 'apply',
        spawn: spawn({ exitCode: 0, stderr: 'whatever' }),
        sessionEntries: [completionEntry],
        sessionIndices: [0],
        modelAttribution: attribution,
      })
    );
    const today = mapSessionToOutcome(
      input({
        transition: 'apply',
        spawn: spawn({ exitCode: 0, stderr: 'whatever' }),
        sessionEntries: [completionEntry],
        sessionIndices: [0],
      })
    );
    expect(outcome).toEqual(today);
  });
});
