import { schema } from '@evertrust/db';
import { ReplyClassificationsService } from '../src/outreach/reply-classifications.service';
import { getDb, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAMP_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CAMP_B = 'cccccccc-cccc-cccc-cccc-ccccccccdddd';

// Real UUIDs for the seeded prospects (PK + FK target for the classification rows).
const PA1 = 'aa000000-0000-0000-0000-0000000000a1';
const PA2 = 'aa000000-0000-0000-0000-0000000000a2';
const PB1 = 'bb000000-0000-0000-0000-0000000000b1';

// Real UUIDs for the classification rows the queue asserts on by id.
const RC_A1_UNDRAFTED = 'cc000000-0000-0000-0000-000000000a10';
const RC_A1_DRAFTED = 'cc000000-0000-0000-0000-000000000a11';
const RC_A2_DRAFTED = 'cc000000-0000-0000-0000-000000000a20';
const RC_B1_DRAFTED = 'cc000000-0000-0000-0000-000000000b10';

// Two orgs' prospects + a mix of drafted / undrafted classification rows so the
// queue assertions exercise BOTH the suggestedReply filter and the org boundary.
async function seedFixture() {
  await seed(schema.prospects, [
    { id: PA1, organizationId: ORG_A, campaignId: CAMP_A, email: 'a1@aco.com', companyName: 'Alpha', status: 'REPLIED' },
    { id: PA2, organizationId: ORG_A, campaignId: CAMP_A, email: 'a2@aco.com', companyName: null, status: 'REPLIED' },
    { id: PB1, organizationId: ORG_B, campaignId: CAMP_B, email: 'b1@bco.com', companyName: 'Bravo', status: 'REPLIED' },
  ]);
  const ts = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
  await seed(schema.replyClassifications, [
    // pa1: an UNSURE with NO draft (must NOT be in the queue).
    { id: RC_A1_UNDRAFTED, prospectId: PA1, verdict: 'UNSURE', suggestedReply: null, messageId: null, snoozeUntil: null, model: null, createdAt: ts(1) },
    // pa1: a later UNSURE WITH a draft (must be in the queue).
    { id: RC_A1_DRAFTED, prospectId: PA1, verdict: 'UNSURE', suggestedReply: 'Draft for a1', messageId: null, snoozeUntil: null, model: 'gpt-4o', createdAt: ts(2) },
    // pa2: a drafted row (must be in the queue).
    { id: RC_A2_DRAFTED, prospectId: PA2, verdict: 'INTERESTED', suggestedReply: 'Draft for a2', messageId: null, snoozeUntil: null, model: null, createdAt: ts(3) },
    // pb1: a drafted row but in ORG_B (must NOT appear for ORG_A).
    { id: RC_B1_DRAFTED, prospectId: PB1, verdict: 'UNSURE', suggestedReply: 'Draft for b1', messageId: null, snoozeUntil: null, model: null, createdAt: ts(4) },
  ]);
  return { service: new ReplyClassificationsService(getDb()) };
}

describe('ReplyClassificationsService.draftQueue — review queue (org-scoped)', () => {
  it('includes ONLY rows with a non-null suggestedReply, and never another org', async () => {
    const { service } = await seedFixture();
    const queue = await service.draftQueue(ORG_A, {});
    const ids = queue.map((r) => r.id).sort();
    // Drafted ORG_A rows only — the undrafted pa1 row and the ORG_B row are excluded.
    expect(ids).toEqual([RC_A1_DRAFTED, RC_A2_DRAFTED].sort());
    // suggestedReply is non-null on every queue row.
    expect(queue.every((r) => typeof r.suggestedReply === 'string')).toBe(true);
  });

  it('joins prospect context (email + companyName + campaignId)', async () => {
    const { service } = await seedFixture();
    const queue = await service.draftQueue(ORG_A, {});
    const a1 = queue.find((r) => r.id === RC_A1_DRAFTED)!;
    expect(a1.prospectEmail).toBe('a1@aco.com');
    expect(a1.prospectCompanyName).toBe('Alpha');
    expect(a1.campaignId).toBe(CAMP_A);
    const a2 = queue.find((r) => r.id === RC_A2_DRAFTED)!;
    expect(a2.prospectCompanyName).toBeNull(); // nullable companyName passes through
  });

  it('the other org sees only its own drafted row', async () => {
    const { service } = await seedFixture();
    const queue = await service.draftQueue(ORG_B, {});
    expect(queue.map((r) => r.id)).toEqual([RC_B1_DRAFTED]);
  });

  it('filters by prospectId', async () => {
    const { service } = await seedFixture();
    const queue = await service.draftQueue(ORG_A, { prospectId: PA2 });
    expect(queue.map((r) => r.id)).toEqual([RC_A2_DRAFTED]);
  });

  it('reports the latest verdict per prospect (newest classification wins)', async () => {
    const { service } = await seedFixture();
    const queue = await service.draftQueue(ORG_A, {});
    // pa1's newest row is rc-a1-drafted (UNSURE) — latestVerdict = UNSURE.
    const a1 = queue.find((r) => r.id === RC_A1_DRAFTED)!;
    expect(a1.latestVerdict).toBe('UNSURE');
  });
});
