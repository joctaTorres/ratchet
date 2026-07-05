/**
 * Unit tests for the batch `agent` setting schema.
 *
 * Implements: features/agent-stage-map/schema.feature
 *
 * Pure schema validation — no filesystem, no spawn. Exercises the shared
 * `AgentSettingSchema` (and the inferred stage-map shape) directly, and confirms
 * both config scopes — the project-config `batch` schema
 * (`ProjectConfigSchema.shape.batch`) and the manifest override schema
 * (`BatchSettingsOverrideSchema`) — validate the `agent` field identically:
 * scalar accepted, full map accepted, partial map accepted, unset accepted,
 * unknown stage key rejected, non-string stage value rejected.
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_STAGE_KEYS,
  AgentSettingSchema,
  AgentStageMapSchema,
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
