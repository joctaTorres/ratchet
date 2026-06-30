/**
 * Integration tests for the `status` verb.
 *
 * Implements features/workflow-command-tests/status.feature: report a change's
 * artifact progress over an isolated tmpdir fixture repo with
 * `resolveCurrentPlanningHomeSync` pointed at the fixture root — no-changes is a
 * valid state (text + `--json`), omitting `--change` when changes exist is a
 * missing-option error, an existing change renders its per-artifact progress, and
 * `printStatusText` renders a done/ready/blocked snapshot directly.
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

import { statusCommand, printStatusText } from '../../../src/commands/workflow/status.js';
import type { ChangeStatus } from '../../../src/core/artifact-graph/index.js';

function planningHomeFor(root: string) {
  return {
    kind: 'repo' as const,
    root,
    changesDir: path.join(root, '.ratchet', 'changes'),
    batchesDir: path.join(root, '.ratchet', 'batches'),
    defaultSchema: 'ratchet',
  };
}

describe('statusCommand', () => {
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

  it('reports no active changes instead of erroring', async () => {
    await statusCommand({});
    expect(output()).toContain('No active changes');
  });

  it('emits an empty changes payload with --json when there are no changes', async () => {
    await statusCommand({ json: true });

    const parsed = JSON.parse(output()) as { changes: unknown[]; message: string };
    expect(parsed.changes).toEqual([]);
    expect(parsed.message).toMatch(/No active changes/);
  });

  it('throws a missing-option error listing available changes when --change is omitted', async () => {
    await fixture.writeValidChange('alpha');
    await fixture.writeValidChange('beta');

    await expect(statusCommand({})).rejects.toThrow(/Missing required option --change/);
    await expect(statusCommand({})).rejects.toThrow(/alpha/);
    await expect(statusCommand({})).rejects.toThrow(/beta/);
  });

  it('renders the change name, schema, and per-artifact progress for an existing change', async () => {
    await fixture.writeValidChange('shipit');

    await statusCommand({ change: 'shipit' });

    const text = output();
    expect(text).toContain('Change: shipit');
    expect(text).toContain('Schema: ratchet');
    expect(text).toMatch(/Progress: \d+\/\d+ artifacts complete/);
  });
});

describe('printStatusText', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let priorNoColor: string | undefined;

  beforeEach(() => {
    priorNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (priorNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = priorNoColor;
    }
    vi.restoreAllMocks();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('renders each artifact line with its indicator and names blocked deps', () => {
    const status: ChangeStatus = {
      changeName: 'demo',
      schemaName: 'ratchet',
      changeRoot: '/tmp/demo',
      artifactPaths: {},
      nextSteps: [],
      actionContext: {} as ChangeStatus['actionContext'],
      isComplete: false,
      applyRequires: [],
      artifacts: [
        { id: 'features', outputPath: 'features/**/*.feature', status: 'done' },
        { id: 'plan', outputPath: 'plan.md', status: 'ready' },
        {
          id: 'tasks',
          outputPath: 'tasks.md',
          status: 'blocked',
          missingDeps: ['plan'],
        },
      ],
    };

    printStatusText(status);

    const text = output();
    expect(text).toContain('Change: demo');
    expect(text).toContain('Schema: ratchet');
    expect(text).toContain('Progress: 1/3 artifacts complete');
    expect(text).toContain('[x] features');
    expect(text).toContain('[ ] plan');
    expect(text).toContain('[-] tasks');
    expect(text).toContain('blocked by: plan');
  });
});
