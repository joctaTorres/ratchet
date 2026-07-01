/**
 * Integration tests for the remaining untested instructions paths.
 *
 * Implements features/workflow-command-tests/instructions.feature: the artifact-
 * and apply-instruction surfaces of the workflow group over an isolated tmpdir
 * fixture repo with `resolveCurrentPlanningHomeSync` pointed at the fixture root —
 * `instructionsCommand` (ready artifact JSON, missing-argument, unknown-artifact,
 * blocked warning), the `blocked` / `all_done` branches of
 * `generateApplyInstructions`, `applyInstructionsCommand` (apply JSON), and
 * `printApplyInstructionsText` (blocked banner + progress + tasks).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { makeCommandFixture, type CommandFixture } from '../change-fixture.js';
import { resolveArtifactOutputs } from '../../../src/core/artifact-graph/outputs.js';
import { enumerateEvalSet } from '../../../src/core/eval/set.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/core/planning-home.js')>();
  return { ...actual, resolveCurrentPlanningHomeSync: resolvePlanningHomeMock };
});

import {
  instructionsCommand,
  applyInstructionsCommand,
  generateApplyInstructions,
  printApplyInstructionsText,
} from '../../../src/commands/workflow/instructions.js';
import type { ApplyInstructions } from '../../../src/commands/workflow/shared.js';

function planningHomeFor(root: string) {
  return {
    kind: 'repo' as const,
    root,
    changesDir: path.join(root, '.ratchet', 'changes'),
    batchesDir: path.join(root, '.ratchet', 'batches'),
    defaultSchema: 'ratchet',
  };
}

/**
 * Scaffold a project-local schema (`.ratchet/schemas/<name>/`) with the given
 * `schema.yaml` body and one template per artifact, so apply-instruction paths
 * that depend on non-`ratchet` apply blocks (a separate tracks file, or no
 * tracking at all) can be exercised over the fixture.
 */
async function writeProjectSchema(
  root: string,
  name: string,
  schemaYaml: string,
  templates: Record<string, string>
): Promise<void> {
  const dir = path.join(root, '.ratchet', 'schemas', name);
  await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
  await fs.writeFile(path.join(dir, 'schema.yaml'), schemaYaml, 'utf-8');
  for (const [file, body] of Object.entries(templates)) {
    await fs.writeFile(path.join(dir, 'templates', file), body, 'utf-8');
  }
}

describe('instructionsCommand', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue(planningHomeFor(fixture.root));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('emits artifact JSON for an artifact whose dependencies are satisfied', async () => {
    // writeValidChange writes a feature on disk, so the `plan` artifact's
    // `features` dependency is satisfied (ready, not blocked).
    await fixture.writeValidChange('ready-change');

    await instructionsCommand('plan', { change: 'ready-change', json: true });

    const parsed = JSON.parse(output()) as { artifactId: string; changeName: string };
    expect(parsed.artifactId).toBe('plan');
    expect(parsed.changeName).toBe('ready-change');
  });

  it('rejects a missing artifact argument by listing the valid artifact ids', async () => {
    await fixture.writeMetadata('a-change');

    await expect(
      instructionsCommand(undefined, { change: 'a-change', json: true })
    ).rejects.toThrow(/Missing required argument <artifact>[\s\S]*features[\s\S]*plan/);
  });

  it('rejects an unknown artifact by listing the valid artifact ids', async () => {
    await fixture.writeMetadata('a-change');

    await expect(
      instructionsCommand('bogus', { change: 'a-change', json: true })
    ).rejects.toThrow(/Artifact 'bogus' not found[\s\S]*features[\s\S]*plan/);
  });

  it('warns when a blocked artifact is printed as text, naming the missing dependency', async () => {
    // No feature on disk: the `plan` artifact's `features` dependency is missing.
    await fixture.writeMetadata('blocked-change');

    await instructionsCommand('plan', { change: 'blocked-change' });

    const text = output();
    expect(text).toContain('<warning>');
    expect(text).toContain('Missing: features');
  });

  it('embeds project context and artifact rules and lists what the artifact unlocks', async () => {
    await fixture.writeMetadata('rich-change');
    // Project config supplies <project_context> and per-artifact <rules>; the
    // `features` artifact unlocks `plan`, so the <unlocks> block also renders.
    await fs.writeFile(
      path.join(fixture.root, '.ratchet', 'config.yaml'),
      [
        'context: |',
        '  Background for the assistant only.',
        'rules:',
        '  features:',
        '    - Keep scenarios small.',
        '',
      ].join('\n'),
      'utf-8'
    );

    // An explicit, valid --schema also exercises the schema-existence check.
    await instructionsCommand('features', { change: 'rich-change', schema: 'ratchet' });

    const text = output();
    expect(text).toContain('<project_context>');
    expect(text).toContain('Background for the assistant only.');
    expect(text).toContain('<rules>');
    expect(text).toContain('- Keep scenarios small.');
    expect(text).toContain('<unlocks>');
    expect(text).toContain('Completing this artifact enables: plan');
  });

  it('rejects an explicit --schema that does not exist', async () => {
    await fixture.writeMetadata('a-change');

    await expect(
      instructionsCommand('features', { change: 'a-change', schema: 'nope-not-a-schema' })
    ).rejects.toThrow(/Schema 'nope-not-a-schema' not found/);
  });

  it('embeds the project standards library into the artifact text', async () => {
    await fixture.writeMetadata('std-change');
    const stdDir = path.join(fixture.root, '.ratchet', 'standards');
    await fs.mkdir(stdDir, { recursive: true });
    await fs.writeFile(
      path.join(stdDir, 'testing.md'),
      ['---', 'tag: testing', '---', '# Testing', 'Always isolate fixtures.', ''].join('\n'),
      'utf-8'
    );

    await instructionsCommand('features', { change: 'std-change' });

    const text = output();
    expect(text).toContain('<standards>');
    expect(text).toContain('tag="testing"');
    expect(text).toContain('Always isolate fixtures.');
    expect(text).toContain('</standards>');
  });
});

describe('generateApplyInstructions', () => {
  let fixture: CommandFixture;

  beforeEach(async () => {
    fixture = await makeCommandFixture();
    resolvePlanningHomeMock.mockReturnValue(planningHomeFor(fixture.root));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  it('reports blocked when required artifacts are missing', async () => {
    await fixture.writeMetadata('no-plan'); // change exists, but no plan.md

    const instructions = await generateApplyInstructions(
      fixture.root,
      'no-plan',
      undefined,
      planningHomeFor(fixture.root)
    );

    expect(instructions.state).toBe('blocked');
    expect(instructions.missingArtifacts).toContain('plan');
  });

  it('reports all_done when every task is checked', async () => {
    await fixture.writeChangeWithTasks('finished', { done: 3, total: 3 });
    await fixture.writeMetadata('finished');

    const instructions = await generateApplyInstructions(
      fixture.root,
      'finished',
      undefined,
      planningHomeFor(fixture.root)
    );

    expect(instructions.state).toBe('all_done');
    expect(instructions.progress.total).toBe(3);
    expect(instructions.progress.complete).toBe(3);
    expect(instructions.progress.remaining).toBe(0);
  });

  it('reports blocked when the tracked plan exists but contains no tasks', async () => {
    // plan.md present (so the `plan` artifact is satisfied) but with zero
    // checkboxes: the tracks file exists yet has no tasks.
    await fixture.writePlan('empty-plan', '# change\n\nNo task checkboxes here.\n');
    await fixture.writeMetadata('empty-plan');

    const instructions = await generateApplyInstructions(
      fixture.root,
      'empty-plan',
      undefined,
      planningHomeFor(fixture.root)
    );

    expect(instructions.state).toBe('blocked');
    expect(instructions.progress.total).toBe(0);
    expect(instructions.instruction).toContain('contains no tasks');
  });

  it('reports blocked when the required artifact exists but its tracks file is missing', async () => {
    // Custom schema: the required artifact (`spec` → spec.md) and the tracking
    // file (tasks.md) are different files, so a present artifact + absent tracks
    // file exercises the "tracking file missing" branch.
    await writeProjectSchema(
      fixture.root,
      'tracked',
      [
        'name: tracked',
        'version: 1',
        'artifacts:',
        '  - id: spec',
        '    generates: spec.md',
        '    description: The spec',
        '    template: spec.md',
        'apply:',
        '  requires: [spec]',
        '  tracks: tasks.md',
        '',
      ].join('\n'),
      { 'spec.md': '# spec template\n' }
    );
    const dir = await fixture.makeChange('needs-tracks');
    await fs.writeFile(path.join(dir, 'spec.md'), '# done spec\n', 'utf-8');
    await fixture.writeMetadata('needs-tracks', 'schema: tracked\n');

    const instructions = await generateApplyInstructions(
      fixture.root,
      'needs-tracks',
      undefined,
      planningHomeFor(fixture.root)
    );

    expect(instructions.state).toBe('blocked');
    expect(instructions.instruction).toContain('tasks.md');
    expect(instructions.instruction).toContain('missing');
  });

  it('reports ready with the schema instruction when the schema configures no tracking file', async () => {
    // Custom schema with an apply block but no `tracks`: once the required
    // artifact exists, apply is ready and the schema instruction is surfaced.
    await writeProjectSchema(
      fixture.root,
      'untracked',
      [
        'name: untracked',
        'version: 1',
        'artifacts:',
        '  - id: spec',
        '    generates: spec.md',
        '    description: The spec',
        '    template: spec.md',
        'apply:',
        '  requires: [spec]',
        '  instruction: Just build it.',
        '',
      ].join('\n'),
      { 'spec.md': '# spec template\n' }
    );
    const dir = await fixture.makeChange('no-tracks');
    await fs.writeFile(path.join(dir, 'spec.md'), '# done spec\n', 'utf-8');
    await fixture.writeMetadata('no-tracks', 'schema: untracked\n');

    const instructions = await generateApplyInstructions(
      fixture.root,
      'no-tracks',
      undefined,
      planningHomeFor(fixture.root)
    );

    expect(instructions.state).toBe('ready');
    expect(instructions.progress.total).toBe(0);
    expect(instructions.instruction).toBe('Just build it.');
  });

  const HELD_OUT_FEATURE = [
    'Feature: Sample',
    '  @holdout',
    '  Scenario: Held out scenario',
    '    Given a secret precondition',
    '    Then a secret outcome',
    '',
    '  Scenario: Kept scenario',
    '    Given a precondition',
    '    Then an outcome',
    '',
  ].join('\n');

  it('materializes a filtered .feature context file that strips the @holdout Scenario', async () => {
    const dir = await fixture.writeChangeWithTasks('holdout-apply', { done: 0, total: 1 });
    await fs.mkdir(path.join(dir, 'features', 'sample'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'features', 'sample', 'sample.feature'),
      HELD_OUT_FEATURE,
      'utf-8'
    );
    await fixture.writeMetadata('holdout-apply');

    const instructions = await generateApplyInstructions(
      fixture.root,
      'holdout-apply',
      undefined,
      planningHomeFor(fixture.root)
    );

    const rawOutputs = resolveArtifactOutputs(dir, 'features/**/*.feature');
    const materializedOutputs = instructions.contextFiles.features;

    expect(materializedOutputs).toHaveLength(1);
    expect(materializedOutputs[0]).not.toBe(rawOutputs[0]);

    const materializedContent = await fs.readFile(materializedOutputs[0], 'utf-8');
    expect(materializedContent).toContain('Kept scenario');
    expect(materializedContent).not.toContain('Held out scenario');
    expect(materializedContent).not.toContain('secret precondition');

    // The plan.md entry is unaffected — no `.apply-context` indirection.
    expect(instructions.contextFiles.plan[0]).toBe(resolveArtifactOutputs(dir, 'plan.md')[0]);

    // The raw source .feature file itself is untouched on disk.
    const sourceContent = await fs.readFile(
      path.join(dir, 'features', 'sample', 'sample.feature'),
      'utf-8'
    );
    expect(sourceContent).toBe(HELD_OUT_FEATURE);
  });

  it('materializes contextFiles content-equivalent to source when no Scenario is held out', async () => {
    const dir = await fixture.writeValidChange('no-holdout-apply');

    const instructions = await generateApplyInstructions(
      fixture.root,
      'no-holdout-apply',
      undefined,
      planningHomeFor(fixture.root)
    );

    const sourceContent = await fs.readFile(
      path.join(dir, 'features', 'sample', 'sample.feature'),
      'utf-8'
    );
    const materializedContent = await fs.readFile(instructions.contextFiles.features[0], 'utf-8');
    expect(materializedContent).toBe(sourceContent);
  });

  it('still enumerates and gates the held-out case as an ordinary eval case', async () => {
    const dir = await fixture.writeChangeWithTasks('holdout-eval-set', { done: 0, total: 1 });
    await fs.mkdir(path.join(dir, 'features', 'sample'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'features', 'sample', 'sample.feature'),
      HELD_OUT_FEATURE,
      'utf-8'
    );
    await fixture.writeMetadata('holdout-eval-set');

    // Regression: materializing the apply-time context must not affect
    // enumerateEvalSet, which reads the real source .feature file directly.
    await generateApplyInstructions(
      fixture.root,
      'holdout-eval-set',
      undefined,
      planningHomeFor(fixture.root)
    );

    const cases = enumerateEvalSet(fixture.root, { kind: 'change', target: 'holdout-eval-set' });
    const heldOut = cases.find((c) => c.scenario === 'Held out scenario');
    const kept = cases.find((c) => c.scenario === 'Kept scenario');

    expect(cases).toHaveLength(2);
    expect(heldOut?.tags).toContain('@holdout');
    expect(kept).toBeDefined();
  });
});

describe('applyInstructionsCommand', () => {
  let fixture: CommandFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue(planningHomeFor(fixture.root));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('emits apply JSON carrying the instructions and pending tasks for a ready change', async () => {
    await fixture.writeChangeWithTasks('ready-apply', { done: 0, total: 2 });
    await fixture.writeMetadata('ready-apply');

    await applyInstructionsCommand({ change: 'ready-apply', json: true });

    const parsed = JSON.parse(output()) as ApplyInstructions;
    expect(parsed.state).toBe('ready');
    expect(parsed.changeName).toBe('ready-apply');
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.progress.remaining).toBe(2);
  });

  it('renders apply instructions as text and validates an explicit --schema', async () => {
    await fixture.writeChangeWithTasks('text-apply', { done: 1, total: 2 });
    await fixture.writeMetadata('text-apply');

    // No `json` flag → the text printer runs; a valid `schema` exercises the
    // schema-existence check in the apply command.
    await applyInstructionsCommand({ change: 'text-apply', schema: 'ratchet' });

    const text = output();
    expect(text).toContain('## Apply: text-apply');
    expect(text).toContain('### Tasks');
    expect(text).toContain('1/2 complete');
  });

  it('rejects an explicit --schema that does not exist', async () => {
    await fixture.writeChangeWithTasks('bad-schema', { done: 0, total: 1 });
    await fixture.writeMetadata('bad-schema');

    await expect(
      applyInstructionsCommand({ change: 'bad-schema', schema: 'nope-not-a-schema' })
    ).rejects.toThrow(/Schema 'nope-not-a-schema' not found/);
  });
});

describe('printApplyInstructionsText', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('renders the blocked banner and missing artifacts for a blocked snapshot', () => {
    const blocked: ApplyInstructions = {
      changeName: 'blocked-demo',
      changeDir: '/tmp/blocked-demo',
      schemaName: 'ratchet',
      contextFiles: {},
      progress: { total: 0, complete: 0, remaining: 0 },
      tasks: [],
      state: 'blocked',
      missingArtifacts: ['plan'],
      instruction: 'Cannot apply yet.',
    };

    printApplyInstructionsText(blocked);

    const text = output();
    expect(text).toContain('## Apply: blocked-demo');
    expect(text).toContain('### ⚠️ Blocked');
    expect(text).toContain('Missing artifacts: plan');
  });

  it('renders context files, progress, and the task list for a ready snapshot', () => {
    const ready: ApplyInstructions = {
      changeName: 'ready-demo',
      changeDir: '/tmp/ready-demo',
      schemaName: 'ratchet',
      contextFiles: { plan: ['/tmp/ready-demo/plan.md'] },
      progress: { total: 2, complete: 1, remaining: 1 },
      tasks: [
        { id: '1', description: 'first task', done: true },
        { id: '2', description: 'second task', done: false },
      ],
      state: 'ready',
      instruction: 'Work through the pending tasks.',
    };

    printApplyInstructionsText(ready);

    const text = output();
    expect(text).toContain('### Context Files');
    expect(text).toContain('- plan: /tmp/ready-demo/plan.md');
    expect(text).toContain('### Progress');
    expect(text).toContain('1/2 complete');
    expect(text).toContain('### Tasks');
    expect(text).toContain('- [x] first task');
    expect(text).toContain('- [ ] second task');
  });

  it('marks progress complete with a check for an all_done snapshot', () => {
    const allDone: ApplyInstructions = {
      changeName: 'done-demo',
      changeDir: '/tmp/done-demo',
      schemaName: 'ratchet',
      contextFiles: {},
      progress: { total: 2, complete: 2, remaining: 0 },
      tasks: [
        { id: '1', description: 'first task', done: true },
        { id: '2', description: 'second task', done: true },
      ],
      state: 'all_done',
      instruction: 'All tasks are complete!',
    };

    printApplyInstructionsText(allDone);

    const text = output();
    expect(text).toContain('### Progress');
    expect(text).toContain('2/2 complete ✓');
    expect(text).toContain('All tasks are complete!');
  });
});
