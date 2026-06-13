import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { slugify } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';

type IndustryRow = typeof schema.industries.$inferSelect;

// Industry grouping vocabulary. An industry groups niches (one industry → many
// niches), org-scoped, for grouping/search ONLY — it is NEVER read by lead
// research (the campaign config + arsenal payload stay niche/targets only).
// `slug` (slugify of the display name) is the per-org dedup key. Mirrors
// NichesService: find-or-create + org-scoped CRUD with a delete guard.
@Injectable()
export class IndustriesService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // Find an industry by (org, slug) or create it. Returns the row. Idempotent: a
  // second call with the same name returns the same row.
  async findOrCreate(orgId: string, name: string): Promise<IndustryRow> {
    const slug = slugify(name);
    const existing = await this.db
      .select()
      .from(schema.industries)
      .where(
        and(
          tenantScope(orgId, schema.industries),
          eq(schema.industries.slug, slug),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    const inserted = await this.db
      .insert(schema.industries)
      .values({ organizationId: orgId, name: name.trim(), slug })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to create industry');
    return row;
  }

  // The org's industries, alphabetical.
  async list(orgId: string): Promise<IndustryRow[]> {
    return this.db
      .select()
      .from(schema.industries)
      .where(tenantScope(orgId, schema.industries))
      .orderBy(asc(schema.industries.name));
  }

  // One industry in the tenant. 404 if missing / cross-org.
  async require(orgId: string, id: string): Promise<IndustryRow> {
    const rows = await this.db
      .select()
      .from(schema.industries)
      .where(
        and(
          tenantScope(orgId, schema.industries),
          eq(schema.industries.id, id),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Industry not found');
    return row;
  }

  // The org's industries with a rollup count (the industries-management list).
  // Per industry: nicheCount (this org's niches grouped by industryId). ORG-
  // SCOPED via the industry's organizationId. Mirrors NichesService.listWithCounts'
  // in-memory tally so it stays one tenant-scoped read per relation.
  async listWithCounts(
    orgId: string,
  ): Promise<
    Array<{ id: string; name: string; slug: string; nicheCount: number }>
  > {
    const industries = await this.list(orgId);
    if (industries.length === 0) return [];
    const industryIds = new Set(industries.map((i) => i.id));

    // nicheCount: tally this org's niches grouped by industryId (niches carry
    // organizationId, so scoping the read to this org is the tenant boundary).
    const nicheRows = await this.db
      .select({ industryId: schema.niches.industryId })
      .from(schema.niches)
      .where(tenantScope(orgId, schema.niches));
    const nicheCounts = new Map<string, number>();
    for (const n of nicheRows) {
      if (n.industryId && industryIds.has(n.industryId)) {
        nicheCounts.set(n.industryId, (nicheCounts.get(n.industryId) ?? 0) + 1);
      }
    }

    return industries.map((i) => ({
      id: i.id,
      name: i.name,
      slug: i.slug,
      nicheCount: nicheCounts.get(i.id) ?? 0,
    }));
  }

  // Create an industry (JWT). Deduped by (org, slug) like findOrCreate — re-using
  // an existing name returns that row instead of duplicating.
  async create(orgId: string, name: string): Promise<IndustryRow> {
    return this.findOrCreate(orgId, name);
  }

  // Rename an industry (JWT). ORG-SCOPED (404 if missing / cross-org). A rename
  // re-derives the slug; a clash with a SIBLING industry's slug in the same org
  // would otherwise surface the (organization_id, slug) unique index as a raw 500,
  // so we pre-check and return a clear 409. Returns the updated row.
  async rename(orgId: string, id: string, name: string): Promise<IndustryRow> {
    await this.require(orgId, id); // 404 if missing / cross-org
    const slug = slugify(name);

    const clash = await this.db
      .select({ id: schema.industries.id })
      .from(schema.industries)
      .where(
        and(
          tenantScope(orgId, schema.industries),
          eq(schema.industries.slug, slug),
          ne(schema.industries.id, id),
        ),
      )
      .limit(1);
    if (clash[0]) {
      throw new ConflictException(
        'Another industry already uses that name',
      );
    }

    const updated = await this.db
      .update(schema.industries)
      .set({ name: name.trim(), slug })
      .where(eq(schema.industries.id, id))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundException('Industry not found');
    return row;
  }

  // Delete an industry (JWT). ORG-SCOPED (404 if missing / cross-org). BLOCKED with
  // a 409 when any niche still points at it — niches.industry_id has no cascade, so
  // a hard delete would FK-violate (500). The user reassigns the niches first
  // (PATCH /niches/:id/industry). Returns the deleted row.
  async delete(orgId: string, id: string): Promise<IndustryRow> {
    const before = await this.require(orgId, id);

    const assigned = await this.db
      .select({ id: schema.niches.id })
      .from(schema.niches)
      .where(
        and(
          tenantScope(orgId, schema.niches),
          eq(schema.niches.industryId, id),
        ),
      )
      .limit(1);
    if (assigned[0]) {
      throw new ConflictException(
        'Cannot delete this industry — niches are still assigned to it. Reassign its niches first.',
      );
    }

    await this.db
      .delete(schema.industries)
      .where(eq(schema.industries.id, id));
    return before;
  }
}
