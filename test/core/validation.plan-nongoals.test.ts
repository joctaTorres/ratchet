import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Validator } from '../../src/core/validation/validator.js';
import { VALIDATION_MESSAGES } from '../../src/core/validation/constants.js';

/**
 * Validate warns on a plan without a Non-goals section: a missing
 * `## Non-goals` section in plan.md is reported as a WARNING — never an
 * ERROR — so plans authored before the section existed keep validating,
 * while new plans are nudged to record what the change deliberately will
 * not do. The warning message names the section, directs recording what the
 * change deliberately will not do, and allows stating explicitly that
 * nothing was ruled out. A sweep over every active and archived plan in
 * this repository proves the check adds no ERROR and leaves each plan's
 * validity unchanged from its pre-change result.
 *
 * Mirrors features/plan-nongoals/validate-missing-nongoals-warning.feature
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const PLAN_WITHOUT_NONGOALS = `# change-without-nongoals

## Why

This plan exists to exercise the missing Non-goals advisory in validation.

## What Changes

- Adds the advisory check.

## Design

- Rides the existing validator composition.

## Tasks

- [ ] 1.1 Do the thing
`;

const PLAN_WITH_NONGOALS = `# change-with-nongoals

## Why

This plan exists to exercise the missing Non-goals advisory in validation.

## What Changes

- Adds the advisory check.

## Non-goals

- Nothing was ruled out.

## Design

- Rides the existing validator composition.

## Tasks

- [ ] 1.1 Do the thing
`;

/**
 * Lists every plan.md under the given changes directory (one level deep:
 * `<dir>/<change>/plan.md`). Returns absolute paths, sorted.
 */
function listPlans(changesDir: string): string[] {
  if (!existsSync(changesDir)) return [];
  return readdirSync(changesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(changesDir, entry.name, 'plan.md'))
    .filter(planPath => existsSync(planPath))
    .sort();
}

describe('Validator - plan Non-goals advisory', () => {
  const validator = new Validator();

  it('warns — never errors — on a plan without a ## Non-goals section, and the plan stays valid', async () => {
    const report = await validator.validatePlanContent(PLAN_WITHOUT_NONGOALS);

    const nongoalsIssues = report.issues.filter(
      i => i.message === VALIDATION_MESSAGES.PLAN_NO_NONGOALS,
    );
    expect(nongoalsIssues).toHaveLength(1);
    expect(nongoalsIssues[0].level).toBe('WARNING');
    expect(nongoalsIssues[0].path).toBe('Non-goals');

    const errors = report.issues.filter(i => i.level === 'ERROR');
    expect(errors).toHaveLength(0);
    expect(report.summary.errors).toBe(0);
    expect(report.valid).toBe(true);
  });

  it('reports no Non-goals issue for a plan with the section, and the plan stays valid', async () => {
    const report = await validator.validatePlanContent(PLAN_WITH_NONGOALS);

    const mentions = report.issues.filter(i =>
      i.message.includes('## Non-goals'),
    );
    expect(mentions).toHaveLength(0);
    expect(report.valid).toBe(true);
  });

  it('words the warning to name the section, the remedy, and the nothing-ruled-out one-liner', () => {
    const message = VALIDATION_MESSAGES.PLAN_NO_NONGOALS;
    expect(message).toContain('## Non-goals');
    expect(message).toMatch(/deliberately will not do/);
    expect(message).toMatch(/nothing was ruled out/);
    expect(message).toMatch(/one line/);
  });

  it('pins the message in constants.ts as the one the validator emits', async () => {
    const report = await validator.validatePlanContent(PLAN_WITHOUT_NONGOALS);
    expect(
      report.issues.some(i => i.message === VALIDATION_MESSAGES.PLAN_NO_NONGOALS),
    ).toBe(true);
  });
});

describe('Validator - plan Non-goals sweep over repository plans', () => {
  // Non-strict by design: --strict is an opt-in CLI flag the engine and CI
  // never pass; the sweep proves the new check adds no ERROR and changes no
  // plan's validity.
  const validator = new Validator();

  const activePlans = listPlans(path.join(REPO_ROOT, '.ratchet', 'changes')).filter(
    planPath => !planPath.includes(`${path.sep}archive${path.sep}`),
  );
  const archivedPlans = listPlans(
    path.join(REPO_ROOT, '.ratchet', 'changes', 'archive'),
  );

  it('discovers a non-empty active set and a non-empty archived set', () => {
    expect(activePlans.length).toBeGreaterThan(0);
    expect(archivedPlans.length).toBeGreaterThan(0);
  });

  it.each([
    ...activePlans.map(planPath => ({ set: 'active', planPath })),
    ...archivedPlans.map(planPath => ({ set: 'archived', planPath })),
  ])(
    'adds no ERROR and changes no validity for $set plan: $planPath',
    async ({ planPath }) => {
      const report = await validator.validatePlan(planPath);

      const newCheckIssues = report.issues.filter(
        i => i.message === VALIDATION_MESSAGES.PLAN_NO_NONGOALS,
      );
      const otherIssues = report.issues.filter(
        i => i.message !== VALIDATION_MESSAGES.PLAN_NO_NONGOALS,
      );

      // The new check never emits an ERROR.
      for (const issue of newCheckIssues) {
        expect(issue.level).toBe('WARNING');
      }
      expect(report.summary.errors).toBe(
        otherIssues.filter(i => i.level === 'ERROR').length,
      );

      // Validity is unchanged from the pre-change result (the report with
      // the new check's issues removed): plans that validated before still
      // validate, and plans carrying pre-existing ERRORs keep them.
      const preChangeValid =
        otherIssues.filter(i => i.level === 'ERROR').length === 0;
      expect(report.valid).toBe(preChangeValid);
    },
  );
});
