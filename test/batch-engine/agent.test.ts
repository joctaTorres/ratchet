import { describe, it, expect } from 'vitest';
import { resolveAdapter, type AgentRequestContext } from '../../src/core/batch/engine/agent.js';

/**
 * Adapter capability + argv assertions for `capability-gating.feature` scenarios
 * 1–2: the claude adapter is stream-json-capable with the exact stream-json argv,
 * and codex/gemini/cursor are NOT capable with their argv unchanged.
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

  it('the claude command + stdin passing are unchanged', () => {
    const req = resolveAdapter('claude').buildRequest(CTX, 'the prompt', '/cwd', {});
    expect(req.command).toBe('claude');
    expect(req.instructions).toBe('the prompt'); // still passed on stdin
  });
});
