import { describe, it, expect } from 'vitest';
import {
  runProofOfWork,
  evaluatePassCondition,
  realBashRunner,
  type BashRunner,
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

  it('recognizes a leading exit-zero prose directive and gates on exit, not stdout substring', () => {
    const prose = 'exit code 0 — new tests assert the slice works';
    // exit 0 with stdout that does NOT contain the prose sentence -> still passes
    const ok = evaluatePassCondition(prose, { exitCode: 0, stdout: 'totally unrelated output\n', stderr: '' });
    expect(ok.passed).toBe(true);
    expect(ok.reason).toBe('pass-condition-met');
  });

  it('fails a leading exit-zero prose directive on a non-zero exit', () => {
    const prose = 'exit code 0 — new tests assert the slice works';
    const r = evaluatePassCondition(prose, { exitCode: 1, stdout: '', stderr: 'boom' });
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('nonzero-exit');
  });

  it('recognizes leading exit-zero directives regardless of form', () => {
    const conditions = [
      'exit 0',
      'exit-zero',
      'exit code 0',
      'Exit 0, then the suite is green',
      'exit-zero: integration suite green',
      'EXIT CODE 0 — everything passes',
    ];
    for (const condition of conditions) {
      // stdout deliberately unrelated: a recognized directive must gate on exit only
      const r = evaluatePassCondition(condition, { exitCode: 0, stdout: 'unrelated\n', stderr: '' });
      expect(r.passed, condition).toBe(true);
      expect(r.reason, condition).toBe('pass-condition-met');
    }
  });

  it('does not treat a directive followed by an underscore-joined token as exit-zero', () => {
    // `exit code 0_done` is a single underscore-joined token, not a leading
    // exit-zero directive: it must fall through to the stdout-substring default
    // (exit 0 + substring required), not gate on exit status alone.
    const condition = 'exit code 0_done';
    // exit 0 but stdout lacks the literal token -> NOT a pass (would have passed
    // if mistaken for an exit-zero directive).
    const miss = evaluatePassCondition(condition, { exitCode: 0, stdout: 'unrelated\n', stderr: '' });
    expect(miss.passed).toBe(false);
    expect(miss.reason).toBe('pass-condition-unmet');
    // and it passes only when stdout actually contains the literal token.
    const hit = evaluatePassCondition(condition, {
      exitCode: 0,
      stdout: 'exit code 0_done\n',
      stderr: '',
    });
    expect(hit.passed).toBe(true);
  });

  it('treats a bare non-exit-code string as a stdout substring default', () => {
    // passes when stdout contains the bare string
    const hit = evaluatePassCondition('all checks green', {
      exitCode: 0,
      stdout: 'all checks green now\n',
      stderr: '',
    });
    expect(hit.passed).toBe(true);
    expect(hit.reason).toBe('pass-condition-met');

    // fails (pass-condition-unmet, not nonzero-exit) on exit 0 when stdout lacks it
    const miss = evaluatePassCondition('all checks green', {
      exitCode: 0,
      stdout: 'something else\n',
      stderr: '',
    });
    expect(miss.passed).toBe(false);
    expect(miss.reason).toBe('pass-condition-unmet');
  });

  it('an invalid regex: pattern never throws and reports not-passed', () => {
    let r: ReturnType<typeof evaluatePassCondition> | undefined;
    expect(() => {
      r = evaluatePassCondition('regex:([', { exitCode: 0, stdout: 'anything', stderr: '' });
    }).not.toThrow();
    expect(r?.passed).toBe(false);
    expect(r?.reason).toBe('pass-condition-unmet');
    expect(r?.matchedExcerpt).toBeUndefined();
  });

  // verdict-matched-evidence.feature: the verdict records which condition kind
  // matched and the matched excerpt, so gate evidence is reviewable.
  describe('verdict records the matched condition kind and excerpt', () => {
    it('a contains condition records its kind and the needle as excerpt', () => {
      const r = evaluatePassCondition('contains:12 passed', {
        exitCode: 0,
        stdout: '12 passed, 0 failed',
        stderr: '',
      });
      expect(r.passed).toBe(true);
      expect(r.conditionKind).toBe('contains');
      expect(r.matchedExcerpt).toBe('12 passed');
    });

    it('a regex condition records the actual matched text as excerpt', () => {
      const r = evaluatePassCondition('regex:PASS-[0-9]+', {
        exitCode: 0,
        stdout: 'result: PASS-42 ok',
        stderr: '',
      });
      expect(r.passed).toBe(true);
      expect(r.conditionKind).toBe('regex');
      expect(r.matchedExcerpt).toBe('PASS-42'); // actual matched text, not the pattern
    });

    it('an exit-zero condition records its kind with no excerpt', () => {
      const r = evaluatePassCondition('exit code 0 — suite green', {
        exitCode: 0,
        stdout: 'unrelated\n',
        stderr: '',
      });
      expect(r.passed).toBe(true);
      expect(r.conditionKind).toBe('exit-zero');
      expect(r.matchedExcerpt).toBeUndefined();
    });

    it('a failing condition records its kind without a matched excerpt', () => {
      const r = evaluatePassCondition('contains:12 passed', {
        exitCode: 0,
        stdout: 'something else',
        stderr: '',
      });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('pass-condition-unmet');
      expect(r.conditionKind).toBe('contains');
      expect(r.matchedExcerpt).toBeUndefined();
    });

    it('a bare-string (substring) condition records its kind and the needle', () => {
      const r = evaluatePassCondition('all green', {
        exitCode: 0,
        stdout: 'suite is all green now',
        stderr: '',
      });
      expect(r.passed).toBe(true);
      expect(r.conditionKind).toBe('substring');
      expect(r.matchedExcerpt).toBe('all green');
    });

    it('threads conditionKind and matchedExcerpt through runProofOfWork into the result', async () => {
      const bash: BashRunner = async () => ({
        exitCode: 0,
        stdout: 'result: PASS-42 ok',
        stderr: '',
      });
      const result = await runProofOfWork(
        POW({ run: 'pnpm test', pass: 'regex:PASS-[0-9]+' }),
        'hard-gate',
        '/tmp',
        SUCCESS,
        { bash }
      );
      expect(result.passed).toBe(true);
      expect(result.conditionKind).toBe('regex');
      expect(result.matchedExcerpt).toBe('PASS-42');
    });
  });
});

// The default runner really shells out. These exercise it with trivial,
// hermetic built-ins (`echo`, `exit`) — no network, no agents, no fixtures —
// so the real spawn path is covered without depending on any external command.
describe('realBashRunner (default spawn)', () => {
  it('captures stdout and a zero exit code for a successful command', async () => {
    const result = await realBashRunner('echo hello', process.cwd());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
  });

  it('surfaces a nonzero exit code and stderr for a failing command', async () => {
    const result = await realBashRunner('echo oops >&2; exit 3', process.cwd());
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('oops');
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
