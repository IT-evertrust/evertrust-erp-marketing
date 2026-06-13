import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { slugify } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';

type NicheRow = typeof schema.niches.$inferSelect;
type NicheTargetRow = typeof schema.nicheTargets.$inferSelect;

// Shared niche vocabulary. The SSOT for niche find-or-create (by org + slug) and
// niche-target bulk upsert — consumed by the campaigns launch, the arsenal payload
// builder, the manual-leads service, and the niches controller (UI combobox +
// machine list). `slug` (slugify of the display name) is the dedup key.
@Injectable()
export class NichesService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // Find a niche by (org, slug) or create it. Returns the row. Idempotent: a second
  // call with the same name returns the same row. Used by the AIM launch + manual
  // leads so the niche vocabulary stays a single shared set per org.
  async findOrCreate(orgId: string, name: string): Promise<NicheRow> {
    const slug = slugify(name);
    const existing = await this.db
      .select()
      .from(schema.niches)
      .where(and(tenantScope(orgId, schema.niches), eq(schema.niches.slug, slug)))
      .limit(1);
    if (existing[0]) return existing[0];

    const inserted = await this.db
      .insert(schema.niches)
      .values({ organizationId: orgId, name: name.trim(), slug })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to create niche');
    return row;
  }

  // The org's niches, alphabetical — the UI combobox + the machine niche list.
  async list(orgId: string): Promise<NicheRow[]> {
    return this.db
      .select()
      .from(schema.niches)
      .where(tenantScope(orgId, schema.niches))
      .orderBy(asc(schema.niches.name));
  }

  // One niche in the tenant. 404 if missing / cross-org.
  async require(orgId: string, id: string): Promise<NicheRow> {
    const rows = await this.db
      .select()
      .from(schema.niches)
      .where(and(tenantScope(orgId, schema.niches), eq(schema.niches.id, id)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Niche not found');
    return row;
  }

  // A niche's targets, newest-first. `enabledOnly` skips disabled archetypes (the
  // machine config view) — Lead Satellite hunts only enabled targets.
  async targets(nicheId: string, enabledOnly = false): Promise<NicheTargetRow[]> {
    const where = enabledOnly
      ? and(
          eq(schema.nicheTargets.nicheId, nicheId),
          eq(schema.nicheTargets.enabled, true),
        )
      : eq(schema.nicheTargets.nicheId, nicheId);
    return this.db
      .select()
      .from(schema.nicheTargets)
      .where(where)
      .orderBy(asc(schema.nicheTargets.name));
  }

  // Upsert AI target archetypes by (nicheId, slugify(name)). Existing rows update
  // their searchHint (and re-enable nothing — disabling is a deliberate human act);
  // new rows insert as source AI. Returns the per-row created/updated counts + the
  // full current target list. Caller verifies the niche is in the tenant first.
  async bulkTargets(
    nicheId: string,
    targets: { name: string; searchHint?: string }[],
  ): Promise<{ created: number; updated: number; targets: NicheTargetRow[] }> {
    let created = 0;
    let updated = 0;
    for (const t of targets) {
      const slug = slugify(t.name);
      const existing = await this.db
        .select()
        .from(schema.nicheTargets)
        .where(
          and(
            eq(schema.nicheTargets.nicheId, nicheId),
            eq(schema.nicheTargets.slug, slug),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await this.db
          .update(schema.nicheTargets)
          .set({ searchHint: t.searchHint ?? existing[0].searchHint })
          .where(eq(schema.nicheTargets.id, existing[0].id));
        updated++;
      } else {
        await this.db.insert(schema.nicheTargets).values({
          nicheId,
          name: t.name.trim(),
          slug,
          searchHint: t.searchHint ?? null,
          source: 'AI',
        });
        created++;
      }
    }
    return { created, updated, targets: await this.targets(nicheId) };
  }

  // ---- JWT (UI) management — org-scoped --------------------------------------

  // The org's niches with rollup counts (the niches-management list). Per niche:
  // targetCount (all targets, enabled + disabled), campaignCount (campaigns that
  // reference the niche), prospectCount (prospects whose campaign's niche is this
  // niche), and the niche's optional grouping parent industryId/industryName (null
  // when unassigned). ORG-SCOPED via the niche's organizationId. The industry is
  // resolved in-memory from this org's industries (one tenant-scoped read), mirroring
  // the existing count-tally style rather than a SQL join.
  async listWithCounts(
    orgId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      targetCount: number;
      campaignCount: number;
      prospectCount: number;
      industryId: string | null;
      industryName: string | null;
    }>
  > {
    const niches = await this.list(orgId);
    if (niches.length === 0) return [];
    const nicheIds = new Set(niches.map((n) => n.id));

    // targetCount: tally niche_targets grouped by nicheId (targets inherit org via
    // the niche, so scoping to this org's niche ids is the tenant boundary).
    const targetRows = await this.db
      .select({ nicheId: schema.nicheTargets.nicheId })
      .from(schema.nicheTargets);
    const targetCounts = new Map<string, number>();
    for (const t of targetRows) {
      if (nicheIds.has(t.nicheId)) {
        targetCounts.set(t.nicheId, (targetCounts.get(t.nicheId) ?? 0) + 1);
      }
    }

    // campaignCount: tally this org's campaigns grouped by nicheId. Also build a
    // campaignId -> nicheId map so prospects (which reference a campaign, not a
    // niche directly) can be rolled up to their niche below.
    const campaignRows = await this.db
      .select({ id: schema.campaigns.id, nicheId: schema.campaigns.nicheId })
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns));
    const campaignCounts = new Map<string, number>();
    const campaignNiche = new Map<string, string>();
    for (const c of campaignRows) {
      if (c.nicheId) {
        campaignCounts.set(c.nicheId, (campaignCounts.get(c.nicheId) ?? 0) + 1);
        campaignNiche.set(c.id, c.nicheId);
      }
    }

    // prospectCount: tally this org's prospects to their campaign's niche (via the
    // campaignId -> nicheId map). prospects.campaign_id is NOT NULL.
    const prospectRows = await this.db
      .select({ campaignId: schema.prospects.campaignId })
      .from(schema.prospects)
      .where(tenantScope(orgId, schema.prospects));
    const prospectCounts = new Map<string, number>();
    for (const p of prospectRows) {
      const nicheId = p.campaignId ? campaignNiche.get(p.campaignId) : undefined;
      if (nicheId) {
        prospectCounts.set(nicheId, (prospectCounts.get(nicheId) ?? 0) + 1);
      }
    }

    // Resolve the grouping industry name in-memory (this org's industries only).
    const industryRows = await this.db
      .select({ id: schema.industries.id, name: schema.industries.name })
      .from(schema.industries)
      .where(tenantScope(orgId, schema.industries));
    const industryName = new Map<string, string>();
    for (const i of industryRows) industryName.set(i.id, i.name);

    return niches.map((n) => ({
      id: n.id,
      name: n.name,
      slug: n.slug,
      targetCount: targetCounts.get(n.id) ?? 0,
      campaignCount: campaignCounts.get(n.id) ?? 0,
      prospectCount: prospectCounts.get(n.id) ?? 0,
      industryId: n.industryId ?? null,
      industryName: n.industryId
        ? industryName.get(n.industryId) ?? null
        : null,
    }));
  }

  // Assign a niche to an industry, or unassign it (industryId = null). JWT, ORG-
  // SCOPED: 404 if the niche is not in `orgId`, and (when industryId is non-null)
  // 404 if the industry is not in `orgId`. Grouping/search ONLY — this never feeds
  // lead research. Returns the updated niche row.
  async assignIndustry(
    orgId: string,
    nicheId: string,
    industryId: string | null,
  ): Promise<NicheRow> {
    await this.require(orgId, nicheId); // 404 if missing / cross-org

    if (industryId !== null) {
      // The industry must live in the same tenant — resolve it directly (a
      // cross-org or unknown id 404s, never silently links across orgs).
      const industry = await this.db
        .select({ id: schema.industries.id })
        .from(schema.industries)
        .where(
          and(
            tenantScope(orgId, schema.industries),
            eq(schema.industries.id, industryId),
          ),
        )
        .limit(1);
      if (!industry[0]) throw new NotFoundException('Industry not found');
    }

    const updated = await this.db
      .update(schema.niches)
      .set({ industryId })
      .where(eq(schema.niches.id, nicheId))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundException('Niche not found');
    return row;
  }

  // Create a niche directly (JWT — the niches-management view). slug = slugify(name)
  // is the per-org dedup key; a clash with an existing niche in the org is a 409
  // (vs. findOrCreate, which the AIM launch uses to silently reuse). When industryId
  // is given it must live in the SAME org (404 otherwise) — never link across
  // tenants. Returns the created row.
  async createNiche(
    orgId: string,
    name: string,
    industryId?: string | null,
  ): Promise<NicheRow> {
    const slug = slugify(name);
    const existing = await this.db
      .select({ id: schema.niches.id })
      .from(schema.niches)
      .where(and(tenantScope(orgId, schema.niches), eq(schema.niches.slug, slug)))
      .limit(1);
    if (existing[0]) {
      throw new ConflictException('A niche with that name already exists.');
    }

    if (industryId != null) {
      // The grouping industry must be in the caller's org — an unknown / cross-org
      // id 404s rather than silently creating an unlinked niche.
      const industry = await this.db
        .select({ id: schema.industries.id })
        .from(schema.industries)
        .where(
          and(
            tenantScope(orgId, schema.industries),
            eq(schema.industries.id, industryId),
          ),
        )
        .limit(1);
      if (!industry[0]) throw new NotFoundException('Industry not found');
    }

    const inserted = await this.db
      .insert(schema.niches)
      .values({
        organizationId: orgId,
        name: name.trim(),
        slug,
        ...(industryId != null ? { industryId } : {}),
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to create niche');
    return row;
  }

  // Rename a niche (JWT). ORG-SCOPED (404 if missing / cross-org). A rename re-derives
  // the slug; a clash with a SIBLING niche's slug in the same org would otherwise
  // surface the (organization_id, slug) unique index as a raw 500, so we pre-check
  // and return a clear 409. Returns the updated row.
  async renameNiche(orgId: string, id: string, name: string): Promise<NicheRow> {
    await this.require(orgId, id); // 404 if missing / cross-org
    const slug = slugify(name);

    const clash = await this.db
      .select({ id: schema.niches.id })
      .from(schema.niches)
      .where(
        and(
          tenantScope(orgId, schema.niches),
          eq(schema.niches.slug, slug),
          ne(schema.niches.id, id),
        ),
      )
      .limit(1);
    if (clash[0]) {
      throw new ConflictException('A niche with that name already exists.');
    }

    const updated = await this.db
      .update(schema.niches)
      .set({ name: name.trim(), slug })
      .where(eq(schema.niches.id, id))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundException('Niche not found');
    return row;
  }

  // Delete a niche (JWT). ORG-SCOPED (404 if missing / cross-org). BLOCKED with a 409
  // when the niche still has campaigns OR prospects: campaigns.niche_id is NOT NULL
  // (no cascade) so a hard delete would orphan/FK-violate, and prospects sit under
  // those campaigns (prospects.campaign_id, not a direct niche FK). When clear, the
  // niche's own niche_targets (its archetypes) are deleted first — they reference the
  // niche with no cascade — then the niche row. Returns the deleted row.
  async deleteNiche(orgId: string, id: string): Promise<NicheRow> {
    const before = await this.require(orgId, id); // 404 if missing / cross-org

    // The niche's campaigns (org-scoped). Their count blocks the delete, and their
    // ids are the bridge to prospects (which reference a campaign, not the niche).
    const campaignRows = await this.db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(
        and(
          tenantScope(orgId, schema.campaigns),
          eq(schema.campaigns.nicheId, id),
        ),
      );

    // Prospects under those campaigns. Counted per-campaign and summed (prospects
    // have no niche_id — the rollup is prospect → campaign → niche).
    let prospects = 0;
    for (const c of campaignRows) {
      const p = await this.db
        .select({ value: count() })
        .from(schema.prospects)
        .where(eq(schema.prospects.campaignId, c.id));
      prospects += p[0]?.value ?? 0;
    }

    if (campaignRows.length > 0 || prospects > 0) {
      throw new ConflictException(
        'This niche still has campaigns or prospects — reassign or archive them first.',
      );
    }

    // No dependents: clear the niche's own archetypes, then the niche row.
    await this.db
      .delete(schema.nicheTargets)
      .where(eq(schema.nicheTargets.nicheId, id));
    await this.db.delete(schema.niches).where(eq(schema.niches.id, id));
    return before;
  }

  // A niche's targets for the UI management view (enabled + disabled, BOTH). ORG-
  // SCOPED: 404 if the niche is not in `orgId`.
  async targetsForOrg(orgId: string, nicheId: string): Promise<NicheTargetRow[]> {
    await this.require(orgId, nicheId); // 404 if missing / cross-org
    return this.targets(nicheId);
  }

  // Add ONE MANUAL target to a niche (JWT). ORG-SCOPED (404 if the niche is not in
  // `orgId`). Upserts by (nicheId, slugify(name)) like the bulk route — an existing
  // slug updates its searchHint instead of duplicating. Returns the resulting row.
  async addManualTarget(
    orgId: string,
    nicheId: string,
    input: { name: string; searchHint?: string },
  ): Promise<NicheTargetRow> {
    await this.require(orgId, nicheId); // 404 if missing / cross-org
    const slug = slugify(input.name);
    const existing = await this.db
      .select()
      .from(schema.nicheTargets)
      .where(
        and(
          eq(schema.nicheTargets.nicheId, nicheId),
          eq(schema.nicheTargets.slug, slug),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const updated = await this.db
        .update(schema.nicheTargets)
        .set({ searchHint: input.searchHint ?? existing[0].searchHint })
        .where(eq(schema.nicheTargets.id, existing[0].id))
        .returning();
      return updated[0] ?? existing[0];
    }

    const inserted = await this.db
      .insert(schema.nicheTargets)
      .values({
        nicheId,
        name: input.name.trim(),
        slug,
        searchHint: input.searchHint ?? null,
        source: 'MANUAL',
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to create niche target');
    return row;
  }

  // One niche_target IN THE CALLER'S ORG, with its parent niche (for the org check
  // + audit org). 404 if the target is missing, or its niche is not in `orgId`.
  // nicheTargets has NO organizationId column — tenancy is via the parent niche.
  async requireTargetInOrg(
    orgId: string,
    targetId: string,
  ): Promise<{ target: NicheTargetRow; niche: NicheRow }> {
    const rows = await this.db
      .select()
      .from(schema.nicheTargets)
      .where(eq(schema.nicheTargets.id, targetId))
      .limit(1);
    const target = rows[0];
    if (!target) throw new NotFoundException('Niche target not found');
    // The parent niche IS the tenant boundary — require() 404s if it's cross-org.
    const niche = await this.require(orgId, target.nicheId);
    return { target, niche };
  }

  // Edit / enable / disable one target (JWT). ORG-SCOPED via the parent niche (404
  // if missing / cross-org). Applies only the supplied fields; a rename re-derives
  // the slug. Returns { target, niche } so the controller can audit in the niche's org.
  async updateTargetForOrg(
    orgId: string,
    targetId: string,
    patch: { enabled?: boolean; name?: string; searchHint?: string | null },
  ): Promise<{ target: NicheTargetRow; niche: NicheRow }> {
    const { niche } = await this.requireTargetInOrg(orgId, targetId);

    const set: Partial<typeof schema.nicheTargets.$inferInsert> = {};
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.name !== undefined) {
      const slug = slugify(patch.name);
      set.name = patch.name.trim();
      set.slug = slug;
      // A rename must not collide with a sibling target's slug in the same niche;
      // the (niche_id, slug) unique index would otherwise surface as a raw 500.
      const clash = await this.db
        .select({ id: schema.nicheTargets.id })
        .from(schema.nicheTargets)
        .where(
          and(
            eq(schema.nicheTargets.nicheId, niche.id),
            eq(schema.nicheTargets.slug, slug),
            ne(schema.nicheTargets.id, targetId),
          ),
        )
        .limit(1);
      if (clash[0]) {
        throw new ConflictException(
          'Another target in this niche already uses that name',
        );
      }
    }
    if (patch.searchHint !== undefined) set.searchHint = patch.searchHint;

    const updated = await this.db
      .update(schema.nicheTargets)
      .set(set)
      .where(eq(schema.nicheTargets.id, targetId))
      .returning();
    const target = updated[0];
    if (!target) throw new NotFoundException('Niche target not found');
    return { target, niche };
  }

  // Hard-delete one target (JWT). ORG-SCOPED via the parent niche (404 if missing /
  // cross-org). Returns { deleted, niche } so the controller can audit in the org.
  async deleteTargetForOrg(
    orgId: string,
    targetId: string,
  ): Promise<{ deleted: boolean; niche: NicheRow }> {
    const { niche } = await this.requireTargetInOrg(orgId, targetId);
    await this.db
      .delete(schema.nicheTargets)
      .where(eq(schema.nicheTargets.id, targetId));
    return { deleted: true, niche };
  }
}
