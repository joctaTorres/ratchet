/**
 * Unit/integration tests for the shared workflow helpers.
 *
 * Implements features/workflow-command-tests/shared.feature: the change/schema
 * guards (`getAvailableChanges`, `validateChangeExists`, `validateSchemaExists`)
 * are exercised as integration tests over an isolated tmpdir fixture repo, and
 * the pure status-rendering helpers (`getStatusIndicator`, `getStatusColor`) are
 * exercised as unit assertions under `NO_COLOR`. The fixture is removed in
 * afterEach so no artifacts are left behind.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { makeCommandFixture, type CommandFixture } from '../change-fixture.js';
import {
  getAvailableChanges,
  validateChangeExists,
  validateSchemaExists,
  getStatusIndicator,
  getStatusColor,
} from '../../../src/commands/workflow/shared.js';

describe('getAvailableChanges', () => {
  let fixture: CommandFixture;

  beforeEach(async () => {
    fixture = await makeCommandFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it('returns only real change dirs, excluding archive and hidden dirs', async () => {
    const changesDir = path.join(fixture.root, '.ratchet', 'changes');
    await fs.mkdir(path.join(changesDir, 'real-change'), { recursive: true });
    await fs.mkdir(path.join(changesDir, 'archive'), { recursive: true });
    await fs.mkdir(path.join(changesDir, '.hidden'), { recursive: true });

    const changes = await getAvailableChanges(fixture.root);
    expect(changes).toEqual(['real-change']);
  });

  it('returns an empty list when the changes directory is absent', async () => {
    const missing = path.join(fixture.root, 'nope', 'changes');
    await expect(getAvailableChanges(fixture.root, missing)).resolves.toEqual([]);
  });
});

describe('validateChangeExists', () => {
  let fixture: CommandFixture;
  let changesDir: string;

  beforeEach(async () => {
    fixture = await makeCommandFixture();
    changesDir = path.join(fixture.root, '.ratchet', 'changes');
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it('accepts an existing change and returns its name', async () => {
    await fixture.makeChange('exists');
    await expect(
      validateChangeExists('exists', fixture.root, changesDir)
    ).resolves.toBe('exists');
  });

  it('rejects a missing name by listing the available changes', async () => {
    await fixture.makeChange('one');
    await expect(
      validateChangeExists(undefined, fixture.root, changesDir)
    ).rejects.toThrow(/Missing required option --change[\s\S]*one/);
  });

  it('rejects an unknown change by listing the available changes', async () => {
    await fixture.makeChange('present');
    await expect(
      validateChangeExists('absent', fixture.root, changesDir)
    ).rejects.toThrow(/Change 'absent' not found[\s\S]*present/);
  });

  it('rejects a traversal name as an invalid name', async () => {
    await expect(
      validateChangeExists('../evil', fixture.root, changesDir)
    ).rejects.toThrow(/Invalid change name/);
  });
});

describe('validateSchemaExists', () => {
  it('rejects an unknown schema by listing the available schemas', () => {
    expect(() => validateSchemaExists('no-such-schema')).toThrow(
      /Schema 'no-such-schema' not found[\s\S]*Available schemas/
    );
  });
});

describe('status indicators and colors under NO_COLOR', () => {
  let priorNoColor: string | undefined;

  beforeEach(() => {
    priorNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
  });

  afterEach(() => {
    if (priorNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = priorNoColor;
    }
  });

  it('renders plain markers without color escape codes', () => {
    expect(getStatusIndicator('done')).toBe('[x]');
    expect(getStatusIndicator('ready')).toBe('[ ]');
    expect(getStatusIndicator('blocked')).toBe('[-]');
  });

  it('returns identity color functions that leave text untouched', () => {
    for (const status of ['done', 'ready', 'blocked'] as const) {
      const color = getStatusColor(status);
      expect(color('text')).toBe('text');
      expect(color('text')).not.toMatch(/\[/);
    }
  });
});
