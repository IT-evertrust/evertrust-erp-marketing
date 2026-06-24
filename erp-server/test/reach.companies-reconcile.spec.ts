import { schema } from '@evertrust/db';
import { ReachRepository } from '../src/reach/reach.repository';
import { getDb, seed } from './real-db';

// WHY: an older scraper version could record reach_aims.companies WITHOUT persisting
// the reach_leads rows (phantom count, e.g. 98 companies / 0 leads). findAims now derives
// `companies` from the LIVE reach_leads count so the UI never shows a number that doesn't
// match the leads list — for legacy rows and any future drift alike.

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AIM_STALE = '11110000-0000-0000-0000-000000000001';
const AIM_REAL = '11110000-0000-0000-0000-000000000002';

describe('ReachRepository.findAims — companies reconciled to live reach_leads', () => {
  it('ignores a stale denormalized count and surfaces the real lead count', async () => {
    await seed(schema.reachAims, [
      // Phantom: stored companies = 98 but ZERO reach_leads → must read 0.
      {
        id: AIM_STALE,
        organizationId: ORG,
        name: 'Stale',
        niche: 'Cybersecurity',
        region: 'Anywhere',
        companies: 98,
        status: 'COMPLETED',
      },
      // Honest-but-stale-low: stored 0 but 2 reach_leads → must read 2.
      {
        id: AIM_REAL,
        organizationId: ORG,
        name: 'Real',
        niche: 'IT',
        region: 'Anywhere',
        companies: 0,
        status: 'COMPLETED',
      },
    ]);
    await seed(schema.reachLeads, [
      { organizationId: ORG, aimId: AIM_REAL, company: 'Alpha GmbH' },
      { organizationId: ORG, aimId: AIM_REAL, company: 'Beta GmbH' },
    ]);

    const repo = new ReachRepository(getDb());
    const byId = new Map((await repo.findAims(ORG)).map((a) => [a.id, a.companies]));

    expect(byId.get(AIM_STALE)).toBe(0); // phantom 98 dropped to the real 0
    expect(byId.get(AIM_REAL)).toBe(2); // real lead count surfaced
  });
});
