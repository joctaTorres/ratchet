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
 * `propose | apply | verify | pr | decompose`. The first three mirror the
 * `Transition` lifecycle the engine already models (`engine/contract.ts`); `pr`
 * is the fourth routable stage for the dedicated PR agent that opens a
 * whole-batch PR at completion. `decompose` is the fifth routable stage for the
 * phase-decomposition agent that authors a reachable phase's concrete change
 * intents into `batch.yaml` from prior phases' shipped results. `Transition`
 * stays a strict subset of these keys, so schema-only: no current transition
 * maps to `pr` or `decompose` (nothing spawns those agents here — those arrive
 * with the spawn-at-completion / decomposition changes). Kept as a local
 * constant to stay schema-only; the resolution consumers key off the same list.
 */
export const AGENT_STAGE_KEYS = ['propose', 'apply', 'verify', 'pr', 'decompose'] as const;
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
 * An `agent[:model]` spec parsed into its agent part and, when a model is
 * named, its model part. A bare agent name parses to `{ agent }` with no
 * `model` key, so consumers can distinguish "use the harness default model"
 * (no key) from an explicitly named model string.
 */
export type AgentSpec = { agent: string; model?: string };

/**
 * Parse an `agent[:model]` spec string into {@link AgentSpec}.
 *
 * Splits on the **first** `:` only, so opencode `provider/model` ids and any
 * model id that itself contains a colon pass through intact as the model part
 * (e.g. `opencode:zai/glm-5.2` → `{ agent: "opencode", model: "zai/glm-5.2" }`,
 * `codex:vendor:tagged-1` → `{ agent: "codex", model: "vendor:tagged-1" }`).
 * A bare agent name (no colon) parses to `{ agent }` with no `model` key.
 *
 * An empty agent part (`:fable`, `:`) or empty model part (`claude:`, `:`) is
 * rejected with an error whose message names the offending value, so config
 * load surfaces the bad spec instead of spawn time. The parser is otherwise
 * free-form pass-through: it never consults the adapter registry and hardcodes
 * no agent name, so unknown-agent rejection stays where it lives today
 * (`UnknownAgentError` in `resolveAdapter`, before any spawn).
 */
export function parseAgentSpec(value: string): AgentSpec {
  const colon = value.indexOf(':');
  if (colon === -1) {
    if (value.length === 0) {
      throw new Error(
        `Invalid agent spec "": empty agent part (expected "agent[:model]")`
      );
    }
    if (value !== value.trim()) {
      throw new Error(
        `Invalid agent spec "${value}": agent part "${value}" has leading or trailing whitespace (expected "agent[:model]")`
      );
    }
    return { agent: value };
  }
  const agent = value.slice(0, colon);
  const model = value.slice(colon + 1);
  if (agent.length === 0) {
    throw new Error(
      `Invalid agent spec "${value}": empty agent part (expected "agent[:model]")`
    );
  }
  if (model.length === 0) {
    throw new Error(
      `Invalid agent spec "${value}": empty model part (expected "agent[:model]")`
    );
  }
  if (agent !== agent.trim()) {
    throw new Error(
      `Invalid agent spec "${value}": agent part "${agent}" has leading or trailing whitespace (expected "agent[:model]")`
    );
  }
  if (model !== model.trim()) {
    throw new Error(
      `Invalid agent spec "${value}": model part "${model}" has leading or trailing whitespace (expected "agent[:model]")`
    );
  }
  if (model.startsWith('-')) {
    throw new Error(
      `Invalid agent spec "${value}": model part "${model}" must not start with "-" (expected "agent[:model]")`
    );
  }
  return { agent, model };
}

/**
 * The `agent` setting: a scalar agent name OR a partial stage-map.
 * `z.union([z.string(), …])` keeps the scalar path byte-for-byte compatible with
 * the historical `z.string().optional()` shape. A `superRefine` validates every
 * string position (scalar and each stage-map value) through {@link parseAgentSpec}
 * so a malformed `agent[:model]` spec is rejected at config load — both config
 * scopes — with the parser's message naming the offending value; the schema
 * keeps storing whole spec strings so nearest-wins per-stage merge moves agent
 * and model atomically across scopes.
 */
export const AgentSettingSchema = z
  .union([z.string(), AgentStageMapSchema])
  .superRefine((value, ctx) => {
    if (typeof value === 'string') {
      try {
        parseAgentSpec(value);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: (err as Error).message,
        });
      }
      return;
    }
    if (value) {
      for (const stage of AGENT_STAGE_KEYS) {
        const entry = value[stage];
        if (typeof entry !== 'string') continue;
        try {
          parseAgentSpec(entry);
        } catch (err) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [stage],
            message: (err as Error).message,
          });
        }
      }
    }
  });

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
