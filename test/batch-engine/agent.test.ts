import { describe, it, expect } from 'vitest';
import {
  resolveAdapter,
  activeAgentCmdOverride,
  buildAgentSpawnRequest,
  agentOverrideNotice,
  ENV_OVERRIDE_PROVENANCE,
  makeRealSpawner,
  realSpawner,
  type AgentRequestContext,
  type AgentSpawnRequest,
} from '../../src/core/batch/engine/agent.js';

/**
 * Adapter capability + argv assertions for `capability-gating.feature` scenarios
 * 1–2: the claude adapter is stream-json-capable with the exact stream-json argv,
 * and codex/gemini/cursor are NOT capable with their argv unchanged.
 *
 * Also covers `model-flag-argv.feature`: each adapter appends its own model flag
 * (`--model` for claude/opencode/cursor, `-m` for codex/gemini) with the exact
 * model string when `context.model` is set, the pair sits between the base argv
 * and the permission flags, and a bare agent name (no model) keeps today's argv
 * byte-for-byte.
 */

const CTX: AgentRequestContext = { batch: 'b', change: 'c' };

function argvOf(name: string): string[] {
  const adapter = resolveAdapter(name);
  return adapter.buildRequest(CTX, 'instr', '/cwd', {}).args;
}

describe('agent adapters — stream-json capability', () => {
  it('the claude adapter is declared stream-json capable with the exact argv', () => {
    const claude = resolveAdapter('claude');
    expect(claude.emitsStreamJson).toBe(true);
    expect(argvOf('claude')).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]);
  });

  it('codex/gemini/cursor are NOT stream-json capable with unchanged argv', () => {
    for (const name of ['codex', 'gemini', 'cursor']) {
      expect(resolveAdapter(name).emitsStreamJson ?? false).toBe(false);
    }
    // Unchanged argv from before this change.
    expect(argvOf('codex')).toEqual(['exec', '-']);
    expect(argvOf('gemini')).toEqual(['-p']);
    expect(argvOf('cursor')).toEqual(['-p']);
  });

  it('the opencode adapter is declared stream-json capable with the run --format json argv', () => {
    const opencode = resolveAdapter('opencode');
    expect(opencode.emitsStreamJson).toBe(true);
    expect(argvOf('opencode')).toEqual(['run', '--format', 'json']);
  });

  it('the opencode command + stdin passing are as expected', () => {
    const req = resolveAdapter('opencode').buildRequest(CTX, 'the prompt', '/cwd', {});
    expect(req.command).toBe('opencode');
    expect(req.instructions).toBe('the prompt'); // passed on stdin
  });

  it('the claude command + stdin passing are unchanged', () => {
    const req = resolveAdapter('claude').buildRequest(CTX, 'the prompt', '/cwd', {});
    expect(req.command).toBe('claude');
    expect(req.instructions).toBe('the prompt'); // still passed on stdin
  });
});

/**
 * Implements: features/model-flag-threading/model-flag-argv.feature
 *
 * Scenario Outline: A named model is appended with the adapter's own flag — each
 * built-in adapter appends `[flag, model]` after its base argv when
 * `context.model` is set; no model keeps today's argv byte-for-byte.
 */
describe('CommandAgentAdapter — model flag argv (model-flag-argv.feature)', () => {
  const BASE_ARGV: Record<string, string[]> = {
    claude: ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    opencode: ['run', '--format', 'json'],
    cursor: ['-p'],
    codex: ['exec', '-'],
    gemini: ['-p'],
  };

  // Scenario Outline: each adapter emits its own flag and the exact model string.
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['claude', '--model'],
    ['opencode', '--model'],
    ['cursor', '--model'],
    ['codex', '-m'],
    ['gemini', '-m'],
  ];

  for (const [agent, flag] of cases) {
    it(`${agent} appends "${flag}" "m-1" after its base argv when a model is named`, () => {
      const adapter = resolveAdapter(agent);
      const req = adapter.buildRequest(
        { ...CTX, model: 'm-1' },
        'instr',
        '/cwd',
        {}
      );
      // The base argv stays the leading block; then the flag pair; no perms here.
      expect(req.args.slice(0, BASE_ARGV[agent].length)).toEqual(BASE_ARGV[agent]);
      expect(req.args.slice(BASE_ARGV[agent].length, BASE_ARGV[agent].length + 2)).toEqual([
        flag,
        'm-1',
      ]);
      // Nothing else is appended when no permissions policy is in context.
      expect(req.args).toHaveLength(BASE_ARGV[agent].length + 2);
      // The adapter declares its flag on the interface, non-empty.
      expect(adapter.modelFlag).toBe(flag);
    });
  }

  // Scenario: No model means byte-for-byte today's argv.
  it('every built-in adapter with NO model is byte-for-byte identical to the base argv', () => {
    for (const agent of Object.keys(BASE_ARGV)) {
      const adapter = resolveAdapter(agent);
      const req = adapter.buildRequest(CTX, 'instr', '/cwd', {});
      expect(req.args).toEqual(BASE_ARGV[agent]);
    }
  });

  // Scenario: The model flag pair sits between the base argv and the permission flags.
  it('the model flag pair sits between the base argv and the permission flags (claude)', () => {
    const ctx = {
      ...CTX,
      model: 'm-1',
      settings: {
        permissions: { posture: 'repo-sandboxed-permissive', allow: [], deny: [], raw: {} },
      },
    };
    const req = resolveAdapter('claude').buildRequest(ctx, 'instr', '/cwd', {});
    const base = BASE_ARGV.claude;
    expect(req.args.slice(0, base.length)).toEqual(base);
    expect(req.args.slice(base.length, base.length + 2)).toEqual(['--model', 'm-1']);
    // The permission flags remain the trailing block (e.g. `--permission-mode`).
    expect(req.args.slice(base.length + 2)).toContain('--permission-mode');
  });
});

/**
 * Implements: features/agent-cmd-override/shared-spawn-helper.feature
 *
 * The shared override-aware spawn-request helper: `activeAgentCmdOverride` is the
 * single gate (active / whitespace-only / unset), `buildAgentSpawnRequest`
 * returns the `bash -c <override>` request with `agentOverride: true` when
 * active (carrying instructions/cwd/env) or delegates to the adapter closure
 * (invoked exactly once) with `agentOverride: false` when inactive, and
 * `agentOverrideNotice` renders the per-var notice line.
 */
describe('buildAgentSpawnRequest — override gate (shared-spawn-helper.feature)', () => {
  const ENV = 'RATCHET_BATCH_AGENT_CMD';
  const INSTRUCTIONS = 'do the thing';
  const CWD = '/proj';
  const ENV_OBJ: NodeJS.ProcessEnv = { [ENV]: 'echo stub-agent', OTHER: 'x' };

  /** A buildAdapterRequest closure that records its invocations. */
  function adapterClosure(calls: number[]) {
    return (): AgentSpawnRequest => {
      calls[0] += 1;
      return { command: 'fake-agent', args: ['-p'], instructions: INSTRUCTIONS, cwd: CWD, env: ENV_OBJ };
    };
  }

  // Scenario: an active override produces the `bash -c <override>` request and
  // reports the agent was overridden.
  it('an active override yields a `bash -c <override>` request with agentOverride=true', () => {
    const calls = [0];
    const { request, agentOverride } = buildAgentSpawnRequest({
      overrideEnvVar: ENV,
      instructions: INSTRUCTIONS,
      cwd: CWD,
      env: { [ENV]: 'echo stub-agent' },
      buildAdapterRequest: adapterClosure(calls),
    });
    expect(agentOverride).toBe(true);
    expect(request).toEqual({
      command: 'bash',
      args: ['-c', 'echo stub-agent'],
      instructions: INSTRUCTIONS,
      cwd: CWD,
      env: { [ENV]: 'echo stub-agent' },
    });
    // The adapter closure is NOT consulted when the override is active.
    expect(calls[0]).toBe(0);
  });

  // Scenario: a whitespace-only override is inactive (configured adapter used).
  it('a whitespace-only override is inactive and the adapter closure is used', () => {
    const calls = [0];
    const { request, agentOverride } = buildAgentSpawnRequest({
      overrideEnvVar: ENV,
      instructions: INSTRUCTIONS,
      cwd: CWD,
      env: { [ENV]: '   ' },
      buildAdapterRequest: adapterClosure(calls),
    });
    expect(agentOverride).toBe(false);
    expect(request.command).toBe('fake-agent');
    // The adapter closure is invoked EXACTLY ONCE.
    expect(calls[0]).toBe(1);
  });

  // Scenario: an unset override is inactive (configured adapter used).
  it('an unset override is inactive and the adapter closure is used exactly once', () => {
    const calls = [0];
    const { request, agentOverride } = buildAgentSpawnRequest({
      overrideEnvVar: ENV,
      instructions: INSTRUCTIONS,
      cwd: CWD,
      env: {},
      buildAdapterRequest: adapterClosure(calls),
    });
    expect(agentOverride).toBe(false);
    expect(request.command).toBe('fake-agent');
    expect(calls[0]).toBe(1);
  });

  // Scenario: the override request threads instructions/cwd/env like any request.
  it('the override request carries instructions, cwd, and env verbatim', () => {
    const { request } = buildAgentSpawnRequest({
      overrideEnvVar: ENV,
      instructions: 'PROMPT',
      cwd: '/the/cwd',
      env: { [ENV]: 'cmd', RATCHET_STEP_VAR: 'from-engine' },
      buildAdapterRequest: adapterClosure([0]),
    });
    expect(request.instructions).toBe('PROMPT');
    expect(request.cwd).toBe('/the/cwd');
    expect(request.env).toEqual({ [ENV]: 'cmd', RATCHET_STEP_VAR: 'from-engine' });
  });

  it('activeAgentCmdOverride trims, treats whitespace-only as inactive, and undefined as inactive', () => {
    expect(activeAgentCmdOverride(ENV, { [ENV]: '  echo x  ' })).toBe('echo x');
    expect(activeAgentCmdOverride(ENV, { [ENV]: '   ' })).toBeUndefined();
    expect(activeAgentCmdOverride(ENV, { [ENV]: '' })).toBeUndefined();
    expect(activeAgentCmdOverride(ENV, {})).toBeUndefined();
  });

  it('agentOverrideNotice names the env var and ENV_OVERRIDE_PROVENANCE is env-override', () => {
    expect(agentOverrideNotice(ENV)).toBe('⚠ agent overridden by RATCHET_BATCH_AGENT_CMD');
    expect(agentOverrideNotice('RATCHET_EVAL_AGENT_CMD')).toBe(
      '⚠ agent overridden by RATCHET_EVAL_AGENT_CMD'
    );
    expect(ENV_OVERRIDE_PROVENANCE).toBe('env-override');
  });
});

/**
 * makeRealSpawner — the real process-spawn seam: detached process group on
 * POSIX, overall timeout with TERM→grace→KILL on the whole group, and a
 * resolved (non-hanging) result carrying stdout/stderr/exit.
 *
 * These run REAL subprocesses (sh -c …) — parity with the env-threading tests
 * in rex-sidecar-runtime.test.ts — to prove the spawned command observes the
 * timeout/reap behavior, not just the string shape.
 */
describe('makeRealSpawner — detached spawn + timeout reap', () => {
  function req(command: string): AgentSpawnRequest {
    return {
      command: 'sh',
      args: ['-c', command],
      instructions: '',
      cwd: process.cwd(),
      env: { ...process.env, PATH: process.env.PATH ?? '' },
    };
  }

  it('runs a fast command and resolves with its stdout + exit code', async () => {
    const spawner = makeRealSpawner({ timeoutMs: 5000 });
    const result = await spawner(req("echo 'hello world'; exit 3"));
    expect(result.exitCode).toBe(3);
    expect(result.stdout.trim()).toBe('hello world');
  });

  it('times out a hung command: resolves with non-zero + a timeout message in stderr', async () => {
    const spawner = makeRealSpawner({ timeoutMs: 50, killGraceMs: 20 });
    const result = await spawner(req('sleep 30'));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/timed out/i);
  });

  it('realSpawner is a Spawner built from makeRealSpawner', () => {
    expect(typeof realSpawner).toBe('function');
    expect(typeof makeRealSpawner).toBe('function');
  });
});
