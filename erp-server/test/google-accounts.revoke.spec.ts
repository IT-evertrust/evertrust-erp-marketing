import { schema } from '@evertrust/db';
import { GoogleAccountsService } from '../src/google/google-accounts.service';
import type { TokenCrypto } from '../src/google/token-crypto';
import type { GoogleOAuthService } from '../src/google/google-oauth.service';
import { getDb, rowsOf, seed } from './real-db';

// A connected mailbox whose Google grant has been REVOKED (the exact state after a
// user removes the account in Settings, which revokes at Google) must not keep
// masquerading as CONNECTED. When a token refresh comes back `invalid_grant`, the
// service reconciles the row to REVOKED so the UI shows "reconnect" instead of a
// silently-empty calendar / inbox. A transient error must NOT flip a healthy account.

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ACC = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// Decrypt must succeed (it runs before the refresh) so the flow reaches the refresh
// call we want to fail; encrypt is unused here. No real crypto key needed.
const fakeCrypto = {
  decrypt: () => 'refresh-token',
  encrypt: (s: string) => s,
  isConfigured: () => true,
} as unknown as TokenCrypto;

// A google-auth-library-shaped invalid_grant error (OAuth body on response.data).
function invalidGrantError(): Error {
  const e = new Error('invalid_grant') as Error & { response?: unknown };
  e.response = { data: { error: 'invalid_grant' } };
  return e;
}

function makeOauth(err: unknown): GoogleOAuthService {
  return {
    refreshAccessToken: async () => {
      throw err;
    },
  } as unknown as GoogleOAuthService;
}

async function seedConnectedAccount() {
  await seed(schema.googleAccounts, [
    {
      id: ACC,
      organizationId: ORG,
      userId: USER,
      googleSub: 'sub-hanna',
      email: 'hanna@evertrust-germany.de',
      scopes: [CALENDAR_SCOPE, GMAIL_SEND_SCOPE],
      refreshTokenEnc: 'enc',
      status: 'CONNECTED',
    },
  ]);
}

async function statusOf(id: string): Promise<string | undefined> {
  const rows = await rowsOf(schema.googleAccounts);
  return rows.find((r) => r.id === id)?.status;
}

describe('GoogleAccountsService — dead-token status reconciliation', () => {
  it('flips a CONNECTED account to REVOKED when the refresh is invalid_grant', async () => {
    await seedConnectedAccount();
    const svc = new GoogleAccountsService(
      getDb(),
      fakeCrypto,
      makeOauth(invalidGrantError()),
    );

    const res = await svc.resolveMailboxForAccount(ORG, ACC, 'calendar');

    expect(res.ok).toBe(false);
    expect(await statusOf(ACC)).toBe('REVOKED');
    const row = (await rowsOf(schema.googleAccounts)).find((r) => r.id === ACC);
    expect(row?.lastError).toBeTruthy();
  });

  it('leaves the account CONNECTED on a transient (non-invalid_grant) error', async () => {
    await seedConnectedAccount();
    const svc = new GoogleAccountsService(
      getDb(),
      fakeCrypto,
      makeOauth(new Error('network down')),
    );

    const res = await svc.resolveMailboxForAccount(ORG, ACC, 'calendar');

    expect(res.ok).toBe(false);
    expect(await statusOf(ACC)).toBe('CONNECTED');
  });

  it('also reconciles via the org-default resolver path (gmail) — covers email too', async () => {
    await seedConnectedAccount();
    const svc = new GoogleAccountsService(
      getDb(),
      fakeCrypto,
      makeOauth(invalidGrantError()),
    );

    // No default-mailbox pointer set → resolveMailbox falls back to the org's single
    // connected account, then fails the refresh: same reconciliation must apply.
    const res = await svc.resolveMailbox(ORG, 'gmail');

    expect(res.ok).toBe(false);
    expect(await statusOf(ACC)).toBe('REVOKED');
  });
});
