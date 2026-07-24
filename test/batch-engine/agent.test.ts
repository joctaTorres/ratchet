import { describe, it, expect } from 'vitest';
import { resolveAdapter, type AgentRequestContext } from '../../src/core/batch/engine/agent.js';

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
