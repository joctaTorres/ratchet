/**
 * RatchetBatchEngine — the bundled batch execution engine.
 *
 * One `runStep` drives exactly one transition forward:
 *   1. Acquire the per-batch single-flight lock (concurrency guard).
 *   2. Honor gates/resume: an after-propose/every-phase gate or a recorded
 *      answer/feedback shapes the agent instructions; an unresolved park does not
 *      advance.
 *   3. Resolve the agent adapter (reject unknown adapters before spawning).
 *   4. Spawn a fresh agent for the transition with context-derived instructions.
 *   5. Map the journal entries the agent wrote + exit status to a structured
 *      result, parking on blockers / approval as configured.
 *
 * The engine's only failure modes are real execution errors (an unknown adapter,
 * an agent crash, a non-zero exit without completion) which surface as
 * blocked/failed and stay resumable. There is no license, authorization, or
 * lease between the user and running a step.
 *
 * Proof-of-work gating lives in `proof-of-work.ts` and is invoked by the host
 * loop once a phase's changes are all done; `runStep` advances changes and never
 * runs proof-of-work while a phase still has work, matching the
 * single-transition semantics.
 */

import { appendJournal, type JournalEntryKind } from '../journal.js';
import type { ResolvedStepContext, StepResult, Transition } from './contract.js';
import {
  resolveAdapter,
  UnknownAgentError,
  type AgentAdapter,
  type AgentSpawnRequest,
  type AgentSpawnResult,
  type Spawner,
} from './agent.js';
import type { AgentEvent, AgentRuntime } from './runtime/contract.js';
import { makeRexSidecarRuntime } from './runtime/rex-sidecar-runtime.js';
import { buildAgentInstructions } from './instructions.js';
import { mapSessionToOutcome } from './outcome.js';
import { toStepResult, resolveProjectRoot, type EngineStepOutcome } from './context.js';
import { computeNextTransition, readChangeDiskState } from './transition.js';
import { withBatchLock } from './lock.js';
import { readChangeJournalTolerant } from './run-state.js';

/** Print one streamed line to the terminal (injectable so tests can assert it). */
export type LinePrinter = (line: string) => void;

export interface EngineDeps {
  /**
   * Streaming agent runtime (defaults to the ReX-local sidecar runtime). This is
   * the primary execution seam: it streams the agent's output live AND returns
   * the accumulated `AgentSpawnResult` for `mapSessionToOutcome`.
   */
  runtime?: AgentRuntime;
  /**
   * Legacy direct-spawn seam, preserved as a documented fallback for one release.
   * When a `runtime` is provided (or defaulted) it is NOT used; an explicit
   * `spawner` is wrapped into a non-streaming runtime so the old injection path
   * keeps working for tests that have not migrated.
   */
  spawner?: Spawner;
  /** Print each streamed stdout line live (defaults to writing to stdout). */
  printLine?: LinePrinter;
  /** Extra/override agent adapters (e.g. for tests). */
  adapters?: Record<string, AgentAdapter>;
  /** Resolve the project root (defaults to planning-home). */
  projectRoot?: () => string;
}

/**
 * Adapt a legacy `Spawner` into an `AgentRuntime`: run it, then replay the
 * captured stdout as a single accumulated transcript followed by an exit event.
 * Preserves the direct-spawn fallback path while keeping the streaming contract.
 */
function spawnerAsRuntime(spawner: Spawner): AgentRuntime {
  return async (req, onEvent) => {
    const result = await spawner(req);
    if (result.stdout) {
      for (const line of result.stdout.split('\n')) {
        onEvent({ kind: 'stdout', line });
      }
    }
    onEvent({ kind: 'exit', exitCode: result.exitCode ?? undefined });
    return result;
  };
}

/** Map a step outcome state to the journal entry kind recorded for it. */
function outcomeKind(state: EngineStepOutcome['state']): JournalEntryKind {
  switch (state) {
    case 'advanced':
    case 'awaiting-approval':
      return 'completion';
    case 'blocked':
    case 'failed':
      return 'blocker';
    default:
      return 'progress';
  }
}

export class RatchetBatchEngine {
  readonly name = 'ratchet-batch-engine';

  /**
   * The injected runtime override, when any. When unset, the runtime is selected
   * by locus per step (currently `local` → ReX sidecar). An injected `spawner`
   * (legacy fallback) is wrapped into a runtime so the old path keeps working.
   */
  private readonly runtimeOverride?: AgentRuntime;
  private readonly printLine: LinePrinter;
  private readonly adapters?: Record<string, AgentAdapter>;
  private readonly projectRoot: () => string;

  constructor(deps: EngineDeps = {}) {
    this.runtimeOverride =
      deps.runtime ?? (deps.spawner ? spawnerAsRuntime(deps.spawner) : undefined);
    this.printLine = deps.printLine ?? ((line) => process.stdout.write(line + '\n'));
    this.adapters = deps.adapters;
    this.projectRoot = deps.projectRoot ?? resolveProjectRoot;
  }

  /**
   * Select the `AgentRuntime` for a step. An injected runtime/spawner always
   * wins (tests, fallback). Otherwise the locus selects the runtime: `local`
   * drives the ReX sidecar with `REX_LOCUS=local` and `REX_WORKDIR=projectRoot`.
   */
  private selectRuntime(projectRoot: string, context: ResolvedStepContext): AgentRuntime {
    if (this.runtimeOverride) return this.runtimeOverride;
    const locus = context.settings.locus ?? 'local';
    // Only `local` exists this phase; docker/remote are later phases. The enum is
    // validated upstream, so an unknown locus here is a programming error.
    return makeRexSidecarRuntime({ locus, projectRoot });
  }

  async runStep(context: ResolvedStepContext): Promise<StepResult> {
    const projectRoot = this.projectRoot();
    const { batch } = context;

    // 1. Single-flight: refuse a second concurrent step for the same batch.
    return withBatchLock(projectRoot, batch, async () => {
      const outcome = await this.runStepLocked(projectRoot, context);
      return toStepResult(outcome);
    });
  }

  private async runStepLocked(
    projectRoot: string,
    context: ResolvedStepContext
  ): Promise<EngineStepOutcome> {
    const { batch, change } = context;

    // Determine the transition from on-disk state (authoritative), falling back
    // to the CLI's coarse hint in the context.
    const journal = context.journal.length
      ? context.journal
      : readChangeJournalTolerant(projectRoot, batch, change);
    const transition: Transition =
      computeNextTransition(projectRoot, change, journal) ?? context.transition;

    // Honor an unresolved park: do not advance until input is recorded.
    const park = this.checkPark(context, transition);
    if (park) return park;

    // 2-3. Build instructions + the spawn request for this single transition.
    //      A `RATCHET_BATCH_AGENT_CMD` override stands in for the agent; otherwise
    //      the configured adapter is resolved (rejecting unknowns before any spawn).
    const stepContext: ResolvedStepContext = { ...context, transition };
    const instructions = buildAgentInstructions(stepContext);
    // Thread the batch name through the env so the runtime can place the temp
    // prompt file under `.ratchet/batches/<batch>/.run/<id>/`.
    const env = { ...process.env, RATCHET_BATCH_NAME: batch };
    let request;
    try {
      request = this.buildSpawnRequest(stepContext, instructions, projectRoot, env);
    } catch (err) {
      if (err instanceof UnknownAgentError) {
        return {
          state: 'failed',
          change,
          transition,
          blocker: err.message,
          message: err.message,
        };
      }
      throw err;
    }

    // Snapshot journal length and on-disk change state so we can isolate this
    // session's entries and measure the artifact delta (e.g. apply progress).
    const before = readChangeJournalTolerant(projectRoot, batch, change).length;
    const diskBefore = readChangeDiskState(projectRoot, change);

    // Route through the streaming runtime: each stdout line is PRINTED live as it
    // arrives while still accumulating into the returned `AgentSpawnResult`, which
    // flows into `mapSessionToOutcome` exactly as the old spawner result did.
    const runtime = this.selectRuntime(projectRoot, stepContext);
    const onEvent = (e: AgentEvent): void => {
      if (e.kind === 'stdout' && e.line !== undefined) this.printLine(e.line);
    };
    const spawnResult: AgentSpawnResult = await runtime(request, onEvent);

    // 4. Read the entries the agent wrote during this session and map them.
    const afterAll = readChangeJournalTolerant(projectRoot, batch, change);
    const sessionEntries = afterAll.slice(before);
    const sessionIndices = sessionEntries.map((_, i) => before + i);
    const diskAfter = readChangeDiskState(projectRoot, change);

    const parkForApproval = this.shouldParkForApproval(context, transition);

    const outcome = mapSessionToOutcome({
      change,
      transition,
      sessionEntries,
      sessionIndices,
      spawn: spawnResult,
      parkForApproval,
      diskEvidence: { before: diskBefore, after: diskAfter },
    });

    // 5. Record a journal entry for the transition outcome (the agent may not
    //    have reported one, e.g. on failure), so resume sees this step.
    appendJournal(projectRoot, batch, {
      change,
      kind: outcomeKind(outcome.state),
      message:
        outcome.message ??
        outcome.blocker ??
        `${transition} ${outcome.state}`,
      transition,
    });

    return outcome;
  }

  /**
   * Build the spawn request for one transition. When `RATCHET_BATCH_AGENT_CMD`
   * is set, that command stands in for the coding-agent binary (used by e2e/eval
   * checks to exercise the orchestration deterministically without a real agent),
   * receiving the step instructions on stdin. Otherwise the configured adapter is
   * resolved as usual — rejecting unknown adapters before any spawn. Mirrors
   * `RATCHET_EVAL_AGENT_CMD` in the eval judge.
   */
  private buildSpawnRequest(
    context: ResolvedStepContext,
    instructions: string,
    projectRoot: string,
    env: NodeJS.ProcessEnv
  ): AgentSpawnRequest {
    const override = process.env.RATCHET_BATCH_AGENT_CMD;
    if (override && override.trim().length > 0) {
      return { command: 'bash', args: ['-c', override], instructions, cwd: projectRoot, env };
    }
    const adapter = resolveAdapter(context.settings.agent, this.adapters);
    return adapter.buildRequest(context, instructions, projectRoot, env);
  }

  /**
   * If a step is parked on an unresolved blocker/approval, do not advance.
   * A recorded answer (blocked) or approval/feedback (awaiting-approval) lets it
   * proceed — the instructions builder folds the answer/feedback into context.
   */
  private checkPark(
    context: ResolvedStepContext,
    transition: Transition
  ): EngineStepOutcome | undefined {
    const resume = context.resume;
    if (!resume) return undefined;

    if (resume.kind === 'blocked' && !resume.answer) {
      return {
        state: 'blocked',
        change: context.change,
        transition,
        blocker: resume.reason,
        message: 'Step is parked on a blocker; record an answer to resume.',
      };
    }
    if (resume.kind === 'awaiting-approval' && !resume.answer && !resume.feedback) {
      // Awaiting approval with neither approval nor feedback: still parked.
      // (Approval is signalled by the CLI clearing the park, so when we get here
      // with no answer/feedback the user has not acted.)
      return {
        state: 'awaiting-approval',
        change: context.change,
        transition,
        approvalRequest: resume.reason,
        message: 'Step is awaiting approval; approve or reject to resume.',
      };
    }
    return undefined;
  }

  /**
   * Under `after-propose` (and `every-phase`) gates, a completed propose parks
   * for approval before apply. `voluntary` and `autonomous` never park for
   * approval (autonomous still parks on agent blockers, handled in mapping).
   */
  private shouldParkForApproval(
    context: ResolvedStepContext,
    transition: Transition
  ): boolean {
    if (transition !== 'propose') return false;
    // A resume that already carries an answer/feedback means the user acted; do
    // not re-park for approval.
    if (context.resume?.answer || context.resume?.feedback) return false;
    const gate = context.settings.gate;
    return gate === 'after-propose' || gate === 'every-phase';
  }
}
