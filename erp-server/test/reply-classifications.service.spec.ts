import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ReplyClassificationsService } from '../src/outreach/reply-classifications.service';
import { getDb, rowsOf, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
// Real UUID for the seeded prospect: the service reads it by id and verdict rows
// FK it via prospectId (the real uuid PK/column rejects 'p1').
const P1 = 'd1111111-0000-0000-0000-000000000001';
const ABSENT = '00000000-0000-0000-0000-0000000000ff';

// Seed one prospect (organizationId/campaignId/email are NOT NULL; FK is off so
// the campaign graph need not exist). The DB fills id only when we omit it; here we
// pin P1 so the create() calls can reference it.
async function seedFixture() {
  await seed(schema.prospects, {
    id: P1,
    organizationId: ORG_A,
    campaignId: CAMP,
    email: 'p1@co.com',
    status: 'EMAILED',
    followupCount: 1,
  });
  return { service: new ReplyClassificationsService(getDb()) };
}

describe('ReplyClassificationsService — verdict → prospect.status projection', () => {
  it('INTERESTED projects status INTERESTED and records the row', async () => {
    const { service } = await seedFixture();
    const res = await service.create({ prospectId: P1, verdict: 'INTERESTED' });
    expect(res.status).toBe('INTERESTED');
    const prospects = await rowsOf(schema.prospects);
    expect(prospects[0]!.status).toBe('INTERESTED');
    const classifications = await rowsOf(schema.replyClassifications);
    expect(classifications).toHaveLength(1);
    expect(classifications[0]!.verdict).toBe('INTERESTED');
  });

  it('MEETING_REQUEST projects status MEETING_SCHEDULED', async () => {
    const { service } = await seedFixture();
    const res = await service.create({
      prospectId: P1,
      verdict: 'MEETING_REQUEST',
    });
    expect(res.status).toBe('MEETING_SCHEDULED');
    const prospects = await rowsOf(schema.prospects);
    expect(prospects[0]!.status).toBe('MEETING_SCHEDULED');
  });

  it('SNOOZE projects NOT_INTERESTED and copies snoozeUntil onto the prospect', async () => {
    const { service } = await seedFixture();
    const when = '2026-08-01T00:00:00.000Z';
    const res = await service.create({
      prospectId: P1,
      verdict: 'SNOOZE',
      snoozeUntil: when,
    });
    expect(res.status).toBe('NOT_INTERESTED');
    const prospects = await rowsOf(schema.prospects);
    expect(prospects[0]!.status).toBe('NOT_INTERESTED');
    expect(prospects[0]!.snoozeUntil).toEqual(new Date(when));
  });

  it('NOT_INTERESTED projects NOT_INTERESTED', async () => {
    const { service } = await seedFixture();
    const res = await service.create({
      prospectId: P1,
      verdict: 'NOT_INTERESTED',
    });
    expect(res.status).toBe('NOT_INTERESTED');
    const prospects = await rowsOf(schema.prospects);
    expect(prospects[0]!.status).toBe('NOT_INTERESTED');
  });

  // Each evidence-only verdict gets its OWN prospect id: truncation is per-test, so
  // re-seeding the SAME pinned id inside one `it` would collide on the real PK.
  it.each(['UNSURE', 'AUTO_REPLY', 'BOUNCE'] as const)(
    '%s leaves the status unchanged (evidence only)',
    async (verdict) => {
      const { service } = await seedFixture();
      const res = await service.create({ prospectId: P1, verdict });
      expect(res.status).toBe('EMAILED'); // untouched
      const prospects = await rowsOf(schema.prospects);
      expect(prospects[0]!.status).toBe('EMAILED');
      // ...but the verdict is still logged as evidence.
      const classifications = await rowsOf(schema.replyClassifications);
      expect(classifications).toHaveLength(1);
    },
  );

  it("does NOT auto-create a lead on INTERESTED (graduation is a later step)", async () => {
    const { service } = await seedFixture();
    await service.create({ prospectId: P1, verdict: 'INTERESTED' });
    const prospects = await rowsOf(schema.prospects);
    expect(prospects[0]!.leadId ?? null).toBeNull();
  });

  it('404s for an unknown prospect', async () => {
    const { service } = await seedFixture();
    await expect(
      service.create({ prospectId: ABSENT, verdict: 'INTERESTED' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReplyClassificationsService.list — needsRag backlog', () => {
  // WHY: the RAG agent pulls UNSURE replies that have no drafted answer yet. Once
  // it POSTs a sibling row WITH a suggestedReply, that prospect must drop out of
  // the backlog so it is not drafted twice.
  it('includes an UNSURE row with no drafted sibling, and joins prospect context', async () => {
    const { service } = await seedFixture();
    await service.create({ prospectId: P1, verdict: 'UNSURE' });

    const backlog = await service.list({ needsRag: true });
    expect(backlog).toHaveLength(1);
    expect(backlog[0]!.prospectId).toBe(P1);
    expect(backlog[0]!.verdict).toBe('UNSURE');
    // Joined prospect context for the RAG agent to act on.
    expect(backlog[0]!.prospectEmail).toBe('p1@co.com');
    expect(backlog[0]!.campaignId).toBe(CAMP);
  });

  it('drops the prospect once a sibling row carries a suggestedReply', async () => {
    const { service } = await seedFixture();
    // The Reply Glock UNSURE verdict (no draft yet).
    await service.create({ prospectId: P1, verdict: 'UNSURE' });
    expect(await service.list({ needsRag: true })).toHaveLength(1);

    // The RAG agent drafts an answer — a new row WITH a suggestedReply.
    await service.create({
      prospectId: P1,
      verdict: 'UNSURE',
      suggestedReply: 'Here is a draft reply.',
    });

    // The prospect is no longer in the backlog (already drafted).
    expect(await service.list({ needsRag: true })).toHaveLength(0);
  });

  it('needsRag ignores non-UNSURE verdicts', async () => {
    const { service } = await seedFixture();
    await service.create({ prospectId: P1, verdict: 'INTERESTED' });
    expect(await service.list({ needsRag: true })).toHaveLength(0);
  });
});
