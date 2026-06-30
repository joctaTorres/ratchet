/**
 * Shared tmpdir fixture for the `test/cli/index.test.ts` entrypoint tests.
 *
 * The in-process `program` from `src/cli/index.ts` resolves each verb's project
 * root from `process.cwd()`, so a test drives it by `process.chdir`-ing into an
 * isolated repo built under `fs.mkdtemp(os.tmpdir())` (see the `testing`
 * standard: fixture isolation, no real-repo dependence, order independence,
 * leave nothing behind). The fixture writes only the minimal `.ratchet/` tree
 * the entrypoint scenarios need — an empty `changes/` and `batches/` tree is a
 * structurally valid planning home that `status` and `batch list` resolve and
 * run their verbs against. Teardown restores the original cwd and removes the
 * tree so nothing leaks across scenarios.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export interface CliFixture {
  /** Absolute path to the isolated tmpdir repo (also the active cwd). */
  root: string;
  /** Restore the original cwd and remove the tmpdir tree. Idempotent. */
  cleanup: () => Promise<void>;
}

/**
 * Build an isolated ratchet project under `os.tmpdir()`, `chdir` into it, and
 * return a teardown. The minimal `.ratchet/` tree (empty `changes/` + `batches/`)
 * is enough for the entrypoint's planning-home resolution to find a valid root
 * and for `status`/`batch list` to run over it.
 */
export async function makeCliFixture(prefix = 'ratchet-cli-index-'): Promise<CliFixture> {
  const previousCwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(root, '.ratchet', 'batches'), { recursive: true });
  process.chdir(root);

  let cleaned = false;
  return {
    root,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      process.chdir(previousCwd);
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
