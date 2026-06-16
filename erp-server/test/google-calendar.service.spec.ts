import { GoogleCalendarService } from '../src/arsenal/google-calendar.service';
import type { AppConfigService } from '../src/config/app-config.service';
import type { GoogleAccountsService } from '../src/google/google-accounts.service';

// GoogleCalendarService lists an org's Google Calendars for the AIM Calendar dropdown.
// It resolves the org's default connected Calendar account FIRST (per-org token), and
// FALLS BACK to a single deployment-wide authorized_user token when the org has none.
// These tests exercise the FALLBACK path: the per-org resolver returns null, so the
// service uses GOOGLE_CALENDAR_TOKEN_JSON. The contract under test:
// (1) blank/missing token → { configured: false, calendars: [] }; (2) a configured
// happy path maps calendarList items + sorts primary-first then alphabetical; (3) any
// failure (non-2xx or a throwing fetch) degrades to { configured: false, calendars: [] }
// — listCalendars() must NEVER throw, since it powers a page-load dropdown.
//
// google-auth-library is mocked so OAuth2Client.getAccessToken() resolves a fake token
// with no network; the live calendarList GET is mocked via globalThis.fetch.

const ORG = 'org-1';

// A GoogleAccountsService whose per-org resolver returns null, so the service uses the
// global GOOGLE_CALENDAR_TOKEN_JSON fallback these tests cover.
function makeGoogleAccounts(): GoogleAccountsService {
  return {
    getAccessTokenForOrg: jest.fn().mockResolvedValue(null),
  } as unknown as GoogleAccountsService;
}

const getAccessToken = jest.fn();
const setCredentials = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    setCredentials,
    getAccessToken,
  })),
}));

// A valid authorized_user token JSON for the configured paths.
const TOKEN_JSON = JSON.stringify({
  client_id: 'cid.apps.googleusercontent.com',
  client_secret: 'secret',
  refresh_token: 'refresh',
  type: 'authorized_user',
});

function makeConfig(token = ''): AppConfigService {
  const values: Record<string, string> = { GOOGLE_CALENDAR_TOKEN_JSON: token };
  return { get: (k: string) => values[k] ?? '' } as unknown as AppConfigService;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  getAccessToken.mockReset();
  setCredentials.mockReset();
  getAccessToken.mockResolvedValue({ token: 'ya29.fake-access-token' });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('GoogleCalendarService — listCalendars', () => {
  it('returns { configured: false, calendars: [] } when the token is blank', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const service = new GoogleCalendarService(makeConfig(''), makeGoogleAccounts());

    expect(await service.listCalendars(ORG)).toEqual({
      configured: false,
      calendars: [],
    });
    // Not configured → it must not even attempt a network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps calendarList items and sorts primary-first then alphabetical', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: 'zebra@group', summary: 'Zebra' },
          { id: 'primary@me', summary: 'Me', primary: true },
          { id: 'apple@group', summary: 'Bravo', summaryOverride: 'Alpha' },
        ],
      }),
    }) as unknown as typeof fetch;

    const service = new GoogleCalendarService(
      makeConfig(TOKEN_JSON),
      makeGoogleAccounts(),
    );
    const result = await service.listCalendars(ORG);

    expect(result.configured).toBe(true);
    expect(result.calendars).toEqual([
      // Primary first…
      { id: 'primary@me', summary: 'Me', primary: true },
      // …then alphabetical by display label (summaryOverride 'Alpha' wins over 'Bravo').
      { id: 'apple@group', summary: 'Alpha', primary: false },
      { id: 'zebra@group', summary: 'Zebra', primary: false },
    ]);
    // The refresh token was applied before the access token was minted.
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: 'refresh' });
  });

  it('returns { configured: false, calendars: [] } on a non-2xx calendarList response', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const service = new GoogleCalendarService(
      makeConfig(TOKEN_JSON),
      makeGoogleAccounts(),
    );
    expect(await service.listCalendars(ORG)).toEqual({
      configured: false,
      calendars: [],
    });
  });

  it('returns { configured: false, calendars: [] } and never throws when fetch rejects', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const service = new GoogleCalendarService(
      makeConfig(TOKEN_JSON),
      makeGoogleAccounts(),
    );
    await expect(service.listCalendars(ORG)).resolves.toEqual({
      configured: false,
      calendars: [],
    });
  });

  it('returns { configured: false, calendars: [] } when the token JSON is malformed', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const service = new GoogleCalendarService(
      makeConfig('{not valid json'),
      makeGoogleAccounts(),
    );

    expect(await service.listCalendars(ORG)).toEqual({
      configured: false,
      calendars: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
