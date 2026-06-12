import { schema } from '@evertrust/db';
import { ReplyClassificationsService } from '../src/outreach/reply-classifications.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAMP_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CAMP_B = 'cccccccc-cccc-cccc-cccc-ccccccccdddd';

// Two orgs' prospects + a mix of drafted / undrafted classification rows so the
// queue assertions exercise BOTH the suggestedReply filter and the org boundary.
function seed() {
  const prospects = new FakeTable([
    { id: 'pa1', organizationId: ORG_A, campaignId: CAMP_A, email: 'a1@aco.com', companyName: 'Alpha', status: 'REPLIED', __seq: 1 },
    { id: 'pa2', organizationId: ORG_A, campaignId: CAMP_A, email: 'a2@aco.com', companyName: null, status: 'REPLIED', __seq: 2 },
    { id: 'pb1', organizationId: ORG_B, campaignId: CAMP_B, email: 'b1@bco.com', companyName: 'Bravo', status: 'REPLIED', __seq: 3 },
  ]);
  const ts = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
  const replyClassifications = new FakeTable([
    // pa1: an UNSURE with NO draft (must NOT be in the queue).
    { id: 'rc-a1-undrafted', prospectId: 'pa1', verdict: 'UNSURE', suggestedReply: null, messageId: null, snoozeUntil: null, model: null, createdAt: ts(1), __seq: 1 },
    // pa1: a later UNSURE WITH a draft (must be in the queue).
    { id: 'rc-a1-drafted', prospectId: 'pa1', verdict: 'UNSURE', suggestedReply: 'Draft for a1', messageId: null, snoozeUntil: null, model: 'gpt-4o', createdAt: ts(2), __seq: 2 },
    // pa2: a drafted row (must be in the queue).
    { id: 'rc-a2-drafted', prospectId: 'pa2', verdict: 'INTERESTED', suggestedReply: 'Draft for a2', messageId: null, snoozeUntil: null, model: null, createdAt: ts(3), __seq: 3 },
    // pb1: a drafted row but in ORG_B (must NOT appear for ORG_A).
    { id: 'rc-b1-drafted', prospectId: 'pb1', verdict: 'UNSURE', suggestedReply: 'Draft for b1', messageId: null, snoozeUntil: null, model: null, createdAt: ts(4), __seq: 4 },
  ]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.prospects, prospects],
      [schema.replyClassifications, replyClassifications],
    ]),
  );
  return { service: new ReplyClassificationsService(db) };
}

describe('ReplyClassificationsService.draftQueue — review queue (org-scoped)', () => {
  it('includes ONLY rows with a non-null suggestedReply, and never another org', async () => {
    const { service } = seed();
    const queue = await service.draftQueue(ORG_A, {});
    const ids = queue.map((r) => r.id).sort();
    // Drafted ORG_A rows only — the undrafted pa1 row and the ORG_B row are excluded.
    expect(ids).toEqual(['rc-a1-drafted', 'rc-a2-drafted']);
    // suggestedReply is non-null on every queue row.
    expect(queue.every((r) => typeof r.suggestedReply === 'string')).toBe(true);
  });

  it('joins prospect context (email + companyName + campaignId)', async () => {
    const { service } = seed();
    const queue = await service.draftQueue(ORG_A, {});
    const a1 = queue.find((r) => r.id === 'rc-a1-drafted')!;
    expect(a1.prospectEmail).toBe('a1@aco.com');
    expect(a1.prospectCompanyName).toBe('Alpha');
    expect(a1.campaignId).toBe(CAMP_A);
    const a2 = queue.find((r) => r.id === 'rc-a2-drafted')!;
    expect(a2.prospectCompanyName).toBeNull(); // nullable companyName passes through
  });

  it('the other org sees only its own drafted row', async () => {
    const { service } = seed();
    const queue = await service.draftQueue(ORG_B, {});
    expect(queue.map((r) => r.id)).toEqual(['rc-b1-drafted']);
  });

  it('filters by prospectId', async () => {
    const { service } = seed();
    const queue = await service.draftQueue(ORG_A, { prospectId: 'pa2' });
    expect(queue.map((r) => r.id)).toEqual(['rc-a2-drafted']);
  });

  it('reports the latest verdict per prospect (newest classification wins)', async () => {
    const { service } = seed();
    const queue = await service.draftQueue(ORG_A, {});
    // pa1's newest row is rc-a1-drafted (UNSURE) — latestVerdict = UNSURE.
    const a1 = queue.find((r) => r.id === 'rc-a1-drafted')!;
    expect(a1.latestVerdict).toBe('UNSURE');
  });
});
