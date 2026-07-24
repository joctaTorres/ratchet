/**
 * Eval-spec binding layer.
 *
 * Authored YAML under `.ratchet/evals/specs/` maps a case id to how it should be
 * judged: which fixture codebase it runs against, the judge `kind`, and the
 * judging detail (`check` pass condition for `deterministic` bindings, `success`
 * criteria for the `llm-judge` binding, or the boot/readiness/spec lifecycle for
 * the `web` binding). A binding may declare an optional one-time `setup` to
 * bootstrap the fixture and, for `llm-judge`, how many repeat votes the judge
 * casts.
 *
 * Multiple bindings may live in one file (keyed by case id). A case with no
 * binding in any spec is unbound — it is recorded as `unjudged`, never passed.
 * Fixtures are checked-in codebases under `.ratchet/evals/fixtures/<name>/`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { RATCHET_DIR_NAME } from '../config.js';
import { JurySchema } from './jury.js';

export type BindingKind = 'deterministic' | 'llm-judge' | 'web';

const DeterministicBindingSchema = z.object({
  fixture: z.string().min(1),
  kind: z.literal('deterministic'),
  /** Bash command run against the fixture working copy. */
  check: z.object({
    run: z.string().min(1),
    /** `exit-zero` | `contains:<text>` | `regex:<pattern>` | substring. */
    pass: z.string().default('exit-zero'),
  }),
  setup: z.string().optional(),
});

const LlmJudgeBindingSchema = z.object({
  fixture: z.string().min(1),
  kind: z.literal('llm-judge'),
  /** Success criteria the spawned judge must satisfy. */
  success: z.string().min(1),
  setup: z.string().optional(),
  /** Per-binding jury override (votes/quorum), layered over the project default. */
  jury: JurySchema.optional(),
  /**
   * Explicit rubric override. When present, used verbatim instead of
   * auto-deriving one item per Then-clause from the scenario's steps.
   */
  rubric: z.array(z.string().min(1)).optional(),
});

/** A readiness probe: exactly one of `url` or `command`, paired with a required timeout. */
const WebReadinessSchema = z
  .object({
    url: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    /** Fail-closed boundary: readiness not reached within this many ms is a failure. */
    timeoutMs: z.number().int().positive(),
  })
  .refine((r) => (r.url ? 1 : 0) + (r.command ? 1 : 0) === 1, {
    message: 'readiness requires exactly one of "url" or "command"',
  });

const WebBindingSchema = z.object({
  fixture: z.string().min(1),
  kind: z.literal('web'),
  /** Bash command that boots the app under test. */
  start: z.string().min(1),
  readiness: WebReadinessSchema,
  /** Repo-relative path to the Playwright spec driving the case's Given/When/Then. */
  spec: z.string().min(1),
  setup: z.string().optional(),
});

export const BindingSchema = z.discriminatedUnion('kind', [
  DeterministicBindingSchema,
  LlmJudgeBindingSchema,
  WebBindingSchema,
]);

export type DeterministicBinding = z.infer<typeof DeterministicBindingSchema>;
export type LlmJudgeBinding = z.infer<typeof LlmJudgeBindingSchema>;
export type WebBinding = z.infer<typeof WebBindingSchema>;
export type WebReadiness = z.infer<typeof WebReadinessSchema>;
export type Binding = z.infer<typeof BindingSchema>;

/** A binding paired with the case id it targets and its source spec file. */
export interface ResolvedBinding {
  caseId: string;
  binding: Binding;
  source: string;
}

export interface EvalSpecLoadResult {
  /** Bindings keyed by case id (last spec wins on conflict, warned). */
  bindings: Map<string, ResolvedBinding>;
  warnings: string[];
}

export function specsDir(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'evals', 'specs');
}

export function fixturesDir(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'evals', 'fixtures');
}

export function fixturePath(projectRoot: string, fixture: string): string {
  return path.join(fixturesDir(projectRoot), fixture);
}

function listSpecFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ya?ml)$/i.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();
}

/** Validate one `caseId -> binding` entry, collecting a warning on failure. */
function resolveEntry(
  caseId: string,
  raw: unknown,
  source: string,
  warnings: string[]
): ResolvedBinding | null {
  // Fail loud on the pre-`jury` schema: `agentVotes` was renamed to
  // `jury.votes`. Zod strips unknown keys, so a stale spec would otherwise be
  // silently downgraded to the default single vote. Reject it explicitly.
  if (
    raw &&
    typeof raw === 'object' &&
    (raw as Record<string, unknown>).kind === 'llm-judge' &&
    'agentVotes' in (raw as Record<string, unknown>)
  ) {
    warnings.push(
      `Invalid binding for '${caseId}' in ${path.basename(source)}: 'agentVotes' is no longer supported; use 'jury.votes' instead.`
    );
    return null;
  }
  const parsed = BindingSchema.safeParse(raw);
  if (!parsed.success) {
    warnings.push(
      `Invalid binding for '${caseId}' in ${path.basename(source)}: ${parsed.error.issues
        .map((i) => i.message)
        .join('; ')}`
    );
    return null;
  }
  return { caseId, binding: parsed.data, source };
}

function loadSpecFile(file: string, into: Map<string, ResolvedBinding>, warnings: string[]): void {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, 'utf-8'));
  } catch (err) {
    warnings.push(`Failed to parse ${path.basename(file)}: ${(err as Error).message}`);
    return;
  }
  if (!raw || typeof raw !== 'object') {
    warnings.push(`${path.basename(file)} is not a mapping of case id to binding.`);
    return;
  }
  // A spec file may declare bindings either at the top level or under a
  // `bindings:` key. Support both for authoring ergonomics.
  const map = (raw as Record<string, unknown>).bindings ?? raw;
  if (!map || typeof map !== 'object') {
    warnings.push(`${path.basename(file)} has no bindings.`);
    return;
  }
  for (const [caseId, value] of Object.entries(map as Record<string, unknown>)) {
    const resolved = resolveEntry(caseId, value, file, warnings);
    if (resolved) {
      if (into.has(caseId)) {
        warnings.push(`Duplicate binding for '${caseId}'; ${path.basename(file)} overrides earlier spec.`);
      }
      into.set(caseId, resolved);
    }
  }
}

/** Load and validate every eval-spec under `.ratchet/evals/specs/`. */
export function loadEvalSpecs(projectRoot: string): EvalSpecLoadResult {
  const bindings = new Map<string, ResolvedBinding>();
  const warnings: string[] = [];
  for (const file of listSpecFiles(specsDir(projectRoot))) {
    loadSpecFile(file, bindings, warnings);
  }
  return { bindings, warnings };
}

/** Resolve the binding for a case id, or undefined when unbound. */
export function resolveBinding(
  specs: EvalSpecLoadResult,
  caseId: string
): ResolvedBinding | undefined {
  return specs.bindings.get(caseId);
}
