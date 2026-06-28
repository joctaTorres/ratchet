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
 *                                           reporting; needs attention). The
 *                                           captured transcript is attached and,
 *                                           when on-disk evidence shows the
 *                                           transition's artifact appeared/advanced,
 *                                           that progress is surfaced — but the step
 *                                           still parks (we never auto-advance on
 *                                           unreported work).
 */

import type { JournalEntry } from '../journal.js';
import type { StepKind } from './contract.js';
import type { AgentSpawnResult } from './agent.js';
import type { EngineStepOutcome } from './context.js';
import type { ChangeDiskState } from './transition.js';

/**
 * On-disk change state snapshotted before and after the agent session. The
 * mapper consults this purely (no fs access here) to judge whether the
 * transition's expected artifact appeared (propose: change dir + plan) or
 * advanced (apply: more task checkboxes checked than before). The `before`
 * snapshot lets apply-progress be measured as a delta within this session.
 */
export interface DiskEvidence {
  before: ChangeDiskState;
  after: ChangeDiskState;
}

export interface MapOutcomeInput {
  change: string;
  transition: StepKind;
  /** Journal entries the agent appended during this session (this change). */
  sessionEntries: JournalEntry[];
  /** Absolute indices of those entries in the full journal (for journalRefs). */
  sessionIndices: number[];
  spawn: AgentSpawnResult;
  /** True under an after-propose gate following a completed propose. */
  parkForApproval: boolean;
  /** Pre-computed on-disk change state before/after the session. */
  diskEvidence: DiskEvidence;
}

/**
 * Describe the on-disk progress observed during this session for the zero-exit
 * path, or `undefined` when no progress is evident. Pure: reads only the
 * pre-computed snapshots.
 */
function describeProgress(
  transition: StepKind,
  evidence: DiskEvidence
): string | undefined {
  const { before, after } = evidence;
  if (transition === 'propose') {
    const dirAppeared = !before.exists && after.exists;
    const planAppeared = !before.hasPlan && after.hasPlan;
    if (planAppeared && (dirAppeared || after.exists)) {
      return 'a change directory and plan.md were created on disk';
    }
    if (dirAppeared) {
      return 'a change directory was created on disk';
    }
    return undefined;
  }
  // apply (and verify): measure task-checkbox progress as a delta.
  const advanced = after.tasksComplete - before.tasksComplete;
  if (advanced > 0) {
    return `${advanced} task${advanced === 1 ? '' : 's'} were checked off on disk`;
  }
  return undefined;
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
  // reporting. Treat as blocked so a human looks at it; nothing is lost. Always
  // attach the captured transcript (mirroring the non-zero branch), and consult
  // on-disk evidence: when the transition's artifact appeared/advanced, surface
  // that progress — but NEVER auto-advance on unreported work.
  const transcript = truncate(spawn.stdout || spawn.stderr || '');
  const progress = describeProgress(transition, input.diskEvidence);
  if (progress) {
    const note = `Agent exited ${describeExit(spawn)} without reporting completion, but ${progress} — review and resume.`;
    return {
      state: 'blocked',
      change,
      transition,
      detail: transcript ? `${note}\n\n${transcript}` : note,
      blocker: note,
      journalRefs: sessionIndices,
      message: note,
    };
  }
  return {
    state: 'blocked',
    change,
    transition,
    detail: transcript,
    blocker: `Agent exited ${describeExit(spawn)} without reporting completion or a blocker.`,
    journalRefs: sessionIndices,
    message: `No completion reported during ${transition}.`,
  };
}

function describeExit(spawn: AgentSpawnResult): string {
  if (spawn.signal) return `via signal ${spawn.signal}`;
  return `with code ${spawn.exitCode}`;
}
