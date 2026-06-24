import { describe, it, expect } from 'vitest';
import {
  AGENT_BINARIES,
  resolveAdapter,
  availableAdapters,
  type AgentRequestContext,
} from '../../../src/core/batch/engine/agent.js';
import { checkAgents } from '../../../src/core/doctor/checks/agents.js';
import { AI_TOOLS } from '../../../src/core/config.js';
import type {
  BootstrapDeps,
  RunResult,
} from '../../../src/core/batch/engine/runtime/rex-bootstrap.js';

/**
 * Verifies the link established by `link-agents-to-init-registry`: init
 * (AI_TOOLS) is the single source of truth for which coding agents exist, the
 * three agent registries cannot drift, and doctor still required-fails when no
 * agent binary is installed.
 *
 * Features:
 * - features/agent-init-link/derived-agent-registry.feature
 * - features/agent-init-link/registry-drift-guard.feature
 * - features/agent-init-link/doctor-preserved.feature
 */

/** The set of init tools that declare an agentBinary (the coding agents). */
const agentInitTools = AI_TOOLS.filter((t) => t.agentBinary);
const agentInitIds = new Set(agentInitTools.map((t) => t.value));
/** The registered spawn-adapter ids (BUILTIN_ADAPTERS keys, via the public API). */
const adapterIds = new Set(availableAdapters());

const CTX: AgentRequestContext = { batch: 'b', change: 'c' };

/** Minimal in-memory deps for the doctor agent check. */
class FakeDeps implements BootstrapDeps {
  toolsOnPath = new Set<string>();
  constructor(private handler: (command: string, args: string[]) => RunResult) {}
  run(command: string, args: string[]): RunResult {
    return this.handler(command, args);
  }
  hasOnPath(tool: string): boolean {
    return this.toolsOnPath.has(tool);
  }
  exists(): boolean {
    return false;
  }
  readText(): string {
    throw new Error('not used');
  }
  writeText(): void {}
  mkdirp(): void {}
  rmrf(): void {}
}
const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });

describe('agent ↔ init registry derivation', () => {
  it('AGENT_BINARIES reflects exactly the agentBinary-marked init tools, including gemini', () => {
    const expected = Object.fromEntries(
      agentInitTools.map((t) => [t.value, t.agentBinary])
    );
    expect({ ...AGENT_BINARIES }).toEqual(expected);
    // gemini is a first-class coding agent now.
    expect(AGENT_BINARIES.gemini).toBe('gemini');
    expect(AGENT_BINARIES.cursor).toBe('cursor-agent');
  });

  it('excludes init tools that are NOT coding agents (no agentBinary)', () => {
    expect(AGENT_BINARIES).not.toHaveProperty('github-copilot');
    expect(AGENT_BINARIES).not.toHaveProperty('opencode');
    // And those tools really are registered init tools without an agentBinary.
    for (const id of ['github-copilot', 'opencode']) {
      const tool = AI_TOOLS.find((t) => t.value === id);
      expect(tool).toBeDefined();
      expect(tool?.agentBinary).toBeUndefined();
    }
  });
});

describe('registry drift guard', () => {
  it('the three agent registries describe the same set of ids', () => {
    const binaryIds = new Set(Object.keys(AGENT_BINARIES));
    // agentBinary-marked AI_TOOLS === BUILTIN_ADAPTERS keys === AGENT_BINARIES keys.
    expect(binaryIds).toEqual(agentInitIds);
    expect(binaryIds).toEqual(adapterIds);
    expect(adapterIds).toEqual(agentInitIds);
  });

  it('each agent spawn command equals its declared init agentBinary', () => {
    for (const tool of agentInitTools) {
      const adapter = resolveAdapter(tool.value);
      const command = adapter.buildRequest(CTX, 'instr', '/cwd', {}).command;
      // The argv the engine would spawn must match the binary doctor probes.
      expect(command).toBe(tool.agentBinary);
      expect(command).toBe(AGENT_BINARIES[tool.value]);
    }
  });

  it('no init agent is missing a spawn adapter and no adapter lacks an init agent', () => {
    // These difference checks are what fail loudly if someone adds one side only.
    const initWithoutAdapter = [...agentInitIds].filter((id) => !adapterIds.has(id));
    const adapterWithoutInit = [...adapterIds].filter((id) => !agentInitIds.has(id));
    expect(initWithoutAdapter).toEqual([]);
    expect(adapterWithoutInit).toEqual([]);
  });
});

describe('doctor agent check is linked to init and preserved', () => {
  it('every agent doctor would probe corresponds to an init coding-agent tool', () => {
    for (const id of Object.keys(AGENT_BINARIES)) {
      const tool = AI_TOOLS.find((t) => t.value === id);
      expect(tool, `agent '${id}' must be an init tool`).toBeDefined();
      expect(tool?.agentBinary).toBe(AGENT_BINARIES[id]);
    }
  });

  it('still required-fails when no agent binary is on PATH', () => {
    const deps = new FakeDeps(() => ok()); // nothing on PATH
    const check = checkAgents(deps);
    expect(check.status).toBe('fail');
    expect(check.severity).toBe('required');
    expect(check.remedy).toBeDefined();
  });

  it('passes when any single agent binary (incl. gemini) is present', () => {
    const deps = new FakeDeps((command, args) =>
      args.includes('--version') ? ok(`${command} 1.0.0`) : ok()
    );
    deps.toolsOnPath.add('gemini'); // only gemini installed
    const check = checkAgents(deps);
    expect(check.status).toBe('pass');
    expect(check.detail).toContain('gemini');
  });
});
