/**
 * Integration tests for the `ratchet eval run --holdout` / `--no-holdout`
 * scope filter.
 *
 * Implements features/eval-holdout/holdout-scope-filter.feature: `eval run
 * --holdout` persists a run scoped to only the held-out case; `--no-holdout`
 * persists a run scoped to only the non-held-out case; the held-out case's
 * verdict/scorecard behavior is unaffected by being selected via the flag
 * versus being in an unfiltered run. The verb is pointed at an isolated
 * tmpdir fixture by mocking `resolveCurrentPlanningHomeSync`; console.log is
 * spied and the fixture removed in afterEach.
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

const HOLDOUT_FEATURE = `Feature: Sample
  @holdout
  Scenario: Held out scenario
    Given a precondition
    Then an outcome

  Scenario: Kept scenario
    Given a precondition
    Then an outcome
`;

const HELD_OUT_CASE = 'features/eval-holdout/sample#held-out-scenario';
const KEPT_CASE = 'features/eval-holdout/sample#kept-scenario';

const HOLDOUT_DETERMINISTIC_SPEC = `${HELD_OUT_CASE}:
  fixture: status-ok
  kind: deterministic
  check:
    run: cat output.txt
    pass: "contains:applyRequires"
`;

describe('evalRunCommand --holdout / --no-holdout scope filter', () => {
  let fixture: EvalFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeEvalFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    await fixture.writeFeature('eval-holdout/sample.feature', HOLDOUT_FEATURE);
    await fixture.writeSpec('eval-holdout.yaml', HOLDOUT_DETERMINISTIC_SPEC);
    await fixture.write('.ratchet/evals/fixtures/status-ok/output.txt', 'applyRequires: plan\n');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  async function loadRun(runId: string): Promise<any> {
    return JSON.parse(
      await fs.readFile(path.join(fixture.root, '.ratchet', 'evals', 'runs', `${runId}.json`), 'utf-8')
    );
  }

  it('--holdout persists a run scoped to only the held-out case', async () => {
    await evalRunCommand({ holdout: true, json: true });
    const parsed = JSON.parse(output());
    const run = await loadRun(parsed.runId);

    expect(run.cases.map((c: any) => c.id)).toEqual([HELD_OUT_CASE]);
    expect(Object.keys(run.verdicts)).toEqual([HELD_OUT_CASE]);
  });

  it('--no-holdout persists a run scoped to only the non-held-out case', async () => {
    await evalRunCommand({ holdout: false, json: true });
    const parsed = JSON.parse(output());
    const run = await loadRun(parsed.runId);

    expect(run.cases.map((c: any) => c.id)).toEqual([KEPT_CASE]);
    expect(Object.keys(run.verdicts)).toEqual([KEPT_CASE]);
  });

  it("the held-out case's verdict/scorecard behavior is unaffected by --holdout versus an unfiltered run", async () => {
    await evalRunCommand({ holdout: true, json: true });
    const filtered = JSON.parse(output());

    logSpy.mockClear();
    await evalRunCommand({ json: true });
    const unfiltered = JSON.parse(output());

    const filteredRun = await loadRun(filtered.runId);
    const unfilteredRun = await loadRun(unfiltered.runId);

    expect(filteredRun.verdicts[HELD_OUT_CASE]).toEqual(unfilteredRun.verdicts[HELD_OUT_CASE]);
  });
});
