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
import type { BatchManifest } from './manifest.js';

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
 * The default container image for `locus: docker` when no `image` is configured.
 * A small, generic image that proves the plumbing; a REAL agent image (node +
 * the chosen coding agent + `ratchet` on PATH) is a documented follow-on.
 */
export const DEFAULT_DOCKER_IMAGE = 'python:3.12';

export type Gate = (typeof GATE_VALUES)[number];
export type Strategy = (typeof STRATEGY_VALUES)[number];
export type ProofOfWorkPolicy = (typeof PROOF_OF_WORK_POLICY_VALUES)[number];
export type Locus = (typeof LOCUS_VALUES)[number];

export interface BatchSettings {
  gate: Gate;
  strategy: Strategy;
  proofOfWork: ProofOfWorkPolicy;
  /** Where the agent runs. Defaults to `local` (the ReX sidecar). */
  locus: Locus;
  agent?: string;
  /**
   * Container image for `locus: docker` (free-form, like `agent`). Ignored for
   * `local`. When unset and locus is `docker`, the runtime uses
   * `DEFAULT_DOCKER_IMAGE`.
   */
  image?: string;
  /**
   * Host of the `swerex-remote` server for `locus: remote` (e.g. `localhost`).
   * Required for `remote`; ignored for `local`/`docker`.
   */
  host?: string;
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
  return redacted;
}

/** Where each effective value came from. */
export type SettingSource = 'default' | 'project' | 'manifest';

export interface ResolvedBatchSettings {
  settings: BatchSettings;
  sources: Record<keyof BatchSettings, SettingSource>;
}

export const DEFAULT_BATCH_SETTINGS: BatchSettings = {
  gate: 'voluntary',
  strategy: 'vertical-slice',
  proofOfWork: 'hard-gate',
  locus: 'local',
};

const SETTING_KEYS: (keyof BatchSettings)[] = [
  'gate',
  'strategy',
  'proofOfWork',
  'locus',
  'agent',
  'image',
  'host',
  'port',
  'authToken',
];

const ALLOWED_VALUES: Record<string, readonly string[] | null> = {
  gate: GATE_VALUES,
  strategy: STRATEGY_VALUES,
  proofOfWork: PROOF_OF_WORK_POLICY_VALUES,
  locus: LOCUS_VALUES,
  agent: null, // free-form string
  image: null, // free-form string (container image reference)
  host: null, // free-form string (swerex-remote host)
  port: null, // numeric string (swerex-remote port)
  authToken: null, // free-form secret string (swerex-remote X-API-Key)
};

/**
 * Resolve effective batch settings: defaults ← project config ← manifest.
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
    agent: 'default',
    image: 'default',
    host: 'default',
    port: 'default',
    authToken: 'default',
  };

  const writable = settings as { [K in keyof BatchSettings]: BatchSettings[K] };

  const projectBatch = readProjectConfig(projectRoot)?.batch;
  if (projectBatch) {
    for (const key of SETTING_KEYS) {
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
      const value = manifestOverrides[key];
      if (value !== undefined) {
        (writable[key] as BatchSettings[typeof key]) = value as BatchSettings[typeof key];
        sources[key] = 'manifest';
      }
    }
  }

  return { settings, sources };
}

export interface SetResult {
  ok: boolean;
  /** Error message when ok is false; the file is left unchanged. */
  error?: string;
  key?: keyof BatchSettings;
  value?: string;
}

/** Validate a `key=value` setting against the allowed enum values. */
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

  return { ok: true, key: key as keyof BatchSettings, value };
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
  // `port` is a number in the schema, so persist it as one (a quoted string
  // would be rejected by the manifest/project-config schemas on read).
  batch[key] = key === 'port' ? Number(value.trim()) : value;
  raw.batch = batch;

  writeFileSync(filePath, stringifyYaml(raw), 'utf-8');
  return validation;
}
