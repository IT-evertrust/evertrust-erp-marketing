import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  MeetingDto,
  MeetingMatchMethod,
  MeetingSyncResultDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { AnalysisZ, type AnalysisResult } from './meetings.analysis';

const REQUEST_TIMEOUT_MS = 15000;
// On-demand persona analysis runs through the Sales Agent workflow's ERP entry
// (webhook → OpenAI GPT-5-mini → Drive persona). Same host as N8N_API_URL.
const ANALYZE_WEBHOOK_PATH = 'erp-sales-analyze';
const ANALYZE_TIMEOUT_MS = 120000;
// "Sync from Drive" reads the analysis-report Docs in the Drive folder (joined
// with the Meeting Analyses sheet) via this read-only webhook. Same host as
// N8N_API_URL. The n8n workflow only RUNS analyses; the ERP pulls + reconciles.
const DRIVE_MEETINGS_PATH = 'erp-sales-meetings';

// One analysis-report Doc in the folder, enriched with its sheet row.
interface DriveMeeting {
  docId?: string;
  docName?: string | null;
  docUrl?: string | null;
  clientCompany?: string | null;
  aeName?: string | null;
  meetingDate?: string | null;
  summary?: string;
  strengthsText?: string;
  weaknessesText?: string;
  persona?: string | null;
  performance?: Record<string, number | null>;
  client?: Record<string, number | null>;
}

// Extract the Google Doc id from any doc URL (…/d/<ID>/…). The reconcile key.
function docIdOf(url: string | null | undefined): string | null {
  const m = String(url ?? '').match(/\/d\/([^/]+)/);
  return m ? m[1]! : null;
}

// Rebuild the stored analysis object from a sheet row. The sheet has scores +
// summary + flattened strengths/weaknesses TEXT (no structured arrays), so we
// keep the text under *_text for the detail view to render.
function buildSheetAnalysis(it: DriveMeeting): Record<string, unknown> {
  const sc = (n: number | null | undefined) =>
    typeof n === 'number' ? { score: n } : undefined;
  const perf = it.performance ?? {};
  const cli = it.client ?? {};
  return {
    overall_summary: it.summary || undefined,
    client_company: it.clientCompany ?? undefined,
    ae_name: it.aeName ?? undefined,
    performance_score: {
      overall: sc(perf.overall),
      understanding_client_needs: sc(perf.understanding_client_needs),
      communication: sc(perf.communication),
      technical_explanation: sc(perf.technical_explanation),
      aggressiveness: sc(perf.aggressiveness),
    },
    client_analysis: {
      overall: sc(cli.overall),
      buying_intent: sc(cli.buying_intent),
      interest: sc(cli.interest),
      communication: sc(cli.communication),
    },
    strengths_text: it.strengthsText || undefined,
    weaknesses_text: it.weaknessesText || undefined,
  };
}

export interface MeetingFilters {
  campaignId?: string; // a campaign id, or 'none' for Unattributed
  ae?: string;
  persona?: string;
  search?: string;
  bucket?: string; // 'week' | 'month' | 'all'
}


@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly config: ConfigService,
  ) {}

  // The org's meetings, newest first, with the campaign name joined in JS and
  // the remaining filters applied in memory (per-org volume is small).
  async list(orgId: string, filters: MeetingFilters = {}): Promise<MeetingDto[]> {
    const rows = await this.db
      .select()
      .from(schema.meetings)
      .where(tenantScope(orgId, schema.meetings))
      .orderBy(desc(schema.meetings.createdAt));

    const camps = await this.db
      .select({ id: schema.campaigns.id, name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns));
    const nameById = new Map(camps.map((c) => [c.id, c.name]));

    const q = (filters.search ?? '').trim().toLowerCase();
    const now = Date.now();
    const cutoff =
      filters.bucket === 'week'
        ? now - 7 * 864e5
        : filters.bucket === 'month'
          ? now - 30 * 864e5
          : null;

    return rows
      .filter((r) => {
        if (filters.campaignId === 'none' && r.campaignId) return false;
        if (
          filters.campaignId &&
          filters.campaignId !== 'none' &&
          r.campaignId !== filters.campaignId
        )
          return false;
        if (filters.ae && r.aeName !== filters.ae) return false;
        if (filters.persona && r.persona !== filters.persona) return false;
        if (cutoff !== null) {
          const t = new Date(r.meetingDate ?? r.createdAt).getTime();
          if (Number.isFinite(t) && t < cutoff) return false;
        }
        if (q) {
          const hay = [r.clientCompany, r.aeName, r.clientContact, r.clientEmail]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((r) => this.toDto(r, nameById));
  }

  // Manual campaign link (null clears it). Marks matchMethod 'manual'.
  async link(
    orgId: string,
    id: string,
    campaignId: string | null,
  ): Promise<MeetingDto> {
    const scope = and(
      tenantScope(orgId, schema.meetings),
      eq(schema.meetings.id, id),
    );
    const rows = await this.db
      .update(schema.meetings)
      .set({
        campaignId,
        matchMethod: campaignId ? 'manual' : null,
        updatedAt: new Date(),
      })
      .where(scope)
      .returning();
    const row = rows[0];
    if (!row) throw new NotFoundException('Meeting not found');
    const camps = await this.db
      .select({ id: schema.campaigns.id, name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns));
    return this.toDto(row, new Map(camps.map((c) => [c.id, c.name])));
  }

  // Re-analyze a meeting's transcript under a chosen persona by calling the
  // EVERTRUST - SALES AGENT workflow (OpenAI GPT-5-mini + Drive personas), then
  // store the result. No ERP-side LLM key — the workflow owns the model. Needs a
  // stored transcript (synced from n8n).
  async analyze(
    orgId: string,
    meetingId: string,
    persona: string,
  ): Promise<MeetingDto> {
    const scope = and(
      tenantScope(orgId, schema.meetings),
      eq(schema.meetings.id, meetingId),
    );
    const m = (
      await this.db.select().from(schema.meetings).where(scope).limit(1)
    )[0];
    if (!m) throw new NotFoundException('Meeting not found');
    if (!m.transcript) {
      throw new BadRequestException(
        'No transcript stored for this meeting — sync from n8n first.',
      );
    }

    // Run the analysis on n8n. The workflow resolves the persona by name against
    // the Drive "AI Personas" folder and runs GPT-5-mini, returning the Sales
    // Analysis Schema synchronously.
    const data = await this.runWorkflowAnalysis(m.transcript, persona);

    const ov = data.performance_score?.overall?.score;
    const score = typeof ov === 'number' ? Math.round(ov) : null;
    const rows = await this.db
      .update(schema.meetings)
      .set({ analysis: data, persona, score, updatedAt: new Date() })
      .where(scope)
      .returning();
    const camps = await this.db
      .select({ id: schema.campaigns.id, name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns));
    return this.toDto(rows[0]!, new Map(camps.map((c) => [c.id, c.name])));
  }

  // The ERP entry to the Sales Agent workflow. Same host as N8N_API_URL (the n8n
  // Cloud instance), or an explicit override via N8N_SALES_ANALYZE_WEBHOOK_URL.
  private analyzeWebhookUrl(): string {
    const explicit = (
      this.config.get('N8N_SALES_ANALYZE_WEBHOOK_URL') ?? ''
    ).trim();
    if (explicit) return explicit;
    const base = (this.config.get('N8N_API_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    return base ? `${base}/webhook/${ANALYZE_WEBHOOK_PATH}` : '';
  }

  // POST {transcript, persona} to the workflow and validate the returned Sales
  // Analysis Schema. Surfaces a clear, observable error on any failure.
  private async runWorkflowAnalysis(
    transcript: string,
    persona: string,
  ): Promise<AnalysisResult> {
    const url = this.analyzeWebhookUrl();
    if (!url) {
      throw new ServiceUnavailableException(
        'Sales analysis is not configured (set N8N_API_URL).',
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ transcript, persona }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ServiceUnavailableException(
          `Sales Agent workflow returned HTTP ${res.status}.`,
        );
      }
      const json = (await res.json()) as unknown;
      const parsed = AnalysisZ.safeParse(json);
      if (!parsed.success) {
        throw new ServiceUnavailableException(
          'Sales Agent workflow returned an unexpected analysis shape.',
        );
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `analyze POST ${url} failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      throw new ServiceUnavailableException(
        'Sales Agent workflow call failed — check that the workflow is active.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  // Delete a meeting (e.g. a stale/test row that has no Drive counterpart).
  async remove(orgId: string, id: string): Promise<{ id: string }> {
    const scope = and(
      tenantScope(orgId, schema.meetings),
      eq(schema.meetings.id, id),
    );
    const existing = (
      await this.db
        .select({ id: schema.meetings.id })
        .from(schema.meetings)
        .where(scope)
        .limit(1)
    )[0];
    if (!existing) throw new NotFoundException('Meeting not found');
    await this.db.delete(schema.meetings).where(scope);
    return { id };
  }

  // "Sync from Drive": mirror the analysis-report Docs in the Drive folder.
  // Reads the read-only webhook (folder Docs joined with the Meeting Analyses
  // sheet), keyed by Google Doc id. Upserts present Docs, PRUNES meetings whose
  // Doc is no longer in the folder. The n8n workflow only runs analyses; the ERP
  // pulls. Contact/email + manual campaign links are preserved on update (the
  // sheet doesn't carry them).
  async sync(orgId: string): Promise<MeetingSyncResultDto> {
    const url = this.driveWebhookUrl();
    if (!url) {
      return { configured: false, scanned: 0, imported: 0, updated: 0, pruned: 0 };
    }
    const json = await this.fetchJson(url);
    const items: DriveMeeting[] = Array.isArray(
      (json as { meetings?: unknown[] } | null)?.meetings,
    )
      ? ((json as { meetings: DriveMeeting[] }).meetings)
      : [];

    const existing = await this.db
      .select()
      .from(schema.meetings)
      .where(tenantScope(orgId, schema.meetings));
    const existingByDoc = new Map<
      string,
      typeof schema.meetings.$inferSelect
    >();
    for (const e of existing) {
      const id = docIdOf(e.docUrl);
      if (id) existingByDoc.set(id, e);
    }

    const seen = new Set<string>();
    let imported = 0;
    let updated = 0;

    for (const it of items) {
      const docId =
        (it.docId && String(it.docId)) || docIdOf(it.docUrl ?? null);
      if (!docId) continue;
      seen.add(docId);
      const analysis = buildSheetAnalysis(it);
      const score =
        typeof it.performance?.overall === 'number'
          ? Math.round(it.performance.overall)
          : null;
      const ex = existingByDoc.get(docId);
      if (ex) {
        // Update what the folder owns; leave contact/email + campaign link intact.
        await this.db
          .update(schema.meetings)
          .set({
            title: it.docName ?? ex.title,
            clientCompany: it.clientCompany ?? ex.clientCompany,
            aeName: it.aeName ?? ex.aeName,
            meetingDate: it.meetingDate ?? ex.meetingDate,
            persona: it.persona ?? ex.persona,
            analysis,
            docUrl: it.docUrl ?? ex.docUrl,
            score,
            updatedAt: new Date(),
          })
          .where(eq(schema.meetings.id, ex.id));
        updated++;
      } else {
        await this.db.insert(schema.meetings).values({
          organizationId: orgId,
          sessionId: null,
          title: it.docName ?? null,
          clientCompany: it.clientCompany ?? null,
          aeName: it.aeName ?? null,
          clientContact: null,
          clientEmail: null,
          meetingDate: it.meetingDate ?? null,
          persona: it.persona ?? null,
          analysis,
          transcript: null,
          docUrl: it.docUrl ?? null,
          score,
          campaignId: null,
          leadId: null,
          matchMethod: null,
        });
        imported++;
      }
    }

    // Prune meetings whose Doc is no longer in the folder (mirror the folder).
    let pruned = 0;
    for (const e of existing) {
      const id = docIdOf(e.docUrl);
      if (!id || !seen.has(id)) {
        await this.db
          .delete(schema.meetings)
          .where(
            and(
              tenantScope(orgId, schema.meetings),
              eq(schema.meetings.id, e.id),
            ),
          );
        pruned++;
      }
    }
    return { configured: true, scanned: items.length, imported, updated, pruned };
  }

  // The read-only "list the folder's analyses" webhook.
  private driveWebhookUrl(): string {
    const explicit = (
      this.config.get('N8N_SALES_MEETINGS_WEBHOOK_URL') ?? ''
    ).trim();
    if (explicit) return explicit;
    const base = (this.config.get('N8N_API_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    return base ? `${base}/webhook/${DRIVE_MEETINGS_PATH}` : '';
  }

  private toDto(
    r: typeof schema.meetings.$inferSelect,
    nameById: Map<string, string | null>,
  ): MeetingDto {
    return {
      id: r.id,
      sessionId: r.sessionId,
      title: r.title,
      clientCompany: r.clientCompany,
      aeName: r.aeName,
      clientContact: r.clientContact,
      clientEmail: r.clientEmail,
      meetingDate: r.meetingDate,
      persona: r.persona,
      analysis: r.analysis ?? null,
      hasTranscript: Boolean(r.transcript),
      docUrl: r.docUrl,
      score: r.score,
      campaignId: r.campaignId,
      campaignName: r.campaignId ? (nameById.get(r.campaignId) ?? null) : null,
      leadId: r.leadId,
      matchMethod: (r.matchMethod as MeetingMatchMethod | null) ?? null,
      createdAt: new Date(r.createdAt).toISOString(),
    };
  }

  // GET the read-only Drive-meetings webhook (public; no n8n API key needed).
  private async fetchJson(url: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`meetings sync GET ${url}: HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      this.logger.warn(
        `meetings sync GET failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
