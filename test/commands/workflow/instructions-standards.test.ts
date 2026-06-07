import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateApplyInstructions } from '../../../src/commands/workflow/instructions.js';
import { resolveCurrentPlanningHomeSync, getChangeDir } from '../../../src/core/planning-home.js';

const STANDARD_MARKER = 'INPUT_VALIDATION_IS_REQUIRED';

describe('apply instructions and standards', () => {
  let tempDir: string;
  const changeName = 'my-change';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-apply-standards-'));

    // A standards library with distinctive content
    const standardsDir = path.join(tempDir, '.ratchet', 'standards');
    fs.mkdirSync(standardsDir, { recursive: true });
    fs.writeFileSync(
      path.join(standardsDir, 'security.md'),
      `# Security\n\n${STANDARD_MARKER}\n`
    );

    // A minimal change with the required artifacts
    const changeDir = path.join(tempDir, '.ratchet', 'changes', changeName);
    fs.mkdirSync(path.join(changeDir, 'features', 'auth'), { recursive: true });
    fs.writeFileSync(
      path.join(changeDir, 'features', 'auth', 'login.feature'),
      'Feature: Login\n  Scenario: works\n    Given a user\n    When they log in\n    Then it works\n'
    );
    fs.writeFileSync(
      path.join(changeDir, 'plan.md'),
      '# my-change\n\n## Tasks\n\n- [ ] 1.1 Do the thing\n'
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not carry standards in the apply payload', async () => {
    const planningHome = resolveCurrentPlanningHomeSync({ startPath: tempDir });
    const instructions = await generateApplyInstructions(
      tempDir,
      changeName,
      undefined,
      planningHome
    );

    // Apply must not depend on standards: the plan already embedded them.
    expect('standards' in instructions).toBe(false);
    expect(JSON.stringify(instructions)).not.toContain(STANDARD_MARKER);

    // Sanity: the change really does resolve under this planning home.
    expect(instructions.changeDir).toBe(getChangeDir(planningHome, changeName));
  });
});
