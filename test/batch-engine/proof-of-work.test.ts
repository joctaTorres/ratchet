import { describe, it, expect } from 'vitest';
import {
  runProofOfWork,
  evaluatePassCondition,
  type BashRunner,
  type LlmJudge,
} from '../../packages/batch-engine/src/proof-of-work.js';
import type { ProofOfWork } from 'ratchet';

const POW = (over: Partial<ProofOfWork> = {}): ProofOfWork => ({
  kind: 'blackbox',
  run: 'echo ok',
  pass: 'exit 0',
  ...over,
});

const bashOk: BashRunner = async () => ({ exitCode: 0, stdout: 'ok\n', stderr: '' });
const bashFail: BashRunner = async () => ({ exitCode: 1, stdout: '', stderr: 'boom' });

describe('evaluatePassCondition', () => {
  it('passes on exit 0 for an exit-zero condition', () => {
    expect(evaluatePassCondition('exit 0', { exitCode: 0, stdout: '', stderr: '' }).passed).toBe(true);
  });
  it('fails on non-zero exit', () => {
    const r = evaluatePassCondition('exit 0', { exitCode: 2, stdout: '', stderr: '' });
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('nonzero-exit');
  });
  it('supports contains: conditions', () => {
    expect(evaluatePassCondition('contains:PASS', { exitCode: 0, stdout: 'all PASS', stderr: '' }).passed).toBe(true);
    expect(evaluatePassCondition('contains:PASS', { exitCode: 0, stdout: 'FAIL', stderr: '' }).passed).toBe(false);
  });
  it('supports regex: conditions', () => {
    expect(evaluatePassCondition('regex:\\d+ passing', { exitCode: 0, stdout: '12 passing', stderr: '' }).passed).toBe(true);
  });
});

describe('runProofOfWork (bash kinds)', () => {
  it('passes a blackbox check when the pass condition holds', async () => {
    const result = await runProofOfWork(POW(), 'hard-gate', '/tmp', { bash: bashOk });
    expect(result.passed).toBe(true);
    expect(result.gatePassed).toBe(true);
  });

  it('hard-gate blocks the phase when proof-of-work fails', async () => {
    const result = await runProofOfWork(POW(), 'hard-gate', '/tmp', { bash: bashFail });
    expect(result.passed).toBe(false);
    expect(result.gatePassed).toBe(false); // phase not allowed to complete
  });

  it('warn policy allows the phase to complete despite failure', async () => {
    const result = await runProofOfWork(POW(), 'warn', '/tmp', { bash: bashFail });
    expect(result.passed).toBe(false);
    expect(result.gatePassed).toBe(true); // recorded as warning, phase proceeds
  });
});

describe('runProofOfWork (llm-judge)', () => {
  const judgePass: LlmJudge = async () => ({ pass: true, reason: 'looks good' });
  const judgeFail: LlmJudge = async () => ({ pass: false, reason: 'broken' });

  it('passes when the judge returns a pass verdict', async () => {
    const result = await runProofOfWork(POW({ kind: 'llm-judge' }), 'hard-gate', '/tmp', { judge: judgePass });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('judge-pass');
  });

  it('hard-gates when the judge returns a fail verdict', async () => {
    const result = await runProofOfWork(POW({ kind: 'llm-judge' }), 'hard-gate', '/tmp', { judge: judgeFail });
    expect(result.passed).toBe(false);
    expect(result.gatePassed).toBe(false);
    expect(result.reason).toBe('judge-fail');
  });

  it('fails closed under hard-gate when no judge is wired', async () => {
    const result = await runProofOfWork(POW({ kind: 'llm-judge' }), 'hard-gate', '/tmp', {});
    expect(result.passed).toBe(false);
    expect(result.gatePassed).toBe(false);
  });
});
