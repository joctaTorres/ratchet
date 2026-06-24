/**
 * Docker check (optional/informational).
 *
 * Docker is only needed for the `docker` execution locus; local runs never touch
 * it. So doctor reports it at `optional` severity: a missing/stopped daemon is an
 * informational notice, NEVER a failure, and never affects the exit code. The
 * probe mirrors `preflightDockerDaemon` (`docker info` — a cheap daemon
 * round-trip) but downgraded from fail-closed to advisory.
 */

import type { BootstrapDeps } from '../../batch/engine/runtime/rex-bootstrap.js';
import type { DoctorCheck } from '../types.js';

/** Run the Docker check, returning one `DoctorCheck`. Pure (deps injected). */
export function checkDocker(deps: BootstrapDeps): DoctorCheck {
  const res = deps.run('docker', ['info']);
  if (res.status === 0) {
    return {
      id: 'docker',
      label: 'Docker daemon',
      status: 'pass',
      severity: 'optional',
      detail: 'Docker daemon is available.',
    };
  }

  return {
    id: 'docker',
    label: 'Docker daemon',
    status: 'info',
    severity: 'optional',
    detail:
      'Docker daemon is not available. This is only needed for the docker execution ' +
      'locus; local runs are unaffected.',
    remedy:
      'Optional: install Docker (https://docs.docker.com/get-docker/) and start the ' +
      'daemon if you plan to use `locus: docker`.',
  };
}
