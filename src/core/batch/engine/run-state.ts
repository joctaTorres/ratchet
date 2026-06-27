/**
 * Resumable run-state reconstruction.
 *
 * The engine reconstructs where a run is from two durable sources:
 *   - the append-only journal (`journal.jsonl`)
 *   - the changes on disk (transition state per change)
 *
 * A crash can leave a partial trailing line in the journal. Reconstruction reads
 * the journal TOLERANTLY: a final line that does not parse as JSON is treated as
 * an incomplete entry written mid-crash and is ignored, so the run resumes from
 * the last complete state instead of aborting.
 *
 * The journal lives at a `RunLocus`: under `.ratchet/batches/<batch>/run/` for a
 * batch step, or change-locally under `.ratchet/changes/<change>/.run/` for a
 * standalone change step with no manifest. The `*ForLocus` readers take the
 * locus; the batch-named readers delegate with a `{ batch }` locus so existing
 * batch callers keep their signatures and behaviour.
 */

import { existsSync, readFileSync } from 'fs';
import type { JournalEntry } from '../journal.js';
import { journalPathForLocus, type RunLocus } from '../journal.js';

/**
 * Read the journal at a locus tolerantly. Each well-formed line becomes an entry;
 * a partial trailing line that fails to parse is dropped (crash-safety). An
 * interior malformed line is also skipped rather than aborting the whole run.
 */
export function readJournalTolerantForLocus(
  projectRoot: string,
  locus: RunLocus
): JournalEntry[] {
  const file = journalPathForLocus(projectRoot, locus);
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

/** Read the batch journal tolerantly. */
export function readJournalTolerant(projectRoot: string, batch: string): JournalEntry[] {
  return readJournalTolerantForLocus(projectRoot, { batch });
}

/** Journal entries for a single change at a locus, reconstructed tolerantly. */
export function readChangeJournalTolerantForLocus(
  projectRoot: string,
  locus: RunLocus,
  change: string
): JournalEntry[] {
  return readJournalTolerantForLocus(projectRoot, locus).filter((e) => e.change === change);
}

/** Batch journal entries for a single change, reconstructed tolerantly. */
export function readChangeJournalTolerant(
  projectRoot: string,
  batch: string,
  change: string
): JournalEntry[] {
  return readChangeJournalTolerantForLocus(projectRoot, { batch }, change);
}
