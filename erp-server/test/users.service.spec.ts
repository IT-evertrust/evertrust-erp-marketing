import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { schema } from '@evertrust/db';
import { UsersService } from '../src/users/users.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ALICE = 'a1111111-1111-1111-1111-111111111111';
const BOB = 'b2222222-2222-2222-2222-222222222222';
const MALLORY = 'c3333333-3333-3333-3333-333333333333';
const OWNER_ID = 'd4444444-4444-4444-4444-444444444444';

// Seeds a users table across two orgs. Alice (Super Admin/CEO) + Bob (Employee,
// no dept/position) in ORG_A; Mallory in ORG_B — used to prove tenant isolation.
function seed() {
  const users = new FakeTable([
    {
      id: ALICE,
      organizationId: ORG_A,
      name: 'Alice',
      email: 'alice@evertrust-germany.de',
      role: 'SUPER_ADMIN',
      position: 'CEO',
      department: 'OPERATIONS',
      active: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      __seq: 1,
    },
    {
      id: BOB,
      organizationId: ORG_A,
      name: 'Bob',
      email: 'bob@evertrust-germany.de',
      role: 'EMPLOYEE',
      position: null,
      department: null,
      active: true,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      __seq: 2,
    },
    {
      id: MALLORY,
      organizationId: ORG_B,
      name: 'Mallory',
      email: 'mallory@other.de',
      role: 'EMPLOYEE',
      position: null,
      department: null,
      active: true,
      createdAt: new Date('2026-01-03T00:00:00Z'),
      __seq: 3,
    },
  ]);
  const creds = new FakeTable([]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.users, users],
      [schema.authCredentials, creds],
    ]),
  );
  return { service: new UsersService(db), users, creds };
}

describe('UsersService — admin directory (listAllForOrg)', () => {
  it('returns only the calling org users, with createdAt serialized to ISO', async () => {
    const { service } = seed();
    const rows = await service.listAllForOrg(ORG_A);

    expect(rows.map((r) => r.id).sort()).toEqual([ALICE, BOB].sort());
    expect(rows.every((r) => typeof r.createdAt === 'string')).toBe(true);
    // never leaks another tenant's users
    expect(rows.find((r) => r.id === MALLORY)).toBeUndefined();
  });

  it('is empty for an org with no users', async () => {
    const { service } = seed();
    expect(
      await service.listAllForOrg('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
    ).toEqual([]);
  });
});

describe('UsersService — updateUser (role / position / department)', () => {
  it('updates all three fields and returns the prior values as `before`', async () => {
    const { service } = seed();
    const { before, after } = await service.updateUser(ORG_A, ALICE, BOB, {
      role: 'MANAGER',
      position: 'DEPT_MANAGER',
      department: 'IT',
    });

    // toMatchObject (not toEqual): the in-memory fake-db doesn't honor SELECT
    // projections, so `before` carries extra columns at runtime — real Drizzle
    // returns exactly {role, position, department} (enforced by the TS types).
    expect(before).toMatchObject({
      role: 'EMPLOYEE',
      position: null,
      department: null,
    });
    expect(after.role).toBe('MANAGER');
    expect(after.position).toBe('DEPT_MANAGER');
    expect(after.department).toBe('IT');
    expect(typeof after.createdAt).toBe('string');
  });

  it('patches a single field, leaving the others untouched', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(ORG_A, ALICE, ALICE, {
      department: 'BUSINESS',
    });

    expect(after.role).toBe('SUPER_ADMIN'); // unchanged
    expect(after.position).toBe('CEO'); // unchanged
    expect(after.department).toBe('BUSINESS');
  });

  it('clears position/department when set to null (e.g. a CEO with no dept)', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(ORG_A, ALICE, ALICE, {
      position: null,
      department: null,
    });

    expect(after.position).toBeNull();
    expect(after.department).toBeNull();
  });

  it('404s updating a user in another org (tenant-scoped)', async () => {
    const { service } = seed();
    await expect(
      service.updateUser(ORG_A, ALICE, MALLORY, { role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s updating a non-existent user', async () => {
    const { service } = seed();
    await expect(
      service.updateUser(ORG_A, ALICE, 'ffffffff-ffff-ffff-ffff-ffffffffffff', {
        role: 'ADMIN',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService — updateUser guards (Super Admin + deactivation)', () => {
  it("blocks changing a Super Admin's role, but allows other field edits", async () => {
    const { service } = seed();
    await expect(
      service.updateUser(ORG_A, ALICE, ALICE, { role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // position/department on a Super Admin are still editable
    const { after } = await service.updateUser(ORG_A, ALICE, ALICE, {
      department: 'IT',
    });
    expect(after.role).toBe('SUPER_ADMIN');
    expect(after.department).toBe('IT');
  });

  it('deactivates a normal user (active=false)', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      active: false,
    });
    expect(after.active).toBe(false);
  });

  it('blocks deactivating your own account', async () => {
    const { service } = seed();
    await expect(
      service.updateUser(ORG_A, BOB, BOB, { active: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks deactivating a Super Admin', async () => {
    const { service } = seed();
    await expect(
      service.updateUser(ORG_A, BOB, ALICE, { active: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reactivates a user (active=true) without guard', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      active: true,
    });
    expect(after.active).toBe(true);
  });
});

describe('UsersService — updateUser (name / email)', () => {
  it('updates the display name', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      name: 'Bobby',
    });
    expect(after.name).toBe('Bobby');
  });

  it('updates the email to a new, unique address', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      email: 'bob.new@evertrust-germany.de',
    });
    expect(after.email).toBe('bob.new@evertrust-germany.de');
  });

  it('rejects an email already used by another user', async () => {
    const { service } = seed();
    await expect(
      service.updateUser(ORG_A, ALICE, BOB, {
        email: 'alice@evertrust-germany.de',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sets and clears the phone number', async () => {
    const { service } = seed();
    const set = await service.updateUser(ORG_A, ALICE, BOB, {
      phone: '+49 30 1234 567',
    });
    expect(set.after.phone).toBe('+49 30 1234 567');
    const cleared = await service.updateUser(ORG_A, ALICE, BOB, {
      phone: null,
    });
    expect(cleared.after.phone).toBeNull();
  });

  it('allows re-saving a user with their own unchanged email', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      email: 'bob@evertrust-germany.de',
    });
    expect(after.email).toBe('bob@evertrust-germany.de');
  });
});

describe('UsersService — updateUser per-user permissions', () => {
  it('sets an explicit per-user permission override', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      permissions: ['tenders:read', 'campaigns:read'],
    });
    expect(after.permissions).toEqual(['tenders:read', 'campaigns:read']);
  });

  it('resets a user to role defaults (permissions = null)', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      permissions: null,
    });
    expect(after.permissions).toBeNull();
  });

  it('ignores permission edits for a Super Admin (always full)', async () => {
    const { service } = seed();
    // Try to narrow ALICE (Super Admin) — must not be persisted.
    const { after } = await service.updateUser(ORG_A, BOB, ALICE, {
      permissions: ['tenders:read'],
    });
    expect(after.permissions ?? null).toBeNull();
  });

  it('blocks removing your own user-management access', async () => {
    const { service } = seed();
    await expect(
      service.updateUser(ORG_A, BOB, BOB, { permissions: ['tenders:read'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('UsersService — createUser', () => {
  it('creates a user + an argon2 credential and returns the new row', async () => {
    const { service, creds } = seed();
    const after = await service.createUser(ORG_A, {
      name: 'Carl New',
      email: 'carl@evertrust-germany.de',
      password: 'Password123!',
      role: 'EMPLOYEE',
    });
    expect(after.email).toBe('carl@evertrust-germany.de');
    expect(after.role).toBe('EMPLOYEE');
    expect(creds.rows.some((c) => c.userId === after.id)).toBe(true);
  });

  it('rejects a duplicate email (409)', async () => {
    const { service } = seed();
    await expect(
      service.createUser(ORG_A, {
        name: 'Dup',
        email: 'alice@evertrust-germany.de',
        password: 'Password123!',
        role: 'EMPLOYEE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('UsersService — setPassword (admin reset)', () => {
  it('upserts an argon2 credential for the user', async () => {
    const { service, creds } = seed();
    await service.setPassword(ORG_A, 'SUPER_ADMIN', BOB, 'NewStrongPass1');
    const row = creds.rows.find((c) => c.userId === BOB);
    expect(row).toBeDefined();
    expect(String(row!.passwordHash)).toMatch(/^\$argon2/);
  });

  it("blocks a non-Super-Admin from resetting a Super Admin's password", async () => {
    const { service } = seed();
    await expect(
      service.setPassword(ORG_A, 'MANAGER', ALICE, 'NewStrongPass1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s for a user in another org', async () => {
    const { service } = seed();
    await expect(
      service.setPassword(ORG_A, 'SUPER_ADMIN', MALLORY, 'NewStrongPass1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService — getStats', () => {
  it('returns real per-user counts + recent activity', async () => {
    const users = new FakeTable([
      {
        id: ALICE,
        organizationId: ORG_A,
        name: 'Alice',
        email: 'alice@evertrust-germany.de',
        role: 'SUPER_ADMIN',
        active: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        __seq: 1,
      },
    ]);
    const campaigns = new FakeTable([
      { id: 'c1', organizationId: ORG_A, activatedBy: ALICE },
      { id: 'c2', organizationId: ORG_A, activatedBy: ALICE },
      { id: 'c3', organizationId: ORG_A, activatedBy: BOB },
    ]);
    const runs = new FakeTable([
      { id: 'r1', triggeredBy: ALICE },
      { id: 'r2', triggeredBy: BOB },
    ]);
    const audit = new FakeTable([
      {
        id: 'x1',
        organizationId: ORG_A,
        actorId: ALICE,
        entity: 'campaigns',
        action: 'CREATE',
        at: new Date('2026-02-01T00:00:00Z'),
      },
      {
        id: 'x2',
        organizationId: ORG_A,
        actorId: ALICE,
        entity: 'users',
        action: 'UPDATE',
        at: new Date('2026-02-02T00:00:00Z'),
      },
      {
        id: 'x3',
        organizationId: ORG_A,
        actorId: BOB,
        entity: 'tenders',
        action: 'UPDATE',
        at: new Date('2026-02-03T00:00:00Z'),
      },
    ]);
    const { db } = makeFakeDb(
      new Map<unknown, FakeTable>([
        [schema.users, users],
        [schema.campaigns, campaigns],
        [schema.arsenalRuns, runs],
        [schema.auditLog, audit],
      ]),
    );
    const service = new UsersService(db);
    const stats = await service.getStats(ORG_A, ALICE);
    expect(stats.campaignsLaunched).toBe(2);
    expect(stats.stagesRun).toBe(1);
    expect(stats.actionsLogged).toBe(2);
    expect(stats.recentActivity.length).toBe(2);
    expect(typeof stats.recentActivity[0]!.at).toBe('string');
  });
});

describe('UsersService — deleteUser', () => {
  it('deletes a normal user and their credential', async () => {
    const { service, users, creds } = seed();
    creds.rows.push({ userId: BOB, passwordHash: 'x' });
    const res = await service.deleteUser(ORG_A, ALICE, BOB);
    expect(res.email).toBe('bob@evertrust-germany.de');
    expect(users.rows.some((u) => u.id === BOB)).toBe(false);
    expect(creds.rows.some((c) => c.userId === BOB)).toBe(false);
  });

  it('blocks deleting your own account', async () => {
    const { service } = seed();
    await expect(service.deleteUser(ORG_A, BOB, BOB)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks deleting a Super Admin', async () => {
    const { service } = seed();
    await expect(service.deleteUser(ORG_A, BOB, ALICE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s deleting a user in another org (tenant-scoped)', async () => {
    const { service } = seed();
    await expect(
      service.deleteUser(ORG_A, ALICE, MALLORY),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// The OWNER role is the ONE cross-org seam — and only over user administration.
// It is passed to the service as the trailing actorRole; absent/any-other role
// stays tenant-confined exactly as the tests above prove.
describe('UsersService — OWNER cross-org (users admin)', () => {
  it('an Owner lists users across ALL orgs', async () => {
    const { service } = seed();
    const rows = await service.listAllForOrg(ORG_A, 'OWNER');
    expect(rows.map((r) => r.id).sort()).toEqual([ALICE, BOB, MALLORY].sort());
  });

  it('a non-Owner list stays confined to its own org', async () => {
    const { service } = seed();
    const rows = await service.listAllForOrg(ORG_A, 'SUPER_ADMIN');
    expect(rows.find((r) => r.id === MALLORY)).toBeUndefined();
  });

  it('an Owner can update a user in another org (cross-org)', async () => {
    const { service } = seed();
    const { after } = await service.updateUser(
      ORG_A,
      OWNER_ID,
      MALLORY,
      { name: 'Mallory II' },
      'OWNER',
    );
    expect(after.name).toBe('Mallory II');
  });

  it('a non-Owner still 404s on a cross-org user', async () => {
    const { service } = seed();
    await expect(
      service.updateUser(ORG_A, ALICE, MALLORY, { name: 'x' }, 'SUPER_ADMIN'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only an Owner can GRANT the Owner role (create + update)', async () => {
    const { service } = seed();
    await expect(
      service.createUser(ORG_A, {
        name: 'Wannabe',
        email: 'w@x.de',
        password: 'Password123!',
        role: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateUser(ORG_A, ALICE, BOB, { role: 'OWNER' }, 'SUPER_ADMIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const created = await service.createUser(
      ORG_A,
      {
        name: 'Owner Two',
        email: 'owner2@x.de',
        password: 'Password123!',
        role: 'OWNER',
      },
      'OWNER',
    );
    expect(created.role).toBe('OWNER');
  });

  it('an Owner can reset a password and delete cross-org', async () => {
    const { service, users } = seed();
    await service.setPassword(ORG_A, 'OWNER', MALLORY, 'NewStrongPass1');
    await service.deleteUser(ORG_A, OWNER_ID, MALLORY, 'OWNER');
    expect(users.rows.some((u) => u.id === MALLORY)).toBe(false);
  });

  it('protects an Owner target from non-Owner modify/delete', async () => {
    const { service, users } = seed();
    const bob = users.rows.find((u) => u.id === BOB)!;
    bob.role = 'OWNER';
    await expect(
      service.updateUser(ORG_A, ALICE, BOB, { name: 'x' }, 'SUPER_ADMIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteUser(ORG_A, ALICE, BOB, 'SUPER_ADMIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
