/**
 * `ratchet doctor` command.
 *
 * Validates ratchet's external (non-npm) runtime dependencies — a coding-agent
 * CLI, the SWE-ReX Python/uv toolchain, and (optionally) Docker — and reports
 * each as pass / fail / info with an actionable remedy. The heavy lifting is the
 * pure check engine in `src/core/doctor/`; this command is a thin shell: run the
 * checks, render (human or `--json`), and set the process exit code from the
 * report (non-zero iff a required check fails).
 *
 * `runDoctorAdvisory` is the never-block variant used by first-init: it renders
 * the same report as warnings but NEVER prompts and NEVER exits, so doctor can
 * never abort setup.
 */

import { runDoctorChecks } from '../core/doctor/index.js';
import {
  renderReport,
  serializeReport,
  exitCodeFor,
} from '../core/doctor/render.js';
import chalk from 'chalk';

export interface DoctorOptions {
  json?: boolean;
}

/**
 * Run doctor as a standalone command. On `--json` a single JSON object is
 * written to stdout (no spinner/decoration); otherwise the human report is
 * printed. The process exit code is set from the report.
 */
export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const report = runDoctorChecks();

  if (options.json) {
    console.log(serializeReport(report));
  } else {
    console.log(renderReport(report));
  }

  const code = exitCodeFor(report);
  if (code !== 0) {
    process.exitCode = code;
  }
}

/**
 * Advisory (never-block) doctor for first-init. Renders the report as advisory
 * output: failing required checks are shown as WARNINGS, never errors, and the
 * process is never exited. A hint to re-run `ratchet doctor` is always printed.
 * Returns the report so callers can inspect it, but its result never blocks.
 */
export function runDoctorAdvisory(): void {
  const report = runDoctorChecks();

  console.log();
  console.log(renderReport(report));

  if (!report.ok) {
    console.log();
    console.log(
      chalk.yellow(
        'Some external dependencies are missing. This does not block setup — ' +
          'install them when you are ready.'
      )
    );
  }

  console.log();
  console.log(
    chalk.dim('Re-run these checks any time with: ratchet doctor')
  );
}
