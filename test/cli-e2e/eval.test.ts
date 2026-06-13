/**
 * End-to-end coverage for the `ratchet eval` command family.
 *
 * The agent judge is exercised deterministically via RATCHET_EVAL_AGENT_CMD,
 * which stands in a bash stub for the real coding-agent binary so no agent is
 * ever spawned. The stub emits a strict-JSON verdict on its last line, exactly
 * as a real judge would.
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

  // The check case passes when the fixture file contains "applyRequires".
  // The agent case is bound; its verdict comes from the stub agent at run time.
  await write(
    path.join(root, '.ratchet', 'evals', 'specs', 'cli.yaml'),
    `features/cli/status#status-as-json:
  fixture: status-ok
  kind: check
  check:
    run: cat output.txt
    pass: "contains:applyRequires"
features/cli/status#status-as-text:
  fixture: agent-fx
  kind: agent
  success: the status output is human readable text
`
  );
  return root;
}

/** Env that makes the agent judge emit a fixed verdict deterministically. */
function agentEnv(pass: boolean, reason: string): NodeJS.ProcessEnv {
  return {
    RATCHET_EVAL_AGENT_CMD: `cat >/dev/null; echo '{"pass": ${pass}, "reason": "${reason}"}'`,
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
    expect(bindings['features/cli/status#status-as-json']).toBe('check');
    expect(bindings['features/cli/status#status-as-text']).toBe('agent');
    expect(JSON.stringify(parsed)).not.toContain('archive');
  });

  it('runs --judge check: only the deterministic check is judged, agent unjudged', async () => {
    const cwd = await prepareProject();
    const res = await runCLI(['eval', 'run', '--judge', 'check', '--json'], { cwd });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.scorecard.pass).toBe(1);
    expect(parsed.scorecard.unjudged).toBe(1);
  });

  it('runs the agent judge through the stub and passes on evidence', async () => {
    const cwd = await prepareProject();
    const res = await runCLI(['eval', 'run', '--judge', 'agent', '--json'], {
      cwd,
      env: agentEnv(true, 'the output is readable text'),
    });
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    // check case is skipped under agent mode; agent case passes.
    expect(parsed.scorecard.pass).toBe(1);
    expect(parsed.scorecard.unjudged).toBe(1);
  });

  it('agent judge fails closed when the verdict carries no evidence', async () => {
    const cwd = await prepareProject();
    const run = await runCLI(['eval', 'run', '--judge', 'agent', '--json'], {
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
  kind: agent
  success: ok
  setup: echo x >> ${counter}
features/multi/m#two:
  fixture: boot
  kind: agent
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
  kind: check
  check:
    run: cat output.txt
    pass: "contains:applyRequires"
features/cli/status#status-as-text:
  fixture: agent-fx
  kind: agent
  success: readable text
  agentVotes: 2
`
    );
    const stub = `cat >/dev/null; n=$(cat ${counter} 2>/dev/null || echo 0); echo $((n+1)) > ${counter}; if [ "$n" = "0" ]; then echo '{"pass": true, "reason": "looks good"}'; else echo '{"pass": false, "reason": "actually broken"}'; fi`;
    const run = await runCLI(['eval', 'run', '--judge', 'agent', '--json'], {
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
    const run = await runCLI(['eval', 'run', '--judge', 'check', '--json'], { cwd });
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
    // First run: check passes. Promote it as baseline.
    const first = await runCLI(['eval', 'run', '--judge', 'check', '--json'], { cwd });
    const baseId = JSON.parse(first.stdout).runId;
    const promote = await runCLI(['eval', 'baseline', baseId], { cwd });
    expect(promote.exitCode).toBe(0);

    // Break the fixture so the check now fails, then run again.
    await write(
      path.join(cwd, '.ratchet', 'evals', 'fixtures', 'status-ok', 'output.txt'),
      'nothing useful here\n'
    );
    const second = await runCLI(['eval', 'run', '--judge', 'check', '--json'], { cwd });
    const curId = JSON.parse(second.stdout).runId;

    const report = await runCLI(['eval', 'report', '--run', curId, '--json'], { cwd });
    const parsed = JSON.parse(report.stdout);
    expect(parsed.diff.regressions).toContain('features/cli/status#status-as-json');
    expect(parsed.overall).toBe('fail');
  });
});
