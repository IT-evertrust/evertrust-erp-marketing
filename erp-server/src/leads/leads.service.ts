import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  CreateLeadDto,
  LeadBackfillResultDto,
  LeadStage,
  ProvisionHotLeadsResultDto,
  RunHotLeadsPipelineResultDto,
  UpdateLeadDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { writeMachineAudit } from '../common/machine-audit';
import { NichesService } from '../niches/niches.service';
import { AppConfigService } from '../config/app-config.service';

type LeadRow = typeof schema.leads.$inferSelect;
type CampaignRow = typeof schema.campaigns.$inferSelect;

// Fields a prospect graduation contributes to its hot lead. nicheId is resolved by
// the caller (a campaign-sourced lead leaves it NULL — it inherits via campaign).
export interface GraduateLeadInput {
  email: string;
  companyName?: string | null;
  website?: string | null;
  city?: string | null;
  country?: string | null;
  sourceCampaign?: string | null;
  campaignId?: string | null;
  nicheId?: string | null;
  hotReason?: string | null;
  stage?: LeadStage;
  note?: string | null;
}

// The n8n "Hot Leads Pipeline (per-campaign)" workflow + the node whose output
// holds the per-lead rows (verified against live execution data).
const HOT_LEADS_PIPELINE_WORKFLOW_ID = 'Dddp6wSvw3rwEsOw';
const COMPUTE_NODE = 'Compute Intake + Graduate';
const SCAN_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 12_000;

// One n8n hot/cust row from the Compute node output (sheet columns + internal _t).
export interface PipelineRow {
  t: 'hot' | 'cust';
  email: string;
  companyName: string | null;
  companyType: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  tier: string | null;
  niche: string | null;
  sourceCampaign: string | null;
  hotReason: string | null;
  leadStatus: string | null;
  meetingDate: string | null;
  detectedAt: string | null;
  note: string | null;
}

interface RunItem {
  json?: Record<string, unknown>;
}
type RunData = Record<
  string,
  Array<{ data?: { main?: Array<RunItem[] | null> } }> | undefined
>;

function s(json: Record<string, unknown>, key: string): string | null {
  const v = json[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// Pull the hot/cust rows out of one Pipeline execution's runData (tolerant: a
// missing node / unexpected shape yields []). Exported for unit testing.
export function extractLeadRows(rd: RunData): PipelineRow[] {
  const items = rd[COMPUTE_NODE]?.[0]?.data?.main?.[0] ?? [];
  const out: PipelineRow[] = [];
  for (const it of items) {
    const j = it.json;
    if (!j) continue;
    const email = s(j, 'Email');
    const t = j._t === 'cust' ? 'cust' : 'hot';
    if (!email) continue;
    out.push({
      t,
      email: email.toLowerCase(),
      companyName: s(j, 'Company Name'),
      companyType: s(j, 'Company Type'),
      website: s(j, 'Website'),
      city: s(j, 'City'),
      country: s(j, 'Country'),
      tier: s(j, 'Tier'),
      niche: s(j, 'Niche'),
      sourceCampaign: s(j, 'Source Campaign'),
      hotReason: s(j, 'Hot Reason'),
      leadStatus: s(j, 'Lead Status'),
      meetingDate: s(j, 'Meeting Date'),
      detectedAt: s(j, 'Detected At') ?? s(j, 'Created At'),
      note: s(j, 'Note') ?? s(j, 'Notes'),
    });
  }
  return out;
}

// Map a row's Hot Reason to the ERP pipeline stage.
export function stageForRow(row: PipelineRow): LeadStage {
  if (row.t === 'cust') return 'CUSTOMER';
  const hr = (row.hotReason ?? row.leadStatus ?? '').toLowerCase();
  if (hr.includes('meeting')) return 'MEETING_SCHEDULED';
  return 'INTERESTED';
}

// Key Account hot-lead CRM. Lists/creates/updates leads, converts a lead to an ERP
// customer, and backfills leads from the Hot Leads Pipeline execution data. Also
// fires the Provision Hot Leads / Pipeline webhooks (env-gated).
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly config: AppConfigService,
    private readonly niches: NichesService,
  ) {}

  async list(
    orgId: string,
    filters: { stage?: LeadStage; campaignId?: string } = {},
  ): Promise<LeadRow[]> {
    const conds = [tenantScope(orgId, schema.leads)];
    if (filters.stage) conds.push(eq(schema.leads.stage, filters.stage));
    if (filters.campaignId) {
      conds.push(eq(schema.leads.campaignId, filters.campaignId));
    }
    return this.db
      .select()
      .from(schema.leads)
      .where(and(...conds))
      .orderBy(desc(schema.leads.detectedAt));
  }

  async create(
    orgId: string,
    userId: string,
    input: CreateLeadDto,
  ): Promise<LeadRow> {
    const email = input.email.toLowerCase();
    const existing = await this.findByEmail(orgId, email);
    if (existing) {
      throw new ConflictException('A lead with this email already exists.');
    }
    // Free-text niche → the shared niche vocabulary (find-or-create), stored as the
    // nicheId FK. MANUAL leads carry the niche directly (no campaign to resolve it).
    const nicheId = input.niche
      ? (await this.niches.findOrCreate(orgId, input.niche)).id
      : null;
    const inserted = await this.db
      .insert(schema.leads)
      .values({
        organizationId: orgId,
        email,
        companyName: input.companyName ?? null,
        nicheId,
        tier: input.tier ?? null,
        country: input.country ?? null,
        sourceCampaign: input.sourceCampaign ?? null,
        campaignId: input.campaignId ?? null,
        note: input.note ?? null,
        stage: input.stage ?? 'INTERESTED',
        source: 'MANUAL',
        createdBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to create lead');
    return row;
  }

  async update(
    orgId: string,
    id: string,
    patch: UpdateLeadDto,
  ): Promise<LeadRow> {
    await this.requireLead(orgId, id);
    const updated = await this.db
      .update(schema.leads)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(tenantScope(orgId, schema.leads), eq(schema.leads.id, id)))
      .returning();
    const row = updated[0];
    if (!row) throw new Error('Failed to update lead');
    return row;
  }

  // Graduate a lead to an ERP customer: create the customers row + link it +
  // mark the lead CUSTOMER. 409 if already converted.
  async convert(orgId: string, id: string): Promise<LeadRow> {
    const lead = await this.requireLead(orgId, id);
    if (lead.customerId) {
      throw new ConflictException('Lead is already a customer.');
    }
    const customerId = await this.ensureCustomer(orgId, lead);
    const updated = await this.db
      .update(schema.leads)
      .set({ stage: 'CUSTOMER', customerId, updatedAt: new Date() })
      .where(and(tenantScope(orgId, schema.leads), eq(schema.leads.id, id)))
      .returning();
    const row = updated[0];
    if (!row) throw new Error('Failed to convert lead');
    return row;
  }

  // Find-or-create the hot lead for a graduating prospect (the Reply Glock
  // INTERESTED → hot lead path). Respects the leads (organizationId,email) unique
  // key: an existing row is returned (created=false), never duplicated. A new row
  // is source N8N with no createdBy (machine write). Machine route — audited on the
  // create. The CALLER links prospect.leadId; this only owns the leads row.
  async graduateFromProspect(
    orgId: string,
    input: GraduateLeadInput,
  ): Promise<{ lead: LeadRow; created: boolean }> {
    const email = input.email.toLowerCase();
    const existing = await this.findByEmail(orgId, email);
    if (existing) return { lead: existing, created: false };

    const inserted = await this.db
      .insert(schema.leads)
      .values({
        organizationId: orgId,
        email,
        companyName: input.companyName ?? null,
        website: input.website ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        // A campaign-sourced lead leaves nicheId NULL — it inherits via the
        // campaign (the caller passes null for that case per the drift rule).
        nicheId: input.nicheId ?? null,
        sourceCampaign: input.sourceCampaign ?? null,
        campaignId: input.campaignId ?? null,
        hotReason: input.hotReason ?? null,
        note: input.note ?? null,
        stage: input.stage ?? 'INTERESTED',
        source: 'N8N',
        // Stamped explicitly (the column also defaults to now()) so the row is
        // complete the moment it is returned and mapped to a DTO.
        updatedAt: new Date(),
      })
      .returning();
    const lead = inserted[0];
    if (!lead) throw new Error('Failed to create lead');

    await writeMachineAudit(this.db, {
      organizationId: orgId,
      entity: 'leads',
      entityId: lead.id,
      action: 'CREATE',
      after: { email, stage: lead.stage, campaignId: lead.campaignId },
    });
    return { lead, created: true };
  }

  // Import hot leads + graduated customers from the Hot Leads Pipeline execution
  // data. _t:"hot" -> upsert lead (stage from Hot Reason); _t:"cust" -> upsert
  // lead stage CUSTOMER + create the ERP customer (idempotent via lead.customerId).
  async backfill(orgId: string): Promise<LeadBackfillResultDto> {
    const base = this.config.get('N8N_API_URL').trim().replace(/\/+$/, '');
    const key = this.config.get('N8N_API_KEY').trim();
    if (!base || !key) {
      return { configured: false, scanned: 0, imported: 0, customers: 0 };
    }

    // Org campaigns, for sourceCampaign(project) -> campaignId best-effort link.
    const campaigns = await this.db
      .select()
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns));
    const byProject = new Map(
      campaigns.map((c) => [c.project, c] as const),
    );

    const list = await this.fetchJson(
      `${base}/api/v1/executions?workflowId=${HOT_LEADS_PIPELINE_WORKFLOW_ID}&limit=${SCAN_LIMIT}`,
      key,
    );
    const execs =
      (list as { data?: { id: string; mode?: string; stoppedAt?: string | null }[] } | null)
        ?.data ?? [];

    let scanned = 0;
    let imported = 0;
    let customers = 0;
    const seenEmail = new Set<string>(); // newest execution wins per email

    for (const exec of execs) {
      if (!exec.stoppedAt || exec.mode === 'error') continue;
      const full = await this.fetchJson(
        `${base}/api/v1/executions/${exec.id}?includeData=true`,
        key,
      );
      const rd = (full as { data?: { resultData?: { runData?: RunData } } } | null)
        ?.data?.resultData?.runData;
      if (!rd) continue;
      for (const row of extractLeadRows(rd)) {
        scanned += 1;
        if (seenEmail.has(row.email)) continue;
        seenEmail.add(row.email);
        const campaign = row.sourceCampaign
          ? byProject.get(row.sourceCampaign)
          : undefined;
        const created = await this.upsertFromRow(orgId, row, campaign);
        imported += 1;
        if (created) customers += 1;
      }
    }

    this.logger.log(
      `leads backfill: scanned ${scanned}, imported ${imported}, customers ${customers}`,
    );
    return { configured: true, scanned, imported, customers };
  }

  // Fire the Provision Hot Leads webhook for a campaign (creates its hot_leads
  // sheet). Env-gated. Returns the created sheet URL when the webhook reports it.
  async provision(
    orgId: string,
    campaignId: string,
  ): Promise<ProvisionHotLeadsResultDto> {
    const url = this.config.get('N8N_PROVISION_HOT_LEADS_WEBHOOK_URL').trim();
    if (!url) {
      return {
        configured: false,
        ok: false,
        hotLeadsUrl: null,
        detail: 'Provision Hot Leads webhook is not configured.',
      };
    }
    const campaign = await this.requireCampaign(orgId, campaignId);
    if (!campaign.driveFolderId) {
      throw new BadRequestException(
        'Campaign has no Drive folder yet — deploy it first.',
      );
    }
    const res = await this.postJson(url, { folderId: campaign.driveFolderId });
    return {
      configured: true,
      ok: res.ok,
      hotLeadsUrl:
        (res.body as { hotLeadsUrl?: string } | null)?.hotLeadsUrl ?? null,
      detail: res.detail,
    };
  }

  // Fire the Hot Leads Pipeline webhook (POST {folderId}). campaignId scopes it to
  // one campaign; omit to run all. Env-gated.
  async runPipeline(
    orgId: string,
    campaignId?: string,
  ): Promise<RunHotLeadsPipelineResultDto> {
    const url = this.config.get('N8N_HOT_LEADS_PIPELINE_WEBHOOK_URL').trim();
    if (!url) {
      return {
        configured: false,
        ok: false,
        detail: 'Hot Leads Pipeline webhook is not configured.',
      };
    }
    let folderId: string | undefined;
    if (campaignId) {
      const campaign = await this.requireCampaign(orgId, campaignId);
      folderId = campaign.driveFolderId ?? undefined;
    }
    const res = await this.postJson(url, folderId ? { folderId } : {});
    return { configured: true, ok: res.ok, detail: res.detail };
  }

  // Clear all of the org's leads (test-data reset). Returns the count removed.
  // Leaves any linked customers in place (they're an ERP system-of-record entity).
  async clearLeads(orgId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(schema.leads)
      .where(tenantScope(orgId, schema.leads));
    await this.db
      .delete(schema.leads)
      .where(tenantScope(orgId, schema.leads));
    return rows.length;
  }

  // --- helpers -------------------------------------------------------------

  private async upsertFromRow(
    orgId: string,
    row: PipelineRow,
    campaign: CampaignRow | undefined,
  ): Promise<boolean> {
    const stage = stageForRow(row);
    const existing = await this.findByEmail(orgId, row.email);
    // Niche resolution: an N8N lead inherits its niche from the linked campaign;
    // otherwise the sheet's free-text "Niche" is find-or-created into the shared
    // vocabulary. Falls back to the existing row's nicheId so a re-sync never clears it.
    const nicheId = campaign
      ? campaign.nicheId
      : row.niche
        ? (await this.niches.findOrCreate(orgId, row.niche)).id
        : (existing?.nicheId ?? null);
    const fields = {
      companyName: row.companyName,
      companyType: row.companyType,
      website: row.website,
      city: row.city,
      country: row.country,
      tier: row.tier,
      nicheId,
      sourceCampaign: row.sourceCampaign,
      campaignId: campaign?.id ?? existing?.campaignId ?? null,
      hotReason: row.hotReason,
      leadStatus: row.leadStatus,
      meetingDate: row.meetingDate,
      detectedAt: row.detectedAt ? new Date(row.detectedAt) : null,
      note: row.note,
    };

    let lead: LeadRow;
    if (existing) {
      // Never downgrade a manually-advanced lead on re-sync: CUSTOMER stays
      // CUSTOMER; ONGOING (ERP-only, set by hand) stays ONGOING unless n8n now
      // reports it graduated to CUSTOMER. Otherwise take the incoming stage.
      const nextStage =
        existing.stage === 'CUSTOMER'
          ? 'CUSTOMER'
          : existing.stage === 'ONGOING' && stage !== 'CUSTOMER'
            ? 'ONGOING'
            : stage;
      const updated = await this.db
        .update(schema.leads)
        .set({ ...fields, stage: nextStage, updatedAt: new Date() })
        .where(eq(schema.leads.id, existing.id))
        .returning();
      lead = updated[0] ?? existing;
    } else {
      const inserted = await this.db
        .insert(schema.leads)
        .values({
          organizationId: orgId,
          email: row.email,
          ...fields,
          stage,
          source: 'N8N',
        })
        .returning();
      lead = inserted[0]!;
    }

    // Graduated row → ensure an ERP customer exists + linked (idempotent).
    if (row.t === 'cust' && !lead.customerId) {
      const customerId = await this.ensureCustomer(orgId, lead);
      await this.db
        .update(schema.leads)
        .set({ customerId, updatedAt: new Date() })
        .where(eq(schema.leads.id, lead.id));
      return true;
    }
    return false;
  }

  private async ensureCustomer(orgId: string, lead: LeadRow): Promise<string> {
    // customers.niches is a text[] of niche NAMES; resolve the lead's nicheId FK
    // back to its display name (empty when the lead has no niche).
    let nicheNames: string[] = [];
    if (lead.nicheId) {
      const n = await this.db
        .select({ name: schema.niches.name })
        .from(schema.niches)
        .where(eq(schema.niches.id, lead.nicheId))
        .limit(1);
      if (n[0]) nicheNames = [n[0].name];
    }
    const inserted = await this.db
      .insert(schema.customers)
      .values({
        organizationId: orgId,
        name: lead.companyName ?? lead.email,
        contact: lead.email,
        niches: nicheNames,
      })
      .returning();
    const customer = inserted[0];
    if (!customer) throw new Error('Failed to create customer');
    return customer.id;
  }

  private async findByEmail(
    orgId: string,
    email: string,
  ): Promise<LeadRow | null> {
    const rows = await this.db
      .select()
      .from(schema.leads)
      .where(and(tenantScope(orgId, schema.leads), eq(schema.leads.email, email)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async requireLead(orgId: string, id: string): Promise<LeadRow> {
    const rows = await this.db
      .select()
      .from(schema.leads)
      .where(and(tenantScope(orgId, schema.leads), eq(schema.leads.id, id)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Lead not found');
    return row;
  }

  private async requireCampaign(
    orgId: string,
    campaignId: string,
  ): Promise<CampaignRow> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(
        and(
          tenantScope(orgId, schema.campaigns),
          eq(schema.campaigns.id, campaignId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Campaign not found');
    return row;
  }

  private async postJson(
    url: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; detail: string; body: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      return {
        ok: res.ok,
        detail: res.ok ? `HTTP ${res.status}` : `webhook HTTP ${res.status}`,
        body: parsed,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'webhook call failed',
        body: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchJson(url: string, key: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'X-N8N-API-KEY': key, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`leads backfill GET ${url}: HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      this.logger.warn(
        `leads backfill GET failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
