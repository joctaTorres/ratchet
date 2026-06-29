import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { verifyCommand } from '../../src/commands/verify.js';
import type { Spawner } from '../../src/core/batch/engine/agent.js';
import { CommandFixture, makeCommandFixture, completingSpawner } from './change-fixture.js';

/**
 * Behavioral tests for the `verify` verb.
 * Implements features/commands-core-verbs/verify.feature.
 *
 * The engine agent spawn is replaced by an injected fake `Spawner` (no real
 * agent is ever spawned), and the verb is pointed at an isolated tmpdir fixture
 * via `deps.projectRoot`. Precondition scenarios inject a spawner asserted
 * never-called — the proof that verify refuses unfinished work without --force.
 */

describe('verifyCommand', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-verify-');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fixture.cleanup();
  });

  it('throws before any spawn when the change does not exist', async () => {
    const spawner = vi.fn<Parameters<Spawner>, ReturnType<Spawner>>();

    await expect(
      verifyCommand('ghost', {}, { projectRoot: () => fixture.root, spawner })
    ).rejects.toThrow(/does not exist[\s\S]*ratchet propose/i);

    expect(spawner).not.toHaveBeenCalled();
  });

  it('fails fast with NO spawn on unfinished tasks, reporting the done/total count', async () => {
    await fixture.writeChangeWithTasks('half-done', { done: 1, total: 3 });
    const spawner = vi.fn<Parameters<Spawner>, ReturnType<Spawner>>();

    await expect(
      verifyCommand('half-done', {}, { projectRoot: () => fixture.root, spawner })
    ).rejects.toThrow(/unfinished tasks \(1\/3 done\)[\s\S]*apply[\s\S]*--force/i);

    expect(spawner).not.toHaveBeenCalled();
  });

  it('--force bypasses the unfinished-tasks precondition and runs exactly one step', async () => {
    await fixture.writeChangeWithTasks('half-done', { done: 1, total: 3 });
    const { spawner, calls } = completingSpawner(fixture.root, 'half-done');

    await verifyCommand(
      'half-done',
      { force: true },
      { projectRoot: () => fixture.root, spawner }
    );

    expect(calls()).toBe(1);
  });

  it('advances a happy-path verify via the forced verify transition', async () => {
    await fixture.writeChangeWithTasks('complete', { done: 2, total: 2 });
    const { spawner, calls } = completingSpawner(fixture.root, 'complete');

    await verifyCommand('complete', {}, { projectRoot: () => fixture.root, spawner });

    expect(calls()).toBe(1);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Verified: complete (verify)');
    expect(printed).toContain('change verified');
  });
});
