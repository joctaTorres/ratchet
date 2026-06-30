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
    // Tasks-checked alone is `awaiting-verify`; a journaled verify makes it done
    // so the next ready step is c-ready (not the still-unverified c-done).
    fixture.completeVerify('b', 'c-done');

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

  it('renders an in-progress symbol and task progress for a partially-done change', async () => {
    await fixture.writeBatch('b', {
      phases: [{ name: 'foundation', changes: [{ name: 'c-wip' }] }],
    });
    // A change dir with some-but-not-all tasks checked is in-progress.
    await fixture.writeChangeWithTasks('c-wip', { done: 1, total: 3 });

    await batchStatusCommand('b', {});

    const out = output();
    expect(out).toContain('c-wip');
    expect(out).toContain('◉');
    expect(out).toContain('[1/3]');
  });

  it('surfaces an awaiting-approval halt with its symbol and review prompt', async () => {
    await fixture.writeBatch('b', { phases: [{ changes: [{ name: 'c-review' }] }] });
    fixture.park('b', {
      change: 'c-review',
      kind: 'awaiting-approval',
      reason: 'approve the proposal?',
    });

    await batchStatusCommand('b', {});

    const out = output();
    expect(out).toContain('⏸');
    expect(out).toContain('awaiting approval: approve the proposal?');
    expect(out).toContain('approve or reject from the batch view');
  });

  it('notes a rejected awaiting-approval step carries reviewer feedback', async () => {
    await fixture.writeBatch('b', { phases: [{ changes: [{ name: 'c-rejected' }] }] });
    fixture.park('b', {
      change: 'c-rejected',
      kind: 'awaiting-approval',
      reason: 'approve the proposal?',
      feedback: 'tighten the scope',
    });

    await batchStatusCommand('b', {});

    const out = output();
    expect(out).toContain('⏸');
    expect(out).toContain('re-runs propose on next apply');
  });

  it('names the unmet dependency for a DAG-blocked change', async () => {
    await fixture.writeBatch('b', {
      phases: [
        {
          name: 'foundation',
          changes: [{ name: 'dep' }, { name: 'consumer', after: ['dep'] }],
        },
      ],
    });
    // `dep` has no dir / is not done, so `consumer` is blocked by it.

    await batchStatusCommand('b', {});

    const out = output();
    expect(out).toContain('✗');
    expect(out).toContain('blocked by dep');
  });

  it('reports all changes done when every change is complete', async () => {
    await fixture.writeBatch('b', {
      phases: [{ name: 'foundation', changes: [{ name: 'c-done' }] }],
    });
    await fixture.writeChangeWithTasks('c-done', { done: 1, total: 1 });
    // Done now requires a journaled verify on the change AND a satisfied
    // terminal-phase boundary proof-of-work.
    fixture.completeVerify('b', 'c-done');
    fixture.passProof('b', 'foundation');

    await batchStatusCommand('b', {});

    const out = output();
    expect(out).toContain('✓');
    expect(out).toContain('All changes done.');
  });

  it('carries a null next step in --json once the batch is done', async () => {
    await fixture.writeBatch('b', {
      phases: [{ name: 'foundation', changes: [{ name: 'c-done' }] }],
    });
    await fixture.writeChangeWithTasks('c-done', { done: 1, total: 1 });
    fixture.completeVerify('b', 'c-done');
    fixture.passProof('b', 'foundation');

    await batchStatusCommand('b', { json: true });

    const parsed = JSON.parse(output()) as { status: string; next: unknown };
    expect(parsed.status).toBe('done');
    expect(parsed.next).toBeNull();
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
