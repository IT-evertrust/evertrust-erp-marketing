import { BadRequestException, ConflictException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { DEFAULT_SENDERS } from '@evertrust/shared';
import { SendersService } from '../src/arsenal/senders.service';
import { fakeGoogleAccounts, getDb, rowsOf, seed } from './real-db';

// SendersService owns the per-org org_senders CRUD + the resolved sender list. These
// specs pin the product-default fallback (no rows → DEFAULT_SENDERS), the connected-only
// list() filter, the upsert (insert new key / update existing), the set-default semantics
// (exactly one default), the delete, and the last-sender guard — all against a real
// Postgres so the (organization_id, sender_key) unique lookup + the isDefault flag
// round-trip through the real engine.

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// A SendersService over the shared test db, with a stubbed connected-accounts source.
function service(connected: { email: string; status?: string }[] = []) {
  return new SendersService(getDb(), fakeGoogleAccounts(connected));
}

// Seed one org_senders row (the DB fills id/createdAt).
function senderRow(orgId: string, key: string, email: string, isDefault = false) {
  return { organizationId: orgId, senderKey: key, email, label: null, isDefault };
}

describe('SendersService — resolve (fallback to DEFAULT_SENDERS)', () => {
  it('returns DEFAULT_SENDERS when the org has no senders of its own', async () => {
    const svc = service();
    expect(await svc.resolve(ORG)).toEqual(DEFAULT_SENDERS);
    expect((await svc.resolveDetailed(ORG)).fromOrg).toBe(false);
  });

  it('returns the org rows (mapped to the wire DTO) when it has them', async () => {
    await seed(schema.orgSenders, senderRow(ORG, 'ceo', 'ceo@acme.test', true));
    const svc = service();
    expect(await svc.resolve(ORG)).toEqual([
      { key: 'ceo', email: 'ceo@acme.test', label: null, isDefault: true },
    ]);
    expect((await svc.resolveDetailed(ORG)).fromOrg).toBe(true);
  });

  it('scopes the resolved list to the org (other orgs excluded)', async () => {
    await seed(schema.orgSenders, [
      senderRow(ORG, 'ceo', 'ceo@acme.test', true),
      senderRow(OTHER, 'x', 'x@other.test', true),
    ]);
    const list = await service().resolve(ORG);
    expect(list.map((s) => s.key)).toEqual(['ceo']);
  });
});

describe('SendersService — list (connected-only filter)', () => {
  it('keeps only DEFAULT_SENDERS whose Gmail account is connected', async () => {
    // info@ connected, hanna@ NOT — the picker must drop hanna (the reported bug).
    const svc = service([{ email: 'info@evertrust-germany.de' }]);
    expect((await svc.list(ORG)).map((s) => s.key)).toEqual(['info']);
  });

  it('returns an empty list when no sender has a connected account', async () => {
    await seed(schema.orgSenders, senderRow(ORG, 'ceo', 'ceo@acme.test', true));
    expect(await service().list(ORG)).toEqual([]);
  });

  it('matches the connected account email case-insensitively', async () => {
    await seed(schema.orgSenders, senderRow(ORG, 'ceo', 'CEO@acme.test', true));
    const svc = service([{ email: 'ceo@acme.test' }]);
    expect((await svc.list(ORG)).map((s) => s.key)).toEqual(['ceo']);
  });

  it('ignores accounts that are not CONNECTED', async () => {
    const svc = service([
      { email: 'info@evertrust-germany.de', status: 'REVOKED' },
    ]);
    expect(await svc.list(ORG)).toEqual([]);
  });
});

describe('SendersService — upsert', () => {
  it('inserts a new sender on a new key', async () => {
    const list = await service().upsert(ORG, {
      key: 'sales',
      email: 'sales@acme.test',
      label: 'Sales',
    });
    expect(await rowsOf(schema.orgSenders)).toHaveLength(1);
    expect(list).toEqual([
      { key: 'sales', email: 'sales@acme.test', label: 'Sales', isDefault: false },
    ]);
  });

  it('updates the existing row on a duplicate key (no second row)', async () => {
    await seed(schema.orgSenders, senderRow(ORG, 'sales', 'old@acme.test'));
    const list = await service().upsert(ORG, {
      key: 'sales',
      email: 'new@acme.test',
      label: 'New label',
    });
    expect(await rowsOf(schema.orgSenders)).toHaveLength(1);
    expect(list).toEqual([
      { key: 'sales', email: 'new@acme.test', label: 'New label', isDefault: false },
    ]);
  });

  it('setting isDefault unsets the flag on the org other senders', async () => {
    await seed(schema.orgSenders, [
      senderRow(ORG, 'a', 'a@acme.test', true),
      senderRow(ORG, 'b', 'b@acme.test', false),
    ]);
    const list = await service().upsert(ORG, {
      key: 'b',
      email: 'b@acme.test',
      isDefault: true,
    });
    const byKey = Object.fromEntries(list.map((s) => [s.key, s.isDefault]));
    // Exactly one default — the newly-set one; the previous default is cleared.
    expect(byKey).toEqual({ a: false, b: true });
  });

  it('rejects an empty key', async () => {
    await expect(
      service().upsert(ORG, { key: '  ', email: 'x@acme.test' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid email', async () => {
    await expect(
      service().upsert(ORG, { key: 'sales', email: 'not-an-email' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SendersService — remove', () => {
  it('removes a sender by key when more than one remains', async () => {
    await seed(schema.orgSenders, [
      senderRow(ORG, 'a', 'a@acme.test', true),
      senderRow(ORG, 'b', 'b@acme.test', false),
    ]);
    const list = await service().remove(ORG, 'b');
    expect(await rowsOf(schema.orgSenders)).toHaveLength(1);
    expect(list.map((s) => s.key)).toEqual(['a']);
  });

  it('refuses to delete the last remaining sender (409)', async () => {
    await seed(schema.orgSenders, senderRow(ORG, 'a', 'a@acme.test', true));
    await expect(service().remove(ORG, 'a')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects an unknown key for the org', async () => {
    await seed(schema.orgSenders, [
      senderRow(ORG, 'a', 'a@acme.test', true),
      senderRow(ORG, 'b', 'b@acme.test', false),
    ]);
    await expect(service().remove(ORG, 'nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
