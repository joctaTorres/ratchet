/**
 * Integration tests for the `ratchet eval baseline` verb.
 *
 * Implements features/eval-command-tests/baseline.feature: promoting a run
 * writes `.ratchet/evals/baseline.json` and confirms it, the --json payload
 * reports the baseline run id, and a missing `<run-id>` argument is rejected.
 * The run is seeded directly through the core `persistRun` helper so the test
 * is independent of the run verb. The verb is pointed at an isolated tmpdir
 * fixture by mocking `resolveCurrentPlanningHomeSync`; console.log is spied and
 * the fixture removed in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { persistRun, type EvalRun } from '../../../src/core/eval/index.js';
import { makeEvalFixture, type EvalFixture } from './eval-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { evalBaselineCommand } from '../../../src/commands/eval/baseline.js';

const RUN_ID = '20260101T000000000Z-def456';

function seedRun(): EvalRun {
  return {
    runId: RUN_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    judgeMode: 'auto',
    scope: { kind: 'store' },
    cases: [
      {
        id: 'a',
        feature: 'Feature',
        scenario: 'a',
        source: 'features/x.feature',
        steps: [],
        bindingKind: null,
      },
    ],
    verdicts: { a: { verdict: 'pass', reason: '', source: 'judged' } },
  };
}

describe('evalBaselineCommand', () => {
  let fixture: EvalFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeEvalFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    persistRun(fixture.root, seedRun());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  async function baselineJson(): Promise<{ runId?: string }> {
    const file = path.join(fixture.root, '.ratchet', 'evals', 'baseline.json');
    return JSON.parse(await fs.readFile(file, 'utf-8'));
  }

  it('promotes a run id into baseline.json and confirms it', async () => {
    await evalBaselineCommand(RUN_ID);
    expect(await baselineJson()).toEqual({ runId: RUN_ID });
    expect(output()).toMatch(new RegExp(`Promoted run ${RUN_ID} to baseline`));
  });

  it('reports the baseline run id as JSON', async () => {
    await evalBaselineCommand(RUN_ID, { json: true });
    expect(JSON.parse(output())).toEqual({ baseline: { runId: RUN_ID } });
  });

  it('rejects a missing run id', async () => {
    await expect(evalBaselineCommand(undefined)).rejects.toThrow(/<run-id>/);
  });
});
