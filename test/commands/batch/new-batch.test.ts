/**
 * Integration tests for the `new batch` verb.
 *
 * Implements features/batch-command-tests/new-batch.feature: scaffold-from-template
 * over an isolated tmpdir fixture repo — the name is validated as kebab-case, an
 * existing batch is never clobbered, and a created manifest is stamped with the
 * batch name. The template resolves from the package's built-in schemas.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { makeBatchFixture, type BatchFixture } from './batch-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { newBatchCommand } from '../../../src/commands/batch/new-batch.js';

describe('newBatchCommand', () => {
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

  it('rejects a missing name', async () => {
    await expect(newBatchCommand(undefined, {})).rejects.toThrow(/<name>/);
  });

  it('rejects a non-kebab-case name', async () => {
    await expect(newBatchCommand('Bad_Name', {})).rejects.toThrow(/kebab-case/);
  });

  it('scaffolds a manifest stamped with the batch name', async () => {
    await newBatchCommand('my-new-batch', {});

    const content = await fs.readFile(fixture.manifestPath('my-new-batch'), 'utf-8');
    expect(content).toMatch(/^name: my-new-batch$/m);
    expect(output()).toContain('.ratchet/batches/my-new-batch/batch.yaml');
  });

  it('refuses to overwrite an existing batch', async () => {
    await fixture.writeManifestRaw('already-here', 'name: already-here\nsentinel: keep\n');
    const before = await fs.readFile(fixture.manifestPath('already-here'), 'utf-8');

    await expect(newBatchCommand('already-here', {})).rejects.toThrow(/already exists/);

    const after = await fs.readFile(fixture.manifestPath('already-here'), 'utf-8');
    expect(after).toBe(before);
  });

  it('emits the created batch name and path with --json', async () => {
    await newBatchCommand('json-batch', { json: true });

    const parsed = JSON.parse(output()) as { batch: { name: string; path: string } };
    expect(parsed.batch.name).toBe('json-batch');
    expect(parsed.batch.path).toBe(fixture.manifestPath('json-batch'));
  });
});
