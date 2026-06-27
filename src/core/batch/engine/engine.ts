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

import { appendJournalForLocus, type JournalEntryKind, type RunLocus } from '../journal.js';
import type {
  ResolvedStepContext,
  ChangeStepContext,
  StepResult,
  Transition,
} from './contract.js';
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
import { makeRexRemoteRuntime } from './runtime/rex-remote-runtime.js';
import { validateRemoteSettings } from '../config.js';
import { makeStreamJsonRenderer } from './runtime/stream-json-renderer.js';
import { buildAgentInstructions } from './instructions.js';
import { mapSessionToOutcome } from './outcome.js';
import { toStepResult, resolveProjectRoot, type EngineStepOutcome } from './context.js';
import { computeNextTransition, readChangeDiskState } from './transition.js';
import { withBatchLock } from './lock.js';
import {
  readChangeJournalTolerant,
  readChangeJournalTolerantForLocus,
} from './run-state.js';
import { ensureChangeMetadata } from '../../../utils/change-metadata.js';
import path from 'node:path';

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

/**
 * An `AgentRuntime` that fails immediately with an actionable message, used when
 * a locus is selected but its configuration is incomplete (e.g. `remote` without
 * host/port/authToken). It mirrors the runtime error-result contract — a
 * non-zero `exitCode`, the message in `stderr`, and an `error` event — so the
 * engine maps it to blocked/failed BEFORE any side effect (no REST call), with
 * no new outcome states.
 */
function failingRuntime(message: string): AgentRuntime {
  return async (_req, onEvent) => {
    onEvent({ kind: 'error', message });
    return { exitCode: 1, signal: null, stdout: '', stderr: message };
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
   * wins (tests, fallback). Otherwise the locus selects the runtime — and this
   * is the ONLY place that branches on locus: `local` drives the ReX sidecar
   * with `REX_LOCUS=local` and `REX_WORKDIR=projectRoot`; `docker` drives the
   * SAME sidecar runtime with `REX_LOCUS=docker` plus the resolved `image`
   * (the project root is bind-mounted by the runtime/sidecar); `remote` drives
   * the native-Node `RexRemoteRuntime` over the swerex-remote REST API with the
   * resolved host/port/authToken (no local Python). The engine, renderer, and
   * event channel are otherwise locus-agnostic — streaming and rendering are
   * identical regardless of locus, because every runtime emits the same events.
   */
  private selectRuntime(projectRoot: string, context: ChangeStepContext): AgentRuntime {
    if (this.runtimeOverride) return this.runtimeOverride;
    const locus = context.settings.locus ?? 'local';
    // The enum is validated upstream, so an unknown locus here is a programming
    // error. `image` is threaded only for docker (ignored by the local path).
    if (locus === 'remote') {
      // A missing/invalid host/port/token must fail with an actionable message
      // BEFORE any REST call — mirror the runtime's error-result path (non-zero
      // exit + message in stderr + an error event) so the engine maps it to
      // blocked/failed with no new outcome states and never leaks the token.
      const configError = validateRemoteSettings(context.settings);
      if (configError) return failingRuntime(configError);
      return makeRexRemoteRuntime({
        host: context.settings.host as string,
        port: context.settings.port as number,
        authToken: context.settings.authToken as string,
        // The runtime picks https for a non-local host and refuses plaintext to
        // one unless this explicit opt-in is set; loopback always allows http.
        allowInsecure: context.settings.insecure === true,
      });
    }
    return makeRexSidecarRuntime({
      locus,
      projectRoot,
      ...(locus === 'docker' ? { image: context.settings.image } : {}),
    });
  }

  async runStep(context: ResolvedStepContext): Promise<StepResult> {
    const projectRoot = this.projectRoot();
    const { batch } = context;

    // 1. Single-flight: refuse a second concurrent step for the same batch.
    return withBatchLock(projectRoot, batch, async () => {
      return this.runStepLocked(projectRoot, context);
    });
  }

  /**
   * The batch-facing step: hold the per-batch lock, derive the authoritative
   * transition from on-disk state, honor an unresolved park, then DELEGATE the
   * actual spawn-and-map to the change-scoped core `runChangeStep`. The lock,
   * transition derivation, and park-precedence are deliberately runStep's
   * responsibility and stay OUTSIDE the core so headless verbs (which force a
   * transition and own no batch lock) can reuse the same spawn path.
   */
  private async runStepLocked(
    projectRoot: string,
    context: ResolvedStepContext
  ): Promise<StepResult> {
    const { batch, change } = context;

    // Determine the transition from on-disk state (authoritative), falling back
    // to the CLI's coarse hint in the context.
    const journal = context.journal.length
      ? context.journal
      : readChangeJournalTolerant(projectRoot, batch, change);
    const transition: Transition =
      computeNextTransition(projectRoot, change, journal) ?? context.transition;

    // Honor an unresolved park: do not advance until input is recorded. This is
    // checked BEFORE delegation, so `runChangeStep` is never entered (no agent
    // spawned) while a park is unresolved.
    const park = this.checkPark(context, transition);
    if (park) return toStepResult(park);

    // Hand the derived/forced transition to the change-scoped core, which spawns
    // the single agent and maps the outcome. `ResolvedStepContext` is the
    // batch-facing boundary; we adapt it into a `ChangeStepContext` here.
    const changeStep: ChangeStepContext = { ...context, transition };
    return this.runChangeStep(changeStep);
  }

  /**
   * The change-scoped engine core: spawn EXACTLY ONE agent for the FORCED
   * transition `ctx.transition` on a single change, snapshot the journal delta,
   * and map the session to a structured `StepResult`. It does NOT take the batch
   * lock and does NOT re-derive the transition (`computeNextTransition` is never
   * called here) — both remain the caller's concern. This is the shared path
   * batch apply delegates to and the headless propose/apply/verify verbs spawn
   * directly.
   */
  async runChangeStep(ctx: ChangeStepContext): Promise<StepResult> {
    const projectRoot = this.projectRoot();
    const { batch, change, transition } = ctx;

    // Honor an unresolved park BEFORE any spawn. A headless caller enters the core
    // directly (the batch path already park-checks in `runStepLocked` and never
    // delegates while parked), so the core must also refuse to advance until input
    // is recorded — otherwise a standalone parked change would spawn an agent.
    const park = this.checkPark(ctx, transition);
    if (park) return toStepResult(park);

    // Resolve the run-state locus: under the batch dir when a batch drives this
    // step, else change-locally (`.ratchet/changes/<change>/.run/`) for a
    // standalone change with no manifest.
    const locus: RunLocus = batch ? { batch } : { change };

    // Build instructions + the spawn request for this single forced transition.
    // A `RATCHET_BATCH_AGENT_CMD` override stands in for the agent; otherwise the
    // configured adapter is resolved (rejecting unknowns before any spawn).
    const instructions = buildAgentInstructions(ctx);
    // Thread the batch name through the env so the runtime can place the temp
    // prompt file under `.ratchet/batches/<batch>/.run/<id>/`. With no batch the
    // runtime falls back to the change-local `.run/`, so the var is omitted.
    const env: NodeJS.ProcessEnv = batch
      ? { ...process.env, RATCHET_BATCH_NAME: batch }
      : { ...process.env };
    let request;
    let emitsStreamJson = false;
    try {
      const built = this.buildSpawnRequest(ctx, instructions, projectRoot, env);
      request = built.request;
      emitsStreamJson = built.emitsStreamJson;
    } catch (err) {
      if (err instanceof UnknownAgentError) {
        return toStepResult({
          state: 'failed',
          change,
          transition,
          blocker: err.message,
          message: err.message,
        });
      }
      throw err;
    }

    // Snapshot journal length and on-disk change state so we can isolate this
    // session's entries and measure the artifact delta (e.g. apply progress).
    const before = readChangeJournalTolerantForLocus(projectRoot, locus, change).length;
    const diskBefore = readChangeDiskState(projectRoot, change);

    // Route through the streaming runtime: each stdout line is PRINTED live as it
    // arrives while still accumulating into the returned `AgentSpawnResult`, which
    // flows into `mapSessionToOutcome` exactly as the old spawner result did.
    // When the resolved adapter emits structured stream-json, route each stdout
    // line through the generic renderer (which itself writes via `this.printLine`,
    // keeping the single sink seam) for polished live output; flush any buffered
    // partial + the summary on exit. Otherwise print each line raw, as before.
    // Rendering is display-only — the runtime accumulates the raw NDJSON into
    // `AgentSpawnResult.stdout` independently, so the mapped transcript is
    // untouched.
    const runtime = this.selectRuntime(projectRoot, ctx);
    const renderer = emitsStreamJson ? makeStreamJsonRenderer(this.printLine) : undefined;
    const onEvent = (e: AgentEvent): void => {
      if (e.kind === 'stdout' && e.line !== undefined) {
        if (renderer) renderer.handleLine(e.line + '\n');
        else this.printLine(e.line);
      } else if (e.kind === 'exit' && renderer) {
        renderer.flush();
      } else if (e.kind === 'error' && e.message !== undefined) {
        // An actionable failure (e.g. a remote auth/connection/config error or a
        // sidecar bootstrap failure) is printed live on the same sink so the user
        // sees the message even though the mapped outcome stays a generic
        // failed→blocked. Flush any buffered render first so it is not swallowed.
        renderer?.flush();
        this.printLine(e.message);
      }
    };
    const spawnResult: AgentSpawnResult = await runtime(request, onEvent);
    // Belt-and-braces: flush in case the runtime resolved without an exit event.
    renderer?.flush();

    // Read the entries the agent wrote during this session and map them.
    const afterAll = readChangeJournalTolerantForLocus(projectRoot, locus, change);
    const sessionEntries = afterAll.slice(before);
    const sessionIndices = sessionEntries.map((_, i) => before + i);

    // The PROPOSE step writes change artifacts directly on disk and does NOT go
    // through `ratchet new change`, so it can leave the change without a
    // `.ratchet.yaml` metadata stamp. Discovery for validate/list/archive keys
    // off that file, so an unstamped change is `done` in batch status yet
    // invisible to validate. Stamp it deterministically here so every
    // engine-created change is discoverable through a single mechanism
    // (no-op when the directory is absent or already stamped).
    if (transition === 'propose') {
      ensureChangeMetadata(
        path.join(projectRoot, '.ratchet', 'changes', change),
        projectRoot
      );
    }

    const diskAfter = readChangeDiskState(projectRoot, change);

    const parkForApproval = this.shouldParkForApproval(ctx, transition);

    const outcome = mapSessionToOutcome({
      change,
      transition,
      sessionEntries,
      sessionIndices,
      spawn: spawnResult,
      parkForApproval,
      diskEvidence: { before: diskBefore, after: diskAfter },
    });

    // Record a journal entry for the transition outcome (the agent may not have
    // reported one, e.g. on failure), so resume sees this step. Written at the
    // resolved locus — the batch run dir, or the change-local `.run/`.
    appendJournalForLocus(projectRoot, locus, {
      change,
      kind: outcomeKind(outcome.state),
      message:
        outcome.message ??
        outcome.blocker ??
        `${transition} ${outcome.state}`,
      transition,
    });

    return toStepResult(outcome);
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
    context: ChangeStepContext,
    instructions: string,
    projectRoot: string,
    env: NodeJS.ProcessEnv
  ): { request: AgentSpawnRequest; emitsStreamJson: boolean } {
    const override = process.env.RATCHET_BATCH_AGENT_CMD;
    if (override && override.trim().length > 0) {
      // The `bash -c` override stands in for the agent binary and is NOT
      // stream-json-capable (keeps e2e/eval deterministic) → raw streaming.
      return {
        request: { command: 'bash', args: ['-c', override], instructions, cwd: projectRoot, env },
        emitsStreamJson: false,
      };
    }
    const adapter = resolveAdapter(context.settings.agent, this.adapters);
    return {
      request: adapter.buildRequest(context, instructions, projectRoot, env),
      emitsStreamJson: adapter.emitsStreamJson === true,
    };
  }

  /**
   * If a step is parked on an unresolved blocker/approval, do not advance.
   * A recorded answer (blocked) or approval/feedback (awaiting-approval) lets it
   * proceed — the instructions builder folds the answer/feedback into context.
   */
  private checkPark(
    context: ChangeStepContext,
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
    context: ChangeStepContext,
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
