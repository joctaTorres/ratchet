/**
 * Stacked PR grouping modes e2e — the Phase 3 blackbox proof-of-work.
 *
 * Implements features/stacked-pr-grouping/grouping-modes-e2e.feature.
 *
 * Drives the compiled `dist/cli/index.js` via `runCLI` over isolated git-repo
 * fixtures and proves the ONE thing only the top layer can: that the user-visible
 * `batch apply` loop, running the bundled engine over a real repo, opens one
 * stacked PR per group under `prGrouping: per-phase` / `per-change` — with the
 * expected stacked base (group 0 → the batch base branch, group N → group N-1's
 * branch) — and never a duplicate on a resumed loop. The lower layers already
 * prove boundary ordering (`test/batch-engine/boundary-detection.test.ts`),
 * stacked-base mapping (`test/batch-engine/*stacked*`), per-boundary
 * spawn/idempotency/failure (`test/batch-engine/engine-spawn-at-boundaries.test.ts`),
 * and `batch apply` selection/routing (`test/commands/batch/apply.test.ts`); this
 * does not re-test them — it asserts observable output, exit codes, and real
 * on-disk side effects (the PR-open sentinel, run-state journal entries), never
 * internal state.
 *
 * The fake spawn seam is the existing `RATCHET_BATCH_AGENT_CMD` override (no new
 * production seam): `runCLI` forwards `env`, the engine routes every spawn through
 * `bash -c "$RATCHET_BATCH_AGENT_CMD"` feeding the step instructions on stdin, and
 * the bundled ReX-local runtime executes it. The fake PR agent is forge-agnostic —
 * it acts ONLY on instructions that delegate to `/rct:open-pr`, parses the handed
 * `Work branch:` / `Base branch:` Input lines and the per-group report key from
 * the `ratchet batch report … --change pr:<batch>:<groupId>` line, appends one
 * sentinel line (`pr-open group=<key> work=… base=…`) — proving the delegation,
 * the injected stacked base, and the per-group completion channel in one
 * observable artifact — and reports completion through that exact key. It invokes
 * no `gh`/`glab` and hard-codes no forge, mirroring the real `/rct:open-pr`
 * body's ecosystem-neutrality.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import { existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI, cliProjectRoot, type RunCLIResult } from '../helpers/run-cli.js';
import { BatchFixture } from '../commands/batch/batch-fixture.js';
import { readJournal } from '../../src/core/batch/journal.js';

const CLI_ENTRY = path.join(cliProjectRoot, 'dist', 'cli', 'index.js');
const NODE = process.execPath;

const BATCH = 'b';
const BASE_BRANCH = 'main';
const DONE_MESSAGE = 'Nothing to do — all changes are done.';
const APPLY_TIMEOUT = 120000;

const tempRoots: string[] = [];

/** Run a git command in `cwd`, throwing on failure (fixture setup only). */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

/**
 * The two batch shapes the stacked modes are proven over. The default
 * `groupBranch` resolver names each group's branch after its `groupId`, so the
 * expected work branches are exactly the phase/change names and the expected
 * bases are `main` then the previous group's id — the stacked-branch base rule
 * observed end to end.
 *
 * - `per-phase`: phases `p1`/`p2` × one done change each → groups `p1`, `p2`.
 * - `per-change`: one phase × done changes `c1`/`c2` → groups `c1`, `c2`.
 */
type StackedMode = 'per-phase' | 'per-change';

const SHAPES: Record<
  StackedMode,
  { phases: { name: string; changes: string[] }[]; groups: string[] }
> = {
  'per-phase': {
    phases: [
      { name: 'p1', changes: ['c1'] },
      { name: 'p2', changes: ['c2'] },
    ],
    groups: ['p1', 'p2'],
  },
  'per-change': {
    phases: [{ name: 'p1', changes: ['c1', 'c2'] }],
    groups: ['c1', 'c2'],
  },
};

/**
 * Build an isolated project: a git repo whose history follows semantic /
 * Conventional Commits, a configured `origin` remote whose HEAD names `main` (so
 * `resolveBranches` derives the batch base branch from the remote), and a
 * completed batch — every change's tasks checked, verify journaled, and every
 * phase's boundary proof recorded passing — seeded via the run-state/journal
 * helpers so `batch status` resolves `done` and `batch apply` reaches the
 * stacked PR tail. Returns the project root (the CLI's cwd) and a per-project
 * sentinel path.
 */
async function prepareCompletedRepo(
  mode: StackedMode
): Promise<{ projectDir: string; sentinel: string }> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-pr-grouping-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');
  await fs.mkdir(path.join(projectDir, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(projectDir, '.ratchet', 'batches'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, '.ratchet', 'config.yaml'),
    'schema: ratchet\n',
    'utf-8'
  );

  const shape = SHAPES[mode];
  const fixture = new BatchFixture(projectDir);
  await fixture.writeBatch(BATCH, {
    settings: { prGrouping: mode },
    phases: shape.phases.map((phase) => ({
      name: phase.name,
      goal: 'ship',
      success: 'works',
      changes: phase.changes.map((name) => ({ name })),
    })),
  });
  for (const phase of shape.phases) {
    for (const change of phase.changes) {
      await fixture.writeChangeWithTasks(change, { done: 1, total: 1 });
      fixture.completeVerify(BATCH, change);
    }
    fixture.passProof(BATCH, phase.name);
  }

  // A real git repo with a semantic history and an origin remote whose HEAD
  // names the base branch `main`.
  git(projectDir, ['init', '-q']);
  git(projectDir, ['config', 'user.email', 'ratchet-e2e@example.com']);
  git(projectDir, ['config', 'user.name', 'Ratchet E2E']);
  git(projectDir, ['config', 'commit.gpgsign', 'false']);
  git(projectDir, ['checkout', '-q', '-b', BASE_BRANCH]);
  await fs.writeFile(path.join(projectDir, 'README.md'), '# project\n', 'utf-8');
  git(projectDir, ['add', '-A']);
  git(projectDir, ['commit', '-q', '--no-verify', '-m', 'feat: initial project scaffold']);

  const originDir = path.join(base, 'origin.git');
  git(projectDir, ['init', '-q', '--bare', originDir]);
  git(projectDir, ['remote', 'add', 'origin', originDir]);
  git(projectDir, ['push', '-q', 'origin', BASE_BRANCH]);
  git(projectDir, ['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${BASE_BRANCH}`]);

  return { projectDir, sentinel: path.join(base, 'pr-open.sentinel') };
}

/**
 * The forge-agnostic fake PR agent, as a POSIX shell stand-in fed through
 * `RATCHET_BATCH_AGENT_CMD`. It reads the step instructions on stdin and acts
 * ONLY on a `/rct:open-pr` delegation (any other spawn is a no-op, so it cannot
 * inflate spawn counts). It parses the `Work branch:` / `Base branch:` Input
 * lines and the per-group report key (`pr:<batch>:<groupId>`) from the
 * `ratchet batch report … --change <key>` line the instructions carry, appends
 * one sentinel line capturing all three, and reports completion through that
 * exact key. Git only — no forge CLI, no hard-coded forge.
 */
function prAgentOverride(sentinel: string): string {
  return [
    'instr="$(cat)"',
    'case "$instr" in',
    '  */rct:open-pr*)',
    // Parse the work/base branch from the instruction "Input" the CLI delivered
    // and the per-group report key from the report-channel line.
    '    work="$(printf %s "$instr" | sed -n "s/.*Work branch: \\([^ ]*\\).*/\\1/p" | head -n1)";',
    '    base="$(printf %s "$instr" | sed -n "s/.*Base branch: \\([^ ]*\\).*/\\1/p" | head -n1)";',
    '    key="$(printf %s "$instr" | sed -n "s/.*--change \\(pr:[^ ]*\\).*/\\1/p" | head -n1)";',
    `    printf 'pr-open group=%s work=%s base=%s\\n' "$key" "$work" "$base" >> ${JSON.stringify(sentinel)};`,
    `    ${JSON.stringify(NODE)} ${JSON.stringify(CLI_ENTRY)} batch report ${BATCH} --change "$key" --complete "opened the stacked PR" >/dev/null 2>&1;`,
    '    ;;',
    '  *) : ;;',
    'esac',
  ].join('\n');
}

/** The PR-open actions the fake agent recorded, in order (sentinel lines). */
function prOpenActions(sentinel: string): string[] {
  if (!existsSync(sentinel)) return [];
  return readFileSync(sentinel, 'utf-8').split('\n').filter((l) => l.trim().length > 0);
}

/** One `batch apply` invocation against the fake spawn seam. */
async function applyOnce(projectDir: string, sentinel: string): Promise<RunCLIResult> {
  return runCLI(['--no-color', 'batch', 'apply', BATCH], {
    cwd: projectDir,
    env: { RATCHET_BATCH_AGENT_CMD: prAgentOverride(sentinel) },
    timeoutMs: APPLY_TIMEOUT,
  });
}

/**
 * Loop `batch apply` until it reports nothing to do (bounded to groups + 2
 * iterations). Every invocation is a fresh stateless process reading run-state,
 * so each iteration IS a resumed loop — "resume" and "next iteration" are the
 * same mechanism.
 */
async function applyUntilDone(
  projectDir: string,
  sentinel: string,
  maxRuns: number
): Promise<RunCLIResult[]> {
  const results: RunCLIResult[] = [];
  for (let i = 0; i < maxRuns; i++) {
    const result = await applyOnce(projectDir, sentinel);
    results.push(result);
    if (`${result.stdout}${result.stderr}`.includes(DONE_MESSAGE)) return results;
  }
  throw new Error(`batch apply never reported "${DONE_MESSAGE}" within ${maxRuns} runs`);
}

/** The journal's `pr` completion entries recorded under `key`, for idempotency. */
function prCompletions(projectDir: string, key: string) {
  return readJournal(projectDir, BATCH).filter(
    (e) => e.kind === 'completion' && e.transition === 'pr' && e.change === key
  );
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('stacked PR grouping modes — batch apply e2e against the fake spawn seam', () => {
  it('per-phase opens one stacked PR per completed phase, based on the previous phase branch', async () => {
    const { projectDir, sentinel } = await prepareCompletedRepo('per-phase');

    const results = await applyUntilDone(projectDir, sentinel, 4);

    // Every apply invocation exits 0; the loop terminated on the done message.
    for (const result of results) expect(result.exitCode).toBe(0);

    // Exactly two PR-open actions, in boundary order, each carrying the stacked
    // base rule: group 0 (`p1`) targets the batch base branch `main`, group 1
    // (`p2`) targets group 0's own branch `p1`. The sentinel line's values are
    // parsed from the delegated `/rct:open-pr` instructions (Input lines + the
    // per-group report channel), so it also proves the delegation and the
    // `pr:b:<groupId>` completion channel in one artifact.
    expect(prOpenActions(sentinel)).toEqual([
      `pr-open group=pr:${BATCH}:p1 work=p1 base=${BASE_BRANCH}`,
      `pr-open group=pr:${BATCH}:p2 work=p2 base=p1`,
    ]);

    // Run-state carries exactly one pr completion per group key.
    expect(prCompletions(projectDir, `pr:${BATCH}:p1`)).toHaveLength(1);
    expect(prCompletions(projectDir, `pr:${BATCH}:p2`)).toHaveLength(1);
  }, 600000);

  it('per-change opens one stacked PR per change, based on the previous change branch', async () => {
    const { projectDir, sentinel } = await prepareCompletedRepo('per-change');

    const results = await applyUntilDone(projectDir, sentinel, 4);
    for (const result of results) expect(result.exitCode).toBe(0);

    // One stacked PR per change: `c1` → `main`, then `c2` → `c1`.
    expect(prOpenActions(sentinel)).toEqual([
      `pr-open group=pr:${BATCH}:c1 work=c1 base=${BASE_BRANCH}`,
      `pr-open group=pr:${BATCH}:c2 work=c2 base=c1`,
    ]);

    expect(prCompletions(projectDir, `pr:${BATCH}:c1`)).toHaveLength(1);
    expect(prCompletions(projectDir, `pr:${BATCH}:c2`)).toHaveLength(1);
  }, 600000);

  it('a loop resumed after the first group opens only the remaining group', async () => {
    const { projectDir, sentinel } = await prepareCompletedRepo('per-phase');

    // The first apply opens the first group's PR exactly once.
    const first = await applyOnce(projectDir, sentinel);
    expect(first.exitCode).toBe(0);
    expect(prOpenActions(sentinel)).toEqual([
      `pr-open group=pr:${BATCH}:p1 work=p1 base=${BASE_BRANCH}`,
    ]);

    // The resumed run (a fresh stateless process reading run-state) spawns a PR
    // agent only for the remaining `p2` group; `p1`'s action stays recorded
    // exactly once and the total is exactly two.
    const second = await applyOnce(projectDir, sentinel);
    expect(second.exitCode).toBe(0);
    expect(prOpenActions(sentinel)).toEqual([
      `pr-open group=pr:${BATCH}:p1 work=p1 base=${BASE_BRANCH}`,
      `pr-open group=pr:${BATCH}:p2 work=p2 base=p1`,
    ]);
  }, 600000);

  it('re-running the fully-opened loop never double-opens any group', async () => {
    const { projectDir, sentinel } = await prepareCompletedRepo('per-change');

    // Prior apply runs open every group's stacked PR.
    await applyUntilDone(projectDir, sentinel, 4);
    const opened = prOpenActions(sentinel);
    expect(opened).toHaveLength(2);

    // One more apply on the fully-opened batch: no additional spawn, recorded
    // actions unchanged, the unchanged done message, exit 0 — and the journal's
    // total pr completions equal the group count exactly.
    const rerun = await applyOnce(projectDir, sentinel);
    expect(rerun.exitCode).toBe(0);
    expect(`${rerun.stdout}${rerun.stderr}`).toContain(DONE_MESSAGE);
    expect(prOpenActions(sentinel)).toEqual(opened);
    expect(
      readJournal(projectDir, BATCH).filter(
        (e) => e.kind === 'completion' && e.transition === 'pr'
      )
    ).toHaveLength(2);
  }, 600000);
});
