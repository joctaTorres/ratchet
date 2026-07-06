/**
 * Unit tests for per-stage scope attribution of the resolved agent setting.
 *
 * Implements: features/agent-scope-attribution/stage-scope-lookup.feature
 *
 * Pure in-memory layerings (no filesystem, no spawn): `resolveAgentStageScopes`
 * replays the same scalar-resets / map-merges-per-stage fold as
 * `resolveAgentSetting` but tracks which scope supplied each stage's resolved
 * `agent[:model]` spec string. The agreement invariant pairs the lookup with
 * `resolveAgentSetting` over the same layers and asserts (a) the merge result
 * is byte-for-byte unchanged and (b) every attributed stage's scope layer
 * supplies exactly that stage's resolved spec string.
 */

import { describe, it, expect } from 'vitest';
import { AGENT_STAGE_KEYS } from '../../../src/core/batch/agent-setting.js';
import {
  resolveAgentSetting,
  resolveAgentStageScopes,
  uniformAgentScope,
} from '../../../src/core/batch/config.js';
import type { SettingSource } from '../../../src/core/batch/config.js';
import type { AgentSetting, AgentStage, AgentStageMap } from '../../../src/core/batch/agent-setting.js';

type Layer = { scope: SettingSource; agent: AgentSetting | undefined };

const ALL_STAGES: AgentStage[] = [...AGENT_STAGE_KEYS];

function layers(...entries: Layer[]): Layer[] {
  return entries;
}

function stageMap(entries: Partial<Record<AgentStage, string>>): AgentStageMap {
  return { ...entries };
}

describe('resolveAgentStageScopes', () => {
  it('attributes every stage to the supplying scope for a scalar-only layering', () => {
    // project-config scalar agent "claude" and no manifest agent → every stage
    // attributed to "project".
    const result = resolveAgentStageScopes(
      layers(
        { scope: 'project', agent: 'claude' },
        { scope: 'manifest', agent: undefined }
      )
    );
    for (const stage of ALL_STAGES) {
      expect(result[stage]).toBe('project');
    }
  });

  it('attributes every stage to the nearer scope for a nearer scalar', () => {
    // project-config scalar "claude" + manifest scalar "opencode:zai/glm-5.2"
    // → every stage attributed to "manifest".
    const result = resolveAgentStageScopes(
      layers(
        { scope: 'project', agent: 'claude' },
        { scope: 'manifest', agent: 'opencode:zai/glm-5.2' }
      )
    );
    for (const stage of ALL_STAGES) {
      expect(result[stage]).toBe('manifest');
    }
  });

  it('attributes only the stages a partial map names (partial-map-only)', () => {
    // project-config stage map naming only propose → propose attributed to
    // "project"; apply/verify/pr carry no attribution.
    const result = resolveAgentStageScopes(
      layers(
        { scope: 'project', agent: stageMap({ propose: 'claude' }) },
        { scope: 'manifest', agent: undefined }
      )
    );
    expect(result.propose).toBe('project');
    expect(result.apply).toBeUndefined();
    expect(result.verify).toBeUndefined();
    expect(result.pr).toBeUndefined();
  });

  it('attributes each stage to the scope that supplied its spec (mixed scalar + map)', () => {
    // project-config scalar "claude" + manifest stage map naming only apply →
    // apply attributed to "manifest"; propose/verify/pr attributed to "project".
    const result = resolveAgentStageScopes(
      layers(
        { scope: 'project', agent: 'claude' },
        { scope: 'manifest', agent: stageMap({ apply: 'opencode:zai/glm-5.2' }) }
      )
    );
    expect(result.apply).toBe('manifest');
    expect(result.propose).toBe('project');
    expect(result.verify).toBe('project');
    expect(result.pr).toBe('project');
  });

  it('attributes per stage with nearest-wins for a map-over-map layering', () => {
    // project-config map { propose: claude, apply: claude } + manifest map
    // { apply: opencode } → propose attributed to "project"; apply attributed
    // to "manifest"; verify/pr carry no attribution.
    const result = resolveAgentStageScopes(
      layers(
        { scope: 'project', agent: stageMap({ propose: 'claude', apply: 'claude' }) },
        { scope: 'manifest', agent: stageMap({ apply: 'opencode' }) }
      )
    );
    expect(result.propose).toBe('project');
    expect(result.apply).toBe('manifest');
    expect(result.verify).toBeUndefined();
    expect(result.pr).toBeUndefined();
  });

  it('resets lower-scope per-stage attributions when a nearer scalar appears', () => {
    // project-config stage map naming only apply + manifest scalar "claude" →
    // every stage attributed to "manifest" (the nearer scalar covers all).
    const result = resolveAgentStageScopes(
      layers(
        { scope: 'project', agent: stageMap({ apply: 'opencode' }) },
        { scope: 'manifest', agent: 'claude' }
      )
    );
    for (const stage of ALL_STAGES) {
      expect(result[stage]).toBe('manifest');
    }
  });

  it('attributes no stage to any scope when the agent setting is unset', () => {
    // no project-config agent and no manifest agent → no attribution.
    const result = resolveAgentStageScopes(
      layers(
        { scope: 'project', agent: undefined },
        { scope: 'manifest', agent: undefined }
      )
    );
    for (const stage of ALL_STAGES) {
      expect(result[stage]).toBeUndefined();
    }
  });

  it('leaves unmapped stages absent when only a partial map contributed (no scalar)', () => {
    // A single partial map with no scalar: named stages attributed; others absent.
    const result = resolveAgentStageScopes(
      layers({ scope: 'project', agent: stageMap({ verify: 'gemini' }) })
    );
    expect(result.verify).toBe('project');
    expect(result.propose).toBeUndefined();
    expect(result.apply).toBeUndefined();
    expect(result.pr).toBeUndefined();
  });

  describe('agreement invariant: attribution agrees with the resolved merge', () => {
    type Case = { name: string; layering: Layer[] };

    const cases: Case[] = [
      {
        name: 'scalar-only (project)',
        layering: layers(
          { scope: 'project', agent: 'claude' },
          { scope: 'manifest', agent: undefined }
        ),
      },
      {
        name: 'nearer scalar (manifest)',
        layering: layers(
          { scope: 'project', agent: 'claude' },
          { scope: 'manifest', agent: 'opencode:zai/glm-5.2' }
        ),
      },
      {
        name: 'partial-map-only (project)',
        layering: layers(
          { scope: 'project', agent: stageMap({ propose: 'claude' }) },
          { scope: 'manifest', agent: undefined }
        ),
      },
      {
        name: 'mixed scalar + partial-map',
        layering: layers(
          { scope: 'project', agent: 'claude' },
          { scope: 'manifest', agent: stageMap({ apply: 'opencode:zai/glm-5.2' }) }
        ),
      },
      {
        name: 'map-over-map (nearest-wins per stage)',
        layering: layers(
          { scope: 'project', agent: stageMap({ propose: 'claude', apply: 'claude' }) },
          { scope: 'manifest', agent: stageMap({ apply: 'opencode' }) }
        ),
      },
      {
        name: 'nearer scalar resets lower-scope map',
        layering: layers(
          { scope: 'project', agent: stageMap({ apply: 'opencode' }) },
          { scope: 'manifest', agent: 'claude' }
        ),
      },
      {
        name: 'unset (no agent at any scope)',
        layering: layers(
          { scope: 'project', agent: undefined },
          { scope: 'manifest', agent: undefined }
        ),
      },
    ];

    for (const { name, layering } of cases) {
      it(`leaves the resolved merge byte-for-byte unchanged and attributes supplying scopes: ${name}`, () => {
        const merged = resolveAgentSetting(layering);
        const scopes = resolveAgentStageScopes(layering);

        // (a) The resolved agent value is exactly what the existing merge
        // produces — the scope lookup must not perturb the merge.
        expect(merged.agent).toEqual(mergeReference(layering).agent);

        // (b) For every attributed stage, the named scope's layer supplies
        // exactly that stage's resolved spec string; and every stage whose
        // resolved spec is undefined carries no attribution.
        for (const stage of ALL_STAGES) {
          const resolvedSpec = resolveStageSpec(merged.agent, stage);
          const attributed = scopes[stage];
          if (resolvedSpec === undefined) {
            expect(attributed).toBeUndefined();
          } else {
            expect(attributed).toBeDefined();
            // The layer at the attributed scope supplies exactly this stage's
            // resolved spec string (either via scalar or stage-map entry).
            const layer = layering.find((l) => l.scope === attributed);
            expect(layer).toBeDefined();
            const supplied = supplyForStage(layer!.agent, stage);
            expect(supplied).toBe(resolvedSpec);
          }
        }
      });
    }
  });
});

/**
 * Unit tests for `uniformAgentScope` — the stage-less scalar-resolution sibling
 * of `resolveAgentStageScopes` used by the decomposition spawn (which resolves
 * via `scalarAgent`, so a stage map never routes it). Implements the
 * "uniform supplying scope is derived only when every stage agrees" scenario of
 * features/pr-decompose-stage-attribution/decompose-stage-attribution.feature.
 *
 * Pure in-memory: returns the single scope when every AGENT_STAGE_KEYS entry is
 * present and identical; mixed, partial, empty, and `undefined` maps resolve to
 * `undefined`.
 */
describe('uniformAgentScope', () => {
  it('returns the scope when every stage names the same scope', () => {
    const scopes: Partial<Record<AgentStage, SettingSource>> = {};
    for (const stage of ALL_STAGES) scopes[stage] = 'project';
    expect(uniformAgentScope(scopes)).toBe('project');
  });

  it('returns the manifest scope when every stage names the manifest scope', () => {
    const scopes: Partial<Record<AgentStage, SettingSource>> = {};
    for (const stage of ALL_STAGES) scopes[stage] = 'manifest';
    expect(uniformAgentScope(scopes)).toBe('manifest');
  });

  it('returns undefined for a mixed map (stages disagree)', () => {
    const scopes: Partial<Record<AgentStage, SettingSource>> = {
      propose: 'project',
      apply: 'manifest',
      verify: 'project',
      pr: 'project',
    };
    expect(uniformAgentScope(scopes)).toBeUndefined();
  });

  it('returns undefined for a partial map (a stage is absent)', () => {
    const scopes: Partial<Record<AgentStage, SettingSource>> = {
      propose: 'project',
      apply: 'project',
      // verify absent
      pr: 'project',
    };
    expect(uniformAgentScope(scopes)).toBeUndefined();
  });

  it('returns undefined for an empty map', () => {
    expect(uniformAgentScope({})).toBeUndefined();
  });

  it('returns undefined when the scopes map is undefined', () => {
    expect(uniformAgentScope(undefined)).toBeUndefined();
  });

  it('returns undefined when a single stage differs from an otherwise-uniform map', () => {
    const scopes: Partial<Record<AgentStage, SettingSource>> = {
      propose: 'project',
      apply: 'project',
      verify: 'project',
      pr: 'manifest',
    };
    expect(uniformAgentScope(scopes)).toBeUndefined();
  });
});

/**
 * Reference implementation of the existing `resolveAgentSetting` merge result,
 * computed independently so the agreement invariant can detect drift between
 * `resolveAgentSetting` and `resolveAgentStageScopes`. Mirrors the documented
 * fold: scalar resets `base`/`stages`; map merges per stage (nearer wins).
 */
function mergeReference(
  layering: Layer[]
): { agent: string | AgentStageMap | undefined } {
  let base: string | undefined;
  let stages: Partial<Record<AgentStage, string>> = {};
  let mapContributed = false;
  let contributed = false;

  for (const { agent } of layering) {
    if (agent === undefined) continue;
    contributed = true;
    if (typeof agent === 'string') {
      base = agent;
      stages = {};
      mapContributed = false;
    } else {
      for (const stage of AGENT_STAGE_KEYS) {
        const mapped = agent[stage];
        if (mapped !== undefined) stages[stage] = mapped;
      }
      mapContributed = true;
    }
  }

  if (!contributed) return { agent: undefined };
  if (!mapContributed) return { agent: base };
  if (base !== undefined) {
    const full: AgentStageMap = {};
    for (const stage of AGENT_STAGE_KEYS) {
      full[stage] = stages[stage] ?? base;
    }
    return { agent: full };
  }
  return { agent: { ...stages } };
}

/**
 * Resolve a single stage's spec string from a merged `agent` value, mirroring
 * `resolveAgentForStage`: scalar covers every stage; map returns its entry (or
 * undefined when unmapped); undefined stays undefined.
 */
function resolveStageSpec(
  agent: string | AgentStageMap | undefined,
  stage: AgentStage
): string | undefined {
  if (agent === undefined) return undefined;
  if (typeof agent === 'string') return agent;
  return agent[stage];
}

/**
 * What spec string a given layer's `agent` value supplies for `stage`:
 * a scalar supplies itself for every stage; a map supplies its entry (or
 * undefined when it does not name the stage); undefined supplies nothing.
 */
function supplyForStage(
  agent: AgentSetting | undefined,
  stage: AgentStage
): string | undefined {
  if (agent === undefined) return undefined;
  if (typeof agent === 'string') return agent;
  return agent[stage];
}
