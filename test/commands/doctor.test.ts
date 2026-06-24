import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DoctorReport } from '../../src/core/doctor/index.js';

/**
 * Behavioral tests for the `doctor` command shell. The pure check engine
 * (`runDoctorChecks`) is MOCKED so these assert the command's CONTRACT —
 * JSON vs human output and process-exit-code wiring — deterministically,
 * without touching real PATH/process probes.
 */
const { runDoctorChecksMock } = vi.hoisted(() => ({
  runDoctorChecksMock: vi.fn<[], DoctorReport>(),
}));

vi.mock('../../src/core/doctor/index.js', () => ({
  runDoctorChecks: runDoctorChecksMock,
}));

import { doctorCommand, runDoctorAdvisory } from '../../src/commands/doctor.js';

const failingReport: DoctorReport = {
  ok: false,
  checks: [
    {
      id: 'agent',
      label: 'Coding-agent CLI',
      status: 'fail',
      severity: 'required',
      detail: 'No supported coding-agent CLI found on PATH.',
      remedy: 'Install one of the supported coding-agent CLIs.',
    },
  ],
};

const passingReport: DoctorReport = {
  ok: true,
  checks: [
    {
      id: 'agent',
      label: 'Coding-agent CLI',
      status: 'pass',
      severity: 'required',
      detail: 'Detected: claude 1.0.0.',
    },
  ],
};

describe('doctorCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    runDoctorChecksMock.mockReset();
    process.exitCode = undefined;
  });

  it('--json prints a single valid JSON object and sets a non-zero exit code on failure', async () => {
    runDoctorChecksMock.mockReturnValue(failingReport);

    await doctorCommand({ json: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(printed); // throws if not a single valid JSON object
    expect(parsed.ok).toBe(false);
    expect(parsed.checks[0].id).toBe('agent');
    expect(process.exitCode).toBe(1);
  });

  it('leaves the exit code unset when every required check passes', async () => {
    runDoctorChecksMock.mockReturnValue(passingReport);

    await doctorCommand({ json: true });

    expect(process.exitCode).toBeUndefined();
  });

  it('renders human output (not JSON) when --json is absent', async () => {
    runDoctorChecksMock.mockReturnValue(failingReport);

    await doctorCommand({});

    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Coding-agent CLI');
    expect(() => JSON.parse(printed)).toThrow(); // human output, not JSON
    expect(process.exitCode).toBe(1);
  });
});

describe('runDoctorAdvisory (first-init, never-block)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    runDoctorChecksMock.mockReset();
    process.exitCode = undefined;
  });

  it('renders the report and a re-run hint but NEVER sets a non-zero exit code, even when failing', () => {
    runDoctorChecksMock.mockReturnValue(failingReport);

    runDoctorAdvisory();

    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('ratchet doctor'); // re-run hint
    expect(printed.toLowerCase()).toContain('does not block setup');
    // The load-bearing guarantee: advisory mode never fails the process.
    expect(process.exitCode).toBeUndefined();
  });
});
