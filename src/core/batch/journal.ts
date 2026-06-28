/**
 * Batch Run Journal and Parked State
 *
 * The CLI owns parking/journal state; the engine owns running the agent. The
 * journal is an append-only log of what agents reported (progress, blockers,
 * completion, needs-input) and the answers/feedback users provided. Parked
 * state records per-change steps halted as `blocked` or `awaiting-approval`,
 * so the next `apply` can resume the agent with the answer/feedback in context.
 *
 * Storage: `.ratchet/batches/<name>/run/journal.jsonl` (append-only) and
 * `.ratchet/batches/<name>/run/state.json` (current parked steps).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import path from 'path';
import { getBatchDir } from './manifest.js';
import { RATCHET_DIR_NAME } from '../config.js';
import type { ProofOfWorkPolicy } from './config.js';

export type JournalEntryKind =
  | 'progress'
  | 'blocker'
  | 'needs-input'
  | 'completion'
  | 'answer'
  | 'reject'
  | 'proof-of-work'
  // Append-only supersession marker: invalidates the latest recorded
  // `proof-of-work` for a phase so the next `batch apply` re-runs its boundary
  // proof. The original record is never rewritten; the fold (see
  // `proofRecordsFromEntries`) treats this marker as removing the phase from the
  // current record map.
  | 'proof-of-work-invalidated';

/**
 * Durable record of one phase's proof-of-work verdict, journaled at the phase
 * boundary by the apply host loop. Defined here (not as the engine's runtime
 * `ProofOfWorkResult`) so the on-disk record shape stays decoupled from the
 * engine internals; `apply.ts` maps a `ProofOfWorkResult` into this record.
 */
export interface ProofOfWorkRecord {
  /** Name of the phase whose proof-of-work ran. */
  phase: string;
  /** True when the proof-of-work command/judge passed. */
  passed: boolean;
  /** True when the policy lets the phase complete despite a failure (`warn`). */
  gatePassed: boolean;
  policy: ProofOfWorkPolicy;
  /** Machine-readable pass/fail reason from the run. */
  reason: string;
  /** Human-readable explanation of the verdict. */
  detail: string;
}

export interface JournalEntry {
  /** ISO timestamp. */
  at: string;
  change: string;
  kind: JournalEntryKind;
  message: string;
  /** Optional transition this entry relates to (propose|apply|verify). */
  transition?: string;
  /** Present only on `proof-of-work` entries: the recorded verdict. */
  proof?: ProofOfWorkRecord;
}

export type ParkedKind = 'blocked' | 'awaiting-approval';

export interface ParkedStep {
  change: string;
  kind: ParkedKind;
  /** The question (blocker) or summary (awaiting-approval) that parked it. */
  reason: string;
  /** User's recorded answer (for blocked) — resume context. */
  answer?: string;
  /** User's reject feedback (for awaiting-approval) — re-run propose context. */
  feedback?: string;
  /** True once the user approved an awaiting-approval step. */
  approved?: boolean;
  parkedAt: string;
}

export interface RunState {
  parked: Record<string, ParkedStep>;
}

/**
 * Where one step's run state (journal + parked state) lives. A batch step keeps
 * it under `.ratchet/batches/<batch>/run/`; a standalone change step with no
 * manifest keeps it under `.ratchet/changes/<change>/.run/`. The locus selects
 * the directory only — the journal/state shapes are identical either way.
 */
export type RunLocus = { batch: string } | { change: string };

/** Resolve the run-state directory for either a batch or a change locus. */
export function runDirForLocus(projectRoot: string, locus: RunLocus): string {
  return 'batch' in locus
    ? path.join(getBatchDir(projectRoot, locus.batch), 'run')
    : path.join(projectRoot, RATCHET_DIR_NAME, 'changes', locus.change, '.run');
}

/** Resolve the journal file path for either locus. */
export function journalPathForLocus(projectRoot: string, locus: RunLocus): string {
  return path.join(runDirForLocus(projectRoot, locus), 'journal.jsonl');
}

function runDir(projectRoot: string, batch: string): string {
  return runDirForLocus(projectRoot, { batch });
}

function journalPath(projectRoot: string, batch: string): string {
  return journalPathForLocus(projectRoot, { batch });
}

function statePath(projectRoot: string, batch: string): string {
  return path.join(runDir(projectRoot, batch), 'state.json');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function ensureRunDir(projectRoot: string, batch: string): void {
  ensureDir(runDir(projectRoot, batch));
}

/**
 * Append an entry to the run journal at the given locus (batch or change). The
 * batch-scoped {@link appendJournal} delegates here with a `{ batch }` locus; the
 * standalone change path passes a `{ change }` locus.
 */
export function appendJournalForLocus(
  projectRoot: string,
  locus: RunLocus,
  entry: Omit<JournalEntry, 'at'> & { at?: string }
): JournalEntry {
  const dir = runDirForLocus(projectRoot, locus);
  ensureDir(dir);
  const full: JournalEntry = { at: entry.at ?? new Date().toISOString(), ...entry };
  appendFileSync(path.join(dir, 'journal.jsonl'), JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

/** Append an entry to the batch's run journal. */
export function appendJournal(
  projectRoot: string,
  batch: string,
  entry: Omit<JournalEntry, 'at'> & { at?: string }
): JournalEntry {
  return appendJournalForLocus(projectRoot, { batch }, entry);
}

/** Read the full journal (oldest first). */
export function readJournal(projectRoot: string, batch: string): JournalEntry[] {
  const file = journalPath(projectRoot, batch);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JournalEntry);
}

/** Read journal entries for a single change. */
export function readJournalForChange(
  projectRoot: string,
  batch: string,
  change: string
): JournalEntry[] {
  return readJournal(projectRoot, batch).filter((e) => e.change === change);
}

export function readRunState(projectRoot: string, batch: string): RunState {
  const file = statePath(projectRoot, batch);
  if (!existsSync(file)) return { parked: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as RunState;
    return { parked: parsed.parked ?? {} };
  } catch {
    return { parked: {} };
  }
}

export function writeRunState(projectRoot: string, batch: string, state: RunState): void {
  ensureRunDir(projectRoot, batch);
  writeFileSync(statePath(projectRoot, batch), JSON.stringify(state, null, 2), 'utf-8');
}

/** Park a change step as blocked or awaiting-approval. */
export function parkStep(
  projectRoot: string,
  batch: string,
  step: Omit<ParkedStep, 'parkedAt'> & { parkedAt?: string }
): ParkedStep {
  const state = readRunState(projectRoot, batch);
  const full: ParkedStep = { parkedAt: step.parkedAt ?? new Date().toISOString(), ...step };
  state.parked[step.change] = full;
  writeRunState(projectRoot, batch, state);
  return full;
}

export function getParkedStep(
  projectRoot: string,
  batch: string,
  change: string
): ParkedStep | undefined {
  return readRunState(projectRoot, batch).parked[change];
}

/** Record a user's answer to a blocked step, leaving it parked until resume. */
export function recordAnswer(
  projectRoot: string,
  batch: string,
  change: string,
  answer: string
): ParkedStep {
  const state = readRunState(projectRoot, batch);
  const parked = state.parked[change];
  if (!parked) {
    throw new Error(`No parked step for change '${change}' in batch '${batch}'.`);
  }
  parked.answer = answer;
  writeRunState(projectRoot, batch, state);
  appendJournal(projectRoot, batch, { change, kind: 'answer', message: answer });
  return parked;
}

/** Record a reject-with-feedback for an awaiting-approval step. */
export function recordReject(
  projectRoot: string,
  batch: string,
  change: string,
  feedback: string
): ParkedStep {
  const state = readRunState(projectRoot, batch);
  const parked = state.parked[change];
  if (!parked) {
    throw new Error(`No parked step for change '${change}' in batch '${batch}'.`);
  }
  parked.feedback = feedback;
  parked.approved = false;
  writeRunState(projectRoot, batch, state);
  appendJournal(projectRoot, batch, { change, kind: 'reject', message: feedback });
  return parked;
}

/** Approve an awaiting-approval step, clearing the park so apply can proceed. */
export function recordApproval(
  projectRoot: string,
  batch: string,
  change: string
): void {
  const state = readRunState(projectRoot, batch);
  delete state.parked[change];
  writeRunState(projectRoot, batch, state);
}

/** Clear a parked step (e.g. after a resume completes it). */
export function clearParkedStep(
  projectRoot: string,
  batch: string,
  change: string
): void {
  const state = readRunState(projectRoot, batch);
  delete state.parked[change];
  writeRunState(projectRoot, batch, state);
}

// -----------------------------------------------------------------------------
// Proof-of-work records (phase-boundary verdicts)
// -----------------------------------------------------------------------------

/**
 * The journal `change` key a phase's proof-of-work entry reports under. A proof
 * record has no change, so — like a decomposition entry — it is keyed by phase;
 * the `proof-of-work:` prefix keeps it from colliding with the decomposition
 * key (`decompositionJournalKey`, which is the bare phase name) so the proof
 * reader never picks up a decomposition completion for the same phase.
 */
const PROOF_OF_WORK_KEY_PREFIX = 'proof-of-work:';

export function proofOfWorkJournalKey(phase: string): string {
  return `${PROOF_OF_WORK_KEY_PREFIX}${phase}`;
}

/**
 * Inverse of {@link proofOfWorkJournalKey}: recover the phase from a proof
 * journal key, or `undefined` if the key is not a proof key. Used by the fold to
 * learn which phase an invalidation marker targets (the marker carries only the
 * phase name, via its key — no toolchain detail).
 */
function phaseFromProofOfWorkJournalKey(change: string): string | undefined {
  return change.startsWith(PROOF_OF_WORK_KEY_PREFIX)
    ? change.slice(PROOF_OF_WORK_KEY_PREFIX.length)
    : undefined;
}

/**
 * Append a phase's proof-of-work verdict to the batch run journal. The
 * append-only journal already survives across the stateless single-step apply
 * invocations, so the verdict lives here rather than in a new file.
 */
export function recordProofOfWork(
  projectRoot: string,
  batch: string,
  phase: string,
  record: ProofOfWorkRecord
): JournalEntry {
  return appendJournal(projectRoot, batch, {
    change: proofOfWorkJournalKey(phase),
    kind: 'proof-of-work',
    message: record.detail,
    proof: record,
  });
}

/**
 * Append a `proof-of-work-invalidated` marker for a phase to the batch run
 * journal. The journal stays append-only: the original `proof-of-work` record is
 * left in place (audit trail preserved) and this marker simply supersedes it, so
 * the single reader ({@link proofRecordsFromEntries}) drops the phase from the
 * current record map and the next `batch apply` re-runs the phase's configured
 * boundary proof-of-work.
 */
export function recordProofOfWorkInvalidation(
  projectRoot: string,
  batch: string,
  phase: string
): JournalEntry {
  return appendJournal(projectRoot, batch, {
    change: proofOfWorkJournalKey(phase),
    kind: 'proof-of-work-invalidated',
    message: `Invalidated recorded proof-of-work for phase '${phase}'; the next batch apply re-runs its boundary proof.`,
  });
}

/**
 * Fold a journal entry list to the latest recorded proof-of-work outcome per
 * phase. The entries are scanned in append order, so a later proof entry for the
 * same phase overwrites an earlier one — "latest wins" falls out of that order.
 * A `proof-of-work-invalidated` marker deletes its phase from the map (a later
 * real `proof-of-work` record for the same phase re-adds it), so a recorded
 * verdict can be superseded without rewriting the append-only journal. Non-proof
 * entries (and proof entries missing a record) are ignored.
 *
 * Pure over the entries it is given: `computeBatchStatus` derives the phase gate
 * from the very journal it already receives via this helper, with no extra disk
 * read, so its injected-journal tests stay deterministic.
 */
export function proofRecordsFromEntries(
  entries: JournalEntry[]
): Map<string, ProofOfWorkRecord> {
  const byPhase = new Map<string, ProofOfWorkRecord>();
  for (const entry of entries) {
    if (entry.kind === 'proof-of-work' && entry.proof) {
      byPhase.set(entry.proof.phase, entry.proof);
    } else if (entry.kind === 'proof-of-work-invalidated') {
      const phase = phaseFromProofOfWorkJournalKey(entry.change);
      if (phase !== undefined) byPhase.delete(phase);
    }
  }
  return byPhase;
}

/**
 * The latest recorded proof-of-work outcome per phase, read from disk. Delegates
 * to {@link proofRecordsFromEntries} over the full run journal so the on-disk and
 * in-memory (status) gate derivations stay identical.
 */
export function readProofOfWorkByPhase(
  projectRoot: string,
  batch: string
): Map<string, ProofOfWorkRecord> {
  return proofRecordsFromEntries(readJournal(projectRoot, batch));
}

/** The latest recorded proof-of-work outcome for one phase, or undefined. */
export function readLatestProofOfWork(
  projectRoot: string,
  batch: string,
  phase: string
): ProofOfWorkRecord | undefined {
  return readProofOfWorkByPhase(projectRoot, batch).get(phase);
}
