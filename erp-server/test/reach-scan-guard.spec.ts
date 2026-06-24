import { schema } from '@evertrust/db';
import { ReachRepository } from '../src/reach/reach.repository';
import { getDb, seed } from './real-db';

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AIM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const LEAD_SENT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const LEAD_UNSENT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// The Engage scan only classifies leads this campaign has emailed — leadIdsWithSends is
// that gate. A 0-send lead's Gmail thread is pre-existing/stale and must not be ingested.
describe('ReachRepository.leadIdsWithSends', () => {
  it('returns only leads the campaign has actually sent to', async () => {
    await seed(schema.reachSends, {
      organizationId: ORG,
      aimId: AIM,
      leadId: LEAD_SENT,
      round: 'cold',
    });
    const ids = await new ReachRepository(getDb()).leadIdsWithSends(ORG, AIM);
    expect(ids.has(LEAD_SENT)).toBe(true);
    expect(ids.has(LEAD_UNSENT)).toBe(false);
  });
});
