/**
 * Fixture-isolated tests for src/utils/item-discovery.ts.
 *
 * Implements features/utils-helper-tests/item-discovery.feature: the
 * discovery helpers `getActiveChangeIds`, `getSpecIds`, and
 * `getArchivedChangeIds`. Each scenario builds an isolated project tree under
 * fs.mkdtemp(os.tmpdir()), writes only the minimal .ratchet/ artifacts it
 * exercises — change dirs carrying (or deliberately missing) the .ratchet.yaml
 * metadata file the helpers key on, plus a dotfile and an archive/ entry to
 * prove the filters — and removes the tmpdir in afterEach. The real
 * readdir/access/filter/sort logic runs unmocked against the isolated tree.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { getActiveChangeIds, getSpecIds, getArchivedChangeIds } from '../../src/utils/item-discovery.js';

const CHANGE_METADATA_FILENAME = '.ratchet.yaml';

describe('item-discovery', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-item-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Creates a directory under root and optionally drops the change metadata file in it. */
  function makeDir(relative: string, withMetadata = false): void {
    const dir = path.join(root, relative);
    fs.mkdirSync(dir, { recursive: true });
    if (withMetadata) {
      fs.writeFileSync(path.join(dir, CHANGE_METADATA_FILENAME), 'id: x\n', 'utf-8');
    }
  }

  describe('getActiveChangeIds', () => {
    it('lists only metadata-bearing change dirs, sorted, excluding the metadata-less dir, dotfile, and archive', async () => {
      makeDir('.ratchet/changes/zebra-change', true);
      makeDir('.ratchet/changes/alpha-change', true);
      makeDir('.ratchet/changes/no-metadata-dir', false);
      makeDir('.ratchet/changes/.hidden', true);
      makeDir('.ratchet/changes/archive', true);

      const result = await getActiveChangeIds(root);

      expect(result).toEqual(['alpha-change', 'zebra-change']);
    });

    it('returns an empty list when there is no changes directory', async () => {
      const result = await getActiveChangeIds(root);
      expect(result).toEqual([]);
    });
  });

  describe('getSpecIds', () => {
    it('lists top-level capability dirs sorted, excluding the dotfile', async () => {
      makeDir('.ratchet/features/workflow');
      makeDir('.ratchet/features/batch');
      makeDir('.ratchet/features/.hidden');

      const result = await getSpecIds(root);

      expect(result).toEqual(['batch', 'workflow']);
    });

    it('returns an empty list when there is no features directory', async () => {
      const result = await getSpecIds(root);
      expect(result).toEqual([]);
    });
  });

  describe('getArchivedChangeIds', () => {
    it('lists only metadata-bearing archived dirs, sorted', async () => {
      makeDir('.ratchet/changes/archive/zeta-done', true);
      makeDir('.ratchet/changes/archive/beta-done', true);
      makeDir('.ratchet/changes/archive/no-metadata-archived', false);
      makeDir('.ratchet/changes/archive/.hidden', true);

      const result = await getArchivedChangeIds(root);

      expect(result).toEqual(['beta-done', 'zeta-done']);
    });

    it('returns an empty list when there is no archive directory', async () => {
      const result = await getArchivedChangeIds(root);
      expect(result).toEqual([]);
    });
  });
});
