import { schema } from '@evertrust/db';
import { GoogleCalendarReadService } from '../src/google/google-calendar-read.service';
import { getDb, seed } from './real-db';

// getOrgTimeZones is the public accessor Engage uses to render meeting-email times in
// the SAME zones the calendar uses (org override ?? env SALES_TIME_ZONE ?? Europe/Berlin).
function makeService() {
  return new GoogleCalendarReadService(
    {} as never, // googleAccounts — unused on this path
    getDb(), // real db
    { get: () => '' } as never, // config: SALES_TIME_ZONE empty → default fallback
  );
}

describe('GoogleCalendarReadService.getOrgTimeZones', () => {
  it('falls back to Europe/Berlin with no secondary for an unconfigured org', async () => {
    const tz = await makeService().getOrgTimeZones('00000000-0000-0000-0000-000000000000');
    expect(tz.primary).toBe('Europe/Berlin');
    expect(tz.secondary).toBeNull();
  });

  it('returns the org override + GMT+7 secondary when configured', async () => {
    const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await seed(schema.orgConfig, {
      organizationId: ORG,
      salesTimeZone: 'Europe/Berlin',
      salesSecondaryTimeZone: 'Asia/Bangkok',
    });
    const tz = await makeService().getOrgTimeZones(ORG);
    expect(tz.primary).toBe('Europe/Berlin');
    expect(tz.secondary).toBe('Asia/Bangkok');
  });
});
