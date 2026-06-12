/**
 * Proof-of-work as a PHASE GATE.
 *
 * The narrow `proof-of-work.test.ts` suite asserts the pass/fail/policy mechanics
 * of a single check. This file exercises the downstream DECISION the engine makes
 * with that result: a phase's proof-of-work is run once its changes are done, and
 * its `gatePassed` verdict decides whether the NEXT phase opens. We model a tiny
 * two-phase gate controller over `runProofOfWork` and assert the phase-progression
 * outcome under each policy, feeding decisions through the injectable BashRunner /
 * LlmJudge seams (no real shelling out, deterministic).
 */

import { describe, it, expect } from 'vitest';
import {
  runProofOfWork,
  type BashRunner,
  type LlmJudge,
  type ProofOfWorkResult,
} from '../../packages/batch-engine/src/proof-of-work.js';
import type { ProofOfWork, ProofOfWorkPolicy } from 'ratchet';

const integrationPow = (over: Partial<ProofOfWork> = {}): ProofOfWork => ({
  kind: 'integration',
  run: 'pnpm test',
  pass: 'exit 0',
  ...over,
});

/**
 * Decide whether phase N+1 opens given phase N's proof-of-work result. The next
 * phase is gated (blocked) unless the prior phase's gate passed.
 */
function nextPhaseOpens(prior: ProofOfWorkResult): boolean {
  return prior.gatePassed;
}

describe('proof-of-work phase gate — bash/integration kinds', () => {
  it('PASS opens the next phase (integration check, contains: condition)', async () => {
    const bash: BashRunner = async () => ({
      exitCode: 0,
      stdout: '42 passing\n0 failing\n',
      stderr: '',
    });
    const result = await runProofOfWork(
      integrationPow({ pass: 'contains:0 failing' }),
      'hard-gate',
      '/tmp',
      { bash }
    );
    expect(result.passed).toBe(true);
    expect(result.gatePassed).toBe(true);
    expect(result.reason).toBe('pass-condition-met');
    // The phase ships, so the next phase is no longer gated.
    expect(nextPhaseOpens(result)).toBe(true);
  });

  it('PASS via a regex: condition opens the next phase', async () => {
    const bash: BashRunner = async () => ({
      exitCode: 0,
      stdout: 'Tests:  17 passed, 17 total',
      stderr: '',
    });
    const result = await runProofOfWork(
      integrationPow({ pass: 'regex:\\d+ passed' }),
      'hard-gate',
      '/tmp',
      { bash }
    );
    expect(result.passed).toBe(true);
    expect(nextPhaseOpens(result)).toBe(true);
  });

  it('FAIL under hard-gate keeps the next phase BLOCKED (phase not done)', async () => {
    const bash: BashRunner = async () => ({
      exitCode: 1,
      stdout: '3 passing\n2 failing\n',
      stderr: 'tests failed',
    });
    const result = await runProofOfWork(
      integrationPow({ pass: 'exit 0' }),
      'hard-gate',
      '/tmp',
      { bash }
    );
    expect(result.passed).toBe(false);
    expect(result.gatePassed).toBe(false); // phase not allowed to complete
    expect(result.reason).toBe('nonzero-exit');
    // The next phase stays gated: hard-gate blocks downstream work.
    expect(nextPhaseOpens(result)).toBe(false);
  });

  it('FAIL where the command exits 0 but the pass condition is unmet stays blocked', async () => {
    const bash: BashRunner = async () => ({
      exitCode: 0,
      stdout: '3 passing\n2 failing\n',
      stderr: '',
    });
    const result = await runProofOfWork(
      integrationPow({ pass: 'contains:0 failing' }),
      'hard-gate',
      '/tmp',
      { bash }
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('pass-condition-unmet');
    expect(nextPhaseOpens(result)).toBe(false);
  });

  it('FAIL under warn policy lets the next phase PROCEED (recorded, not blocking)', async () => {
    const bash: BashRunner = async () => ({ exitCode: 1, stdout: '', stderr: 'boom' });
    const policy: ProofOfWorkPolicy = 'warn';
    const result = await runProofOfWork(integrationPow(), policy, '/tmp', { bash });
    expect(result.passed).toBe(false); // the check genuinely failed
    expect(result.gatePassed).toBe(true); // but warn lets the phase complete
    expect(result.policy).toBe('warn');
    // Despite the failure, the next phase opens under warn.
    expect(nextPhaseOpens(result)).toBe(true);
  });
});

describe('proof-of-work phase gate — llm-judge kind', () => {
  it('a PASS verdict from the judge opens the next phase', async () => {
    const judge: LlmJudge = async (req) => ({
      pass: true,
      reason: `exercised: ${req.run}`,
    });
    const result = await runProofOfWork(
      integrationPow({ kind: 'llm-judge', run: 'exercise the slice', pass: 'works end to end' }),
      'hard-gate',
      '/tmp',
      { judge }
    );
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('judge-pass');
    expect(nextPhaseOpens(result)).toBe(true);
  });

  it('a FAIL verdict under hard-gate keeps the next phase blocked', async () => {
    const judge: LlmJudge = async () => ({ pass: false, reason: 'slice is broken' });
    const result = await runProofOfWork(
      integrationPow({ kind: 'llm-judge' }),
      'hard-gate',
      '/tmp',
      { judge }
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('judge-fail');
    expect(result.detail).toContain('broken');
    expect(nextPhaseOpens(result)).toBe(false);
  });

  it('a judge that throws fails closed under hard-gate (next phase blocked)', async () => {
    const judge: LlmJudge = async () => {
      throw new Error('judge adapter crashed');
    };
    const result = await runProofOfWork(
      integrationPow({ kind: 'llm-judge' }),
      'hard-gate',
      '/tmp',
      { judge }
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('error');
    expect(nextPhaseOpens(result)).toBe(false);
  });
});
