/**
 * E2E: a standalone headless `ratchet apply <change>` records its completion
 * through the batch-less report channel named in the agent prompt.
 *
 * Implements features/standalone-report-channel/standalone-completion.feature.
 *
 * Drives the BUILT CLI with the existing `RATCHET_BATCH_AGENT_CMD` fake spawn
 * seam: a POSIX-shell stub agent reads its instructions on stdin, extracts the
 * `ratchet report <change> --complete` command the prompt tells it to run, and
 * runs it against the built CLI. With no batch in sight, a reporting agent must
 * end `advanced`; a stub that never reports still parks as `blocked`.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI, cliProjectRoot } from '../helpers/run-cli.js';
import { CommandFixture } from '../commands/change-fixture.js';

const CLI_ENTRY = path.join(cliProjectRoot, 'dist', 'cli', 'index.js');
const NODE = process.execPath;
const CHANGE = 'add-hello';

const tempRoots: string[] = [];

async function prepareProject(): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-standalone-report-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');
  await fs.mkdir(path.join(projectDir, '.ratchet', 'changes'), { recursive: true });
  await fs.writeFile(path.join(projectDir, '.ratchet', 'config.yaml'), 'schema: ratchet\n', 'utf-8');
  await new CommandFixture(projectDir).writeChangeWithTasks(CHANGE, { done: 0, total: 1 });
  return projectDir;
}

/**
 * A stub agent that follows its prompt: it fails loudly if the instructions
 * mention `undefined`, then runs the `ratchet report <change> --complete` command
 * named in them — through the built CLI, never a bare `ratchet` on PATH.
 */
function reportingAgent(): string {
  return [
    'instr="$(cat)"',
    'case "$instr" in *undefined*) echo "prompt mentions undefined" >&2; exit 3 ;; esac',
    'change="$(printf %s "$instr" | sed -n "s/.*\\`ratchet report \\([^ ]*\\) --complete.*/\\1/p" | head -n1)"',
    '[ -n "$change" ] || { echo "no ratchet report command in prompt" >&2; exit 4; }',
    `${JSON.stringify(NODE)} ${JSON.stringify(CLI_ENTRY)} report "$change" --complete "created hello.txt"`,
  ].join('\n');
}

/**
 * A stub propose agent that reports BEFORE the change exists, then scaffolds it
 * with `ratchet new change` (as the delegated `/rct:propose` workflow does), then
 * reports completion. `new change`'s exit code is recorded in `sentinel`.
 */
function preScaffoldReportingAgent(sentinel: string): string {
  const cli = `${JSON.stringify(NODE)} ${JSON.stringify(CLI_ENTRY)}`;
  return [
    'instr="$(cat)"',
    'change="$(printf %s "$instr" | sed -n "s/.*\\`ratchet report \\([^ ]*\\) --complete.*/\\1/p" | head -n1)"',
    '[ -n "$change" ] || { echo "no ratchet report command in prompt" >&2; exit 4; }',
    `${cli} report "$change" --status "starting"`,
    `${cli} new change "$change" >/dev/null 2>&1; echo "$?" > ${JSON.stringify(sentinel)}`,
    `${cli} report "$change" --complete "scaffolded the change"`,
  ].join('\n');
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('standalone apply e2e — batch-less report channel', () => {
  it('ends advanced when the agent runs the prompted `ratchet report` command', async () => {
    const projectDir = await prepareProject();

    const apply = await runCLI(['--no-color', 'apply', CHANGE], {
      cwd: projectDir,
      env: { RATCHET_BATCH_AGENT_CMD: reportingAgent() },
      timeoutMs: 120000,
    });

    const out = `${apply.stdout}${apply.stderr}`;
    expect(apply.exitCode).toBe(0);
    expect(out).toContain(`Applied: ${CHANGE} (apply)`);
    expect(out).toContain('change advanced through apply');
    expect(out).not.toContain('batch named');

    const journal = await fs.readFile(
      path.join(projectDir, '.ratchet', 'changes', CHANGE, '.run', 'journal.jsonl'),
      'utf-8'
    );
    expect(journal).toContain('"kind":"completion"');
    expect(journal).toContain('created hello.txt');
  });

  it('still parks as blocked when the agent exits without reporting', async () => {
    const projectDir = await prepareProject();

    const apply = await runCLI(['--no-color', 'apply', CHANGE], {
      cwd: projectDir,
      env: { RATCHET_BATCH_AGENT_CMD: 'cat >/dev/null' },
      timeoutMs: 120000,
    });

    const out = `${apply.stdout}${apply.stderr}`;
    expect(out).toContain('blocked');
    expect(out).toContain('without reporting completion');
  });
});

describe('standalone propose e2e — report before scaffolding', () => {
  it('lets the agent report, then create the change, and ends advanced', async () => {
    const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-standalone-propose-'));
    tempRoots.push(base);
    const projectDir = path.join(base, 'project');
    await fs.mkdir(path.join(projectDir, '.ratchet', 'changes'), { recursive: true });
    await fs.writeFile(path.join(projectDir, '.ratchet', 'config.yaml'), 'schema: ratchet\n', 'utf-8');
    const sentinel = path.join(base, 'new-change.exit');

    const propose = await runCLI(['--no-color', 'propose', 'say hello', '--name', CHANGE], {
      cwd: projectDir,
      env: { RATCHET_BATCH_AGENT_CMD: preScaffoldReportingAgent(sentinel) },
      timeoutMs: 120000,
    });

    const out = `${propose.stdout}${propose.stderr}`;
    expect(existsSync(sentinel)).toBe(true);
    expect(readFileSync(sentinel, 'utf-8').trim()).toBe('0');
    expect(propose.exitCode).toBe(0);
    expect(out).toContain(`Proposed: ${CHANGE} (propose)`);
    expect(out).toContain("change proposed");
    expect(existsSync(path.join(projectDir, '.ratchet', 'changes', CHANGE, '.ratchet.yaml'))).toBe(true);

    const journal = readFileSync(
      path.join(projectDir, '.ratchet', 'changes', CHANGE, '.run', 'journal.jsonl'),
      'utf-8'
    );
    expect(journal).toContain('"message":"starting"');
    expect(journal).toContain('"kind":"completion"');
  });
});

describe('standalone propose e2e — early blocker then retry', () => {
  it('parks blocked without stamping the change, and a retry creates it', async () => {
    const base = await fs.mkdtemp(path.join(tmpdir(), 'ratchet-standalone-retry-'));
    tempRoots.push(base);
    const projectDir = path.join(base, 'project');
    const changeDir = path.join(projectDir, '.ratchet', 'changes', CHANGE);
    await fs.mkdir(path.join(projectDir, '.ratchet', 'changes'), { recursive: true });
    await fs.writeFile(path.join(projectDir, '.ratchet', 'config.yaml'), 'schema: ratchet\n', 'utf-8');
    const cli = `${JSON.stringify(NODE)} ${JSON.stringify(CLI_ENTRY)}`;

    const blocked = await runCLI(['--no-color', 'propose', 'say hello', '--name', CHANGE], {
      cwd: projectDir,
      env: {
        RATCHET_BATCH_AGENT_CMD: `cat >/dev/null; ${cli} report ${CHANGE} --blocker "which database?"`,
      },
      timeoutMs: 120000,
    });
    const blockedOut = `${blocked.stdout}${blocked.stderr}`;
    expect(blockedOut).toContain('blocked');
    expect(blockedOut).toContain('which database?');
    expect(await fs.readdir(changeDir)).toEqual(['.run']);

    const sentinel = path.join(base, 'new-change.exit');
    const retry = await runCLI(['--no-color', 'propose', 'say hello', '--name', CHANGE], {
      cwd: projectDir,
      env: { RATCHET_BATCH_AGENT_CMD: preScaffoldReportingAgent(sentinel) },
      timeoutMs: 120000,
    });
    const retryOut = `${retry.stdout}${retry.stderr}`;
    expect(retryOut).not.toContain('already exists');
    expect(retry.exitCode).toBe(0);
    expect(readFileSync(sentinel, 'utf-8').trim()).toBe('0');
    expect(retryOut).toContain('change proposed');
    expect(existsSync(path.join(changeDir, '.ratchet.yaml'))).toBe(true);
  });
});
