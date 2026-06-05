import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { Validator } from '../../src/core/validation/validator.js';
import { VALIDATION_MESSAGES } from '../../src/core/validation/constants.js';

function messagesOf(report: { issues: { message: string }[] }): string {
  return report.issues.map(i => i.message).join('\n');
}

describe('Validator - feature (Gherkin) rules', () => {
  const validator = new Validator();

  it('passes a well-formed feature', async () => {
    const report = await validator.validateFeatureContent(
      `Feature: Login
  Scenario: ok
    Given a registered user
    When they submit valid credentials
    Then they are authenticated
`,
      'login.feature'
    );
    expect(report.valid).toBe(true);
  });

  it('errors when the Feature: header is missing', async () => {
    const report = await validator.validateFeatureContent(
      `Scenario: orphan
    Given a
    When b
    Then c
`,
      'x.feature'
    );
    expect(report.valid).toBe(false);
    expect(messagesOf(report)).toContain(VALIDATION_MESSAGES.FEATURE_NO_HEADER);
  });

  it('errors when there are zero scenarios', async () => {
    const report = await validator.validateFeatureContent('Feature: empty\n', 'x.feature');
    expect(report.valid).toBe(false);
    expect(messagesOf(report)).toContain(VALIDATION_MESSAGES.FEATURE_NO_SCENARIOS);
  });

  it('errors when a scenario has no steps', async () => {
    const report = await validator.validateFeatureContent(
      `Feature: F
  Scenario: stepless
`,
      'x.feature'
    );
    expect(report.valid).toBe(false);
    expect(messagesOf(report)).toContain(VALIDATION_MESSAGES.SCENARIO_NO_STEPS);
  });

  it('errors when a scenario is missing Then', async () => {
    const report = await validator.validateFeatureContent(
      `Feature: F
  Scenario: no-then
    Given a
    When b
`,
      'x.feature'
    );
    expect(report.valid).toBe(false);
    expect(messagesOf(report)).toContain(VALIDATION_MESSAGES.SCENARIO_MISSING_GWT);
  });

  it('errors when a scenario is missing Given and When (And/But do not satisfy)', async () => {
    const report = await validator.validateFeatureContent(
      `Feature: F
  Scenario: then-only
    Then c
    And d
`,
      'x.feature'
    );
    expect(report.valid).toBe(false);
    expect(messagesOf(report)).toContain(VALIDATION_MESSAGES.SCENARIO_MISSING_GWT);
  });

  it('warns on duplicate scenario names', async () => {
    const report = await validator.validateFeatureContent(
      `Feature: F
  Scenario: dup
    Given a
    When b
    Then c
  Scenario: dup
    Given d
    When e
    Then f
`,
      'x.feature'
    );
    // Duplicate is a WARNING, so the feature is still valid.
    expect(report.valid).toBe(true);
    expect(report.summary.warnings).toBeGreaterThanOrEqual(1);
    expect(messagesOf(report).toLowerCase()).toContain('duplicate scenario');
  });

  it('emits INFO for a Scenario Outline without placeholder parameters', async () => {
    const report = await validator.validateFeatureContent(
      `Feature: F
  Scenario Outline: no-params
    Given a
    When b
    Then c
`,
      'x.feature'
    );
    expect(report.valid).toBe(true);
    expect(report.summary.info).toBeGreaterThanOrEqual(1);
  });
});

describe('Validator - validateFeatures(dir)', () => {
  let tempDir: string;
  const validator = new Validator();

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-vf-'));
  });
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('errors when no .feature files are found', async () => {
    const report = await validator.validateFeatures(path.join(tempDir, 'features'));
    expect(report.valid).toBe(false);
    expect(messagesOf(report).toLowerCase()).toContain('no .feature files');
  });

  it('aggregates valid feature files across capabilities', async () => {
    const dir = path.join(tempDir, 'features');
    await fs.mkdir(path.join(dir, 'auth'), { recursive: true });
    await fs.mkdir(path.join(dir, 'api'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'auth', 'login.feature'),
      'Feature: Login\n  Scenario: s\n    Given a\n    When b\n    Then c\n'
    );
    await fs.writeFile(
      path.join(dir, 'api', 'list.feature'),
      'Feature: List\n  Scenario: s\n    Given a\n    When b\n    Then c\n'
    );
    const report = await validator.validateFeatures(dir);
    expect(report.valid).toBe(true);
  });

  it('reports issues tagged with the offending file path', async () => {
    const dir = path.join(tempDir, 'features');
    await fs.mkdir(path.join(dir, 'auth'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'auth', 'broken.feature'),
      'Feature: Broken\n  Scenario: s\n    Given a\n    When b\n'
    );
    const report = await validator.validateFeatures(dir);
    expect(report.valid).toBe(false);
    expect(report.issues.some(i => i.path.includes('auth/broken.feature'))).toBe(true);
  });
});

describe('Validator - plan rules', () => {
  const validator = new Validator();

  const validPlan = `# Change

## Why
This change is needed to address an important and clearly described problem right now.

## What Changes
- Add the new capability

## Design
Implement it in a single module.

## Tasks
- [ ] 1.1 Implement the capability
`;

  it('passes a well-formed plan', async () => {
    const report = await validator.validatePlanContent(validPlan);
    expect(report.valid).toBe(true);
  });

  it('errors when ## Tasks is missing', async () => {
    const plan = `## Why
This change is needed to address an important and clearly described problem right now.

## What Changes
- Add the new capability

## Design
Implement it in a single module.
`;
    const report = await validator.validatePlanContent(plan);
    expect(report.valid).toBe(false);
    expect(messagesOf(report)).toContain(VALIDATION_MESSAGES.PLAN_MISSING_SECTIONS);
  });

  it('errors when ## Tasks has no checkbox', async () => {
    const plan = `## Why
This change is needed to address an important and clearly described problem right now.

## What Changes
- Add the new capability

## Design
Implement it in a single module.

## Tasks
Just prose, no checkboxes here.
`;
    const report = await validator.validatePlanContent(plan);
    expect(report.valid).toBe(false);
    expect(messagesOf(report)).toContain(VALIDATION_MESSAGES.PLAN_NO_TASKS);
  });

  it('errors when multiple sections are missing', async () => {
    const report = await validator.validatePlanContent('## Why\nshort\n');
    expect(report.valid).toBe(false);
    const msg = messagesOf(report);
    expect(msg).toContain(VALIDATION_MESSAGES.PLAN_MISSING_SECTIONS);
    expect(msg).toContain('## What Changes');
    expect(msg).toContain('## Design');
    expect(msg).toContain('## Tasks');
  });
});

describe('ValidateChange composition (features AND plan)', () => {
  let changeDir: string;
  const validator = new Validator();

  beforeEach(async () => {
    changeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-change-'));
  });
  afterEach(async () => {
    await fs.rm(changeDir, { recursive: true, force: true });
  });

  async function writeValidArtifacts() {
    const fdir = path.join(changeDir, 'features', 'auth');
    await fs.mkdir(fdir, { recursive: true });
    await fs.writeFile(
      path.join(fdir, 'login.feature'),
      'Feature: Login\n  Scenario: s\n    Given a\n    When b\n    Then c\n'
    );
    await fs.writeFile(
      path.join(changeDir, 'plan.md'),
      `## Why
This change is needed to address an important and clearly described problem right now.

## What Changes
- Add login

## Design
Single module.

## Tasks
- [ ] 1.1 Implement login
`
    );
  }

  it('a change with valid features and plan passes both sub-validations', async () => {
    await writeValidArtifacts();
    const features = await validator.validateFeatures(path.join(changeDir, 'features'));
    const plan = await validator.validatePlan(path.join(changeDir, 'plan.md'));
    expect(features.valid).toBe(true);
    expect(plan.valid).toBe(true);
  });

  it('a change with a feature missing Then fails feature validation', async () => {
    await writeValidArtifacts();
    await fs.writeFile(
      path.join(changeDir, 'features', 'auth', 'login.feature'),
      'Feature: Login\n  Scenario: s\n    Given a\n    When b\n'
    );
    const features = await validator.validateFeatures(path.join(changeDir, 'features'));
    expect(features.valid).toBe(false);
    expect(messagesOf(features)).toContain(VALIDATION_MESSAGES.SCENARIO_MISSING_GWT);
  });
});

describe('Validator - file IO and edge paths', () => {
  const validator = new Validator();
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-valid-io-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('validateFeatureFile returns an ERROR when the file cannot be read', async () => {
    const report = await validator.validateFeatureFile(path.join(dir, 'missing.feature'));
    expect(report.valid).toBe(false);
    expect(report.summary.errors).toBeGreaterThanOrEqual(1);
    expect(report.issues[0].path).toBe('file');
  });

  it('validateFeatureFile reads a real file and validates its content', async () => {
    const file = path.join(dir, 'ok.feature');
    await fs.writeFile(
      file,
      'Feature: F\n  Scenario: s\n    Given a\n    When b\n    Then c\n'
    );
    const report = await validator.validateFeatureFile(file);
    expect(report.valid).toBe(true);
  });

  it('validatePlan returns an ERROR when the plan file cannot be read', async () => {
    const report = await validator.validatePlan(path.join(dir, 'missing.md'));
    expect(report.valid).toBe(false);
    expect(report.issues[0].path).toBe('file');
  });

  it('warns when the Why section is too long', async () => {
    const longWhy = 'x'.repeat(1001);
    const plan = `# c\n\n## Why\n${longWhy}\n\n## What Changes\nstuff\n\n## Design\nd\n\n## Tasks\n- [ ] 1.1 do it\n`;
    const report = await validator.validatePlanContent(plan);
    expect(messagesOf(report)).toContain(VALIDATION_MESSAGES.CHANGE_WHY_TOO_LONG);
  });

  it('errors when the What Changes section is present but empty', async () => {
    const plan = `# c\n\n## Why\n${'reason '.repeat(10)}\n\n## What Changes\n\n## Design\nd\n\n## Tasks\n- [ ] 1.1 do it\n`;
    const report = await validator.validatePlanContent(plan);
    expect(report.valid).toBe(false);
    expect(messagesOf(report)).toContain(VALIDATION_MESSAGES.CHANGE_WHAT_EMPTY);
  });

  it('strict mode treats warnings as invalid; isValid mirrors report.valid', async () => {
    const strict = new Validator(true);
    // A valid feature but with a duplicate scenario name (WARNING only).
    const content =
      'Feature: F\n' +
      '  Scenario: dup\n    Given a\n    When b\n    Then c\n' +
      '  Scenario: dup\n    Given a\n    When b\n    Then c\n';
    const report = await strict.validateFeatureContent(content);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBeGreaterThanOrEqual(1);
    expect(report.valid).toBe(false);
    expect(strict.isValid(report)).toBe(false);
  });
});
