import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

// Mock posthog-node before importing the module
vi.mock('posthog-node', () => {
  return {
    PostHog: vi.fn().mockImplementation(() => ({
      capture: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// Import after mocking
import { isTelemetryEnabled, maybeShowTelemetryNotice, shutdown, trackCommand } from '../../src/telemetry/index.js';
import { PostHog } from 'posthog-node';

/**
 * Telemetry is permanently neutralized in ratchet: no PostHog API key is
 * configured, so isTelemetryEnabled() is always false, no client is ever
 * constructed, and no notice is shown — regardless of env vars.
 */
describe('telemetry/index (neutralized)', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `ratchet-telemetry-test-${randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env.HOME = tempDir;

    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    await shutdown();
    vi.restoreAllMocks();
  });

  describe('isTelemetryEnabled', () => {
    it('is always disabled (no API key configured)', () => {
      delete process.env.RATCHET_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;
      expect(isTelemetryEnabled()).toBe(false);
    });

    it('stays disabled even with explicit opt-out cleared', () => {
      process.env.RATCHET_TELEMETRY = '1';
      expect(isTelemetryEnabled()).toBe(false);
    });
  });

  describe('maybeShowTelemetryNotice', () => {
    it('never shows a notice', async () => {
      delete process.env.RATCHET_TELEMETRY;
      await maybeShowTelemetryNotice();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('trackCommand', () => {
    it('never constructs a PostHog client', async () => {
      delete process.env.RATCHET_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;
      await trackCommand('test', '1.0.0');
      expect(PostHog).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('does not throw when no client exists', async () => {
      await expect(shutdown()).resolves.not.toThrow();
    });
  });
});

/**
 * getOrCreateAnonymousId is reachable even though telemetry is neutralized: it
 * lazily generates a UUID, persists it through the config layer, caches it on
 * the module, and reuses the cached/stored value on later calls.
 *
 * Implements features/ui-telemetry/telemetry-anonymous-id.feature. Each case
 * isolates the config via XDG_CONFIG_HOME under os.tmpdir() and uses
 * vi.resetModules() + a fresh dynamic import so the module-level id cache does
 * not leak between tests.
 */
describe('telemetry/index getOrCreateAnonymousId (config-isolated)', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  // Telemetry config lives at $XDG_CONFIG_HOME/ratchet/config.json.
  function configPath(): string {
    return path.join(tempDir, 'ratchet', 'config.json');
  }

  function readPersistedId(): string | undefined {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
      return raw?.telemetry?.anonymousId;
    } catch {
      return undefined;
    }
  }

  function writePersistedId(id: string): void {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ telemetry: { anonymousId: id } }, null, 2) + '\n');
  }

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `ratchet-anonid-test-${randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = tempDir;
    // Avoid legacy-config migration reading the real ~/.config during tests.
    process.env.HOME = tempDir;

    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.restoreAllMocks();
  });

  it('generates and persists a new anonymous id on the first call', async () => {
    expect(readPersistedId()).toBeUndefined();

    const mod = await import('../../src/telemetry/index.js');
    const id = await mod.getOrCreateAnonymousId();

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    // The same id is written into the telemetry config on disk.
    expect(readPersistedId()).toBe(id);
  });

  it('loads an existing anonymous id from config rather than regenerating it', async () => {
    const existing = 'preexisting-0000-1111-2222-333344445555';
    writePersistedId(existing);

    const mod = await import('../../src/telemetry/index.js');
    const id = await mod.getOrCreateAnonymousId();

    expect(id).toBe(existing);
  });

  it('caches the id after the first call without re-reading config', async () => {
    const mod = await import('../../src/telemetry/index.js');
    const first = await mod.getOrCreateAnonymousId();

    // Remove the on-disk config: a second call that re-read config would now
    // generate a different id, so an identical return proves the module cache.
    fs.rmSync(configPath(), { force: true });

    const second = await mod.getOrCreateAnonymousId();
    expect(second).toBe(first);
    // Cache hit means nothing was re-written to disk.
    expect(readPersistedId()).toBeUndefined();
  });

  it('shutdown resolves without throwing when no client was ever created', async () => {
    const mod = await import('../../src/telemetry/index.js');
    await expect(mod.shutdown()).resolves.not.toThrow();
  });
});
