/**
 * Bundled batch execution engine.
 *
 * The engine lives inside the main `ratchet` package: `batch apply` constructs a
 * resolved step context and calls `RatchetBatchEngine.runStep` directly,
 * in-process. There is no separate package, no optional dynamic import, and no
 * registry — the engine just works.
 */

export type {
  ResolvedStepContext,
  StepResult,
  StepState,
  Transition,
} from './contract.js';
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
