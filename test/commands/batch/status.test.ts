/**
 * Integration tests for the `batch status` verb.
 *
 * Implements features/batch-command-tests/status.feature: derived-status rendering
 * over an isolated tmpdir fixture repo — the text view prints phases, change
 * symbols, the next step and parked blockers, and `--json` carries the batch
 * name, status, configured gate, and per-change done/progress/blocked fields.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeBatchFixture, type BatchFixture } from './batch-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { batchStatusCommand } from '../../../src/commands/batch/status.js';

describe('batchStatusCommand', () => {
  let fixture: BatchFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeBatchFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('notes there are no changes yet for an empty batch', async () => {
    await fixture.writeBatch('b', { phases: [] });

    await batchStatusCommand('b', {});

    expect(output()).toContain('No changes yet');
  });

  it('renders phases, change names, and the next ready change', async () => {
    await fixture.writeBatch('b', {
      phases: [{ name: 'foundation', changes: [{ name: 'c-done' }, { name: 'c-ready' }] }],
    });
    await fixture.writeChangeWithTasks('c-done', { done: 1, total: 1 });

    await batchStatusCommand('b', {});

    const out = output();
    expect(out).toContain('foundation');
    expect(out).toContain('c-done');
    expect(out).toContain('c-ready');
    expect(out).toContain('Next: c-ready');
  });

  it('surfaces a parked blocker reason under its change', async () => {
    await fixture.writeBatch('b', { phases: [{ changes: [{ name: 'c1' }] }] });
    fixture.park('b', { change: 'c1', kind: 'blocked', reason: 'which adapter?' });

    await batchStatusCommand('b', {});

    expect(output()).toContain('which adapter?');
  });

  it('emits the batch name, status, gate, and per-change fields with --json', async () => {
    await fixture.writeBatch('b', {
      phases: [{ name: 'foundation', changes: [{ name: 'c1' }] }],
    });

    await batchStatusCommand('b', { json: true });

    const parsed = JSON.parse(output()) as {
      name: string;
      status: string;
      gate: string;
      phases: { changes: { done: string; progress: unknown; blocked: boolean }[] }[];
    };
    expect(parsed.name).toBe('b');
    expect(parsed.status).toBe('pending');
    expect(parsed.gate).toBe('voluntary');
    const change = parsed.phases[0].changes[0];
    expect(change).toHaveProperty('done');
    expect(change).toHaveProperty('progress');
    expect(change.blocked).toBe(false);
  });
});
