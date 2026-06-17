import 'dotenv/config';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db } from './client';
import {
  authCredentials,
  customers,
  industries,
  nicheTargets,
  niches,
  organizations,
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
  // domain is the join key for Google-login auto-provisioning: future
  // @evertrust-germany.de logins resolve to THIS org rather than spawning a
  // duplicate. Set on fresh bootstrap; the early-return guard above keeps the
  // whole seed idempotent, so an existing org is never re-stamped here.
  const [org] = await db
    .insert(organizations)
    .values({
      name: 'Evertrust GmbH',
      slug: 'evertrust',
      domain: 'evertrust-germany.de',
    })
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

  await db.insert(customers).values({
    name: 'Stadtwerke Musterstadt',
    contact: 'einkauf@musterstadt.de',
    niches: ['water', 'energy'],
    organizationId: org.id,
  });

  // Sectors: the org's industry → niche → target catalog (the Lead Scraper's hunt
  // list). Mirrors scripts/0008_seed_sectors.sql for fresh bootstraps. The local
  // slug helper matches @evertrust/shared slugify() (no cross-package dep here).
  const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');
  const SECTORS: {
    industry: string;
    niches: { name: string; targets: string[] }[];
  }[] = [
    {
      industry: 'IT',
      niches: [
        { name: 'Cloud Infrastructure', targets: ['Cloud Provider', 'Managed Service Provider', 'System Integrator', 'Data Center Operator', 'Hosting Provider', 'Cloud Reseller'] },
        { name: 'Software Development', targets: ['Software Agency', 'SaaS Vendor', 'IT Consultancy', 'System Integrator', 'DevOps Vendor', 'Custom Software Shop'] },
        { name: 'AI Platform', targets: ['AI Platform Vendor', 'MLOps Provider', 'Data Analytics Platform', 'AI Consultancy', 'AI SaaS Startup', 'AI System Integrator'] },
        { name: 'Cybersecurity', targets: ['Managed Security Provider', 'Security Consultancy', 'SOC Provider', 'Penetration Testing Firm', 'Security Software Vendor', 'Compliance Auditor'] },
      ],
    },
    {
      industry: 'Power',
      niches: [
        { name: 'LED', targets: ['LED Manufacturer', 'Lighting Distributor', 'LED Installer', 'Electrical Contractor', 'Lighting Designer', 'Retrofit Specialist'] },
      ],
    },
    {
      industry: 'Transportation & Construction',
      niches: [
        { name: 'Container', targets: ['Container Manufacturer', 'Container Dealer', 'Container Modification Firm', 'Container Leasing Provider', 'Modular Building Provider', 'Freight Forwarder'] },
      ],
    },
  ];
  for (const sector of SECTORS) {
    const [industry] = await db
      .insert(industries)
      .values({ organizationId: org.id, name: sector.industry, slug: slug(sector.industry) })
      .returning();
    if (!industry) continue;
    for (const n of sector.niches) {
      const [niche] = await db
        .insert(niches)
        .values({ organizationId: org.id, name: n.name, slug: slug(n.name), industryId: industry.id })
        .returning();
      if (!niche || n.targets.length === 0) continue;
      await db.insert(nicheTargets).values(
        n.targets.map((name) => ({
          nicheId: niche.id,
          name,
          slug: slug(name),
          source: 'MANUAL' as const,
          enabled: true,
        })),
      );
    }
  }

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
