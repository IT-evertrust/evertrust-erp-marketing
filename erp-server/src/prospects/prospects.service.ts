import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  GraduateProspectDto,
  GraduateProspectResultDto,
  LeadDto,
  ProspectStatus,
  UpdateProspectDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { writeMachineAudit } from '../common/machine-audit';
import { LeadsService } from '../leads/leads.service';
import { WorkflowConfigService } from '../arsenal/workflow-config.service';

type ProspectRow = typeof schema.prospects.$inferSelect;
type CampaignRow = typeof schema.campaigns.$inferSelect;
type LeadRow = typeof schema.leads.$inferSelect;

// One incoming prospect in a bulk write (already validated by the DTO).
export interface ProspectInput {
  email: string;
  companyName?: string;
  website?: string;
  city?: string;
  country?: string;
  sourceUrl?: string;
  nicheTargetId?: string;
  emailVerified?: boolean;
}

// Filters for the machine prospect list (Reach Bazooka's send-list pull + the
// snooze sweep). All optional; combined with AND.
export interface ProspectListFilters {
  campaignId?: string;
  status?: ProspectStatus;
  email?: string;
  snoozeDue?: boolean;
  sendList?: boolean;
  limit?: number;
}

// Filters for the JWT board list (the UI campaign/board view). campaignId/status
// narrow the page; `q` is a case-insensitive substring over email/companyName;
// limit/offset paginate. statusCounts is always computed over the org+campaign
// set (ignoring status/q/page) so the board columns show full tallies.
export interface ProspectBoardFilters {
  campaignId?: string;
  status?: ProspectStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

// One org-scoped board page: the page rows, the post-filter pre-page total, and
// the per-status tally for the campaign columns.
export interface ProspectBoardResult {
  items: ProspectRow[];
  total: number;
  statusCounts: Record<string, number>;
}

const SEND_LIST_STATUSES: ProspectStatus[] = ['NEW', 'EMAILED'];
const FOLLOWUP_CAP = 3;
// Default follow-up cooldown (days) when automation.leads.dedupDays is unset (null).
// Preserves the pre-config 3-day window; the send-list predicate multiplies it by
// 86_400_000 to get the cooldown in ms.
const FOLLOWUP_COOLDOWN_DEFAULT_DAYS = 3;

// Map a leads row to its HTTP DTO (timestamps → ISO strings). Local to the
// graduation response so prospects need not depend on the leads controller.
function toLeadDto(r: LeadRow): LeadDto {
  return {
    id: r.id,
    organizationId: r.organizationId,
    email: r.email,
    companyName: r.companyName,
    companyType: r.companyType,
    website: r.website,
    city: r.city,
    country: r.country,
    tier: r.tier,
    nicheId: r.nicheId,
    sourceCampaign: r.sourceCampaign,
    campaignId: r.campaignId,
    hotReason: r.hotReason,
    leadStatus: r.leadStatus,
    meetingDate: r.meetingDate,
    detectedAt: r.detectedAt ? r.detectedAt.toISOString() : null,
    note: r.note,
    stage: r.stage,
    customerId: r.customerId,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// Cold-outreach prospect data plane (the per-campaign leads sheet). Written by Lead
// Satellite (bulk upsert), read by Reach Bazooka (send list), patched by the send +
// reply stages. All machine routes — gated by the ingest token, org derived from the
// campaign. Every write is audited (actorType N8N).
@Injectable()
export class ProspectsService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly leads: LeadsService,
    private readonly workflowConfig: WorkflowConfigService,
  ) {}

  // Upsert prospects on (campaignId, email). On conflict the SCRAPED fields update
  // but the conversation state (status, snoozeUntil, followupCount, lastContactedAt,
  // leadId) NEVER regresses — a re-scrape must not undo outreach progress. org is
  // derived from the campaign; rejects an unknown or ARCHIVED campaign. Returns the
  // created/updated counts.
  async bulkUpsert(
    campaignId: string,
    prospects: ProspectInput[],
  ): Promise<{ created: number; updated: number }> {
    const campaign = await this.requireWritableCampaign(campaignId);
    let created = 0;
    let updated = 0;

    for (const p of prospects) {
      const email = p.email.toLowerCase();
      const existing = await this.db
        .select()
        .from(schema.prospects)
        .where(
          and(
            eq(schema.prospects.campaignId, campaignId),
            eq(schema.prospects.email, email),
          ),
        )
        .limit(1);

      if (existing[0]) {
        // Scraped fields only — status/snooze/followup/leadId are deliberately omitted.
        await this.db
          .update(schema.prospects)
          .set({
            companyName: p.companyName ?? existing[0].companyName,
            website: p.website ?? existing[0].website,
            city: p.city ?? existing[0].city,
            country: p.country ?? existing[0].country,
            sourceUrl: p.sourceUrl ?? existing[0].sourceUrl,
            nicheTargetId: p.nicheTargetId ?? existing[0].nicheTargetId,
            emailVerified: p.emailVerified ?? existing[0].emailVerified,
            updatedAt: new Date(),
          })
          .where(eq(schema.prospects.id, existing[0].id));
        updated++;
      } else {
        await this.db.insert(schema.prospects).values({
          organizationId: campaign.organizationId,
          campaignId,
          email,
          companyName: p.companyName ?? null,
          website: p.website ?? null,
          city: p.city ?? null,
          country: p.country ?? null,
          sourceUrl: p.sourceUrl ?? null,
          nicheTargetId: p.nicheTargetId ?? null,
          emailVerified: p.emailVerified ?? false,
        });
        created++;
      }
    }

    await writeMachineAudit(this.db, {
      organizationId: campaign.organizationId,
      entity: 'prospects',
      entityId: campaignId,
      action: 'BULK_UPSERT',
      after: { created, updated, count: prospects.length },
    });
    return { created, updated };
  }

  // The machine prospect list. campaignId/status/email are SQL-filtered; snoozeDue
  // and sendList are the derived gates (computed in-process so the rules stay one
  // readable predicate). sendList enforces: campaign ACTIVE, status NEW|EMAILED,
  // followupCount<3, last contact null or older than the cooldown, and NOT
  // suppressed (org,email). The cooldown + suppression gate are config-driven via
  // automation.leads (WorkflowConfigService): dedupDays sets the cooldown window
  // (falling back to FOLLOWUP_COOLDOWN_DEFAULT_DAYS when null), and
  // respectSuppressions toggles the do-not-contact gate. Both default to today's
  // behaviour (3-day cooldown, suppressions honoured) until an admin overrides them.
  async list(filters: ProspectListFilters): Promise<ProspectRow[]> {
    const conds = [];
    if (filters.campaignId) {
      conds.push(eq(schema.prospects.campaignId, filters.campaignId));
    }
    if (filters.status) {
      conds.push(eq(schema.prospects.status, filters.status));
    }
    if (filters.email) {
      conds.push(eq(schema.prospects.email, filters.email.toLowerCase()));
    }
    // Build the base query, applying the SQL filters only when present (a bare
    // .where(undefined) is a no-op in Drizzle but the test fake can't parse it).
    const base = this.db.select().from(schema.prospects);
    const scoped = conds.length ? base.where(and(...conds)) : base;
    let rows = await scoped.orderBy(desc(schema.prospects.createdAt));

    const now = Date.now();

    if (filters.snoozeDue) {
      rows = rows.filter(
        (r) =>
          r.status === 'NOT_INTERESTED' &&
          r.snoozeUntil !== null &&
          new Date(r.snoozeUntil).getTime() <= now,
      );
    }

    if (filters.sendList) {
      // Admin-tunable lead governance is now PER-ORG (org_config). The send list is a
      // machine pull that can span orgs, so resolve each prospect's org governance
      // (dedupDays → cooldown, respectSuppressions → do-not-contact gate), memoized
      // per org for the duration of this call. dedupDays null → the built-in default
      // cooldown; respectSuppressions defaults true.
      const govByOrg = new Map<
        string,
        { cooldownMs: number; respectSuppressions: boolean }
      >();
      const govFor = async (orgId: string) => {
        const cached = govByOrg.get(orgId);
        if (cached) return cached;
        const { leads } = await this.workflowConfig.getAutomation(orgId);
        const gov = {
          cooldownMs:
            (leads.dedupDays ?? FOLLOWUP_COOLDOWN_DEFAULT_DAYS) * 86_400_000,
          respectSuppressions: leads.respectSuppressions,
        };
        govByOrg.set(orgId, gov);
        return gov;
      };
      // Active campaigns only.
      const activeCampaignIds = await this.activeCampaignIdSet();
      // Suppressed (org,email) pairs — the do-not-contact gate. Built once and only
      // consulted for prospects whose org has respectSuppressions on.
      const suppressed = await this.suppressedKeySet();
      const filtered: ProspectRow[] = [];
      for (const r of rows) {
        if (!activeCampaignIds.has(r.campaignId)) continue;
        if (!SEND_LIST_STATUSES.includes(r.status)) continue;
        if (r.followupCount >= FOLLOWUP_CAP) continue;
        const gov = await govFor(r.organizationId);
        const lastMs = r.lastContactedAt
          ? new Date(r.lastContactedAt).getTime()
          : null;
        if (lastMs !== null && now - lastMs < gov.cooldownMs) continue;
        if (
          gov.respectSuppressions &&
          suppressed.has(`${r.organizationId}::${r.email}`)
        ) {
          continue;
        }
        filtered.push(r);
      }
      rows = filtered;
    }

    const limit = filters.limit && filters.limit > 0 ? filters.limit : undefined;
    return limit ? rows.slice(0, limit) : rows;
  }

  // The JWT board list — ORG-SCOPED (every query confined to orgId). Returns the
  // page rows, the post-filter pre-page `total`, and `statusCounts` (the per-status
  // tally over the org+campaign set, BEFORE the status/q/page narrowing) for the
  // board columns. campaignId/status/q narrow `items`; q is a case-insensitive
  // substring over email + companyName. Default page size 50.
  async boardList(
    orgId: string,
    filters: ProspectBoardFilters,
  ): Promise<ProspectBoardResult> {
    // Base scope: the org, optionally one campaign. (status/q are applied in-process
    // so a single fetch backs both the page AND the full statusCounts tally.)
    const conds = [eq(schema.prospects.organizationId, orgId)];
    if (filters.campaignId) {
      conds.push(eq(schema.prospects.campaignId, filters.campaignId));
    }
    const scoped = await this.db
      .select()
      .from(schema.prospects)
      .where(and(...conds))
      .orderBy(desc(schema.prospects.createdAt));

    // statusCounts: the full tally over org(+campaign), independent of status/q/page.
    const statusCounts: Record<string, number> = {};
    for (const r of scoped) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }

    // Apply the page narrowing (status, then q) to get the filtered set.
    let filtered = scoped;
    if (filters.status) {
      filtered = filtered.filter((r) => r.status === filters.status);
    }
    if (filters.q) {
      const needle = filters.q.toLowerCase();
      filtered = filtered.filter((r) => {
        const email = r.email.toLowerCase();
        const company = (r.companyName ?? '').toLowerCase();
        return email.includes(needle) || company.includes(needle);
      });
    }

    const total = filtered.length;
    const offset = filters.offset && filters.offset > 0 ? filters.offset : 0;
    const limit = filters.limit && filters.limit > 0 ? filters.limit : 50;
    const items = filtered.slice(offset, offset + limit);

    return { items, total, statusCounts };
  }

  // One prospect IN THE CALLER'S ORG (the UI drawer). 404 if missing or cross-org.
  async getForOrg(orgId: string, id: string): Promise<ProspectRow> {
    const rows = await this.db
      .select()
      .from(schema.prospects)
      .where(
        and(
          eq(schema.prospects.organizationId, orgId),
          eq(schema.prospects.id, id),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Prospect not found');
    return row;
  }

  // The display names for a prospect's campaign + niche target (the drawer header).
  // Either may be null (no niche target, or a since-deleted campaign).
  async resolveNames(
    row: ProspectRow,
  ): Promise<{ campaignName: string | null; nicheTargetName: string | null }> {
    const campaign = await this.findCampaign(row.campaignId);
    let nicheTargetName: string | null = null;
    if (row.nicheTargetId) {
      const t = await this.db
        .select({ name: schema.nicheTargets.name })
        .from(schema.nicheTargets)
        .where(eq(schema.nicheTargets.id, row.nicheTargetId))
        .limit(1);
      nicheTargetName = t[0]?.name ?? null;
    }
    return {
      campaignName: campaign?.name ?? campaign?.project ?? null,
      nicheTargetName,
    };
  }

  // Manual status override from the UI (archive / re-open). ORG-SCOPED: 404 if the
  // prospect is not in `orgId`. Sets status (+ optional snoozeUntil) only — the
  // machine `update` owns followup/lastContacted. The JWT audit row is written by
  // the global AuditInterceptor (the controller sets the context).
  async updateStatusForOrg(
    orgId: string,
    id: string,
    patch: { status: ProspectStatus; snoozeUntil?: string | null },
  ): Promise<ProspectRow> {
    // Confine to the tenant first (404 cross-org) — never patch another org's row.
    const before = await this.getForOrg(orgId, id);

    const set: Partial<typeof schema.prospects.$inferInsert> = {
      status: patch.status,
      updatedAt: new Date(),
    };
    if (patch.snoozeUntil !== undefined) {
      set.snoozeUntil = patch.snoozeUntil ? new Date(patch.snoozeUntil) : null;
    }

    const updated = await this.db
      .update(schema.prospects)
      .set(set)
      .where(
        and(
          eq(schema.prospects.organizationId, orgId),
          eq(schema.prospects.id, id),
        ),
      )
      .returning();
    return updated[0] ?? before;
  }

  // Partial update of one prospect (the send + reply stages stamp status/snooze/
  // followup/lastContacted/leadId). 404 if the id is unknown. Audited.
  async update(id: string, patch: UpdateProspectDto): Promise<ProspectRow> {
    const rows = await this.db
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.id, id))
      .limit(1);
    const before = rows[0];
    if (!before) throw new NotFoundException('Prospect not found');

    const set: Partial<typeof schema.prospects.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.snoozeUntil !== undefined) {
      set.snoozeUntil = patch.snoozeUntil ? new Date(patch.snoozeUntil) : null;
    }
    if (patch.followupCount !== undefined) set.followupCount = patch.followupCount;
    if (patch.lastContactedAt !== undefined) {
      set.lastContactedAt = patch.lastContactedAt
        ? new Date(patch.lastContactedAt)
        : null;
    }
    if (patch.emailVerified !== undefined) set.emailVerified = patch.emailVerified;
    if (patch.leadId !== undefined) set.leadId = patch.leadId;

    const updated = await this.db
      .update(schema.prospects)
      .set(set)
      .where(eq(schema.prospects.id, id))
      .returning();
    const after = updated[0] ?? before;

    await writeMachineAudit(this.db, {
      organizationId: after.organizationId,
      entity: 'prospects',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
    return after;
  }

  // Graduate an INTERESTED prospect into a hot lead (the Reply Glock graduation
  // that retires the CRM Hot Leads workflow). IDEMPOTENT and respects the leads
  // (organizationId,email) unique key:
  //   - already linked (prospect.leadId set) → return that lead, graduated=false
  //   - an existing leads row for (org,email)  → link it, graduated=false (no dup)
  //   - otherwise create the lead (source N8N), link it, set status INTERESTED
  // org/campaignId derive from the prospect; the lead leaves nicheId NULL (it
  // inherits its niche via the campaign per the drift rule). 404 if prospect unknown.
  async graduate(
    prospectId: string,
    body: GraduateProspectDto,
  ): Promise<GraduateProspectResultDto> {
    const prospect = await this.requireProspect(prospectId);

    // Already graduated → no-op, return the linked lead.
    if (prospect.leadId) {
      const lead = await this.requireLead(prospect.leadId);
      return { lead: toLeadDto(lead), graduated: false };
    }

    // The campaign supplies the lead's sourceCampaign (its project name).
    const campaign = await this.findCampaign(prospect.campaignId);

    const { lead, created } = await this.leads.graduateFromProspect(
      prospect.organizationId,
      {
        email: prospect.email,
        companyName: prospect.companyName,
        website: prospect.website,
        city: prospect.city,
        country: prospect.country,
        sourceCampaign: campaign?.project ?? null,
        campaignId: prospect.campaignId,
        // Campaign-sourced lead → nicheId NULL (inherits via the campaign).
        nicheId: null,
        hotReason: body.hotReason ?? null,
        stage: body.stage ?? 'INTERESTED',
        note: body.note ?? null,
      },
    );

    // Link the lead onto the prospect and move it to INTERESTED. Audited.
    const updated = await this.db
      .update(schema.prospects)
      .set({ leadId: lead.id, status: 'INTERESTED', updatedAt: new Date() })
      .where(eq(schema.prospects.id, prospectId))
      .returning();
    const after = updated[0] ?? prospect;

    await writeMachineAudit(this.db, {
      organizationId: prospect.organizationId,
      entity: 'prospects',
      entityId: prospectId,
      action: 'GRADUATE',
      before: prospect,
      after,
    });

    return { lead: toLeadDto(lead), graduated: created };
  }

  // --- helpers -------------------------------------------------------------

  private async requireProspect(id: string): Promise<ProspectRow> {
    const rows = await this.db
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Prospect not found');
    return row;
  }

  private async requireLead(id: string): Promise<LeadRow> {
    const rows = await this.db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Lead not found');
    return row;
  }

  private async findCampaign(id: string): Promise<CampaignRow | null> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  private async requireWritableCampaign(id: string): Promise<CampaignRow> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);
    const campaign = rows[0];
    if (!campaign) throw new NotFoundException(`No campaign for id ${id}`);
    if (campaign.lifecycle === 'ARCHIVED') {
      throw new NotFoundException(`Campaign ${id} is archived`);
    }
    return campaign;
  }

  private async activeCampaignIdSet(): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.lifecycle, 'ACTIVE'));
    return new Set(rows.map((r) => r.id));
  }

  private async suppressedKeySet(): Promise<Set<string>> {
    const rows = await this.db
      .select({
        organizationId: schema.suppressions.organizationId,
        email: schema.suppressions.email,
      })
      .from(schema.suppressions);
    return new Set(rows.map((r) => `${r.organizationId}::${r.email.toLowerCase()}`));
  }
}
