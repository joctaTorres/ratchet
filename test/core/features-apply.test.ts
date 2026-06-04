import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  findFeatureUpdates,
  applyFeatures,
  readTombstones,
} from '../../src/core/features-apply.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

describe('features-apply', () => {
  let root: string;
  let changeDir: string;
  let storeDir: string;
  const changeName = 'add-login';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-features-apply-'));
    changeDir = path.join(root, RATCHET_DIR_NAME, 'changes', changeName);
    storeDir = path.join(root, RATCHET_DIR_NAME, 'features');
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('findFeatureUpdates', () => {
    it('globs nested **/*.feature and pairs them with store targets', async () => {
      await writeFile(path.join(changeDir, 'features', 'user-auth', 'login.feature'), 'Feature: Login');
      await writeFile(path.join(changeDir, 'features', 'user-auth', 'logout.feature'), 'Feature: Logout');
      await writeFile(path.join(changeDir, 'features', 'billing', 'invoice.feature'), 'Feature: Invoice');
      // Non-feature files are ignored.
      await writeFile(path.join(changeDir, 'features', 'README.md'), 'ignore me');

      const updates = await findFeatureUpdates(changeDir, storeDir);

      expect(updates.map(u => u.rel)).toEqual([
        'billing/invoice.feature',
        'user-auth/login.feature',
        'user-auth/logout.feature',
      ]);
      const login = updates.find(u => u.rel === 'user-auth/login.feature')!;
      expect(login.capability).toBe('user-auth');
      expect(login.target).toBe(path.join(storeDir, 'user-auth', 'login.feature'));
      expect(login.exists).toBe(false);
    });

    it('reports exists=true when the store already has the file', async () => {
      await writeFile(path.join(changeDir, 'features', 'user-auth', 'login.feature'), 'Feature: Login');
      await writeFile(path.join(storeDir, 'user-auth', 'login.feature'), 'Feature: Login (old)');

      const updates = await findFeatureUpdates(changeDir, storeDir);
      expect(updates).toHaveLength(1);
      expect(updates[0].exists).toBe(true);
    });

    it('returns [] when the change has no features directory', async () => {
      const updates = await findFeatureUpdates(changeDir, storeDir);
      expect(updates).toEqual([]);
    });
  });

  describe('readTombstones', () => {
    it('parses paths, ignoring blanks and # comments', async () => {
      await writeFile(
        path.join(changeDir, 'features', '.deleted'),
        '# remove old capability\nuser-auth/legacy.feature\n\n  billing/old.feature  \n# trailing comment\n'
      );
      const tombstones = await readTombstones(changeDir);
      expect(tombstones.sort()).toEqual(['billing/old.feature', 'user-auth/legacy.feature']);
    });

    it('returns [] when no .deleted file exists', async () => {
      expect(await readTombstones(changeDir)).toEqual([]);
    });
  });

  describe('applyFeatures', () => {
    it('classifies add vs overwrite vs unchanged by byte-compare', async () => {
      // added: not in store
      await writeFile(path.join(changeDir, 'features', 'user-auth', 'login.feature'), 'Feature: Login\n');
      // overwritten: in store with different bytes
      await writeFile(path.join(changeDir, 'features', 'user-auth', 'logout.feature'), 'Feature: Logout NEW\n');
      await writeFile(path.join(storeDir, 'user-auth', 'logout.feature'), 'Feature: Logout OLD\n');
      // unchanged: in store with identical bytes
      await writeFile(path.join(changeDir, 'features', 'billing', 'invoice.feature'), 'Feature: Invoice\n');
      await writeFile(path.join(storeDir, 'billing', 'invoice.feature'), 'Feature: Invoice\n');

      const result = await applyFeatures(root, changeName, {});

      expect(result.added).toBe(1);
      expect(result.overwritten).toBe(1);
      expect(result.unchanged).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.noChanges).toBe(false);

      // Whole-file copy: store now byte-identical to the change file.
      const stored = await fs.readFile(path.join(storeDir, 'user-auth', 'login.feature'), 'utf-8');
      expect(stored).toBe('Feature: Login\n');
      const overwritten = await fs.readFile(path.join(storeDir, 'user-auth', 'logout.feature'), 'utf-8');
      expect(overwritten).toBe('Feature: Logout NEW\n');
    });

    it('summarizes per capability', async () => {
      await writeFile(path.join(changeDir, 'features', 'user-auth', 'login.feature'), 'a\n');
      await writeFile(path.join(changeDir, 'features', 'user-auth', 'logout.feature'), 'b\n');
      await writeFile(path.join(changeDir, 'features', 'billing', 'invoice.feature'), 'c\n');

      const result = await applyFeatures(root, changeName, {});
      const byCap = Object.fromEntries(result.byCapability.map(c => [c.capability, c]));
      expect(byCap['user-auth'].added).toBe(2);
      expect(byCap['billing'].added).toBe(1);
    });

    it('removes store files listed in features/.deleted', async () => {
      await writeFile(path.join(storeDir, 'user-auth', 'legacy.feature'), 'old\n');
      await writeFile(path.join(storeDir, 'billing', 'kept.feature'), 'keep\n');
      await writeFile(
        path.join(changeDir, 'features', '.deleted'),
        'user-auth/legacy.feature\nuser-auth/missing.feature\n'
      );

      const result = await applyFeatures(root, changeName, {});

      // Only the existing tombstoned path counts.
      expect(result.deleted).toBe(1);
      await expect(
        fs.access(path.join(storeDir, 'user-auth', 'legacy.feature'))
      ).rejects.toThrow();
      // Untargeted file is preserved.
      await expect(
        fs.access(path.join(storeDir, 'billing', 'kept.feature'))
      ).resolves.toBeUndefined();
      const cap = result.byCapability.find(c => c.capability === 'user-auth')!;
      expect(cap.deleted).toBe(1);
    });

    it('does not write anything in dry-run mode', async () => {
      await writeFile(path.join(changeDir, 'features', 'user-auth', 'login.feature'), 'Feature: Login\n');
      await writeFile(path.join(storeDir, 'user-auth', 'old.feature'), 'old\n');
      await writeFile(path.join(changeDir, 'features', '.deleted'), 'user-auth/old.feature\n');

      const result = await applyFeatures(root, changeName, { dryRun: true });

      expect(result.added).toBe(1);
      expect(result.deleted).toBe(1);
      // No file was actually created...
      await expect(
        fs.access(path.join(storeDir, 'user-auth', 'login.feature'))
      ).rejects.toThrow();
      // ...and the tombstoned file still exists.
      await expect(
        fs.access(path.join(storeDir, 'user-auth', 'old.feature'))
      ).resolves.toBeUndefined();
    });

    it('reports noChanges when nothing was added/overwritten/deleted', async () => {
      await writeFile(path.join(changeDir, 'features', 'user-auth', 'login.feature'), 'same\n');
      await writeFile(path.join(storeDir, 'user-auth', 'login.feature'), 'same\n');

      const result = await applyFeatures(root, changeName, {});
      expect(result.unchanged).toBe(1);
      expect(result.noChanges).toBe(true);
    });

    it('throws when the change does not exist', async () => {
      await expect(applyFeatures(root, 'nope', {})).rejects.toThrow(/not found/);
    });
  });
});
