import { schema } from '@evertrust/db';
import { GoogleCalendarReadService } from '../src/google/google-calendar-read.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb } from './fake-db';

// resolveEventCampaigns maps external attendee emails → the campaign ids they belong
// to, for the CALLING org only. A prospect email can sit in several campaigns; a
// same-email row in another org must never leak in.

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAMP_A1 = 'cccccccc-aaaa-aaaa-aaaa-000000000001';
const CAMP_A2 = 'cccccccc-aaaa-aaaa-aaaa-000000000002';
const CAMP_B1 = 'cccccccc-bbbb-bbbb-bbbb-000000000001';

const config = { get: () => '' } as unknown as AppConfigService;

function makeService() {
  const prospects = new FakeTable([
    { id: 'p1', organizationId: ORG_A, campaignId: CAMP_A1, email: 'buyer@acme.io', __seq: 1 },
    { id: 'p2', organizationId: ORG_A, campaignId: CAMP_A2, email: 'buyer@acme.io', __seq: 2 },
    { id: 'p3', organizationId: ORG_A, campaignId: CAMP_A1, email: 'other@acme.io', __seq: 3 },
    // Same email, DIFFERENT org — must be excluded from ORG_A results.
    { id: 'p4', organizationId: ORG_B, campaignId: CAMP_B1, email: 'buyer@acme.io', __seq: 4 },
  ]);
  const { db } = makeFakeDb(new Map<unknown, FakeTable>([[schema.prospects, prospects]]));
  // googleAccounts is unused by resolveEventCampaigns.
  return new GoogleCalendarReadService({} as never, db, config);
}

// resolveEventCampaigns is private; exercise it directly.
function resolve(svc: GoogleCalendarReadService, org: string, emails: string[]) {
  return (svc as unknown as {
    resolveEventCampaigns(o: string, e: string[]): Promise<Map<string, string[]>>;
  }).resolveEventCampaigns(org, emails);
}

describe('GoogleCalendarReadService.resolveEventCampaigns', () => {
  it('groups a multi-campaign email and excludes other-org rows', async () => {
    const map = await resolve(makeService(), ORG_A, ['buyer@acme.io', 'nobody@x.com']);
    expect([...(map.get('buyer@acme.io') ?? [])].sort()).toEqual([CAMP_A1, CAMP_A2].sort());
    // ORG_B's CAMP_B1 for the same email never appears.
    expect(map.get('buyer@acme.io')).not.toContain(CAMP_B1);
    // An attendee with no prospect is simply absent.
    expect(map.get('nobody@x.com')).toBeUndefined();
  });

  it('is case-insensitive on the attendee email', async () => {
    const map = await resolve(makeService(), ORG_A, ['BUYER@ACME.IO']);
    expect((map.get('buyer@acme.io') ?? []).length).toBe(2);
  });

  it('returns an empty map for no emails', async () => {
    const map = await resolve(makeService(), ORG_A, []);
    expect(map.size).toBe(0);
  });
});
