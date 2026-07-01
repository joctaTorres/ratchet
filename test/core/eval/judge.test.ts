import { describe, it, expect } from 'vitest';
import { judgeCase, parseAgentVote, resolveVotes } from '../../../src/core/eval/judge.js';
import type { EvalCase } from '../../../src/core/eval/set.js';
import type { Binding } from '../../../src/core/eval/spec.js';
import type { BashRunner, Spawner } from '../../../src/core/batch/engine/index.js';

const CASE: EvalCase = {
  id: 'f/x#scenario',
  feature: 'F',
  scenario: 'A scenario',
  source: 'f/x.feature',
  steps: [
    { keyword: 'Given', text: 'a project' },
    { keyword: 'Then', text: 'it works' },
  ],
};

function spawnerReturning(...stdouts: string[]): { spawner: Spawner; cwds: string[] } {
  const cwds: string[] = [];
  let i = 0;
  const spawner: Spawner = async (req) => {
    cwds.push(req.cwd);
    const stdout = stdouts[Math.min(i, stdouts.length - 1)];
    i++;
    return { exitCode: 0, signal: null, stdout, stderr: '' };
  };
  return { spawner, cwds };
}

describe('parseAgentVote', () => {
  it('parses a pass verdict with evidence', () => {
    const v = parseAgentVote('blah\n{"pass": true, "reason": "saw the file"}');
    expect(v).toEqual({ pass: true, reason: 'saw the file', hasEvidence: true });
  });

  it('fails closed when no verdict JSON is present', () => {
    const v = parseAgentVote('I think it is fine.');
    expect(v.pass).toBe(false);
    expect(v.hasEvidence).toBe(false);
  });

  it('fails closed on a pass with no evidence', () => {
    const v = parseAgentVote('{"pass": true, "reason": ""}');
    expect(v.pass).toBe(false);
    expect(v.hasEvidence).toBe(false);
  });

  it('parses a reason that itself contains braces', () => {
    const v = parseAgentVote(
      'preamble\n{"pass": true, "reason": "found config {\\"a\\": 1} in src"}'
    );
    expect(v.pass).toBe(true);
    expect(v.reason).toBe('found config {"a": 1} in src');
    expect(v.hasEvidence).toBe(true);
  });

  it('parses a multi-line reason', () => {
    const v = parseAgentVote(
      '{"pass": false, "reason": "line one\\nline two with } brace"}'
    );
    expect(v.pass).toBe(false);
    expect(v.reason).toBe('line one\nline two with } brace');
  });

  it('takes the last balanced verdict block, ignoring earlier braces', () => {
    const v = parseAgentVote(
      'notes {not json} then {"pass": false, "reason": "first"}\n{"pass": true, "reason": "final {x}"}'
    );
    expect(v.pass).toBe(true);
    expect(v.reason).toBe('final {x}');
  });

  it('fails closed when no block parses as a verdict despite braces', () => {
    const v = parseAgentVote('thoughts: {maybe} {pass?} but no JSON verdict here');
    expect(v.pass).toBe(false);
    expect(v.hasEvidence).toBe(false);
  });
});

describe('resolveVotes', () => {
  it('records a clean fail when all votes fail', () => {
    const r = resolveVotes([
      { pass: false, reason: 'missing X', hasEvidence: true },
      { pass: false, reason: 'missing X', hasEvidence: true },
    ]);
    expect(r.verdict).toBe('fail');
  });

  it('records unjudged on disagreement, never a fail', () => {
    const r = resolveVotes([
      { pass: true, reason: 'ok', hasEvidence: true },
      { pass: false, reason: 'no', hasEvidence: true },
    ]);
    expect(r.verdict).toBe('unjudged');
    expect(r.reason).toMatch(/disagree/i);
  });

  it('takes the majority on 2-of-3 pass', () => {
    const r = resolveVotes([
      { pass: true, reason: 'ok', hasEvidence: true },
      { pass: true, reason: 'ok2', hasEvidence: true },
      { pass: false, reason: 'no', hasEvidence: true },
    ]);
    expect(r.verdict).toBe('pass');
  });
});

describe('judgeCase: deterministic', () => {
  const deterministicBinding: Binding = {
    fixture: 'fx',
    kind: 'deterministic',
    check: { run: 'echo applyRequires', pass: 'contains:applyRequires' },
  };

  it('runs the command in the fixture cwd and passes on a met condition', async () => {
    let usedCwd = '';
    const bash: BashRunner = async (_cmd, cwd) => {
      usedCwd = cwd;
      return { exitCode: 0, stdout: 'has applyRequires here', stderr: '' };
    };
    const r = await judgeCase(CASE, deterministicBinding, '/fixture/copy', { bash });
    expect(usedCwd).toBe('/fixture/copy');
    expect(r.verdict).toBe('pass');
  });

  it('fails when the condition is not met', async () => {
    const bash: BashRunner = async () => ({ exitCode: 0, stdout: 'nope', stderr: '' });
    const r = await judgeCase(CASE, deterministicBinding, '/c', { bash });
    expect(r.verdict).toBe('fail');
  });

  // The judge shares evaluatePassCondition with the batch proof-of-work gate, so a
  // leading exit-zero prose condition must gate on exit status here too (not be
  // substring-matched against stdout and silently fail closed).
  it('passes a leading exit-zero prose condition on exit 0 without substring matching', async () => {
    const prose: Binding = {
      fixture: 'fx',
      kind: 'deterministic',
      check: { run: 'run-suite', pass: 'exit code 0 — new tests assert the slice works' },
    };
    const bash: BashRunner = async () => ({ exitCode: 0, stdout: 'totally unrelated output', stderr: '' });
    const r = await judgeCase(CASE, prose, '/c', { bash });
    expect(r.verdict).toBe('pass');
  });

  it('fails a leading exit-zero prose condition on a non-zero exit', async () => {
    const prose: Binding = {
      fixture: 'fx',
      kind: 'deterministic',
      check: { run: 'run-suite', pass: 'exit code 0 — new tests assert the slice works' },
    };
    const bash: BashRunner = async () => ({ exitCode: 1, stdout: '', stderr: 'boom' });
    const r = await judgeCase(CASE, prose, '/c', { bash });
    expect(r.verdict).toBe('fail');
  });
});

describe('judgeCase: llm-judge', () => {
  const llmJudgeBinding: Binding = { fixture: 'fx', kind: 'llm-judge', success: 'prints JSON' };

  it('spawns in the fixture cwd and captures the verdict', async () => {
    const { spawner, cwds } = spawnerReturning('{"pass": true, "reason": "printed JSON"}');
    const r = await judgeCase(CASE, llmJudgeBinding, '/fixture/copy', { spawner });
    expect(cwds).toEqual(['/fixture/copy']);
    expect(r.verdict).toBe('pass');
    expect(r.reason).toContain('printed JSON');
  });

  it('fails closed when the judge finds no concrete evidence', async () => {
    const { spawner } = spawnerReturning('I could not find anything conclusive.');
    const r = await judgeCase(CASE, llmJudgeBinding, '/c', { spawner });
    expect(r.verdict).toBe('fail');
    expect(r.reason).toMatch(/evidence/i);
  });

  it('judges by N repeat votes and takes the majority', async () => {
    const binding: Binding = { ...llmJudgeBinding, agentVotes: 3 };
    const { spawner, cwds } = spawnerReturning(
      '{"pass": true, "reason": "a"}',
      '{"pass": true, "reason": "b"}',
      '{"pass": false, "reason": "c"}'
    );
    const r = await judgeCase(CASE, binding, '/c', { spawner });
    expect(cwds).toHaveLength(3);
    expect(r.verdict).toBe('pass');
  });

  it('records unjudged (never fail) when repeat votes disagree', async () => {
    const binding: Binding = { ...llmJudgeBinding, agentVotes: 2 };
    const { spawner } = spawnerReturning(
      '{"pass": true, "reason": "yes"}',
      '{"pass": false, "reason": "no"}'
    );
    const r = await judgeCase(CASE, binding, '/c', { spawner });
    expect(r.verdict).toBe('unjudged');
  });
});
