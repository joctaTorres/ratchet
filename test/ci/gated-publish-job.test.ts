import { describe, it, expect } from 'vitest';
import {
  loadCiWorkflow,
  findRunStepIndex,
  type WorkflowJob,
} from './helpers/workflow.js';

/**
 * This slice promotes the dry-run publish into its OWN gated `publish` job so
 * the reachability guarantee ("publish only when the release-decision module
 * returns ALLOW on main") becomes a property of the workflow GRAPH:
 *
 *   - the `ci` job exposes a `release_allowed` output sourced from the
 *     release-gate step (literally `decision.allowed`); and
 *   - a distinct `publish` job `needs: [ci]` and is conditioned on
 *     `needs.ci.outputs.release_allowed == 'true'`, running `npm publish --dry-run`.
 *
 * A unit test can't run GitHub Actions, so the wiring is proven structurally
 * against the parsed-workflow model — matching on substrings so it stays robust
 * to cosmetic renames — mirroring `dry-run-publish-wiring.test.ts`.
 */

const workflow = loadCiWorkflow();

/** Look a job up by id, asserting it exists. */
function job(id: string): WorkflowJob {
  const found = workflow.jobs.find((j) => j.id === id);
  expect(found, `workflow defines a "${id}" job`).toBeDefined();
  return found as WorkflowJob;
}

describe('gated publish job', () => {
  describe('the ci job exposes the release decision as a job output', () => {
    it('declares a release_allowed output', () => {
      const ci = job('ci');
      expect(ci.outputs.release_allowed).toBeDefined();
    });

    it('sources release_allowed from the release-gate step output', () => {
      const ci = job('ci');
      // The output reads `steps.<gate>.outputs.release_allowed`; the gate step is
      // the one that invokes the release-gate runner.
      const expr = ci.outputs.release_allowed;
      expect(expr).toMatch(/steps\./);
      expect(expr).toMatch(/\.outputs\.release_allowed/);

      // The referenced step id must be the release-gate step. Find the step that
      // runs the runner and confirm the output expression names its id.
      const gateStep = ci.steps[findRunStepIndex(ci.steps, 'release-gate')];
      expect(gateStep, 'ci job has a release-gate step').toBeDefined();
      expect(gateStep.id).toBeDefined();
      expect(expr).toContain(`steps.${gateStep.id}.outputs.release_allowed`);
    });
  });

  describe('a distinct publish job is gated on the decision', () => {
    it('exists as a job separate from ci', () => {
      const publish = job('publish');
      expect(publish.id).toBe('publish');
      expect(publish.id).not.toBe('ci');
    });

    it('needs the ci job (so a red gate fails ci and skips publish)', () => {
      expect(job('publish').needs).toContain('ci');
    });

    it('is conditioned on needs.ci.outputs.release_allowed == \'true\'', () => {
      const cond = (job('publish').if ?? '').replace(/\s+/g, ' ').trim();
      expect(cond).toContain('needs.ci.outputs.release_allowed');
      expect(cond).toMatch(/==\s*'true'/);
    });
  });

  describe('the publish job runs a dry-run publish (no real release in this slice)', () => {
    it('runs "npm publish --dry-run"', () => {
      const { steps } = job('publish');
      const publishStep = steps[findRunStepIndex(steps, 'npm publish --dry-run')];
      expect(publishStep, 'publish job has a dry-run publish step').toBeDefined();
      expect(publishStep.run).toMatch(/npm\s+publish\s+--dry-run/);
    });

    it('checks out, sets up node + pnpm, and builds before publishing', () => {
      const { steps } = job('publish');
      const checkout = steps.findIndex((s) => (s.uses ?? '').includes('actions/checkout'));
      const node = steps.findIndex((s) => (s.uses ?? '').includes('actions/setup-node'));
      const pnpm = steps.findIndex((s) => (s.uses ?? '').includes('pnpm/action-setup'));
      const build = findRunStepIndex(steps, 'pnpm build');
      const publishStep = findRunStepIndex(steps, 'npm publish --dry-run');

      for (const idx of [checkout, node, pnpm, build]) {
        expect(idx).toBeGreaterThanOrEqual(0);
      }
      expect(build).toBeLessThan(publishStep);
    });

    it('runs no bare "npm publish" without --dry-run (no real release)', () => {
      const { steps } = job('publish');
      const realPublish = steps.find(
        (s) => /npm\s+publish/i.test(s.run ?? '') && !/--dry-run/i.test(s.run ?? ''),
      );
      expect(realPublish).toBeUndefined();
    });
  });
});
