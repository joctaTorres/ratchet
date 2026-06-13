/**
 * Map an agent session to a structured engine outcome.
 *
 * The engine snapshots the journal length before spawning the agent, then reads
 * the entries the agent wrote during the session (everything appended after the
 * snapshot for this change). Those entries — plus the process exit status —
 * determine the outcome:
 *
 *   - a `blocker` / `needs-input` entry  -> blocked (park with the question)
 *   - a `completion` entry               -> advanced (or awaiting-approval under
 *                                           an after-propose gate)
 *   - non-zero exit without a completion -> failed (surfaced as blocked)
 *   - zero exit without a completion     -> blocked (agent stopped without
 *                                           reporting; needs attention)
 */

import type { JournalEntry } from '../journal.js';
import type { Transition } from './contract.js';
import type { AgentSpawnResult } from './agent.js';
import type { EngineStepOutcome } from './context.js';

export interface MapOutcomeInput {
  change: string;
  transition: Transition;
  /** Journal entries the agent appended during this session (this change). */
  sessionEntries: JournalEntry[];
  /** Absolute indices of those entries in the full journal (for journalRefs). */
  sessionIndices: number[];
  spawn: AgentSpawnResult;
  /** True under an after-propose gate following a completed propose. */
  parkForApproval: boolean;
}

function truncate(text: string, max = 2000): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max) + '… (truncated)' : trimmed;
}

export function mapSessionToOutcome(input: MapOutcomeInput): EngineStepOutcome {
  const { change, transition, sessionEntries, sessionIndices, spawn } = input;

  const blocker = sessionEntries.find(
    (e) => e.kind === 'blocker' || e.kind === 'needs-input'
  );
  const completion = sessionEntries.find((e) => e.kind === 'completion');

  // A reported blocker always parks the step, regardless of exit code.
  if (blocker) {
    return {
      state: 'blocked',
      change,
      transition,
      blocker: blocker.message,
      journalRefs: sessionIndices,
      message: `Agent raised a blocker during ${transition}.`,
    };
  }

  const nonZero = spawn.exitCode !== 0 || spawn.signal !== null;

  // Non-zero exit WITHOUT a completion report is a failed step. State stays
  // consistent: the CLI parks it (failed -> blocked) and the batch is resumable.
  if (nonZero && !completion) {
    const detail = truncate(spawn.stderr || spawn.stdout || '');
    return {
      state: 'failed',
      change,
      transition,
      detail,
      blocker: `Agent exited ${describeExit(spawn)} without reporting completion.`,
      journalRefs: sessionIndices,
      message: `Agent failed during ${transition}.`,
    };
  }

  if (completion) {
    if (input.parkForApproval) {
      return {
        state: 'awaiting-approval',
        change,
        transition,
        approvalRequest: completion.message,
        journalRefs: sessionIndices,
        message: `Propose complete; awaiting approval.`,
      };
    }
    return {
      state: 'advanced',
      change,
      transition,
      journalRefs: sessionIndices,
      message: completion.message,
    };
  }

  // Zero exit but no completion and no blocker: the agent stopped without
  // reporting. Treat as blocked so a human looks at it; nothing is lost.
  return {
    state: 'blocked',
    change,
    transition,
    blocker: `Agent exited ${describeExit(spawn)} without reporting completion or a blocker.`,
    journalRefs: sessionIndices,
    message: `No completion reported during ${transition}.`,
  };
}

function describeExit(spawn: AgentSpawnResult): string {
  if (spawn.signal) return `via signal ${spawn.signal}`;
  return `with code ${spawn.exitCode}`;
}
