import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyCommand } from '../../src/commands/apply.js';
import { verifyCommand } from '../../src/commands/verify.js';
import { proposeCommand } from '../../src/commands/propose.js';
import type { AgentSpawnRequest, Spawner } from '../../src/core/batch/engine/agent.js';
import { CommandFixture, makeCommandFixture, completingSpawner } from './change-fixture.js';

/**
 * The standalone change-step verbs gate `RATCHET_BATCH_AGENT_CMD` behind
 * `--allow-agent-override`: without it the step is refused (nothing spawned),
 * with it the stub runs and `--json` carries `agentOverride: true`.
 *
 * Implements:
 *   - features/agent-cmd-override/opt-in-gate.feature (Scenario Outline: every
 *     engine-spawning verb carries the opt-in flag)
 *   - features/agent-cmd-override/override-notice.feature (JSON flag)
 */

const ENV = 'RATCHET_BATCH_AGENT_CMD';

type Verb = 'apply' | 'verify' | 'propose';

describe.each<Verb>(['apply', 'verify', 'propose'])('%s --allow-agent-override', (verb) => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const change = `c-${verb}`;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-override-verb-');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv(ENV, 'echo stub-agent');
    if (verb === 'apply') await fixture.writeChangeWithTasks(change, { done: 0, total: 2 });
    if (verb === 'verify') await fixture.writeChangeWithTasks(change, { done: 2, total: 2 });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    logSpy.mockRestore();
    errSpy.mockRestore();
    await fixture.cleanup();
  });

  function capturing(): { spawner: Spawner; requests: AgentSpawnRequest[] } {
    const inner = completingSpawner(fixture.root, change).spawner;
    const requests: AgentSpawnRequest[] = [];
    return {
      requests,
      spawner: async (req) => {
        requests.push(req);
        return inner(req);
      },
    };
  }

  async function run(allowAgentOverride: boolean, spawner: Spawner): Promise<void> {
    const deps = { projectRoot: () => fixture.root, spawner };
    const opts = { json: true, allowAgentOverride };
    if (verb === 'apply') return applyCommand(change, opts, deps);
    if (verb === 'verify') return verifyCommand(change, opts, deps);
    return proposeCommand('objective', { ...opts, name: change }, deps);
  }

  function lastJson(): Record<string, unknown> {
    return JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
  }

  it('refuses the override without the flag and spawns nothing', async () => {
    const { spawner, requests } = capturing();

    await run(false, spawner);

    expect(requests).toHaveLength(0);
    const result = lastJson();
    expect(result.state).toBe('blocked');
    expect(String(result.blocker)).toMatch(/RATCHET_BATCH_AGENT_CMD.*--allow-agent-override/);
    expect(result.agentOverride).toBeUndefined();
  });

  it('runs the stub with the flag, notices on stderr, and flags the JSON result', async () => {
    const { spawner, requests } = capturing();

    await run(true, spawner);

    expect(requests).toHaveLength(1);
    expect(requests[0].command).toBe('bash');
    expect(requests[0].args.slice(0, 2)).toEqual([
      '-c',
      'export RATCHET_SPAWN_VIA=env-override; echo stub-agent',
    ]);
    expect(lastJson().agentOverride).toBe(true);
    expect(errSpy).toHaveBeenCalledWith('⚠ agent overridden by RATCHET_BATCH_AGENT_CMD\n');
  });
});
