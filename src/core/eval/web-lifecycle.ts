/**
 * Web binding lifecycle harness: start the app, wait for readiness, run the
 * Playwright spec, always tear the process down.
 *
 * Mirrors `judgeCheck` in `judge.ts` (bash a command, evaluate the result) but
 * adds the missing background-process lifecycle around it — `judgeCheck`'s
 * `realBashRunner` only resolves on `close`, so it cannot represent "started,
 * still running." `runWebLifecycle` starts the binding's `start` command as a
 * background process, polls `readiness` (fail-closed: timeout is a hard
 * failure, never an assumed pass), runs the Playwright spec at `spec` via a
 * plain bash invocation (agent-neutral — no agent-specific runner), and tears
 * the started process down in a `finally` on every path.
 *
 * Deliberately NOT wired into `judgeCase` yet: reducing `WebLifecycleOutcome`
 * into a `CaseVerdict` and folding it into the `deterministic` contributor is
 * `web-deterministic-fold`'s job. This module is the thin, independently
 * provable start/poll/run/teardown contract that change composes on top of.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WebBinding, WebReadiness } from './spec.js';
import { realBashRunner, type BashRunner, type BashResult } from '../batch/engine/index.js';

/** The Playwright trace and/or screenshot attachments a completed run captured, keyed by artifact kind. */
export interface WebArtifacts {
  trace?: string;
  screenshot?: string;
}

/** A background process the harness started, kept alive across the readiness poll and spec run. */
export interface ProcessHandle {
  readonly pid: number | null;
  kill(): void;
}

export type ProcessStarter = (command: string, cwd: string) => ProcessHandle;

/** Starts `command` detached in its own process group so `kill()` can signal the whole group —
 *  a dev-server launcher commonly forks a nested process, and killing only the wrapper shell
 *  would leak the real server. */
export const realProcessStarter: ProcessStarter = (command, cwd) => {
  const child = spawn('bash', ['-c', command], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  return {
    pid: child.pid ?? null,
    kill() {
      if (child.pid != null) {
        process.kill(-child.pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
    },
  };
};

export type ReadinessChecker = (readiness: WebReadiness, cwd: string, bash: BashRunner) => Promise<boolean>;

/** Command probe: exit zero. URL probe: `fetch(url).ok`. Exactly one of `command`/`url` is
 *  present per `WebReadinessSchema`'s refinement.
 *
 *  A URL probe catches fetch rejections (e.g. `ECONNREFUSED` during normal server
 *  boot) and returns `false` — not-ready — so the poll loop keeps going until the
 *  readiness `timeoutMs` deadline. The command-probe path is already guarded by
 *  exit code; the URL path must be symmetrically tolerant. */
export const defaultReadinessChecker: ReadinessChecker = async (readiness, cwd, bash) => {
  if (readiness.command) {
    const result = await bash(readiness.command, cwd);
    return result.exitCode === 0;
  }
  try {
    const response = await fetch(readiness.url as string);
    return response.ok;
  } catch {
    // Connection refused or any network error during server boot → not yet ready.
    return false;
  }
};

const DEFAULT_POLL_INTERVAL_MS = 250;
const REPORT_FILE_NAME = '.ratchet-web-report.json';

/**
 * The npx package identifier Playwright registers under — exported so the
 * doctor readiness check (`src/core/doctor/checks/playwright.ts`) can import it
 * rather than hard-coding the same string independently. Both sites must stay in
 * lockstep: if the invocation ever moves to a different package name, changing
 * this single constant is sufficient.
 */
export const PLAYWRIGHT_NPX_PACKAGE = 'playwright' as const;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads a file's contents as a string, mirroring `invariant-evaluator.ts`'s `FileReader` seam. */
const realReadReport = (filePath: string): Promise<string> => readFile(filePath, 'utf-8');

export interface WebLifecycleDeps {
  start?: ProcessStarter;
  bash?: BashRunner;
  checkReadiness?: ReadinessChecker;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Reads the Playwright JSON report at a path; real default reads the file (tests inject canned JSON). */
  readReport?: (path: string) => Promise<string>;
}

export type WebLifecycleOutcome =
  | { kind: 'readiness-timeout' }
  | { kind: 'completed'; passed: boolean; result: BashResult; artifacts?: WebArtifacts };

/** One Playwright JSON-reporter attachment, as recorded on a test result. */
interface PlaywrightAttachment {
  name?: unknown;
  path?: unknown;
}

interface PlaywrightResult {
  attachments?: PlaywrightAttachment[];
}

interface PlaywrightTest {
  results?: PlaywrightResult[];
}

interface PlaywrightSpec {
  tests?: PlaywrightTest[];
}

/** Suites can nest (project / describe-block grouping), so specs are collected recursively. */
interface PlaywrightSuite {
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
}

/** Walk `suites[].specs[].tests[].results[].attachments[]`, recursing into nested `suites[]`. */
function collectAttachments(suites: PlaywrightSuite[] | undefined): PlaywrightAttachment[] {
  const attachments: PlaywrightAttachment[] = [];
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          attachments.push(...(result.attachments ?? []));
        }
      }
    }
    attachments.push(...collectAttachments(suite.suites));
  }
  return attachments;
}

/**
 * Read and parse the Playwright JSON report, extracting whichever `trace`/
 * `screenshot` attachments Playwright itself recorded. Any read or parse
 * failure (report never written, unexpected schema) is caught and treated as
 * "no artifacts" — never thrown, never a signal that changes the verdict.
 */
async function extractArtifacts(
  reportPath: string,
  readReport: (path: string) => Promise<string>
): Promise<WebArtifacts | undefined> {
  try {
    const raw = await readReport(reportPath);
    const report = JSON.parse(raw) as PlaywrightReport;
    const artifacts: WebArtifacts = {};
    for (const attachment of collectAttachments(report.suites)) {
      if (attachment.name === 'trace' && typeof attachment.path === 'string' && !artifacts.trace) {
        artifacts.trace = attachment.path;
      } else if (
        attachment.name === 'screenshot' &&
        typeof attachment.path === 'string' &&
        !artifacts.screenshot
      ) {
        artifacts.screenshot = attachment.path;
      }
    }
    return artifacts.trace || artifacts.screenshot ? artifacts : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run a `web` binding's lifecycle: start the app, poll `readiness` until it
 * succeeds or `readiness.timeoutMs` elapses (fail-closed — timeout never runs
 * the spec), run the Playwright spec via plain bash, and always kill the
 * started process in `finally`.
 */
export async function runWebLifecycle(
  binding: WebBinding,
  cwd: string,
  deps: WebLifecycleDeps = {}
): Promise<WebLifecycleOutcome> {
  const start = deps.start ?? realProcessStarter;
  const bash = deps.bash ?? realBashRunner;
  const checkReadiness = deps.checkReadiness ?? defaultReadinessChecker;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const readReport = deps.readReport ?? realReadReport;

  const handle = start(binding.start, cwd);
  try {
    const deadline = now() + binding.readiness.timeoutMs;
    let ready = false;
    // Check-then-sleep: a same-tick-ready app is never penalized one poll interval.
    while (now() < deadline) {
      if (await checkReadiness(binding.readiness, cwd, bash)) {
        ready = true;
        break;
      }
      await sleep(pollIntervalMs);
    }
    if (!ready) {
      return { kind: 'readiness-timeout' };
    }
    const result = await bash(
      `PLAYWRIGHT_JSON_OUTPUT_NAME=${REPORT_FILE_NAME} npx ${PLAYWRIGHT_NPX_PACKAGE} test ${binding.spec} --trace=retain-on-failure --reporter=list,json`,
      cwd
    );
    const artifacts = await extractArtifacts(path.join(cwd, REPORT_FILE_NAME), readReport);
    return { kind: 'completed', passed: result.exitCode === 0, result, ...(artifacts ? { artifacts } : {}) };
  } finally {
    handle.kill();
  }
}
