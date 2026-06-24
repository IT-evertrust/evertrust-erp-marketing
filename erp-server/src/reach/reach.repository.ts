import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { PipelineStage } from '@evertrust/shared';

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
  type ReachBoardResult,
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
    segment: row.segment ?? undefined,
    source: row.source ?? undefined,
    status: row.status,
    companies: row.companies,
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
    pipelineStage: row.pipelineStage,
    dealValue: row.dealValue,
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
        segment: dto.segment ?? null,
        source: dto.source ?? null,
        sender: dto.sender || 'info',
        status: 'DRAFT',
      })
      .returning();
    return rowToAim(row!);
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

  async findAims(orgId: string): Promise<ReachAim[]> {
    const rows = await this.db
      .select()
      .from(schema.reachAims)
      .where(tenantScope(orgId, schema.reachAims))
      .orderBy(desc(schema.reachAims.createdAt));
    return rows.map(rowToAim);
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
  async replaceLeads(
    orgId: string,
    aimId: string,
    leads: LeadInsert[],
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

  // ---- Nurture board (reach_leads ARE the pipeline cards) ----

  // All of the org's leads (optionally one aim), with their aim's niche joined for
  // the card tag + niche filter. Tallies stageCounts + statusCounts over the FULL
  // filtered set (org [+ aim] [+ company search]), then pages `items`. Counts are
  // independent of the page window so the column headers stay correct while scrolling.
  async boardLeads(
    orgId: string,
    opts: { aimId?: string; q?: string; limit?: number; offset?: number },
  ): Promise<ReachBoardResult> {
    const where = and(
      tenantScope(orgId, schema.reachLeads),
      opts.aimId ? eq(schema.reachLeads.aimId, opts.aimId) : undefined,
      opts.q
        ? sql`lower(${schema.reachLeads.company}) like ${'%' + opts.q.toLowerCase() + '%'}`
        : undefined,
    );

    const rows = await this.db
      .select({ lead: schema.reachLeads, niche: schema.reachAims.niche })
      .from(schema.reachLeads)
      // LEFT join: unassigned manual deals (aim_id null) still appear, with no niche.
      .leftJoin(schema.reachAims, eq(schema.reachLeads.aimId, schema.reachAims.id))
      .where(where)
      .orderBy(desc(schema.reachLeads.dealValue), desc(schema.reachLeads.confidence));

    const stageCounts = {} as Record<PipelineStage, number>;
    const statusCounts: Record<string, number> = {};
    for (const r of rows) {
      stageCounts[r.lead.pipelineStage] =
        (stageCounts[r.lead.pipelineStage] ?? 0) + 1;
      statusCounts[r.lead.status] = (statusCounts[r.lead.status] ?? 0) + 1;
    }

    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 500;
    const items = rows
      .slice(offset, offset + limit)
      .map((r) => ({ ...rowToLead(r.lead), niche: r.niche ?? undefined }));

    return { items, total: rows.length, statusCounts, stageCounts };
  }

  // Move a lead to another pipeline stage (the Nurture drag). Org-scoped; undefined
  // if the lead is missing or cross-org.
  async updateLeadStage(
    orgId: string,
    leadId: string,
    stage: PipelineStage,
  ): Promise<ReachLead | undefined> {
    const [row] = await this.db
      .update(schema.reachLeads)
      .set({ pipelineStage: stage, updatedAt: new Date() })
      .where(
        and(
          eq(schema.reachLeads.id, leadId),
          tenantScope(orgId, schema.reachLeads),
        ),
      )
      .returning();
    return row ? rowToLead(row) : undefined;
  }

  // Inline-edit a lead's deal value / contact fields on the Nurture card. Only the
  // provided fields change. Org-scoped; undefined if missing or cross-org.
  async updateLeadDeal(
    orgId: string,
    leadId: string,
    patch: {
      company?: string;
      dealValue?: number;
      contactName?: string | null;
      phone?: string | null;
      aimId?: string | null;
    },
  ): Promise<ReachLead | undefined> {
    const set: Partial<LeadRow> = { updatedAt: new Date() };
    if (patch.company !== undefined && patch.company.trim())
      set.company = patch.company.trim();
    if (patch.dealValue !== undefined) set.dealValue = patch.dealValue;
    if (patch.contactName !== undefined) set.contactName = patch.contactName;
    if (patch.phone !== undefined) set.phone = patch.phone;
    if (patch.aimId !== undefined) set.aimId = patch.aimId; // attach/detach campaign

    const [row] = await this.db
      .update(schema.reachLeads)
      .set(set)
      .where(
        and(
          eq(schema.reachLeads.id, leadId),
          tenantScope(orgId, schema.reachLeads),
        ),
      )
      .returning();
    return row ? rowToLead(row) : undefined;
  }

  // Manually add a Nurture card (a reach_lead) to an aim at a given stage — the
  // board's "+ Add deal". The aim is verified org-scoped by the caller.
  async createLead(
    orgId: string,
    input: {
      aimId?: string | null;
      company: string;
      pipelineStage: PipelineStage;
      dealValue: number;
      contactName?: string | null;
      phone?: string | null;
    },
  ): Promise<ReachLead> {
    const [row] = await this.db
      .insert(schema.reachLeads)
      .values({
        organizationId: orgId,
        aimId: input.aimId ?? null,
        company: input.company,
        pipelineStage: input.pipelineStage,
        dealValue: input.dealValue,
        contactName: input.contactName ?? null,
        phone: input.phone ?? null,
        status: 'NEW',
        source: 'manual',
      })
      .returning();
    return rowToLead(row!);
  }

  // Remove a Nurture card (the × on hover). Org-scoped; returns whether a row went.
  async deleteLead(orgId: string, leadId: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.reachLeads)
      .where(
        and(
          eq(schema.reachLeads.id, leadId),
          tenantScope(orgId, schema.reachLeads),
        ),
      )
      .returning({ id: schema.reachLeads.id });
    return rows.length > 0;
  }

  // Verify an aim belongs to the org (guard before creating a lead under it).
  async aimExists(orgId: string, aimId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.reachAims.id })
      .from(schema.reachAims)
      .where(and(eq(schema.reachAims.id, aimId), tenantScope(orgId, schema.reachAims)))
      .limit(1);
    return !!row;
  }

  // One lead of this aim, org-scoped (the promote path). undefined if the lead is
  // missing, cross-org, or belongs to a different aim.
  async findLeadById(
    orgId: string,
    aimId: string,
    leadId: string,
  ): Promise<ReachLead | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.reachLeads)
      .where(
        and(
          eq(schema.reachLeads.id, leadId),
          eq(schema.reachLeads.aimId, aimId),
          tenantScope(orgId, schema.reachLeads),
        ),
      )
      .limit(1);
    return row ? rowToLead(row) : undefined;
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

  // Daily send counts for this org over the last 10 calendar days (today + 9 prior),
  // grouped by sent_at::date. Days with no sends are absent here — the service fills
  // the gaps with zeros. The window/labels live in the service to keep TZ handling
  // simple (server local date).
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
}
