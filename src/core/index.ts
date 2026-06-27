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

// Bundled batch execution engine. The engine lives inside this package and
// `batch apply` runs it in-process; these are the shared step types and the
// engine entry point.
export {
  RatchetBatchEngine,
  type EngineDeps,
  type ResolvedStepContext,
  type ChangeStepContext,
  type StepResult,
  type StepState,
  type Transition,
} from './batch/engine/index.js';
export {
  appendJournal,
  appendJournalForLocus,
  runDirForLocus,
  journalPathForLocus,
  type RunLocus,
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
  resolveChangeStepSettings,
  type ChangeStepSettingOverrides,
  type BatchSettings,
  type Gate,
  type Strategy,
  type ProofOfWorkPolicy,
  type Locus,
} from './batch/config.js';
export {
  type ProofOfWork,
  type ProofOfWorkKind,
} from './batch/manifest.js';

// Eval suite: enumerate .feature files into scored, baseline-diffed cases judged
// by the bundled engine seams.
export * from './eval/index.js';
