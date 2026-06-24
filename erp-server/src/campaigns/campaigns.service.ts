import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import {
  type CampaignConfigDto,
  type CampaignFilesDto,
  type CampaignLifecycle,
  type CreateCampaignDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { NichesService } from '../niches/niches.service';
import {
  type ResolvedAutomation,
  WorkflowConfigService,
} from '../arsenal/workflow-config.service';

type CampaignRow = typeof schema.campaigns.$inferSelect;
type CampaignPatch = Partial<typeof schema.campaigns.$inferInsert>;

// A campaign row enriched with its niche's display name. CampaignDto requires
// nicheName, but the campaigns table only stores nicheId — so reads join the niche
// name on (see withNiche). Skipping that join is what made the web client reject
// /campaigns with "Unexpected response shape from API" after the Drive→Postgres
// migration (the DTO gained nicheName; the Postgres service never populated it).
type CampaignWithNiche = CampaignRow & { nicheName: string | null };

// The result of the create() launch: the persisted campaign + an optional deploy
// error. lifecycle ACTIVE = the AIM webhook fired OK; DRAFT + deployError = the
// webhook was unset or failed and the operator must activate/retry later. There is
// NO FAILED lifecycle — a failed launch stays DRAFT, surfaced via deployError.
export interface CampaignLaunchResult {
  campaign: CampaignWithNiche;
  deployError: string | null;
}

// The machine campaign config with the WIDENED automation block. The shared
// CampaignConfigDto.automation only declares { templates, leads } (it stays
// backward-compatible for the web client), but the machine route additionally carries
// the resolved senders, the default sender's EMAIL, and the resolved org sales
// calendar — the seam n8n reads. This type reflects what getConfig() actually returns
// (it is assignable to CampaignConfigDto since it only ADDS fields).
export type CampaignConfigResult = Omit<CampaignConfigDto, 'automation'> & {
  automation: ResolvedAutomation;
};

// Legal campaign-lifecycle transitions (PATCH /campaigns/:id/lifecycle). DRAFT can
// only go ACTIVE; ACTIVE↔PAUSED both ways; ARCHIVED is terminal (stamps archivedAt).
const LIFECYCLE_TRANSITIONS: Record<CampaignLifecycle, CampaignLifecycle[]> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

// Growth Engine. Persists the campaign (the AIM target) and fires the AIM n8n
// webhook server-side (ERP-first: Workflow ← API ← DB ← Audit). The webhook call is
// best-effort and NEVER throws out of create() — a failed deploy leaves the campaign
// DRAFT + a surfaced deployError so the operator can retry, instead of 500-ing.
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly niches: NichesService,
  ) {}

  // The niche's display name, or null if the id is unknown (CampaignDto.nicheName).
  // Equality lookup (not inArray) keeps parity with getConfig.
  private async nicheNameFor(nicheId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.niches)
      .where(eq(schema.niches.id, nicheId))
      .limit(1);
    return rows[0]?.name ?? null;
  }

  // Join each campaign's niche display name (CampaignDto.nicheName) onto the raw
  // rows — the campaigns table stores only nicheId. Distinct niche ids are looked
  // up once each, so N campaigns cost one query per distinct niche, not per row.
  private async withNiche(rows: CampaignRow[]): Promise<CampaignWithNiche[]> {
    if (rows.length === 0) return [];
    const nameById = new Map<string, string | null>();
    for (const id of new Set(rows.map((r) => r.nicheId))) {
      nameById.set(id, await this.nicheNameFor(id));
    }
    return rows.map((r) => ({ ...r, nicheName: nameById.get(r.nicheId) ?? null }));
  }

  // The tenant's campaigns, newest-first. ARCHIVED rows are kept (attribution) but
  // hidden from the default list.
  async list(orgId: string): Promise<CampaignWithNiche[]> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns))
      .orderBy(desc(schema.campaigns.createdAt));
    return this.withNiche(rows.filter((r) => r.lifecycle !== 'ARCHIVED'));
  }

  // One campaign within the tenant. 404 if missing or in another org.
  async get(orgId: string, id: string): Promise<CampaignWithNiche> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(
        and(tenantScope(orgId, schema.campaigns), eq(schema.campaigns.id, id)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Campaign not found');
    return { ...row, nicheName: await this.nicheNameFor(row.nicheId) };
  }

  // Launch ("Lock & Load"): find-or-create the niche, persist the campaign DRAFT,
  // then fire the AIM webhook if configured. On a 2xx the campaign flips to ACTIVE
  // (activatedBy/activatedAt stamped); on failure it stays DRAFT and the error is
  // returned for the HTTP response. Server owns organizationId / lifecycle / the
  // deploy result; the client only supplies the AIM inputs.
  async create(
    orgId: string,
    dto: CreateCampaignDto,
    _userId: string, // retained for the controller signature; AIM deploy retired
  ): Promise<CampaignLaunchResult> {
    // The campaign's sender must be one of the org's RESOLVED sender keys (its own
    // org_senders, or the product DEFAULT_SENDERS when it has none — so legacy
    // 'info'/'hanna' stay valid for an org that never customized its senders). The DTO
    // defaults sender to 'info' on the wire, so an omitted sender resolves here.
    const sender = dto.sender ?? 'info';
    const senders = await this.workflowConfig.resolveSenders(orgId);
    if (!senders.some((s) => s.key === sender)) {
      throw new BadRequestException(
        `Unknown sender '${sender}'. Configure it under Configuration → Senders first.`,
      );
    }

    const niche = await this.niches.findOrCreate(orgId, dto.nicheName);

    const inserted = await this.db
      .insert(schema.campaigns)
      .values({
        organizationId: orgId,
        name: dto.name ?? null,
        nicheId: niche.id,
        country: dto.country,
        region: dto.region,
        project: dto.project,
        gmailLabel: dto.gmailLabel,
        salesCalendarId: dto.salesCalendarId ?? null,
        whatsappNumber: dto.whatsappNumber,
        sender,
        lifecycle: 'DRAFT',
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to create campaign');

    // Campaigns are created as DRAFT and processed by Reach (the Python agents + Gmail
    // funnel). The old n8n AIM-webhook deploy on create has been RETIRED — no external
    // dispatch here. (Reach aims create their own DRAFT campaign via this same insert
    // path's repository equivalent.) deployError stays in the response shape (always
    // null now) for API back-compat.
    return { campaign: { ...row, nicheName: niche.name }, deployError: null };
  }

  // Move a campaign through its lifecycle (PATCH /campaigns/:id/lifecycle). Rejects
  // an illegal transition with 422 (DRAFT→ACTIVE ok; ACTIVE↔PAUSED ok; →ARCHIVED is
  // terminal and stamps archivedAt). Returns { before, after } for the audit row.
  async updateLifecycle(
    orgId: string,
    id: string,
    next: CampaignLifecycle,
  ): Promise<{ before: CampaignWithNiche; after: CampaignWithNiche }> {
    const before = await this.get(orgId, id);
    const allowed = LIFECYCLE_TRANSITIONS[before.lifecycle];
    if (!allowed.includes(next)) {
      throw new UnprocessableEntityException(
        `Illegal campaign lifecycle transition ${before.lifecycle} → ${next}.`,
      );
    }
    const patch: CampaignPatch = { lifecycle: next };
    if (next === 'ARCHIVED') patch.archivedAt = new Date();
    const updated = await this.db
      .update(schema.campaigns)
      .set(patch)
      .where(eq(schema.campaigns.id, id))
      .returning();
    // A lifecycle move never changes the niche, so reuse the name already joined
    // onto `before` instead of a second lookup.
    const updatedRow = updated[0];
    const after: CampaignWithNiche = updatedRow
      ? { ...updatedRow, nicheName: before.nicheName }
      : before;
    return { before, after };
  }

  // Machine view of a campaign (GET /campaigns/:id/config): the launch inputs + the
  // resolved niche with its ENABLED targets. Used by the arsenal stages to build
  // their search queries. 404 if the campaign id is unknown. NOT org-scoped (a
  // machine caller has no tenant; the ingest token is the trust boundary).
  async getConfig(id: string): Promise<CampaignConfigResult> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);
    const c = rows[0];
    if (!c) throw new NotFoundException('Campaign not found');

    const nicheRows = await this.db
      .select()
      .from(schema.niches)
      .where(eq(schema.niches.id, c.nicheId))
      .limit(1);
    const niche = nicheRows[0];
    if (!niche) throw new NotFoundException('Campaign niche not found');

    const targets = await this.niches.targets(niche.id, true);
    return {
      campaignId: c.id,
      lifecycle: c.lifecycle,
      name: c.name,
      country: c.country,
      region: c.region,
      project: c.project,
      sender: c.sender,
      gmailLabel: c.gmailLabel,
      salesCalendarId: c.salesCalendarId,
      whatsappNumber: c.whatsappNumber,
      driveFolderId: c.driveFolderId,
      templates: c.templates ?? {},
      niche: {
        id: niche.id,
        name: niche.name,
        slug: niche.slug,
        targets: targets.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          searchHint: t.searchHint,
        })),
      },
      // PER-ORG Growth-Engine automation knobs merged into the route the outreach
      // workflows poll: the effective Templates + Leads from the campaign org's
      // org_config, PLUS the org's resolved sender list, the default sender's EMAIL
      // (so n8n can set the From directly), and the resolved org sales calendar id.
      // Machine call (no caller org) → resolve the org from the campaign row.
      automation: await this.workflowConfig.getAutomation(c.organizationId),
    };
  }

  // (Retired: machineList — the n8n daily scheduler that pulled active campaigns is
  // gone; Reach (Python) owns processing.)

  // Delete a campaign — ALLOWED ONLY when it holds no data. prospects.campaign_id
  // is NOT NULL and leads/contracts/campaign_assets also reference the campaign with
  // no cascade, so a hard delete on a populated campaign would FK-violate (500).
  // Instead we count those dependents and return a clear 409 steering to Archive
  // (lifecycle = ARCHIVED is the soft-delete). Empty campaigns delete cleanly after
  // detaching arsenal_runs (kept as a trigger log). 404 if missing / another org.
  async delete(orgId: string, id: string): Promise<CampaignRow> {
    const before = await this.get(orgId, id);
    const [p, l, a, ct] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(schema.prospects)
        .where(eq(schema.prospects.campaignId, id)),
      this.db
        .select({ value: count() })
        .from(schema.leads)
        .where(eq(schema.leads.campaignId, id)),
      this.db
        .select({ value: count() })
        .from(schema.campaignAssets)
        .where(eq(schema.campaignAssets.campaignId, id)),
      this.db
        .select({ value: count() })
        .from(schema.contracts)
        .where(eq(schema.contracts.campaignId, id)),
    ]);
    const prospects = p[0]?.value ?? 0;
    const leads = l[0]?.value ?? 0;
    const blocking = prospects + leads + (a[0]?.value ?? 0) + (ct[0]?.value ?? 0);
    if (blocking > 0) {
      throw new ConflictException(
        `Cannot delete this campaign — it has ${prospects} prospect(s) and ${leads} lead(s). Archive it instead (set its lifecycle to ARCHIVED).`,
      );
    }
    await this.db
      .update(schema.arsenalRuns)
      .set({ campaignId: null })
      .where(eq(schema.arsenalRuns.campaignId, id));
    await this.db.delete(schema.campaigns).where(eq(schema.campaigns.id, id));
    return before;
  }

  // The campaign's generated files, read from the campaign_assets registry (the
  // NICHE_ANALYSIS doc, Ammo Forge templates/news, etc.). PG-native: the ERP owns the
  // file pointers, so no Drive/n8n round-trip and no driveFolderId dependency. Tenant-
  // scoped via get(). Empty until the workflows register assets for this campaign.
  async listFiles(orgId: string, id: string): Promise<CampaignFilesDto> {
    await this.get(orgId, id); // 404 if the campaign isn't this org's
    const rows = await this.db
      .select()
      .from(schema.campaignAssets)
      .where(eq(schema.campaignAssets.campaignId, id))
      .orderBy(desc(schema.campaignAssets.createdAt));
    const files = rows.map((a) => ({
      id: a.id,
      name: a.name,
      mimeType: a.mimeType ?? null,
      webViewLink: a.driveUrl ?? null,
      modifiedTime: a.createdAt ? a.createdAt.toISOString() : null,
      size: null,
    }));
    return { configured: true, count: files.length, files };
  }
}
