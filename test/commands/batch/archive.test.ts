import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BatchArchiveResult } from '../../../src/core/batch/archive.js';

/**
 * Behavioral tests for the `batch archive` command shell. The core
 * `archiveBatch` engine, batch resolution, and planning-home lookup are MOCKED
 * so these assert the command's CONTRACT — JSON vs human summary rendering —
 * deterministically, without touching the filesystem.
 */
const { archiveBatchMock, resolveBatchNameMock, resolvePlanningHomeMock } = vi.hoisted(() => ({
  archiveBatchMock: vi.fn(),
  resolveBatchNameMock: vi.fn(),
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/batch/archive.js', () => ({
  archiveBatch: archiveBatchMock,
}));

vi.mock('../../../src/commands/batch/shared.js', () => ({
  resolveBatchName: resolveBatchNameMock,
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { batchArchiveCommand } from '../../../src/commands/batch/archive.js';

const fullResult: BatchArchiveResult = {
  batchName: 'rex-agent-runtime',
  archivedChanges: ['engine-runtime', 'rex-bootstrap'],
  skippedArchived: ['old-change'],
  skippedPending: ['future-work'],
  archivePath: '.ratchet/batches/archive/2026-06-17-rex-agent-runtime',
};

describe('batchArchiveCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: '/project' });
    resolveBatchNameMock.mockReturnValue('rex-agent-runtime');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /** All console.log calls joined for substring assertions. */
  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('renders the JSON result and prints no human summary with --json', async () => {
    archiveBatchMock.mockResolvedValue(fullResult);

    await batchArchiveCommand('rex-agent-runtime', { json: true });

    // The core was invoked with a no-op log sink (JSON mode owns output).
    expect(archiveBatchMock).toHaveBeenCalledWith(
      '/project',
      'rex-agent-runtime',
      expect.objectContaining({ log: expect.any(Function) })
    );
    const out = output();
    expect(out).toBe(JSON.stringify(fullResult, null, 2));
    // No human-readable summary lines leak into JSON mode.
    expect(out).not.toMatch(/✓ Batch/);
  });

  it('renders the human summary with archived / skipped lines', async () => {
    archiveBatchMock.mockResolvedValue(fullResult);

    await batchArchiveCommand('rex-agent-runtime', {});

    const out = output();
    expect(out).toMatch(/✓ Batch 'rex-agent-runtime' archived\./);
    expect(out).toContain('Changes archived: engine-runtime, rex-bootstrap');
    expect(out).toContain('Already archived (skipped): old-change');
    expect(out).toContain('Pending / never created (skipped): future-work');
  });

  it('omits empty skipped sections from the summary', async () => {
    archiveBatchMock.mockResolvedValue({
      batchName: 'rex-agent-runtime',
      archivedChanges: ['engine-runtime'],
      skippedArchived: [],
      skippedPending: [],
      archivePath: '.ratchet/batches/archive/2026-06-17-rex-agent-runtime',
    } satisfies BatchArchiveResult);

    await batchArchiveCommand('rex-agent-runtime', {});

    const out = output();
    expect(out).toContain('Changes archived: engine-runtime');
    expect(out).not.toMatch(/Already archived/);
    expect(out).not.toMatch(/Pending \/ never created/);
  });

  it('prints nothing extra when the archive was aborted', async () => {
    archiveBatchMock.mockResolvedValue({
      batchName: 'rex-agent-runtime',
      archivedChanges: [],
      skippedArchived: [],
      skippedPending: [],
      aborted: true,
    } satisfies BatchArchiveResult);

    await batchArchiveCommand('rex-agent-runtime', {});

    // The core already logged "Archive cancelled."; the wrapper adds no summary.
    expect(output()).not.toMatch(/✓ Batch/);
  });

  it('forwards the --yes flag to the core', async () => {
    archiveBatchMock.mockResolvedValue(fullResult);

    await batchArchiveCommand('rex-agent-runtime', { yes: true });

    expect(archiveBatchMock).toHaveBeenCalledWith(
      '/project',
      'rex-agent-runtime',
      expect.objectContaining({ yes: true })
    );
  });
});
