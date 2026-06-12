import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { OutreachMessagesService } from '../src/outreach/outreach-messages.service';
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
      __seq: 1,
    },
  ]);
  const outreachMessages = new FakeTable([]);
  const auditLog = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.prospects, prospects],
      [schema.outreachMessages, outreachMessages],
      [schema.auditLog, auditLog],
    ]),
  );
  return { service: new OutreachMessagesService(db), outreachMessages };
}

describe('OutreachMessagesService — gmailMessageId upsert idempotency', () => {
  // WHY: the Gmail poller re-fetches a thread on every tick. The same
  // gmailMessageId arriving twice must UPDATE the existing row (status/subject/
  // bodySnippet/sentAt), never insert a duplicate.
  it('inserts on first poll, updates the SAME row on the second (no duplicate)', async () => {
    const { service, outreachMessages } = seed();

    const first = await service.create({
      prospectId: 'p1',
      direction: 'INBOUND',
      status: 'RECEIVED',
      gmailMessageId: 'gm-1',
      gmailThreadId: 'th-1',
      subject: 'Re: hello',
      bodySnippet: 'first snippet',
    });
    expect(outreachMessages.rows).toHaveLength(1);
    expect(first.status).toBe('RECEIVED');

    const second = await service.create({
      prospectId: 'p1',
      direction: 'INBOUND',
      status: 'RECEIVED',
      gmailMessageId: 'gm-1', // same message id → upsert
      subject: 'Re: hello (edited)',
      bodySnippet: 'second snippet',
    });

    // No duplicate row...
    expect(outreachMessages.rows).toHaveLength(1);
    // ...and the same row id was returned + updated in place.
    expect(second.id).toBe(first.id);
    expect(outreachMessages.rows[0]!.subject).toBe('Re: hello (edited)');
    expect(outreachMessages.rows[0]!.bodySnippet).toBe('second snippet');
  });

  it('inserts separately when no gmailMessageId is supplied (outbound send)', async () => {
    const { service, outreachMessages } = seed();
    await service.create({
      prospectId: 'p1',
      direction: 'OUTBOUND',
      status: 'SENT',
    });
    await service.create({
      prospectId: 'p1',
      direction: 'OUTBOUND',
      status: 'SENT',
    });
    expect(outreachMessages.rows).toHaveLength(2);
  });

  it('404s for an unknown prospect', async () => {
    const { service } = seed();
    await expect(
      service.create({
        prospectId: 'nope',
        direction: 'OUTBOUND',
        status: 'SENT',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OutreachMessagesService — list (thread context pull)', () => {
  it('filters by prospectId and returns newest-first', async () => {
    const { service } = seed();
    const older = await service.create({
      prospectId: 'p1',
      direction: 'OUTBOUND',
      status: 'SENT',
      subject: 'first',
    });
    const newer = await service.create({
      prospectId: 'p1',
      direction: 'INBOUND',
      status: 'RECEIVED',
      subject: 'second',
    });

    const rows = await service.list({ prospectId: 'p1' });
    expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]); // newest-first
  });

  it('caps the result at the supplied limit', async () => {
    const { service } = seed();
    for (let i = 0; i < 3; i += 1) {
      await service.create({
        prospectId: 'p1',
        direction: 'OUTBOUND',
        status: 'SENT',
      });
    }
    const rows = await service.list({ prospectId: 'p1', limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
