/**
 * Integration tests for the `batch view` and `batch list` verbs.
 *
 * Implements features/batch-command-tests/view.feature: the single-batch dashboard
 * and the all-batches list over an isolated tmpdir fixture repo — empty-batch
 * guidance, progress + next-step rendering, parked-halt surfacing, `view --json`
 * full status, and `list` (none-found, one row per batch, `--json` summary rows).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeBatchFixture, type BatchFixture } from './batch-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { batchViewCommand, batchListCommand } from '../../../src/commands/batch/view.js';

describe('batch view and list', () => {
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

  describe('batchViewCommand', () => {
    it('guides the user to add changes for an empty batch', async () => {
      await fixture.writeBatch('b', { phases: [] });

      await batchViewCommand('b', {});

      expect(output()).toContain('no changes yet');
    });

    it('renders a progress bar, per-change rows, and the next step', async () => {
      await fixture.writeBatch('b', {
        phases: [{ name: 'foundation', changes: [{ name: 'c-done' }, { name: 'c-ready' }] }],
      });
      await fixture.writeChangeWithTasks('c-done', { done: 1, total: 1 });
      // A journaled verify makes c-done truly done, so c-ready is the next step
      // (without it, c-done renders as awaiting-verify and is itself next).
      fixture.completeVerify('b', 'c-done');

      await batchViewCommand('b', {});

      const out = output();
      expect(out).toContain('c-done');
      expect(out).toContain('c-ready');
      expect(out).toContain('Next: c-ready');
    });

    it('surfaces an awaiting-approval halt under the change row', async () => {
      await fixture.writeBatch('b', { phases: [{ changes: [{ name: 'c1' }] }] });
      fixture.park('b', { change: 'c1', kind: 'awaiting-approval', reason: 'review the proposal' });

      await batchViewCommand('b', {});

      const out = output();
      expect(out).toContain('awaiting approval');
      expect(out).toContain('review the proposal');
    });

    it('emits the full derived status with --json', async () => {
      await fixture.writeBatch('b', {
        phases: [{ name: 'foundation', changes: [{ name: 'c1' }] }],
      });

      await batchViewCommand('b', { json: true });

      const parsed = JSON.parse(output()) as { name: string; phases: unknown[] };
      expect(parsed.name).toBe('b');
      expect(Array.isArray(parsed.phases)).toBe(true);
    });
  });

  describe('batchListCommand', () => {
    it('reports no batches were found', async () => {
      await batchListCommand({});

      expect(output()).toContain('No batches found');
    });

    it('renders one row per active batch', async () => {
      await fixture.writeBatch('alpha', { phases: [{ changes: [{ name: 'c1' }] }] });
      await fixture.writeBatch('beta', { phases: [{ changes: [{ name: 'c2' }] }] });

      await batchListCommand({});

      const out = output();
      expect(out).toContain('alpha');
      expect(out).toContain('beta');
    });

    it('emits a summary row per batch with --json', async () => {
      await fixture.writeBatch('alpha', { phases: [{ changes: [{ name: 'c1' }] }] });
      await fixture.writeBatch('beta', { phases: [{ changes: [{ name: 'c2' }] }] });

      await batchListCommand({ json: true });

      const parsed = JSON.parse(output()) as {
        batches: { name: string; changeCount: number; progress: unknown; status: string }[];
      };
      expect(parsed.batches).toHaveLength(2);
      for (const row of parsed.batches) {
        expect(row).toHaveProperty('name');
        expect(row).toHaveProperty('changeCount');
        expect(row).toHaveProperty('progress');
        expect(row).toHaveProperty('status');
      }
    });
  });
});
