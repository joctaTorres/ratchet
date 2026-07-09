/**
 * Map an agent session to a structured engine outcome.
 *
 * The engine snapshots the journal length before spawning the agent, then reads
 * the entries the agent wrote during the session (everything appended after the
 * snapshot for this change). Those entries — plus the process exit status —
 * determine the outcome:
 *
 *   - a `blocker` / `needs-input` entry  -> blocked (park with the question)
 *   - non-zero exit without a completion  -> failed (surfaced as blocked)
 *   - a `completion` entry, CORROBORATED against the on-disk change state the
 *     engine already snapshots (`diskEvidence`):
 *       - corroboration mismatch          -> blocked
 *         ("Reported complete but disk disagrees: <reason>.")
 *       - completion + non-zero exit/sig  -> blocked
 *         ("Agent reported completion but exited <describeExit> — the reported
 *          work may be incomplete; review and resume.")
 *       - under an approval gate     -> awaiting-approval (the gate×transition
 *                                       matrix decides which transitions park)
 *       - otherwise                       -> advanced
 *   - zero exit without a completion     -> blocked (agent stopped without
 *                                           reporting; needs attention). The
 *                                           captured transcript is attached and,
 *                                           when on-disk evidence shows the
 *                                           transition's artifact appeared/advanced,
 *                                           that progress is surfaced — but the step
 *                                           still parks (we never auto-advance on
 *                                           unreported work).
 *
 * Corroboration runs ONLY for `propose | apply | verify` (the per-change
 * transitions that own a change directory). `decompose` and `pr` step kinds key
 * off synthetic journal keys with no change directory, so they stay byte-for-byte
 * today's behavior (advanced on a bare completion); their crash-after-completion
 * check still applies. The mismatch branch (3) runs BEFORE the approval park
 * (5), so an uncorroborated propose can no longer park as `awaiting-approval`;
 * mismatch (3) precedes the crash branch (4) because a disk mismatch is the
 * more specific, actionable evidence.
 *
 * Verify completions must additionally CARRY the verification verdict: the
 * completion message must match {@link VERIFY_VERDICT_PATTERN} (the canonical
 * Final Assessment shapes the rct:verify workflow template authors). The pattern
 * checks verdict PRESENCE, not polarity — gating done on a passing verdict is
 * out of scope here; a verdict-bearing but failing verify still advances so the
 * operator sees the verdict (issue #78 point 3).
 */

import type { JournalEntry } from '../journal.js';
import type { StepKind } from './contract.js';
import type { AgentSpawnResult } from './agent.js';
import type { EngineStepOutcome } from './context.js';
import type { ChangeDiskState } from './transition.js';
import type { SettingSource } from '../config.js';

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

/**
 * Verifies a claimed completion CARRIES the verification verdict — the canonical
 * Final Assessment shapes the rct:verify workflow template
 * (`src/core/templates/workflows/verify-change.ts`) canonically emits:
 *
 *   - "Ready for archive" (the all-clear and warnings-only final lines)
 *   - "X critical issue(s) found…" (the critical-issues final line)
 *
 * The pattern checks verdict PRESENCE, not polarity: a critical-issue verdict is
 * still a verdict, and the integrity-gate goal (issue #78 point 3) asks only that
 * the verify completion CARRY the verdict/evidence, not that it pass. Gating done
 * on a passing verdict is out of scope. Exported so the instructions layer and
 * tests can name the contract without re-deriving it.
 */
export const VERIFY_VERDICT_PATTERN = /ready for archive|critical issue/i;

/**
 * The per-change transitions whose completions are corroborated against disk
 * evidence. `decompose` and `pr` step kinds key off synthetic journal keys with
 * no change directory, so their bare completions stay byte-for-byte today's
 * behavior (advanced) — exempt from corroboration.
 */
const CORROBORATED_TRANSITIONS: ReadonlySet<StepKind> = new Set([
  'propose',
  'apply',
  'verify',
]);

/**
 * Corroborate a claimed `--complete` on a per-change transition against the
 * on-disk change state the engine already snapshots. Pure: reads only the
 * pre-computed {@link DiskEvidence} snapshots. Returns `undefined` when the
 * disk agrees with the completion, or a human-readable mismatch reason when it
 * does not (the caller parks `blocked` with "Reported complete but disk
 * disagrees: <reason>.").
 *
 * Rules (mirroring the on-disk evidence `describeProgress` already consults, but
 * judging the absolute after-state for propose/verify and a session delta for
 * apply so a partially-progressed apply completion is honest work):
 *
 *   - `propose` → the after-state has a change directory AND a plan.md. Absolute
 *     (not a delta), so a resumed propose over an existing directory corroborates.
 *   - `apply`   → the after-state is fully applied (`after.applied`) OR at least
 *     one task was checked off this session (`after.tasksComplete >
 *     before.tasksComplete`).
 *   - `verify`  → the after-state is applied (`after.applied`) AND the
 *     completion message carries the verification verdict
 *     ({@link VERIFY_VERDICT_PATTERN}). Verify produces no disk artifact, so its
 *     evidence is (a) the change is actually applied and (b) the message carries
 *     the verdict. An archived after-state reports `applied: true`, so a late
 *     archival cannot false-block.
 */
function corroborateCompletion(
  transition: StepKind,
  evidence: DiskEvidence,
  message: string
): string | undefined {
  if (!CORROBORATED_TRANSITIONS.has(transition)) return undefined;
  const { before, after } = evidence;
  if (transition === 'propose') {
    if (after.exists && after.hasPlan) return undefined;
    return 'no plan.md on disk';
  }
  if (transition === 'apply') {
    const progressed = after.tasksComplete > before.tasksComplete;
    if (after.applied || progressed) return undefined;
    return 'no tasks checked off this session';
  }
  // verify
  if (!after.applied) return 'change not applied (unchecked tasks remain)';
  if (!VERIFY_VERDICT_PATTERN.test(message)) {
    return 'no verification verdict in the completion';
  }
  return undefined;
}

/**
 * Model-failure attribution, threaded from {@link resolveBatchSettings} through
 * the engine into the mapper. Carries the stage, agent, exact model string, and
 * supplying scope of the resolved `agent[:model]` spec a fast-failing transition
 * ran under. Present only when the parsed spec explicitly named a model AND the
 * context carries a scope for the running transition's stage; absent for bare
 * names, scope-less (standalone) paths, and failures after journal progress.
 */
export interface ModelAttribution {
  stage: StepKind;
  agent: string;
  model: string;
  scope: SettingSource;
}

/**
 * Render a {@link SettingSource} as a human-readable supplying-scope label for
 * the model-failure hint. Exhaustive over `SettingSource` so a future scope
 * renders as its own name rather than crashing. The two scopes the agent layers
 * carry today are "the project config" and "the batch manifest"; `default`/`user`
 * render as their own names (they never carry an agent today, but the label
 * never crashes if they ever do).
 */
function scopeLabel(scope: SettingSource): string {
  switch (scope) {
    case 'project':
      return 'the project config';
    case 'manifest':
      return 'the batch manifest';
    case 'default':
      return 'the default';
    case 'user':
      return 'the user config';
  }
}

/**
 * Build the model-failure attribution hint text — a fixed template over the
 * stage, agent, exact model string, and supplying scope. The copy is a HINT,
 * never a diagnosis: it names the exact model string and where it came from and
 * asserts nothing about why the agent died. Stderr is surfaced verbatim below
 * it, uninterpreted. Phrased as "if this model id is invalid…" guidance.
 */
function modelAttributionHint(attribution: ModelAttribution): string {
  return (
    `The "${attribution.stage}" stage ran the "${attribution.agent}" agent ` +
    `with model "${attribution.model}" supplied by ${scopeLabel(attribution.scope)}. ` +
    `If this model id is invalid or not available to this agent, ` +
    `correct the \`agent\` setting at that scope and resume.`
  );
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
  /**
   * Model-failure attribution, consulted in exactly one branch: a real
   * non-zero exit code (spawn.signal === null, not a signal kill) without a
   * completion AND zero session journal entries (the argv-rejection
   * signature). When present there, the outcome's `detail` opens with the
   * attribution hint above the truncated stderr tail, and `blocker`/`message`
   * carry the hint too — so every rendered surface that prints `blocker`/
   * `message` (the non-JSON `batch apply` blocked line, the parked-step reason
   * shown on resume, the journal entry message, the standalone change-step
   * renderer) surfaces the hint. Every other branch and every absent
   * attribution surfaces byte-for-byte today's output. A signal-killed spawn
   * (e.g. a `timeout` SIGKILL) under a valid explicit model is NOT a real exit
   * code, so the hint is suppressed there even with zero journal entries — the
   * bare-failure fallback (describeExit naming the signal) handles it.
   */
  modelAttribution?: ModelAttribution;
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

/**
 * Build the outcome for a non-zero exit WITHOUT a completion — the failed step.
 *
 * Attribution enriches EXACTLY this failure shape: when the parsed spec
 * explicitly named a model (attribution present) AND the agent wrote zero
 * journal entries during the session (the argv-rejection signature — an agent
 * that made any journal progress got past argv parsing, so the hint would
 * mislead) AND the spawn exited with a real non-zero exit code (spawn.signal ===
 * null — a signal-killed agent, e.g. a `timeout` SIGKILL, was killed externally;
 * its model was likely valid and the hint would misdirect the operator), the
 * hint is threaded into `detail`, `blocker`, and `message`. Every human-facing
 * surface prints `blocker`/`message` (the non-JSON `batch apply` blocked line,
 * the parked-step reason shown on resume, the journal entry message, the
 * standalone change-step renderer), so threading the hint into those two fields
 * reaches every rendered surface without any renderer edits. `detail` keeps
 * today's shape (hint above the stderr tail) for `--json` consumers. No other
 * branch is touched: bare-name, progressed, scope-less, signal-killed, and
 * zero-exit failures render byte-for-byte today's output.
 */
function buildNonZeroExitFailure(input: MapOutcomeInput): EngineStepOutcome {
  const { change, transition, sessionEntries, sessionIndices, spawn } = input;
  const stderrTail = truncate(spawn.stderr || spawn.stdout || '');
  if (input.modelAttribution && sessionEntries.length === 0 && spawn.signal === null) {
    const hint = modelAttributionHint(input.modelAttribution);
    return {
      state: 'failed',
      change,
      transition,
      detail: stderrTail ? `${hint}\n\n${stderrTail}` : hint,
      blocker: `Agent exited ${describeExit(spawn)} without reporting completion. ${hint}`,
      journalRefs: sessionIndices,
      message: `Agent failed during ${transition}. ${hint}`,
    };
  }
  return {
    state: 'failed',
    change,
    transition,
    detail: stderrTail,
    blocker: `Agent exited ${describeExit(spawn)} without reporting completion.`,
    journalRefs: sessionIndices,
    message: `Agent failed during ${transition}.`,
  };
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
  // The attribution-enriched vs. plain-failure split lives in one helper.
  if (nonZero && !completion) {
    return buildNonZeroExitFailure(input);
  }

  if (completion) {
    // Corroborate the claimed completion against the on-disk change state the
    // engine already snapshots, BEFORE the approval park. A mismatch fails
    // closed as blocked (more specific, actionable evidence than the crash
    // check below). Exempt for decompose/pr step kinds (no change directory).
    const mismatch = corroborateCompletion(
      transition,
      input.diskEvidence,
      completion.message
    );
    if (mismatch) {
      const blocker = `Reported complete but disk disagrees: ${mismatch}.`;
      return {
        state: 'blocked',
        change,
        transition,
        blocker,
        journalRefs: sessionIndices,
        message: blocker,
      };
    }

    // A corroborated completion followed by a non-zero exit or signal: the agent
    // reported work done but the session ended abnormally. Fail closed — the
    // reported work may be incomplete; review and resume. Runs AFTER the
    // mismatch check so a disk mismatch surfaces as the more specific evidence.
    const completionCrash = spawn.exitCode !== 0 || spawn.signal !== null;
    if (completionCrash) {
      const blocker =
        `Agent reported completion but exited ${describeExit(spawn)} — the ` +
        `reported work may be incomplete; review and resume.`;
      return {
        state: 'blocked',
        change,
        transition,
        blocker,
        journalRefs: sessionIndices,
        message: blocker,
      };
    }

    if (input.parkForApproval) {
      const label =
        transition === 'propose'
          ? 'Propose'
          : transition === 'apply'
            ? 'Apply'
            : transition === 'verify'
              ? 'Verify'
              : capitalize(transition);
      return {
        state: 'awaiting-approval',
        change,
        transition,
        approvalRequest: completion.message,
        journalRefs: sessionIndices,
        message: `${label} complete; awaiting approval.`,
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

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
