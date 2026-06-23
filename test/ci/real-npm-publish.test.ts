import { describe, it, expect } from 'vitest';
import {
  loadCiWorkflow,
  findRunStepIndex,
  type WorkflowJob,
} from './helpers/workflow.js';

/**
 * This slice flips the gated `publish` job from a dry-run to a REAL provenance
 * publish: the publish step now runs `npm publish --provenance --access public`
 * (no `--dry-run`), authenticated from the `NPM_TOKEN` secret via
 * `NODE_AUTH_TOKEN`, and the job holds `id-token: write` so npm can mint a
 * provenance attestation. NEITHER fail-closed gate is relaxed — the job still
 * `needs: [ci]` and runs only when `needs.ci.outputs.release_allowed == 'true'`,
 * and the publish step still runs only when the version guard's
 * `should_publish` output is the literal `true`.
 *
 * A unit test can't run GitHub Actions, so the wiring is proven structurally
 * against the parsed-workflow model — matching on substrings so it stays robust
 * to cosmetic renames — mirroring `idempotent-version-guard.test.ts`.
 */

const workflow = loadCiWorkflow();

/** Look a job up by id, asserting it exists. */
function job(id: string): WorkflowJob {
  const found = workflow.jobs.find((j) => j.id === id);
  expect(found, `workflow defines a "${id}" job`).toBeDefined();
  return found as WorkflowJob;
}

/** The publish job's real `npm publish` step (a publish with no `--dry-run`). */
function realPublishStep(steps: WorkflowJob['steps']) {
  const step = steps[findRunStepIndex(steps, 'npm publish')];
  expect(step, 'publish job has an npm publish step').toBeDefined();
  return step;
}

describe('real npm publish', () => {
  describe('the publish step is a real provenance publish', () => {
    it('runs a real "npm publish" (not a dry-run)', () => {
      const { steps } = job('publish');
      const publishStep = realPublishStep(steps);
      expect(publishStep.run).toMatch(/npm\s+publish/);
      expect(publishStep.run).not.toMatch(/--dry-run/);
    });

    it('publishes with --provenance and --access public', () => {
      const publishStep = realPublishStep(job('publish').steps);
      expect(publishStep.run).toMatch(/--provenance/);
      expect(publishStep.run).toMatch(/--access\s+public/);
    });

    it('has no dry-run publish anywhere in the job', () => {
      const { steps } = job('publish');
      const dryRun = steps.find((s) => /--dry-run/i.test(s.run ?? ''));
      expect(dryRun).toBeUndefined();
    });
  });

  describe('the publish uses a DYNAMIC dist-tag (a prerelease must not hit "latest")', () => {
    /** The step that computes the dist-tag from the local version. */
    function distTagStep(steps: WorkflowJob['steps']) {
      const step = steps[findRunStepIndex(steps, 'dist-tag.js')];
      expect(step, 'publish job has a dist-tag resolver step').toBeDefined();
      expect(step.id, 'the dist-tag step has an id').toBeDefined();
      return step;
    }

    it('resolves the dist-tag from the built helper and writes it to GITHUB_OUTPUT', () => {
      const step = distTagStep(job('publish').steps);
      expect(step.run).toMatch(/dist\/core\/ci\/dist-tag\.js/);
      expect(step.run).toMatch(/GITHUB_OUTPUT/);
    });

    it('passes --tag sourced from the computed dist-tag output (not hard-coded)', () => {
      const { steps } = job('publish');
      const distTag = distTagStep(steps);
      const publishStep = realPublishStep(steps);

      // The publish carries --tag, and its value references the dist-tag step's
      // output rather than a literal tag like `latest`/`beta`.
      expect(publishStep.run).toMatch(/--tag\s+\S/);
      expect(publishStep.run).toContain(`steps.${distTag.id}.outputs`);
      expect(publishStep.run ?? '').not.toMatch(/--tag\s+(latest|beta|rc)\b/);
    });

    it('resolves the dist-tag before the publish step runs', () => {
      const { steps } = job('publish');
      const distTag = findRunStepIndex(steps, 'dist-tag.js');
      const publishStep = findRunStepIndex(steps, 'npm publish');
      expect(distTag).toBeGreaterThanOrEqual(0);
      expect(distTag).toBeLessThan(publishStep);
    });
  });

  describe('the publish is authenticated from the NPM_TOKEN secret', () => {
    it('injects NODE_AUTH_TOKEN from secrets.NPM_TOKEN (no hard-coded token)', () => {
      const publishStep = realPublishStep(job('publish').steps);
      const token = publishStep.env.NODE_AUTH_TOKEN ?? '';
      expect(token).toContain('secrets.NPM_TOKEN');
      // The run body must not carry a literal token — auth is via the secret env.
      expect(publishStep.run ?? '').not.toMatch(/_authToken|npm_token=/i);
    });
  });

  describe('the publish job grants provenance permissions', () => {
    it('holds id-token: write (so npm can mint a provenance attestation)', () => {
      expect(job('publish').permissions['id-token']).toBe('write');
    });

    it('keeps contents read-only (least privilege)', () => {
      expect(job('publish').permissions.contents).toBe('read');
    });
  });

  describe('both fail-closed gates still guard the real publish', () => {
    it("the job runs only when needs.ci.outputs.release_allowed == 'true'", () => {
      const publish = job('publish');
      expect(publish.needs).toContain('ci');
      const cond = (publish.if ?? '').replace(/\s+/g, ' ').trim();
      expect(cond).toContain('needs.ci.outputs.release_allowed');
      expect(cond).toMatch(/==\s*'true'/);
    });

    it("the publish step runs only when the guard's should_publish == 'true'", () => {
      const { steps } = job('publish');
      const guard = steps[findRunStepIndex(steps, 'version-guard.js')];
      expect(guard, 'publish job has a version-guard step').toBeDefined();
      expect(guard.id).toBeDefined();

      const publishStep = realPublishStep(steps);
      const cond = (publishStep.if ?? '').replace(/\s+/g, ' ').trim();
      expect(cond).toContain(`steps.${guard.id}.outputs.should_publish`);
      expect(cond).toMatch(/==\s*'true'/);
    });

    it('runs the version guard before the publish step', () => {
      const { steps } = job('publish');
      const guard = findRunStepIndex(steps, 'version-guard.js');
      const publishStep = findRunStepIndex(steps, 'npm publish');
      expect(guard).toBeGreaterThanOrEqual(0);
      expect(guard).toBeLessThan(publishStep);
    });
  });
});
