import { describe, it, expect } from 'vitest';
import { runReleaseGate } from '../../src/core/ci/release-gate.js';
import { ALLOW, DENY } from '../../src/core/ci/release-decision.js';

/**
 * The release-gate runner is the thin bridge between the workflow's environment
 * and the pure release-decision module. These tests feed it an environment and
 * assert its decision, exit code, and printed reasons — no Actions runner or
 * child process needed. The "only when green" rule itself is proven in
 * release-decision.test.ts; here we prove the runner adapts and reports it.
 */

/**
 * Build the runner environment for a branch + the five wired gate signals
 * (`lint`, `test`, `coverage`, `e2e`, `security`). Any omitted gate has its env
 * var absent entirely, exercising the fail-closed path.
 */
function env(
  vars: {
    branch?: string;
    lint?: string;
    test?: string;
    coverage?: string;
    e2e?: string;
    security?: string;
  },
): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  if (vars.branch !== undefined) e.GITHUB_REF_NAME = vars.branch;
  if (vars.lint !== undefined) e.GATE_LINT = vars.lint;
  if (vars.test !== undefined) e.GATE_TEST = vars.test;
  if (vars.coverage !== undefined) e.GATE_COVERAGE = vars.coverage;
  if (vars.e2e !== undefined) e.GATE_E2E = vars.e2e;
  if (vars.security !== undefined) e.GATE_SECURITY = vars.security;
  return e;
}

/** An all-green main environment — the only configuration that ALLOWs. */
function allGreenMain(): NodeJS.ProcessEnv {
  return env({
    branch: 'main',
    lint: 'green',
    test: 'green',
    coverage: 'green',
    e2e: 'green',
    security: 'green',
  });
}

describe('runReleaseGate', () => {
  it('ALLOWs and exits zero only when branch is main and all five gates are green', () => {
    const result = runReleaseGate(allGreenMain());

    expect(result.decision.allowed).toBe(true);
    expect(result.decision.outcome).toBe(ALLOW);
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain(ALLOW);
  });

  it('DENIES and exits non-zero on a non-main branch, naming the branch', () => {
    const result = runReleaseGate(
      env({
        branch: 'feature/widget',
        lint: 'green',
        test: 'green',
        coverage: 'green',
        e2e: 'green',
        security: 'green',
      }),
    );

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);

    const printed = result.lines.join('\n');
    expect(printed).toContain(DENY);
    expect(printed).toContain('feature/widget');
    expect(printed).toContain('not "main"');
  });

  it('DENIES and exits non-zero when the test gate is red, naming the gate', () => {
    const result = runReleaseGate(
      env({ branch: 'main', lint: 'green', test: 'red', coverage: 'green', e2e: 'green', security: 'green' }),
    );

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join('\n')).toContain('"test" gate is not green');
  });

  it('DENIES and exits non-zero when the coverage gate is red, naming the gate', () => {
    const result = runReleaseGate(
      env({ branch: 'main', lint: 'green', test: 'green', coverage: 'red', e2e: 'green', security: 'green' }),
    );

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join('\n')).toContain('"coverage" gate is not green');
  });

  it('DENIES and exits non-zero when the e2e gate is red, naming the gate', () => {
    const result = runReleaseGate(
      env({ branch: 'main', lint: 'green', test: 'green', coverage: 'green', e2e: 'red', security: 'green' }),
    );

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join('\n')).toContain('"e2e" gate is not green');
  });

  it('DENIES and exits non-zero when the security gate is red, naming the gate', () => {
    const result = runReleaseGate(
      env({ branch: 'main', lint: 'green', test: 'green', coverage: 'green', e2e: 'green', security: 'red' }),
    );

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join('\n')).toContain('"security" gate is not green');
  });

  it('is fail-closed: DENIES when the coverage signal is missing entirely', () => {
    // `coverage` is wired but its env var is absent — fail closed.
    const result = runReleaseGate(
      env({ branch: 'main', lint: 'green', test: 'green', e2e: 'green', security: 'green' }),
    );

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join('\n')).toContain('"coverage" gate is not green');
  });

  it('is fail-closed: DENIES when the e2e signal is missing entirely', () => {
    // `e2e` is wired but its env var is absent — fail closed.
    const result = runReleaseGate(
      env({ branch: 'main', lint: 'green', test: 'green', coverage: 'green', security: 'green' }),
    );

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join('\n')).toContain('"e2e" gate is not green');
  });

  it('is fail-closed: DENIES when the security signal is missing entirely', () => {
    // `security` is wired but its env var is absent — fail closed.
    const result = runReleaseGate(
      env({ branch: 'main', lint: 'green', test: 'green', coverage: 'green', e2e: 'green' }),
    );

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join('\n')).toContain('"security" gate is not green');
  });
});
