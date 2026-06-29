import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyCommand } from '../../src/commands/apply.js';
import type { Spawner } from '../../src/core/batch/engine/agent.js';
import { CommandFixture, makeCommandFixture, completingSpawner } from './change-fixture.js';

/**
 * Behavioral tests for the `apply` verb.
 * Implements features/commands-core-verbs/apply.feature.
 *
 * The engine agent spawn is replaced by an injected fake `Spawner` (no real
 * agent is ever spawned), and the verb is pointed at an isolated tmpdir fixture
 * via `deps.projectRoot`. Precondition scenarios inject a spawner asserted
 * never-called — the proof of the "NO spawn on a failed precondition" guarantee.
 */

describe('applyCommand', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-apply-');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fixture.cleanup();
  });

  it('throws before any spawn when the change does not exist', async () => {
    const spawner = vi.fn<Parameters<Spawner>, ReturnType<Spawner>>();

    await expect(
      applyCommand('ghost', {}, { projectRoot: () => fixture.root, spawner })
    ).rejects.toThrow(/does not exist[\s\S]*ratchet propose/i);

    expect(spawner).not.toHaveBeenCalled();
  });

  it('fails fast with NO spawn when the change has no plan.md and --force is absent', async () => {
    await fixture.makeChange('no-plan');
    const spawner = vi.fn<Parameters<Spawner>, ReturnType<Spawner>>();

    await expect(
      applyCommand('no-plan', {}, { projectRoot: () => fixture.root, spawner })
    ).rejects.toThrow(/no plan\.md[\s\S]*propose[\s\S]*--force/i);

    expect(spawner).not.toHaveBeenCalled();
  });

  it('--force bypasses the missing-plan precondition and runs exactly one step', async () => {
    await fixture.makeChange('no-plan');
    const { spawner, calls } = completingSpawner(fixture.root, 'no-plan');

    await applyCommand(
      'no-plan',
      { force: true },
      { projectRoot: () => fixture.root, spawner }
    );

    expect(calls()).toBe(1);
  });

  it('advances a happy-path apply via the forced apply transition', async () => {
    await fixture.writeChangeWithTasks('ready', { done: 0, total: 2 });
    const { spawner, calls } = completingSpawner(fixture.root, 'ready');

    await applyCommand('ready', {}, { projectRoot: () => fixture.root, spawner });

    expect(calls()).toBe(1);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Applied: ready (apply)');
    expect(printed).toContain('change advanced through apply');
  });
});
