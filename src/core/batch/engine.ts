/**
 * Batch Engine Interface Contract
 *
 * A stable, versioned typed boundary between the open CLI (this package) and the
 * licensed execution engine (shipped separately as `batch-engine`). The CLI
 * builds a resolved step context and hands it to the engine for exactly one
 * transition; the engine returns a structured result the CLI persists without
 * knowing how it was produced.
 *
 * Engine-absent and contract-version-mismatch are first-class states, surfaced
 * through this interface rather than by crashing. `status`/`view`/`config` never
 * touch the engine and work without it.
 */

import type { BatchSettings } from './config.js';
import type { ProofOfWork } from './manifest.js';
import type { JournalEntry } from './journal.js';

/**
 * The contract version the open CLI is built against. An engine declares the
 * version it was built against via `BatchEngine.contractVersion`; a mismatch
 * refuses to run.
 */
export const ENGINE_CONTRACT_VERSION = 1 as const;

export type Transition = 'propose' | 'apply' | 'verify';

/** Everything the engine needs to drive one transition, resolved by the CLI. */
export interface ResolvedStepContext {
  contractVersion: number;
  batch: string;
  change: string;
  transition: Transition;
  phase: {
    name: string;
    goal: string;
    success: string;
    proofOfWork: ProofOfWork;
  };
  settings: BatchSettings;
  /** Prior journal entries for this change (resume context). */
  journal: JournalEntry[];
  /** Resume context when the step was parked. */
  resume?: {
    kind: 'blocked' | 'awaiting-approval';
    reason: string;
    answer?: string;
    feedback?: string;
  };
}

export type StepState =
  | 'advanced'
  | 'blocked'
  | 'awaiting-approval'
  | 'phase-gated'
  | 'nothing-ready';

/** The structured result the engine returns after one transition. */
export interface StepResult {
  state: StepState;
  change: string;
  transition: Transition;
  /** Present when state is `blocked`: the question requiring an answer. */
  blocker?: string;
  /** Present when state is `awaiting-approval`: the proposal summary. */
  approvalRequest?: string;
  /** Pointer to journal entries this step produced (indices or ids). */
  journalRefs?: number[];
  message?: string;
}

/**
 * The interface a licensed engine implements. The CLI loads it through
 * `loadBatchEngine()` without importing engine internals.
 */
export interface BatchEngine {
  /** Contract version the engine was built against. */
  readonly contractVersion: number;
  readonly name: string;
  runStep(context: ResolvedStepContext): Promise<StepResult>;
}

export type EngineResolution =
  | { status: 'ok'; engine: BatchEngine }
  | { status: 'absent' }
  | { status: 'version-mismatch'; engineVersion: number; cliVersion: number };

/** A globally registered engine, if one has installed itself. */
let registeredEngine: BatchEngine | undefined;

/**
 * Register an engine implementation. The licensed `batch-engine` package calls
 * this on load. Exposed so the CLI never imports engine internals directly.
 */
export function registerBatchEngine(engine: BatchEngine): void {
  registeredEngine = engine;
}

/** For tests: clear any registered engine. */
export function clearRegisteredBatchEngine(): void {
  registeredEngine = undefined;
}

/**
 * Resolve the installed engine. Returns a discriminated result:
 *  - `absent` when no engine is registered (a normal, first-class state)
 *  - `version-mismatch` when the engine's contract version is incompatible
 *  - `ok` with the engine otherwise
 */
export function loadBatchEngine(): EngineResolution {
  if (!registeredEngine) {
    return { status: 'absent' };
  }
  if (registeredEngine.contractVersion !== ENGINE_CONTRACT_VERSION) {
    return {
      status: 'version-mismatch',
      engineVersion: registeredEngine.contractVersion,
      cliVersion: ENGINE_CONTRACT_VERSION,
    };
  }
  return { status: 'ok', engine: registeredEngine };
}

export const ENGINE_ABSENT_MESSAGE =
  'The batch execution engine is not installed.\n' +
  'Running a batch step requires the licensed engine.\n' +
  '  Install it:  npm install -g @ratchet/batch-engine\n' +
  '  Activate it: ratchet batch activate <license-key>\n' +
  'The open commands (status, view, list, config, report) work without the engine.';

export function engineVersionMismatchMessage(
  engineVersion: number,
  cliVersion: number
): string {
  return (
    `Batch engine contract mismatch: engine is version ${engineVersion}, ` +
    `CLI expects version ${cliVersion}.\n` +
    'Update the engine or the ratchet CLI so their contract versions match.'
  );
}
