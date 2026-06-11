import 'dotenv/config';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db } from './client';
import {
  authCredentials,
  customers,
  organizations,
  suppliers,
  tenders,
  users,
} from './schema';

// Dev-only password for the two seeded users. NOT for any deployed environment.
const DEV_PASSWORD = 'Password123!';

// Minimal sample data for local/dev bootstrap. Run with `pnpm db:seed`.
// Safe to compile without a database; only inserts when executed.
async function seed(): Promise<void> {
  // Idempotent: if the bootstrap org already exists, this is a no-op, so the
  // migrate/seed one-shot can be safely re-run (e.g. on `docker compose up`).
  const existing = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, 'evertrust'))
    .limit(1);
  if (existing.length > 0) {
    console.log('Seed: organization already present, skipping.');
    return;
  }

  // Single-tenant bootstrap: every seeded row is scoped to this organization.
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Evertrust GmbH', slug: 'evertrust' })
    .returning();
  if (!org) throw new Error('Failed to seed organization');

  const [admin, pic] = await db
    .insert(users)
    .values([
      {
        name: 'Ada Admin',
        email: 'admin@evertrust-germany.de',
        role: 'SUPER_ADMIN',
        position: 'CEO',
        department: 'OPERATIONS',
        organizationId: org.id,
      },
      {
        name: 'Pia PIC',
        email: 'pic@evertrust-germany.de',
        role: 'EMPLOYEE',
        position: 'OFFICER',
        department: 'OPERATIONS',
        organizationId: org.id,
      },
    ])
    .returning();

  // Each seeded user gets an argon2 credential so local login works out of the box.
  const passwordHash = await argon2.hash(DEV_PASSWORD);
  await db.insert(authCredentials).values(
    [admin, pic]
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
      .map((u) => ({ userId: u.id, passwordHash })),
  );

  const [customer] = await db
    .insert(customers)
    .values({
      name: 'Stadtwerke Musterstadt',
      contact: 'einkauf@musterstadt.de',
      niches: ['water', 'energy'],
      organizationId: org.id,
    })
    .returning();

  await db.insert(suppliers).values([
    {
      name: 'Rohr & Ventil GmbH',
      niches: ['water'],
      capabilities: ['valves', 'pipes'],
      fitScore: '0.84',
      contact: 'sales@rohrventil.de',
      organizationId: org.id,
    },
    {
      name: 'ElektroTech AG',
      niches: ['energy'],
      capabilities: ['cabling', 'transformers'],
      fitScore: '0.71',
      contact: 'vertrieb@elektrotech.de',
      organizationId: org.id,
    },
  ]);

  await db.insert(tenders).values([
    {
      vergabeId: 'DE-2026-000123',
      source: 'dtvp',
      title: 'Erneuerung Trinkwasserleitung Nord',
      buyer: 'Stadt Musterstadt',
      customerId: customer?.id,
      regime: 'VgV',
      niche: 'water',
      status: 'PIC_PRICING',
      estimatedValue: '450000.00',
      isAboveThreshold: true,
      location: 'Musterstadt',
      organizationId: org.id,
    },
    {
      vergabeId: 'DE-2026-000456',
      source: 'evergabe',
      title: 'Wartung Trafostationen',
      buyer: 'Landkreis Beispiel',
      regime: 'UVgO',
      niche: 'energy',
      status: 'NOT_STARTED',
      estimatedValue: '85000.00',
      isAboveThreshold: false,
      location: 'Beispielstadt',
      organizationId: org.id,
    },
  ]);

  // Reference seeded users so the bindings are not flagged as unused.
  console.log(`Seeded users: ${admin?.email}, ${pic?.email}`);
}

seed()
  .then(() => {
    console.log('Seed complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
