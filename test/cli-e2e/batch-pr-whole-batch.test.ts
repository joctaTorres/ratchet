/**
 * Whole-batch PR-opening e2e — the Phase 2 blackbox proof-of-work.
 *
 * Implements features/whole-batch-pr/completion-e2e.feature.
 *
 * Drives the compiled `dist/cli/index.js` via `runCLI` over an isolated git-repo
 * fixture and proves the ONE thing only the top layer can: that the user-visible
 * `batch apply` surface, running the bundled engine end-to-end over a real repo,
 * opens exactly one PR at completion under `prGrouping: whole-batch` and nothing
 * when grouping is off/unset. The lower layers already prove the routing
 * (`test/commands/batch/apply.test.ts`) and the spawn/idempotency/failure logic
 * (`test/batch-engine/pr-spawn-at-completion.test.ts`); this does not re-test
 * them — it asserts observable output, exit codes, and real on-disk side effects
 * (a git commit, a PR-open sentinel, run-state), never internal state.
 *
 * The fake spawn seam is the existing `RATCHET_BATCH_AGENT_CMD` override (no new
 * production seam): `runCLI` forwards `env`, the engine routes every spawn through
 * `bash -c "$RATCHET_BATCH_AGENT_CMD"` feeding the step instructions on stdin, and
 * the bundled ReX-local runtime executes it. The fake PR agent is forge-agnostic —
 * it shells out to git ONLY, derives its commit style from `git log` (semantic /
 * Conventional-Commit default), authors one commit on the work branch, writes a
 * plain sentinel for the "PR opened" action capturing the work/base branch it was
 * handed, and reports completion through the `ratchet batch report` channel. It
 * invokes no `gh`/`glab` and hard-codes no forge, mirroring the real
 * `/rct:pr-open` body's ecosystem-neutrality.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import { existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI, cliProjectRoot } from '../helpers/run-cli.js';
import { BatchFixture } from '../commands/batch/batch-fixture.js';
import { readJournal } from '../../src/core/batch/journal.js';
import { hasJournaledPr } from '../../src/core/batch/engine/transition.js';

const CLI_ENTRY = path.join(cliProjectRoot, 'dist', 'cli', 'index.js');
const NODE = process.execPath;

const BATCH = 'b';
const WORK_BRANCH = 'feat/whole-batch';
const BASE_BRANCH = 'main';
/** A conventional / semantic-commit subject: `type` or `type(scope): summary`. */
const SEMANTIC_SUBJECT = /^(feat|fix|chore|docs|refactor|test|build|ci|perf|style|revert)(\([^)]+\))?: /;
const DONE_MESSAGE = 'Nothing to do — all changes are done.';

const tempRoots: string[] = [];

/** Run a git command in `cwd`, throwing on failure (fixture setup only). */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

/**
 * Build an isolated project: a git repo whose history follows semantic /
 * Conventional Commits, a configured `origin` remote (so the base branch resolves
 * to `main`), a `feat/…` work branch carrying the prior stage agents' uncommitted
 * work, and a completed single-phase batch seeded via the run-state/journal
 * helpers. Returns the project root (the CLI's cwd) and a per-project sentinel path.
 */
async function prepareCompletedRepo(
  settings?: Record<string, unknown>
): Promise<{ projectDir: string; sentinel: string }> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-pr-whole-batch-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');
  await fs.mkdir(path.join(projectDir, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(projectDir, '.ratchet', 'batches'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, '.ratchet', 'config.yaml'),
    'schema: ratchet\n',
    'utf-8'
  );

  // A completed single-phase batch: c1's tasks all checked, a journaled verify
  // completion, and a recorded passing terminal boundary proof, so `batch status`
  // resolves the batch to `done` and `batch apply` reaches the completion PR step.
  const fixture = new BatchFixture(projectDir);
  await fixture.writeBatch(BATCH, {
    ...(settings ? { settings } : {}),
    phases: [{ name: 'p1', goal: 'ship', success: 'works', changes: [{ name: 'c1' }] }],
  });
  await fixture.writeChangeWithTasks('c1', { done: 1, total: 1 });
  fixture.completeVerify(BATCH, 'c1');
  fixture.passProof(BATCH, 'p1');

  // A real git repo with a semantic history and an origin remote.
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
  // Point origin/HEAD at main so `resolveBranches` derives the base branch from
  // the remote (not just the neutral fallback).
  git(projectDir, ['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${BASE_BRANCH}`]);

  // The work branch carries the prior stage agents' uncommitted work.
  git(projectDir, ['checkout', '-q', '-b', WORK_BRANCH]);
  await fs.writeFile(path.join(projectDir, 'src.txt'), 'accumulated batch work\n', 'utf-8');

  return { projectDir, sentinel: path.join(base, 'pr-open.sentinel') };
}

/**
 * The forge-agnostic fake PR agent, as a POSIX shell stand-in fed through
 * `RATCHET_BATCH_AGENT_CMD`. It reads the step instructions on stdin and acts ONLY
 * on the `/rct:open-pr` step (any other spawn is a no-op, so it cannot inflate the
 * "spawned exactly once" count). For the PR step it derives the commit style from
 * `git log` (defaulting to semantic / Conventional Commits), authors one commit on
 * the work branch, appends one line to the PR-open sentinel capturing the work/base
 * branch it was handed, and reports completion via `ratchet batch report`. Git only
 * — no forge CLI, no hard-coded forge.
 */
function prAgentOverride(sentinel: string): string {
  return [
    'instr="$(cat)"',
    'case "$instr" in',
    '  */rct:open-pr*)',
    // Parse the work/base branch from the instruction "Input" the CLI delivered.
    '    work="$(printf %s "$instr" | sed -n "s/.*Work branch: \\([^ ]*\\).*/\\1/p" | head -n1)";',
    '    base="$(printf %s "$instr" | sed -n "s/.*Base branch: \\([^ ]*\\).*/\\1/p" | head -n1)";',
    // Derive the commit type from git log; default to semantic when inconclusive.
    '    last="$(git log -1 --pretty=%s 2>/dev/null)";',
    '    if printf %s "$last" | grep -Eq "^[a-z]+(\\([^)]+\\))?: "; then',
    '      type="$(printf %s "$last" | sed -E "s/^([a-z]+).*/\\1/")";',
    '    else',
    '      type="feat";',
    '    fi;',
    '    git add -A;',
    '    git commit -q --no-verify -m "$type: commit accumulated whole-batch work" >/dev/null 2>&1;',
    `    printf 'pr-open work=%s base=%s\\n' "$work" "$base" >> ${JSON.stringify(sentinel)};`,
    `    ${JSON.stringify(NODE)} ${JSON.stringify(CLI_ENTRY)} batch report ${BATCH} --change pr:${BATCH} --complete "opened the whole-batch PR" >/dev/null 2>&1;`,
    '    ;;',
    '  *) : ;;',
    'esac',
  ].join('\n');
}

/** A fake PR agent that fails: exits non-zero without reporting a completion. */
function failingPrAgentOverride(): string {
  return [
    'instr="$(cat)"',
    'case "$instr" in',
    '  */rct:open-pr*) echo "simulated commit/push failure" >&2; exit 1 ;;',
    '  *) : ;;',
    'esac',
  ].join('\n');
}

/** How many PR-open actions the fake agent recorded (sentinel lines). */
function prOpenActions(sentinel: string): string[] {
  if (!existsSync(sentinel)) return [];
  return readFileSync(sentinel, 'utf-8').split('\n').filter((l) => l.trim().length > 0);
}

/** The HEAD commit subject on the current branch of `projectDir`. */
function headSubject(projectDir: string): string {
  return execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: projectDir, encoding: 'utf-8' }).trim();
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('whole-batch PR opening — batch apply e2e against the fake spawn seam', () => {
  it('opens exactly one PR with a semantic commit when prGrouping is whole-batch', async () => {
    const { projectDir, sentinel } = await prepareCompletedRepo({ prGrouping: 'whole-batch' });

    const apply = await runCLI(['--no-color', 'batch', 'apply', BATCH], {
      cwd: projectDir,
      env: { RATCHET_BATCH_AGENT_CMD: prAgentOverride(sentinel) },
      timeoutMs: 120000,
    });

    // The command completed and the PR step advanced (observable output).
    expect(apply.exitCode).toBe(0);
    const out = `${apply.stdout}${apply.stderr}`;
    expect(out).toContain(`pr:${BATCH}`);
    expect(out).toMatch(/advanced/);

    // Exactly one PR-open action was recorded, capturing the resolved branches —
    // proof the PR agent was spawned exactly once for the `pr` stage and its
    // instructions carried the work/base branch (it acts only on /rct:open-pr).
    const actions = prOpenActions(sentinel);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain(`work=${WORK_BRANCH}`);
    expect(actions[0]).toContain(`base=${BASE_BRANCH}`);

    // The commit the fake PR agent authored on the work branch follows the
    // repository's semantic / Conventional-Commit git-log style.
    expect(headSubject(projectDir)).toMatch(SEMANTIC_SUBJECT);

    // The PR-open completion is recorded in run-state (transition: 'pr').
    expect(hasJournaledPr(readJournal(projectDir, BATCH))).toBe(true);
  }, 120000);

  it('spawns no PR agent and leaves the terminal output unchanged when prGrouping is off', async () => {
    const { projectDir, sentinel } = await prepareCompletedRepo({ prGrouping: 'off' });

    const apply = await runCLI(['--no-color', 'batch', 'apply', BATCH], {
      cwd: projectDir,
      env: { RATCHET_BATCH_AGENT_CMD: prAgentOverride(sentinel) },
      timeoutMs: 120000,
    });

    expect(apply.exitCode).toBe(0);
    expect(`${apply.stdout}${apply.stderr}`).toContain(DONE_MESSAGE);
    expect(prOpenActions(sentinel)).toHaveLength(0);
    expect(hasJournaledPr(readJournal(projectDir, BATCH))).toBe(false);
  }, 120000);

  it('behaves exactly like off when prGrouping is unset', async () => {
    const { projectDir, sentinel } = await prepareCompletedRepo(); // no settings

    const apply = await runCLI(['--no-color', 'batch', 'apply', BATCH], {
      cwd: projectDir,
      env: { RATCHET_BATCH_AGENT_CMD: prAgentOverride(sentinel) },
      timeoutMs: 120000,
    });

    expect(apply.exitCode).toBe(0);
    expect(`${apply.stdout}${apply.stderr}`).toContain(DONE_MESSAGE);
    expect(prOpenActions(sentinel)).toHaveLength(0);
  }, 120000);

  it('never double-opens: a second apply on the completed batch adds no PR', async () => {
    const { projectDir, sentinel } = await prepareCompletedRepo({ prGrouping: 'whole-batch' });
    const env = { RATCHET_BATCH_AGENT_CMD: prAgentOverride(sentinel) };

    const first = await runCLI(['--no-color', 'batch', 'apply', BATCH], {
      cwd: projectDir,
      env,
      timeoutMs: 120000,
    });
    expect(first.exitCode).toBe(0);
    expect(prOpenActions(sentinel)).toHaveLength(1);

    const second = await runCLI(['--no-color', 'batch', 'apply', BATCH], {
      cwd: projectDir,
      env,
      timeoutMs: 120000,
    });

    // No additional spawn, still exactly one PR-open action, the unchanged done
    // message (the PR-opened rule is read from run-state).
    expect(second.exitCode).toBe(0);
    expect(`${second.stdout}${second.stderr}`).toContain(DONE_MESSAGE);
    expect(prOpenActions(sentinel)).toHaveLength(1);
    expect(
      readJournal(projectDir, BATCH).filter(
        (e) => e.kind === 'completion' && e.transition === 'pr'
      )
    ).toHaveLength(1);
  }, 180000);

  it('surfaces a PR-open failure as a reported step failure and leaves retry possible', async () => {
    const { projectDir, sentinel } = await prepareCompletedRepo({ prGrouping: 'whole-batch' });

    const apply = await runCLI(['--no-color', 'batch', 'apply', BATCH], {
      cwd: projectDir,
      env: { RATCHET_BATCH_AGENT_CMD: failingPrAgentOverride() },
      timeoutMs: 120000,
    });

    // The PR step is reported as a failure in the observable output.
    const out = `${apply.stdout}${apply.stderr}`;
    expect(out).toContain(`pr:${BATCH}`);
    expect(out).toMatch(/blocked|fail/i);

    // No PR-open action, no `pr` completion in run-state → a subsequent run is
    // still free to retry the PR step.
    expect(prOpenActions(sentinel)).toHaveLength(0);
    expect(hasJournaledPr(readJournal(projectDir, BATCH))).toBe(false);
  }, 120000);
});
