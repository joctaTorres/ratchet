/**
 * Unit tests for the batch `agent` setting schema.
 *
 * Implements: features/agent-stage-map/schema.feature
 * Implements: features/agent-spec-syntax/parse-agent-spec.feature
 * Implements: features/agent-spec-syntax/schema-validation.feature
 *
 * Pure schema validation — no filesystem, no spawn. Exercises the shared
 * `AgentSettingSchema` (and the inferred stage-map shape) directly, and confirms
 * both config scopes — the project-config `batch` schema
 * (`ProjectConfigSchema.shape.batch`) and the manifest override schema
 * (`BatchSettingsOverrideSchema`) — validate the `agent` field identically:
 * scalar accepted, full map accepted, partial map accepted, unset accepted,
 * unknown stage key rejected, non-string stage value rejected.
 *
 * Also covers the `agent[:model]` spec syntax: `parseAgentSpec` splits on the
 * first colon (bare name → no model key; opencode provider/model ids and
 * colon-bearing model ids pass through intact), rejects empty agent/model parts
 * naming the offending value, and the schema's `superRefine` forwards the same
 * message at both config scopes for malformed scalar and stage-map values.
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_STAGE_KEYS,
  AgentSettingSchema,
  AgentStageMapSchema,
  parseAgentSpec,
  resolveAgentForStage,
} from '../../../src/core/batch/agent-setting.js';
import { ProjectConfigSchema } from '../../../src/core/project-config.js';
import { BatchSettingsOverrideSchema } from '../../../src/core/batch/manifest.js';

// The two config scopes whose `batch.agent` / `agent` field is validated by the
// shared schema. Each parses a config-shaped object and returns the resolved
// `agent` value, so a single scenario asserts identical behavior at both scopes.
const scopes: { name: string; parse: (agent: unknown) => ReturnType<typeof AgentSettingSchema.safeParse> }[] = [
  {
    name: 'project-config',
    parse: (agent) => {
      const result = ProjectConfigSchema.shape.batch.safeParse({ agent });
      if (!result.success) return result;
      return { success: true, data: result.data?.agent } as ReturnType<
        typeof AgentSettingSchema.safeParse
      >;
    },
  },
  {
    name: 'manifest',
    parse: (agent) => {
      const result = BatchSettingsOverrideSchema.safeParse({ agent });
      if (!result.success) return result;
      return { success: true, data: result.data.agent } as ReturnType<
        typeof AgentSettingSchema.safeParse
      >;
    },
  },
];

describe('AGENT_STAGE_KEYS', () => {
  it('is exactly the propose/apply/verify/pr lifecycle', () => {
    expect(AGENT_STAGE_KEYS).toEqual(['propose', 'apply', 'verify', 'pr']);
  });
});

describe.each(scopes)('agent setting at $name scope', ({ parse }) => {
  it('accepts a scalar agent name (resolves to the string)', () => {
    const result = parse('opencode');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('opencode');
  });

  it('accepts a full propose/apply/verify/pr stage-map', () => {
    const map = { propose: 'claude', apply: 'opencode', verify: 'opencode', pr: 'claude' };
    const result = parse(map);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(map);
  });

  it('accepts a partial stage-map (only the stages provided)', () => {
    const result = parse({ apply: 'opencode' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ apply: 'opencode' });
  });

  it('accepts an unset agent (stays absent)', () => {
    const result = parse(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it('rejects an unknown stage key', () => {
    const result = parse({ deploy: 'claude' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-string stage value', () => {
    const result = parse({ propose: 42 });
    expect(result.success).toBe(false);
  });
});

// Direct coverage of the shared union/stage-map schemas, independent of scope.
describe('AgentSettingSchema', () => {
  it('accepts a scalar string', () => {
    expect(AgentSettingSchema.safeParse('claude').success).toBe(true);
  });

  it('accepts every single-stage map', () => {
    for (const stage of AGENT_STAGE_KEYS) {
      expect(AgentSettingSchema.safeParse({ [stage]: 'claude' }).success).toBe(true);
    }
  });

  it('rejects an unknown stage key on the stage-map schema', () => {
    expect(AgentStageMapSchema.safeParse({ deploy: 'claude' }).success).toBe(false);
  });

  it('rejects a non-string stage value on the stage-map schema', () => {
    expect(AgentStageMapSchema.safeParse({ propose: 42 }).success).toBe(false);
    expect(AgentStageMapSchema.safeParse({ apply: true }).success).toBe(false);
    expect(AgentStageMapSchema.safeParse({ verify: { nested: 'x' } }).success).toBe(false);
  });
});

// parseAgentSpec — pure parser for the `agent[:model]` spec string.
// Implements: features/agent-spec-syntax/parse-agent-spec.feature
describe('parseAgentSpec', () => {
  it('parses a bare agent name to { agent } with no model key', () => {
    const result = parseAgentSpec('claude');
    expect(result).toEqual({ agent: 'claude' });
    expect(result).not.toHaveProperty('model');
  });

  it('parses an agent:model spec into agent and model parts', () => {
    expect(parseAgentSpec('claude:fable')).toEqual({ agent: 'claude', model: 'fable' });
  });

  it.each([
    ['opencode:zai/glm-5.2', 'opencode', 'zai/glm-5.2'],
    ['opencode:qwen/qwen-3.7', 'opencode', 'qwen/qwen-3.7'],
    ['codex:vendor:tagged-1', 'codex', 'vendor:tagged-1'],
  ])('splits "%s" on the first colon so the model passes through intact', (spec, agent, model) => {
    expect(parseAgentSpec(spec)).toEqual({ agent, model });
  });

  it.each(['claude:', ':fable', ':'])('rejects "%s" naming the offending value', (spec) => {
    expect(() => parseAgentSpec(spec)).toThrow(spec);
  });

  it('rejects an empty spec string identifying the empty agent part', () => {
    expect(() => parseAgentSpec('')).toThrow('empty agent part');
  });
});

// Schema validation of the `agent[:model]` spec at every string position.
// Implements: features/agent-spec-syntax/schema-validation.feature
describe.each(scopes)('agent[:model] spec at $name scope', ({ parse }) => {
  it('accepts a scalar agent:model spec, preserving the whole spec string', () => {
    const result = parse('claude:fable');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('claude:fable');
  });

  it('accepts a stage-map of agent:model specs, preserving each whole spec string', () => {
    const map = {
      propose: 'claude:fable',
      apply: 'opencode:zai/glm-5.2',
      verify: 'opencode:qwen/qwen-3.7',
    };
    const result = parse(map);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(map);
  });

  it('accepts existing bare-name configs unchanged (scalar and map)', () => {
    const scalar = parse('opencode');
    expect(scalar.success).toBe(true);
    if (scalar.success) expect(scalar.data).toBe('opencode');

    const map = parse({ apply: 'opencode' });
    expect(map.success).toBe(true);
    if (map.success) expect(map.data).toEqual({ apply: 'opencode' });
  });

  it.each(['claude:', ':fable'])('rejects a malformed scalar "%s" naming the offending value', (spec) => {
    const result = parse(spec);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join('\n');
      expect(message).toContain(spec);
    }
  });

  it('rejects a malformed spec inside a stage-map value naming the offending value', () => {
    const result = parse({ apply: ':fable' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join('\n');
      expect(message).toContain(':fable');
    }
  });
});

describe('resolveAgentForStage with agent[:model] specs', () => {
  it('returns the whole spec string for the mapped stage', () => {
    expect(resolveAgentForStage({ apply: 'opencode:zai/glm-5.2' }, 'apply')).toBe(
      'opencode:zai/glm-5.2'
    );
  });

  it('returns the whole scalar spec string for any stage', () => {
    expect(resolveAgentForStage('claude:fable', 'verify')).toBe('claude:fable');
  });
});
