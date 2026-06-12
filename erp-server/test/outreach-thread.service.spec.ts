import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { OutreachMessagesService } from '../src/outreach/outreach-messages.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// The ledger has no organizationId — tenancy is via the prospect. Seed a prospect
// per org so the JWT thread read confines to the caller's org (404 cross-org).
function seed() {
  const prospects = new FakeTable([
    { id: 'pa1', organizationId: ORG_A, campaignId: 'camp-a', email: 'a1@aco.com', __seq: 1 },
    { id: 'pb1', organizationId: ORG_B, campaignId: 'camp-b', email: 'b1@bco.com', __seq: 2 },
  ]);
  const outreachMessages = new FakeTable([
    { id: 'm1', prospectId: 'pa1', direction: 'OUTBOUND', status: 'SENT', gmailMessageId: null, gmailThreadId: null, subject: 'Hi', bodySnippet: null, templateAssetId: null, sentAt: null, error: null, __seq: 1 },
    { id: 'm2', prospectId: 'pa1', direction: 'INBOUND', status: 'RECEIVED', gmailMessageId: null, gmailThreadId: null, subject: 'Re: Hi', bodySnippet: null, templateAssetId: null, sentAt: null, error: null, __seq: 2 },
    { id: 'm3', prospectId: 'pb1', direction: 'OUTBOUND', status: 'SENT', gmailMessageId: null, gmailThreadId: null, subject: 'Hi B', bodySnippet: null, templateAssetId: null, sentAt: null, error: null, __seq: 3 },
  ]);
  const auditLog = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.prospects, prospects],
      [schema.outreachMessages, outreachMessages],
      [schema.auditLog, auditLog],
    ]),
  );
  return { service: new OutreachMessagesService(db) };
}

describe('OutreachMessagesService.listForOrg — JWT conversation timeline (org-scoped)', () => {
  it('returns the prospect thread when the prospect is in the caller org', async () => {
    const { service } = seed();
    const rows = await service.listForOrg(ORG_A, 'pa1');
    expect(rows.map((r) => r.id).sort()).toEqual(['m1', 'm2']);
  });

  it('404s when the prospect belongs to another org (no cross-org thread read)', async () => {
    const { service } = seed();
    await expect(service.listForOrg(ORG_A, 'pb1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s an unknown prospect', async () => {
    const { service } = seed();
    await expect(service.listForOrg(ORG_A, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
