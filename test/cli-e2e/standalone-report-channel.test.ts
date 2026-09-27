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
import { promises as fs } from 'fs';
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
