import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { InitCommand } from '../../src/core/init.js';
import {
  ISSUE_RECONCILIATION_STEP,
  CLOSE_CLAIM_RULES,
  STOP_AND_SURFACE_GUARDRAIL,
} from '../../src/core/templates/workflows/scope-reconciliation.js';

/**
 * Issue #100's acceptance criteria require the hardened prose to be present in
 * BOTH `.claude/skills/<name>/SKILL.md` and `.opencode/skills/<name>/SKILL.md`.
 *
 * Those trees are gitignored here — they are GENERATED into a consuming project
 * by `ratchet init` from the workflow template modules. So the "both trees"
 * clause is proven the only way it can be honestly proven: by running `init` and
 * reading what it wrote, never by hand-editing a generated tree (which the next
 * regeneration would revert).
 */

const { confirmMock, selectMock, showWelcomeScreenMock, searchableMultiSelectMock, runDoctorAdvisoryMock } =
  vi.hoisted(() => ({
    confirmMock: vi.fn(),
    selectMock: vi.fn(),
    showWelcomeScreenMock: vi.fn().mockResolvedValue(undefined),
    searchableMultiSelectMock: vi.fn(),
    runDoctorAdvisoryMock: vi.fn(),
  }));

vi.mock('../../src/commands/doctor.js', () => ({
  runDoctorAdvisory: runDoctorAdvisoryMock,
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: confirmMock,
  select: selectMock,
}));

vi.mock('../../src/ui/welcome-screen.js', () => ({
  showWelcomeScreen: showWelcomeScreenMock,
}));

vi.mock('../../src/prompts/searchable-multi-select.js', () => ({
  searchableMultiSelect: searchableMultiSelectMock,
}));

/** The three change-authoring skills the reconciliation hardening covers. */
const HARDENED_SKILLS = ['ratchet-propose', 'ratchet-propose-batch', 'ratchet-decompose-phase'] as const;

/** Every agent tree `init` must render the hardened prose into. */
const TREES = ['.claude', '.opencode'] as const;

describe('init renders the scope-reconciliation hardening into every agent tree', () => {
  let testDir: string;
  let configTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-init-recon-test-'));
    originalEnv = { ...process.env };
    configTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-config-init-recon-'));
    process.env.XDG_CONFIG_HOME = configTempDir;

    vi.spyOn(console, 'log').mockImplementation(() => { });
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    selectMock.mockReset();
    selectMock.mockResolvedValue('repo-sandboxed-permissive');
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();

    await new InitCommand({ tools: 'claude,opencode', force: true }).execute(testDir);
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await fs.rm(configTempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    vi.restoreAllMocks();
  });

  const read = (tree: string, skill: string): Promise<string> =>
    fs.readFile(path.join(testDir, tree, 'skills', skill, 'SKILL.md'), 'utf-8');

  const cases = TREES.flatMap((tree) => HARDENED_SKILLS.map((skill) => [tree, skill] as const));

  it.each(cases)('%s/skills/%s/SKILL.md carries the stop-and-surface guardrail', async (tree, skill) => {
    // Criterion 5: all three skills, both trees.
    expect(await read(tree, skill)).toContain(STOP_AND_SURFACE_GUARDRAIL);
  });

  it.each(cases)('%s/skills/%s/SKILL.md carries the close-claim rule', async (tree, skill) => {
    expect(await read(tree, skill)).toContain(CLOSE_CLAIM_RULES);
  });

  const reconciliationCases = TREES.flatMap((tree) =>
    (['ratchet-propose', 'ratchet-propose-batch'] as const).map((skill) => [tree, skill] as const)
  );

  it.each(reconciliationCases)(
    '%s/skills/%s/SKILL.md carries the originating-issue reconciliation step',
    async (tree, skill) => {
      // Criterion 1: the reconciliation step in propose and propose-batch, both trees.
      expect(await read(tree, skill)).toContain(ISSUE_RECONCILIATION_STEP);
    }
  );

  it.each(TREES)('%s/skills/ratchet-propose-batch/SKILL.md forbids a premature close-claim', async (tree) => {
    // Criterion 2.
    const content = await read(tree, 'ratchet-propose-batch');
    expect(content).toMatch(/no premature close-claims in the manifest/i);
    expect(content).toContain('**"targets #N"**');
    expect(content).toContain('**"partially addresses #N"**');
  });

  it.each(TREES)('%s/skills/ratchet-decompose-phase/SKILL.md carries the deferral sweep', async (tree) => {
    // Criteria 3 and 4.
    const content = await read(tree, 'ratchet-decompose-phase');
    expect(content).toMatch(/extract every deferred item recorded in those plans/i);
    expect(content).toMatch(/Silently ignoring an extracted item is not an available outcome/i);
    expect(content).toMatch(/close-claim was earned before treating an issue as/i);
  });

  it('renders both trees content-identically apart from slash-command naming', async () => {
    // The two trees are generated from the same template body, so they may
    // differ ONLY in how each agent spells a slash command (`/rct:apply` vs
    // `/rct-apply`). Normalising that one documented difference away, the files
    // must be byte-identical — any other divergence is the drift this change
    // exists to prevent.
    const normalise = (content: string): string => content.replace(/\/rct[:-]/g, '/rct:');

    for (const skill of HARDENED_SKILLS) {
      const [claude, opencode] = await Promise.all([read('.claude', skill), read('.opencode', skill)]);
      expect(normalise(claude), skill).toBe(normalise(opencode));
    }
  });
});
