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

/** Build the runner environment for a branch + lint/test gate signals. */
function env(
  vars: { branch?: string; lint?: string; test?: string },
): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  if (vars.branch !== undefined) e.GITHUB_REF_NAME = vars.branch;
  if (vars.lint !== undefined) e.GATE_LINT = vars.lint;
  if (vars.test !== undefined) e.GATE_TEST = vars.test;
  return e;
}

describe('runReleaseGate', () => {
  it('ALLOWs and exits zero on a green main build, so the dry-run publish proceeds', () => {
    const result = runReleaseGate(env({ branch: 'main', lint: 'green', test: 'green' }));

    expect(result.decision.allowed).toBe(true);
    expect(result.decision.outcome).toBe(ALLOW);
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain(ALLOW);
  });

  it('DENIES and exits non-zero on a non-main branch, naming the branch', () => {
    const result = runReleaseGate(
      env({ branch: 'feature/widget', lint: 'green', test: 'green' }),
    );

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);

    const printed = result.lines.join('\n');
    expect(printed).toContain(DENY);
    expect(printed).toContain('feature/widget');
    expect(printed).toContain('not "main"');
  });

  it('DENIES and exits non-zero when a wired gate is red, naming the gate', () => {
    const result = runReleaseGate(env({ branch: 'main', lint: 'green', test: 'red' }));

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join('\n')).toContain('"test" gate is not green');
  });

  it('is fail-closed: DENIES and exits non-zero when a wired gate signal is missing', () => {
    // `test` is wired but its env var is absent entirely — fail closed.
    const result = runReleaseGate(env({ branch: 'main', lint: 'green' }));

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.outcome).toBe(DENY);
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join('\n')).toContain('"test" gate is not green');
  });
});
