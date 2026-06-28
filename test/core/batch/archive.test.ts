import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { archiveBatch } from '../../../src/core/batch/archive.js';
import { appendJournal } from '../../../src/core/batch/journal.js';

let projectRoot: string;
let batchesDir: string;
let changesDir: string;

const BATCH_NAME = 'rex-agent-runtime';
const DATE = '2026-06-17';

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-archive-'));
  batchesDir = path.join(projectRoot, '.ratchet', 'batches');
  changesDir = path.join(projectRoot, '.ratchet', 'changes');
  await fs.mkdir(batchesDir, { recursive: true });
  await fs.mkdir(changesDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/**
 * Write a two-phase manifest: `foundation` (engine-runtime) before `runtime`
 * (rex-bootstrap), mirroring the feature's phase-order scenario.
 */
async function writeManifest(): Promise<void> {
  const manifest = `name: ${BATCH_NAME}
phases:
  - name: foundation
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: x
      pass: '0'
    changes:
      - name: engine-runtime
        done: the engine runs
  - name: runtime
    goal: g
    success: s
    proofOfWork:
      kind: integration
      run: x
      pass: '0'
    changes:
      - name: rex-bootstrap
        done: rex boots
`;
  const dir = path.join(batchesDir, BATCH_NAME);
  await fs.mkdir(path.join(dir, 'run'), { recursive: true });
  await fs.writeFile(path.join(dir, 'batch.yaml'), manifest, 'utf-8');
  // A run journal that must travel with the batch directory into the archive.
  await fs.writeFile(
    path.join(dir, 'run', 'journal.jsonl'),
    JSON.stringify({ at: '2026-06-17T00:00:00Z', change: 'engine-runtime', kind: 'progress', message: 'ok' }) + '\n',
    'utf-8'
  );
}

/**
 * Create a member change. `done: true` means done under the single journal-aware
 * rule — all tasks checked AND a verify completion journaled; `done: false`
 * leaves a task open (in-progress).
 */
async function makeChange(name: string, done: boolean): Promise<void> {
  const dir = path.join(changesDir, name);
  await fs.mkdir(dir, { recursive: true });
  const tasks = done ? '- [x] one\n- [x] two\n' : '- [x] one\n- [ ] two\n';
  await fs.writeFile(path.join(dir, 'plan.md'), `## Tasks\n${tasks}`, 'utf-8');
  if (done) {
    appendJournal(projectRoot, BATCH_NAME, {
      change: name,
      kind: 'completion',
      message: 'verified',
      transition: 'verify',
    });
  }
}

/** Mark a member change as already archived under changes/archive. */
async function archiveChangeDir(name: string): Promise<void> {
  await fs.mkdir(path.join(changesDir, 'archive', name), { recursive: true });
}

describe('archiveBatch', () => {
  describe('cascade', () => {
    it('archives member changes in phase order', async () => {
      await writeManifest();
      await makeChange('engine-runtime', true);
      await makeChange('rex-bootstrap', true);

      const order: string[] = [];
      const result = await archiveBatch(projectRoot, BATCH_NAME, {
        yes: true,
        date: DATE,
        log: () => {},
        archiveChange: async (name) => {
          order.push(name);
        },
      });

      expect(order).toEqual(['engine-runtime', 'rex-bootstrap']);
      expect(result.archivedChanges).toEqual(['engine-runtime', 'rex-bootstrap']);
    });

    it('skips already-archived member changes without re-archiving or erroring', async () => {
      await writeManifest();
      await archiveChangeDir('engine-runtime');
      await makeChange('rex-bootstrap', true);

      const order: string[] = [];
      const result = await archiveBatch(projectRoot, BATCH_NAME, {
        yes: true,
        date: DATE,
        log: () => {},
        archiveChange: async (name) => {
          order.push(name);
        },
      });

      expect(order).toEqual(['rex-bootstrap']);
      expect(result.archivedChanges).toEqual(['rex-bootstrap']);
      expect(result.skippedArchived).toEqual(['engine-runtime']);
    });

    it('skips change intents that were never created (pending)', async () => {
      await writeManifest();
      // engine-runtime exists/done; rex-bootstrap intent has no change dir.
      await makeChange('engine-runtime', true);

      const order: string[] = [];
      const result = await archiveBatch(projectRoot, BATCH_NAME, {
        yes: true,
        date: DATE,
        log: () => {},
        archiveChange: async (name) => {
          order.push(name);
        },
      });

      expect(order).toEqual(['engine-runtime']);
      expect(result.skippedPending).toEqual(['rex-bootstrap']);
    });
  });

  describe('batch move', () => {
    it('moves the batch directory under the archive, preserving manifest + run journal', async () => {
      await writeManifest();
      await makeChange('engine-runtime', true);
      await makeChange('rex-bootstrap', true);

      const result = await archiveBatch(projectRoot, BATCH_NAME, {
        yes: true,
        date: DATE,
        log: () => {},
        archiveChange: async () => {},
      });

      const archivePath = path.join(batchesDir, 'archive', `${DATE}-${BATCH_NAME}`);
      expect(existsSync(path.join(batchesDir, BATCH_NAME))).toBe(false);
      expect(existsSync(archivePath)).toBe(true);
      expect(existsSync(path.join(archivePath, 'batch.yaml'))).toBe(true);
      expect(existsSync(path.join(archivePath, 'run', 'journal.jsonl'))).toBe(true);
      expect(result.archivePath).toBe(archivePath);
    });

    it('refuses to overwrite an existing archive entry and leaves the batch in place', async () => {
      await writeManifest();
      await makeChange('engine-runtime', true);
      await makeChange('rex-bootstrap', true);
      await fs.mkdir(path.join(batchesDir, 'archive', `${DATE}-${BATCH_NAME}`), {
        recursive: true,
      });

      let cascadeRan = false;
      await expect(
        archiveBatch(projectRoot, BATCH_NAME, {
          yes: true,
          date: DATE,
          log: () => {},
          archiveChange: async () => {
            cascadeRan = true;
          },
        })
      ).rejects.toThrow(/already exists/i);

      // The active batch directory is untouched and the cascade never ran.
      expect(existsSync(path.join(batchesDir, BATCH_NAME))).toBe(true);
      expect(cascadeRan).toBe(false);
    });
  });

  describe('unknown batch', () => {
    it('fails clearly when the batch does not exist', async () => {
      await expect(
        archiveBatch(projectRoot, 'ghost-batch', { yes: true, log: () => {} })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('done gate', () => {
    it('archives a done batch without a confirmation prompt', async () => {
      await writeManifest();
      await makeChange('engine-runtime', true);
      await makeChange('rex-bootstrap', true);

      const logs: string[] = [];
      let confirmCalled = false;
      const result = await archiveBatch(projectRoot, BATCH_NAME, {
        date: DATE,
        log: (m) => logs.push(m),
        archiveChange: async () => {},
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      });

      expect(confirmCalled).toBe(false);
      expect(result.aborted).toBeUndefined();
      expect(logs.join('\n')).toContain('done');
      expect(logs.join('\n')).not.toMatch(/incomplete change/i);
    });

    it('warns and requires confirmation when the batch is incomplete', async () => {
      await writeManifest();
      await makeChange('engine-runtime', true);
      await makeChange('rex-bootstrap', false);

      const logs: string[] = [];
      let confirmCalled = false;
      const result = await archiveBatch(projectRoot, BATCH_NAME, {
        date: DATE,
        log: (m) => logs.push(m),
        archiveChange: async () => {},
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      });

      expect(confirmCalled).toBe(true);
      expect(logs.join('\n')).toMatch(/in-progress \(1\/2 changes done\)/);
      expect(logs.join('\n')).toMatch(/incomplete change\(s\): rex-bootstrap/);
      expect(result.aborted).toBeUndefined();
    });

    it('aborts without moving anything when the confirmation is declined', async () => {
      await writeManifest();
      await makeChange('engine-runtime', true);
      await makeChange('rex-bootstrap', false);

      const result = await archiveBatch(projectRoot, BATCH_NAME, {
        date: DATE,
        log: () => {},
        archiveChange: async () => {
          throw new Error('cascade must not run on decline');
        },
        confirm: async () => false,
      });

      expect(result.aborted).toBe(true);
      expect(existsSync(path.join(batchesDir, BATCH_NAME))).toBe(true);
      expect(existsSync(path.join(batchesDir, 'archive', `${DATE}-${BATCH_NAME}`))).toBe(false);
    });

    it('forces archiving an incomplete batch with --yes (no prompt, warning printed)', async () => {
      await writeManifest();
      await makeChange('engine-runtime', true);
      await makeChange('rex-bootstrap', false);

      const logs: string[] = [];
      let confirmCalled = false;
      const result = await archiveBatch(projectRoot, BATCH_NAME, {
        yes: true,
        date: DATE,
        log: (m) => logs.push(m),
        archiveChange: async () => {},
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      });

      expect(confirmCalled).toBe(false);
      expect(logs.join('\n')).toMatch(/incomplete change\(s\)/);
      expect(result.aborted).toBeUndefined();
      expect(existsSync(path.join(batchesDir, 'archive', `${DATE}-${BATCH_NAME}`))).toBe(true);
    });

    it('counts a parked change as incomplete and requires confirmation', async () => {
      await writeManifest();
      await makeChange('engine-runtime', true);
      // A not-yet-done change parked awaiting approval — surfaced as incomplete.
      await makeChange('rex-bootstrap', false);
      // Park rex-bootstrap awaiting approval via the run state.
      await fs.writeFile(
        path.join(batchesDir, BATCH_NAME, 'run', 'state.json'),
        JSON.stringify({
          parked: {
            'rex-bootstrap': {
              change: 'rex-bootstrap',
              kind: 'awaiting-approval',
              reason: 'please review',
              parkedAt: '2026-06-17T00:00:00Z',
            },
          },
        }),
        'utf-8'
      );

      let confirmCalled = false;
      await archiveBatch(projectRoot, BATCH_NAME, {
        date: DATE,
        log: () => {},
        archiveChange: async () => {},
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      });

      expect(confirmCalled).toBe(true);
    });
  });
});
