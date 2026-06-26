import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { effectivePermissions } from '@evertrust/shared';
import { UsersService } from '../src/users/users.service';
import { getDb, rowsOf, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ALICE = 'a1111111-1111-1111-1111-111111111111';
const BOB = 'b2222222-2222-2222-2222-222222222222';
const MALLORY = 'c3333333-3333-3333-3333-333333333333';
const OWNER_ID = 'd4444444-4444-4444-4444-444444444444';

// Seeds a users table across two orgs. Alice (Super Admin/CEO) + Bob (Employee,
// no dept/position) in ORG_A; Mallory in ORG_B — used to prove tenant isolation.
// FK enforcement is off, so seeding users without their org graph is fine. email is
// NOT NULL + globally unique; the three addresses are distinct.
async function seed_() {
  await seed(schema.users, [
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
    },
  ]);
  return { service: new UsersService(getDb()) };
}

describe('UsersService — admin directory (listAllForOrg)', () => {
  it('returns only the calling org users, with createdAt serialized to ISO', async () => {
    const { service } = await seed_();
    const rows = await service.listAllForOrg(ORG_A);

    expect(rows.map((r) => r.id).sort()).toEqual([ALICE, BOB].sort());
    expect(rows.every((r) => typeof r.createdAt === 'string')).toBe(true);
    // never leaks another tenant's users
    expect(rows.find((r) => r.id === MALLORY)).toBeUndefined();
  });

  it('is empty for an org with no users', async () => {
    const { service } = await seed_();
    expect(
      await service.listAllForOrg('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
    ).toEqual([]);
  });
});

describe('UsersService — updateUser (role / position / department)', () => {
  it('updates all three fields and returns the prior values as `before`', async () => {
    const { service } = await seed_();
    const { before, after } = await service.updateUser(ORG_A, ALICE, BOB, {
      role: 'MANAGER',
      position: 'DEPT_MANAGER',
      department: 'IT',
    });

    // Real Drizzle returns exactly the projected {role, position, department}.
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
    const { service } = await seed_();
    const { after } = await service.updateUser(ORG_A, ALICE, ALICE, {
      department: 'BUSINESS',
    });

    expect(after.role).toBe('SUPER_ADMIN'); // unchanged
    expect(after.position).toBe('CEO'); // unchanged
    expect(after.department).toBe('BUSINESS');
  });

  it('clears position/department when set to null (e.g. a CEO with no dept)', async () => {
    const { service } = await seed_();
    const { after } = await service.updateUser(ORG_A, ALICE, ALICE, {
      position: null,
      department: null,
    });

    expect(after.position).toBeNull();
    expect(after.department).toBeNull();
  });

  it('404s updating a user in another org (tenant-scoped)', async () => {
    const { service } = await seed_();
    await expect(
      service.updateUser(ORG_A, ALICE, MALLORY, { role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s updating a non-existent user', async () => {
    const { service } = await seed_();
    await expect(
      service.updateUser(ORG_A, ALICE, 'ffffffff-ffff-ffff-ffff-ffffffffffff', {
        role: 'ADMIN',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService — updateUser guards (Super Admin + deactivation)', () => {
  it("blocks changing a Super Admin's role, but allows other field edits", async () => {
    const { service } = await seed_();
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
    const { service } = await seed_();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      active: false,
    });
    expect(after.active).toBe(false);
  });

  it('blocks deactivating your own account', async () => {
    const { service } = await seed_();
    await expect(
      service.updateUser(ORG_A, BOB, BOB, { active: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks deactivating a Super Admin', async () => {
    const { service } = await seed_();
    await expect(
      service.updateUser(ORG_A, BOB, ALICE, { active: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reactivates a user (active=true) without guard', async () => {
    const { service } = await seed_();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      active: true,
    });
    expect(after.active).toBe(true);
  });
});

describe('UsersService — updateUser (name / email)', () => {
  it('updates the display name', async () => {
    const { service } = await seed_();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      name: 'Bobby',
    });
    expect(after.name).toBe('Bobby');
  });

  it('updates the email to a new, unique address', async () => {
    const { service } = await seed_();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      email: 'bob.new@evertrust-germany.de',
    });
    expect(after.email).toBe('bob.new@evertrust-germany.de');
  });

  it('rejects an email already used by another user', async () => {
    const { service } = await seed_();
    await expect(
      service.updateUser(ORG_A, ALICE, BOB, {
        email: 'alice@evertrust-germany.de',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sets and clears the phone number', async () => {
    const { service } = await seed_();
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
    const { service } = await seed_();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      email: 'bob@evertrust-germany.de',
    });
    expect(after.email).toBe('bob@evertrust-germany.de');
  });
});

describe('UsersService — updateUser per-user permissions', () => {
  it('sets an explicit per-user permission override', async () => {
    const { service } = await seed_();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      permissions: ['performance:read', 'campaigns:read'],
    });
    expect(after.permissions).toEqual(['performance:read', 'campaigns:read']);
  });

  it('resets a user to role defaults (permissions = null)', async () => {
    const { service } = await seed_();
    const { after } = await service.updateUser(ORG_A, ALICE, BOB, {
      permissions: null,
    });
    expect(after.permissions).toBeNull();
  });

  it('ignores permission edits for a Super Admin (always full)', async () => {
    const { service } = await seed_();
    // Try to narrow ALICE (Super Admin) — must not be persisted.
    const { after } = await service.updateUser(ORG_A, BOB, ALICE, {
      permissions: ['campaigns:read'],
    });
    expect(after.permissions ?? null).toBeNull();
  });

  it('no longer self-locks: editing your own permissions is inert while RBAC is disabled', async () => {
    const { service } = await seed_();
    // Per-feature RBAC is intentionally disabled (effectivePermissions always
    // returns the full set — commit c2a95a1), so narrowing your OWN stored
    // permissions can never strip user-management access: the self-lockout guard
    // is a no-op and the edit succeeds. The override is recorded but inert.
    const { after } = await service.updateUser(ORG_A, BOB, BOB, {
      permissions: ['campaigns:read'],
    });
    expect(after.permissions).toEqual(['campaigns:read']);
    expect(effectivePermissions(after.role, after.permissions)).toContain(
      'users:manage',
    );
  });
});

describe('UsersService — createUser', () => {
  it('creates a user + an argon2 credential and returns the new row', async () => {
    const { service } = await seed_();
    const after = await service.createUser(ORG_A, {
      name: 'Carl New',
      email: 'carl@evertrust-germany.de',
      password: 'Password123!',
      role: 'EMPLOYEE',
    });
    expect(after.email).toBe('carl@evertrust-germany.de');
    expect(after.role).toBe('EMPLOYEE');
    const creds = await rowsOf(schema.authCredentials);
    expect(creds.some((c) => c.userId === after.id)).toBe(true);
  });

  it('rejects a duplicate email (409)', async () => {
    const { service } = await seed_();
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

describe('UsersService — single Super Admin per org', () => {
  // ORG_A already has ALICE (SUPER_ADMIN); ORG_B has only MALLORY (EMPLOYEE).

  it('(a) createUser: a 2nd SUPER_ADMIN in an org that already has one is a 409', async () => {
    const { service } = await seed_();
    await expect(
      service.createUser(ORG_A, {
        name: 'Second SA',
        email: 'second.sa@evertrust-germany.de',
        password: 'Password123!',
        role: 'SUPER_ADMIN',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('(a) updateUser: promoting a 2nd user to SUPER_ADMIN is a 409', async () => {
    const { service } = await seed_();
    await expect(
      service.updateUser(ORG_A, ALICE, BOB, { role: 'SUPER_ADMIN' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('is org-scoped: a SUPER_ADMIN may be created in a DIFFERENT org with none', async () => {
    const { service } = await seed_();
    const after = await service.createUser(ORG_B, {
      name: 'Org B Owner',
      email: 'owner@other.de',
      password: 'Password123!',
      role: 'SUPER_ADMIN',
    });
    expect(after.role).toBe('SUPER_ADMIN');
  });

  it('(b) re-saving the sole SUPER_ADMIN as SUPER_ADMIN is idempotent (no 409)', async () => {
    const { service } = await seed_();
    // ALICE is already the org's single SA — asserting the role again must pass,
    // and other fields still apply.
    const { after } = await service.updateUser(ORG_A, ALICE, ALICE, {
      role: 'SUPER_ADMIN',
      department: 'IT',
    });
    expect(after.role).toBe('SUPER_ADMIN');
    expect(after.department).toBe('IT');
  });

  it('does NOT count OWNER toward the single-SA limit', async () => {
    const { service } = await seed_();
    // An OWNER (cross-org platform role) sits in ORG_B alongside MALLORY.
    await seed(schema.users, {
      id: OWNER_ID,
      organizationId: ORG_B,
      name: 'Platform Owner',
      email: 'owner@platform.de',
      role: 'OWNER',
      position: null,
      department: null,
      active: true,
      createdAt: new Date('2026-01-04T00:00:00Z'),
    });
    // ORG_B has an OWNER but no SUPER_ADMIN, so creating an SA must still succeed.
    const after = await service.createUser(ORG_B, {
      name: 'Org B SA',
      email: 'sa@other.de',
      password: 'Password123!',
      role: 'SUPER_ADMIN',
    });
    expect(after.role).toBe('SUPER_ADMIN');
  });
});

describe('UsersService — setPassword (admin reset)', () => {
  it('upserts an argon2 credential for the user', async () => {
    const { service } = await seed_();
    await service.setPassword(ORG_A, 'SUPER_ADMIN', BOB, 'NewStrongPass1');
    const creds = await rowsOf(schema.authCredentials);
    const row = creds.find((c) => c.userId === BOB);
    expect(row).toBeDefined();
    expect(String(row!.passwordHash)).toMatch(/^\$argon2/);
  });

  it("blocks a non-Super-Admin from resetting a Super Admin's password", async () => {
    const { service } = await seed_();
    await expect(
      service.setPassword(ORG_A, 'MANAGER', ALICE, 'NewStrongPass1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s for a user in another org', async () => {
    const { service } = await seed_();
    await expect(
      service.setPassword(ORG_A, 'SUPER_ADMIN', MALLORY, 'NewStrongPass1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService — getStats', () => {
  it('returns real per-user counts + recent activity', async () => {
    await seed(schema.users, {
      id: ALICE,
      organizationId: ORG_A,
      name: 'Alice',
      email: 'alice@evertrust-germany.de',
      role: 'SUPER_ADMIN',
      active: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    // campaigns NOT NULL: organizationId, nicheId, country, region, project,
    // gmailLabel, whatsappNumber. getStats only counts org + activatedBy.
    const campBase = {
      organizationId: ORG_A,
      nicheId: '11111111-1111-1111-1111-111111111111',
      country: 'DE',
      region: 'BE',
      project: 'P',
      gmailLabel: 'L',
      whatsappNumber: '+49',
    };
    await seed(schema.campaigns, [
      { id: 'c1c1c1c1-0000-0000-0000-000000000001', activatedBy: ALICE, ...campBase },
      { id: 'c2c2c2c2-0000-0000-0000-000000000002', activatedBy: ALICE, ...campBase },
      { id: 'c3c3c3c3-0000-0000-0000-000000000003', activatedBy: BOB, ...campBase },
    ]);
    // arsenal_runs NOT NULL: stage, source, status. getStats counts triggeredBy.
    await seed(schema.arsenalRuns, [
      { id: 'a1a1a1a1-0000-0000-0000-000000000001', triggeredBy: ALICE, stage: 'LEAD_SATELLITE', source: 'MANUAL', status: 'SUCCESS' },
      { id: 'a2a2a2a2-0000-0000-0000-000000000002', triggeredBy: BOB, stage: 'LEAD_SATELLITE', source: 'MANUAL', status: 'SUCCESS' },
    ]);
    // audit_log NOT NULL: organizationId, entity, entityId, action, actorType.
    await seed(schema.auditLog, [
      { id: 'd1d1d1d1-0000-0000-0000-000000000001', organizationId: ORG_A, actorId: ALICE, actorType: 'USER', entityId: '00000000-0000-0000-0000-0000000000e1', entity: 'campaigns', action: 'CREATE', at: new Date('2026-02-01T00:00:00Z') },
      { id: 'd2d2d2d2-0000-0000-0000-000000000002', organizationId: ORG_A, actorId: ALICE, actorType: 'USER', entityId: '00000000-0000-0000-0000-0000000000e2', entity: 'users', action: 'UPDATE', at: new Date('2026-02-02T00:00:00Z') },
      { id: 'd3d3d3d3-0000-0000-0000-000000000003', organizationId: ORG_A, actorId: BOB, actorType: 'USER', entityId: '00000000-0000-0000-0000-0000000000e3', entity: 'tenders', action: 'UPDATE', at: new Date('2026-02-03T00:00:00Z') },
    ]);
    const service = new UsersService(getDb());
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
    const { service } = await seed_();
    await seed(schema.authCredentials, { userId: BOB, passwordHash: 'x' });
    const res = await service.deleteUser(ORG_A, ALICE, BOB);
    expect(res.email).toBe('bob@evertrust-germany.de');
    const users = await rowsOf(schema.users);
    expect(users.some((u) => u.id === BOB)).toBe(false);
    const creds = await rowsOf(schema.authCredentials);
    expect(creds.some((c) => c.userId === BOB)).toBe(false);
  });

  it('blocks deleting your own account', async () => {
    const { service } = await seed_();
    await expect(service.deleteUser(ORG_A, BOB, BOB)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks deleting a Super Admin', async () => {
    const { service } = await seed_();
    await expect(service.deleteUser(ORG_A, BOB, ALICE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s deleting a user in another org (tenant-scoped)', async () => {
    const { service } = await seed_();
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
    const { service } = await seed_();
    const rows = await service.listAllForOrg(ORG_A, 'OWNER');
    expect(rows.map((r) => r.id).sort()).toEqual([ALICE, BOB, MALLORY].sort());
  });

  it('a non-Owner list stays confined to its own org', async () => {
    const { service } = await seed_();
    const rows = await service.listAllForOrg(ORG_A, 'SUPER_ADMIN');
    expect(rows.find((r) => r.id === MALLORY)).toBeUndefined();
  });

  it('an Owner can update a user in another org (cross-org)', async () => {
    const { service } = await seed_();
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
    const { service } = await seed_();
    await expect(
      service.updateUser(ORG_A, ALICE, MALLORY, { name: 'x' }, 'SUPER_ADMIN'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only an Owner can GRANT the Owner role (create + update)', async () => {
    const { service } = await seed_();
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
    const { service } = await seed_();
    await service.setPassword(ORG_A, 'OWNER', MALLORY, 'NewStrongPass1');
    await service.deleteUser(ORG_A, OWNER_ID, MALLORY, 'OWNER');
    const users = await rowsOf(schema.users);
    expect(users.some((u) => u.id === MALLORY)).toBe(false);
  });

  it('protects an Owner target from non-Owner modify/delete', async () => {
    const { service } = await seed_();
    // Promote BOB to OWNER so a SUPER_ADMIN must be blocked from touching him.
    await getDb()
      .update(schema.users)
      .set({ role: 'OWNER' })
      .where(eq(schema.users.id, BOB));
    await expect(
      service.updateUser(ORG_A, ALICE, BOB, { name: 'x' }, 'SUPER_ADMIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteUser(ORG_A, ALICE, BOB, 'SUPER_ADMIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
