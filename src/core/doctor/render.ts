/**
 * Doctor rendering + exit-code derivation.
 *
 * Two output paths over the SAME `DoctorReport`:
 *  - `renderReport`: human-friendly chalk lines (per-check status glyph, detail,
 *    remedy when not passing) plus a one-line summary.
 *  - `serializeReport`: a single JSON object listing every check with its status
 *    and severity, for scripting/CI. No spinner or decoration is emitted on this
 *    path (the caller suppresses the spinner when `--json`).
 *
 * `exitCodeFor` is the single source of truth for the process exit code: 0 when
 * the report is ok (every required check passed), 1 otherwise. Optional `info`
 * notices never change it.
 */

import chalk from 'chalk';
import type { DoctorCheck, DoctorReport } from './types.js';

function glyph(check: DoctorCheck): string {
  switch (check.status) {
    case 'pass':
      return chalk.green('✓');
    case 'fail':
      return chalk.red('✗');
    case 'info':
      return chalk.cyan('ℹ');
  }
}

/** Render the report for humans. Returns the full multi-line string. */
export function renderReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(chalk.bold('ratchet doctor — external dependency check'));
  lines.push('');

  for (const check of report.checks) {
    const severityTag =
      check.severity === 'optional' ? chalk.dim(' (optional)') : '';
    lines.push(`${glyph(check)} ${chalk.bold(check.label)}${severityTag}`);
    lines.push(`  ${check.detail}`);
    if (check.status !== 'pass' && check.remedy) {
      lines.push(`  ${chalk.yellow('→')} ${check.remedy}`);
    }
  }

  lines.push('');
  if (report.ok) {
    lines.push(chalk.green('All required checks passed.'));
  } else {
    const failed = report.checks.filter(
      (c) => c.severity === 'required' && c.status === 'fail'
    );
    lines.push(
      chalk.red(
        `${failed.length} required check${failed.length === 1 ? '' : 's'} failed.`
      )
    );
  }

  return lines.join('\n');
}

/** Serialize the report as a single JSON object (machine-readable). */
export function serializeReport(report: DoctorReport): string {
  return JSON.stringify(
    {
      ok: report.ok,
      checks: report.checks.map((check) => ({
        id: check.id,
        label: check.label,
        status: check.status,
        severity: check.severity,
        detail: check.detail,
        ...(check.remedy !== undefined ? { remedy: check.remedy } : {}),
      })),
    },
    null,
    2
  );
}

/** The process exit code for a report: 0 when ok, 1 when any required fails. */
export function exitCodeFor(report: DoctorReport): number {
  return report.ok ? 0 : 1;
}
