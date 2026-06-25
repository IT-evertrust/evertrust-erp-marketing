import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { schema } from '@evertrust/db';
import { GoogleAuthService } from '../src/auth/google-auth.service';
import { AuthController } from '../src/auth/auth.controller';
import type { AppConfigService } from '../src/config/app-config.service';
import type {
  TokenVerifier,
  VerifiedGoogleUser,
} from '../src/auth/token-verifier';
import { getDb, rowsOf, seed } from './real-db';

// google-auth-library is mocked so the authorization-CODE path never hits the
// network: OAuth2Client.getToken is a jest mock the tests pin per-case. The
// ID-token path doesn't touch OAuth2Client (it uses the injected verifier), so
// this mock only affects loginWithGoogleCode.
const getToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ getToken })),
}));

// GoogleAuthService is exercised with a FAKE TokenVerifier (no network) over the
// in-memory fake db. The verifier returns whatever the test pins, so we drive
// every branch: existing-user login, EMPLOYEE join on a known domain, brand-new
// org + SUPER_ADMIN, the public-domain 403, and the emailVerified-false 401. A
// final controller-level test pins that POST /auth/login is now a hard 403.

const EVERTRUST_ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ALICE = 'a1111111-1111-1111-1111-111111111111';

// A fake config that answers GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (both set
// unless a test overrides them to '' to drive a 503 path) and the cookie flags
// the controller reads. Cast through unknown — the service only calls .get().
function fakeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    COOKIE_SAMESITE: 'lax',
    COOKIE_SECURE: false,
    ...overrides,
  };
  return {
    get: (k: string) => values[k],
  } as unknown as AppConfigService;
}

// FAKE TokenVerifier: returns a pinned identity, or throws to simulate an invalid
// token. No google-auth-library, no HTTP.
function fakeVerifier(
  result: VerifiedGoogleUser | Error,
): TokenVerifier {
  return {
    verify: () =>
      result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result),
  };
}

// Builds the service over the shared real db. Seeds the EverTrust org (domain
// 'evertrust-germany.de') + Alice (an existing SUPER_ADMIN) so the "existing
// user" and "join existing domain" branches have backing rows. Async — every
// call site awaits it.
async function make(
  verifier: TokenVerifier,
  config: AppConfigService = fakeConfig(),
) {
  await seed(schema.organizations, [
    {
      id: EVERTRUST_ORG,
      name: 'Evertrust Germany',
      slug: 'evertrust',
      domain: 'evertrust-germany.de',
    },
  ]);
  await seed(schema.users, [
    {
      id: ALICE,
      organizationId: EVERTRUST_ORG,
      name: 'Alice',
      email: 'alice@evertrust-germany.de',
      role: 'SUPER_ADMIN',
      position: 'CEO',
      department: 'OPERATIONS',
      permissions: null,
      active: true,
    },
  ]);
  const db = getDb();
  const jwt = new JwtService({ secret: 'test-secret' });
  const service = new GoogleAuthService(db, jwt, config, verifier);
  return { service, jwt };
}

function verified(over: Partial<VerifiedGoogleUser> = {}): VerifiedGoogleUser {
  return {
    email: 'someone@evertrust-germany.de',
    emailVerified: true,
    name: 'Some One',
    ...over,
  };
}

// Build a decodable (UNSIGNED) Google id_token for the code-flow tests. The code path
// now trusts the token from the direct token-endpoint exchange and decodes it OFFLINE,
// so only the base64url payload matters (header + signature are ignored — no cert fetch).
// Defaults to a valid audience/issuer and a far-future expiry; override per case to drive
// the offline-validation failure branches.
function fakeIdToken(over: Record<string, unknown> = {}): string {
  const payload = {
    aud: 'test-google-client-id.apps.googleusercontent.com',
    iss: 'accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'someone@evertrust-germany.de',
    email_verified: true,
    name: 'Some One',
    ...over,
  };
  const seg = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${seg({ alg: 'RS256', typ: 'JWT' })}.${seg(payload)}.sig`;
}

describe('GoogleAuthService — loginWithGoogle', () => {
  it('(a) logs in an existing user matched by email; role + org preserved, no credential row created', async () => {
    const { service, jwt } = await make(
      fakeVerifier(verified({ email: 'alice@evertrust-germany.de' })),
    );

    const res = await service.loginWithGoogle('tok');

    expect(res.user.id).toBe(ALICE);
    expect(res.user.role).toBe('SUPER_ADMIN');
    expect(res.user.organizationId).toBe(EVERTRUST_ORG);
    expect(res.user.organizationName).toBe('Evertrust Germany');
    // No new user, no password credential.
    expect(await rowsOf(schema.users)).toHaveLength(1);
    expect(await rowsOf(schema.authCredentials)).toHaveLength(0);
    // The JWT is the same payload AuthService.login signs.
    const payload = jwt.verify<{ sub: string; role: string; org: string }>(
      res.accessToken,
    );
    expect(payload).toMatchObject({
      sub: ALICE,
      role: 'SUPER_ADMIN',
      org: EVERTRUST_ORG,
    });
  });

  it('matches an existing user case-insensitively (uppercase Google email)', async () => {
    const { service } = await make(
      fakeVerifier(verified({ email: 'ALICE@EverTrust-Germany.DE' })),
    );
    const res = await service.loginWithGoogle('tok');
    expect(res.user.id).toBe(ALICE);
  });

  it('(b) a NEW user on the existing evertrust domain joins that org as EMPLOYEE', async () => {
    const { service } = await make(
      fakeVerifier(
        verified({ email: 'newhire@evertrust-germany.de', name: 'New Hire' }),
      ),
    );

    const res = await service.loginWithGoogle('tok');

    expect(res.user.email).toBe('newhire@evertrust-germany.de');
    expect(res.user.role).toBe('EMPLOYEE');
    expect(res.user.organizationId).toBe(EVERTRUST_ORG);
    // Joined the EXISTING org — no new org created.
    expect(await rowsOf(schema.organizations)).toHaveLength(1);
    expect(await rowsOf(schema.users)).toHaveLength(2);
    expect(await rowsOf(schema.authCredentials)).toHaveLength(0);
  });

  it('(c-guard) a 2nd login to an org that already has a SUPER_ADMIN yields EMPLOYEE, never a 2nd SA', async () => {
    // The seeded EverTrust org already has ALICE (SUPER_ADMIN). A second person
    // on that domain must join as EMPLOYEE — the org's single SA is preserved.
    const { service } = await make(
      fakeVerifier(
        verified({ email: 'colleague@evertrust-germany.de', name: 'Colleague' }),
      ),
    );

    const res = await service.loginWithGoogle('tok');

    expect(res.user.role).toBe('EMPLOYEE');
    expect(res.user.role).not.toBe('SUPER_ADMIN');
    expect(res.user.organizationId).toBe(EVERTRUST_ORG);
    // Exactly one SUPER_ADMIN in the org after the join (still ALICE).
    const superAdmins = (await rowsOf(schema.users)).filter(
      (u) => u.role === 'SUPER_ADMIN',
    );
    expect(superAdmins).toHaveLength(1);
    expect(superAdmins[0]?.id).toBe(ALICE);
  });

  it('(c) a brand-new company domain creates the org + first user as SUPER_ADMIN', async () => {
    const { service } = await make(
      fakeVerifier(verified({ email: 'founder@acme-widgets.com', name: 'F' })),
    );

    const res = await service.loginWithGoogle('tok');

    expect(res.user.role).toBe('SUPER_ADMIN');
    // A new org row exists, derived from the domain, with the source domain stored.
    const orgs = await rowsOf(schema.organizations);
    expect(orgs).toHaveLength(2);
    const created = orgs.find((o) => o.domain === 'acme-widgets.com');
    expect(created).toBeDefined();
    expect(created?.name).toBe('Acme Widgets');
    expect(created?.slug).toBe('acme-widgets-com');
    expect(res.user.organizationId).toBe(created?.id);
    // First user owns the org (SUPER_ADMIN), never the reserved OWNER role.
    expect(res.user.role).not.toBe('OWNER');
    expect(await rowsOf(schema.users)).toHaveLength(2);
  });

  it('suffixes the slug when a derived slug already belongs to an unrelated org', async () => {
    const { service } = await make(
      fakeVerifier(verified({ email: 'x@acme-widgets.com' })),
    );
    // Pre-seed an unrelated org that already owns the slug 'acme-widgets-com'.
    await seed(schema.organizations, [
      {
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        name: 'Other',
        slug: 'acme-widgets-com',
        domain: 'other.test',
      },
    ]);

    await service.loginWithGoogle('tok');

    const created = (await rowsOf(schema.organizations)).find(
      (o) => o.domain === 'acme-widgets.com',
    );
    expect(created?.slug).toBe('acme-widgets-com-2');
  });

  it('(d) a public/free email domain is rejected with 403', async () => {
    const { service } = await make(
      fakeVerifier(verified({ email: 'someone@gmail.com' })),
    );
    await expect(service.loginWithGoogle('tok')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Nothing provisioned.
    expect(await rowsOf(schema.users)).toHaveLength(1);
    expect(await rowsOf(schema.organizations)).toHaveLength(1);
  });

  it('(e) an unverified Google email is rejected with 401', async () => {
    const { service } = await make(
      fakeVerifier(verified({ emailVerified: false })),
    );
    await expect(service.loginWithGoogle('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('an invalid token (verifier throws) is rejected with 401', async () => {
    const { service } = await make(fakeVerifier(new Error('bad signature')));
    await expect(service.loginWithGoogle('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns 503 when GOOGLE_CLIENT_ID is not configured', async () => {
    const { service } = await make(
      fakeVerifier(verified()),
      fakeConfig({ GOOGLE_CLIENT_ID: '' }),
    );
    await expect(service.loginWithGoogle('tok')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('GoogleAuthService — loginWithGoogleCode (authorization-code path)', () => {
  beforeEach(() => {
    getToken.mockReset();
  });

  it('exchanges the code, decodes the id_token, and provisions via the SHARED path (existing user)', async () => {
    // The exchange returns an id_token carrying Alice's email; it is decoded OFFLINE
    // (no verifier / no cert fetch) and mapped to the existing user.
    getToken.mockResolvedValue({
      tokens: { id_token: fakeIdToken({ email: 'alice@evertrust-germany.de' }) },
    });
    const { service, jwt } = await make(fakeVerifier(verified()));

    const res = await service.loginWithGoogleCode('auth-code');

    // Identical outcome to the idToken path: same user, no credential row.
    expect(res.user.id).toBe(ALICE);
    expect(res.user.role).toBe('SUPER_ADMIN');
    expect(res.user.organizationId).toBe(EVERTRUST_ORG);
    expect(await rowsOf(schema.users)).toHaveLength(1);
    expect(await rowsOf(schema.authCredentials)).toHaveLength(0);
    // The code was exchanged with the literal 'postmessage' redirect_uri.
    expect(getToken).toHaveBeenCalledWith({
      code: 'auth-code',
      redirect_uri: 'postmessage',
    });
    const payload = jwt.verify<{ sub: string; role: string; org: string }>(
      res.accessToken,
    );
    expect(payload).toMatchObject({
      sub: ALICE,
      role: 'SUPER_ADMIN',
      org: EVERTRUST_ORG,
    });
  });

  it('shares the public-domain 403 gate with the idToken path', async () => {
    getToken.mockResolvedValue({
      tokens: { id_token: fakeIdToken({ email: 'someone@gmail.com' }) },
    });
    const { service } = await make(fakeVerifier(verified()));
    await expect(service.loginWithGoogleCode('auth-code')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('maps an exchange failure to 401', async () => {
    getToken.mockRejectedValue(new Error('invalid_grant'));
    const { service } = await make(fakeVerifier(verified()));
    await expect(service.loginWithGoogleCode('bad-code')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps a missing id_token in the token response to 401', async () => {
    getToken.mockResolvedValue({ tokens: { access_token: 'only-access' } });
    const { service } = await make(fakeVerifier(verified()));
    await expect(service.loginWithGoogleCode('auth-code')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps a malformed exchanged id_token to 401', async () => {
    getToken.mockResolvedValue({ tokens: { id_token: 'not-a-valid-jwt' } });
    const { service } = await make(fakeVerifier(verified()));
    await expect(service.loginWithGoogleCode('auth-code')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an exchanged id_token whose audience is not our client id with 401', async () => {
    getToken.mockResolvedValue({
      tokens: { id_token: fakeIdToken({ aud: 'a-different-client-id' }) },
    });
    const { service } = await make(fakeVerifier(verified()));
    await expect(service.loginWithGoogleCode('auth-code')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an exchanged id_token with email_verified=false with 401', async () => {
    getToken.mockResolvedValue({
      tokens: { id_token: fakeIdToken({ email_verified: false }) },
    });
    const { service } = await make(fakeVerifier(verified()));
    await expect(service.loginWithGoogleCode('auth-code')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns 503 when GOOGLE_CLIENT_SECRET is not configured (code flow needs the secret)', async () => {
    const { service } = await make(
      fakeVerifier(verified()),
      fakeConfig({ GOOGLE_CLIENT_SECRET: '' }),
    );
    await expect(service.loginWithGoogleCode('auth-code')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // Configured-check fails BEFORE any exchange attempt.
    expect(getToken).not.toHaveBeenCalled();
  });

  it('returns 503 when GOOGLE_CLIENT_ID is not configured', async () => {
    const { service } = await make(
      fakeVerifier(verified()),
      fakeConfig({ GOOGLE_CLIENT_ID: '' }),
    );
    await expect(service.loginWithGoogleCode('auth-code')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('AuthController — password login disabled', () => {
  it('(f) POST /auth/login throws 403 ForbiddenException', () => {
    const controller = new AuthController(
      // AuthService + GoogleAuthService are never reached on this path.
      {} as never,
      {} as never,
      fakeConfig(),
    );
    expect(() =>
      controller.login({ email: 'a@b.de', password: 'x' } as never),
    ).toThrow(ForbiddenException);
  });
});
