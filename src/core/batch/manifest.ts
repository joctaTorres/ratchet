/**
 * Batch Manifest
 *
 * A batch manifest (`.ratchet/batches/<name>/batch.yaml`) is declarative intent:
 * ordered phases, each with a goal, success criteria, and an executable
 * proof-of-work, and a DAG of change intents (name + optional `after` edges).
 *
 * The manifest NEVER stores progress — batch status is derived live from change
 * state on disk (see `status.ts`). A change intent with no change directory yet
 * is `pending`, not an error: this is what lets changes be created lazily as the
 * batch progresses.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { RATCHET_DIR_NAME } from '../config.js';
import { PermissionsPolicySchema } from './permissions-policy.js';
import { AgentSettingSchema } from './agent-setting.js';

// -----------------------------------------------------------------------------
// Pass-condition vocabulary (single source of truth)
// -----------------------------------------------------------------------------

/**
 * Recognized proof-of-work pass-condition shapes. Authored once here — the
 * manifest schema is the authority on the pass-condition vocabulary — and
 * consumed by BOTH the load-time validator ({@link validatePassCondition},
 * run as a `superRefine` on {@link ProofOfWorkSchema}) AND the runtime
 * evaluator (`evaluatePassCondition` in the engine). Sharing one classifier is
 * what makes a degenerate shape the same shape rejected at load and evaluated at
 * run, with no drift between the two.
 */
export type PassConditionKind = 'exit-zero' | 'contains' | 'regex' | 'substring';

export interface ClassifiedPassCondition {
  kind: PassConditionKind;
  /** `contains:` / bare-string (substring) literal needle. */
  needle?: string;
  /** `regex:` pattern body (the text after the `regex:` prefix). */
  pattern?: string;
}

/**
 * Matches a pass condition that *begins* with an exit-zero directive: `exit`,
 * an optional `code` and `-`/space separators, then `0` or `zero`, terminated by
 * end-of-string or a non-alphanumeric boundary (whitespace or punctuation such
 * as `—`, `:`, `,`). Recognizes `exit 0`, `exit-zero`, `exit code 0`, and prose
 * forms like `Exit 0, then ...` or `EXIT CODE 0 — everything passes`. An
 * exit-zero directive gates on the exit status and is NOT substring-matched
 * against stdout, so it can never be self-satisfying via the `run` command.
 */
export const EXIT_ZERO_DIRECTIVE = /^exit(?:[- ]?code)?[- ]?(?:0|zero)(?![a-z0-9_])/i;

/**
 * Classify a pass-condition string into its recognized shape. The empty string
 * (an absent/blank pass) is treated as exit-zero so the classifier is total; the
 * schema's own `min(1)` rejects a truly empty `pass` before this runs.
 */
export function classifyPassCondition(pass: string): ClassifiedPassCondition {
  const condition = pass.trim();
  if (condition === '' || EXIT_ZERO_DIRECTIVE.test(condition)) {
    return { kind: 'exit-zero' };
  }
  if (condition.startsWith('contains:')) {
    return { kind: 'contains', needle: condition.slice('contains:'.length) };
  }
  if (condition.startsWith('regex:')) {
    return { kind: 'regex', pattern: condition.slice('regex:'.length) };
  }
  return { kind: 'substring', needle: condition };
}

/**
 * Reject degenerate proof-of-work pass conditions at manifest load so a
 * hard-gate proof-of-work can never be vacuous by construction. Runs as a
 * `superRefine` on {@link ProofOfWorkSchema}; every issue carries the `pass`
 * zod path, so {@link formatManifestIssues} locates it (`phases.N.proofOfWork.pass`)
 * with no change to the error-reporting seam — both `ratchet validate` and
 * `loadBatchManifest` (the `batch apply` load) route through this parser and
 * reject identically.
 *
 * Rejected shapes:
 *   - an empty or whitespace-only `contains:` needle (`stdout.includes('')` is
 *     always true),
 *   - an empty `regex:` pattern (matches everything),
 *   - an invalid `regex:` pattern (the RegExp compile error is surfaced),
 *   - the echo-your-own-pass-phrase shape: the literal needle of a `contains:`
 *     or bare-string (substring) condition appearing verbatim in the `run`
 *     command, so the command can satisfy its own gate.
 *
 * Exit-zero directives are exempt (they gate on exit status, never stdout).
 * `regex:` patterns are exempt from the self-satisfying lint (a pattern
 * appearing in `run` is not the echo shape).
 */
function validatePassCondition(run: string, pass: string, ctx: z.RefinementCtx): void {
  const classified = classifyPassCondition(pass);
  switch (classified.kind) {
    case 'exit-zero':
      return;
    case 'contains': {
      const needle = classified.needle!;
      if (needle.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pass'],
          message:
            'proof-of-work pass `contains:` needle is empty; a hard-gate must be satisfiable only by real output',
        });
        return;
      }
      if (run.includes(needle)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pass'],
          message: `proof-of-work pass condition is self-satisfying: the \`contains:\` needle ${JSON.stringify(needle)} appears verbatim in the \`run\` command, so the command can satisfy its own gate`,
        });
      }
      return;
    }
    case 'regex': {
      const pattern = classified.pattern!;
      if (pattern === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pass'],
          message:
            'proof-of-work pass `regex:` pattern is empty; an empty pattern matches everything',
        });
        return;
      }
      try {
        new RegExp(pattern);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pass'],
          message: `proof-of-work pass \`regex:\` pattern is invalid: ${(err as Error).message}`,
        });
      }
      return;
    }
    case 'substring': {
      const needle = classified.needle!;
      if (run.includes(needle)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pass'],
          message: `proof-of-work pass condition is self-satisfying: the pass needle ${JSON.stringify(needle)} appears verbatim in the \`run\` command, so the command can satisfy its own gate`,
        });
      }
      return;
    }
  }
}

// -----------------------------------------------------------------------------
// Zod schema
// -----------------------------------------------------------------------------

/** Proof-of-work kinds are constrained to executable checks an agent can run. */
export const PROOF_OF_WORK_KINDS = ['integration', 'blackbox', 'llm-judge'] as const;
export type ProofOfWorkKind = (typeof PROOF_OF_WORK_KINDS)[number];

export const ProofOfWorkSchema = z
  .object({
    kind: z.enum(PROOF_OF_WORK_KINDS, {
      error: `proof-of-work kind must be one of: ${PROOF_OF_WORK_KINDS.join(', ')}`,
    }),
    run: z.string().min(1, { error: 'proof-of-work run command is required' }),
    pass: z.string().min(1, { error: 'proof-of-work pass condition is required' }),
  })
  .superRefine((pow, ctx) => {
    validatePassCondition(pow.run, pow.pass, ctx);
  });

export const ChangeIntentSchema = z.object({
  name: z.string().min(1, { error: 'change intent name is required' }),
  after: z.array(z.string()).default([]),
  /**
   * Required, short definition of done for THIS change — what "done" means for
   * it, distinct from the phase-level `success`. Must be non-empty: every change
   * intent must state its own bar.
   */
  done: z.string().min(1, { error: 'change intent done criterion is required' }),
});

export const PhaseSchema = z.object({
  name: z.string().min(1, { error: 'phase name is required' }),
  goal: z.string().min(1, { error: 'phase goal is required' }),
  success: z.string().min(1, { error: 'phase success criteria are required' }),
  proofOfWork: ProofOfWorkSchema,
  changes: z.array(ChangeIntentSchema).default([]),
});

/** Optional per-manifest setting overrides (project config provides defaults). */
export const BatchSettingsOverrideSchema = z
  .object({
    gate: z.enum(['voluntary', 'after-propose', 'every-phase', 'autonomous']).optional(),
    strategy: z.enum(['vertical-slice', 'feature']).optional(),
    proofOfWork: z.enum(['hard-gate', 'warn']).optional(),
    locus: z.enum(['local', 'docker', 'remote']).optional(),
    // PR grouping mode. Validated identically to the project-config scope;
    // `PR_GROUPING_VALUES` in batch/config.ts is the vocabulary's source of
    // truth. The enclosing object stays `.strict()` — `prGrouping` is known.
    prGrouping: z.enum(['off', 'whole-batch', 'per-phase', 'per-change']).optional(),
    // Scalar agent name OR a partial {propose, apply, verify, pr} stage-map. Shared
    // schema; identical to the project-config scope (see agent-setting.ts). The
    // enclosing object stays `.strict()` — `agent` is a known key.
    agent: AgentSettingSchema.optional(),
    image: z.string().optional(),
    host: z.string().optional(),
    port: z.number().optional(),
    authToken: z.string().optional(),
    // Per-change agent permission override. `permissions` is a known key, so the
    // schema stays `.strict()` (it rejects unknown keys, not this one).
    permissions: PermissionsPolicySchema.optional(),
    insecure: z.boolean().optional(),
    // Per-agent ReX timeout (ms). Positive integer; overrides the project
    // config key for this batch (and is itself overridden by the
    // RATCHET_AGENT_TIMEOUT_MS env var at resolution time).
    agentTimeoutMs: z.number().int().positive().optional(),
    // Docker-locus hardening knobs (features/docker-locus-hardening). Mirrored
    // identically to the project-config scope; the enclosing object stays
    // `.strict()` — these are known keys.
    dockerUser: z.string().optional(),
    dockerMemory: z.string().optional(),
    dockerPidsLimit: z.number().int().positive().optional(),
    dockerCpus: z.number().positive().optional(),
    network: z.string().optional(),
  })
  .strict();

export const BatchManifestSchema = z.object({
  name: z.string().min(1, { error: 'batch name is required' }),
  created: z.string().optional(),
  settings: BatchSettingsOverrideSchema.optional(),
  phases: z.array(PhaseSchema).default([]),
});

export type ProofOfWork = z.infer<typeof ProofOfWorkSchema>;
export type ChangeIntent = z.infer<typeof ChangeIntentSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type BatchSettingsOverride = z.infer<typeof BatchSettingsOverrideSchema>;
export type BatchManifest = z.infer<typeof BatchManifestSchema>;

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

export function getBatchesDir(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'batches');
}

export function getBatchDir(projectRoot: string, name: string): string {
  return path.join(getBatchesDir(projectRoot), name);
}

export function getBatchManifestPath(projectRoot: string, name: string): string {
  return path.join(getBatchDir(projectRoot, name), 'batch.yaml');
}

export function batchExists(projectRoot: string, name: string): boolean {
  return existsSync(getBatchManifestPath(projectRoot, name));
}

// -----------------------------------------------------------------------------
// Parse / validate
// -----------------------------------------------------------------------------

export class BatchManifestError extends Error {
  constructor(
    message: string,
    /** Source location, e.g. file path or `phases[0].changes[1]`. */
    public readonly location?: string
  ) {
    super(message);
    this.name = 'BatchManifestError';
  }
}

/**
 * Turn a ZodError into clear, located messages for each malformed entry, so the
 * caller can report the offending entry without losing valid ones.
 */
export function formatManifestIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const location = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${location}: ${issue.message}`;
  });
}

/** Parse and validate manifest content (already loaded from disk). */
export function parseBatchManifest(content: string): BatchManifest {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BatchManifestError(`Failed to parse batch manifest YAML: ${message}`);
  }

  if (!raw || typeof raw !== 'object') {
    throw new BatchManifestError('Batch manifest must be a YAML object');
  }

  const result = BatchManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = formatManifestIssues(result.error);
    throw new BatchManifestError(
      `Invalid batch manifest:\n  ${issues.join('\n  ')}`,
      issues[0]
    );
  }

  // `llm-judge` is a recognized proof-of-work kind (the schema enum keeps it so
  // the type and validation message stay precise), but it is NOT yet executable
  // by `batch apply` — no judge is wired. Reject it here, at validation, with an
  // actionable message rather than letting a batch reach apply carrying a proof
  // that can never pass. Both the `ratchet validate` and `loadBatchManifest`
  // (apply) paths route through this parser, so the rejection covers both.
  result.data.phases.forEach((phase, index) => {
    if (phase.proofOfWork.kind === 'llm-judge') {
      throw new BatchManifestError(
        'llm-judge proof-of-work is not yet supported by `batch apply`; use `integration` or `blackbox`.',
        `phases.${index}.proofOfWork.kind`
      );
    }
  });

  return result.data;
}

/** Load and validate the manifest for a batch by name. */
export function loadBatchManifest(projectRoot: string, name: string): BatchManifest {
  const manifestPath = getBatchManifestPath(projectRoot, name);
  if (!existsSync(manifestPath)) {
    throw new BatchManifestError(
      `Batch '${name}' not found at ${manifestPath}`,
      manifestPath
    );
  }

  const content = readFileSync(manifestPath, 'utf-8');
  const manifest = parseBatchManifest(content);
  // The on-disk name is authoritative even if the manifest omits/differs.
  return { ...manifest, name: manifest.name || name };
}

/** Collect every change intent across all phases. */
export function allChangeIntents(manifest: BatchManifest): ChangeIntent[] {
  return manifest.phases.flatMap((phase) => phase.changes);
}
