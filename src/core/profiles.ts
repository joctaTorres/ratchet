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
 * 'batch' and 'propose-batch' ship by default: a stock `ratchet init` installs
 * the single-step batch apply workflow and the guided batch-proposal skill
 * alongside the change workflows. 'eval' is the only workflow that remains
 * opt-in (see ALL_WORKFLOWS).
 */
export const CORE_WORKFLOWS = ['propose', 'apply', 'verify', 'archive', 'propose-standard', 'batch', 'propose-batch'] as const;

/**
 * All available workflows in the system.
 *
 * 'eval' is the only opt-in workflow (not part of the streamlined 'core'
 * profile): it runs the engine-backed eval suite and is installed only for
 * custom profiles that request it. The batch workflows ('batch' and its guided
 * proposer 'propose-batch') are both part of the default 'core' profile.
 */
export const ALL_WORKFLOWS = ['propose', 'apply', 'verify', 'archive', 'propose-standard', 'batch', 'eval', 'propose-batch'] as const;

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
    return customWorkflows ?? [];
  }
  return CORE_WORKFLOWS;
}
