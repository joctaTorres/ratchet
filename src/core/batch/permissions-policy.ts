/**
 * Agent permissions policy — the agent-agnostic shape shared by every config
 * scope and consumed by the per-agent flag translator.
 *
 * This lives in its own module (not `config.ts`) so the project-config and
 * manifest schemas can embed it without a dependency cycle: `config.ts` imports
 * `readProjectConfig` from `project-config.ts`, and `project-config.ts` needs the
 * policy schema, so the schema cannot live in `config.ts`.
 */

import { z } from 'zod';

/**
 * The agent-agnostic permission posture. One intent the operator configures
 * once; the per-agent translator (`runtime/agent-permissions.ts`) maps it to each
 * coding agent's native permission flags.
 *
 * - `repo-sandboxed-permissive` (default): edits and ordinary build/test commands
 *   run unprompted, but the agent stays scoped to the repo and a denylist forbids
 *   destructive/host-damaging operations.
 * - `curated-allowlist`: nothing runs unprompted except an explicit allow list;
 *   the deny list still applies.
 * - `full-autonomy`: all permission checks are bypassed (escape hatch).
 */
export const PERMISSION_POSTURE_VALUES = [
  'repo-sandboxed-permissive',
  'curated-allowlist',
  'full-autonomy',
] as const;
export type PermissionPosture = (typeof PERMISSION_POSTURE_VALUES)[number];

/** The agents the per-agent `raw` override escape hatch recognizes. */
export const PERMISSION_RAW_AGENTS = ['claude', 'codex', 'gemini', 'cursor'] as const;
export type PermissionRawAgent = (typeof PERMISSION_RAW_AGENTS)[number];

/**
 * The single, agent-agnostic permission policy reused by every config scope
 * (user/global, project, per-change manifest). `posture` is a scalar; `allow`
 * and `deny` are agent-neutral tool-pattern lists; `raw` is a per-agent map of
 * raw argv fragments (the escape hatch). Nothing here is Claude-specific — agent
 * specifics live only in the translator's per-agent map.
 */
export const PermissionsPolicySchema = z
  .object({
    posture: z.enum(PERMISSION_POSTURE_VALUES).optional(),
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    raw: z
      .object({
        claude: z.array(z.string()).optional(),
        codex: z.array(z.string()).optional(),
        gemini: z.array(z.string()).optional(),
        cursor: z.array(z.string()).optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

export type PermissionsPolicy = z.infer<typeof PermissionsPolicySchema>;

/** A fully-resolved permission policy: posture is always present after merge. */
export interface ResolvedPermissionsPolicy {
  posture: PermissionPosture;
  allow: string[];
  deny: string[];
  raw: Partial<Record<PermissionRawAgent, string[]>>;
}

/** The built-in default posture when no scope configures permissions. */
export const DEFAULT_PERMISSION_POSTURE: PermissionPosture = 'repo-sandboxed-permissive';
