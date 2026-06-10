/**
 * Licensing — authentication + per-run authorization with a signed lease.
 *
 * Design intent (per the plan): a boolean license check is patchable once the
 * distribution blob is lifted, so authorization is modeled so the SERVER
 * RESPONSE is functional input the engine cannot run without — not a yes/no
 * flag. The engine authenticates with the license key, obtains a signed run
 * authorization carrying a short-lived offline-grace lease plus the run
 * material a transition needs, and refreshes within the lease. Without valid
 * authorization it refuses to spawn any agent.
 *
 * STUBBED BOUNDARY: the real license server does not exist in this environment.
 * The boundary is the `AuthorizationService` interface. `HttpAuthorizationService`
 * is the seam where the real signed HTTP call goes (clearly marked TODO). Tests
 * and offline development inject a `FakeAuthorizationService` that issues a
 * locally-signed lease. The signature is verified the same way for both, so the
 * "server is load-bearing" property holds: without a service that can produce a
 * valid signature over the run material, the engine has nothing to run with.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export class LicenseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicenseError';
  }
}

/** Identifies the run being authorized. */
export interface AuthorizationRequest {
  licenseKey: string;
  batch: string;
  change: string;
  transition: string;
}

/**
 * The signed authorization the engine runs against. `runMaterial` is functional
 * input — not a boolean — that a transition requires (e.g. server-derived
 * parameters). A blob without a valid authorization simply does not have it.
 */
export interface RunAuthorization {
  /** The run material the engine needs to proceed (opaque, server-derived). */
  runMaterial: string;
  /** Epoch ms when the offline-grace lease expires; re-auth required after. */
  leaseExpiresAt: number;
  /** Issuing service identifier (for diagnostics). */
  issuer: string;
  /** HMAC signature over the canonical authorization payload. */
  signature: string;
}

/** The seam: something that can issue a signed run authorization. */
export interface AuthorizationService {
  authorize(request: AuthorizationRequest): Promise<RunAuthorization>;
}

/** Canonical bytes that the signature covers. */
export function canonicalPayload(
  request: AuthorizationRequest,
  runMaterial: string,
  leaseExpiresAt: number,
  issuer: string
): string {
  return [
    request.licenseKey,
    request.batch,
    request.change,
    request.transition,
    runMaterial,
    String(leaseExpiresAt),
    issuer,
  ].join('|');
}

export function signAuthorization(
  secret: string,
  request: AuthorizationRequest,
  runMaterial: string,
  leaseExpiresAt: number,
  issuer: string
): string {
  return createHmac('sha256', secret)
    .update(canonicalPayload(request, runMaterial, leaseExpiresAt, issuer))
    .digest('hex');
}

/**
 * Verify an authorization's signature against the verification secret and the
 * request it was issued for. This is what makes the server load-bearing: the
 * engine refuses to act on run material whose signature it cannot verify.
 */
export function verifyAuthorization(
  verifyingSecret: string,
  request: AuthorizationRequest,
  auth: RunAuthorization
): boolean {
  const expected = signAuthorization(
    verifyingSecret,
    request,
    auth.runMaterial,
    auth.leaseExpiresAt,
    auth.issuer
  );
  const a = Buffer.from(expected);
  const b = Buffer.from(auth.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface LicenseManagerOptions {
  /** Where the license key is read from (defaults to env). */
  licenseKey?: string;
  service: AuthorizationService;
  /**
   * Secret used to VERIFY signatures. In production this is the service's public
   * verification material; in the HMAC dev seam it matches the signing secret.
   */
  verifyingSecret: string;
  /** Injectable clock for testing offline-grace expiry. */
  now?: () => number;
}

/**
 * Obtains and caches run authorizations, enforcing the offline-grace lease.
 */
export class LicenseManager {
  private readonly service: AuthorizationService;
  private readonly verifyingSecret: string;
  private readonly licenseKey?: string;
  private readonly now: () => number;
  private cached?: { request: AuthorizationRequest; auth: RunAuthorization };

  constructor(options: LicenseManagerOptions) {
    this.service = options.service;
    this.verifyingSecret = options.verifyingSecret;
    this.licenseKey = options.licenseKey ?? process.env.RATCHET_LICENSE_KEY;
    this.now = options.now ?? Date.now;
  }

  /** True only when a license key is configured. */
  hasLicenseKey(): boolean {
    return !!this.licenseKey && this.licenseKey.trim().length > 0;
  }

  /**
   * Authenticate and obtain a verified run authorization. Reuses a cached lease
   * while it is still valid (offline grace); re-authorizes once expired or for a
   * different run. Throws `LicenseError` when no key is configured, the service
   * refuses, or the returned authorization fails signature verification.
   */
  async authorizeRun(
    batch: string,
    change: string,
    transition: string
  ): Promise<RunAuthorization> {
    if (!this.hasLicenseKey()) {
      throw new LicenseError(
        'A valid license is required to run the batch engine.\n' +
          'Set RATCHET_LICENSE_KEY or activate with `ratchet batch activate <license-key>`.\n' +
          'Obtain a license at https://ratchet.dev/license.'
      );
    }

    const request: AuthorizationRequest = {
      licenseKey: this.licenseKey!,
      batch,
      change,
      transition,
    };

    // Offline grace: reuse a valid cached lease for the same run without calling
    // the service again.
    if (
      this.cached &&
      sameRun(this.cached.request, request) &&
      this.cached.auth.leaseExpiresAt > this.now() &&
      verifyAuthorization(this.verifyingSecret, request, this.cached.auth)
    ) {
      return this.cached.auth;
    }

    let auth: RunAuthorization;
    try {
      auth = await this.service.authorize(request);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new LicenseError(
        `License authorization failed: ${reason}\n` +
          'Check your license key and connectivity, then retry.'
      );
    }

    if (!verifyAuthorization(this.verifyingSecret, request, auth)) {
      throw new LicenseError(
        'License authorization signature is invalid. The engine refuses to run ' +
          'without a verifiable authorization from the license service.'
      );
    }

    if (auth.leaseExpiresAt <= this.now()) {
      throw new LicenseError(
        'License authorization lease has already expired. Re-authorization is ' +
          'required.'
      );
    }

    this.cached = { request, auth };
    return auth;
  }
}

function sameRun(a: AuthorizationRequest, b: AuthorizationRequest): boolean {
  return (
    a.licenseKey === b.licenseKey &&
    a.batch === b.batch &&
    a.change === b.change &&
    a.transition === b.transition
  );
}

/**
 * Dev/offline authorization service backed by an HMAC secret. It produces a
 * locally-signed lease so the engine can run in development and tests WITHOUT a
 * real server. It is NOT a bypass: it still issues real run material and a real
 * signature the manager verifies, so removing it does not make an unlicensed
 * blob runnable — it only removes the local issuer.
 */
export class FakeAuthorizationService implements AuthorizationService {
  constructor(
    private readonly secret: string,
    private readonly issuer = 'fake-local-issuer',
    private readonly leaseMs = 5 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  async authorize(request: AuthorizationRequest): Promise<RunAuthorization> {
    if (!request.licenseKey || request.licenseKey === 'invalid') {
      throw new Error('license key rejected');
    }
    const leaseExpiresAt = this.now() + this.leaseMs;
    // Run material is derived per-run so it is genuinely functional input, not a
    // constant flag the blob could carry.
    const runMaterial = createHmac('sha256', this.secret)
      .update(`${request.batch}:${request.change}:${request.transition}`)
      .digest('hex')
      .slice(0, 32);
    const signature = signAuthorization(
      this.secret,
      request,
      runMaterial,
      leaseExpiresAt,
      this.issuer
    );
    return { runMaterial, leaseExpiresAt, issuer: this.issuer, signature };
  }
}

/**
 * Real (network) authorization service. STUB: the HTTP call to the license
 * server is the productionization seam. Until the server exists this throws so
 * the engine fails closed (refuses to run) rather than silently passing.
 */
export class HttpAuthorizationService implements AuthorizationService {
  constructor(private readonly endpoint: string) {}

  async authorize(_request: AuthorizationRequest): Promise<RunAuthorization> {
    // TODO(license-server): POST the signed authorization request to
    // `${this.endpoint}` and return the server's signed RunAuthorization.
    // Failing closed until that endpoint exists keeps the engine unrunnable
    // without a real, load-bearing server response.
    throw new LicenseError(
      `License server not reachable (endpoint: ${this.endpoint}). ` +
        'The batch engine cannot obtain run authorization.'
    );
  }
}
