/**
 * Integration tests for the `ratchet eval run` verb.
 *
 * Implements features/eval-command-tests/run.feature: running an unbound set
 * persists a run under `.ratchet/evals/runs/` and reports the case as unjudged
 * with the "Run is incomplete" notice (text), emits `{ runId, scorecard,
 * warnings }` (--json), and rejects an invalid --judge before any run is
 * persisted. The run is exercised over an unbound case so the engine records
 * `unjudged` without ever spawning a coding agent (the agent seam is covered by
 * test/cli-e2e/eval.test.ts). The verb is pointed at an isolated tmpdir fixture
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
});
