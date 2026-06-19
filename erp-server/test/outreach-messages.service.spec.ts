import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { OutreachMessagesService } from '../src/outreach/outreach-messages.service';
import { getDb, rowsOf, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PROSPECT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// Seed one prospect (the fixture all the message specs hang off) and return a
// service over the real db.
async function makeService() {
  await seed(schema.prospects, [
    {
      id: PROSPECT,
      organizationId: ORG_A,
      campaignId: CAMP,
      email: 'p1@co.com',
      status: 'EMAILED',
    },
  ]);
  return new OutreachMessagesService(getDb());
}

describe('OutreachMessagesService — gmailMessageId upsert idempotency', () => {
  // WHY: the Gmail poller re-fetches a thread on every tick. The same
  // gmailMessageId arriving twice must UPDATE the existing row (status/subject/
  // bodySnippet/sentAt), never insert a duplicate.
  it('inserts on first poll, updates the SAME row on the second (no duplicate)', async () => {
    const service = await makeService();

    const first = await service.create({
      prospectId: PROSPECT,
      direction: 'INBOUND',
      status: 'RECEIVED',
      gmailMessageId: 'gm-1',
      gmailThreadId: 'th-1',
      subject: 'Re: hello',
      bodySnippet: 'first snippet',
    });
    expect(await rowsOf(schema.outreachMessages)).toHaveLength(1);
    expect(first.status).toBe('RECEIVED');

    const second = await service.create({
      prospectId: PROSPECT,
      direction: 'INBOUND',
      status: 'RECEIVED',
      gmailMessageId: 'gm-1', // same message id → upsert
      subject: 'Re: hello (edited)',
      bodySnippet: 'second snippet',
    });

    // No duplicate row...
    const rows = await rowsOf(schema.outreachMessages);
    expect(rows).toHaveLength(1);
    // ...and the same row id was returned + updated in place.
    expect(second.id).toBe(first.id);
    expect(rows[0]!.subject).toBe('Re: hello (edited)');
    expect(rows[0]!.bodySnippet).toBe('second snippet');
  });

  it('inserts separately when no gmailMessageId is supplied (outbound send)', async () => {
    const service = await makeService();
    await service.create({
      prospectId: PROSPECT,
      direction: 'OUTBOUND',
      status: 'SENT',
    });
    await service.create({
      prospectId: PROSPECT,
      direction: 'OUTBOUND',
      status: 'SENT',
    });
    expect(await rowsOf(schema.outreachMessages)).toHaveLength(2);
  });

  it('404s for an unknown prospect', async () => {
    const service = await makeService();
    await expect(
      service.create({
        prospectId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        direction: 'OUTBOUND',
        status: 'SENT',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OutreachMessagesService — list (thread context pull)', () => {
  it('filters by prospectId and returns newest-first', async () => {
    const service = await makeService();
    const older = await service.create({
      prospectId: PROSPECT,
      direction: 'OUTBOUND',
      status: 'SENT',
      subject: 'first',
    });
    // Space the inserts so the createdAt-desc order is deterministic (a real
    // Postgres ties on same-millisecond inserts; the fake had a monotonic seq).
    await new Promise((r) => setTimeout(r, 5));
    const newer = await service.create({
      prospectId: PROSPECT,
      direction: 'INBOUND',
      status: 'RECEIVED',
      subject: 'second',
    });

    const rows = await service.list({ prospectId: PROSPECT });
    expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]); // newest-first
  });

  it('caps the result at the supplied limit', async () => {
    const service = await makeService();
    for (let i = 0; i < 3; i += 1) {
      await service.create({
        prospectId: PROSPECT,
        direction: 'OUTBOUND',
        status: 'SENT',
      });
    }
    const rows = await service.list({ prospectId: PROSPECT, limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
