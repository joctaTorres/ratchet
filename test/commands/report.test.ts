/**
 * Integration tests for the batch-less `ratchet report <change>` verb and the
 * standalone apply path it unblocks.
 *
 * Implements features/standalone-report-channel/report-command.feature and
 * features/standalone-report-channel/standalone-completion.feature: each report
 * kind appends to the change-local `.ratchet/changes/<change>/.run/` journal, a
 * missing change or a malformed kind set is rejected without writing, a lone
 * batch never captures a standalone report, and a standalone `apply` whose agent
 * runs the report command named in its instructions ends `advanced`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { reportCommand } from '../../src/commands/report.js';
import { applyCommand } from '../../src/commands/apply.js';
import { proposeCommand } from '../../src/commands/propose.js';
import { createChange, isChangeCreated } from '../../src/utils/change-utils.js';
import { readChangeDiskState } from '../../src/core/batch/engine/transition.js';
import { appendJournal, readJournal } from '../../src/core/batch/journal.js';
import { readChangeJournalTolerantForLocus } from '../../src/core/batch/engine/run-state.js';
import type { Spawner } from '../../src/core/batch/engine/agent.js';
import { CommandFixture, makeCommandFixture, completingSpawner } from './change-fixture.js';

describe('reportCommand', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-report-');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fixture.cleanup();
  });

  const journalOf = (change: string) =>
    readChangeJournalTolerantForLocus(fixture.root, { change }, change);

  it.each([
    ['status', 'progress'],
    ['blocker', 'blocker'],
    ['needsInput', 'needs-input'],
    ['complete', 'completion'],
  ] as const)('--%s appends one %s entry to the change-local journal', async (flag, kind) => {
    await fixture.makeChange('add-hello');

    await reportCommand('add-hello', { [flag]: 'note' }, fixture.root);

    const entries = journalOf('add-hello');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ change: 'add-hello', kind, message: 'note' });
    expect(
      existsSync(path.join(fixture.root, '.ratchet', 'changes', 'add-hello', '.run', 'journal.jsonl'))
    ).toBe(true);
    expect(existsSync(path.join(fixture.root, '.ratchet', 'batches'))).toBe(false);
  });

  it('prints a human line per kind, or JSON with --json', async () => {
    await fixture.makeChange('add-hello');
    await reportCommand('add-hello', { status: 's' }, fixture.root);
    await reportCommand('add-hello', { blocker: 'b' }, fixture.root);
    await reportCommand('add-hello', { needsInput: 'n' }, fixture.root);
    await reportCommand('add-hello', { complete: 'c' }, fixture.root);
    await reportCommand('add-hello', { complete: 'c', json: true }, fixture.root);

    const printed = logSpy.mock.calls.map((c) => String(c[0]));
    expect(printed[0]).toContain('Recorded progress for add-hello: s');
    expect(printed[1]).toContain('Recorded blocker for add-hello: b');
    expect(printed[2]).toContain('Recorded input request for add-hello: n');
    expect(printed[3]).toContain('Recorded completion for add-hello');
    expect(JSON.parse(printed[4])).toEqual({ kind: 'complete', change: 'add-hello' });
  });

  it('accepts a report before a fresh propose has created the change directory', async () => {
    await reportCommand('new-idea', { blocker: 'which database?' }, fixture.root);

    expect(journalOf('new-idea')).toMatchObject([
      { change: 'new-idea', kind: 'blocker', message: 'which database?' },
    ]);
  });

  it.each(['../../src', '../escape', 'Bad_Name'])(
    'rejects the invalid change name %s before building any path',
    async (name) => {
      await fs.mkdir(path.join(fixture.root, 'src'), { recursive: true });

      await expect(reportCommand(name, { complete: 'done' }, fixture.root)).rejects.toThrow(
        `Invalid change name "${name}"`
      );

      const runDirs = (await fs.readdir(fixture.root, { recursive: true })).filter((p) =>
        String(p).split(path.sep).includes('.run')
      );
      expect(runDirs).toEqual([]);
    }
  );

  it('requires exactly one report kind', async () => {
    await fixture.makeChange('add-hello');
    await expect(reportCommand('add-hello', {}, fixture.root)).rejects.toThrow(
      'Provide one of --status, --blocker, --needs-input, or --complete.'
    );
    await expect(
      reportCommand('add-hello', { status: 'a', complete: 'b' }, fixture.root)
    ).rejects.toThrow(/exactly one report kind/);
    expect(journalOf('add-hello')).toHaveLength(0);
  });

  it('is not captured by a lone batch in the project', async () => {
    await fixture.makeChange('add-hello');
    await fs.mkdir(path.join(fixture.root, '.ratchet', 'batches', 'b1'), { recursive: true });
    await fs.writeFile(
      path.join(fixture.root, '.ratchet', 'batches', 'b1', 'batch.yaml'),
      'name: b1\nphases: []\n',
      'utf-8'
    );
    appendJournal(fixture.root, 'b1', { change: 'other', kind: 'progress', message: 'x' });
    const batchBefore = readJournal(fixture.root, 'b1');

    await reportCommand('add-hello', { complete: 'done' }, fixture.root);

    expect(journalOf('add-hello')).toMatchObject([{ kind: 'completion', message: 'done' }]);
    expect(readJournal(fixture.root, 'b1')).toEqual(batchBefore);
  });
});

describe('standalone apply through the prompted report channel', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-report-apply-');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fixture.cleanup();
  });

  /**
   * A stub agent that follows the prompt: it parses the `--complete` report
   * command out of its instructions and runs it through the real report verb.
   */
  function promptFollowingSpawner(): { spawner: Spawner; prompts: string[] } {
    const prompts: string[] = [];
    const spawner: Spawner = async (request) => {
      prompts.push(request.instructions);
      const match = request.instructions.match(/`ratchet report (\S+) --complete "<summary>"`/);
      if (match) await reportCommand(match[1], { complete: 'created hello.txt' }, fixture.root);
      return { exitCode: 0, signal: null, stdout: '', stderr: '' };
    };
    return { spawner, prompts };
  }

  function lastResult(): { state: string } {
    const printed = logSpy.mock.calls.map((c) => String(c[0]));
    return JSON.parse(printed[printed.length - 1]);
  }

  it('ends advanced when the agent reports via the prompted command', async () => {
    await fixture.writeChangeWithTasks('add-hello', { done: 0, total: 1 });
    const { spawner, prompts } = promptFollowingSpawner();

    await applyCommand('add-hello', { json: true }, { projectRoot: () => fixture.root, spawner });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('undefined');
    expect(lastResult().state).toBe('advanced');
    expect(
      readChangeJournalTolerantForLocus(fixture.root, { change: 'add-hello' }, 'add-hello')
    ).toContainEqual(expect.objectContaining({ kind: 'completion', message: 'created hello.txt' }));
  });

  it('still parks as blocked when the agent exits without reporting', async () => {
    await fixture.writeChangeWithTasks('add-hello', { done: 0, total: 1 });
    const spawner: Spawner = async () => ({ exitCode: 0, signal: null, stdout: '', stderr: '' });

    await applyCommand('add-hello', { json: true }, { projectRoot: () => fixture.root, spawner });

    expect(lastResult().state).toBe('blocked');
  });
});

/**
 * Implements features/standalone-report-channel/report-command.feature:
 * "A pre-propose report does not block creating the change" and
 * "A pre-propose report does not make propose refuse the name". A change
 * directory whose ONLY entry is `.run/` is not a created change.
 */
describe('a .run/-only change directory is not a created change', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-report-prepropose-');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fixture.cleanup();
  });

  const changeDir = (name: string) => path.join(fixture.root, '.ratchet', 'changes', name);

  it('isChangeCreated: absent and .run/-only are not created; empty or scaffolded are', async () => {
    expect(isChangeCreated(changeDir('absent'))).toBe(false);

    await reportCommand('run-only', { status: 'starting' }, fixture.root);
    expect(isChangeCreated(changeDir('run-only'))).toBe(false);
    expect(readChangeDiskState(fixture.root, 'run-only').exists).toBe(false);

    await fs.mkdir(changeDir('empty'), { recursive: true });
    expect(isChangeCreated(changeDir('empty'))).toBe(true);

    await fixture.writeChangeWithTasks('scaffolded', { done: 0, total: 1 });
    await reportCommand('scaffolded', { status: 'x' }, fixture.root);
    expect(isChangeCreated(changeDir('scaffolded'))).toBe(true);
  });

  it('createChange scaffolds into a .run/-only directory and keeps the journal', async () => {
    await reportCommand('new-idea', { status: 'starting' }, fixture.root);

    await createChange(fixture.root, 'new-idea');

    expect(existsSync(path.join(changeDir('new-idea'), '.ratchet.yaml'))).toBe(true);
    expect(
      readChangeJournalTolerantForLocus(fixture.root, { change: 'new-idea' }, 'new-idea')
    ).toMatchObject([{ kind: 'progress', message: 'starting' }]);
  });

  it('createChange still rejects a directory that holds more than .run/', async () => {
    await fixture.writeChangeWithTasks('taken', { done: 0, total: 1 });
    await reportCommand('taken', { status: 'x' }, fixture.root);

    await expect(createChange(fixture.root, 'taken')).rejects.toThrow(/already exists/);
  });

  it('propose does not refuse a name that only has pre-propose reports', async () => {
    await reportCommand('new-idea', { blocker: 'which database?' }, fixture.root);
    const { spawner, calls } = completingSpawner(fixture.root, 'new-idea');

    await proposeCommand(
      'anything',
      { name: 'new-idea' },
      { projectRoot: () => fixture.root, spawner }
    );

    expect(calls()).toBe(1);
  });
});
