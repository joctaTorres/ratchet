/**
 * Integration tests for the remaining untested instructions paths.
 *
 * Implements features/workflow-command-tests/instructions.feature: the artifact-
 * and apply-instruction surfaces of the workflow group over an isolated tmpdir
 * fixture repo with `resolveCurrentPlanningHomeSync` pointed at the fixture root —
 * `instructionsCommand` (ready artifact JSON, missing-argument, unknown-artifact,
 * blocked warning), the `blocked` / `all_done` branches of
 * `generateApplyInstructions`, `applyInstructionsCommand` (apply JSON), and
 * `printApplyInstructionsText` (blocked banner + progress + tasks).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { makeCommandFixture, type CommandFixture } from '../change-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/core/planning-home.js')>();
  return { ...actual, resolveCurrentPlanningHomeSync: resolvePlanningHomeMock };
});

import {
  instructionsCommand,
  applyInstructionsCommand,
  generateApplyInstructions,
  printApplyInstructionsText,
} from '../../../src/commands/workflow/instructions.js';
import type { ApplyInstructions } from '../../../src/commands/workflow/shared.js';

function planningHomeFor(root: string) {
  return {
    kind: 'repo' as const,
    root,
    changesDir: path.join(root, '.ratchet', 'changes'),
    batchesDir: path.join(root, '.ratchet', 'batches'),
    defaultSchema: 'ratchet',
  };
}

describe('instructionsCommand', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue(planningHomeFor(fixture.root));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('emits artifact JSON for an artifact whose dependencies are satisfied', async () => {
    // writeValidChange writes a feature on disk, so the `plan` artifact's
    // `features` dependency is satisfied (ready, not blocked).
    await fixture.writeValidChange('ready-change');

    await instructionsCommand('plan', { change: 'ready-change', json: true });

    const parsed = JSON.parse(output()) as { artifactId: string; changeName: string };
    expect(parsed.artifactId).toBe('plan');
    expect(parsed.changeName).toBe('ready-change');
  });

  it('rejects a missing artifact argument by listing the valid artifact ids', async () => {
    await fixture.writeMetadata('a-change');

    await expect(
      instructionsCommand(undefined, { change: 'a-change', json: true })
    ).rejects.toThrow(/Missing required argument <artifact>[\s\S]*features[\s\S]*plan/);
  });

  it('rejects an unknown artifact by listing the valid artifact ids', async () => {
    await fixture.writeMetadata('a-change');

    await expect(
      instructionsCommand('bogus', { change: 'a-change', json: true })
    ).rejects.toThrow(/Artifact 'bogus' not found[\s\S]*features[\s\S]*plan/);
  });

  it('warns when a blocked artifact is printed as text, naming the missing dependency', async () => {
    // No feature on disk: the `plan` artifact's `features` dependency is missing.
    await fixture.writeMetadata('blocked-change');

    await instructionsCommand('plan', { change: 'blocked-change' });

    const text = output();
    expect(text).toContain('<warning>');
    expect(text).toContain('Missing: features');
  });
});

describe('generateApplyInstructions', () => {
  let fixture: CommandFixture;

  beforeEach(async () => {
    fixture = await makeCommandFixture();
    resolvePlanningHomeMock.mockReturnValue(planningHomeFor(fixture.root));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  it('reports blocked when required artifacts are missing', async () => {
    await fixture.writeMetadata('no-plan'); // change exists, but no plan.md

    const instructions = await generateApplyInstructions(
      fixture.root,
      'no-plan',
      undefined,
      planningHomeFor(fixture.root)
    );

    expect(instructions.state).toBe('blocked');
    expect(instructions.missingArtifacts).toContain('plan');
  });

  it('reports all_done when every task is checked', async () => {
    await fixture.writeChangeWithTasks('finished', { done: 3, total: 3 });
    await fixture.writeMetadata('finished');

    const instructions = await generateApplyInstructions(
      fixture.root,
      'finished',
      undefined,
      planningHomeFor(fixture.root)
    );

    expect(instructions.state).toBe('all_done');
    expect(instructions.progress.total).toBe(3);
    expect(instructions.progress.complete).toBe(3);
    expect(instructions.progress.remaining).toBe(0);
  });
});

describe('applyInstructionsCommand', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue(planningHomeFor(fixture.root));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('emits apply JSON carrying the instructions and pending tasks for a ready change', async () => {
    await fixture.writeChangeWithTasks('ready-apply', { done: 0, total: 2 });
    await fixture.writeMetadata('ready-apply');

    await applyInstructionsCommand({ change: 'ready-apply', json: true });

    const parsed = JSON.parse(output()) as ApplyInstructions;
    expect(parsed.state).toBe('ready');
    expect(parsed.changeName).toBe('ready-apply');
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.progress.remaining).toBe(2);
  });
});

describe('printApplyInstructionsText', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('renders the blocked banner and missing artifacts for a blocked snapshot', () => {
    const blocked: ApplyInstructions = {
      changeName: 'blocked-demo',
      changeDir: '/tmp/blocked-demo',
      schemaName: 'ratchet',
      contextFiles: {},
      progress: { total: 0, complete: 0, remaining: 0 },
      tasks: [],
      state: 'blocked',
      missingArtifacts: ['plan'],
      instruction: 'Cannot apply yet.',
    };

    printApplyInstructionsText(blocked);

    const text = output();
    expect(text).toContain('## Apply: blocked-demo');
    expect(text).toContain('### ⚠️ Blocked');
    expect(text).toContain('Missing artifacts: plan');
  });

  it('renders context files, progress, and the task list for a ready snapshot', () => {
    const ready: ApplyInstructions = {
      changeName: 'ready-demo',
      changeDir: '/tmp/ready-demo',
      schemaName: 'ratchet',
      contextFiles: { plan: ['/tmp/ready-demo/plan.md'] },
      progress: { total: 2, complete: 1, remaining: 1 },
      tasks: [
        { id: '1', description: 'first task', done: true },
        { id: '2', description: 'second task', done: false },
      ],
      state: 'ready',
      instruction: 'Work through the pending tasks.',
    };

    printApplyInstructionsText(ready);

    const text = output();
    expect(text).toContain('### Context Files');
    expect(text).toContain('- plan: /tmp/ready-demo/plan.md');
    expect(text).toContain('### Progress');
    expect(text).toContain('1/2 complete');
    expect(text).toContain('### Tasks');
    expect(text).toContain('- [x] first task');
    expect(text).toContain('- [ ] second task');
  });
});
