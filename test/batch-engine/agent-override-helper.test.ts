import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AgentOverrideRefusedError,
  activeAgentCmdOverride,
  agentOverrideNotice,
  assertAgentOverrideAllowed,
  buildAgentSpawnRequest,
  type AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';
import {
  canTranslatePermissions,
  resolvePermissionFlags,
} from '../../src/core/batch/runtime/agent-permissions.js';
import type { ResolvedPermissionsPolicy } from '../../src/core/batch/permissions-policy.js';

/**
 * Unit tests (no fs, no spawn) for the ONE shared override-aware spawn-request
 * helper. Implements:
 *   - features/agent-cmd-override/shared-spawn-helper.feature
 *   - features/agent-cmd-override/opt-in-gate.feature (gate semantics)
 *   - features/agent-cmd-override/override-permissions.feature
 *   - features/agent-cmd-override/override-notice.feature (notice semantics)
 */

const VAR = 'RATCHET_BATCH_AGENT_CMD';
const CWD = '/repo';

const POLICY: ResolvedPermissionsPolicy = {
  posture: 'repo-sandboxed-permissive',
  allow: [],
  deny: [],
  raw: {},
};

const ADAPTER_REQUEST: AgentSpawnRequest = {
  command: 'claude',
  args: ['-p'],
  instructions: 'do it',
  cwd: CWD,
  env: {},
};

function build(overrides: Partial<Parameters<typeof buildAgentSpawnRequest>[0]> = {}) {
  const buildAdapterRequest = vi.fn(() => ADAPTER_REQUEST);
  const notify = vi.fn();
  const result = buildAgentSpawnRequest({
    overrideEnvVar: VAR,
    env: { [VAR]: 'echo stub' },
    allowOverride: true,
    instructions: 'do it',
    cwd: CWD,
    buildAdapterRequest,
    notify,
    ...overrides,
  });
  return { result, buildAdapterRequest, notify };
}

describe('activeAgentCmdOverride', () => {
  it('returns the trimmed value when set', () => {
    expect(activeAgentCmdOverride(VAR, { [VAR]: '  echo hi  ' })).toBe('echo hi');
  });

  it('treats unset and whitespace-only as inactive', () => {
    expect(activeAgentCmdOverride(VAR, {})).toBeUndefined();
    expect(activeAgentCmdOverride(VAR, { [VAR]: '   \n' })).toBeUndefined();
  });
});

describe('agentOverrideNotice', () => {
  it('names the env var', () => {
    expect(agentOverrideNotice(VAR)).toBe('⚠ agent overridden by RATCHET_BATCH_AGENT_CMD');
    expect(agentOverrideNotice('RATCHET_EVAL_AGENT_CMD')).toBe(
      '⚠ agent overridden by RATCHET_EVAL_AGENT_CMD'
    );
  });
});

describe('buildAgentSpawnRequest — no active override', () => {
  it.each([{}, { [VAR]: '  ' }])('calls the adapter closure exactly once (env %j)', (env) => {
    const { result, buildAdapterRequest, notify } = build({ env, allowOverride: false });
    expect(result).toEqual({ request: ADAPTER_REQUEST, agentOverride: false });
    expect(buildAdapterRequest).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('the opt-in alone changes nothing', () => {
    const { result, notify } = build({ env: {}, allowOverride: true });
    expect(result.request).toBe(ADAPTER_REQUEST);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('buildAgentSpawnRequest — opt-in gate', () => {
  afterEach(() => {
    delete process.env.RATCHET_ALLOW_AGENT_OVERRIDE;
  });

  it('refuses an active override without the opt-in, naming the var and flag', () => {
    const buildAdapterRequest = vi.fn(() => ADAPTER_REQUEST);
    const notify = vi.fn();
    const attempt = () =>
      buildAgentSpawnRequest({
        overrideEnvVar: VAR,
        env: { [VAR]: 'echo stub' },
        allowOverride: false,
        instructions: 'x',
        cwd: CWD,
        buildAdapterRequest,
        notify,
      });
    expect(attempt).toThrow(AgentOverrideRefusedError);
    expect(attempt).toThrow(/RATCHET_BATCH_AGENT_CMD.*--allow-agent-override/);
    // Neither the stand-in nor the configured agent is built.
    expect(buildAdapterRequest).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('never reads the opt-in from process.env', () => {
    process.env.RATCHET_ALLOW_AGENT_OVERRIDE = '1';
    expect(() => build({ allowOverride: false })).toThrow(AgentOverrideRefusedError);
  });

  it('honors an allowed override as bash -c with instructions, cwd, and an exported provenance marker', () => {
    const { result, buildAdapterRequest, notify } = build({ env: { [VAR]: ' echo stub ', KEEP: '1' } });
    expect(result.agentOverride).toBe(true);
    expect(result.request).toEqual({
      command: 'bash',
      args: ['-c', 'export RATCHET_SPAWN_VIA=env-override; echo stub', 'claude'],
      instructions: 'do it',
      cwd: CWD,
      env: { [VAR]: ' echo stub ', KEEP: '1' },
    });
    expect(buildAdapterRequest).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('⚠ agent overridden by RATCHET_BATCH_AGENT_CMD');
  });

  it('writes the notice to stderr by default', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      buildAgentSpawnRequest({
        overrideEnvVar: VAR,
        env: { [VAR]: 'echo stub' },
        allowOverride: true,
        instructions: 'x',
        cwd: CWD,
        buildAdapterRequest: () => ADAPTER_REQUEST,
      });
      expect(write).toHaveBeenCalledWith('⚠ agent overridden by RATCHET_BATCH_AGENT_CMD\n');
    } finally {
      write.mockRestore();
    }
  });
});

describe('buildAgentSpawnRequest — permission forwarding', () => {
  it.each(['claude', 'codex', 'gemini', 'cursor', 'opencode'])(
    'forwards resolvePermissionFlags output for %s as $@ with the agent as $0',
    (agent) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { result } = build({ agentName: agent, permissions: POLICY });
        expect(result.request.args).toEqual([
          '-c',
          'export RATCHET_SPAWN_VIA=env-override; echo stub',
          agent,
          ...resolvePermissionFlags(agent, POLICY, CWD),
        ]);
      } finally {
        warn.mockRestore();
      }
    }
  );

  it('forwards claude sandbox flags (never a bare flagless request)', () => {
    const { result } = build({ agentName: 'claude', permissions: POLICY });
    expect(result.request.args.length).toBeGreaterThan(3);
    expect(result.request.args).toContain('--disallowedTools');
  });

  it('refuses when the policy cannot be translated for the agent', () => {
    expect(() => build({ agentName: 'synthetic', permissions: POLICY })).toThrow(
      /cannot be translated for agent 'synthetic'/
    );
  });

  it('forwards a raw entry for an agent without a posture mapper', () => {
    const policy = { ...POLICY, raw: { synthetic: ['--x'] } } as unknown as ResolvedPermissionsPolicy;
    const { result } = build({ agentName: 'synthetic', permissions: policy });
    expect(result.request.args).toEqual(['-c', 'export RATCHET_SPAWN_VIA=env-override; echo stub', 'synthetic', '--x']);
  });

  it('forwards nothing when no policy is supplied (eval side)', () => {
    const { result } = build({ overrideEnvVar: 'RATCHET_EVAL_AGENT_CMD', env: { RATCHET_EVAL_AGENT_CMD: 'x' } });
    expect(result.request.args).toEqual(['-c', 'export RATCHET_SPAWN_VIA=env-override; x', 'claude']);
  });
});

describe('the provenance marker reaches the stand-in', () => {
  it('is exported by the -c script itself, visible to a real bash stand-in', async () => {
    const { execFileSync } = await import('node:child_process');
    const { result } = build({ env: { [VAR]: 'printf %s "$RATCHET_SPAWN_VIA|$0|$*"' }, agentName: 'claude' });
    const out = execFileSync(result.request.command, [...result.request.args, '--flag'], {
      env: { PATH: process.env.PATH },
    }).toString();
    expect(out).toBe('env-override|claude|--flag');
  });
});

describe('canTranslatePermissions', () => {
  it('is true for every mapped agent and false for an unknown one', () => {
    for (const a of ['claude', 'codex', 'gemini', 'cursor', 'opencode']) {
      expect(canTranslatePermissions(a, POLICY)).toBe(true);
    }
    expect(canTranslatePermissions('synthetic', POLICY)).toBe(false);
    expect(canTranslatePermissions('toString', POLICY)).toBe(false);
  });
});

describe('assertAgentOverrideAllowed', () => {
  it('throws only for an active override without the opt-in', () => {
    expect(() => assertAgentOverrideAllowed(VAR, { [VAR]: 'x' }, false)).toThrow(
      AgentOverrideRefusedError
    );
    expect(() => assertAgentOverrideAllowed(VAR, { [VAR]: 'x' }, true)).not.toThrow();
    expect(() => assertAgentOverrideAllowed(VAR, { [VAR]: ' ' }, false)).not.toThrow();
    expect(() => assertAgentOverrideAllowed(VAR, {}, false)).not.toThrow();
  });
});
