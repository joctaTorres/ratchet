/**
 * Integration tests for hold-out status and scope filtering in the `ratchet
 * eval set` verb.
 *
 * Implements features/eval-holdout/eval-set-holdout-status.feature: a
 * `@holdout`-tagged case reports `holdout: true` in JSON and a `[holdout]`
 * tag in text, an untagged case reports `holdout: false` and no tag, and a
 * held-out case that is also bound to a deterministic check shows both its
 * `[deterministic]` binding tag and `[holdout]` on the same line. Uses a
 * local `.feature`/spec fixture (not the shared `TWO_CASE_FEATURE` constants)
 * since neither of those fixture cases is tagged `@holdout`.
 *
 * Also implements features/eval-holdout/holdout-scope-filter.feature's
 * `eval set --holdout`/`--no-holdout` scenarios, including composing the
 * hold-out filter with `--change <name>`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeEvalFixture, type EvalFixture } from './eval-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { evalSetCommand } from '../../../src/commands/eval/set.js';

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

describe('evalSetCommand hold-out status', () => {
  let fixture: EvalFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeEvalFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    await fixture.writeFeature('eval-holdout/sample.feature', HOLDOUT_FEATURE);
    await fixture.writeSpec('eval-holdout.yaml', HOLDOUT_DETERMINISTIC_SPEC);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('reports holdout: true for the @holdout-tagged case and holdout: false for the untagged case', async () => {
    await evalSetCommand({ json: true });
    const parsed = JSON.parse(output());
    const byId = Object.fromEntries(parsed.cases.map((c: any) => [c.id, c]));

    expect(byId[HELD_OUT_CASE].holdout).toBe(true);
    expect(byId[KEPT_CASE].holdout).toBe(false);
  });

  it('tags the held-out case with [holdout] in text and leaves the other case untagged', async () => {
    await evalSetCommand({});
    const text = output();

    const heldOutLine = text.split('\n').find((line) => line.includes(HELD_OUT_CASE));
    const keptLine = text.split('\n').find((line) => line.includes(KEPT_CASE));

    expect(heldOutLine).toContain('[holdout]');
    expect(keptLine).not.toContain('[holdout]');
  });

  it('shows both the [deterministic] binding tag and [holdout] on the same line', async () => {
    await evalSetCommand({});
    const text = output();

    const heldOutLine = text.split('\n').find((line) => line.includes(HELD_OUT_CASE));

    expect(heldOutLine).toContain('[deterministic]');
    expect(heldOutLine).toContain('[holdout]');
  });
});

describe('evalSetCommand --holdout / --no-holdout scope filter', () => {
  let fixture: EvalFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeEvalFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    await fixture.writeFeature('eval-holdout/sample.feature', HOLDOUT_FEATURE);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('--holdout --json returns only the held-out case', async () => {
    await evalSetCommand({ holdout: true, json: true });
    const parsed = JSON.parse(output());
    expect(parsed.cases.map((c: any) => c.id)).toEqual([HELD_OUT_CASE]);
  });

  it('--no-holdout --json returns only the non-held-out case', async () => {
    await evalSetCommand({ holdout: false, json: true });
    const parsed = JSON.parse(output());
    expect(parsed.cases.map((c: any) => c.id)).toEqual([KEPT_CASE]);
  });

  it('--holdout text report lists only the held-out case line', async () => {
    await evalSetCommand({ holdout: true });
    const text = output();
    expect(text).toContain(HELD_OUT_CASE);
    expect(text).not.toContain(KEPT_CASE);
  });

  it('--no-holdout text report lists only the non-held-out case line', async () => {
    await evalSetCommand({ holdout: false });
    const text = output();
    expect(text).toContain(KEPT_CASE);
    expect(text).not.toContain(HELD_OUT_CASE);
  });

  it('omitting both hold-out flags still lists every case', async () => {
    await evalSetCommand({ json: true });
    const parsed = JSON.parse(output());
    expect(parsed.cases.map((c: any) => c.id).sort()).toEqual([HELD_OUT_CASE, KEPT_CASE].sort());
  });
});

describe('evalSetCommand --holdout composes with --change', () => {
  let fixture: EvalFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const CHANGE_HELD_OUT_CASE = 'changes/demo/features/eval-holdout/sample#held-out-scenario';
  const CHANGE_KEPT_CASE = 'changes/demo/features/eval-holdout/sample#kept-scenario';

  beforeEach(async () => {
    fixture = await makeEvalFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    await fixture.write('.ratchet/changes/demo/features/eval-holdout/sample.feature', HOLDOUT_FEATURE);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('--change <name> --holdout returns only the held-out case scoped to that change', async () => {
    await evalSetCommand({ change: 'demo', holdout: true, json: true });
    const parsed = JSON.parse(output());
    expect(parsed.cases.map((c: any) => c.id)).toEqual([CHANGE_HELD_OUT_CASE]);
    expect(parsed.cases.map((c: any) => c.id)).not.toContain(CHANGE_KEPT_CASE);
  });
});
