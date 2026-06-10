import { describe, it, expect } from 'vitest';
import {
  LicenseManager,
  LicenseError,
  FakeAuthorizationService,
  verifyAuthorization,
  type AuthorizationService,
  type RunAuthorization,
} from '../../packages/batch-engine/src/license.js';

const SECRET = 'test-signing-secret';

function manager(opts: Partial<ConstructorParameters<typeof LicenseManager>[0]> = {}) {
  return new LicenseManager({
    licenseKey: 'valid-key',
    service: new FakeAuthorizationService(SECRET),
    verifyingSecret: SECRET,
    ...opts,
  });
}

describe('LicenseManager', () => {
  it('refuses to run without a license key', async () => {
    const m = new LicenseManager({
      licenseKey: '',
      service: new FakeAuthorizationService(SECRET),
      verifyingSecret: SECRET,
    });
    expect(m.hasLicenseKey()).toBe(false);
    await expect(m.authorizeRun('b', 'c', 'propose')).rejects.toBeInstanceOf(LicenseError);
  });

  it('authenticates and returns verifiable run material for a valid license', async () => {
    const m = manager();
    const auth = await m.authorizeRun('b', 'c', 'propose');
    expect(auth.runMaterial.length).toBeGreaterThan(0);
    expect(auth.leaseExpiresAt).toBeGreaterThan(Date.now());
    expect(
      verifyAuthorization(SECRET, { licenseKey: 'valid-key', batch: 'b', change: 'c', transition: 'propose' }, auth)
    ).toBe(true);
  });

  it('rejects authorization whose signature does not verify (server is load-bearing)', async () => {
    // A service that returns plausible-looking but unsigned material is refused,
    // proving a lifted blob cannot fabricate authorization.
    const forging: AuthorizationService = {
      async authorize(): Promise<RunAuthorization> {
        return {
          runMaterial: 'forged',
          leaseExpiresAt: Date.now() + 60_000,
          issuer: 'attacker',
          signature: 'deadbeef',
        };
      },
    };
    const m = new LicenseManager({ licenseKey: 'valid-key', service: forging, verifyingSecret: SECRET });
    await expect(m.authorizeRun('b', 'c', 'propose')).rejects.toBeInstanceOf(LicenseError);
  });

  it('rejects an invalid license key at the service', async () => {
    const m = new LicenseManager({
      licenseKey: 'invalid',
      service: new FakeAuthorizationService(SECRET),
      verifyingSecret: SECRET,
    });
    await expect(m.authorizeRun('b', 'c', 'propose')).rejects.toBeInstanceOf(LicenseError);
  });

  it('reuses a valid lease offline, then requires re-auth once it expires', async () => {
    let now = 1_000_000;
    let calls = 0;
    const service: AuthorizationService = {
      async authorize(req) {
        calls += 1;
        return new FakeAuthorizationService(SECRET, 'iss', 10_000, () => now).authorize(req);
      },
    };
    const m = new LicenseManager({
      licenseKey: 'valid-key',
      service,
      verifyingSecret: SECRET,
      now: () => now,
    });

    await m.authorizeRun('b', 'c', 'propose');
    expect(calls).toBe(1);

    // Within the lease window, offline: no second service call.
    now += 5_000;
    await m.authorizeRun('b', 'c', 'propose');
    expect(calls).toBe(1);

    // Past the lease window: re-authorization is required (service called again).
    now += 10_000;
    await m.authorizeRun('b', 'c', 'propose');
    expect(calls).toBe(2);
  });
});
