/**
 * Resumable run-state reconstruction.
 *
 * The engine reconstructs where a batch run is from two durable sources:
 *   - the append-only journal (`run/journal.jsonl`)
 *   - the changes on disk (transition state per change)
 *
 * A crash can leave a partial trailing line in the journal. Reconstruction reads
 * the journal TOLERANTLY: a final line that does not parse as JSON is treated as
 * an incomplete entry written mid-crash and is ignored, so the run resumes from
 * the last complete state instead of aborting.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { JournalEntry } from 'ratchet';

const RATCHET_DIR = '.ratchet';

function journalPath(projectRoot: string, batch: string): string {
  return path.join(projectRoot, RATCHET_DIR, 'batches', batch, 'run', 'journal.jsonl');
}

/**
 * Read the journal tolerantly. Each well-formed line becomes an entry; a partial
 * trailing line that fails to parse is dropped (crash-safety). An interior
 * malformed line is also skipped rather than aborting the whole run.
 */
export function readJournalTolerant(projectRoot: string, batch: string): JournalEntry[] {
  const file = journalPath(projectRoot, batch);
  if (!existsSync(file)) return [];

  const raw = readFileSync(file, 'utf-8');
  const lines = raw.split('\n');
  const entries: JournalEntry[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    try {
      entries.push(JSON.parse(line) as JournalEntry);
    } catch {
      // A failed parse on the LAST non-empty line is an incomplete trailing
      // entry from a crash: ignore it. An interior failure is corruption we also
      // skip, preserving the surrounding complete entries.
      continue;
    }
  }
  return entries;
}

/** Journal entries for a single change, reconstructed tolerantly. */
export function readChangeJournalTolerant(
  projectRoot: string,
  batch: string,
  change: string
): JournalEntry[] {
  return readJournalTolerant(projectRoot, batch).filter((e) => e.change === change);
}
