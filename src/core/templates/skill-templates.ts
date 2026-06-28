/**
 * Agent Skill Templates
 *
 * Compatibility facade that re-exports split workflow template modules.
 */

export type { SkillTemplate, CommandTemplate } from './types.js';

export { getExploreSkillTemplate, getRctExploreCommandTemplate } from './workflows/explore.js';
export { getApplyChangeSkillTemplate, getRctApplyCommandTemplate } from './workflows/apply-change.js';
export { getArchiveChangeSkillTemplate, getRctArchiveCommandTemplate } from './workflows/archive-change.js';
export { getVerifyChangeSkillTemplate, getRctVerifyCommandTemplate } from './workflows/verify-change.js';
export { getRctProposeSkillTemplate, getRctProposeCommandTemplate } from './workflows/propose.js';
export { getRctProposeStandardSkillTemplate, getRctProposeStandardCommandTemplate } from './workflows/propose-standard.js';
export { getApplyBatchSkillTemplate, getRctApplyBatchCommandTemplate } from './workflows/apply-batch.js';
export { getArchiveBatchSkillTemplate, getRctArchiveBatchCommandTemplate } from './workflows/archive-batch.js';
export { getProposeBatchSkillTemplate, getRctProposeBatchCommandTemplate } from './workflows/propose-batch.js';
export { getDecomposePhaseSkillTemplate, getRctDecomposePhaseCommandTemplate } from './workflows/decompose-phase.js';
export { getBrainstormSkillTemplate, getRctBrainstormCommandTemplate } from './workflows/brainstorm.js';
export { getEvalSkillTemplate, getRctEvalCommandTemplate } from './workflows/eval.js';
