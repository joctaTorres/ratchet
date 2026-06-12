/**
 * Per-batch single-flight lock.
 *
 * Prevents two concurrent steps on the same batch. The lock is an exclusive lock
 * file under the batch's run directory holding the owning pid + timestamp. A
 * stale lock from a dead process (pid no longer alive) is reclaimed so a crash
 * does not wedge the batch forever.
 *
 * Storage: `.ratchet/batches/<name>/run/step.lock`.
 */

import { existsSync, mkdirSync, readFileSync, openSync, writeSync, closeSync, unlinkSync } from 'fs';
import path from 'path';

const RATCHET_DIR = '.ratchet';

export class BatchLockedError extends Error {
  constructor(
    public readonly batch: string,
    public readonly holder: LockInfo
  ) {
    super(
      `A step is already running for batch '${batch}' ` +
        `(pid ${holder.pid}, since ${holder.at}). ` +
        'Refusing to start a second concurrent step.'
    );
    this.name = 'BatchLockedError';
  }
}

export interface LockInfo {
  pid: number;
  at: string;
}

function runDir(projectRoot: string, batch: string): string {
  return path.join(projectRoot, RATCHET_DIR, 'batches', batch, 'run');
}

function lockPath(projectRoot: string, batch: string): string {
  return path.join(runDir(projectRoot, batch), 'step.lock');
}

function readLock(file: string): LockInfo | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as LockInfo;
    if (typeof parsed.pid === 'number') return parsed;
  } catch {
    // Corrupt lock file: treat as absent so it can be reclaimed.
  }
  return undefined;
}

/** True when a process with `pid` is alive (best-effort, current platform). */
function pidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    // Signal 0 probes existence without affecting the process.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but not ours (still alive).
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface BatchLock {
  release(): void;
}

/**
 * Acquire the per-batch lock. Throws `BatchLockedError` when a live process
 * already holds it; reclaims a stale lock left by a dead process.
 */
export function acquireBatchLock(projectRoot: string, batch: string): BatchLock {
  const dir = runDir(projectRoot, batch);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = lockPath(projectRoot, batch);

  if (existsSync(file)) {
    const holder = readLock(file);
    if (holder && pidAlive(holder.pid)) {
      throw new BatchLockedError(batch, holder);
    }
    // Stale or unreadable: reclaim.
    try {
      unlinkSync(file);
    } catch {
      // Another racer may have removed it; fall through to exclusive create.
    }
  }

  let fd: number;
  try {
    // 'wx' fails if the file exists, giving us atomic exclusive creation.
    fd = openSync(file, 'wx');
  } catch {
    const holder = readLock(file) ?? { pid: -1, at: new Date().toISOString() };
    throw new BatchLockedError(batch, holder);
  }

  const info: LockInfo = { pid: process.pid, at: new Date().toISOString() };
  writeSync(fd, JSON.stringify(info));
  closeSync(fd);

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        if (existsSync(file)) unlinkSync(file);
      } catch {
        // Best-effort release.
      }
    },
  };
}

/**
 * Run `fn` while holding the batch lock, releasing it afterward even on error.
 */
export async function withBatchLock<T>(
  projectRoot: string,
  batch: string,
  fn: () => Promise<T>
): Promise<T> {
  const lock = acquireBatchLock(projectRoot, batch);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
