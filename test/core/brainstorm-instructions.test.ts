/**
 * Unit tests for the brainstorm instructions payload builder and command.
 *
 * Implements features/brainstorm/instructions-payload.feature: the payload
 * always carries a `spikes` object with an `enabled` boolean; `enabled` is
 * true only when `.ratchet/config.yaml` carries `brainstorm.spikes: true`;
 * an absent section, an absent config, no planning root, or an unreadable /
 * malformed config resolves to `false`; and the command emits the payload as
 * JSON (with `--json`) or as a single `spikes.enabled: <true|false>` line,
 * always resolving cleanly (never throwing, so the CLI exits zero).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildBrainstormInstructionsPayload,
  type BrainstormInstructionsPayload,
} from '../../src/core/brainstorm-instructions.js';
import { brainstormInstructionsCommand } from '../../src/commands/workflow/instructions.js';

describe('brainstorm-instructions', () => {
  let tempDir: string;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-brainstorm-instructions-'));
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleWarnSpy.mockRestore();
  });

  function writeConfig(content: string): void {
    const configDir = path.join(tempDir, '.ratchet');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.yaml'), content);
  }

  describe('buildBrainstormInstructionsPayload', () => {
    it('always carries a spikes object with an enabled boolean', () => {
      const payload = buildBrainstormInstructionsPayload(tempDir);

      expect(payload).toHaveProperty('spikes');
      expect(typeof payload.spikes.enabled).toBe('boolean');
    });

    it('reports spikes enabled as true when config sets brainstorm.spikes: true', () => {
      writeConfig('schema: ratchet\nbrainstorm:\n  spikes: true\n');

      const payload = buildBrainstormInstructionsPayload(tempDir);

      expect(payload).toEqual({ spikes: { enabled: true } });
    });

    it('reports spikes enabled as false when config sets brainstorm.spikes: false', () => {
      writeConfig('schema: ratchet\nbrainstorm:\n  spikes: false\n');

      const payload = buildBrainstormInstructionsPayload(tempDir);

      expect(payload).toEqual({ spikes: { enabled: false } });
    });

    it('reports spikes enabled as false when the config names no brainstorm section', () => {
      writeConfig('schema: ratchet\n');

      const payload = buildBrainstormInstructionsPayload(tempDir);

      expect(payload).toEqual({ spikes: { enabled: false } });
    });

    it('reports spikes enabled as false from a directory with no .ratchet root above it', () => {
      const payload = buildBrainstormInstructionsPayload(tempDir);

      expect(payload).toEqual({ spikes: { enabled: false } });
    });

    it('reports spikes enabled as false when the config cannot be parsed', () => {
      writeConfig('schema: [unclosed\n  {{{\n');

      const payload = buildBrainstormInstructionsPayload(tempDir);

      expect(payload).toEqual({ spikes: { enabled: false } });
    });

    it('reports spikes enabled as false when the brainstorm section is malformed', () => {
      writeConfig('schema: ratchet\nbrainstorm:\n  spikes: maybe\n');

      const payload = buildBrainstormInstructionsPayload(tempDir);

      expect(payload).toEqual({ spikes: { enabled: false } });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid 'brainstorm' field")
      );
    });

    it('resolves to disabled (never throwing) when an internal failure throws', async () => {
      // Force the catch-all: planning-root resolution itself throws, and the
      // builder must still resolve to the disabled payload rather than throw.
      vi.resetModules();
      vi.doMock('../../src/core/planning-home.js', () => ({
        findRepoPlanningRootSync: () => {
          throw new Error('simulated internal failure');
        },
      }));
      try {
        const { buildBrainstormInstructionsPayload: build } = await import(
          '../../src/core/brainstorm-instructions.js'
        );

        let payload: BrainstormInstructionsPayload | undefined;
        expect(() => {
          payload = build(tempDir);
        }).not.toThrow();
        expect(payload).toEqual({ spikes: { enabled: false } });
      } finally {
        vi.doUnmock('../../src/core/planning-home.js');
        vi.resetModules();
      }
    });
  });

  describe('brainstormInstructionsCommand', () => {
    let cwd: string;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      cwd = process.cwd();
      process.chdir(tempDir);
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      process.chdir(cwd);
      consoleLogSpy.mockRestore();
    });

    function loggedStdout(): string {
      return consoleLogSpy.mock.calls.map((call) => String(call[0])).join('\n');
    }

    it('emits the payload as parseable JSON with --json and resolves cleanly', async () => {
      writeConfig('schema: ratchet\nbrainstorm:\n  spikes: true\n');

      await expect(brainstormInstructionsCommand({ json: true })).resolves.toBeUndefined();

      const parsed = JSON.parse(loggedStdout());
      expect(parsed).toEqual({ spikes: { enabled: true } });
    });

    it('emits one "spikes.enabled: <true|false>" line without --json and resolves cleanly', async () => {
      writeConfig('schema: ratchet\nbrainstorm:\n  spikes: false\n');

      await expect(brainstormInstructionsCommand({})).resolves.toBeUndefined();

      expect(loggedStdout()).toBe('spikes.enabled: false');
    });

    it('resolves cleanly with no ratchet root, reporting disabled', async () => {
      await expect(brainstormInstructionsCommand({ json: true })).resolves.toBeUndefined();

      const parsed = JSON.parse(loggedStdout());
      expect(parsed).toEqual({ spikes: { enabled: false } });
    });
  });
});
