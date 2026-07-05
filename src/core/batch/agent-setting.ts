/**
 * Batch `agent` setting — the shared schema/type for routing lifecycle stages to
 * coding agents.
 *
 * The `agent` setting accepts EITHER a scalar agent name (route every stage to
 * one agent, the historical behavior) OR a partial per-stage
 * `{propose, apply, verify, pr}` map (route each lifecycle stage to a different
 * agent). Both config scopes — project config (`.ratchet/config.yaml`
 * `batch.agent`) and the per-change manifest (`BatchSettingsOverrideSchema`) —
 * validate through this one schema so the stage vocabulary is never duplicated
 * and the two scopes can never diverge.
 *
 * This lives in its own module (not `config.ts`, mirroring
 * `permissions-policy.ts`) so `project-config.ts` can import it without the
 * existing `project-config ↔ batch/config` import cycle: `project-config.ts` may
 * import `batch/agent-setting.ts` but must not import `batch/config.ts`.
 *
 * SCHEMA-ONLY: this module defines and validates the config shape. It does NOT
 * resolve which agent a stage spawns (cross-scope per-stage merge) and does not
 * check whether an agent name is known — those stay resolution/spawn-time
 * concerns handled by the sibling `agent-stage-resolution` change.
 */

import { z } from 'zod';

/**
 * The lifecycle stages a batch `agent` map may route independently:
 * `propose | apply | verify | pr`. The first three mirror the `Transition`
 * lifecycle the engine already models (`engine/contract.ts`); `pr` is the fourth
 * routable stage for the dedicated PR agent that opens a whole-batch PR at
 * completion. `Transition` stays a strict subset of these keys, so schema-only:
 * no current transition maps to `pr` (nothing spawns a PR agent here — that
 * arrives with the spawn-at-completion change). Kept as a local constant to stay
 * schema-only; the resolution consumers key off the same list.
 */
export const AGENT_STAGE_KEYS = ['propose', 'apply', 'verify', 'pr'] as const;
export type AgentStage = (typeof AGENT_STAGE_KEYS)[number];

/**
 * A partial per-stage agent map. `.partial()` accepts any subset of stages (only
 * the ones the user overrides); `.strict()` rejects an unknown stage key (e.g.
 * `deploy`). Each stage value is `z.string()`, so a non-string value (number,
 * boolean, object) fails validation.
 */
export const AgentStageMapSchema = z
  .object(Object.fromEntries(AGENT_STAGE_KEYS.map((k) => [k, z.string()])) as Record<
    AgentStage,
    z.ZodString
  >)
  .partial()
  .strict();

/**
 * The `agent` setting: a scalar agent name OR a partial stage-map.
 * `z.union([z.string(), …])` keeps the scalar path byte-for-byte compatible with
 * the historical `z.string().optional()` shape.
 */
export const AgentSettingSchema = z.union([z.string(), AgentStageMapSchema]);

export type AgentStageMap = z.infer<typeof AgentStageMapSchema>;
export type AgentSetting = z.infer<typeof AgentSettingSchema>;

/**
 * Reduce an `agent` setting to the single agent name the not-yet-stage-aware
 * spawn/instruction consumers expect. A scalar is returned as-is; an unset
 * setting stays unset (the caller falls back to its own default agent).
 *
 * A per-stage map has no single scalar, so it also reduces to `undefined` here:
 * the map is ACCEPTED and validated by the schema, but per-stage CONSUMPTION
 * (spawning the agent mapped to each lifecycle stage) is added by the sibling
 * `agent-stage-resolution` change, which replaces these call sites with a
 * stage-aware lookup. Until then a configured map behaves exactly like an unset
 * agent — the default agent for every stage — so no existing scalar-or-unset
 * config changes behavior when the setting widens to the union. This bridge keeps
 * the schema-only slice compiling without smuggling in resolution behavior.
 */
export function scalarAgent(setting: AgentSetting | undefined): string | undefined {
  return typeof setting === 'string' ? setting : undefined;
}

/**
 * Resolve the agent a given lifecycle stage maps to, the stage-aware counterpart
 * of {@link scalarAgent} that the spawn/instruction consumers use to route each
 * transition independently:
 *
 *   - a **scalar** setting covers every stage, so it is returned for any stage;
 *   - a **map** returns its entry for `stage`, or `undefined` when the stage is
 *     unmapped (a partial map that does not name this stage);
 *   - an **unset** setting returns `undefined`.
 *
 * `undefined` deliberately means "the caller falls back to its own default agent"
 * (`DEFAULT_AGENT` via `resolveAdapter`): this resolver stays pure and default-free
 * so "which stage maps where" (here) is kept separate from "what if nothing maps"
 * (the single default in `resolveAdapter`), and it can be unit-tested over
 * in-memory inputs with no spawn.
 */
export function resolveAgentForStage(
  setting: AgentSetting | undefined,
  stage: AgentStage
): string | undefined {
  if (typeof setting === 'string') return setting; // scalar covers every stage
  if (setting) return setting[stage]; // map entry, or undefined if unmapped
  return undefined; // unset → caller's DEFAULT_AGENT
}
