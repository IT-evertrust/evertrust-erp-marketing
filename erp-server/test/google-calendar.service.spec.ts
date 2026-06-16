import { GoogleCalendarService } from '../src/arsenal/google-calendar.service';
import type { AppConfigService } from '../src/config/app-config.service';

// GoogleCalendarService lists the deployment's Google Calendars for the AIM Calendar
// dropdown via a SINGLE deployment-wide authorized_user token. The contract under test:
// (1) blank/missing token → { configured: false, calendars: [] }; (2) a configured
// happy path maps calendarList items + sorts primary-first then alphabetical; (3) any
// failure (non-2xx or a throwing fetch) degrades to { configured: false, calendars: [] }
// — listCalendars() must NEVER throw, since it powers a page-load dropdown.
//
// google-auth-library is mocked so OAuth2Client.getAccessToken() resolves a fake token
// with no network; the live calendarList GET is mocked via globalThis.fetch.

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
    const service = new GoogleCalendarService(makeConfig(''));

    expect(await service.listCalendars()).toEqual({
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

    const service = new GoogleCalendarService(makeConfig(TOKEN_JSON));
    const result = await service.listCalendars();

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

    const service = new GoogleCalendarService(makeConfig(TOKEN_JSON));
    expect(await service.listCalendars()).toEqual({
      configured: false,
      calendars: [],
    });
  });

  it('returns { configured: false, calendars: [] } and never throws when fetch rejects', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const service = new GoogleCalendarService(makeConfig(TOKEN_JSON));
    await expect(service.listCalendars()).resolves.toEqual({
      configured: false,
      calendars: [],
    });
  });

  it('returns { configured: false, calendars: [] } when the token JSON is malformed', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const service = new GoogleCalendarService(makeConfig('{not valid json'));

    expect(await service.listCalendars()).toEqual({
      configured: false,
      calendars: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
