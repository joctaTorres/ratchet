/**
 * Profile System
 *
 * Defines workflow profiles that control which workflows are installed.
 * Profiles determine WHICH workflows; delivery (in global config) determines HOW.
 */

import type { Profile } from './global-config.js';

/**
 * Core workflows included in the 'core' profile.
 * These provide the streamlined experience for new users.
 *
 * 'apply-batch' and 'propose-batch' ship by default: a stock `ratchet init`
 * installs the autonomous batch orchestrator workflow (it loops the single-step
 * `ratchet batch apply` until the batch is done) and the guided batch-proposal
 * skill alongside the change workflows. 'eval' is the only workflow that remains
 * opt-in (see ALL_WORKFLOWS).
 */
export const CORE_WORKFLOWS = ['propose', 'apply', 'verify', 'archive', 'propose-standard', 'apply-batch', 'archive-batch', 'propose-batch', 'brainstorm'] as const;

/**
 * All available workflows in the system.
 *
 * 'eval' is the only opt-in workflow (not part of the streamlined 'core'
 * profile): it runs the engine-backed eval suite and is installed only for
 * custom profiles that request it. The batch workflows ('apply-batch', the
 * autonomous orchestrator, and its guided proposer 'propose-batch') are both
 * part of the default 'core' profile.
 */
export const ALL_WORKFLOWS = ['propose', 'apply', 'verify', 'archive', 'propose-standard', 'apply-batch', 'archive-batch', 'eval', 'propose-batch', 'brainstorm'] as const;

/**
 * Workflow-id migration aliases.
 *
 * The internal workflow id `'batch'` was renamed to `'apply-batch'` when the
 * single-step `/rct:batch` skill became the autonomous `/rct:apply-batch`
 * orchestrator. `profile: custom` allowlists authored before the rename may
 * still list `'batch'`; we resolve that to `'apply-batch'` so those users keep
 * their batch workflow instead of silently dropping it.
 */
export const WORKFLOW_ID_ALIASES: Record<string, string> = {
  'batch': 'apply-batch',
};

/**
 * Resolves a single (possibly stale) workflow id to its current id, applying
 * migration aliases. Unknown ids pass through unchanged.
 */
export function normalizeWorkflowId(workflowId: string): string {
  return WORKFLOW_ID_ALIASES[workflowId] ?? workflowId;
}

/**
 * Applies workflow-id migration aliases across a list, de-duplicating while
 * preserving order.
 */
export function normalizeWorkflowIds(workflows: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const workflow of workflows) {
    const normalized = normalizeWorkflowId(workflow);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export type WorkflowId = (typeof ALL_WORKFLOWS)[number];
export type CoreWorkflowId = (typeof CORE_WORKFLOWS)[number];

/**
 * Resolves which workflows should be active for a given profile configuration.
 *
 * - 'core' profile always returns CORE_WORKFLOWS
 * - 'custom' profile returns the provided customWorkflows, or empty array if not provided
 */
export function getProfileWorkflows(
  profile: Profile,
  customWorkflows?: string[]
): readonly string[] {
  if (profile === 'custom') {
    return customWorkflows ? normalizeWorkflowIds(customWorkflows) : [];
  }
  return CORE_WORKFLOWS;
}
