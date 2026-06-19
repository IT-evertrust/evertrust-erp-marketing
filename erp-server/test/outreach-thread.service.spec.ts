import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { OutreachMessagesService } from '../src/outreach/outreach-messages.service';
import { getDb, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const CAMP_A = '11111111-1111-1111-1111-111111111111';
const CAMP_B = '22222222-2222-2222-2222-222222222222';
const PA1 = 'aaaa1111-aaaa-1111-aaaa-111111111111';
const PB1 = 'bbbb1111-bbbb-1111-bbbb-111111111111';
const M1 = '00000000-0000-0000-0000-000000000001';
const M2 = '00000000-0000-0000-0000-000000000002';
const M3 = '00000000-0000-0000-0000-000000000003';

// The ledger has no organizationId — tenancy is via the prospect. Seed a prospect
// per org so the JWT thread read confines to the caller's org (404 cross-org).
async function makeService() {
  await seed(schema.prospects, [
    { id: PA1, organizationId: ORG_A, campaignId: CAMP_A, email: 'a1@aco.com' },
    { id: PB1, organizationId: ORG_B, campaignId: CAMP_B, email: 'b1@bco.com' },
  ]);
  await seed(schema.outreachMessages, [
    { id: M1, prospectId: PA1, direction: 'OUTBOUND', status: 'SENT', subject: 'Hi' },
    { id: M2, prospectId: PA1, direction: 'INBOUND', status: 'RECEIVED', subject: 'Re: Hi' },
    { id: M3, prospectId: PB1, direction: 'OUTBOUND', status: 'SENT', subject: 'Hi B' },
  ]);
  return new OutreachMessagesService(getDb());
}

describe('OutreachMessagesService.listForOrg — JWT conversation timeline (org-scoped)', () => {
  it('returns the prospect thread when the prospect is in the caller org', async () => {
    const service = await makeService();
    const rows = await service.listForOrg(ORG_A, PA1);
    expect(rows.map((r) => r.id).sort()).toEqual([M1, M2].sort());
  });

  it('404s when the prospect belongs to another org (no cross-org thread read)', async () => {
    const service = await makeService();
    await expect(service.listForOrg(ORG_A, PB1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s an unknown prospect', async () => {
    const service = await makeService();
    await expect(
      service.listForOrg(ORG_A, '99999999-9999-9999-9999-999999999999'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
