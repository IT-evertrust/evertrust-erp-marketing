import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  CampaignFilesDto,
  CampaignSyncResultDto,
  CreateCampaignDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { AppConfigService } from '../config/app-config.service';

type CampaignRow = typeof schema.campaigns.$inferSelect;
type CampaignPatch = Partial<typeof schema.campaigns.$inferInsert>;

// Shape of the AIM "deploy campaign" n8n webhook response (its Respond OK node
// returns { success, folderId, folderUrl, fileId, fileUrl }).
interface AimDeployResult {
  success?: boolean;
  folderId?: string;
  folderUrl?: string;
}

// One campaign folder as reported by the read-only erp-campaigns-list webhook
// (a subfolder of the Drive "Evertrust Campaigns" folder).
interface DriveCampaign {
  id: string;
  name: string | null;
}

// Growth Engine. Persists the campaign (the AIM target) and fires the AIM n8n
// webhook server-side (ERP-first: Workflow ← API ← DB ← Audit). The webhook call
// is best-effort and NEVER throws out of create() — a failed deploy is recorded as
// FAILED + deployError so the operator sees it, instead of 500-ing the launch.
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly config: AppConfigService,
  ) {}

  // The tenant's ACTIVE campaigns, newest-first. Campaigns archived by a Drive sync
  // (driveMissing — their Drive folder was deleted) are hidden here; the row is kept
  // for audit/history, it just no longer clutters the list. A re-sync that finds the
  // folder again un-archives it.
  async list(orgId: string): Promise<CampaignRow[]> {
    return this.db
      .select()
      .from(schema.campaigns)
      .where(
        and(
          tenantScope(orgId, schema.campaigns),
          eq(schema.campaigns.driveMissing, false),
        ),
      )
      .orderBy(desc(schema.campaigns.createdAt));
  }

  // One campaign within the tenant. 404 if missing or in another org.
  async get(orgId: string, id: string): Promise<CampaignRow> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(
        and(tenantScope(orgId, schema.campaigns), eq(schema.campaigns.id, id)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Campaign not found');
    return row;
  }

  // Launch ("Lock & Load"): persist the campaign, then deploy via the AIM webhook
  // if one is configured. Server owns organizationId, status, and the deploy
  // result; the client only supplies the 9 AIM inputs.
  async create(
    orgId: string,
    dto: CreateCampaignDto,
    userId: string,
  ): Promise<CampaignRow> {
    const inserted = await this.db
      .insert(schema.campaigns)
      .values({
        organizationId: orgId,
        name: dto.name ?? null,
        niche: dto.niche,
        target: dto.target,
        country: dto.country,
        state: dto.state,
        project: dto.project,
        gmailLabel: dto.gmailLabel,
        salesCalendarId: dto.salesCalendarId,
        whatsappNumber: dto.whatsappNumber,
        status: 'DRAFT',
        driveMissing: false,
      })
      .returning();

    let row = inserted[0];
    if (!row) throw new Error('Failed to create campaign');

    // No webhook configured → persist as DRAFT (deploy skipped). Mirrors the
    // reference "leave blank to skip the deploy step" behavior.
    const webhookUrl = this.config.get('N8N_AIM_WEBHOOK_URL');
    if (!webhookUrl) return row;

    const patch = await this.runAimDeploy(webhookUrl, dto, userId);
    const updated = await this.db
      .update(schema.campaigns)
      .set(patch)
      .where(eq(schema.campaigns.id, row.id))
      .returning();
    row = updated[0] ?? row;
    return row;
  }

  // Reconcile the tenant's campaigns against the live Drive "Evertrust Campaigns"
  // folder (the SOURCE OF TRUTH). The ERP can't read Drive, so it GETs the read-only
  // erp-campaigns-list n8n webhook (which scans the folder). DEPLOYED campaigns whose
  // folder is gone are archived (driveMissing=true → hidden from list); ones whose
  // folder reappears are un-archived. DRAFT/FAILED rows (no folder yet) are untouched.
  // Throws ServiceUnavailable if the webhook is unset/unreachable — a sync failure is
  // OBSERVABLE, never a silent no-op that would wrongly leave stale rows visible.
  async syncFromDrive(orgId: string): Promise<CampaignSyncResultDto> {
    const url = this.campaignsListWebhookUrl();
    if (!url) {
      throw new ServiceUnavailableException(
        'Campaign Drive-sync is not configured (set N8N_CAMPAIGNS_LIST_WEBHOOK_URL or N8N_API_URL).',
      );
    }
    const drive = await this.fetchDriveCampaigns(url);
    const presentIds = new Set(drive.folders.map((f) => f.id));

    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns));

    const now = new Date();
    let checked = 0;
    let markedMissing = 0;
    let restored = 0;
    const trackedIds = new Set<string>();

    for (const row of rows) {
      // Only rows that actually have a Drive folder are reconcilable against Drive.
      if (!row.driveFolderId) continue;
      trackedIds.add(row.driveFolderId);
      checked++;
      const present = presentIds.has(row.driveFolderId);
      const patch: CampaignPatch = { driveCheckedAt: now };
      if (!present && !row.driveMissing) {
        patch.driveMissing = true;
        markedMissing++;
      } else if (present && row.driveMissing) {
        patch.driveMissing = false;
        restored++;
      }
      await this.db
        .update(schema.campaigns)
        .set(patch)
        .where(eq(schema.campaigns.id, row.id));
    }

    // Folders that exist in Drive but match no ERP campaign — created/managed outside
    // the ERP. Surfaced for visibility (the ERP does not auto-import them).
    const untracked = drive.folders
      .filter((f) => !trackedIds.has(f.id))
      .map((f) => ({ id: f.id, name: f.name }));

    return {
      driveCount: drive.folders.length,
      checked,
      markedMissing,
      restored,
      folderUrl: drive.folderUrl,
      untracked,
    };
  }

  // Delete a campaign (ERP record only — the Google Drive folder + leads are NOT
  // touched; the ERP has no Drive write path). Detaches any arsenal_runs first
  // (clears the FK, keeps the trigger log) so the delete can't violate the
  // foreign key. 404 if missing or in another org. Returns the deleted row for audit.
  async delete(orgId: string, id: string): Promise<CampaignRow> {
    const before = await this.get(orgId, id);

    await this.db
      .update(schema.arsenalRuns)
      .set({ campaignId: null })
      .where(eq(schema.arsenalRuns.campaignId, id));

    await this.db
      .delete(schema.campaigns)
      .where(
        and(tenantScope(orgId, schema.campaigns), eq(schema.campaigns.id, id)),
      );

    return before;
  }

  // POST the AIM payload to the n8n webhook; return the column patch reflecting the
  // outcome (DEPLOYED + Drive folder refs, or FAILED + error). Pure I/O, no throw.
  private async runAimDeploy(
    webhookUrl: string,
    dto: CreateCampaignDto,
    userId: string,
  ): Promise<CampaignPatch> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      // AIM's "Write config.json" node reads body.region (the location ZONE).
      // Our form/DTO field is `state` (the zone enum), so alias it to `region`
      // for the webhook. Without it, Lead Satellite's "Build Search Query" gets
      // 0 cities and bails (returns []), so the funnel produces no leads.
      const aimPayload = { ...dto, region: dto.state };
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aimPayload),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { status: 'FAILED', deployError: `AIM webhook HTTP ${res.status}` };
      }
      const data = (await res
        .json()
        .catch(() => ({}))) as AimDeployResult;
      return {
        status: 'DEPLOYED',
        driveFolderId: data.folderId ?? null,
        driveFolderUrl: data.folderUrl ?? null,
        deployError: null,
        deployedBy: userId,
        deployedAt: new Date(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AIM webhook call failed';
      return { status: 'FAILED', deployError: msg };
    } finally {
      clearTimeout(timeout);
    }
  }

  // GET the read-only erp-campaigns-list webhook and parse its
  // { folderUrl, campaigns: [{ id, name }] } payload into the Drive folder list.
  // Throws ServiceUnavailable on any failure (kept observable, like PersonasService).
  private async fetchDriveCampaigns(
    url: string,
  ): Promise<{ folderUrl: string | null; folders: DriveCampaign[] }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ServiceUnavailableException(
          `Campaign Drive-sync returned HTTP ${res.status}.`,
        );
      }
      const json = (await res.json().catch(() => ({}))) as {
        folderUrl?: unknown;
        campaigns?: { id?: unknown; name?: unknown }[];
      };
      const folders: DriveCampaign[] = Array.isArray(json?.campaigns)
        ? json.campaigns
            .filter((c) => c && typeof c.id === 'string' && c.id.length > 0)
            .map((c) => ({
              id: String(c.id),
              name: typeof c.name === 'string' ? c.name : null,
            }))
        : [];
      return {
        folderUrl: typeof json?.folderUrl === 'string' ? json.folderUrl : null,
        folders,
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `campaigns Drive-sync GET ${url} failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      throw new ServiceUnavailableException(
        'Campaign Drive-sync call failed — check that the CAMPAIGNS LIST workflow is active.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  // Every file in a campaign's Drive folder, via the erp-campaign-files webhook
  // (the ERP has no Google creds). Tenant-scoped — get() throws if the campaign
  // isn't this org's. Degrades to an empty list if the folder/webhook isn't set.
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
        'Campaign files call failed — check that the CAMPAIGNS LIST workflow is active.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private campaignFilesWebhookUrl(): string {
    const base = (this.config.get('N8N_API_URL') ?? '').trim().replace(/\/+$/, '');
    return base ? `${base}/webhook/erp-campaign-files` : '';
  }

  // The erp-campaigns-list webhook URL: the explicit env override, else derived from
  // the n8n instance base (N8N_API_URL). Blank both = sync disabled.
  private campaignsListWebhookUrl(): string {
    const explicit = (
      this.config.get('N8N_CAMPAIGNS_LIST_WEBHOOK_URL') ?? ''
    ).trim();
    if (explicit) return explicit;
    const base = (this.config.get('N8N_API_URL') ?? '').trim().replace(/\/+$/, '');
    return base ? `${base}/webhook/erp-campaigns-list` : '';
  }
}
