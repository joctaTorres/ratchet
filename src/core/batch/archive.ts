/**
 * Batch Archive (terminal lifecycle step)
 *
 * A batch owns no artifacts of its own — status is derived live from change
 * state and all real artifacts (features) belong to the member *changes*. So
 * archiving a batch is two concerns layered:
 *   1. Cascade the existing change-archive flow over each member change (in phase
 *      order) so the unit clears out together — feature-store materialization and
 *      standard-link materialization are reused from `ArchiveCommand`, never
 *      reimplemented here.
 *   2. Housekeeping — move the batch directory (manifest + run journal) out of the
 *      active listing into `batches/archive/<YYYY-MM-DD>-<name>/`, preserving it
 *      for the record.
 *
 * Cascade ordering & partial failure: changes archive in phase order for
 * determinism. Feature materialization is per-change independent, so a mid-cascade
 * failure leaves earlier changes archived and the batch directory in place. This
 * is acceptable and recoverable — re-running skips the already-archived changes
 * (idempotent) and completes. We do not wrap the cascade in a transaction.
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { RATCHET_DIR_NAME } from '../config.js';
import { ArchiveCommand } from '../archive.js';
import { readRunState } from './journal.js';
import {
  batchExists,
  getBatchDir,
  getBatchesDir,
  loadBatchManifest,
  allChangeIntents,
} from './manifest.js';
import { computeBatchStatus } from './status.js';

/** Archives a single member change. Defaults to the shared `ArchiveCommand`. */
export type ChangeArchiver = (changeName: string) => Promise<void>;

export interface BatchArchiveOptions {
  /** Skip the incomplete-batch confirmation prompt (force, non-interactive). */
  yes?: boolean;
  /**
   * Confirmation prompt for an incomplete batch. Returns true to proceed.
   * Defaults to an interactive `@inquirer/prompts` confirm.
   */
  confirm?: (message: string) => Promise<boolean>;
  /** Sink for status/progress lines. Defaults to `console.log`. */
  log?: (message: string) => void;
  /** Archive-date override (YYYY-MM-DD). Defaults to today. */
  date?: string;
  /** Per-change archiver. Defaults to delegating to `ArchiveCommand`. */
  archiveChange?: ChangeArchiver;
}

export interface BatchArchiveResult {
  batchName: string;
  /** Member changes that ran through the change-archive flow this invocation. */
  archivedChanges: string[];
  /** Member changes already under `changes/archive/` — skipped, not re-archived. */
  skippedArchived: string[];
  /** Change intents with no change directory yet (pending) — skipped. */
  skippedPending: string[];
  /** Destination of the archived batch directory, when the move happened. */
  archivePath?: string;
  /** True when an incomplete-batch confirmation was declined; nothing moved. */
  aborted?: boolean;
}

/**
 * Recursively copy a directory. Used when fs.rename fails (e.g. EPERM on Windows).
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Move a directory from src to dest, falling back to copy-then-remove when
 * fs.rename fails with EPERM (Windows, file watchers) or EXDEV (cross-device).
 * Mirrors the helper in `src/core/archive.ts`.
 */
async function moveDirectory(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: any) {
    const code = err?.code;
    if (code === 'EPERM' || code === 'EXDEV') {
      await copyDirRecursive(src, dest);
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/** YYYY-MM-DD for today. */
function getArchiveDate(): string {
  return new Date().toISOString().split('T')[0];
}

function isChangeArchived(projectRoot: string, changeName: string): boolean {
  return existsSync(
    path.join(projectRoot, RATCHET_DIR_NAME, 'changes', 'archive', changeName)
  );
}

function changeExists(projectRoot: string, changeName: string): boolean {
  return existsSync(path.join(projectRoot, RATCHET_DIR_NAME, 'changes', changeName));
}

/**
 * Archive a completed batch: cascade the change-archive flow over each member
 * change in phase order, then move the batch directory under the archive.
 *
 * Unknown batch names error before anything moves. An incomplete batch (any
 * non-`done` change — including blocked or parked) warns and requires
 * confirmation unless `yes` is set. An existing archive entry is refused, leaving
 * the active batch directory in place.
 */
export async function archiveBatch(
  projectRoot: string,
  batchName: string,
  options: BatchArchiveOptions = {}
): Promise<BatchArchiveResult> {
  const log = options.log ?? ((message: string) => console.log(message));

  // Unknown batch: fail clearly before touching anything.
  if (!batchExists(projectRoot, batchName)) {
    throw new Error(
      `Batch '${batchName}' not found under .ratchet/batches.`
    );
  }

  const manifest = loadBatchManifest(projectRoot, batchName);
  const runState = readRunState(projectRoot, batchName);
  const status = await computeBatchStatus(projectRoot, manifest, runState);

  // Report the derived batch status (always shown — done or not).
  log(
    `Batch status: ${status.status} (${status.doneCount}/${status.changeCount} changes done)`
  );

  // Done gate: any non-`done` change (in-progress, blocked, parked, pending)
  // counts as incomplete. Warn, name them, and confirm unless forced.
  const incomplete = status.phases
    .flatMap((phase) => phase.changes)
    .filter((change) => change.status !== 'done')
    .map((change) => change.name);

  if (incomplete.length > 0) {
    log(
      `Warning: ${incomplete.length} incomplete change(s): ${incomplete.join(', ')}`
    );
    if (!options.yes) {
      const confirmFn =
        options.confirm ??
        (async (message: string) => {
          const { confirm } = await import('@inquirer/prompts');
          return confirm({ message, default: false });
        });
      const proceed = await confirmFn(
        `Archive incomplete batch '${batchName}'?`
      );
      if (!proceed) {
        log('Archive cancelled.');
        return {
          batchName,
          archivedChanges: [],
          skippedArchived: [],
          skippedPending: [],
          aborted: true,
        };
      }
    } else {
      log(`Continuing due to --yes flag.`);
    }
  }

  // Resolve the batch archive destination and refuse to overwrite an existing
  // entry up front, before the cascade, so a collision leaves everything in place.
  const archiveDir = path.join(getBatchesDir(projectRoot), 'archive');
  const date = options.date ?? getArchiveDate();
  const archiveName = `${date}-${batchName}`;
  const archivePath = path.join(archiveDir, archiveName);
  if (existsSync(archivePath)) {
    throw new Error(`Archive entry '${archiveName}' already exists.`);
  }

  // Cascade: archive each member change in phase order. `allChangeIntents`
  // flattens phases in declaration order, which is exactly phase order. Skip
  // already-archived (idempotent) and never-created (pending) intents.
  const archiveChange =
    options.archiveChange ??
    ((changeName: string) => new ArchiveCommand().execute(changeName, { yes: true }));

  const archivedChanges: string[] = [];
  const skippedArchived: string[] = [];
  const skippedPending: string[] = [];

  for (const intent of allChangeIntents(manifest)) {
    if (isChangeArchived(projectRoot, intent.name)) {
      skippedArchived.push(intent.name);
      continue;
    }
    if (!changeExists(projectRoot, intent.name)) {
      skippedPending.push(intent.name);
      continue;
    }
    log(`Archiving member change '${intent.name}'...`);
    await archiveChange(intent.name);
    archivedChanges.push(intent.name);
  }

  // Housekeeping: move the batch directory (manifest + run journal) into the
  // archive, preserving it for the record.
  await fs.mkdir(archiveDir, { recursive: true });
  await moveDirectory(getBatchDir(projectRoot, batchName), archivePath);

  log(`Batch '${batchName}' archived as '${archiveName}'.`);

  return {
    batchName,
    archivedChanges,
    skippedArchived,
    skippedPending,
    archivePath,
  };
}
