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

export type JournalEntryKind =
  | 'progress'
  | 'blocker'
  | 'needs-input'
  | 'completion'
  | 'answer'
  | 'reject';

export interface JournalEntry {
  /** ISO timestamp. */
  at: string;
  change: string;
  kind: JournalEntryKind;
  message: string;
  /** Optional transition this entry relates to (propose|apply|verify). */
  transition?: string;
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
