/**
 * Adapt a fake `Spawner` into an `AgentRuntime` for engine tests.
 *
 * Tests that inject a fake `Spawner` (capturing the request and simulating an
 * agent session) use this adapter to wrap it as the `runtime:` the engine
 * consumes — the same replay logic the engine's legacy `spawnerAsRuntime`
 * fallback performed before its removal. The fake-agent behavior tables stay
 * untouched; only the injection point changes from `spawner:` to `runtime:`.
 */
import type { AgentRuntime } from '../../src/core/batch/engine/runtime/contract.js';
import type { Spawner } from '../../src/core/batch/engine/agent.js';

export function spawnerAsRuntime(spawner: Spawner): AgentRuntime {
  return async (req, onEvent) => {
    const result = await spawner(req);
    if (result.stdout) {
      for (const line of result.stdout.split('\n')) {
        onEvent({ kind: 'stdout', line });
      }
    }
    onEvent({ kind: 'exit', exitCode: result.exitCode ?? undefined });
    return result;
  };
}
