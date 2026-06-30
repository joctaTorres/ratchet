/**
 * Eval core: turn local `.feature` files into a scored, reproducible,
 * baseline-diffed regression suite. The CLI is deterministic plumbing; JUDGING
 * is delegated to the bundled batch engine seams (no new scoring engine).
 */

export { buildCaseId, assignCaseIds, slugifyScenario, featurePathToken } from './case-id.js';
export {
  enumerateEvalSet,
  type EvalCase,
  type EvalScope,
  type EvalScopeKind,
} from './set.js';
export {
  loadEvalSpecs,
  resolveBinding,
  specsDir,
  fixturesDir,
  fixturePath,
  BindingSchema,
  type Binding,
  type DeterministicBinding,
  type LlmJudgeBinding,
  type BindingKind,
  type ResolvedBinding,
  type EvalSpecLoadResult,
} from './spec.js';
export { FixtureManager, type MaterializeResult, type FixtureManagerDeps } from './fixture.js';
export {
  judgeCase,
  buildJudgeInstructions,
  parseAgentVote,
  resolveVotes,
  type Verdict,
  type JudgeMode,
  type CaseVerdict,
  type JudgeDeps,
} from './judge.js';
export {
  generateRunId,
  persistRun,
  loadRun,
  listRunIds,
  recordVerdict,
  toSnapshot,
  promoteBaseline,
  loadBaselineRunId,
  runsDir,
  runPath,
  baselinePath,
  type EvalRun,
  type CaseRecord,
  type CaseSnapshot,
  type VerdictSource,
  type RecordRequest,
} from './run.js';
export {
  buildReport,
  diffAgainstBaseline,
  type EvalReport,
  type Scorecard,
  type FailingCase,
  type BaselineDiff,
} from './report.js';
export {
  evaluateInvariantGate,
  type InvariantGateResult,
  type InvariantGateInput,
} from './invariant-gate.js';
export {
  aggregateRun,
  isRunComplete,
  DEFAULT_CONTRIBUTORS,
  deterministicContributor,
  llmJudgeContributor,
  regressionContributor,
  invariantsContributor,
  type Contributor,
  type ContributorId,
  type ContributorContext,
  type ContributorOutcome,
  type RunAggregate,
} from './aggregate.js';
export { executeRun, type RunOptions, type RunOutcome } from './execute.js';
export {
  resolveGate,
  ALL_CONTRIBUTOR_IDS,
  type GateConfig,
  type GateFlags,
  type ResolveGateInput,
} from './gate.js';
export {
  evaluateInvariant,
  isInvariantViolation,
  MEASURE_RESOLVERS,
  realFileReader,
  type InvariantOutcome,
  type InvariantStatus,
  type InvariantEvalContext,
  type MeasureResolver,
  type FileReader,
} from './invariant-evaluator.js';
