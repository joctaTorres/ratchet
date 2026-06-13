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
export { getBatchSkillTemplate, getRctBatchCommandTemplate } from './workflows/batch.js';
export { getEvalSkillTemplate, getRctEvalCommandTemplate } from './workflows/eval.js';
