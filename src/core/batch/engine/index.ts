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
  ChangeStepContext,
  DecompositionStepContext,
  PrStepContext,
  PriorPhaseResult,
  ShippedChange,
  StepResult,
  StepState,
  StepKind,
  Transition,
} from './contract.js';
export { RatchetBatchEngine, type EngineDeps, type LinePrinter } from './engine.js';
export type { AgentEvent, AgentRuntime } from './runtime/contract.js';
export {
  makeRexSidecarRuntime,
  buildRunCommand,
  type RexSidecarRuntimeOptions,
  type SidecarChild,
  type SidecarDeps,
} from './runtime/rex-sidecar-runtime.js';
export {
  resolveAdapter,
  availableAdapters,
  realSpawner,
  UnknownAgentError,
  DEFAULT_AGENT,
  activeAgentCmdOverride,
  buildAgentSpawnRequest,
  agentOverrideNotice,
  ENV_OVERRIDE_PROVENANCE,
  BATCH_AGENT_CMD_ENV,
  type AgentAdapter,
  type AgentRequestContext,
  type Spawner,
  type AgentSpawnRequest,
  type AgentSpawnResult,
  type EnvOverrideProvenance,
} from './agent.js';
export {
  buildAgentInstructions,
  buildDecompositionInstructions,
  buildPrInstructions,
  decompositionJournalKey,
  prJournalKey,
} from './instructions.js';
export {
  ensureSkillInSpawnLocus,
  ensureCommandInSpawnLocus,
  rctCommandIdForTransition,
  DECOMPOSE_COMMAND_ID,
  PR_OPEN_COMMAND_ID,
  SkillLocusError,
  type SkillLocusDeps,
} from './skill-locus.js';
export { mapSessionToOutcome } from './outcome.js';
export { parksForApproval } from './approval-gate.js';
export {
  computeNextTransition,
  readChangeDiskState,
  hasJournaledVerify,
  hasJournaledPr,
  hasJournaledPrForGroup,
  isChangeDone,
  type ChangeDiskState,
} from './transition.js';
export {
  pickNextStep,
  firstRunnableChange,
  boundaryStateFromPhases,
  RUNNABLE_STATUSES,
  type ApplyTarget,
  type RunnableChangeHit,
  type PickPrContext,
} from './selection.js';
export {
  detectPrGroupBoundaries,
  type BoundaryPhase,
  type BoundaryBatchState,
  type PrGroupKind,
  type PrGroupBoundary,
} from './boundary.js';
export { selectStackedBases, type StackedBase } from './stacked-base.js';
export {
  runProofOfWork,
  evaluatePassCondition,
  realBashRunner,
  type ProofOfWorkResult,
  type RunProofOfWorkDeps,
  type BashRunner,
  type BashResult,
} from './proof-of-work.js';
export {
  acquireBatchLock,
  withBatchLock,
  BatchLockedError,
  type BatchLock,
} from './lock.js';
export {
  readJournalTolerant,
  readJournalTolerantForLocus,
  readChangeJournalTolerant,
  readChangeJournalTolerantForLocus,
} from './run-state.js';
export { toStepResult, type EngineStepOutcome } from './context.js';
