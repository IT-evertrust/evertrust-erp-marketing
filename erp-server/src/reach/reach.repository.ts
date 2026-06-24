import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { schema } from '@evertrust/db';

import { DB, type DbClient } from '../db/db.tokens';

// The transaction client type (same query builders as DbClient, scoped to a tx).
type Tx = Parameters<Parameters<DbClient['transaction']>[0]>[0];

// kind -> the reach_sends property a tracking signal stamps.
const TRACK_PROP = {
  open: 'openedAt',
  click: 'clickedAt',
  reply: 'repliedAt',
} as const;
import { tenantScope } from '../common/tenant';
import type { CreateAimDto } from './dto/create-aim.dto';
import {
  EMPTY_ROUND_STATS,
  EMPTY_STATS,
  type AimStatus,
  type ReachAim,
  type ReachLead,
  type ReachNewsBrief,
  type ReachRound,
  type ReachStats,
  type ReachTemplates,
  type TrackKind,
} from './reach.model';

type AimRow = typeof schema.reachAims.$inferSelect;
type LeadRow = typeof schema.reachLeads.$inferSelect;

// A sanitized lead ready to persist (the service validates the agent output).
export type LeadInsert = {
  company: string;
  website?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  source?: string | null;
  qualificationReason?: string | null;
  confidence?: number | null;
};

function toIso(d: Date | null): string {
  return (d ?? new Date()).toISOString();
}

// Normalize the stored jsonb (possibly null/partial) into a full ReachStats so
// the UI always gets every round + metric.
function mergeStats(raw: unknown): ReachStats {
  const s = (raw ?? {}) as Partial<ReachStats>;
  return {
    cold: { ...EMPTY_ROUND_STATS, ...(s.cold ?? {}) },
    followup: { ...EMPTY_ROUND_STATS, ...(s.followup ?? {}) },
    final: { ...EMPTY_ROUND_STATS, ...(s.final ?? {}) },
  };
}

function rowToAim(row: AimRow): ReachAim {
  return {
    id: row.id,
    name: row.name,
    niche: row.niche,
    region: row.region,
    country: row.country ?? undefined,
    project: row.project ?? undefined,
    gmailLabel: row.gmailLabel ?? undefined,
    whatsappNumber: row.whatsappNumber ?? undefined,
    salesCalendarId: row.salesCalendarId ?? undefined,
    segment: row.segment ?? undefined,
    source: row.source ?? undefined,
    targetType: row.targetType ?? undefined,
    industryFocus: row.industryFocus ?? undefined,
    tenderFocus: row.tenderFocus ?? undefined,
    campaignId: row.campaignId ?? null,
    status: row.status,
    companies: row.companies,
    scrapeStartedAt: row.scrapeStartedAt ? row.scrapeStartedAt.toISOString() : null,
    scrapeEtaSeconds: row.scrapeEtaSeconds ?? null,
    scrapeLastSeconds: row.scrapeLastSeconds ?? null,
    scrapeError: row.scrapeError ?? null,
    sender: row.sender,
    templates: (row.templates as ReachTemplates | null) ?? null,
    newsBrief: (row.newsBrief as ReachNewsBrief | null) ?? null,
    generatedBy: row.generatedBy ?? null,
    stats: mergeStats(row.stats),
    autoSend: row.autoSend,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

// Round -> the lead status it advances eligible leads to (for the Lead Scraper
// display). Final push keeps FOLLOWED_UP (no further enum level).
const ROUND_ADVANCE: Record<ReachRound, 'COLD_OUTREACHED' | 'FOLLOWED_UP' | null> =
  {
    cold: 'COLD_OUTREACHED',
    followup: 'FOLLOWED_UP',
    final: null,
  };

const ROUNDS: ReachRound[] = ['cold', 'followup', 'final'];

function rowToLead(row: LeadRow): ReachLead {
  return {
    id: row.id,
    aimId: row.aimId,
    company: row.company,
    website: row.website ?? undefined,
    contactName: row.contactName ?? undefined,
    contactTitle: row.contactTitle ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    location: row.location ?? undefined,
    source: row.source ?? undefined,
    qualificationReason: row.qualificationReason ?? undefined,
    confidence: row.confidence ?? undefined,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

@Injectable()
export class ReachRepository {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  async createAim(orgId: string, dto: CreateAimDto): Promise<ReachAim> {
    const [row] = await this.db
      .insert(schema.reachAims)
      .values({
        organizationId: orgId,
        name: dto.name,
        niche: dto.niche,
        region: dto.region,
        country: dto.country ?? null,
        project: dto.project ?? null,
        gmailLabel: dto.gmailLabel ?? null,
        whatsappNumber: dto.whatsappNumber ?? null,
        salesCalendarId: dto.salesCalendarId ?? null,
        segment: dto.segment ?? null,
        source: dto.source ?? null,
        targetType: dto.targetType ?? null,
        industryFocus: dto.industryFocus ?? null,
        tenderFocus: dto.tenderFocus ?? null,
        sender: dto.sender || 'info',
        status: 'DRAFT',
      })
      .returning();
    return rowToAim(row!);
  }

  // Create the campaign an aim links to (1:1). A bare insert — NO AIM webhook, no n8n:
  // Reach (Python) owns the processing. The campaign is ACTIVE because the aim IS a
  // live campaign (it shows as active, is the default on the Nurture board, and counts
  // in active metrics). Safe to be ACTIVE: the n8n send paths that gated on ACTIVE are
  // retired. Returns the campaign id.
  async createLinkedCampaign(
    orgId: string,
    nicheId: string,
    aim: ReachAim,
  ): Promise<string> {
    const [row] = await this.db
      .insert(schema.campaigns)
      .values({
        organizationId: orgId,
        name: aim.name,
        nicheId,
        country: aim.country ?? 'Germany',
        region: aim.region,
        project: aim.project ?? aim.name,
        gmailLabel: aim.gmailLabel ?? '',
        whatsappNumber: aim.whatsappNumber ?? '',
        salesCalendarId: aim.salesCalendarId ?? null,
        sender: aim.sender,
        lifecycle: 'ACTIVE',
      })
      .returning({ id: schema.campaigns.id });
    return row!.id;
  }

  // Link an aim to its campaign (org-scoped).
  async setAimCampaign(
    orgId: string,
    aimId: string,
    campaignId: string,
  ): Promise<void> {
    await this.db
      .update(schema.reachAims)
      .set({ campaignId, updatedAt: new Date() })
      .where(
        and(eq(schema.reachAims.id, aimId), tenantScope(orgId, schema.reachAims)),
      );
  }

  // Mirror the aim's scraped leads INTO the campaign's prospects so they appear in
  // the shared Nurture/Engage pipeline. Only leads WITH an email mirror (prospects.email
  // is NOT NULL). Upsert on (campaignId, email): on conflict the scraped fields refresh
  // but the conversation state (status/snooze/followup) NEVER regresses. Returns the
  // count mirrored. Best-effort — callers swallow errors (the scrape already succeeded).
  async mirrorLeadsToProspects(
    orgId: string,
    campaignId: string,
    leads: LeadInsert[],
    country: string | null,
  ): Promise<number> {
    const rows = leads
      .filter((l) => (l.email ?? '').trim())
      .map((l) => ({
        organizationId: orgId,
        campaignId,
        email: l.email!.trim(),
        companyName: l.company,
        website: l.website ?? null,
        city: l.location ?? null,
        country: country ?? null,
        sourceUrl: l.source ?? null,
        emailVerified: false,
      }));
    if (rows.length === 0) return 0;
    await this.db
      .insert(schema.prospects)
      .values(rows)
      .onConflictDoUpdate({
        target: [schema.prospects.campaignId, schema.prospects.email],
        set: {
          companyName: sql`excluded.company_name`,
          website: sql`excluded.website`,
          city: sql`excluded.city`,
          country: sql`excluded.country`,
          sourceUrl: sql`excluded.source_url`,
          updatedAt: new Date(),
        },
      });
    return rows.length;
  }

  async setGenerated(
    orgId: string,
    aimId: string,
    data: {
      templates: ReachTemplates;
      newsBrief: ReachNewsBrief;
      generatedBy: string;
      status: AimStatus;
    },
  ): Promise<ReachAim | undefined> {
    const [row] = await this.db
      .update(schema.reachAims)
      .set({
        templates: data.templates,
        newsBrief: data.newsBrief,
        generatedBy: data.generatedBy,
        status: data.status,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.reachAims.id, aimId), tenantScope(orgId, schema.reachAims)),
      )
      .returning();
    return row ? rowToAim(row) : undefined;
  }

  async setStatus(
    orgId: string,
    aimId: string,
    status: AimStatus,
  ): Promise<ReachAim | undefined> {
    const [row] = await this.db
      .update(schema.reachAims)
      .set({ status, updatedAt: new Date() })
      .where(
        and(eq(schema.reachAims.id, aimId), tenantScope(orgId, schema.reachAims)),
      )
      .returning();
    return row ? rowToAim(row) : undefined;
  }

  // Mark a scrape as started: status RUNNING + stamp the start time and the ETA
  // estimate (so the UI can render a server-seeded countdown that survives reloads).
  async markScrapeStarted(
    orgId: string,
    aimId: string,
    etaSeconds: number,
  ): Promise<ReachAim | undefined> {
    const [row] = await this.db
      .update(schema.reachAims)
      .set({
        status: 'RUNNING',
        scrapeStartedAt: new Date(),
        scrapeEtaSeconds: etaSeconds,
        scrapeError: null, // clear any prior failure reason on a fresh run
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.reachAims.id, aimId), tenantScope(orgId, schema.reachAims)),
      )
      .returning();
    return row ? rowToAim(row) : undefined;
  }

  // Mark a background scrape as FAILED + record WHY (the agent error / reason) so the
  // UI can show the cause instead of a generic "failed".
  async markScrapeFailed(
    orgId: string,
    aimId: string,
    error?: string | null,
  ): Promise<ReachAim | undefined> {
    const [row] = await this.db
      .update(schema.reachAims)
      .set({ status: 'FAILED', scrapeError: error ?? null, updatedAt: new Date() })
      .where(
        and(eq(schema.reachAims.id, aimId), tenantScope(orgId, schema.reachAims)),
      )
      .returning();
    return row ? rowToAim(row) : undefined;
  }

  async findAims(orgId: string): Promise<ReachAim[]> {
    const rows = await this.db
      .select()
      .from(schema.reachAims)
      .where(tenantScope(orgId, schema.reachAims))
      .orderBy(desc(schema.reachAims.createdAt));
    // Reconcile the denormalized `companies` with the LIVE reach_leads count: an older
    // scraper version could record a count without persisting the lead rows, leaving a
    // phantom number (companies=98 but 0 leads). Deriving it on read makes the displayed
    // count always the truth — even for legacy rows or if a re-scrape later fails. The
    // stored column stays a cache (kept in sync by replaceLeads + the 0045 backfill).
    const counts = await this.db
      .select({ aimId: schema.reachLeads.aimId, n: count() })
      .from(schema.reachLeads)
      .where(tenantScope(orgId, schema.reachLeads))
      .groupBy(schema.reachLeads.aimId);
    const byAim = new Map(counts.map((c) => [c.aimId, Number(c.n)]));
    return rows.map((r) => ({ ...rowToAim(r), companies: byAim.get(r.id) ?? 0 }));
  }

  async findAimById(orgId: string, aimId: string): Promise<ReachAim | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.reachAims)
      .where(
        and(eq(schema.reachAims.id, aimId), tenantScope(orgId, schema.reachAims)),
      )
      .limit(1);
    return row ? rowToAim(row) : undefined;
  }

  // Replace this aim's leads with a fresh scrape, then update the companies count
  // and mark the aim COMPLETED. Done in one transaction so the count never drifts.
  // `lastSeconds` (when given) records the run duration to seed the next ETA.
  async replaceLeads(
    orgId: string,
    aimId: string,
    leads: LeadInsert[],
    lastSeconds?: number,
  ): Promise<ReachLead[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(schema.reachLeads)
        .where(
          and(
            eq(schema.reachLeads.aimId, aimId),
            tenantScope(orgId, schema.reachLeads),
          ),
        );

      let inserted: ReachLead[] = [];
      if (leads.length > 0) {
        const rows = await tx
          .insert(schema.reachLeads)
          .values(
            leads.map((l) => ({
              organizationId: orgId,
              aimId,
              company: l.company,
              website: l.website ?? null,
              contactName: l.contactName ?? null,
              contactTitle: l.contactTitle ?? null,
              email: l.email ?? null,
              phone: l.phone ?? null,
              location: l.location ?? null,
              source: l.source ?? null,
              qualificationReason: l.qualificationReason ?? null,
              confidence: l.confidence ?? null,
            })),
          )
          .returning();
        inserted = rows.map(rowToLead);
      }

      await tx
        .update(schema.reachAims)
        .set({
          companies: inserted.length,
          status: 'COMPLETED',
          scrapeError: null, // success clears any prior failure reason
          ...(lastSeconds != null ? { scrapeLastSeconds: lastSeconds } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.reachAims.id, aimId),
            tenantScope(orgId, schema.reachAims),
          ),
        );

      return inserted;
    });
  }

  async findLeadsByAimId(orgId: string, aimId: string): Promise<ReachLead[]> {
    const rows = await this.db
      .select()
      .from(schema.reachLeads)
      .where(
        and(
          eq(schema.reachLeads.aimId, aimId),
          tenantScope(orgId, schema.reachLeads),
        ),
      )
      .orderBy(desc(schema.reachLeads.confidence));
    return rows.map(rowToLead);
  }

  // ---- send + stats (reach_sends is the source of truth) ----

  // Leads eligible to receive `round`: those that got the prior round but not this
  // one (cold = leads with no cold send yet). Includes company/email for delivery.
  private async eligibleLeads(
    tx: Tx,
    orgId: string,
    aimId: string,
    round: ReachRound,
  ): Promise<Array<{ id: string; company: string; email: string | null }>> {
    const leads = await tx
      .select({
        id: schema.reachLeads.id,
        company: schema.reachLeads.company,
        email: schema.reachLeads.email,
      })
      .from(schema.reachLeads)
      .where(
        and(
          eq(schema.reachLeads.aimId, aimId),
          tenantScope(orgId, schema.reachLeads),
        ),
      );
    const sends = await tx
      .select({ leadId: schema.reachSends.leadId, round: schema.reachSends.round })
      .from(schema.reachSends)
      .where(
        and(
          eq(schema.reachSends.aimId, aimId),
          tenantScope(orgId, schema.reachSends),
        ),
      );
    const has = (leadId: string, r: ReachRound) =>
      sends.some((s) => s.leadId === leadId && s.round === r);

    return leads.filter((l) => {
      if (round === 'cold') return !has(l.id, 'cold');
      if (round === 'followup') return has(l.id, 'cold') && !has(l.id, 'followup');
      return has(l.id, 'followup') && !has(l.id, 'final');
    });
  }

  // Recompute the full per-round stats from reach_sends (the cache write).
  private async computeStats(
    tx: Tx,
    orgId: string,
    aimId: string,
  ): Promise<ReachStats> {
    const rows = await tx
      .select({
        round: schema.reachSends.round,
        sent: count(),
        opened: count(schema.reachSends.openedAt),
        clicked: count(schema.reachSends.clickedAt),
        replied: count(schema.reachSends.repliedAt),
      })
      .from(schema.reachSends)
      .where(
        and(
          eq(schema.reachSends.aimId, aimId),
          tenantScope(orgId, schema.reachSends),
        ),
      )
      .groupBy(schema.reachSends.round);

    const stats: ReachStats = {
      cold: { ...EMPTY_ROUND_STATS },
      followup: { ...EMPTY_ROUND_STATS },
      final: { ...EMPTY_ROUND_STATS },
    };
    for (const r of rows) {
      stats[r.round] = {
        sent: Number(r.sent),
        opened: Number(r.opened),
        clicked: Number(r.clicked),
        replied: Number(r.replied),
        bounced: 0,
        meetings: 0,
      };
    }
    return stats;
  }

  // Record a send for one round: create a reach_sends row per eligible lead, advance
  // lead statuses for display, recompute stats. Idempotent (eligibility excludes
  // already-sent leads). Real Gmail delivery is deferred.
  async recordSend(
    orgId: string,
    aimId: string,
    round: ReachRound,
  ): Promise<{
    aim: ReachAim | undefined;
    sentLeads: Array<{ company: string; email: string | null }>;
  }> {
    return this.db.transaction(async (tx) => {
      const eligible = await this.eligibleLeads(tx, orgId, aimId, round);
      if (eligible.length > 0) {
        const ids = eligible.map((l) => l.id);
        await tx
          .insert(schema.reachSends)
          .values(
            ids.map((leadId) => ({ organizationId: orgId, aimId, leadId, round })),
          )
          .onConflictDoNothing();

        const advanceTo = ROUND_ADVANCE[round];
        if (advanceTo) {
          await tx
            .update(schema.reachLeads)
            .set({ status: advanceTo, updatedAt: new Date() })
            .where(
              and(
                tenantScope(orgId, schema.reachLeads),
                inArray(schema.reachLeads.id, ids),
              ),
            );
        }
      }

      const stats = await this.computeStats(tx, orgId, aimId);
      const [updated] = await tx
        .update(schema.reachAims)
        .set({ stats, updatedAt: new Date() })
        .where(
          and(
            eq(schema.reachAims.id, aimId),
            tenantScope(orgId, schema.reachAims),
          ),
        )
        .returning();
      return {
        aim: updated ? rowToAim(updated) : undefined,
        sentLeads: eligible.map((l) => ({ company: l.company, email: l.email })),
      };
    });
  }

  // The next round with eligible leads (cold -> followup -> final), or null if the
  // sequence is complete. Used by Reach Bazooka.
  async nextDueRound(orgId: string, aimId: string): Promise<ReachRound | null> {
    return this.db.transaction(async (tx) => {
      for (const r of ROUNDS) {
        const eligible = await this.eligibleLeads(tx, orgId, aimId, r);
        if (eligible.length > 0) return r;
      }
      return null;
    });
  }

  // ---- Bazooka toggle ----
  async setAutoSend(
    orgId: string,
    aimId: string,
    enabled: boolean,
  ): Promise<ReachAim | undefined> {
    const [row] = await this.db
      .update(schema.reachAims)
      .set({ autoSend: enabled, updatedAt: new Date() })
      .where(
        and(eq(schema.reachAims.id, aimId), tenantScope(orgId, schema.reachAims)),
      )
      .returning();
    return row ? rowToAim(row) : undefined;
  }

  async findAutoSendAims(orgId: string): Promise<ReachAim[]> {
    const rows = await this.db
      .select()
      .from(schema.reachAims)
      .where(
        and(
          tenantScope(orgId, schema.reachAims),
          eq(schema.reachAims.autoSend, true),
        ),
      )
      .orderBy(desc(schema.reachAims.createdAt));
    return rows.map(rowToAim);
  }

  // ---- tracking (public endpoints; org derived from the send row) ----
  // Stamp open/click/reply on the (lead, round) send row (once), then recompute
  // the aim's stats. Returns false if there is no matching send to track.
  async trackEvent(
    aimId: string,
    round: ReachRound,
    leadId: string,
    kind: TrackKind,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [send] = await tx
        .select()
        .from(schema.reachSends)
        .where(
          and(
            eq(schema.reachSends.aimId, aimId),
            eq(schema.reachSends.leadId, leadId),
            eq(schema.reachSends.round, round),
          ),
        )
        .limit(1);
      if (!send) return false;

      const prop = TRACK_PROP[kind];
      if (send[prop] == null) {
        await tx
          .update(schema.reachSends)
          .set({ [prop]: new Date() })
          .where(eq(schema.reachSends.id, send.id));
      }

      const orgId = send.organizationId;
      const stats = await this.computeStats(tx, orgId, aimId);
      await tx
        .update(schema.reachAims)
        .set({ stats, updatedAt: new Date() })
        .where(
          and(
            eq(schema.reachAims.id, aimId),
            tenantScope(orgId, schema.reachAims),
          ),
        );
      return true;
    });
  }

  // Mark a lead as REPLIED on its most-recent send (Engage classified an inbound
  // reply) and recompute the aim's stats cache — the same machinery as trackEvent,
  // but keyed by aim+lead rather than a specific (round, tracking-pixel) hit. Stamps
  // repliedAt on the latest send row (max sentAt) when it is still null, so a re-scan
  // is idempotent and never double-counts. Org-scoped. Returns whether a send was
  // stamped (false when the lead has no send, or it was already marked replied).
  async markLeadReplied(orgId: string, aimId: string, leadId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [send] = await tx
        .select()
        .from(schema.reachSends)
        .where(
          and(
            eq(schema.reachSends.aimId, aimId),
            eq(schema.reachSends.leadId, leadId),
            tenantScope(orgId, schema.reachSends),
          ),
        )
        .orderBy(desc(schema.reachSends.sentAt))
        .limit(1);
      if (!send || send.repliedAt != null) return false;

      await tx
        .update(schema.reachSends)
        .set({ repliedAt: new Date() })
        .where(eq(schema.reachSends.id, send.id));

      const stats = await this.computeStats(tx, orgId, aimId);
      await tx
        .update(schema.reachAims)
        .set({ stats, updatedAt: new Date() })
        .where(
          and(
            eq(schema.reachAims.id, aimId),
            tenantScope(orgId, schema.reachAims),
          ),
        );
      return true;
    });
  }

  // The lead ids this campaign has actually emailed (has a reach_sends row for). The
  // Engage scan uses it to skip leads with zero sends — a lead never contacted by THIS
  // campaign whose Gmail thread is pre-existing / cross-campaign history we must not
  // ingest. Org-scoped.
  async leadIdsWithSends(orgId: string, aimId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectDistinct({ leadId: schema.reachSends.leadId })
      .from(schema.reachSends)
      .where(
        and(
          tenantScope(orgId, schema.reachSends),
          eq(schema.reachSends.aimId, aimId),
        ),
      );
    return new Set(rows.map((r) => r.leadId));
  }

  // ---- Org default outreach template + signature (org_config) ----

  // The org-wide default 3-round outreach template the bazooka sends, or null (none set
  // → fall back to the campaign's AI-generated templates).
  async getDefaultTemplate(orgId: string): Promise<ReachTemplates | null> {
    const [row] = await this.db
      .select({ t: schema.orgConfig.defaultTemplate })
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    return (row?.t as ReachTemplates | null) ?? null;
  }

  // Save the org-wide default outreach template (find-or-creates the org_config row).
  async setDefaultTemplate(orgId: string, template: ReachTemplates): Promise<void> {
    await this.db
      .insert(schema.orgConfig)
      .values({ organizationId: orgId, defaultTemplate: template })
      .onConflictDoUpdate({
        target: schema.orgConfig.organizationId,
        set: { defaultTemplate: template, updatedAt: new Date() },
      });
  }

  // The org's configured signature image URL (embedded in outgoing emails), or null.
  // The image itself is managed by the arsenal SignatureAssetsService (upload/serve);
  // this reads the same canonical org_config.signature_image_url it writes.
  async getSignatureImageUrl(orgId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ url: schema.orgConfig.signatureImageUrl })
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    return row?.url ?? null;
  }

  // Set (or clear, with null) the org signature image URL (find-or-creates the row).
  async setSignatureImageUrl(orgId: string, url: string | null): Promise<void> {
    await this.db
      .insert(schema.orgConfig)
      .values({ organizationId: orgId, signatureImageUrl: url })
      .onConflictDoUpdate({
        target: schema.orgConfig.organizationId,
        set: { signatureImageUrl: url, updatedAt: new Date() },
      });
  }

  // ---- Reach send-policy settings (per-org override columns on org_config) ----

  // The org's stored Reach send-policy OVERRIDES (null = "use the env default",
  // resolved in the service). Returns all-null when the org has no org_config row yet.
  async getReachSettings(orgId: string): Promise<{
    mode: string | null;
    testRecipient: string | null;
    cap: number | null;
  }> {
    const rows = await this.db
      .select({
        mode: schema.orgConfig.reachSendMode,
        testRecipient: schema.orgConfig.reachTestRecipient,
        cap: schema.orgConfig.reachTestSendCap,
      })
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);

    return rows[0] ?? { mode: null, testRecipient: null, cap: null };
  }

  // Persist a partial Reach send-policy override. Only the provided keys are written
  // (an omitted key leaves that column unchanged; an explicit `null` resets it to the
  // env default). Find-or-creates the org_config row.
  async setReachSettings(
    orgId: string,
    patch: {
      mode?: string | null;
      testRecipient?: string | null;
      cap?: number | null;
    },
  ): Promise<void> {
    const set: Partial<typeof schema.orgConfig.$inferInsert> = {};
    if ('mode' in patch) set.reachSendMode = patch.mode ?? null;
    if ('testRecipient' in patch) set.reachTestRecipient = patch.testRecipient ?? null;
    if ('cap' in patch) set.reachTestSendCap = patch.cap ?? null;
    if (Object.keys(set).length === 0) return;

    await this.db
      .insert(schema.orgConfig)
      .values({ organizationId: orgId, ...set })
      .onConflictDoUpdate({
        target: schema.orgConfig.organizationId,
        set: { ...set, updatedAt: new Date() },
      });
  }

  // Daily Reach send counts over the last 10 days (grouped by sent_at::date). The
  // service zero-fills the gaps + labels "Today". Org-scoped.
  async dailySends(orgId: string): Promise<Array<{ day: Date; count: number }>> {
    const day = sql<Date>`${schema.reachSends.sentAt}::date`;
    const rows = await this.db
      .select({ day, count: count() })
      .from(schema.reachSends)
      .where(
        and(
          tenantScope(orgId, schema.reachSends),
          gte(schema.reachSends.sentAt, sql`now() - interval '9 days'`),
        ),
      )
      .groupBy(day);
    return rows.map((r) => ({ day: new Date(r.day), count: Number(r.count) }));
  }
}
