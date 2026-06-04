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
