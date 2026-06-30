/**
 * Unit tests for the engine-backed judge.
 *
 * Implements features/eval-judge/engine-backed-judge.feature (judging through
 * the batch engine seams), features/eval-judge/rubric-decomposition.feature
 * (per-Then-clause rubric derivation, the CoT-before-verdict/anti-sycophancy
 * prompt, and the structured all-yes-gated per-clause verdict), and the
 * vote-resolution scenarios of features/eval-judge/jury-quorum-resolution.feature
 * (symmetric majority/unanimous quorum, sub-quorum never guesses).
 */
import { describe, it, expect } from 'vitest';
import {
  judgeCase,
  deriveRubric,
  buildJudgeInstructions,
  parseAgentVote,
  resolveVotes,
  type ClauseResult,
} from '../../../src/core/eval/judge.js';
import type { EvalCase } from '../../../src/core/eval/set.js';
import type { Binding, LlmJudgeBinding } from '../../../src/core/eval/spec.js';
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

const TWO_CLAUSE_CASE: EvalCase = {
  id: 'f/x#two',
  feature: 'F',
  scenario: 'Two clauses',
  source: 'f/x.feature',
  steps: [
    { keyword: 'Given', text: 'a project' },
    { keyword: 'When', text: 'it runs' },
    { keyword: 'Then', text: 'clause one holds' },
    { keyword: 'And', text: 'clause two holds' },
  ],
};

const llmJudgeBinding = (overrides: Partial<LlmJudgeBinding> = {}): LlmJudgeBinding => ({
  fixture: 'fx',
  kind: 'llm-judge',
  success: 'prints JSON',
  ...overrides,
});

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

describe('deriveRubric', () => {
  it('derives a one-item rubric for a single Then step with no And/But', () => {
    const c: EvalCase = {
      ...CASE,
      steps: [
        { keyword: 'Given', text: 'a project' },
        { keyword: 'Then', text: 'it works' },
      ],
    };
    expect(deriveRubric(c, llmJudgeBinding())).toEqual(['it works']);
  });

  it('derives one item per Then plus each And/But step under it', () => {
    const c: EvalCase = {
      ...CASE,
      steps: [
        { keyword: 'Given', text: 'a project' },
        { keyword: 'Then', text: 'clause one' },
        { keyword: 'And', text: 'clause two' },
        { keyword: 'But', text: 'clause three' },
      ],
    };
    expect(deriveRubric(c, llmJudgeBinding())).toEqual(['clause one', 'clause two', 'clause three']);
  });

  it('excludes And/But steps rooted under Given or When', () => {
    const c: EvalCase = {
      ...CASE,
      steps: [
        { keyword: 'Given', text: 'a project' },
        { keyword: 'And', text: 'a second precondition' },
        { keyword: 'When', text: 'it runs' },
        { keyword: 'And', text: 'a second action' },
        { keyword: 'Then', text: 'it works' },
      ],
    };
    expect(deriveRubric(c, llmJudgeBinding())).toEqual(['it works']);
  });

  it('uses an explicit rubric override verbatim instead of deriving from steps', () => {
    const binding = llmJudgeBinding({ rubric: ['declared clause one', 'declared clause two'] });
    expect(deriveRubric(TWO_CLAUSE_CASE, binding)).toEqual(['declared clause one', 'declared clause two']);
  });
});

describe('buildJudgeInstructions', () => {
  it('requires reasoning before a verdict for each rubric clause and lists every clause', () => {
    const prompt = buildJudgeInstructions(TWO_CLAUSE_CASE, llmJudgeBinding());
    expect(prompt).toMatch(/reason step by step/i);
    expect(prompt).toMatch(/then state that clause's[\s\S]*verdict/i);
    expect(prompt).toContain('clause one holds');
    expect(prompt).toContain('clause two holds');
  });

  it('instructs independent judgment of evidence and a can\'t-tell answer when inconclusive', () => {
    const prompt = buildJudgeInstructions(TWO_CLAUSE_CASE, llmJudgeBinding());
    expect(prompt).toMatch(/independent judgment/i);
    expect(prompt).toMatch(/do not assume the scenario or success criteria/i);
    expect(prompt).toMatch(/can't-tell[\s\S]*inconclusive/i);
  });
});

describe('parseAgentVote', () => {
  it('returns a structured pass per clause when every clause is judged yes', () => {
    const v = parseAgentVote(
      '[{"clause": "clause one holds", "verdict": "yes", "evidence": "saw clause one"},' +
        '{"clause": "clause two holds", "verdict": "yes", "evidence": "saw clause two"}]',
      ['clause one holds', 'clause two holds']
    );
    expect(v.pass).toBe(true);
    expect(v.clauses).toEqual([
      { clause: 'clause one holds', pass: true, evidence: 'saw clause one' },
      { clause: 'clause two holds', pass: true, evidence: 'saw clause two' },
    ]);
  });

  it('fails closed on a "no" clause while preserving its cited evidence', () => {
    const v = parseAgentVote(
      '[{"clause": "clause one holds", "verdict": "yes", "evidence": "saw it"},' +
        '{"clause": "clause two holds", "verdict": "no", "evidence": "not found anywhere"}]',
      ['clause one holds', 'clause two holds']
    );
    expect(v.pass).toBe(false);
    expect(v.clauses[1]).toEqual({ clause: 'clause two holds', pass: false, evidence: 'not found anywhere' });
  });

  it('fails closed on a "can\'t-tell" clause and names the missing evidence', () => {
    const v = parseAgentVote(
      '[{"clause": "it works", "verdict": "can\'t-tell", "evidence": "could not confirm"}]',
      ['it works']
    );
    expect(v.pass).toBe(false);
    expect(v.clauses[0].pass).toBe(false);
    expect(v.clauses[0].evidence).toMatch(/could not confirm/);
  });

  it('fails closed on a clause the agent never addressed', () => {
    const v = parseAgentVote('[{"clause": "clause one holds", "verdict": "yes", "evidence": "saw it"}]', [
      'clause one holds',
      'clause two holds',
    ]);
    expect(v.pass).toBe(false);
    expect(v.clauses[1].pass).toBe(false);
    expect(v.clauses[1].evidence).toMatch(/no verdict/i);
  });

  it('passes the vote only when every clause passes', () => {
    const v = parseAgentVote(
      '[{"verdict": "yes", "evidence": "a"}, {"verdict": "yes", "evidence": "b"}, {"verdict": "yes", "evidence": "c"}]',
      ['a', 'b', 'c']
    );
    expect(v.pass).toBe(true);
  });

  it('fails the whole vote on a single failing or can\'t-tell clause among passing ones', () => {
    const v = parseAgentVote(
      '[{"verdict": "yes", "evidence": "a"}, {"verdict": "yes", "evidence": "b"}, {"verdict": "can\'t-tell", "evidence": "c"}]',
      ['a', 'b', 'c']
    );
    expect(v.pass).toBe(false);
    expect(v.clauses[2].pass).toBe(false);
  });

  it('fails closed when no verdict array is present', () => {
    const v = parseAgentVote('I think it is fine.', ['it works']);
    expect(v.pass).toBe(false);
    expect(v.clauses[0].pass).toBe(false);
  });

  it('takes the last balanced verdict array, ignoring earlier malformed brackets', () => {
    const v = parseAgentVote(
      'notes [not json] then [{"verdict": "no", "evidence": "first"}]\n' +
        '[{"verdict": "yes", "evidence": "final [x] value"}]',
      ['it works']
    );
    expect(v.pass).toBe(true);
    expect(v.clauses[0].evidence).toBe('final [x] value');
  });

  it('parses evidence text containing brackets without breaking the scan', () => {
    const v = parseAgentVote(
      'preamble\n[{"verdict": "yes", "evidence": "found config [a, b] in src"}]',
      ['it works']
    );
    expect(v.pass).toBe(true);
    expect(v.clauses[0].evidence).toBe('found config [a, b] in src');
  });
});

// Implements features/eval-judge/jury-quorum-resolution.feature's
// vote-resolution scenarios: symmetric majority/unanimous quorum, sub-quorum
// always records `unjudged` (never a guessed pass or fail).
describe('resolveVotes', () => {
  function vote(pass: boolean, evidence = 'e'): { pass: boolean; clauses: ClauseResult[] } {
    return { pass, clauses: [{ clause: 'c', pass, evidence }] };
  }

  describe('majority quorum', () => {
    it('resolves a pass on a strict majority of passing votes', () => {
      const r = resolveVotes([vote(true), vote(true), vote(false)], 'majority');
      expect(r.verdict).toBe('pass');
    });

    it('resolves a fail on a strict majority of failing votes', () => {
      const r = resolveVotes([vote(false), vote(false), vote(true)], 'majority');
      expect(r.verdict).toBe('fail');
    });

    it('does not reach quorum on a tie, naming the quorum that was not reached', () => {
      const r = resolveVotes([vote(true), vote(false)], 'majority');
      expect(r.verdict).toBe('unjudged');
      expect(r.evidence[0].evidence).toMatch(/majority quorum/i);
    });
  });

  describe('unanimous quorum', () => {
    it('resolves a pass when every vote passes', () => {
      const r = resolveVotes([vote(true), vote(true), vote(true)], 'unanimous');
      expect(r.verdict).toBe('pass');
    });

    it('resolves a fail when every vote fails', () => {
      const r = resolveVotes([vote(false), vote(false), vote(false)], 'unanimous');
      expect(r.verdict).toBe('fail');
    });

    it('does not reach quorum on any split, naming the quorum that was not reached', () => {
      const r = resolveVotes([vote(true), vote(true), vote(false)], 'unanimous');
      expect(r.verdict).toBe('unjudged');
      expect(r.evidence[0].evidence).toMatch(/unanimous quorum/i);
    });
  });

  it('defaults to majority quorum when none is given', () => {
    const r = resolveVotes([vote(true), vote(true), vote(false)]);
    expect(r.verdict).toBe('pass');
  });

  it('never records a sub-quorum result as pass or fail', () => {
    const r = resolveVotes([vote(true), vote(false)], 'majority');
    expect(r.verdict).not.toBe('pass');
    expect(r.verdict).not.toBe('fail');
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
    expect(r.evidence).toEqual([
      { clause: 'contains:applyRequires', pass: true, evidence: 'check passed (contains:applyRequires)' },
    ]);
  });

  it('fails when the condition is not met', async () => {
    const bash: BashRunner = async () => ({ exitCode: 0, stdout: 'nope', stderr: '' });
    const r = await judgeCase(CASE, deterministicBinding, '/c', { bash });
    expect(r.verdict).toBe('fail');
    expect(r.evidence[0].pass).toBe(false);
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
  const binding: Binding = llmJudgeBinding();

  it('spawns in the fixture cwd and captures the structured per-clause verdict', async () => {
    const { spawner, cwds } = spawnerReturning(
      '[{"clause": "it works", "verdict": "yes", "evidence": "printed JSON output"}]'
    );
    const r = await judgeCase(CASE, binding, '/fixture/copy', { spawner });
    expect(cwds).toEqual(['/fixture/copy']);
    expect(r.verdict).toBe('pass');
    expect(r.evidence).toEqual([{ clause: 'it works', pass: true, evidence: 'printed JSON output' }]);
  });

  it('fails closed when the judge finds no concrete evidence', async () => {
    const { spawner } = spawnerReturning('I could not find anything conclusive.');
    const r = await judgeCase(CASE, binding, '/c', { spawner });
    expect(r.verdict).toBe('fail');
    expect(r.evidence[0].evidence).toMatch(/evidence/i);
  });

  it('judges by N repeat votes and takes the majority', async () => {
    const threeVoteBinding: Binding = { ...binding, jury: { votes: 3 } };
    const { spawner, cwds } = spawnerReturning(
      '[{"verdict": "yes", "evidence": "a"}]',
      '[{"verdict": "yes", "evidence": "b"}]',
      '[{"verdict": "no", "evidence": "c"}]'
    );
    const r = await judgeCase(CASE, threeVoteBinding, '/c', { spawner });
    expect(cwds).toHaveLength(3);
    expect(r.verdict).toBe('pass');
  });

  it('records unjudged (never fail) when repeat votes disagree', async () => {
    const twoVoteBinding: Binding = { ...binding, jury: { votes: 2 } };
    const { spawner } = spawnerReturning(
      '[{"verdict": "yes", "evidence": "yes evidence"}]',
      '[{"verdict": "no", "evidence": "no evidence"}]'
    );
    const r = await judgeCase(CASE, twoVoteBinding, '/c', { spawner });
    expect(r.verdict).toBe('unjudged');
  });
});
