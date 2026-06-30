/**
 * Integration tests for the `new change` verb.
 *
 * Implements features/workflow-command-tests/new-change.feature: scaffold a
 * change over an isolated tmpdir fixture repo with `resolveCurrentPlanningHomeSync`
 * pointed at the fixture root — a valid name creates the directory and metadata,
 * `--json` emits the created payload, a description writes a README, and the
 * missing-name / invalid-name / unknown-schema paths report errors and exit
 * non-zero.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { makeCommandFixture, type CommandFixture } from '../change-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/core/planning-home.js')>();
  return { ...actual, resolveCurrentPlanningHomeSync: resolvePlanningHomeMock };
});

import { newChangeCommand } from '../../../src/commands/workflow/new-change.js';

function planningHomeFor(root: string) {
  return {
    kind: 'repo' as const,
    root,
    changesDir: path.join(root, '.ratchet', 'changes'),
    batchesDir: path.join(root, '.ratchet', 'batches'),
    defaultSchema: 'ratchet',
  };
}

describe('newChangeCommand', () => {
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
    process.exitCode = undefined;
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('scaffolds the change directory with metadata and prints location + schema', async () => {
    await newChangeCommand('add-widget', {});

    const changeDir = fixture.changeDir('add-widget');
    const stat = await fs.stat(changeDir);
    expect(stat.isDirectory()).toBe(true);

    const metadata = await fs.readFile(path.join(changeDir, '.ratchet.yaml'), 'utf-8');
    expect(metadata).toMatch(/schema: ratchet/);

    const text = output();
    expect(text).toContain("Created change 'add-widget'");
    expect(text).toContain('.ratchet/changes/add-widget');
    expect(text).toContain('Schema: ratchet');
  });

  it('emits the created change payload with --json', async () => {
    await newChangeCommand('json-change', { json: true });

    const parsed = JSON.parse(output()) as {
      change: { id: string; path: string; metadataPath: string; schema: string };
    };
    expect(parsed.change.id).toBe('json-change');
    expect(parsed.change.path).toBe(fixture.changeDir('json-change'));
    expect(parsed.change.metadataPath).toBe(
      path.join(fixture.changeDir('json-change'), '.ratchet.yaml')
    );
    expect(parsed.change.schema).toBe('ratchet');
  });

  it('writes a README.md carrying the description', async () => {
    await newChangeCommand('with-readme', { description: 'a vivid summary of intent' });

    const readme = await fs.readFile(
      path.join(fixture.changeDir('with-readme'), 'README.md'),
      'utf-8'
    );
    expect(readme).toContain('# with-readme');
    expect(readme).toContain('a vivid summary of intent');
  });

  it('rejects a missing name and exits non-zero under --json', async () => {
    await newChangeCommand(undefined, { json: true });

    const parsed = JSON.parse(output()) as {
      change: null;
      status: Array<{ code: string; message: string }>;
    };
    expect(parsed.change).toBeNull();
    expect(parsed.status[0].message).toMatch(/<name>/);
    expect(process.exitCode).toBe(1);
  });

  it('rejects an invalid name and exits non-zero under --json', async () => {
    await newChangeCommand('Bad_Name', { json: true });

    const parsed = JSON.parse(output()) as {
      change: null;
      status: Array<{ code: string; message: string }>;
    };
    expect(parsed.change).toBeNull();
    expect(parsed.status[0].message).toMatch(/underscores|lowercase|kebab/i);
    expect(process.exitCode).toBe(1);

    // The change directory must not have been created.
    await expect(fs.stat(fixture.changeDir('Bad_Name'))).rejects.toThrow();
  });

  it('rejects an unknown schema and exits non-zero under --json', async () => {
    await newChangeCommand('valid-name', { schema: 'no-such-schema', json: true });

    const parsed = JSON.parse(output()) as {
      change: null;
      status: Array<{ code: string; message: string }>;
    };
    expect(parsed.change).toBeNull();
    expect(parsed.status[0].message).toMatch(/Schema 'no-such-schema' not found/);
    expect(process.exitCode).toBe(1);
  });
});
