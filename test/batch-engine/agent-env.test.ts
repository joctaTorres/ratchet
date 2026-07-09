import { describe, it, expect } from 'vitest';
import {
  scopeAgentEnv,
  adapterEnvPassthroughKeys,
  buildAgentEnvAllowlist,
  AGENT_ENV_ALLOW_VAR,
} from '../../src/core/batch/engine/agent-env.js';
import { availableAdapters, resolveAdapter } from '../../src/core/batch/engine/agent.js';

/**
 * Implements: features/agent-env-scoping/allowlist.feature
 *
 * The pure scoping helper: a non-allowlisted host secret is dropped, baseline
 * process vars pass through, RATCHET_* control vars pass through, every
 * registered agent's declared keys pass through, every registered adapter
 * declares an env passthrough, and the operator escape hatch extends the
 * allowlist.
 */

describe('scopeAgentEnv — allowlist (allowlist.feature)', () => {
  // Scenario: A non-allowlisted host secret is dropped
  it('drops a non-allowlisted host secret while keeping PATH and HOME', () => {
    const hostEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      SUPER_SECRET_TOKEN: 'hunter2',
    };
    const scoped = scopeAgentEnv(hostEnv);
    expect(scoped).not.toHaveProperty('SUPER_SECRET_TOKEN');
    expect(scoped.PATH).toBe('/usr/bin');
    expect(scoped.HOME).toBe('/home/user');
  });

  // Scenario: Baseline process variables pass through
  it('passes through every baseline process variable with its host value', () => {
    const hostEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      TMPDIR: '/tmp',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      HTTPS_PROXY: 'http://proxy:8080',
    };
    const scoped = scopeAgentEnv(hostEnv);
    for (const [key, value] of Object.entries(hostEnv)) {
      expect(scoped[key], `baseline var '${key}' must pass through`).toBe(value);
    }
  });

  // Scenario: Ratchet control variables pass through
  it('passes through RATCHET_* control variables', () => {
    const hostEnv: NodeJS.ProcessEnv = {
      RATCHET_BATCH_AGENT_CMD: 'echo stub-agent',
    };
    const scoped = scopeAgentEnv(hostEnv);
    expect(scoped.RATCHET_BATCH_AGENT_CMD).toBe('echo stub-agent');
  });

  // Scenario Outline: Every registered agent's declared keys pass through
  it('every registered agent has at least one declared key that passes through', () => {
    for (const name of availableAdapters()) {
      const adapter = resolveAdapter(name);
      const declared = adapter.envPassthrough;
      expect(declared.length, `adapter '${name}' must declare envPassthrough`).toBeGreaterThan(0);
      for (const key of declared) {
        // Plant a host var matching the declaration (exact or PREFIX_* pattern).
        const plantedName = key.endsWith('_*')
          ? `${key.slice(0, -1)}TEST_VAR`
          : key;
        const hostEnv: NodeJS.ProcessEnv = {
          [plantedName]: 'the-value',
        };
        const scoped = scopeAgentEnv(hostEnv);
        expect(
          scoped[plantedName],
          `adapter '${name}': var '${plantedName}' matching declaration '${key}' must pass through`
        ).toBe('the-value');
      }
    }
  });

  // Scenario: Every registered adapter declares an env passthrough
  it('every registered adapter declares a non-empty envPassthrough list', () => {
    for (const name of availableAdapters()) {
      const adapter = resolveAdapter(name);
      expect(
        adapter.envPassthrough,
        `adapter '${name}' must declare envPassthrough`
      ).toBeDefined();
      expect(
        adapter.envPassthrough.length,
        `adapter '${name}' must declare a non-empty envPassthrough`
      ).toBeGreaterThan(0);
    }
  });

  // Scenario: Operator escape hatch extends the allowlist
  it('the escape hatch extends the allowlist with operator-named vars', () => {
    const hostEnv: NodeJS.ProcessEnv = {
      MY_CUSTOM_CA: '/etc/ca.pem',
      [AGENT_ENV_ALLOW_VAR]: 'MY_CUSTOM_CA',
      ANOTHER_SECRET: 'should-be-dropped',
    };
    const scoped = scopeAgentEnv(hostEnv);
    expect(scoped.MY_CUSTOM_CA).toBe('/etc/ca.pem');
    // A host secret not named by the escape hatch is still dropped.
    expect(scoped).not.toHaveProperty('ANOTHER_SECRET');
  });

  // Extra: LC_* locale prefix and proxy lowercase variants
  it('passes through LC_* locale vars and lowercase proxy variants', () => {
    const hostEnv: NodeJS.ProcessEnv = {
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'C',
      http_proxy: 'http://proxy:8080',
      https_proxy: 'http://proxy:8080',
      no_proxy: 'localhost',
    };
    const scoped = scopeAgentEnv(hostEnv);
    expect(scoped.LC_ALL).toBe('en_US.UTF-8');
    expect(scoped.LC_CTYPE).toBe('C');
    expect(scoped.http_proxy).toBe('http://proxy:8080');
    expect(scoped.https_proxy).toBe('http://proxy:8080');
    expect(scoped.no_proxy).toBe('localhost');
  });

  // Extra: forge keys pass through
  it('passes through forge auth keys (GH_TOKEN, GITHUB_TOKEN)', () => {
    const hostEnv: NodeJS.ProcessEnv = {
      GH_TOKEN: 'ghp_xxx',
      GITHUB_TOKEN: 'ghp_yyy',
    };
    const scoped = scopeAgentEnv(hostEnv);
    expect(scoped.GH_TOKEN).toBe('ghp_xxx');
    expect(scoped.GITHUB_TOKEN).toBe('ghp_yyy');
  });

  // Extra: absent vars are skipped, undefined values are skipped
  it('skips absent and undefined-valued vars without synthesizing keys', () => {
    const hostEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: undefined,
    };
    const scoped = scopeAgentEnv(hostEnv);
    expect(scoped.PATH).toBe('/usr/bin');
    expect(scoped).not.toHaveProperty('HOME');
  });

  // Extra: adapterEnvPassthroughKeys returns the union sorted and deduplicated
  it('adapterEnvPassthroughKeys returns the deduplicated union across all adapters', () => {
    const keys = adapterEnvPassthroughKeys();
    expect(keys.length).toBeGreaterThan(0);
    // No duplicates
    expect(new Set(keys).size).toBe(keys.length);
    // Sorted
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    // Contains at least one key per adapter
    for (const name of availableAdapters()) {
      const adapter = resolveAdapter(name);
      for (const key of adapter.envPassthrough) {
        expect(keys, `union must contain '${key}' from adapter '${name}'`).toContain(key);
      }
    }
  });

  // Extra: buildAgentEnvAllowlist exposes exact + prefixes
  it('buildAgentEnvAllowlist exposes exact names and prefix patterns', () => {
    const { exact, prefixes } = buildAgentEnvAllowlist({
      [AGENT_ENV_ALLOW_VAR]: 'EXTRA_ONE,EXTRA_TWO',
    });
    expect(exact.has('PATH')).toBe(true);
    expect(exact.has('HOME')).toBe(true);
    expect(exact.has('GH_TOKEN')).toBe(true);
    expect(exact.has('EXTRA_ONE')).toBe(true);
    expect(exact.has('EXTRA_TWO')).toBe(true);
    expect(prefixes).toContain('RATCHET_');
    expect(prefixes).toContain('LC_');
  });
});
