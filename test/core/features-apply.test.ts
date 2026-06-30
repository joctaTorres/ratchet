// Mirrors .ratchet/changes/core-remainder-tests/features/core-remainder-tests/features-apply.feature
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import * as yaml from 'yaml';
import {
  findFeatureUpdates,
  applyFeatures,
  readTombstones,
  materializeStandardLinks,
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

  // Exercise the standard-link sidecar read/write helpers (readSidecar /
  // writeSidecar / updateForwardLinks) through the public materializeStandardLinks
  // entry point, which is the only exported caller of those internals. With no
  // standards directory present, regenerateReverseLinks is a safe no-op, so each
  // test isolates the forward-link sidecar behavior under .ratchet/features/.
  describe('materializeStandardLinks (sidecar read/write)', () => {
    const SIDECAR_FILENAME = '.ratchet.yaml';

    function sidecarPath(capability: string): string {
      return path.join(storeDir, capability, SIDECAR_FILENAME);
    }

    async function readSidecarFeatures(
      capability: string
    ): Promise<Record<string, unknown>> {
      const raw = await fs.readFile(sidecarPath(capability), 'utf-8');
      const parsed = yaml.parse(raw) as { features?: Record<string, unknown> };
      return parsed.features ?? {};
    }

    // Scenario: a malformed sidecar yaml is read as having no links.
    it('treats a malformed sidecar yaml as carrying no links rather than throwing', async () => {
      // A new feature for the capability, plus an existing malformed sidecar.
      await writeFile(
        path.join(changeDir, 'features', 'user-auth', 'login.feature'),
        'Feature: Login\n'
      );
      await writeFile(sidecarPath('user-auth'), ':\n  this is: not: valid: yaml: [');

      await expect(
        materializeStandardLinks(root, changeName, ['testing'])
      ).resolves.toBeUndefined();

      // The malformed prior content was read as empty links; only the freshly
      // materialized feature remains.
      const features = await readSidecarFeatures('user-auth');
      expect(features).toEqual({ 'login.feature': ['testing'] });
    });

    // Scenario: non-string link entries are filtered out when reading a sidecar.
    it('filters out non-string link entries when reading a sidecar', async () => {
      // Pre-existing sidecar entry mixes strings and non-strings.
      await writeFile(
        sidecarPath('user-auth'),
        yaml.stringify({
          features: {
            'existing.feature': ['testing', 42, null, 'security', { a: 1 }],
          },
        })
      );
      // A second feature for the same capability triggers a read+rewrite.
      await writeFile(
        path.join(changeDir, 'features', 'user-auth', 'login.feature'),
        'Feature: Login\n'
      );

      await materializeStandardLinks(root, changeName, ['testing']);

      const features = await readSidecarFeatures('user-auth');
      // The pre-existing entry retains only its string tags.
      expect(features['existing.feature']).toEqual(['security', 'testing']);
      expect(features['login.feature']).toEqual(['testing']);
    });

    // Scenario: written sidecar link tags are sorted and de-duplicated.
    it('writes link tags sorted and de-duplicated per capability', async () => {
      await writeFile(
        path.join(changeDir, 'features', 'user-auth', 'login.feature'),
        'Feature: Login\n'
      );

      // Duplicate + unordered tags collapse to a unique, alphabetical list.
      await materializeStandardLinks(root, changeName, [
        'testing',
        'security',
        'testing',
        'architecture',
      ]);

      const features = await readSidecarFeatures('user-auth');
      expect(features['login.feature']).toEqual([
        'architecture',
        'security',
        'testing',
      ]);
    });

    // Scenario: with no declared standards the store links are left untouched.
    it('is a no-op when the change declares no standards (empty tags)', async () => {
      // A pre-existing sidecar that must survive untouched.
      await writeFile(
        sidecarPath('user-auth'),
        yaml.stringify({ features: { 'login.feature': ['testing'] } })
      );

      await materializeStandardLinks(root, changeName, []);

      // The early return left the sidecar exactly as it was.
      const features = await readSidecarFeatures('user-auth');
      expect(features).toEqual({ 'login.feature': ['testing'] });
    });

    // Scenario: a sidecar with no remaining links is dropped entirely.
    it('deletes the sidecar from the store when no links remain', async () => {
      // An existing sidecar with a single feature whose link is about to be removed.
      await writeFile(
        sidecarPath('user-auth'),
        yaml.stringify({ features: { 'legacy.feature': ['testing'] } })
      );
      // Tombstone the only linked feature so the capability's links become empty.
      await writeFile(
        path.join(changeDir, 'features', '.deleted'),
        'user-auth/legacy.feature\n'
      );

      await materializeStandardLinks(root, changeName, ['testing']);

      // The drop-when-empty branch removes the sidecar file entirely.
      await expect(fs.access(sidecarPath('user-auth'))).rejects.toThrow();
    });
  });

  // With a real standards library present, materializeStandardLinks builds the
  // reverse index and regenerates the `## Implemented by` block in each standard
  // file — exercising buildReverseIndex / renderImplementedByBlock /
  // regenerateReverseLinks end to end.
  describe('materializeStandardLinks (reverse links into standards)', () => {
    function standardsDir(): string {
      return path.join(root, RATCHET_DIR_NAME, 'standards');
    }

    it('regenerates the Implemented by block for a matching standard', async () => {
      // A standard whose tag (file stem) is "testing".
      await writeFile(
        path.join(standardsDir(), 'testing.md'),
        '# Testing standard\n\nWrite tests.\n'
      );
      // A feature tagged with that standard.
      await writeFile(
        path.join(changeDir, 'features', 'user-auth', 'login.feature'),
        'Feature: Login\n'
      );

      await materializeStandardLinks(root, changeName, ['testing']);

      const rendered = await fs.readFile(
        path.join(standardsDir(), 'testing.md'),
        'utf-8'
      );
      expect(rendered).toContain('## Implemented by');
      expect(rendered).toContain('- user-auth/login.feature');
      // Original body is preserved above the generated block.
      expect(rendered).toContain('Write tests.');
    });

    it('skips a standard whose markdown file cannot be read', async () => {
      // loadStandards lists "testing" (a .md entry) but the path is a DIRECTORY,
      // so regenerateReverseLinks' readFile throws and the standard is skipped
      // without aborting the run.
      await fs.mkdir(path.join(standardsDir(), 'testing.md'), { recursive: true });
      await writeFile(
        path.join(changeDir, 'features', 'user-auth', 'login.feature'),
        'Feature: Login\n'
      );

      await expect(
        materializeStandardLinks(root, changeName, ['testing'])
      ).resolves.toBeUndefined();

      // The directory was left untouched (no write happened).
      const stat = await fs.stat(path.join(standardsDir(), 'testing.md'));
      expect(stat.isDirectory()).toBe(true);
    });

    it('leaves a standard with no implementing features without a block', async () => {
      // The change links to "testing", so the unrelated "security" standard gains
      // no block (renderImplementedByBlock with empty features removes/omits it).
      await writeFile(
        path.join(standardsDir(), 'security.md'),
        '# Security standard\n\nNo features yet.\n'
      );
      await writeFile(
        path.join(standardsDir(), 'testing.md'),
        '# Testing standard\n'
      );
      await writeFile(
        path.join(changeDir, 'features', 'user-auth', 'login.feature'),
        'Feature: Login\n'
      );

      await materializeStandardLinks(root, changeName, ['testing']);

      const security = await fs.readFile(
        path.join(standardsDir(), 'security.md'),
        'utf-8'
      );
      expect(security).not.toContain('## Implemented by');
    });
  });

  // Defensive edge branches: glob/read failures and malformed change layouts are
  // swallowed into safe empty results rather than thrown.
  describe('defensive edge branches', () => {
    it('findFeatureUpdates returns [] when the features path is a file, not a directory', async () => {
      // fast-glob with cwd pointing at a file throws; the catch maps it to [].
      await writeFile(path.join(changeDir, 'features'), 'i am a file, not a dir\n');
      const updates = await findFeatureUpdates(changeDir, storeDir);
      expect(updates).toEqual([]);
    });

    it('applyFeatures throws when the change path is a file, not a directory', async () => {
      // changeDir exists as a plain file -> stat succeeds but isDirectory() is false.
      const fileChange = 'file-change';
      await writeFile(
        path.join(root, RATCHET_DIR_NAME, 'changes', fileChange),
        'not a directory\n'
      );
      await expect(applyFeatures(root, fileChange, {})).rejects.toThrow(/not found/);
    });

    it('classifies a feature as overwritten when the existing target is unreadable', async () => {
      // Target exists (exists=true) but byte-compare fails (read error) -> the
      // filesAreIdentical catch returns false, classifying it as overwritten.
      await writeFile(
        path.join(changeDir, 'features', 'user-auth', 'login.feature'),
        'Feature: Login\n'
      );
      // Create the target as a DIRECTORY so reading it as a file fails.
      await fs.mkdir(path.join(storeDir, 'user-auth', 'login.feature'), {
        recursive: true,
      });

      const result = await applyFeatures(root, changeName, { dryRun: true });
      expect(result.overwritten).toBe(1);
      expect(result.unchanged).toBe(0);
    });

    it('a sidecar whose YAML is a non-object (scalar) is read as no links', async () => {
      // yaml.parse of a bare scalar yields a non-object; the read normalizes to {}.
      await writeFile(sidecarPath('user-auth'), '42\n');
      await writeFile(
        path.join(changeDir, 'features', 'user-auth', 'login.feature'),
        'Feature: Login\n'
      );

      await materializeStandardLinks(root, changeName, ['testing']);

      const raw = await fs.readFile(sidecarPath('user-auth'), 'utf-8');
      const parsed = yaml.parse(raw) as { features: Record<string, unknown> };
      expect(parsed.features).toEqual({ 'login.feature': ['testing'] });
    });

    it('builds an empty reverse index when the store directory does not exist', async () => {
      // tags non-empty (so materialize runs) but no features and no tombstones,
      // so updateForwardLinks writes nothing and the store dir never appears —
      // buildReverseIndex's readdir fails and yields an empty index.
      await writeFile(
        path.join(standardsDirPath(), 'testing.md'),
        '# Testing standard\n'
      );
      // No features directory in the change at all.
      await expect(
        materializeStandardLinks(root, changeName, ['testing'])
      ).resolves.toBeUndefined();

      // Store dir was never created; the standard gained no Implemented-by block.
      await expect(fs.access(storeDir)).rejects.toThrow();
      const rendered = await fs.readFile(
        path.join(standardsDirPath(), 'testing.md'),
        'utf-8'
      );
      expect(rendered).not.toContain('## Implemented by');
    });

    function sidecarPath(capability: string): string {
      return path.join(storeDir, capability, '.ratchet.yaml');
    }

    function standardsDirPath(): string {
      return path.join(root, RATCHET_DIR_NAME, 'standards');
    }
  });
});
