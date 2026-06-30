import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { proposeCommand, deriveChangeName } from '../../src/commands/propose.js';
import type { Spawner } from '../../src/core/batch/engine/agent.js';
import { CommandFixture, makeCommandFixture, completingSpawner } from './change-fixture.js';

/**
 * Behavioral tests for the `propose` verb.
 * Implements features/commands-core-verbs/propose.feature.
 *
 * The engine agent spawn is replaced by an injected fake `Spawner` (no real
 * agent is ever spawned), and the verb is pointed at an isolated tmpdir fixture
 * via `deps.projectRoot`. Precondition scenarios inject a spawner asserted
 * never-called — the proof of each "fail fast with NO spawn" guarantee.
 */

describe('proposeCommand', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-propose-');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fixture.cleanup();
  });

  describe('deriveChangeName', () => {
    it('derives a kebab-case slug from a free-text objective', () => {
      expect(deriveChangeName('Add user authentication')).toBe('add-user-authentication');
    });

    it('returns undefined for a blank or punctuation-only objective', () => {
      expect(deriveChangeName('   ')).toBeUndefined();
      expect(deriveChangeName('!!! ??? ...')).toBeUndefined();
    });
  });

  it('fails fast with NO spawn when a blank/unsluggable objective has no --name', async () => {
    const spawner = vi.fn<Parameters<Spawner>, ReturnType<Spawner>>();

    await expect(
      proposeCommand('!!! ???', {}, { projectRoot: () => fixture.root, spawner })
    ).rejects.toThrow(/non-empty objective or an explicit --name/i);

    expect(spawner).not.toHaveBeenCalled();
  });

  it('lets an explicit --name short-circuit derivation from the objective', async () => {
    const { spawner, calls } = completingSpawner(fixture.root, 'chosen-change');

    await proposeCommand(
      'some long objective text',
      { name: 'chosen-change', json: true },
      { projectRoot: () => fixture.root, spawner }
    );

    // The step context was built for "chosen-change": exactly one step ran for it.
    expect(calls()).toBe(1);
    const printed = JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
    expect(printed.change).toBe('chosen-change');
  });

  it('refuses to clobber an existing change, with NO spawn', async () => {
    await fixture.makeChange('already-here');
    const spawner = vi.fn<Parameters<Spawner>, ReturnType<Spawner>>();

    await expect(
      proposeCommand(
        'already here',
        {},
        { projectRoot: () => fixture.root, spawner }
      )
    ).rejects.toThrow(/already exists/i);

    expect(spawner).not.toHaveBeenCalled();
  });

  it('advances a happy-path propose via the forced propose transition', async () => {
    const { spawner, calls } = completingSpawner(fixture.root, 'add-login');

    await proposeCommand(
      'Add login',
      {},
      { projectRoot: () => fixture.root, spawner }
    );

    expect(calls()).toBe(1);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Proposed: add-login (propose)');
    expect(printed).toContain('change proposed');
  });

  it('--json renders the structured result as a single JSON object', async () => {
    const { spawner } = completingSpawner(fixture.root, 'add-login');

    await proposeCommand(
      'Add login',
      { json: true },
      { projectRoot: () => fixture.root, spawner }
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = JSON.parse(logSpy.mock.calls[0][0] as string); // throws if not one JSON object
    expect(printed.transition).toBe('propose');
    expect(printed.state).toBe('advanced');
    expect(printed.change).toBe('add-login');
  });
});
