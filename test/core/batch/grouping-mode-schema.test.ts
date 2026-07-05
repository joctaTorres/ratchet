/**
 * features/grouping-mode-schema/schema.feature
 *
 * The batch `prGrouping` setting additionally accepts the stacked `per-phase` and
 * `per-change` modes alongside the existing `off` (default) and `whole-batch`,
 * validated identically at the project-config and per-change manifest scopes, and
 * the shared grouping-active predicate treats every non-`off` mode as active.
 * Proven at the unit layer: the two inline schema enums, the vocabulary source of
 * truth `PR_GROUPING_VALUES`, `isPrGroupingActive`, and `resolveBatchSettings`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  PR_GROUPING_VALUES,
  isPrGroupingActive,
  resolveBatchSettings,
  type PrGrouping,
} from '../../../src/core/batch/config.js';
import { ProjectConfigSchema } from '../../../src/core/project-config.js';
import {
  BatchSettingsOverrideSchema,
  type BatchManifest,
} from '../../../src/core/batch/manifest.js';

// The two inline `prGrouping` z.enum sites — project-config `batch` scope and the
// per-change manifest override scope — must validate identically. Exercise both
// through one table so a drift between them is a test failure.
const SCHEMAS: { scope: string; parse: (prGrouping: string) => { success: boolean } }[] = [
  {
    scope: 'project-config',
    parse: (prGrouping) => ProjectConfigSchema.shape.batch.safeParse({ prGrouping }),
  },
  {
    scope: 'manifest',
    parse: (prGrouping) => BatchSettingsOverrideSchema.safeParse({ prGrouping }),
  },
];

describe('prGrouping vocabulary at both schema scopes (schema.feature)', () => {
  for (const { scope, parse } of SCHEMAS) {
    describe(`${scope} scope`, () => {
      it('accepts the new stacked modes per-phase / per-change', () => {
        expect(parse('per-phase').success).toBe(true);
        expect(parse('per-change').success).toBe(true);
      });

      it('still accepts the existing off / whole-batch modes', () => {
        expect(parse('off').success).toBe(true);
        expect(parse('whole-batch').success).toBe(true);
      });

      it('rejects an invalid mode (per-batch, bogus)', () => {
        expect(parse('per-batch').success).toBe(false);
        expect(parse('bogus').success).toBe(false);
      });

      // Drift guard: the schema must accept EXACTLY the members of the vocabulary
      // source of truth and reject a value outside it, so an out-of-sync inline
      // enum fails CI rather than silently diverging.
      it('accepts exactly the members of PR_GROUPING_VALUES', () => {
        for (const mode of PR_GROUPING_VALUES) {
          expect(parse(mode).success).toBe(true);
        }
        expect(parse('__not-a-mode__').success).toBe(false);
      });
    });
  }
});

describe('isPrGroupingActive — the shared grouping-active predicate', () => {
  it('reports off as inactive', () => {
    expect(isPrGroupingActive('off')).toBe(false);
  });

  it('reports every non-off mode as active', () => {
    for (const mode of PR_GROUPING_VALUES.filter((m) => m !== 'off') as PrGrouping[]) {
      expect(isPrGroupingActive(mode)).toBe(true);
    }
    // Spelled out so the intent is explicit, not only table-derived.
    expect(isPrGroupingActive('whole-batch')).toBe(true);
    expect(isPrGroupingActive('per-phase')).toBe(true);
    expect(isPrGroupingActive('per-change')).toBe(true);
  });
});

describe('resolveBatchSettings — prGrouping default and overrides', () => {
  let projectRoot: string;
  let userConfigHome: string;
  let priorXdgConfigHome: string | undefined;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grouping-mode-'));
    await fs.mkdir(path.join(projectRoot, '.ratchet'), { recursive: true });
    // Isolate the user/global scope so resolution never reads the real machine's
    // ~/.config/ratchet.
    userConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'grouping-mode-xdg-'));
    priorXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userConfigHome;
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(userConfigHome, { recursive: true, force: true });
    if (priorXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = priorXdgConfigHome;
  });

  async function writeConfig(content: string): Promise<void> {
    await fs.writeFile(path.join(projectRoot, '.ratchet', 'config.yaml'), content, 'utf-8');
  }

  it('defaults prGrouping to off from the built-in default when unset', async () => {
    await writeConfig('schema: ratchet\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.prGrouping).toBe('off');
    expect(sources.prGrouping).toBe('default');
  });

  it('honors a project-config override to a new stacked mode', async () => {
    await writeConfig('schema: ratchet\nbatch:\n  prGrouping: per-phase\n');
    const { settings, sources } = resolveBatchSettings(projectRoot);
    expect(settings.prGrouping).toBe('per-phase');
    expect(sources.prGrouping).toBe('project');
  });

  it('honors a per-change manifest override to a new stacked mode', async () => {
    await writeConfig('schema: ratchet\n');
    const manifest = { settings: { prGrouping: 'per-change' } } as unknown as BatchManifest;
    const { settings, sources } = resolveBatchSettings(projectRoot, manifest);
    expect(settings.prGrouping).toBe('per-change');
    expect(sources.prGrouping).toBe('manifest');
  });
});
