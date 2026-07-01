/**
 * Integration tests for the `ratchet eval run` verb.
 *
 * Implements features/eval-command-tests/run.feature: running an unbound set
 * persists a run under `.ratchet/evals/runs/` and reports the case as unjudged
 * with the "Run is incomplete" notice (text), emits `{ runId, scorecard,
 * warnings }` (--json), and rejects an invalid --judge before any run is
 * persisted. It also covers features/eval-contributor-gate/disabled-contributor-incompleteness.feature:
 * a case bound to a disabled contributor is recorded `unjudged` (the reason
 * names the contributor) without executing, leaving the run incomplete and the
 * enabled set persisted on the run. The run is exercised over unbound /
 * disabled cases so the engine records `unjudged` without ever spawning a coding
 * agent (the agent seam is covered by test/cli-e2e/eval.test.ts). The verb is
 * pointed at an isolated tmpdir fixture
 * by mocking `resolveCurrentPlanningHomeSync`; console.log is spied and the
 * fixture removed in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { makeEvalFixture, type EvalFixture } from './eval-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { evalRunCommand } from '../../../src/commands/eval/run.js';

const SOLO_FEATURE = `Feature: Solo
  Scenario: Only case
    Given a precondition
    Then an outcome
`;
const SOLO_CASE = 'features/solo#only-case';

describe('evalRunCommand', () => {
  let fixture: EvalFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeEvalFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    await fixture.writeFeature('solo.feature', SOLO_FEATURE);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  async function persistedRunIds(): Promise<string[]> {
    const dir = path.join(fixture.root, '.ratchet', 'evals', 'runs');
    try {
      return (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  }

  it('persists an incomplete, unjudged run and prints the incomplete notice', async () => {
    await evalRunCommand({});

    const runs = await persistedRunIds();
    expect(runs).toHaveLength(1);

    const text = output();
    expect(text).toContain('1 unjudged');
    expect(text).toContain('Run is incomplete');
    // The aggregated overall verdict and the per-contributor breakdown render.
    expect(text).toContain('[PASS]');
    expect(text).toContain('Contributors:');
    expect(text).toContain('deterministic:');
    expect(text).toContain('regression:');
  });

  it('emits the runId, scorecard, and warnings as JSON', async () => {
    await evalRunCommand({ json: true });
    const parsed = JSON.parse(output());

    expect(typeof parsed.runId).toBe('string');
    expect(parsed.runId.length).toBeGreaterThan(0);
    expect(parsed.scorecard).toMatchObject({
      total: 1,
      pass: 0,
      fail: 0,
      unjudged: 1,
      complete: false,
    });
    // The aggregated overall verdict and contributor breakdown are emitted.
    expect(parsed.overall).toBe('pass');
    expect(parsed.contributors.map((c: { id: string }) => c.id)).toEqual([
      'deterministic',
      'llm-judge',
      'invariants',
      'regression',
    ]);
    expect(Array.isArray(parsed.warnings)).toBe(true);

    // The persisted run carries the same id and the unbound case as unjudged.
    const run = JSON.parse(
      await fs.readFile(
        path.join(fixture.root, '.ratchet', 'evals', 'runs', `${parsed.runId}.json`),
        'utf-8'
      )
    );
    expect(run.verdicts[SOLO_CASE].verdict).toBe('unjudged');
  });

  it('rejects an invalid --judge before persisting any run', async () => {
    await expect(evalRunCommand({ judge: 'nonsense' })).rejects.toThrow(
      /Invalid --judge/
    );
    expect(await persistedRunIds()).toHaveLength(0);
  });

  // features/eval-invariants/contributor.feature — a violated/unevaluable active
  // invariant is surfaced as a run-level gate violation first, ahead of the
  // per-case contributor breakdown; --no-invariants disables it entirely.
  it('surfaces a run-level invariant violation first, ahead of the contributor breakdown', async () => {
    // An active monotonic invariant with no promoted baseline is unevaluable ⇒
    // a fail-closed violation. No command runs (scenario-count is command-free).
    await fixture.write(
      '.ratchet/evals/invariants.yaml',
      'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: true\n    measure: scenario-count\n'
    );
    await evalRunCommand({});
    const text = output();
    expect(text).toContain('[FAIL]');
    expect(text).toContain('INVARIANT VIOLATIONS');
    expect(text).toContain('spec-not-weakened');
    // The run-level violation block precedes the per-case contributor breakdown.
    expect(text.indexOf('INVARIANT VIOLATIONS')).toBeLessThan(text.indexOf('Contributors:'));
  });

  it('counts an unloadable manifest as one violation in the run-level header', async () => {
    // A malformed manifest yields a loadError with zero per-invariant violations.
    // The header must count the load error explicitly (1), not fall back to a
    // hard-coded 1, and must name the unloadable manifest.
    await fixture.write(
      '.ratchet/evals/invariants.yaml',
      'invariants:\n  - id: bogus\n    kind: not-a-kind\n    active: true\n'
    );
    await evalRunCommand({});
    const text = output();
    expect(text).toContain('[FAIL]');
    expect(text).toContain('INVARIANT VIOLATIONS (1)');
    expect(text).toContain('manifest could not be loaded');
  });

  it('emits the invariant breakdown in --json and fails the run', async () => {
    await fixture.write(
      '.ratchet/evals/invariants.yaml',
      'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: true\n    measure: scenario-count\n'
    );
    await evalRunCommand({ json: true });
    const parsed = JSON.parse(output());
    expect(parsed.overall).toBe('fail');
    expect(parsed.invariants.map((o: { id: string }) => o.id)).toEqual(['spec-not-weakened']);
    expect(parsed.invariants[0].status).toBe('unevaluable');
    expect(parsed.contributors.find((c: { id: string }) => c.id === 'invariants').status).toBe('fail');
  });

  it('does not evaluate the invariant gate under --no-invariants', async () => {
    // The same violated manifest is present, but --no-invariants drops the
    // contributor so the gate is never evaluated and takes no part in the verdict.
    await fixture.write(
      '.ratchet/evals/invariants.yaml',
      'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: true\n    measure: scenario-count\n'
    );
    await evalRunCommand({ invariants: false, json: true });
    const parsed = JSON.parse(output());
    // invariants is absent from the breakdown and the AND; no breakdown recorded.
    expect(parsed.contributors.map((c: { id: string }) => c.id)).not.toContain('invariants');
    expect(parsed.invariants).toEqual([]);
    // The persisted run records the enabled set without invariants.
    const run = JSON.parse(
      await fs.readFile(
        path.join(fixture.root, '.ratchet', 'evals', 'runs', `${parsed.runId}.json`),
        'utf-8'
      )
    );
    expect(run.gate).not.toContain('invariants');
  });

  it('records a disabled-contributor case unjudged (naming the contributor) and stays incomplete', async () => {
    // Bind the solo case as a deterministic check, then disable the deterministic
    // contributor via --only. The bound case must be recorded unjudged WITHOUT
    // executing its check (no fixture is materialized), leaving the run incomplete.
    await fixture.writeSpec(
      'solo.yaml',
      `${SOLO_CASE}:\n  fixture: fx\n  kind: deterministic\n  check:\n    run: "true"\n    pass: exit-zero\n`
    );

    await evalRunCommand({ only: 'llm-judge', json: true });
    const parsed = JSON.parse(output());

    expect(parsed.scorecard.unjudged).toBe(1);
    expect(parsed.scorecard.complete).toBe(false);

    const run = JSON.parse(
      await fs.readFile(
        path.join(fixture.root, '.ratchet', 'evals', 'runs', `${parsed.runId}.json`),
        'utf-8'
      )
    );
    expect(run.verdicts[SOLO_CASE].verdict).toBe('unjudged');
    expect(run.verdicts[SOLO_CASE].reason).toMatch(/deterministic.*disabled/i);
    // The enabled set is persisted on the run, in display order.
    expect(run.gate).toEqual(['llm-judge']);
  });
});
