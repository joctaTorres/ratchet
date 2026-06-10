// Core Ratchet logic will be implemented here
export {
  GLOBAL_CONFIG_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME,
  GLOBAL_DATA_DIR_NAME,
  type GlobalDataDirOptions,
  type GlobalConfig,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getGlobalConfig,
  saveGlobalConfig,
  getGlobalDataDir
} from './global-config.js';

export * from './planning-home.js';

// Batch engine contract (consumed by the separately-published `batch-engine`
// package). The CLI re-exports the versioned interface and run-state helpers so
// the engine can implement the contract without importing CLI internals.
export {
  ENGINE_CONTRACT_VERSION,
  ENGINE_ABSENT_MESSAGE,
  registerBatchEngine,
  clearRegisteredBatchEngine,
  loadBatchEngine,
  engineVersionMismatchMessage,
  type BatchEngine,
  type EngineResolution,
  type ResolvedStepContext,
  type StepResult,
  type StepState,
  type Transition,
} from './batch/engine.js';
export {
  appendJournal,
  readJournal,
  readJournalForChange,
  readRunState,
  writeRunState,
  parkStep,
  getParkedStep,
  recordAnswer,
  recordReject,
  recordApproval,
  clearParkedStep,
  type JournalEntry,
  type JournalEntryKind,
  type ParkedStep,
  type ParkedKind,
  type RunState,
} from './batch/journal.js';
export {
  type BatchSettings,
  type Gate,
  type Strategy,
  type ProofOfWorkPolicy,
} from './batch/config.js';
export {
  type ProofOfWork,
  type ProofOfWorkKind,
} from './batch/manifest.js';
