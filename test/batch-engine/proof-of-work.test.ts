import { describe, it, expect } from 'vitest';
import {
  runProofOfWork,
  evaluatePassCondition,
  type BashRunner,
  type LlmJudge,
} from '../../src/core/batch/engine/proof-of-work.js';
import type { ProofOfWork } from 'ratchet-ai';

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

const SUCCESS = 'the slice works end to end';

describe('runProofOfWork (bash kinds)', () => {
  it('passes a blackbox check when the pass condition holds', async () => {
    const result = await runProofOfWork(POW(), 'hard-gate', '/tmp', SUCCESS, { bash: bashOk });
    expect(result.passed).toBe(true);
    expect(result.gatePassed).toBe(true);
  });

  it('hard-gate blocks the phase when proof-of-work fails', async () => {
    const result = await runProofOfWork(POW(), 'hard-gate', '/tmp', SUCCESS, { bash: bashFail });
    expect(result.passed).toBe(false);
    expect(result.gatePassed).toBe(false); // phase not allowed to complete
  });

  it('warn policy allows the phase to complete despite failure', async () => {
    const result = await runProofOfWork(POW(), 'warn', '/tmp', SUCCESS, { bash: bashFail });
    expect(result.passed).toBe(false);
    expect(result.gatePassed).toBe(true); // recorded as warning, phase proceeds
  });
});

describe('runProofOfWork (llm-judge)', () => {
  const judgePass: LlmJudge = async () => ({ pass: true, reason: 'looks good' });
  const judgeFail: LlmJudge = async () => ({ pass: false, reason: 'broken' });

  it('passes when the judge returns a pass verdict', async () => {
    const result = await runProofOfWork(POW({ kind: 'llm-judge' }), 'hard-gate', '/tmp', SUCCESS, { judge: judgePass });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('judge-pass');
  });

  it('hard-gates when the judge returns a fail verdict', async () => {
    const result = await runProofOfWork(POW({ kind: 'llm-judge' }), 'hard-gate', '/tmp', SUCCESS, { judge: judgeFail });
    expect(result.passed).toBe(false);
    expect(result.gatePassed).toBe(false);
    expect(result.reason).toBe('judge-fail');
  });

  it('fails closed under hard-gate when no judge is wired', async () => {
    const result = await runProofOfWork(POW({ kind: 'llm-judge' }), 'hard-gate', '/tmp', SUCCESS, {});
    expect(result.passed).toBe(false);
    expect(result.gatePassed).toBe(false);
  });

  it('judges against the phase success criteria, not the bash pass condition', async () => {
    let received: { success: string; run: string; pass: string } | undefined;
    const judge: LlmJudge = async (req) => {
      received = { success: req.success, run: req.run, pass: req.pass };
      return { pass: true, reason: 'ok' };
    };
    // pass (the bash condition) and success (the phase criteria) deliberately differ.
    await runProofOfWork(
      POW({ kind: 'llm-judge', run: 'exercise the slice', pass: 'exit 0' }),
      'hard-gate',
      '/tmp',
      SUCCESS,
      { judge }
    );
    expect(received?.success).toBe(SUCCESS); // judged against phase success criteria
    expect(received?.success).not.toBe('exit 0'); // NOT the bash pass condition
    expect(received?.run).toBe('exercise the slice');
  });
});
