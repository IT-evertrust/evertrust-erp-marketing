import { BadRequestException, ConflictException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { DEFAULT_SENDERS } from '@evertrust/shared';
import { SendersService } from '../src/arsenal/senders.service';
import { FakeTable, makeFakeDb } from './fake-db';

// SendersService owns the per-org org_senders CRUD + the resolved sender list. These
// specs pin the product-default fallback (no rows → DEFAULT_SENDERS), the upsert
// (insert new key / update existing), the set-default semantics (exactly one default),
// the delete, and the last-sender guard. The fake db maps sender_key/is_default so the
// (organization_id, sender_key) lookup + the isDefault flag round-trip.

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function make(rows: Record<string, unknown>[] = []) {
  const orgSenders = new FakeTable(rows);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([[schema.orgSenders, orgSenders]]),
  );
  return { service: new SendersService(db), orgSenders };
}

function row(
  id: string,
  orgId: string,
  key: string,
  email: string,
  isDefault = false,
  seq = 1,
): Record<string, unknown> {
  return {
    id,
    organizationId: orgId,
    senderKey: key,
    email,
    label: null,
    isDefault,
    __seq: seq,
  };
}

describe('SendersService — resolve (fallback to DEFAULT_SENDERS)', () => {
  it('returns DEFAULT_SENDERS when the org has no senders of its own', async () => {
    const { service } = make();
    expect(await service.resolve(ORG)).toEqual(DEFAULT_SENDERS);
    expect((await service.resolveDetailed(ORG)).fromOrg).toBe(false);
  });

  it('returns the org rows (mapped to the wire DTO) when it has them', async () => {
    const { service } = make([row('s1', ORG, 'ceo', 'ceo@acme.test', true)]);
    expect(await service.resolve(ORG)).toEqual([
      { key: 'ceo', email: 'ceo@acme.test', label: null, isDefault: true },
    ]);
    expect((await service.resolveDetailed(ORG)).fromOrg).toBe(true);
  });

  it('scopes the resolved list to the org (other orgs excluded)', async () => {
    const { service } = make([
      row('s1', ORG, 'ceo', 'ceo@acme.test', true),
      row('s2', OTHER, 'x', 'x@other.test', true, 2),
    ]);
    const list = await service.resolve(ORG);
    expect(list.map((s) => s.key)).toEqual(['ceo']);
  });
});

describe('SendersService — upsert', () => {
  it('inserts a new sender on a new key', async () => {
    const { service, orgSenders } = make();
    const list = await service.upsert(ORG, {
      key: 'sales',
      email: 'sales@acme.test',
      label: 'Sales',
    });
    expect(orgSenders.rows).toHaveLength(1);
    expect(list).toEqual([
      { key: 'sales', email: 'sales@acme.test', label: 'Sales', isDefault: false },
    ]);
  });

  it('updates the existing row on a duplicate key (no second row)', async () => {
    const { service, orgSenders } = make([
      row('s1', ORG, 'sales', 'old@acme.test'),
    ]);
    const list = await service.upsert(ORG, {
      key: 'sales',
      email: 'new@acme.test',
      label: 'New label',
    });
    expect(orgSenders.rows).toHaveLength(1);
    expect(list).toEqual([
      { key: 'sales', email: 'new@acme.test', label: 'New label', isDefault: false },
    ]);
  });

  it('setting isDefault unsets the flag on the org other senders', async () => {
    const { service } = make([
      row('s1', ORG, 'a', 'a@acme.test', true, 1),
      row('s2', ORG, 'b', 'b@acme.test', false, 2),
    ]);
    const list = await service.upsert(ORG, {
      key: 'b',
      email: 'b@acme.test',
      isDefault: true,
    });
    const byKey = Object.fromEntries(list.map((s) => [s.key, s.isDefault]));
    // Exactly one default — the newly-set one; the previous default is cleared.
    expect(byKey).toEqual({ a: false, b: true });
  });

  it('rejects an empty key', async () => {
    const { service } = make();
    await expect(
      service.upsert(ORG, { key: '  ', email: 'x@acme.test' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid email', async () => {
    const { service } = make();
    await expect(
      service.upsert(ORG, { key: 'sales', email: 'not-an-email' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SendersService — remove', () => {
  it('removes a sender by key when more than one remains', async () => {
    const { service, orgSenders } = make([
      row('s1', ORG, 'a', 'a@acme.test', true, 1),
      row('s2', ORG, 'b', 'b@acme.test', false, 2),
    ]);
    const list = await service.remove(ORG, 'b');
    expect(orgSenders.rows).toHaveLength(1);
    expect(list.map((s) => s.key)).toEqual(['a']);
  });

  it('refuses to delete the last remaining sender (409)', async () => {
    const { service } = make([row('s1', ORG, 'a', 'a@acme.test', true)]);
    await expect(service.remove(ORG, 'a')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects an unknown key for the org', async () => {
    const { service } = make([
      row('s1', ORG, 'a', 'a@acme.test', true, 1),
      row('s2', ORG, 'b', 'b@acme.test', false, 2),
    ]);
    await expect(service.remove(ORG, 'nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
