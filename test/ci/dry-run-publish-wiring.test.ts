import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  loadCiWorkflow,
  findRunStepIndex,
  findUsesStepIndex,
  type WorkflowJob,
  type WorkflowStep,
} from './helpers/workflow.js';

/**
 * This slice fills the release-path seam in `.github/workflows/ci.yml`: after
 * the green install -> lint -> test spine, a main-only release-gate step that
 * consults the release-decision module, then a main-only `npm publish --dry-run`
 * step. A unit test can't run GitHub Actions, so the wiring is proven
 * structurally against the parsed-workflow model the first slice exposed — step
 * presence, ordering, the main-only `if`, and the dry-run flag — matching steps
 * by `run` substrings so it stays robust to cosmetic renames.
 */

const workflow = loadCiWorkflow();

/** The single CI job that runs the spine and the release path. */
function ciJob(): WorkflowJob {
  const job = workflow.jobs[0];
  expect(job, 'workflow defines at least one job').toBeDefined();
  return job;
}

/** Index of the main-only release-gate step (it invokes the release-gate runner). */
function gateStepIndex(steps: WorkflowStep[]): number {
  return findRunStepIndex(steps, 'release-gate');
}

/** Index of the dry-run publish step. */
function dryRunPublishIndex(steps: WorkflowStep[]): number {
  return findRunStepIndex(steps, 'npm publish --dry-run');
}

/** A step is main-only when its `if` pins `github.ref` to `refs/heads/main`. */
function isMainOnly(step: WorkflowStep): boolean {
  const cond = (step.if ?? '').toLowerCase();
  return cond.includes('refs/heads/main') || /\bmain\b/.test(cond);
}

describe('gated dry-run publish wiring', () => {
  describe('the install -> lint -> test spine is preserved ahead of the release path', () => {
    it('installs dependencies, then lints, then tests, in order', () => {
      const { steps } = ciJob();
      const install = findRunStepIndex(steps, 'install');
      const lint = findRunStepIndex(steps, 'lint');
      const test = findRunStepIndex(steps, 'test');

      expect(install).toBeGreaterThanOrEqual(0);
      expect(lint).toBeGreaterThan(install);
      expect(test).toBeGreaterThan(lint);
    });

    it('places every release-path step after the test step', () => {
      const { steps } = ciJob();
      const test = findRunStepIndex(steps, 'test');
      const gate = gateStepIndex(steps);
      const publish = dryRunPublishIndex(steps);

      expect(gate).toBeGreaterThan(test);
      expect(publish).toBeGreaterThan(test);
    });
  });

  describe('a main-only release-gate step is wired after the green spine', () => {
    it('has a release-gate step after the install -> lint -> test spine', () => {
      const { steps } = ciJob();
      const test = findRunStepIndex(steps, 'test');
      const gate = gateStepIndex(steps);

      expect(gate).toBeGreaterThanOrEqual(0);
      expect(gate).toBeGreaterThan(test);
    });

    it('conditions the release-gate step to run only on the main branch', () => {
      const { steps } = ciJob();
      const gate = steps[gateStepIndex(steps)];
      expect(gate).toBeDefined();
      expect(isMainOnly(gate)).toBe(true);
    });

    it('consults the release-decision module via the release-gate runner', () => {
      // The gate step invokes the runner; the runner — not the YAML — owns the
      // decision. Prove both halves: the step runs the runner, and the runner
      // delegates to the unit-tested release-decision module.
      const { steps } = ciJob();
      const gate = steps[gateStepIndex(steps)];
      expect(gate.run).toMatch(/release-gate/);

      const here = path.dirname(fileURLToPath(import.meta.url));
      const runnerSrc = readFileSync(
        path.resolve(here, '..', '..', 'src', 'core', 'ci', 'release-gate.ts'),
        'utf8',
      );
      expect(runnerSrc).toMatch(/release-decision/);
      expect(runnerSrc).toMatch(/decideRelease/);
    });
  });

  describe('the publish step runs as a dry-run after the release gate', () => {
    it('runs "npm publish --dry-run"', () => {
      const { steps } = ciJob();
      const publish = steps[dryRunPublishIndex(steps)];
      expect(publish).toBeDefined();
      expect(publish.run).toMatch(/npm\s+publish\s+--dry-run/);
    });

    it('places the dry-run publish step after the release-gate step', () => {
      const { steps } = ciJob();
      expect(dryRunPublishIndex(steps)).toBeGreaterThan(gateStepIndex(steps));
    });

    it('conditions the dry-run publish step to run only on the main branch', () => {
      const { steps } = ciJob();
      const publish = steps[dryRunPublishIndex(steps)];
      expect(isMainOnly(publish)).toBe(true);
    });
  });

  describe('the workflow never performs a real publish', () => {
    it('runs no bare "npm publish" without the --dry-run flag', () => {
      const { steps } = ciJob();
      const realPublish = steps.find(
        (s) => /npm\s+publish/i.test(s.run ?? '') && !/--dry-run/i.test(s.run ?? ''),
      );
      expect(realPublish).toBeUndefined();
    });

    it('requires no npm auth token for the publish path', () => {
      // Scan the workflow's executable content (comments stripped) for actual
      // token wiring — a comment that merely says "no token needed" must not
      // trip the assertion, only a real NODE_AUTH_TOKEN / secret reference would.
      const source = readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          '.github',
          'workflows',
          'ci.yml',
        ),
        'utf8',
      );
      const executable = source
        .split('\n')
        .map((line) => line.replace(/#.*$/, ''))
        .join('\n');
      expect(executable).not.toMatch(/NODE_AUTH_TOKEN/i);
      expect(executable).not.toMatch(/NPM_TOKEN/i);
      expect(executable).not.toMatch(/secrets\./i);
    });
  });

  describe('the release path is unreachable while lint or test is red', () => {
    it('places both release-path steps after the lint and test steps', () => {
      const { steps } = ciJob();
      const lint = findRunStepIndex(steps, 'lint');
      const test = findRunStepIndex(steps, 'test');
      const gate = gateStepIndex(steps);
      const publish = dryRunPublishIndex(steps);

      for (const releaseStep of [gate, publish]) {
        expect(releaseStep).toBeGreaterThan(lint);
        expect(releaseStep).toBeGreaterThan(test);
      }
    });

    it('checks out the repository before the install/lint/test spine', () => {
      const { steps } = ciJob();
      const checkout = findUsesStepIndex(steps, 'actions/checkout');
      expect(checkout).toBeGreaterThanOrEqual(0);
      expect(checkout).toBeLessThan(findRunStepIndex(steps, 'install'));
    });
  });
});
