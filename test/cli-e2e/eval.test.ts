/**
 * End-to-end coverage for the `ratchet eval` command family.
 *
 * The agent judge is exercised deterministically via RATCHET_EVAL_AGENT_CMD,
 * which stands in a bash stub for the real coding-agent binary so no agent is
 * ever spawned. The stub emits a strict-JSON per-clause verdict array on its
 * last line, exactly as a real judge would. Every llm-judge-bound scenario in
 * this file has a single `Then` step, so the rubric is always one clause.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI } from '../helpers/run-cli.js';

const tempRoots: string[] = [];

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

const STATUS_FEATURE = `Feature: Status
  Scenario: Status as JSON
    Given a project
    When I run status
    Then it prints JSON

  Scenario: Status as text
    Given a project
    Then it prints text
`;

/** A project with a check binding, an agent binding, and one unbound case. */
async function prepareProject(): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-eval-e2e-'));
  tempRoots.push(base);
  const root = path.join(base, 'project');
  await write(path.join(root, '.ratchet', 'config.yaml'), 'schema: ratchet\n');
  await write(path.join(root, '.ratchet', 'features', 'cli', 'status.feature'), STATUS_FEATURE);

  // Fixture for the deterministic check: a marker file the check greps for.
  await write(
    path.join(root, '.ratchet', 'evals', 'fixtures', 'status-ok', 'output.txt'),
    'applyRequires: plan\n'
  );
  // Fixture for the agent judge.
  await write(
    path.join(root, '.ratchet', 'evals', 'fixtures', 'agent-fx', 'README.md'),
    'a codebase\n'
  );

  // The deterministic case passes when the fixture file contains "applyRequires".
  // The llm-judge case is bound; its verdict comes from the stub agent at run time.
  await write(
    path.join(root, '.ratchet', 'evals', 'specs', 'cli.yaml'),
    `features/cli/status#status-as-json:
  fixture: status-ok
  kind: deterministic
  check:
    run: cat output.txt
    pass: "contains:applyRequires"
features/cli/status#status-as-text:
  fixture: agent-fx
  kind: llm-judge
  success: the status output is human readable text
`
  );
  return root;
}

/** Env that makes the agent judge emit a fixed single-clause verdict deterministically. */
function agentEnv(pass: boolean, evidence: string): NodeJS.ProcessEnv {
  return {
    RATCHET_EVAL_AGENT_CMD: `cat >/dev/null; echo '[{"verdict": "${pass ? 'yes' : 'no'}", "evidence": "${evidence}"}]'`,
  };
}

afterAll(async () => {
  await Promise.all(tempRoots.map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('ratchet eval CLI e2e', () => {
  it('enumerates cases with binding status and excludes the archive', async () => {
    const cwd = await prepareProject();
    await write(
      path.join(cwd, '.ratchet', 'changes', 'archive', 'old', 'features', 'o.feature'),
      'Feature: Old\n  Scenario: Old\n    Given x\n    Then y\n'
    );
    const res = await runCLI(['eval', 'set', '--json'], { cwd });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.count).toBe(2);
    const bindings = Object.fromEntries(parsed.cases.map((c: any) => [c.id, c.binding]));
    expect(bindings['features/cli/status#status-as-json']).toBe('deterministic');
    expect(bindings['features/cli/status#status-as-text']).toBe('llm-judge');
    expect(JSON.stringify(parsed)).not.toContain('archive');
  });

  it('runs --judge deterministic: only the deterministic check is judged, llm-judge unjudged', async () => {
    const cwd = await prepareProject();
    const res = await runCLI(['eval', 'run', '--judge', 'deterministic', '--json'], { cwd });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.scorecard.pass).toBe(1);
    expect(parsed.scorecard.unjudged).toBe(1);
  });

  it('surfaces the aggregated overall verdict and contributor breakdown', async () => {
    const cwd = await prepareProject();
    // Break the deterministic fixture so its contributor fails the run.
    await write(
      path.join(cwd, '.ratchet', 'evals', 'fixtures', 'status-ok', 'output.txt'),
      'nothing useful here\n'
    );
    const json = await runCLI(['eval', 'run', '--judge', 'deterministic', '--json'], { cwd });
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.overall).toBe('fail');
    const det = parsed.contributors.find((c: { id: string }) => c.id === 'deterministic');
    expect(det.status).toBe('fail');
    expect(det.failing).toContain('features/cli/status#status-as-json');

    // The text rendering reports the verdict and breaks it down by contributor.
    const text = await runCLI(['eval', 'run', '--judge', 'deterministic'], { cwd });
    expect(text.stdout).toContain('[FAIL]');
    expect(text.stdout).toContain('Contributors:');
    expect(text.stdout).toContain('deterministic:');
  });

  // features/eval-contributor-gate/* — the contributor gate is driven from the
  // CLI on the built binary: --no-llm-judge / --only disable a contributor so its
  // cases go unjudged and the run is incomplete; an unknown id is rejected.
  it('runs --no-llm-judge: the llm-judge case is unjudged and the run incomplete', async () => {
    const cwd = await prepareProject();
    const res = await runCLI(['eval', 'run', '--no-llm-judge', '--json'], { cwd });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    // deterministic check passes; the llm-judge case is left unjudged (disabled).
    expect(parsed.scorecard.pass).toBe(1);
    expect(parsed.scorecard.unjudged).toBe(1);
    expect(parsed.scorecard.complete).toBe(false);
    // The persisted run records the enabled set without llm-judge.
    const run = JSON.parse(
      await fs.readFile(
        path.join(cwd, '.ratchet', 'evals', 'runs', `${parsed.runId}.json`),
        'utf-8'
      )
    );
    expect(run.gate).toEqual(['deterministic', 'invariants', 'regression']);
    expect(run.verdicts['features/cli/status#status-as-text'].verdict).toBe('unjudged');
    expect(run.verdicts['features/cli/status#status-as-text'].reason.toLowerCase()).toContain(
      'llm-judge'
    );
  });

  it('runs --only deterministic: only the deterministic contributor executes', async () => {
    const cwd = await prepareProject();
    const res = await runCLI(['eval', 'run', '--only', 'deterministic', '--json'], { cwd });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.scorecard.pass).toBe(1);
    expect(parsed.scorecard.unjudged).toBe(1);
    expect(parsed.contributors.map((c: { id: string }) => c.id)).toEqual(['deterministic']);
  });

  it('rejects --only with an unknown contributor id, listing the valid ids', async () => {
    const cwd = await prepareProject();
    const res = await runCLI(['eval', 'run', '--only', 'not-a-contributor', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const out = `${res.stdout}${res.stderr}`;
    expect(out).toContain('not-a-contributor');
    expect(out).toContain('deterministic, llm-judge, invariants, regression');
  });

  // features/eval-invariants/contributor.feature — the invariant gate runs on the
  // built CLI: an active violated invariant fails the run and is surfaced first
  // as a sibling to regression; --no-invariants disables the contributor.
  it('fails the run on an active violated invariant, surfacing it first', async () => {
    const cwd = await prepareProject();
    // An active deterministic invariant whose predicate fails (non-zero exit).
    await write(
      path.join(cwd, '.ratchet', 'evals', 'invariants.yaml'),
      'invariants:\n  - id: tests-still-exist\n    kind: deterministic\n    active: true\n    check:\n      run: "exit 1"\n      pass: exit-zero\n'
    );
    const json = await runCLI(['eval', 'run', '--judge', 'deterministic', '--json'], { cwd });
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.overall).toBe('fail');
    const inv = parsed.contributors.find((c: { id: string }) => c.id === 'invariants');
    expect(inv.status).toBe('fail');
    expect(inv.failing).toContain('tests-still-exist');
    expect(parsed.invariants.map((o: { id: string }) => o.id)).toContain('tests-still-exist');

    // The text rendering surfaces the invariant violation ahead of the breakdown.
    const text = await runCLI(['eval', 'run', '--judge', 'deterministic'], { cwd });
    expect(text.stdout).toContain('[FAIL]');
    expect(text.stdout).toContain('INVARIANT VIOLATIONS');
    expect(text.stdout).toContain('tests-still-exist');
    expect(text.stdout.indexOf('INVARIANT VIOLATIONS')).toBeLessThan(
      text.stdout.indexOf('Contributors:')
    );
  });

  it('disables the invariant gate under --no-invariants', async () => {
    const cwd = await prepareProject();
    await write(
      path.join(cwd, '.ratchet', 'evals', 'invariants.yaml'),
      'invariants:\n  - id: tests-still-exist\n    kind: deterministic\n    active: true\n    check:\n      run: "exit 1"\n      pass: exit-zero\n'
    );
    const res = await runCLI(
      ['eval', 'run', '--judge', 'deterministic', '--no-invariants', '--json'],
      { cwd }
    );
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    // The invariants contributor is dropped, so the violated invariant is never
    // evaluated and the deterministic-only run passes.
    expect(parsed.contributors.map((c: { id: string }) => c.id)).not.toContain('invariants');
    expect(parsed.invariants).toEqual([]);
    expect(parsed.overall).toBe('pass');
    const run = JSON.parse(
      await fs.readFile(
        path.join(cwd, '.ratchet', 'evals', 'runs', `${parsed.runId}.json`),
        'utf-8'
      )
    );
    expect(run.gate).not.toContain('invariants');
  });

  it('runs the agent judge through the stub and passes on evidence', async () => {
    const cwd = await prepareProject();
    const res = await runCLI(['eval', 'run', '--judge', 'llm-judge', '--json'], {
      cwd,
      env: agentEnv(true, 'the output is readable text'),
    });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    // deterministic case is skipped under llm-judge mode; llm-judge case passes.
    expect(parsed.scorecard.pass).toBe(1);
    expect(parsed.scorecard.unjudged).toBe(1);
  });

  it('agent judge fails closed when the verdict carries no evidence', async () => {
    const cwd = await prepareProject();
    const run = await runCLI(['eval', 'run', '--judge', 'llm-judge', '--json'], {
      cwd,
      env: { RATCHET_EVAL_AGENT_CMD: `cat >/dev/null; echo 'I am not sure either way.'` },
    });
    const runId = JSON.parse(run.stdout).runId;
    const report = await runCLI(['eval', 'report', '--run', runId, '--json'], { cwd });
    const parsed = JSON.parse(report.stdout);
    expect(parsed.scorecard.fail).toBe(1);
    expect(parsed.failing[0].evidence.toLowerCase()).toContain('evidence');
  });

  it('a one-time fixture setup is reused across cases', async () => {
    const cwd = await prepareProject();
    // Two agent cases bound to the same fixture with a setup that appends to a
    // host-side counter; setup must run exactly once.
    const counter = path.join(cwd, 'setup-count.txt');
    await write(
      path.join(cwd, '.ratchet', 'features', 'multi', 'm.feature'),
      'Feature: Multi\n  Scenario: One\n    Given a\n    Then b\n  Scenario: Two\n    Given a\n    Then b\n'
    );
    await write(
      path.join(cwd, '.ratchet', 'evals', 'fixtures', 'boot', 'x.txt'),
      '1\n'
    );
    await write(
      path.join(cwd, '.ratchet', 'evals', 'specs', 'multi.yaml'),
      `features/multi/m#one:
  fixture: boot
  kind: llm-judge
  success: ok
  setup: echo x >> ${counter}
features/multi/m#two:
  fixture: boot
  kind: llm-judge
  success: ok
  setup: echo x >> ${counter}
`
    );
    // Scope to the multi feature so both its cases (same fixture) run; setup
    // must bootstrap the fixture exactly once and be reused for the second case.
    const run = await runCLI(['eval', 'run', '--path', 'multi', '--json'], {
      cwd,
      env: agentEnv(true, 'fine'),
    });
    expect(run.exitCode).toBe(0);
    const lines = (await fs.readFile(counter, 'utf-8')).trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('agent vote disagreement is recorded unjudged, never a fail', async () => {
    const cwd = await prepareProject();
    // Rebind the agent case to cast 2 votes; a host-side counter makes the stub
    // emit pass then fail, so the votes disagree.
    const counter = path.join(cwd, 'vote-count.txt');
    await write(
      path.join(cwd, '.ratchet', 'evals', 'specs', 'cli.yaml'),
      `features/cli/status#status-as-json:
  fixture: status-ok
  kind: deterministic
  check:
    run: cat output.txt
    pass: "contains:applyRequires"
features/cli/status#status-as-text:
  fixture: agent-fx
  kind: llm-judge
  success: readable text
  jury:
    votes: 2
`
    );
    const stub = `cat >/dev/null; n=$(cat ${counter} 2>/dev/null || echo 0); echo $((n+1)) > ${counter}; if [ "$n" = "0" ]; then echo '[{"verdict": "yes", "evidence": "looks good"}]'; else echo '[{"verdict": "no", "evidence": "actually broken"}]'; fi`;
    const run = await runCLI(['eval', 'run', '--judge', 'llm-judge', '--json'], {
      cwd,
      env: { RATCHET_EVAL_AGENT_CMD: stub },
    });
    const runId = JSON.parse(run.stdout).runId;
    const report = await runCLI(['eval', 'report', '--run', runId, '--json'], { cwd });
    const parsed = JSON.parse(report.stdout);
    expect(parsed.scorecard.fail).toBe(0);
    expect(parsed.unjudgedCases).toContain('features/cli/status#status-as-text');
  });

  it('records a manual override and rejects a fail without evidence', async () => {
    const cwd = await prepareProject();
    const run = await runCLI(['eval', 'run', '--judge', 'deterministic', '--json'], { cwd });
    const runId = JSON.parse(run.stdout).runId;
    const caseId = 'features/cli/status#status-as-text'; // the unjudged agent case

    const ok = await runCLI(
      ['eval', 'record', '--run', runId, '--case', caseId, '--verdict', 'pass', '--evidence', 'by hand'],
      { cwd }
    );
    expect(ok.exitCode).toBe(0);

    const bad = await runCLI(
      ['eval', 'record', '--run', runId, '--case', caseId, '--verdict', 'fail'],
      { cwd }
    );
    expect(bad.exitCode).not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`.toLowerCase()).toContain('evidence');

    const report = await runCLI(['eval', 'report', '--run', runId, '--json'], { cwd });
    const parsed = JSON.parse(report.stdout);
    // The manual pass took effect (and the bad fail was rejected).
    expect(parsed.scorecard.pass).toBe(2);
  });

  it('promotes a baseline and flags a regression on a later run', async () => {
    const cwd = await prepareProject();
    // First run in auto mode so BOTH cases are judged — a complete run. Only a
    // complete run can be promoted (the aggregation completeness guard).
    const first = await runCLI(['eval', 'run', '--json'], {
      cwd,
      env: agentEnv(true, 'the output is readable text'),
    });
    const baseId = JSON.parse(first.stdout).runId;
    const promote = await runCLI(['eval', 'baseline', baseId], { cwd });
    expect(promote.exitCode).toBe(0);

    // Break the fixture so the check now fails, then run again (still complete).
    await write(
      path.join(cwd, '.ratchet', 'evals', 'fixtures', 'status-ok', 'output.txt'),
      'nothing useful here\n'
    );
    const second = await runCLI(['eval', 'run', '--json'], {
      cwd,
      env: agentEnv(true, 'the output is readable text'),
    });
    const curId = JSON.parse(second.stdout).runId;

    const report = await runCLI(['eval', 'report', '--run', curId, '--json'], { cwd });
    const parsed = JSON.parse(report.stdout);
    expect(parsed.diff.regressions).toContain('features/cli/status#status-as-json');
    expect(parsed.overall).toBe('fail');
  });

  it('rejects promoting an incomplete run and leaves the baseline unchanged', async () => {
    const cwd = await prepareProject();
    // --judge deterministic leaves the llm-judge case unjudged → incomplete run.
    const run = await runCLI(['eval', 'run', '--judge', 'deterministic', '--json'], { cwd });
    const runId = JSON.parse(run.stdout).runId;
    expect(JSON.parse(run.stdout).scorecard.unjudged).toBe(1);

    const promote = await runCLI(['eval', 'baseline', runId], { cwd });
    expect(promote.exitCode).not.toBe(0);
    expect(`${promote.stdout}${promote.stderr}`.toLowerCase()).toContain('incomplete');

    // No baseline file was written.
    const baselineExists = await fs
      .access(path.join(cwd, '.ratchet', 'evals', 'baseline.json'))
      .then(() => true)
      .catch(() => false);
    expect(baselineExists).toBe(false);
  });

  // features/eval-judge/skip-filters.feature — skip filters run on the built
  // CLI: an in-file @skip tag and a project eval.skip pattern both exclude a
  // case from judging by default, --include-skipped overrides both sources, a
  // run with only skipped/judged cases still promotes to baseline, and skipping
  // a previously-passing baseline case prints a visible warning.
  it('records a @skip-tagged scenario with no binding as skipped, not unjudged, with no fixture/agent', async () => {
    const cwd = await prepareProject();
    await write(
      path.join(cwd, '.ratchet', 'features', 'skip', 's.feature'),
      'Feature: Skip\n  @skip\n  Scenario: Tag skipped\n    Given a\n    Then b\n'
    );
    const res = await runCLI(['eval', 'run', '--path', 'skip', '--json'], { cwd });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.scorecard).toMatchObject({ total: 1, pass: 0, fail: 0, unjudged: 0, skipped: 1 });
    const run = JSON.parse(
      await fs.readFile(path.join(cwd, '.ratchet', 'evals', 'runs', `${parsed.runId}.json`), 'utf-8')
    );
    expect(run.verdicts['features/skip/s#tag-skipped'].verdict).toBe('skipped');
  });

  it('excludes a case matching an eval.skip config pattern without ever materializing its fixture', async () => {
    const cwd = await prepareProject();
    await write(
      path.join(cwd, '.ratchet', 'config.yaml'),
      'schema: ratchet\neval:\n  skip:\n    - "features/cli/status#status-as-json"\n'
    );
    // Rebind the deterministic case to a command that fails if it ever runs —
    // proving the skip short-circuits before fixture materialization/judging.
    await write(
      path.join(cwd, '.ratchet', 'evals', 'specs', 'cli.yaml'),
      `features/cli/status#status-as-json:
  fixture: status-ok
  kind: deterministic
  check:
    run: "exit 1"
    pass: exit-zero
features/cli/status#status-as-text:
  fixture: agent-fx
  kind: llm-judge
  success: the status output is human readable text
`
    );
    const res = await runCLI(['eval', 'run', '--judge', 'deterministic', '--json'], { cwd });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.scorecard.skipped).toBe(1);
    const det = parsed.contributors.find((c: { id: string }) => c.id === 'deterministic');
    expect(det.status).toBe('pass');
  });

  it('--include-skipped judges cases that would otherwise be excluded by either skip source', async () => {
    const cwd = await prepareProject();
    await write(
      path.join(cwd, '.ratchet', 'features', 'skip', 's.feature'),
      'Feature: Skip\n  @skip\n  Scenario: Tag skipped\n    Given a\n    Then b\n'
    );
    await write(
      path.join(cwd, '.ratchet', 'evals', 'specs', 'skip.yaml'),
      `features/skip/s#tag-skipped:
  fixture: status-ok
  kind: deterministic
  check:
    run: cat output.txt
    pass: "contains:applyRequires"
`
    );
    await write(
      path.join(cwd, '.ratchet', 'config.yaml'),
      'schema: ratchet\neval:\n  skip:\n    - "features/cli/status#status-as-json"\n'
    );
    const res = await runCLI(
      ['eval', 'run', '--judge', 'deterministic', '--include-skipped', '--json'],
      { cwd }
    );
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.scorecard.skipped).toBe(0);
    // Both the config-skipped and tag-skipped cases are now judged normally.
    expect(parsed.scorecard.pass).toBe(2);
  });

  it('promotes a baseline run whose only non-pass case is skipped (none unjudged)', async () => {
    const cwd = await prepareProject();
    await write(
      path.join(cwd, '.ratchet', 'config.yaml'),
      'schema: ratchet\neval:\n  skip:\n    - "features/cli/status#status-as-text"\n'
    );
    const res = await runCLI(['eval', 'run', '--json'], { cwd });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.scorecard).toMatchObject({ unjudged: 0, skipped: 1, complete: true });
    const promote = await runCLI(['eval', 'baseline', parsed.runId], { cwd });
    expect(promote.exitCode).toBe(0);
  });

  it('warns when a case that was pass in the baseline is now skipped', async () => {
    const cwd = await prepareProject();
    const first = await runCLI(['eval', 'run', '--json'], {
      cwd,
      env: agentEnv(true, 'the output is readable text'),
    });
    const baseId = JSON.parse(first.stdout).runId;
    const promote = await runCLI(['eval', 'baseline', baseId], { cwd });
    expect(promote.exitCode).toBe(0);

    await write(
      path.join(cwd, '.ratchet', 'config.yaml'),
      'schema: ratchet\neval:\n  skip:\n    - "features/cli/status#status-as-json"\n'
    );
    const json = await runCLI(['eval', 'run', '--json'], {
      cwd,
      env: agentEnv(true, 'the output is readable text'),
    });
    expect(json.exitCode).toBe(0);
    const parsedWarnings: string[] = JSON.parse(json.stdout).warnings;
    expect(
      parsedWarnings.some(
        (w) => w.includes('features/cli/status#status-as-json') && w.toLowerCase().includes('skipped')
      )
    ).toBe(true);

    const text = await runCLI(['eval', 'run'], { cwd, env: agentEnv(true, 'the output is readable text') });
    expect(text.stdout).toContain('warn:');
    expect(text.stdout).toContain('features/cli/status#status-as-json');
  });

  // features/eval-judge/structured-evidence-persistence.feature — both `eval
  // run --json` and `eval report --json` surface the run JSON's per-case
  // structured detail: a judged case's rubric/clauses/votes and a skipped
  // case's skip source/detail.
  it('eval run --json and eval report --json both include cases[] with structured per-case detail', async () => {
    const cwd = await prepareProject();
    await write(
      path.join(cwd, '.ratchet', 'features', 'skip', 's.feature'),
      'Feature: Skip\n  @skip\n  Scenario: Tag skipped\n    Given a\n    Then b\n'
    );
    const run = await runCLI(['eval', 'run', '--json'], {
      cwd,
      env: agentEnv(true, 'the output is readable text'),
    });
    expect(run.exitCode).toBe(0);
    const runParsed = JSON.parse(run.stdout);
    expect(Array.isArray(runParsed.cases)).toBe(true);

    const judged = runParsed.cases.find((c: { id: string }) => c.id === 'features/cli/status#status-as-text');
    expect(judged.verdict).toBe('pass');
    expect(judged.rubric).toEqual(['it prints text']);
    expect(judged.clauses).toEqual([
      { clause: 'it prints text', pass: true, evidence: 'the output is readable text' },
    ]);
    expect(judged.votes).toEqual([{ pass: true, clauses: judged.clauses }]);

    const skipped = runParsed.cases.find((c: { id: string }) => c.id === 'features/skip/s#tag-skipped');
    expect(skipped.verdict).toBe('skipped');
    expect(skipped.skip).toEqual({ source: 'tag', detail: 'features/skip/s.feature' });

    const report = await runCLI(['eval', 'report', '--run', runParsed.runId, '--json'], { cwd });
    expect(report.exitCode).toBe(0);
    const reportParsed = JSON.parse(report.stdout);
    const judgedFromReport = reportParsed.cases.find(
      (c: { id: string }) => c.id === 'features/cli/status#status-as-text'
    );
    expect(judgedFromReport.rubric).toEqual(['it prints text']);
    expect(judgedFromReport.votes).toEqual(judged.votes);
    const skippedFromReport = reportParsed.cases.find(
      (c: { id: string }) => c.id === 'features/skip/s#tag-skipped'
    );
    expect(skippedFromReport.skip).toEqual({ source: 'tag', detail: 'features/skip/s.feature' });
  });
});
