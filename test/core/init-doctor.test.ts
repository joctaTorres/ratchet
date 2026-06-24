import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * First-init doctor integration. The advisory doctor runner is MOCKED so these
 * tests assert init's CONTRACT — doctor runs on first init, is skipped on
 * re-init, and never aborts setup — without invoking real PATH/process probes.
 */
const { runDoctorAdvisoryMock } = vi.hoisted(() => ({
  runDoctorAdvisoryMock: vi.fn(),
}));

vi.mock('../../src/commands/doctor.js', () => ({
  runDoctorAdvisory: runDoctorAdvisoryMock,
}));

const { searchableMultiSelectMock } = vi.hoisted(() => ({
  searchableMultiSelectMock: vi.fn(),
}));
vi.mock('../../src/prompts/searchable-multi-select.js', () => ({
  searchableMultiSelect: searchableMultiSelectMock,
}));
vi.mock('../../src/ui/welcome-screen.js', () => ({
  showWelcomeScreen: vi.fn().mockResolvedValue(undefined),
}));

import { InitCommand } from '../../src/core/init.js';

describe('init → doctor (first-run only)', () => {
  let testDir: string;
  let configTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ratchet-init-doctor-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    originalEnv = { ...process.env };
    configTempDir = path.join(os.tmpdir(), `ratchet-cfg-doctor-${Date.now()}-${Math.random()}`);
    await fs.mkdir(configTempDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configTempDir;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    runDoctorAdvisoryMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(configTempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runs doctor automatically on first init', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    expect(runDoctorAdvisoryMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-run doctor on a later init', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    runDoctorAdvisoryMock.mockReset();

    // Second init on the same dir = extend mode → doctor must NOT run.
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    expect(runDoctorAdvisoryMock).not.toHaveBeenCalled();
  });

  it('a throwing doctor never aborts first-time setup', async () => {
    runDoctorAdvisoryMock.mockImplementation(() => {
      throw new Error('doctor blew up');
    });

    await expect(
      new InitCommand({ tools: 'claude', force: true }).execute(testDir)
    ).resolves.toBeUndefined();

    // Setup still completed: the .ratchet structure exists.
    const ratchetPath = path.join(testDir, '.ratchet');
    const stat = await fs.stat(ratchetPath);
    expect(stat.isDirectory()).toBe(true);
    expect(runDoctorAdvisoryMock).toHaveBeenCalledTimes(1);
  });

  it('non-interactive first init still runs doctor without blocking (never prompts)', async () => {
    // `--tools claude` forces non-interactive mode (canPromptInteractively=false).
    await expect(
      new InitCommand({ tools: 'claude' }).execute(testDir)
    ).resolves.toBeUndefined();
    expect(runDoctorAdvisoryMock).toHaveBeenCalledTimes(1);
  });
});
