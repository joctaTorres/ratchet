/**
 * Batch Settings
 *
 * Effective batch settings are resolved as: hard-coded defaults ← project
 * config (`.ratchet/config.yaml` `batch:` section) ← per-manifest overrides.
 *
 * `ratchet batch config` reads the resolved settings and can get/set the
 * project-level `batch:` section, validating enum values and leaving the file
 * unchanged on invalid input.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { RATCHET_DIR_NAME } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { readUserBatchPermissions } from '../global-config.js';
import {
  PERMISSION_RAW_AGENTS,
  PermissionsPolicySchema,
  DEFAULT_PERMISSION_POSTURE,
} from './permissions-policy.js';
import type {
  PermissionPosture,
  PermissionsPolicy,
  ResolvedPermissionsPolicy,
} from './permissions-policy.js';
import type { BatchManifest } from './manifest.js';
import { AGENT_STAGE_KEYS } from './agent-setting.js';
import type { AgentSetting, AgentStage, AgentStageMap } from './agent-setting.js';
import { AgentSettingSchema } from './agent-setting.js';
import { parse as parseYamlFlow } from 'yaml';

export const GATE_VALUES = ['voluntary', 'after-propose', 'every-phase', 'autonomous'] as const;
export const STRATEGY_VALUES = ['vertical-slice', 'feature'] as const;
export const PROOF_OF_WORK_POLICY_VALUES = ['hard-gate', 'warn'] as const;
/**
 * Execution locus: where a step's agent runs. `local` drives the in-process ReX
 * sidecar (the default); `docker` runs the same step inside a container via ReX
 * `DockerDeployment` with the project root bind-mounted in. `remote` drives a
 * `swerex-remote` server over its REST API from a native-Node `fetch` client (no
 * local Python sidecar — the Python lives on the server), selected by a runtime
 * branch in the engine.
 */
export const LOCUS_VALUES = ['local', 'docker', 'remote'] as const;

/**
 * PR-grouping mode: whether a completed batch opens a pull request, and how the
 * work is grouped into PRs. `off` (the default) is the behavior-unchanged
 * do-nothing mode — no PR agent is ever spawned. `whole-batch` groups the whole
 * batch's work into a single PR opened by a dedicated PR agent at completion.
 * `per-phase` opens one stacked PR per completed phase and `per-change` one
 * stacked PR per change (their stacked-spawn behavior is wired later in Phase 3;
 * this vocabulary slice only validates them).
 *
 * The single source of truth for the vocabulary; the project-config and manifest
 * schemas validate the same `off | whole-batch | per-phase | per-change` set.
 */
export const PR_GROUPING_VALUES = ['off', 'whole-batch', 'per-phase', 'per-change'] as const;

/**
 * The default container image for `locus: docker` when no `image` is configured.
 * A small, generic image that proves the plumbing; a REAL agent image (node +
 * the chosen coding agent + `ratchet` on PATH) is a documented follow-on.
 *
 * SINGLE TS SOURCE OF TRUTH: `rex-bootstrap.ts` re-exports this rather than
 * keeping its own copy. The Python sidecar (`sidecar.py`) holds a separate
 * `DEFAULT_DOCKER_IMAGE` only because it cannot import TS — and that copy is a
 * pure unset-fallback (Node always threads `REX_IMAGE`). Keep the two languages
 * in sync if this value ever changes.
 */
export const DEFAULT_DOCKER_IMAGE = 'python:3.12';

export type Gate = (typeof GATE_VALUES)[number];
export type Strategy = (typeof STRATEGY_VALUES)[number];
export type ProofOfWorkPolicy = (typeof PROOF_OF_WORK_POLICY_VALUES)[number];
export type Locus = (typeof LOCUS_VALUES)[number];
export type PrGrouping = (typeof PR_GROUPING_VALUES)[number];

/**
 * The single home for "is PR grouping active?". Active means any mode other than
 * `off`, so every non-`off` mode (`whole-batch`, `per-phase`, `per-change`, and
 * any future mode) is covered by construction as the vocabulary grows. Consumers
 * (e.g. the doctor PR-remote check) call this instead of inlining the rule, so
 * the answer lives in exactly one place.
 */
export function isPrGroupingActive(mode: PrGrouping): boolean {
  return mode !== 'off';
}

// The agent-agnostic permissions policy schema/types live in their own module to
// avoid a config↔project-config import cycle; re-exported here for convenience.
export {
  PERMISSION_POSTURE_VALUES,
  PERMISSION_RAW_AGENTS,
  PermissionsPolicySchema,
  DEFAULT_PERMISSION_POSTURE,
} from './permissions-policy.js';
export type {
  PermissionPosture,
  PermissionRawAgent,
  PermissionsPolicy,
  ResolvedPermissionsPolicy,
} from './permissions-policy.js';

export interface BatchSettings {
  gate: Gate;
  strategy: Strategy;
  proofOfWork: ProofOfWorkPolicy;
  /** Where the agent runs. Defaults to `local` (the ReX sidecar). */
  locus: Locus;
  /**
   * Whether a completed batch opens a pull request, and how work is grouped.
   * Defaults to `off` (no PR agent spawned, behavior unchanged). `whole-batch`
   * groups the batch's work into a single PR opened by a dedicated PR agent at
   * completion. Resolved by the generic nearest-wins cascade like the other
   * scalar settings.
   */
  prGrouping: PrGrouping;
  /**
   * The coding agent(s) to spawn. Either a scalar agent name (route every
   * lifecycle stage to one agent, the default when a plain string or unset) or a
   * partial `{propose, apply, verify, pr}` stage-map (route each stage independently).
   * Validated by the shared `AgentSettingSchema` at both config scopes.
   *
   * Nearest-wins-per-stage cross-scope merge (see {@link resolveBatchSettings}):
   * a partial stage-map merges over a lower-scope scalar/map per stage, while a
   * nearer scalar replaces the whole value (covering every stage). Each stage's
   * spawn agent is resolved from this value by `resolveAgentForStage`.
   */
  agent?: string | AgentStageMap;
  /**
   * Container image for `locus: docker` (free-form, like `agent`). Ignored for
   * `local`. When unset and locus is `docker`, the runtime uses
   * `DEFAULT_DOCKER_IMAGE`.
   */
  image?: string;
  /**
   * Host of the `swerex-remote` server for `locus: remote` (e.g. `localhost`).
   * Required for `remote`; ignored for `local`/`docker`.
   *
   * May carry an explicit scheme (`http://host` / `https://host`). A bare host
   * is resolved by the runtime: `http` for a loopback host (safe — the token
   * never leaves the machine), `https` for any non-local host (the secure
   * default). Plaintext `http://` to a non-local host is refused unless
   * `insecure: true` is set (see below), so the `authToken` is never sent in
   * cleartext by accident.
   */
  host?: string;
  /**
   * Opt-in to send the `authToken` over plaintext `http://` to a NON-LOCAL
   * `host` for `locus: remote`. Off by default (a non-local host upgrades to
   * `https`, and explicit non-local `http://` is rejected). Loopback hosts
   * always allow plaintext regardless of this flag. Ignored for
   * `local`/`docker`. SECURITY: only enable for a trusted network you control.
   */
  insecure?: boolean;
  /**
   * Port of the `swerex-remote` server for `locus: remote`. Required for
   * `remote`; ignored for `local`/`docker`.
   */
  port?: number;
  /**
   * Auth token sent as the `X-API-Key` header to the `swerex-remote` server for
   * `locus: remote`. Required for `remote`; ignored for `local`/`docker`.
   *
   * SECRET: this value is NEVER printed — settings displays redact it (see
   * `redactSettings`) and runtime error messages name only host/port.
   */
  authToken?: string;
  /**
   * The resolved agent permission policy injected (as argv flags) into the
   * spawned coding agent. Always present after {@link resolveBatchSettings}:
   * posture defaults to `repo-sandboxed-permissive`, lists default to empty, and
   * `raw` to {}. The per-agent translator (`runtime/agent-permissions.ts`) turns
   * this into each agent's native flags.
   *
   * Merge across scopes (user ← project ← manifest): posture is nearest-wins,
   * `deny` is the UNION of all scopes, `allow` is REPLACED by the nearest defining
   * scope, and each agent's `raw` entry is nearest-wins.
   */
  permissions?: ResolvedPermissionsPolicy;
  /**
   * Per-agent ReX timeout in milliseconds (positive integer). Raises the guard
   * each runtime applies against a hung agent. When unset, each runtime keeps
   * applying its own built-in default (600000ms / 10 minutes), so "unset" stays
   * distinct from "set to the default" and the default lives in one place.
   *
   * The effective value is resolved by {@link resolveAgentTimeoutMs} with the
   * `RATCHET_AGENT_TIMEOUT_MS` env override taking precedence over this key.
   */
  agentTimeoutMs?: number;
}

/**
 * Settings whose values are secret and must never be printed verbatim. Any
 * settings display must run them through {@link redactSettings}.
 */
export const SECRET_SETTING_KEYS: readonly (keyof BatchSettings)[] = ['authToken'];

/** The placeholder shown in place of a redacted secret value. */
export const REDACTED_PLACEHOLDER = '***';

/**
 * Return a copy of `settings` with any secret values replaced by
 * `REDACTED_PLACEHOLDER`, so callers can print settings without leaking the
 * `authToken`. An unset secret stays unset (nothing to leak, nothing to show).
 */
export function redactSettings(settings: BatchSettings): BatchSettings {
  const redacted: BatchSettings = { ...settings };
  for (const key of SECRET_SETTING_KEYS) {
    if (redacted[key] !== undefined) {
      (redacted as unknown as Record<string, unknown>)[key] = REDACTED_PLACEHOLDER;
    }
  }
  if (redacted.permissions) {
    redacted.permissions = redactPermissionsPolicy(redacted.permissions);
  }
  return redacted;
}

/**
 * Matches argv tokens that look secret-bearing — either a bare token value
 * (long opaque/hex/base64-ish string) or a `--flag=secret` / `--token secret`
 * pairing. For `--flag=value`, the value half is masked when the flag name
 * signals a secret OR the value itself looks secret-shaped (`SECRETISH_VALUE`),
 * so a non-secret-named flag carrying an opaque token (`--config=sk-live-…`) is
 * still redacted. The `raw` override is an escape hatch, so a careless operator
 * could embed an API key there; this keeps it out of `batch config` output and
 * logs.
 *
 * RESIDUAL LIMITATION (operators: do not assume full coverage): the value
 * heuristic only catches OPAQUE tokens ≥20 chars. A short secret (< 20 chars)
 * that is neither preceded by a secret-named flag nor attached to one passes
 * through verbatim. Prefer secret-named flags for sensitive `raw` values.
 */
const SECRET_FLAG_NAME = /(token|secret|key|password|passwd|pwd|auth|bearer|credential)/i;
const SECRETISH_VALUE = /^[A-Za-z0-9_\-./+=]{20,}$/;

/**
 * Redact any secret-bearing values inside a resolved policy's per-agent `raw`
 * argv fragments. Two cases are masked: an `--flag=value` whose flag name signals
 * a secret (value masked, flag kept), and a value that immediately follows a
 * secret-signalling flag token. As a backstop, any standalone long opaque token
 * is also masked. Non-secret flags/values are preserved so the override stays
 * legible.
 */
export function redactPermissionsPolicy(
  policy: ResolvedPermissionsPolicy
): ResolvedPermissionsPolicy {
  const rawEntries = Object.entries(policy.raw) as [
    (typeof PERMISSION_RAW_AGENTS)[number],
    string[] | undefined,
  ][];
  const raw: ResolvedPermissionsPolicy['raw'] = {};
  for (const [agent, fragment] of rawEntries) {
    if (!fragment) continue;
    raw[agent] = redactArgvFragment(fragment);
  }
  return { ...policy, raw };
}

function redactArgvFragment(fragment: string[]): string[] {
  const out: string[] = [];
  let prevWasSecretFlag = false;
  for (const token of fragment) {
    const isFlag = token.startsWith('-');
    if (isFlag) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        const name = token.slice(0, eq);
        const value = token.slice(eq + 1);
        // Mask the value half when EITHER the flag name signals a secret OR the
        // value itself looks secret-shaped — so e.g. `--config=sk-live-…` (a
        // non-secret-named flag carrying an opaque token) is redacted, not leaked.
        if (SECRET_FLAG_NAME.test(name) || SECRETISH_VALUE.test(value)) {
          out.push(`${name}=${REDACTED_PLACEHOLDER}`);
          prevWasSecretFlag = false;
          continue;
        }
        out.push(token);
        prevWasSecretFlag = false;
        continue;
      }
      out.push(token);
      prevWasSecretFlag = SECRET_FLAG_NAME.test(token);
      continue;
    }
    // A value token: mask if it follows a secret flag or looks like a secret.
    if (prevWasSecretFlag || SECRETISH_VALUE.test(token)) {
      out.push(REDACTED_PLACEHOLDER);
    } else {
      out.push(token);
    }
    prevWasSecretFlag = false;
  }
  return out;
}

/** Where each effective value came from. */
export type SettingSource = 'default' | 'user' | 'project' | 'manifest';

export interface ResolvedBatchSettings {
  settings: BatchSettings;
  sources: Record<keyof BatchSettings, SettingSource>;
  /**
   * Per-stage supplying scope for the resolved `agent` setting, the pure sibling
   * of {@link resolveAgentSetting}'s merge: each stage's entry names the scope
   * (project/manifest) whose value IS that stage's resolved `agent[:model]`
   * spec string, mirroring the merge's `stages[stage] ?? base` materialization.
   * Absent for a stage no config scope supplied (the caller's default agent).
   * Resolved `settings` and `sources` stay byte-for-byte unchanged by this
   * exposure; it only attributes each stage to its supplying scope for the
   * engine's model-failure hint. See {@link resolveAgentStageScopes}.
   */
  agentStageScopes: Partial<Record<AgentStage, SettingSource>>;
}

export const DEFAULT_BATCH_SETTINGS: BatchSettings = {
  gate: 'voluntary',
  strategy: 'vertical-slice',
  proofOfWork: 'hard-gate',
  locus: 'local',
  prGrouping: 'off',
};

const SETTING_KEYS: (keyof BatchSettings)[] = [
  'gate',
  'strategy',
  'proofOfWork',
  'locus',
  'prGrouping',
  'agent',
  'image',
  'host',
  'port',
  'authToken',
  'insecure',
  'agentTimeoutMs',
];

const ALLOWED_VALUES: Record<string, readonly string[] | null> = {
  gate: GATE_VALUES,
  strategy: STRATEGY_VALUES,
  proofOfWork: PROOF_OF_WORK_POLICY_VALUES,
  locus: LOCUS_VALUES,
  prGrouping: PR_GROUPING_VALUES,
  agent: null, // free-form string
  image: null, // free-form string (container image reference)
  host: null, // free-form string (swerex-remote host, optional scheme prefix)
  port: null, // numeric string (swerex-remote port)
  authToken: null, // free-form secret string (swerex-remote X-API-Key)
  insecure: ['true', 'false'], // boolean opt-in for plaintext to a non-local host
  agentTimeoutMs: null, // free-form numeric (positive integer ms; like `port`)
};

/**
 * Resolve effective batch settings, cascading across four scopes:
 *
 *   built-in default ← user/global ← project config ← per-change manifest
 *
 * Scalar settings (gate/strategy/locus/…) are nearest-wins. The `agent` setting
 * gets a dedicated nearest-wins-per-stage merge (see {@link resolveAgentSetting}):
 * a partial stage-map merges over a lower-scope scalar/map per stage, a nearer
 * scalar replaces the whole value. The structured
 * `permissions` policy is merged with documented per-field semantics: posture is
 * nearest-wins, `deny` is the UNION of every scope, `allow` is REPLACED by the
 * nearest scope that defines one, and each agent's `raw` entry is nearest-wins.
 * Permissions always resolve (the no-config default is the built-in posture).
 */
export function resolveBatchSettings(
  projectRoot: string,
  manifest?: BatchManifest | null
): ResolvedBatchSettings {
  const settings: BatchSettings = { ...DEFAULT_BATCH_SETTINGS };
  const sources: Record<keyof BatchSettings, SettingSource> = {
    gate: 'default',
    strategy: 'default',
    proofOfWork: 'default',
    locus: 'default',
    prGrouping: 'default',
    agent: 'default',
    image: 'default',
    host: 'default',
    port: 'default',
    authToken: 'default',
    permissions: 'default',
    insecure: 'default',
    agentTimeoutMs: 'default',
  };

  const writable = settings as { [K in keyof BatchSettings]: BatchSettings[K] };

  // Scalar scopes, in increasing precedence. The user/global scope carries no
  // scalar batch settings today (only `permissions`), so it does not appear here.
  const projectBatch = readProjectConfig(projectRoot)?.batch;
  if (projectBatch) {
    for (const key of SETTING_KEYS) {
      // `agent` is resolved by a dedicated per-stage cross-scope merge below, not
      // this generic whole-value loop.
      if (key === 'agent') continue;
      const value = projectBatch[key];
      if (value !== undefined) {
        (writable[key] as BatchSettings[typeof key]) = value as BatchSettings[typeof key];
        sources[key] = 'project';
      }
    }
  }

  const manifestOverrides = manifest?.settings;
  if (manifestOverrides) {
    for (const key of SETTING_KEYS) {
      if (key === 'agent') continue; // see the per-stage merge below
      const value = manifestOverrides[key];
      if (value !== undefined) {
        (writable[key] as BatchSettings[typeof key]) = value as BatchSettings[typeof key];
        sources[key] = 'manifest';
      }
    }
  }

  // `agent`: per-stage cross-scope merge (mirroring how `permissions` gets bespoke
  // per-field semantics rather than whole-value nearest-wins). Fed the scalar
  // scopes low→high (project ← manifest; the user/global scope carries no scalar
  // `agent`), it merges partial stage-maps nearest-wins per stage over a
  // lower-scope scalar/map, while a nearer scalar replaces the whole value.
  const agentLayers = [
    { scope: 'project' as SettingSource, agent: projectBatch?.agent },
    { scope: 'manifest' as SettingSource, agent: manifestOverrides?.agent },
  ];
  const { agent: resolvedAgent, source: agentSource } = resolveAgentSetting(agentLayers);
  if (resolvedAgent !== undefined) {
    settings.agent = resolvedAgent;
    sources.agent = agentSource ?? 'default';
  }

  // Per-stage supplying-scope attribution for the `agent` setting: the pure
  // sibling of the merge above, replayed over the SAME layers so each stage's
  // scope names the layer whose value IS that stage's resolved spec string.
  // Computed here (where the layers live) and exposed as `agentStageScopes` so
  // the engine never re-reads config; resolved `settings`/`sources` are untouched.
  const agentStageScopes = resolveAgentStageScopes(agentLayers);

  // Structured permissions: resolved across user ← project ← manifest with
  // per-field merge semantics (see resolvePermissionsPolicy). The user/global
  // scope stores raw JSON, so it is validated through the shared schema here
  // (a malformed user policy is ignored rather than crashing a batch command).
  const rawUserPermissions = readUserBatchPermissions();
  let userPermissions: PermissionsPolicy | undefined;
  if (rawUserPermissions !== undefined) {
    const parsed = PermissionsPolicySchema.safeParse(rawUserPermissions);
    if (parsed.success) userPermissions = parsed.data;
  }
  const permissionLayers: { scope: SettingSource; policy: PermissionsPolicy | undefined }[] = [
    { scope: 'user', policy: userPermissions },
    { scope: 'project', policy: projectBatch?.permissions },
    { scope: 'manifest', policy: manifestOverrides?.permissions },
  ];
  const { policy, postureSource } = resolvePermissionsPolicy(permissionLayers);
  settings.permissions = policy;
  sources.permissions = postureSource;

  return { settings, sources, agentStageScopes };
}

/**
 * Merge the `agent` setting across scopes (ordered low→high precedence) into a
 * single resolved value with a nearest-wins-per-stage cross-scope merge. Tracks a
 * `base` (the nearest scalar seen) and an accumulating partial `stages` map:
 *
 *   - a **scalar** scope sets `base` and resets `stages` — a scalar covers every
 *     stage, so it overrides any lower-scope per-stage overrides (nearest-wins);
 *   - a **map** scope merges its entries into `stages` (a nearer stage wins),
 *     leaving a lower `base` in place as the fallback for stages it does not name.
 *
 * The resolved value is: `undefined` when nothing was set; the `base` scalar when
 * no map contributed; the partial `stages` map when only maps contributed; and a
 * **materialized full map** (`stages[stage] ?? base` per stage) when a scalar
 * `base` and a partial map both contributed — so the scalar fallback is preserved
 * inside a `string | AgentStageMap` value without widening the type. `source` is
 * the nearest scope that contributed any `agent` value (`undefined` when none did,
 * so the caller keeps the `default` source).
 */
export function resolveAgentSetting(
  layers: { scope: SettingSource; agent: AgentSetting | undefined }[]
): { agent: BatchSettings['agent']; source: SettingSource | undefined } {
  let base: string | undefined;
  let stages: Partial<Record<AgentStage, string>> = {};
  let mapContributed = false;
  let source: SettingSource | undefined;

  for (const { scope, agent } of layers) {
    if (agent === undefined) continue;
    source = scope;
    if (typeof agent === 'string') {
      // A scalar covers every stage: it overrides any lower-scope per-stage
      // overrides and resets the accumulated partial map (nearest-wins).
      base = agent;
      stages = {};
      mapContributed = false;
    } else {
      // A map merges its entries over what's accumulated (nearer stage wins),
      // leaving a lower scalar `base` in place for stages it does not name.
      for (const stage of AGENT_STAGE_KEYS) {
        const mapped = agent[stage];
        if (mapped !== undefined) stages[stage] = mapped;
      }
      mapContributed = true;
    }
  }

  if (source === undefined) return { agent: undefined, source: undefined };
  if (!mapContributed) return { agent: base, source };
  // A map contributed. When a scalar `base` also contributed, materialize a full
  // map so the scalar fallback is preserved per stage; otherwise the partial map.
  if (base !== undefined) {
    const full: AgentStageMap = {};
    for (const stage of AGENT_STAGE_KEYS) {
      full[stage] = stages[stage] ?? base;
    }
    return { agent: full, source };
  }
  return { agent: { ...stages }, source };
}

/**
 * Per-stage scope attribution for the resolved `agent` setting, a pure sibling
 * of {@link resolveAgentSetting} that replays the same scalar-resets /
 * map-merges-per-stage fold over the same low→high layers but tracks which
 * scope supplied each stage's resolved spec string instead of the value itself.
 *
 * Returns a `Partial<Record<AgentStage, SettingSource>>` mirroring the merge's
 * `stages[stage] ?? base` materialization: a **scalar** layer sets a base scope
 * and resets the accumulated per-stage scopes (it covers every stage,
 * nearest-wins); a **map** layer records its own scope for each stage it names
 * (a nearer stage wins). A stage's attribution is its per-stage scope, falling
 * back to the base scope when a scalar contributed, and absent when nothing
 * supplied that stage — so an attributed scope always names the layer whose
 * value IS that stage's resolved `agent[:model]` spec string. Absent means
 * "no config scope supplied this stage (the caller's default agent did)".
 *
 * Hardcodes no agent name and consumes spec strings opaquely. Pure: no
 * filesystem, no spawn, no I/O — unit-testable over in-memory layers. Does not
 * call {@link resolveAgentSetting} and changes nothing about the shipping merge
 * or its results; the agreement invariant is asserted in tests over the same
 * layers.
 */
export function resolveAgentStageScopes(
  layers: { scope: SettingSource; agent: AgentSetting | undefined }[]
): Partial<Record<AgentStage, SettingSource>> {
  let baseScope: SettingSource | undefined;
  let stageScopes: Partial<Record<AgentStage, SettingSource>> = {};
  let mapContributed = false;

  for (const { scope, agent } of layers) {
    if (agent === undefined) continue;
    if (typeof agent === 'string') {
      // A scalar covers every stage: it overrides any lower-scope per-stage
      // attributions and resets the accumulated partial map (nearest-wins).
      baseScope = scope;
      stageScopes = {};
      mapContributed = false;
    } else {
      // A map records its own scope for each stage it names (nearer stage wins).
      for (const stage of AGENT_STAGE_KEYS) {
        const mapped = agent[stage];
        if (mapped !== undefined) stageScopes[stage] = scope;
      }
      mapContributed = true;
    }
  }

  // No layer contributed anything: no attribution for any stage.
  if (baseScope === undefined && !mapContributed) return {};

  const result: Partial<Record<AgentStage, SettingSource>> = {};
  for (const stage of AGENT_STAGE_KEYS) {
    const perStage = stageScopes[stage];
    if (perStage !== undefined) {
      result[stage] = perStage;
    } else if (baseScope !== undefined) {
      // A scalar covered this stage (no nearer map named it): attribute it to
      // the scalar's scope — exactly mirroring the merge's `stages[stage] ?? base`.
      result[stage] = baseScope;
    }
    // else: nothing supplied this stage — absent (no attribution).
  }
  return result;
}

/**
 * Derive the single uniform supplying scope for a stage-less spawn (the
 * decomposition spawn, which resolves via `scalarAgent` — a stage map never
 * routes it). Returns the scope only when EVERY {@link AGENT_STAGE_KEYS} entry
 * is present AND identical; otherwise `undefined`.
 *
 * The invariant this encodes: whenever the decompose spawn carries an explicit
 * model, `settings.agent` is a scalar, and {@link resolveAgentStageScopes}
 * materialized every stage to that scalar's scope — so a uniform map is the
 * honest supplying scope for the stage-less scalar resolution. A mixed, partial,
 * or empty map cannot arise from a scalar setting under an explicit model, so
 * it resolves to no scope (the engine gates this behind
 * `spec?.model !== undefined`, so a coincidentally-uniform map that resolves no
 * scalar spec can never produce a false attribution).
 *
 * Pure: no filesystem, no spawn, no I/O — unit-testable over an in-memory map.
 * Sibling of {@link resolveAgentStageScopes}; consumes spec strings opaquely.
 */
export function uniformAgentScope(
  scopes: Partial<Record<AgentStage, SettingSource>> | undefined
): SettingSource | undefined {
  if (scopes === undefined) return undefined;
  let uniform: SettingSource | undefined;
  for (const stage of AGENT_STAGE_KEYS) {
    const scope = scopes[stage];
    if (scope === undefined) return undefined;
    if (uniform === undefined) {
      uniform = scope;
    } else if (scope !== uniform) {
      return undefined;
    }
  }
  return uniform;
}

/** Environment variable that overrides the per-agent ReX timeout. */
export const AGENT_TIMEOUT_ENV_VAR = 'RATCHET_AGENT_TIMEOUT_MS';

/**
 * Resolve the effective per-agent ReX timeout (ms), with precedence
 * `env > config > undefined`:
 *
 *   - `RATCHET_AGENT_TIMEOUT_MS` wins when it parses to an integer > 0. A
 *     non-numeric, zero, negative, or empty value is IGNORED (a typo never
 *     shortens or removes the guard) and resolution falls through to config.
 *   - else `settings.agentTimeoutMs` when it is a positive integer.
 *   - else `undefined`, so each runtime keeps applying its own built-in
 *     `DEFAULT_TIMEOUT_MS` (600000ms). Returning `undefined` keeps the default
 *     in exactly one place and keeps "unset" distinct from "set to the default".
 *
 * Pure and env-injectable (mirroring the runtime seams) so the feature scenarios
 * unit-test it directly.
 */
export function resolveAgentTimeoutMs(
  settings: Pick<BatchSettings, 'agentTimeoutMs'>,
  env: NodeJS.ProcessEnv = process.env
): number | undefined {
  const raw = env[AGENT_TIMEOUT_ENV_VAR];
  if (raw !== undefined && raw.trim().length > 0) {
    const parsed = Number(raw.trim());
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    // Invalid env value: ignore it and fall through to the config/default.
  }
  const fromConfig = settings.agentTimeoutMs;
  if (typeof fromConfig === 'number' && Number.isInteger(fromConfig) && fromConfig > 0) {
    return fromConfig;
  }
  return undefined;
}

/**
 * Merge a set of permission layers (ordered low→high precedence) into a single
 * resolved policy. Posture nearest-wins; deny union; allow replace-by-nearest;
 * raw per-agent nearest-wins. Returns the source of the winning posture so
 * `batch config` can annotate where the effective policy came from.
 */
export function resolvePermissionsPolicy(
  layers: { scope: SettingSource; policy: PermissionsPolicy | undefined }[]
): { policy: ResolvedPermissionsPolicy; postureSource: SettingSource } {
  let posture: PermissionPosture = DEFAULT_PERMISSION_POSTURE;
  let postureSource: SettingSource = 'default';
  const denySet = new Set<string>();
  let allow: string[] = [];
  const raw: ResolvedPermissionsPolicy['raw'] = {};

  for (const { scope, policy } of layers) {
    if (!policy) continue;
    if (policy.posture !== undefined) {
      posture = policy.posture;
      postureSource = scope;
    }
    // deny: union across every scope (a narrower scope cannot drop a denial).
    if (policy.deny) {
      for (const pattern of policy.deny) denySet.add(pattern);
    }
    // allow: replace by the nearest defining scope (deliberate, self-contained).
    if (policy.allow !== undefined) {
      allow = [...policy.allow];
    }
    // raw: nearest scope that defines a given agent's entry wins for that agent.
    if (policy.raw) {
      for (const agent of PERMISSION_RAW_AGENTS) {
        const entry = policy.raw[agent];
        if (entry !== undefined) raw[agent] = [...entry];
      }
    }
  }

  return {
    policy: { posture, allow, deny: [...denySet], raw },
    postureSource,
  };
}

export interface SetResult {
  ok: boolean;
  /** Error message when ok is false; the file is left unchanged. */
  error?: string;
  key?: keyof BatchSettings;
  value?: string;
  /**
   * The typed value to persist for keys whose CLI string form is not the storage
   * form. Today only the `agent` key sets this: a scalar spec stays a string,
   * but a `{`-prefixed inline stage map is parsed into a real map so the
   * persisted YAML is a map (not a quoted string) the loader accepts. When
   * unset, the raw `value` string is persisted.
   */
  parsedValue?: string | AgentStageMap;
}

/**
 * Validate a `key=value` setting against the allowed enum values AND, for the
 * `agent` key, against the shared `AgentSettingSchema` (whose `superRefine`
 * routes every string position through `parseAgentSpec`). The write path and
 * the load path thus never diverge: a value the write path accepts is exactly
 * what the loader accepts.
 *
 * For the `agent` key, a value whose trimmed form starts with `{` is parsed as
 * a YAML flow map and validated as a stage map (so per-stage entries are
 * checked); any other value is validated as a scalar spec string. Failures
 * return `ok: false` with an error naming the offending value (and the stage
 * key for map entries).
 */
export function validateSetting(key: string, value: string): SetResult {
  if (!SETTING_KEYS.includes(key as keyof BatchSettings)) {
    return {
      ok: false,
      error: `Unknown batch setting '${key}'. Allowed keys: ${SETTING_KEYS.join(', ')}`,
    };
  }

  const allowed = ALLOWED_VALUES[key];
  if (allowed && !allowed.includes(value)) {
    return {
      ok: false,
      error: `Invalid value '${value}' for '${key}'. Allowed values: ${allowed.join(', ')}`,
    };
  }

  // A free-form `image` must be a non-empty reference — an empty value is
  // rejected before any container is started so the project config is left
  // unchanged (see features/container-locus/configurable-image.feature).
  if (key === 'image' && value.trim().length === 0) {
    return {
      ok: false,
      error: `Invalid value for 'image': the container image reference must not be empty.`,
    };
  }

  // The remote-locus settings each have a shape constraint, rejected before the
  // project config is written (see features/remote-locus/config-and-validation).
  if ((key === 'host' || key === 'authToken') && value.trim().length === 0) {
    return {
      ok: false,
      error: `Invalid value for '${key}': it must not be empty.`,
    };
  }
  if (key === 'port' && !isValidPort(value)) {
    return {
      ok: false,
      error: `Invalid value for 'port': it must be a positive integer (got '${value}').`,
    };
  }
  // `agentTimeoutMs` is a positive integer (milliseconds), validated like `port`
  // so a malformed value is rejected before the project config is written.
  if (key === 'agentTimeoutMs' && !isValidPort(value)) {
    return {
      ok: false,
      error: `Invalid value for 'agentTimeoutMs': it must be a positive integer (got '${value}').`,
    };
  }

  // The `agent` key is validated through the SAME shared schema the loaders use
  // (AgentSettingSchema's superRefine routes every string position through
  // parseAgentSpec), so the write path can never persist what the loader
  // rejects. A value starting (after trim) with `{` is parsed as a YAML flow
  // map and validated as a stage map (per-stage entries checked); any other
  // value is validated as a scalar spec string. On success the typed value is
  // carried back via `parsedValue` so the persist step writes a real map (not
  // a quoted string) for map input, mirroring how `port`/`insecure` persist
  // their real types.
  if (key === 'agent') {
    return validateAgentSetting(value);
  }

  return { ok: true, key: key as keyof BatchSettings, value };
}

/**
 * Validate an `agent` CLI value through {@link AgentSettingSchema}. A value
 * whose trimmed form starts with `{` is parsed as a YAML flow map and validated
 * as a stage map; any other value is validated as a scalar spec string. On
 * success the typed value (string or stage map) is carried via `parsedValue`.
 * On failure the error names the offending value (and the stage key for map
 * entries), derived from the zod issues.
 */
function validateAgentSetting(value: string): SetResult {
  const trimmed = value.trim();
  let parsed: unknown = value;
  if (trimmed.startsWith('{')) {
    try {
      parsed = parseYamlFlow(value);
    } catch {
      return {
        ok: false,
        key: 'agent',
        value,
        error: `Invalid value for 'agent': '${value}' is not a valid YAML flow map.`,
      };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        key: 'agent',
        value,
        error: `Invalid value for 'agent': '${value}' must be a stage map (e.g. {apply: claude:fable}).`,
      };
    }
  }
  const result = AgentSettingSchema.safeParse(parsed);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '';
      return path ? `agent.${path}: ${issue.message}` : `agent: ${issue.message}`;
    });
    return {
      ok: false,
      key: 'agent',
      value,
      error: `Invalid value for 'agent': ${messages.join('; ')}`,
    };
  }
  return { ok: true, key: 'agent', value, parsedValue: result.data as string | AgentStageMap };
}

/** A port is a positive integer (numeric string, no decimals/sign/whitespace). */
function isValidPort(value: string): boolean {
  return /^[0-9]+$/.test(value.trim()) && Number(value.trim()) > 0;
}

/**
 * Cross-field check for `locus: remote`: it requires `host`, `port`, and
 * `authToken`. Returns an actionable error message naming the FIRST missing key
 * (never echoing the secret token), or `null` when the settings are complete or
 * the locus is not `remote`. Consumed where settings are resolved (the engine)
 * so a misconfiguration fails BEFORE any REST call is attempted.
 */
export function validateRemoteSettings(settings: BatchSettings): string | null {
  if (settings.locus !== 'remote') return null;
  const missing: string[] = [];
  if (settings.host === undefined || String(settings.host).trim().length === 0) {
    missing.push('host');
  }
  if (settings.port === undefined || !isValidPort(String(settings.port))) {
    missing.push('port');
  }
  if (settings.authToken === undefined || String(settings.authToken).trim().length === 0) {
    missing.push('authToken');
  }
  if (missing.length === 0) return null;
  return (
    `locus 'remote' requires host, port, and authToken, but missing/invalid: ${missing.join(', ')}. ` +
    `Set them with 'ratchet batch config --set <key>=<value>' or in .ratchet/config.yaml.`
  );
}

/** Explicit per-invocation overrides for a standalone change step. */
export interface ChangeStepSettingOverrides {
  agent?: string;
  locus?: string;
  image?: string;
}

/**
 * Resolve effective settings for a STANDALONE change step — one driven with no
 * batch manifest (the headless propose/apply/verify verbs). Settings cascade
 * `flag → project config → built-in default`: start from
 * `resolveBatchSettings(projectRoot)` (project config ← default, no manifest),
 * then apply each provided override (`agent` / `locus` / `image`).
 *
 * Every override is validated through {@link validateSetting} so an invalid value
 * throws an actionable error BEFORE any agent is spawned (e.g. an unknown locus
 * names the allowed values). The returned `BatchSettings` feeds `runChangeStep`
 * directly, and `selectRuntime` keys off `locus`/`image` exactly as for a batch.
 */
export function resolveChangeStepSettings(
  projectRoot: string,
  overrides: ChangeStepSettingOverrides = {}
): BatchSettings {
  const { settings } = resolveBatchSettings(projectRoot);
  const writable = settings as { [K in keyof BatchSettings]: BatchSettings[K] };

  const applyOverride = (key: 'agent' | 'locus' | 'image', value: string | undefined): void => {
    if (value === undefined) return;
    const validation = validateSetting(key, value);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    // For the `agent` key, persist the typed value (a map override must be
    // applied as a real map, not the raw CLI string). A scalar override stays
    // a plain string. The validation already ran `parseAgentSpec` through the
    // shared schema, so a malformed standalone `--agent` value throws here
    // (naming the value) BEFORE any settings are mutated or any agent spawned.
    const typed =
      key === 'agent' && validation.parsedValue !== undefined
        ? validation.parsedValue
        : value;
    (writable[key] as BatchSettings[typeof key]) = typed as BatchSettings[typeof key];
  };

  applyOverride('agent', overrides.agent);
  applyOverride('locus', overrides.locus);
  applyOverride('image', overrides.image);

  return settings;
}

function configFilePath(projectRoot: string): string {
  const yamlPath = path.join(projectRoot, RATCHET_DIR_NAME, 'config.yaml');
  if (existsSync(yamlPath)) return yamlPath;
  const ymlPath = path.join(projectRoot, RATCHET_DIR_NAME, 'config.yml');
  if (existsSync(ymlPath)) return ymlPath;
  return yamlPath; // default to .yaml when creating
}

/**
 * Set a project-level batch setting in `.ratchet/config.yaml`. Validates the
 * enum value first and leaves the file untouched on invalid input.
 */
export function setProjectBatchSetting(
  projectRoot: string,
  key: string,
  value: string
): SetResult {
  const validation = validateSetting(key, value);
  if (!validation.ok) {
    return validation;
  }

  const filePath = configFilePath(projectRoot);
  let raw: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      const parsed = parseYaml(readFileSync(filePath, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        raw = parsed as Record<string, unknown>;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Failed to read config.yaml: ${message}` };
    }
  }

  const batch = (raw.batch && typeof raw.batch === 'object' ? raw.batch : {}) as Record<
    string,
    unknown
  >;
  // `port` is a number and `insecure` is a boolean in the schema, so persist
  // them with their real type (a quoted string would be rejected by the
  // manifest/project-config schemas on read).
  if (key === 'port' || key === 'agentTimeoutMs') {
    batch[key] = Number(value.trim());
  } else if (key === 'insecure') {
    batch[key] = value.trim() === 'true';
  } else if (key === 'agent' && validation.parsedValue !== undefined) {
    // A map-typed `agent` (from a `{`-prefixed inline stage map) is persisted as
    // a real YAML map, not a quoted string — mirroring how `port`/`insecure`
    // persist their real types so the loader round-trips the value with no
    // warning. A scalar spec stays a plain string.
    batch[key] = validation.parsedValue;
  } else {
    batch[key] = value;
  }
  raw.batch = batch;

  writeFileSync(filePath, stringifyYaml(raw), 'utf-8');
  return validation;
}

/**
 * Persist an agent-permissions policy under the project config's `batch:`
 * section, merging into any existing config (preserving other settings). Used by
 * the first-run guided setup when the operator saves to the project (the
 * default). Returns the path written. The policy is validated by the caller (it
 * comes from the guided setup, not free-form input).
 */
export function setProjectBatchPermissions(
  projectRoot: string,
  permissions: PermissionsPolicy
): string {
  const filePath = configFilePath(projectRoot);
  let raw: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    const parsed = parseYaml(readFileSync(filePath, 'utf-8'));
    if (parsed && typeof parsed === 'object') {
      raw = parsed as Record<string, unknown>;
    }
  }
  const batch = (raw.batch && typeof raw.batch === 'object' ? raw.batch : {}) as Record<
    string,
    unknown
  >;
  batch.permissions = permissions;
  raw.batch = batch;
  writeFileSync(filePath, stringifyYaml(raw), 'utf-8');
  return filePath;
}

/**
 * Whether a permission policy is configured at the user/global OR project scope.
 * This is the idempotency key for the first-run guided setup: once either scope
 * defines `permissions`, the setup never re-prompts. (The per-change manifest
 * scope is not consulted here — a manifest exists only inside a specific batch,
 * whereas the first-run gate fires before any batch is necessarily selected.)
 */
export function hasPermissionConfig(projectRoot: string): boolean {
  if (readUserBatchPermissions() !== undefined) return true;
  const projectPermissions = readProjectConfig(projectRoot)?.batch?.permissions;
  return projectPermissions !== undefined;
}
