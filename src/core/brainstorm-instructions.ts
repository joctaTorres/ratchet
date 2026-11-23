/**
 * Brainstorm Instructions Payload
 *
 * Builds the payload returned by `ratchet instructions brainstorm [--json]` —
 * the special case that delivers the brainstorm workflow's config-driven
 * opt-ins to the skill as DATA (instruction-fed-config), so the skill never
 * reads config files itself.
 *
 * The builder is a thin, never-throwing composition of two existing pieces:
 * `findRepoPlanningRootSync` (null when no `.ratchet` root exists) and
 * `readProjectConfig` (null on an unreadable/malformed config, field-by-field
 * resilient otherwise). Any failure — no planning root, unreadable config, or
 * an internal error — resolves to the disabled payload, so an agent harness
 * can call the command unconditionally at skill-invocation time.
 */

import { findRepoPlanningRootSync } from './planning-home.js';
import { readProjectConfig } from './project-config.js';

export interface BrainstormInstructionsPayload {
  spikes: {
    enabled: boolean;
  };
}

const DISABLED_PAYLOAD: BrainstormInstructionsPayload = {
  spikes: { enabled: false },
};

/**
 * Resolve the brainstorm instructions payload for the project containing
 * `startPath` (defaults to the current working directory).
 *
 * `spikes.enabled` is `true` only when the loaded project config carries
 * `brainstorm.spikes: true`; an absent section, an absent config, no planning
 * root, or any internal failure resolves to `false`. Default-off is a
 * resolution rule, not a schema default, so a loaded config stays faithful to
 * what the user wrote.
 *
 * Never throws.
 */
export function buildBrainstormInstructionsPayload(
  startPath?: string
): BrainstormInstructionsPayload {
  try {
    const planningRoot = findRepoPlanningRootSync(startPath ?? process.cwd());
    if (!planningRoot) {
      return DISABLED_PAYLOAD;
    }

    const config = readProjectConfig(planningRoot);
    return { spikes: { enabled: config?.brainstorm?.spikes === true } };
  } catch {
    return DISABLED_PAYLOAD;
  }
}
