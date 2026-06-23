import { describe, it, expect } from 'vitest';
import {
  decideRelease,
  ALLOW,
  DENY,
  type GateSignal,
  type ReleaseDecisionInput,
} from '../../src/core/ci/release-decision.js';

/**
 * The release-decision module is the "only when green" spine: ALLOW iff
 * branch === 'main' AND every wired gate is explicitly green, otherwise DENY
 * with a precise reason per failure. These tests exercise every branch of that
 * rule, including the fail-closed posture on missing signals.
 */

/** Build an input for the lint+test gates wired in this phase. */
function input(
  branch: string,
  gates: Record<string, GateSignal | undefined>,
): ReleaseDecisionInput {
  return { branch, gates };
}

describe('decideRelease', () => {
  it('DENIES on a non-main branch even when every gate is green', () => {
    const decision = decideRelease(
      input('feature/widget', { lint: 'green', test: 'green' }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.outcome).toBe(DENY);
    // Names the offending branch so the workflow can surface why.
    expect(decision.reasons).toContainEqual(
      expect.stringContaining('not "main"'),
    );
    expect(decision.reasons).toContainEqual(
      expect.stringContaining('feature/widget'),
    );
  });

  it('DENIES on main when the lint gate is red', () => {
    const decision = decideRelease(input('main', { lint: 'red', test: 'green' }));

    expect(decision.allowed).toBe(false);
    expect(decision.outcome).toBe(DENY);
    expect(decision.reasons).toContainEqual(
      expect.stringContaining('"lint" gate is not green'),
    );
  });

  it('DENIES on main when the test gate is red', () => {
    const decision = decideRelease(input('main', { lint: 'green', test: 'red' }));

    expect(decision.allowed).toBe(false);
    expect(decision.outcome).toBe(DENY);
    expect(decision.reasons).toContainEqual(
      expect.stringContaining('"test" gate is not green'),
    );
  });

  it('DENIES on main when both lint and test are red and reports both', () => {
    const decision = decideRelease(input('main', { lint: 'red', test: 'red' }));

    expect(decision.allowed).toBe(false);
    expect(decision.outcome).toBe(DENY);
    expect(decision.reasons).toContainEqual(
      expect.stringContaining('"lint" gate is not green'),
    );
    expect(decision.reasons).toContainEqual(
      expect.stringContaining('"test" gate is not green'),
    );
  });

  it('ALLOWS only on a green main build, with no denial reasons', () => {
    const decision = decideRelease(input('main', { lint: 'green', test: 'green' }));

    expect(decision.allowed).toBe(true);
    expect(decision.outcome).toBe(ALLOW);
    expect(decision.reasons).toEqual([]);
  });

  it('is fail-closed: an EMPTY gate set DENIES on main (nothing proves green)', () => {
    // With no wired gates the per-gate loop has nothing to reject; an empty set
    // must DENY rather than ALLOW, so the gate can never be silently opened.
    const decision = decideRelease(input('main', {}));

    expect(decision.allowed).toBe(false);
    expect(decision.outcome).toBe(DENY);
    expect(decision.reasons).toContainEqual(
      expect.stringContaining('no wired gates'),
    );
  });

  it('is fail-closed: a missing wired gate signal DENIES', () => {
    // `test` is wired (its key is present) but carries no signal — fail closed.
    const decision = decideRelease(input('main', { lint: 'green', test: undefined }));

    expect(decision.allowed).toBe(false);
    expect(decision.outcome).toBe(DENY);
    expect(decision.reasons).toContainEqual(
      expect.stringContaining('"test" gate is not green'),
    );
  });

  it('is extensible: an additional wired gate must also be green to ALLOW', () => {
    // `coverage` is wired by adding one more signal — no core-logic change.
    const denied = decideRelease(
      input('main', { lint: 'green', test: 'green', coverage: 'red' }),
    );
    expect(denied.allowed).toBe(false);
    expect(denied.outcome).toBe(DENY);
    expect(denied.reasons).toContainEqual(
      expect.stringContaining('"coverage" gate is not green'),
    );

    // The same shape ALLOWS once the extra gate is green too.
    const allowed = decideRelease(
      input('main', { lint: 'green', test: 'green', coverage: 'green' }),
    );
    expect(allowed.allowed).toBe(true);
    expect(allowed.outcome).toBe(ALLOW);
    expect(allowed.reasons).toEqual([]);
  });
});
