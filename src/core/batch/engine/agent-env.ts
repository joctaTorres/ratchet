/**
 * Agent environment allowlist — the single scoping policy applied at both env
 * leak sites (the engine spawn request env and the ReX sidecar bootstrap env).
 *
 * `scopeAgentEnv(hostEnv)` is a pure, deterministic function over an in-memory
 * env object: no filesystem, no spawn. It filters the host environment down to
 * an allowlist so non-allowlisted host secrets never reach a spawned agent.
 *
 * The allowlist is the union of:
 *  - Baseline process vars (PATH, HOME, TMPDIR, locale/terminal, proxy, Windows
 *    basics) — the minimum an agent's process needs to function.
 *  - `RATCHET_*` control vars — the operator's ratchet config/overrides.
 *  - `LC_*` locale vars.
 *  - Forge auth keys (`GH_TOKEN`, `GITHUB_TOKEN`) — the PR stage drives a forge
 *    CLI that needs them.
 *  - The union of every registered adapter's declared `envPassthrough` keys —
 *    each agent's own API keys / config, collected from the built-in registry
 *    so the env is identical for every agent (no agent special-cased in shared
 *    paths). A `PREFIX_*` entry matches any var starting with `PREFIX_`.
 *  - The `RATCHET_AGENT_ENV_ALLOW` escape hatch — a comma-separated list of
 *    extra host env names the operator needs, read from the host environment
 *    (never from a repo-committed manifest, consistent with the phase rule that
 *    repo-committed config can only narrow, not escalate).
 *
 * Absent vars are simply skipped — no key is synthesized.
 */

import { availableAdapters, resolveAdapter } from './agent.js';

/**
 * The env var that extends the allowlist with operator-named extra host vars.
 * Its value is a comma-separated list of env var names. Declared here so the
 * scoper, docs, and tests all reference the same literal.
 */
export const AGENT_ENV_ALLOW_VAR = 'RATCHET_AGENT_ENV_ALLOW';

/**
 * Baseline process variables always on the allowlist. Present vars pass through
 * with their host value; absent vars are simply skipped. No package manager,
 * test runner, or toolchain is named (generalizable-defaults).
 */
const BASELINE_VARS: readonly string[] = [
  // Command resolution + home
  'PATH',
  'HOME',
  'TMPDIR',
  // Locale + terminal
  'LANG',
  'TERM',
  // Proxy settings (agents must reach their APIs through corporate proxies)
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  // Windows basics
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
];

/** Prefix patterns that match any var starting with the prefix. */
const BASELINE_PREFIXES: readonly string[] = ['LC_'];

/** Forge auth keys — the PR stage drives a forge CLI. */
const FORGE_KEYS: readonly string[] = ['GH_TOKEN', 'GITHUB_TOKEN'];

/** `RATCHET_*` control vars prefix. */
const RATCHET_PREFIX = 'RATCHET_';

/**
 * Collect the union of adapter-declared env passthrough keys/patterns across
 * the built-in registry. Each entry is either an exact env var name or a
 * `PREFIX_*` glob pattern. The union (not per-active-agent) keeps the scoped
 * env identical for every agent: the engine builds the env before the adapter
 * is resolved, and the `RATCHET_BATCH_AGENT_CMD` override path has no adapter at
 * all — so a per-agent env would leak the active agent's identity into the
 * shared path. Iterating the registry (never hard-coding one agent) also means
 * a newly added agent's keys are picked up automatically.
 */
export function adapterEnvPassthroughKeys(): readonly string[] {
  const keys = new Set<string>();
  for (const name of availableAdapters()) {
    const adapter = resolveAdapter(name);
    for (const key of adapter.envPassthrough) {
      keys.add(key);
    }
  }
  return [...keys].sort();
}

/**
 * Build the allowlist as a set of exact names + a list of prefixes, combining
 * the baseline, forge keys, RATCHET_ prefix, adapter-declared keys, and the
 * escape-hatch names. Exported so tests can inspect the policy directly.
 */
export function buildAgentEnvAllowlist(
  hostEnv: NodeJS.ProcessEnv
): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>([...BASELINE_VARS, ...FORGE_KEYS]);
  const prefixes: string[] = [RATCHET_PREFIX, ...BASELINE_PREFIXES];

  for (const key of adapterEnvPassthroughKeys()) {
    if (key.endsWith('_*')) {
      // `PREFIX_*` → match any var starting with `PREFIX_`
      prefixes.push(key.slice(0, -1));
    } else {
      exact.add(key);
    }
  }

  // Escape hatch: comma-separated extra host env names from the operator.
  const allowRaw = hostEnv[AGENT_ENV_ALLOW_VAR];
  if (allowRaw) {
    for (const name of allowRaw.split(',')) {
      const trimmed = name.trim();
      if (trimmed) exact.add(trimmed);
    }
  }

  return { exact, prefixes };
}

/**
 * Scope a host environment down to the allowlist. Pure: returns a new env
 * object containing only allowlisted entries with their host values. Absent
 * vars and `undefined` values are skipped — no key is synthesized.
 */
export function scopeAgentEnv(hostEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { exact, prefixes } = buildAgentEnvAllowlist(hostEnv);
  const scoped: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value === undefined) continue;
    if (exact.has(name)) {
      scoped[name] = value;
      continue;
    }
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) {
        scoped[name] = value;
        break;
      }
    }
  }
  return scoped;
}
