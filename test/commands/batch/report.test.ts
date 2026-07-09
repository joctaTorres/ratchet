/**
 * Integration tests for the `batch report` verb.
 *
 * Implements features/batch-command-tests/report.feature: the single-report-kind
 * channel over an isolated tmpdir fixture repo — each report kind writes the right
 * journal/park state, and malformed invocations (no `--change`, zero or multiple
 * report kinds) are rejected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readJournalForChange,
  getParkedStep,
} from '../../../src/core/batch/journal.js';
import { makeBatchFixture, type BatchFixture } from './batch-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { batchReportCommand } from '../../../src/commands/batch/report.js';

describe('batchReportCommand', () => {
  let fixture: BatchFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeBatchFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
    await fixture.writeBatch('b', { phases: [{ changes: [{ name: 'c1' }] }] });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('rejects a missing --change', async () => {
    await expect(batchReportCommand('b', {})).rejects.toThrow(/--change/);
  });

  it('rejects no report kind', async () => {
    await expect(batchReportCommand('b', { change: 'c1' })).rejects.toThrow(/--status/);
  });

  it('rejects more than one report kind', async () => {
    await expect(
      batchReportCommand('b', { change: 'c1', status: 'a', complete: 'b' })
    ).rejects.toThrow(/exactly one/);
  });

  it('appends a progress entry for a status report', async () => {
    await batchReportCommand('b', { change: 'c1', status: 'making progress' });

    const journal = readJournalForChange(fixture.root, 'b', 'c1');
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ kind: 'progress', message: 'making progress' });
    expect(output()).toMatch(/Recorded progress/);
  });

  it('journals and parks the step as blocked for a blocker report', async () => {
    await batchReportCommand('b', { change: 'c1', blocker: 'which db?' });

    expect(readJournalForChange(fixture.root, 'b', 'c1')[0]).toMatchObject({
      kind: 'blocker',
      message: 'which db?',
    });
    const parked = getParkedStep(fixture.root, 'b', 'c1');
    expect(parked).toMatchObject({ kind: 'blocked', reason: 'which db?' });
  });

  it('journals and parks the step as blocked for a needs-input report', async () => {
    await batchReportCommand('b', { change: 'c1', needsInput: 'need an API key' });

    expect(readJournalForChange(fixture.root, 'b', 'c1')[0]).toMatchObject({
      kind: 'needs-input',
      message: 'need an API key',
    });
    expect(getParkedStep(fixture.root, 'b', 'c1')).toMatchObject({
      kind: 'blocked',
      reason: 'need an API key',
    });
  });

  it('journals completion for a completion report', async () => {
    await batchReportCommand('b', { change: 'c1', complete: 'all done' });

    expect(readJournalForChange(fixture.root, 'b', 'c1')[0]).toMatchObject({
      kind: 'completion',
      message: 'all done',
    });
    expect(output()).toMatch(/Recorded completion/);
  });

  it('parks for approval when completion lands under an after-propose gate', async () => {
    await batchReportCommand('b', {
      change: 'c1',
      complete: 'proposal ready',
      awaitingApproval: true,
    });

    expect(getParkedStep(fixture.root, 'b', 'c1')).toMatchObject({
      kind: 'awaiting-approval',
      reason: 'proposal ready',
    });
  });

  it('records an answer against the parked step', async () => {
    fixture.park('b', { change: 'c1', kind: 'blocked', reason: 'which db?' });

    await batchReportCommand('b', { change: 'c1', answer: 'use postgres' });

    expect(getParkedStep(fixture.root, 'b', 'c1')?.answer).toBe('use postgres');
    expect(output()).toMatch(/resume the agent/);
  });

  it('records reject feedback against the parked step', async () => {
    fixture.park('b', { change: 'c1', kind: 'awaiting-approval', reason: 'review' });

    await batchReportCommand('b', { change: 'c1', reject: 'wrong approach' });

    expect(getParkedStep(fixture.root, 'b', 'c1')?.feedback).toBe('wrong approach');
    expect(output()).toMatch(/re-runs propose/);
  });

  /**
   * Implements: features/agent-cmd-override/override-provenance.feature
   *
   * Scenario: agent-reported journal entries are stamped. `batch report` runs
   * INSIDE the spawned agent; when its own process env carries an active
   * RATCHET_BATCH_AGENT_CMD, every entry it appends (progress, blocker,
   * needs-input, completion) carries `via: 'env-override'` — the spawned
   * stand-in inherits the var, so stub-reported completions are auditable.
   * Override-free reports stay unstamped.
   */
  describe('override provenance stamping (override-provenance.feature)', () => {
    const ENV = 'RATCHET_BATCH_AGENT_CMD';
    let saved: string | undefined;

    beforeEach(() => {
      saved = process.env[ENV];
    });
    afterEach(() => {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    });

    it('stamps every appended entry with `via: env-override` under an active override', async () => {
      process.env[ENV] = 'echo stub-agent';
      await batchReportCommand('b', { change: 'c1', status: 'making progress' });
      await batchReportCommand('b', { change: 'c1', complete: 'all done' });

      const entries = readJournalForChange(fixture.root, 'b', 'c1');
      expect(entries).toHaveLength(2);
      for (const e of entries) expect(e.via).toBe('env-override');
    });

    it('stamps blocker and needs-input entries under an active override', async () => {
      process.env[ENV] = 'echo stub-agent';
      await batchReportCommand('b', { change: 'c1', blocker: 'which db?' });
      // Answer is a USER action (recordAnswer appends its own 'answer' entry
      // inside journal.ts, not report.ts), so it is intentionally NOT stamped —
      // only the agent-reported kinds report.ts appends directly carry `via`.
      await batchReportCommand('b', { change: 'c1', answer: 'use postgres' });
      await batchReportCommand('b', { change: 'c1', needsInput: 'need an API key' });

      const entries = readJournalForChange(fixture.root, 'b', 'c1');
      const blocker = entries.find((e) => e.kind === 'blocker');
      const needsInput = entries.find((e) => e.kind === 'needs-input');
      expect(blocker?.via).toBe('env-override');
      expect(needsInput?.via).toBe('env-override');
      // The user-driven answer entry stays unstamped.
      const answer = entries.find((e) => e.kind === 'answer');
      expect(answer?.via).toBeUndefined();
    });

    it('leaves entries unstamped when no override is active', async () => {
      delete process.env[ENV];
      await batchReportCommand('b', { change: 'c1', status: 'making progress' });

      const entries = readJournalForChange(fixture.root, 'b', 'c1');
      expect(entries).toHaveLength(1);
      expect(entries[0].via).toBeUndefined();
    });
  });
});
