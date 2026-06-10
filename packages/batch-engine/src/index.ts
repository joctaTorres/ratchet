/**
 * @ratchet/batch-engine
 *
 * The licensed batch execution engine. Importing this module registers a
 * `RatchetBatchEngine` against the open CLI's `BatchEngine` contract via
 * `registerBatchEngine` (re-exported from `ratchet`), so the CLI loads the
 * engine through the contract without importing engine internals.
 *
 * Engine-absent stays a first-class CLI state: if this package is not installed
 * (or not imported by the CLI bootstrap), `loadBatchEngine()` reports `absent`
 * and the open commands keep working.
 */

import { registerBatchEngine } from 'ratchet';
import { RatchetBatchEngine, type EngineDeps } from './engine.js';

export { RatchetBatchEngine, type EngineDeps } from './engine.js';
export {
  resolveAdapter,
  availableAdapters,
  realSpawner,
  UnknownAgentError,
  DEFAULT_AGENT,
  type AgentAdapter,
  type Spawner,
  type AgentSpawnRequest,
  type AgentSpawnResult,
} from './agent.js';
export { buildAgentInstructions } from './instructions.js';
export { mapSessionToOutcome } from './outcome.js';
export {
  computeNextTransition,
  readChangeDiskState,
  type ChangeDiskState,
} from './transition.js';
export {
  selectRunnableStep,
  type SelectablePhase,
  type SelectableChange,
  type SelectionResult,
} from './selection.js';
export {
  runProofOfWork,
  evaluatePassCondition,
  realBashRunner,
  type ProofOfWorkResult,
  type BashRunner,
  type LlmJudge,
  type JudgeVerdict,
} from './proof-of-work.js';
export {
  LicenseManager,
  LicenseError,
  FakeAuthorizationService,
  HttpAuthorizationService,
  signAuthorization,
  verifyAuthorization,
  type AuthorizationService,
  type RunAuthorization,
  type AuthorizationRequest,
} from './license.js';
export {
  acquireBatchLock,
  withBatchLock,
  BatchLockedError,
  type BatchLock,
} from './lock.js';
export {
  readJournalTolerant,
  readChangeJournalTolerant,
} from './run-state.js';
export { toStepResult, type EngineStepOutcome } from './context.js';

/**
 * Register a `RatchetBatchEngine` instance against the contract. Idempotent for
 * the default instance; pass deps to register a custom-wired engine (tests).
 */
export function registerEngine(deps?: EngineDeps): RatchetBatchEngine {
  const engine = new RatchetBatchEngine(deps);
  registerBatchEngine(engine);
  return engine;
}

// Self-register the default engine on import so the CLI bootstrap can enable the
// engine simply by importing this package.
registerEngine();
