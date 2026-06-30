/**
 * Integration tests for the `ratchet eval record` verb.
 *
 * Implements features/eval-command-tests/record.feature: recording a manual
 * pass (`source: 'manual'`) with a success confirmation, the --json payload,
 * the missing-`--run` / missing-`--case` / missing-`--verdict` rejections, and
 * the fail-without-evidence rejection that leaves the persisted run unchanged.
 * The run under test is seeded directly through the core `persistRun` helper so
 * the test is independent of the run verb. The verb is pointed at an isolated
 * tmpdir fixture by mocking `resolveCurrentPlanningHomeSync`; console.log is
 * spied and the fixture removed in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { persistRun, loadRun, type EvalRun } from '../../../src/core/eval/index.js';
import { makeEvalFixture, type EvalFixture } from './eval-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { evalRecordCommand } from '../../../src/commands/eval/record.js';

const RUN_ID = '20260101T000000000Z-abc123';
const CASE_ID = 'features/solo#only-case';

function seedRun(): EvalRun {
  return {
    runId: RUN_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    judgeMode: 'auto',
    scope: { kind: 'store' },
    cases: [
      {
        id: CASE_ID,
        feature: 'Solo',
        scenario: 'Only case',
        source: 'features/solo.feature',
        steps: [{ keyword: 'Given', text: 'a precondition' }],
        bindingKind: null,
      },
    ],
    verdicts: {
      [CASE_ID]: {
        verdict: 'unjudged',
        reason: 'No eval-spec binding for this case.',
        source: 'judged',
      },
    },
  };
}

describe('evalRecordCommand', () => {
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

  it('records a manual pass verdict with source "manual" and confirms it', async () => {
    await evalRecordCommand({ run: RUN_ID, case: CASE_ID, verdict: 'pass' });

    const run = loadRun(fixture.root, RUN_ID);
    expect(run.verdicts[CASE_ID].verdict).toBe('pass');
    expect(run.verdicts[CASE_ID].source).toBe('manual');
    expect(output()).toMatch(/Recorded manual verdict 'pass'/);
  });

  it('emits the runId, caseId, verdict, and source as JSON', async () => {
    await evalRecordCommand({ run: RUN_ID, case: CASE_ID, verdict: 'pass', json: true });
    expect(JSON.parse(output())).toEqual({
      runId: RUN_ID,
      caseId: CASE_ID,
      verdict: 'pass',
      source: 'manual',
    });
  });

  it('rejects a missing --run', async () => {
    await expect(evalRecordCommand({ case: CASE_ID, verdict: 'pass' })).rejects.toThrow(
      /--run/
    );
  });

  it('rejects a missing --case', async () => {
    await expect(evalRecordCommand({ run: RUN_ID, verdict: 'pass' })).rejects.toThrow(
      /--case/
    );
  });

  it('rejects a missing --verdict', async () => {
    await expect(evalRecordCommand({ run: RUN_ID, case: CASE_ID })).rejects.toThrow(
      /--verdict/
    );
  });

  it('rejects a fail without evidence and leaves the run unchanged', async () => {
    await expect(
      evalRecordCommand({ run: RUN_ID, case: CASE_ID, verdict: 'fail' })
    ).rejects.toThrow(/evidence/i);

    const run = loadRun(fixture.root, RUN_ID);
    expect(run.verdicts[CASE_ID].verdict).toBe('unjudged');
    expect(run.verdicts[CASE_ID].source).toBe('judged');
  });
});
