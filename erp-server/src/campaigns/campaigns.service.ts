import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import {
  type CampaignConfigDto,
  type CampaignFilesDto,
  type CampaignLifecycle,
  type CampaignMachineListItemDto,
  type CreateCampaignDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { driveFolderUrl } from '../common/machine-audit';
import { NichesService } from '../niches/niches.service';
import { AppConfigService } from '../config/app-config.service';

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

// Shape of the AIM "deploy campaign" n8n webhook response. The NEW AIM workflow no
// longer returns Drive refs at launch (the folder is created lazily by Ammo Forge),
// so folderId/folderUrl are optional — absent is the normal case now.
interface AimDeployResult {
  success?: boolean;
  folderId?: string;
  folderUrl?: string;
}

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
    private readonly config: AppConfigService,
    private readonly niches: NichesService,
  ) {}

  // The niche's display name, or null if the id is unknown (CampaignDto.nicheName).
  // Equality lookup (not inArray) keeps parity with getConfig and the test fake-db.
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
    userId: string,
  ): Promise<CampaignLaunchResult> {
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
        salesCalendarId: dto.salesCalendarId,
        whatsappNumber: dto.whatsappNumber,
        sender: dto.sender ?? 'info',
        lifecycle: 'DRAFT',
      })
      .returning();
    let row = inserted[0];
    if (!row) throw new Error('Failed to create campaign');

    const webhookUrl = (this.config.get('N8N_AIM_WEBHOOK_URL') ?? '').trim();
    // No webhook configured → the campaign persists as DRAFT (safe to run before the
    // webhook is set); the operator activates it later once AIM is wired.
    if (!webhookUrl) {
      return {
        campaign: { ...row, nicheName: niche.name },
        deployError:
          'AIM webhook is not configured (set N8N_AIM_WEBHOOK_URL); campaign saved as DRAFT.',
      };
    }

    const { patch, deployError } = await this.runAimDeploy(
      webhookUrl,
      row,
      niche.name,
      userId,
    );
    const updated = await this.db
      .update(schema.campaigns)
      .set(patch)
      .where(eq(schema.campaigns.id, row.id))
      .returning();
    row = updated[0] ?? row;
    return { campaign: { ...row, nicheName: niche.name }, deployError };
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
  async getConfig(id: string): Promise<CampaignConfigDto> {
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
    };
  }

  // Machine campaign list filtered by lifecycle (GET /campaigns/machine/list?
  // lifecycle=ACTIVE). NOT org-scoped — the daily scheduler in n8n needs every active
  // campaign across orgs. Newest-first.
  async machineList(
    lifecycle: CampaignLifecycle,
  ): Promise<CampaignMachineListItemDto[]> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.lifecycle, lifecycle))
      .orderBy(desc(schema.campaigns.createdAt));
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      project: c.project,
      country: c.country,
      region: c.region,
      sender: c.sender,
      gmailLabel: c.gmailLabel,
      driveFolderId: c.driveFolderId,
      nicheId: c.nicheId,
    }));
  }

  // Delete a campaign (ERP record only — the Drive folder + leads are NOT touched;
  // the ERP has no Drive write path). Detaches any arsenal_runs first (clears the FK,
  // keeps the trigger log) so the delete can't violate the foreign key. 404 if
  // missing or in another org. Returns the deleted row for audit.
  async delete(orgId: string, id: string): Promise<CampaignRow> {
    const before = await this.get(orgId, id);
    await this.db
      .update(schema.arsenalRuns)
      .set({ campaignId: null })
      .where(eq(schema.arsenalRuns.campaignId, id));
    await this.db.delete(schema.campaigns).where(eq(schema.campaigns.id, id));
    return before;
  }

  // POST the AIM payload to the n8n webhook; return the column patch reflecting the
  // outcome (ACTIVE + activatedBy/At, persisting Drive refs IF the response carries
  // them) or {} + deployError. Pure I/O, no throw.
  private async runAimDeploy(
    webhookUrl: string,
    campaign: CampaignRow,
    nicheName: string,
    userId: string,
  ): Promise<{ patch: CampaignPatch; deployError: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      // The AIM "Write config.json" node reads these fields; `niche` is the resolved
      // display name and `region` is the location zone (Lead Satellite's city seed).
      const aimPayload = {
        campaignId: campaign.id,
        name: campaign.name,
        niche: nicheName,
        country: campaign.country,
        region: campaign.region,
        project: campaign.project,
        gmailLabel: campaign.gmailLabel,
        salesCalendarId: campaign.salesCalendarId,
        whatsappNumber: campaign.whatsappNumber,
        sender: campaign.sender,
        source: 'erp',
      };
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aimPayload),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { patch: {}, deployError: `AIM webhook HTTP ${res.status}` };
      }
      const data = (await res.json().catch(() => ({}))) as AimDeployResult;
      const patch: CampaignPatch = {
        lifecycle: 'ACTIVE',
        activatedBy: userId,
        activatedAt: new Date(),
      };
      // The new AIM won't carry Drive refs — that's fine (nullable). Persist them
      // only if a (legacy) response does.
      if (data.folderId) {
        patch.driveFolderId = data.folderId;
        patch.driveFolderUrl = data.folderUrl ?? driveFolderUrl(data.folderId);
      }
      return { patch, deployError: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AIM webhook call failed';
      return { patch: {}, deployError: msg };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Every file in a campaign's Drive folder, via the erp-campaign-files webhook (the
  // ERP has no Google creds). Tenant-scoped — get() throws if the campaign isn't this
  // org's. Degrades to an empty list if the folder/webhook isn't set. (Independent of
  // the retired Drive-reconcile sync — uses N8N_API_URL's erp-campaign-files webhook.)
  async listFiles(orgId: string, id: string): Promise<CampaignFilesDto> {
    const campaign = await this.get(orgId, id);
    const base = this.campaignFilesWebhookUrl();
    if (!base) return { configured: false, count: 0, files: [] };
    if (!campaign.driveFolderId) return { configured: true, count: 0, files: [] };
    const url = `${base}?folderId=${encodeURIComponent(campaign.driveFolderId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ServiceUnavailableException(
          `Campaign files returned HTTP ${res.status}.`,
        );
      }
      const json = (await res.json().catch(() => ({}))) as { files?: unknown };
      const raw = Array.isArray(json?.files) ? json.files : [];
      const s = (v: unknown) => (typeof v === 'string' && v.length ? v : null);
      const files = raw
        .filter(
          (r): r is Record<string, unknown> =>
            !!r && typeof (r as Record<string, unknown>).id === 'string',
        )
        .map((r) => ({
          id: String(r.id),
          name: typeof r.name === 'string' ? r.name : String(r.id),
          mimeType: s(r.mimeType),
          webViewLink: s(r.webViewLink),
          modifiedTime: s(r.modifiedTime),
          size: s(r.size),
        }));
      return { configured: true, count: files.length, files };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `campaign files GET ${url} failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      throw new ServiceUnavailableException(
        'Campaign files call failed — check that the campaign-files workflow is active.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private campaignFilesWebhookUrl(): string {
    const base = (this.config.get('N8N_API_URL') ?? '').trim().replace(/\/+$/, '');
    return base ? `${base}/webhook/erp-campaign-files` : '';
  }
}
