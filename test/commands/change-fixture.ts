/**
 * Shared tmpdir fixture for the `test/commands/` core-verb tests.
 *
 * Each test that touches the filesystem builds an isolated repo under
 * `fs.mkdtemp(os.tmpdir())`, writes only the minimal `.ratchet/changes/<name>/`
 * tree the scenario exercises, and tears it down in `afterEach` (see the
 * `testing` standard: fixture isolation, no real-repo dependence, order
 * independence, leave nothing behind). The headless verbs are pointed at the
 * fixture via `deps.projectRoot: () => fixture.root`; `validate` is driven over
 * it by `process.chdir(fixture.root)`.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendJournalForLocus } from '../../src/core/batch/journal.js';
import type { Spawner } from '../../src/core/batch/engine/agent.js';

/**
 * A fake agent spawn seam that simulates a clean, completed session: it records
 * each invocation (so a test can assert "exactly one step runs") and reports a
 * `completion` into the change-local journal so the engine maps the outcome to
 * `advanced`. No real agent is ever spawned.
 */
export function completingSpawner(
  root: string,
  change: string
): { spawner: Spawner; calls: () => number } {
  let calls = 0;
  const spawner: Spawner = async () => {
    calls += 1;
    appendJournalForLocus(root, { change }, {
      change,
      kind: 'completion',
      message: `${change} step complete`,
    });
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  };
  return { spawner, calls: () => calls };
}

/** A structurally valid Gherkin feature (header + a fully-stepped Scenario). */
const VALID_FEATURE = `Feature: Sample capability
  Scenario: it works
    Given a precondition
    When an action happens
    Then an outcome is observed
`;

/** A structurally valid plan.md (all required sections + at least one task). */
function validPlan(tasks: string): string {
  return [
    '# change',
    '',
    '## Why',
    '',
    'This change exists to exercise the validate verb over a structurally valid',
    'fixture so its happy path is pinned down by a test.',
    '',
    '## What Changes',
    '',
    '- Adds nothing real; it is a fixture.',
    '',
    '## Design',
    '',
    'A minimal, valid change tree.',
    '',
    '## Tasks',
    '',
    tasks,
    '',
  ].join('\n');
}

/** Build a `## Tasks` checkbox block with `done` of `total` boxes checked. */
function taskBoxes(done: number, total: number): string {
  const lines: string[] = [];
  for (let i = 0; i < total; i++) {
    lines.push(`- [${i < done ? 'x' : ' '}] task ${i + 1}`);
  }
  return lines.join('\n');
}

export class CommandFixture {
  constructor(readonly root: string) {}

  changeDir(change: string): string {
    return path.join(this.root, '.ratchet', 'changes', change);
  }

  /** Create an empty change directory (exists on disk, but no plan.md). */
  async makeChange(change: string): Promise<string> {
    const dir = this.changeDir(change);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /** Create a change with a `plan.md` whose content is exactly `body`. */
  async writePlan(change: string, body: string): Promise<string> {
    const dir = await this.makeChange(change);
    await fs.writeFile(path.join(dir, 'plan.md'), body, 'utf-8');
    return dir;
  }

  /** Create a change whose plan has `done` of `total` `## Tasks` checkboxes checked. */
  async writeChangeWithTasks(
    change: string,
    counts: { done: number; total: number }
  ): Promise<string> {
    return this.writePlan(change, validPlan(taskBoxes(counts.done, counts.total)));
  }

  /** Stamp a change with `.ratchet.yaml` metadata so discovery (validate/list) sees it. */
  async writeMetadata(change: string, yaml = 'schema: ratchet\n'): Promise<void> {
    const dir = await this.makeChange(change);
    await fs.writeFile(path.join(dir, '.ratchet.yaml'), yaml, 'utf-8');
  }

  /** Create a feature-store capability dir (`.ratchet/features/<cap>`) — a "spec". */
  async writeSpec(cap: string): Promise<void> {
    await fs.mkdir(path.join(this.root, '.ratchet', 'features', cap), { recursive: true });
  }

  /**
   * Create a structurally valid change discoverable by validate: a valid feature,
   * a complete plan.md, and the `.ratchet.yaml` metadata stamp.
   */
  async writeValidChange(change: string): Promise<string> {
    const dir = await this.writeChangeWithTasks(change, { done: 1, total: 1 });
    await fs.mkdir(path.join(dir, 'features', 'sample'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'features', 'sample', 'sample.feature'),
      VALID_FEATURE,
      'utf-8'
    );
    await fs.writeFile(path.join(dir, '.ratchet.yaml'), 'schema: ratchet\n', 'utf-8');
    return dir;
  }

  async cleanup(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }
}

/** Build an isolated fixture repo with an empty `.ratchet/changes/` tree. */
export async function makeCommandFixture(prefix = 'ratchet-cmd-'): Promise<CommandFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, '.ratchet', 'changes'), { recursive: true });
  return new CommandFixture(root);
}
