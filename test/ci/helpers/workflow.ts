import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * A single step within a GitHub Actions job, normalized to the small shape the
 * `test/ci` assertions need: an optional `name`, the action reference (`uses`),
 * the shell command (`run`), and the step's `if` condition. Index within
 * `WorkflowJob.steps` carries the ordering that the quality-gate assertions pin.
 */
export interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  /**
   * The step's `if` condition, if any. The release-path assertions read this to
   * verify the gate and dry-run publish steps are conditioned to `main` only.
   */
  if?: string;
  /**
   * The step's `env:` map, with each value coerced to a string. The release-gate
   * wiring assertions read this to verify the gate step carries the `GATE_*`
   * signals (e.g. `GATE_COVERAGE`, `GATE_E2E`) fed into the decision module.
   */
  env: Record<string, string>;
}

/** A normalized GitHub Actions job: its `runs-on` and ordered step list. */
export interface WorkflowJob {
  id: string;
  name?: string;
  runsOn?: string;
  steps: WorkflowStep[];
}

/**
 * A structured, framework-light view of a parsed workflow file. `triggers` is
 * the normalized set of `on:` events (array, string, or map forms collapsed to
 * a string[]); `jobs` preserves declaration order. Designed to be extended by
 * the later release-gate / dry-run-publish changes without churn.
 */
export interface ParsedWorkflow {
  name?: string;
  triggers: string[];
  jobs: WorkflowJob[];
}

/** Absolute path to the repository's CI workflow. */
export function ciWorkflowPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // test/ci/helpers -> repo root
  return path.resolve(here, '..', '..', '..', '.github', 'workflows', 'ci.yml');
}

/**
 * GitHub Actions accepts `on:` as a string (`on: push`), an array
 * (`on: [push, pull_request]`), or a map (`on: { push: {...} }`). Normalize all
 * three to a flat list of event names.
 */
function normalizeTriggers(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === 'object') return Object.keys(on as Record<string, unknown>);
  return [];
}

function normalizeEnv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = typeof value === 'string' ? value : String(value);
  }
  return out;
}

function normalizeStep(raw: unknown): WorkflowStep {
  const step = (raw ?? {}) as Record<string, unknown>;
  return {
    name: typeof step.name === 'string' ? step.name : undefined,
    uses: typeof step.uses === 'string' ? step.uses : undefined,
    run: typeof step.run === 'string' ? step.run : undefined,
    if: typeof step.if === 'string' ? step.if : undefined,
    env: normalizeEnv(step.env),
  };
}

function normalizeJobs(jobs: unknown): WorkflowJob[] {
  if (!jobs || typeof jobs !== 'object') return [];
  return Object.entries(jobs as Record<string, unknown>).map(([id, rawJob]) => {
    const job = (rawJob ?? {}) as Record<string, unknown>;
    const steps = Array.isArray(job.steps) ? job.steps.map(normalizeStep) : [];
    return {
      id,
      name: typeof job.name === 'string' ? job.name : undefined,
      runsOn: typeof job['runs-on'] === 'string' ? (job['runs-on'] as string) : undefined,
      steps,
    };
  });
}

/** Parse raw workflow YAML into the normalized structured view. */
export function parseWorkflow(source: string): ParsedWorkflow {
  const doc = (parseYaml(source) ?? {}) as Record<string, unknown>;
  return {
    name: typeof doc.name === 'string' ? doc.name : undefined,
    // `on` is a YAML 1.1 boolean-ish key; the `yaml` lib keeps it as the string
    // "on", but guard for the normalized `true` key just in case.
    triggers: normalizeTriggers(doc.on ?? (doc as Record<string, unknown>)['true']),
    jobs: normalizeJobs(doc.jobs),
  };
}

/** Read and parse `.github/workflows/ci.yml` from the repository. */
export function loadCiWorkflow(): ParsedWorkflow {
  return parseWorkflow(readFileSync(ciWorkflowPath(), 'utf8'));
}

/**
 * Index of the first step in `steps` whose `run` command contains `needle`
 * (case-insensitive), or `-1`. Ordering assertions compare these indices rather
 * than exact step names, keeping them robust to cosmetic renames.
 */
export function findRunStepIndex(steps: WorkflowStep[], needle: string): number {
  const lower = needle.toLowerCase();
  return steps.findIndex((s) => (s.run ?? '').toLowerCase().includes(lower));
}

/** Index of the first step whose `uses` reference contains `needle`, or `-1`. */
export function findUsesStepIndex(steps: WorkflowStep[], needle: string): number {
  const lower = needle.toLowerCase();
  return steps.findIndex((s) => (s.uses ?? '').toLowerCase().includes(lower));
}
