/**
 * RatchetBatchEngine — the licensed implementation of the `BatchEngine` contract.
 *
 * One `runStep` drives exactly one transition forward:
 *   1. Acquire the per-batch single-flight lock (concurrency guard).
 *   2. Obtain run authorization from the license manager BEFORE spawning anything
 *      — without it the engine refuses to run.
 *   3. Honor gates/resume: an after-propose/every-phase gate or a recorded
 *      answer/feedback shapes the agent instructions; an unresolved park does not
 *      advance.
 *   4. Resolve the agent adapter (reject unknown adapters before spawning).
 *   5. Spawn a fresh agent for the transition with context-derived instructions.
 *   6. Map the journal entries the agent wrote + exit status to a structured
 *      result, parking on blockers / approval as configured.
 *
 * Proof-of-work gating lives in `proof-of-work.ts` and is invoked by the host
 * loop once a phase's changes are all done; `runStep` advances changes and never
 * runs proof-of-work while a phase still has work, matching the contract's
 * single-transition semantics.
 */

import type {
  BatchEngine,
  ResolvedStepContext,
  StepResult,
  Transition,
} from 'ratchet';
import { appendJournal } from 'ratchet';
import { ENGINE_CONTRACT_VERSION } from 'ratchet';
import {
  resolveAdapter,
  realSpawner,
  UnknownAgentError,
  type AgentAdapter,
  type Spawner,
} from './agent.js';
import { buildAgentInstructions } from './instructions.js';
import { mapSessionToOutcome } from './outcome.js';
import { toStepResult, resolveProjectRoot, type EngineStepOutcome } from './context.js';
import { computeNextTransition } from './transition.js';
import { withBatchLock } from './lock.js';
import { readChangeJournalTolerant } from './run-state.js';
import {
  LicenseManager,
  LicenseError,
  HttpAuthorizationService,
  type AuthorizationService,
} from './license.js';

export interface EngineDeps {
  /** Process-spawn seam (defaults to the real cross-spawn spawner). */
  spawner?: Spawner;
  /** Extra/override agent adapters (e.g. for tests). */
  adapters?: Record<string, AgentAdapter>;
  /** License manager; defaults to one backed by the HTTP authorization seam. */
  license?: LicenseManager;
  /** Resolve the project root (defaults to planning-home). */
  projectRoot?: () => string;
}

const DEFAULT_LICENSE_ENDPOINT =
  process.env.RATCHET_LICENSE_ENDPOINT ?? 'https://license.ratchet.dev/authorize';

function defaultLicenseManager(): LicenseManager {
  const service: AuthorizationService = new HttpAuthorizationService(
    DEFAULT_LICENSE_ENDPOINT
  );
  return new LicenseManager({
    service,
    // In production this is the service's verification material; the HTTP seam
    // throws until wired, so the manager fails closed regardless.
    verifyingSecret: process.env.RATCHET_LICENSE_VERIFY_SECRET ?? '',
  });
}

export class RatchetBatchEngine implements BatchEngine {
  readonly contractVersion = ENGINE_CONTRACT_VERSION;
  readonly name = 'ratchet-batch-engine';

  private readonly spawner: Spawner;
  private readonly adapters?: Record<string, AgentAdapter>;
  private readonly license: LicenseManager;
  private readonly projectRoot: () => string;

  constructor(deps: EngineDeps = {}) {
    this.spawner = deps.spawner ?? realSpawner;
    this.adapters = deps.adapters;
    this.license = deps.license ?? defaultLicenseManager();
    this.projectRoot = deps.projectRoot ?? resolveProjectRoot;
  }

  async runStep(context: ResolvedStepContext): Promise<StepResult> {
    const projectRoot = this.projectRoot();
    const { batch, change } = context;

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

    // 2. Reject unknown adapters BEFORE any spawn or license cost.
    let adapter: AgentAdapter;
    try {
      adapter = resolveAdapter(context.settings.agent, this.adapters);
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

    // 3. License: obtain run authorization BEFORE spawning any agent. Without a
    //    valid, verifiable authorization the engine refuses to run.
    try {
      await this.license.authorizeRun(batch, change, transition);
    } catch (err) {
      if (err instanceof LicenseError) {
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

    // 4. Build instructions + spawn a fresh agent for this single transition.
    const stepContext: ResolvedStepContext = { ...context, transition };
    const instructions = buildAgentInstructions(stepContext);
    const env = { ...process.env };
    const request = adapter.buildRequest(stepContext, instructions, projectRoot, env);

    // Snapshot journal length so we can isolate this session's entries.
    const before = readChangeJournalTolerant(projectRoot, batch, change).length;

    const spawnResult = await this.spawner(request);

    // 5. Read the entries the agent wrote during this session and map them.
    const afterAll = readChangeJournalTolerant(projectRoot, batch, change);
    const sessionEntries = afterAll.slice(before);
    const sessionIndices = sessionEntries.map((_, i) => before + i);

    const parkForApproval = this.shouldParkForApproval(context, transition);

    const outcome = mapSessionToOutcome({
      change,
      transition,
      sessionEntries,
      sessionIndices,
      spawn: spawnResult,
      parkForApproval,
    });

    // 6. Record a journal entry for the transition outcome (the agent may not
    //    have reported one, e.g. on failure), so resume sees this step.
    appendJournal(projectRoot, batch, {
      change,
      kind: outcome.state === 'advanced' || outcome.state === 'awaiting-approval'
        ? 'completion'
        : outcome.state === 'blocked' || outcome.state === 'failed'
          ? 'blocker'
          : 'progress',
      message:
        outcome.message ??
        outcome.blocker ??
        `${transition} ${outcome.state}`,
      transition,
    });

    return outcome;
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
