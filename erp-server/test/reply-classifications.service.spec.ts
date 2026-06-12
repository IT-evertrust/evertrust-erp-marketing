import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { ReplyClassificationsService } from '../src/outreach/reply-classifications.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function seed() {
  const prospects = new FakeTable([
    {
      id: 'p1',
      organizationId: ORG_A,
      campaignId: CAMP,
      email: 'p1@co.com',
      status: 'EMAILED',
      followupCount: 1,
      __seq: 1,
    },
  ]);
  const replyClassifications = new FakeTable([]);
  const auditLog = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.prospects, prospects],
      [schema.replyClassifications, replyClassifications],
      [schema.auditLog, auditLog],
    ]),
  );
  return {
    service: new ReplyClassificationsService(db),
    prospects,
    replyClassifications,
  };
}

describe('ReplyClassificationsService — verdict → prospect.status projection', () => {
  it('INTERESTED projects status INTERESTED and records the row', async () => {
    const { service, prospects, replyClassifications } = seed();
    const res = await service.create({ prospectId: 'p1', verdict: 'INTERESTED' });
    expect(res.status).toBe('INTERESTED');
    expect(prospects.rows[0]!.status).toBe('INTERESTED');
    expect(replyClassifications.rows).toHaveLength(1);
    expect(replyClassifications.rows[0]!.verdict).toBe('INTERESTED');
  });

  it('MEETING_REQUEST projects status MEETING_SCHEDULED', async () => {
    const { service, prospects } = seed();
    const res = await service.create({
      prospectId: 'p1',
      verdict: 'MEETING_REQUEST',
    });
    expect(res.status).toBe('MEETING_SCHEDULED');
    expect(prospects.rows[0]!.status).toBe('MEETING_SCHEDULED');
  });

  it('SNOOZE projects NOT_INTERESTED and copies snoozeUntil onto the prospect', async () => {
    const { service, prospects } = seed();
    const when = '2026-08-01T00:00:00.000Z';
    const res = await service.create({
      prospectId: 'p1',
      verdict: 'SNOOZE',
      snoozeUntil: when,
    });
    expect(res.status).toBe('NOT_INTERESTED');
    expect(prospects.rows[0]!.status).toBe('NOT_INTERESTED');
    expect(prospects.rows[0]!.snoozeUntil).toEqual(new Date(when));
  });

  it('NOT_INTERESTED projects NOT_INTERESTED', async () => {
    const { service, prospects } = seed();
    const res = await service.create({
      prospectId: 'p1',
      verdict: 'NOT_INTERESTED',
    });
    expect(res.status).toBe('NOT_INTERESTED');
    expect(prospects.rows[0]!.status).toBe('NOT_INTERESTED');
  });

  it('UNSURE / AUTO_REPLY / BOUNCE leave the status unchanged (evidence only)', async () => {
    for (const verdict of ['UNSURE', 'AUTO_REPLY', 'BOUNCE'] as const) {
      const { service, prospects, replyClassifications } = seed();
      const res = await service.create({ prospectId: 'p1', verdict });
      expect(res.status).toBe('EMAILED'); // untouched
      expect(prospects.rows[0]!.status).toBe('EMAILED');
      // ...but the verdict is still logged as evidence.
      expect(replyClassifications.rows).toHaveLength(1);
    }
  });

  it("does NOT auto-create a lead on INTERESTED (graduation is a later step)", async () => {
    const { service, prospects } = seed();
    await service.create({ prospectId: 'p1', verdict: 'INTERESTED' });
    expect(prospects.rows[0]!.leadId ?? null).toBeNull();
  });

  it('404s for an unknown prospect', async () => {
    const { service } = seed();
    await expect(
      service.create({ prospectId: 'nope', verdict: 'INTERESTED' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReplyClassificationsService.list — needsRag backlog', () => {
  // WHY: the RAG agent pulls UNSURE replies that have no drafted answer yet. Once
  // it POSTs a sibling row WITH a suggestedReply, that prospect must drop out of
  // the backlog so it is not drafted twice.
  it('includes an UNSURE row with no drafted sibling, and joins prospect context', async () => {
    const { service } = seed();
    await service.create({ prospectId: 'p1', verdict: 'UNSURE' });

    const backlog = await service.list({ needsRag: true });
    expect(backlog).toHaveLength(1);
    expect(backlog[0]!.prospectId).toBe('p1');
    expect(backlog[0]!.verdict).toBe('UNSURE');
    // Joined prospect context for the RAG agent to act on.
    expect(backlog[0]!.prospectEmail).toBe('p1@co.com');
    expect(backlog[0]!.campaignId).toBe(CAMP);
  });

  it('drops the prospect once a sibling row carries a suggestedReply', async () => {
    const { service } = seed();
    // The Reply Glock UNSURE verdict (no draft yet).
    await service.create({ prospectId: 'p1', verdict: 'UNSURE' });
    expect(await service.list({ needsRag: true })).toHaveLength(1);

    // The RAG agent drafts an answer — a new row WITH a suggestedReply.
    await service.create({
      prospectId: 'p1',
      verdict: 'UNSURE',
      suggestedReply: 'Here is a draft reply.',
    });

    // The prospect is no longer in the backlog (already drafted).
    expect(await service.list({ needsRag: true })).toHaveLength(0);
  });

  it('needsRag ignores non-UNSURE verdicts', async () => {
    const { service } = seed();
    await service.create({ prospectId: 'p1', verdict: 'INTERESTED' });
    expect(await service.list({ needsRag: true })).toHaveLength(0);
  });
});
