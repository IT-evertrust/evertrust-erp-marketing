import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { PipelineStage } from '@evertrust/shared';
import { AppConfigService } from '../config/app-config.service';
import type { CreateAimDto } from './dto/create-aim.dto';
import { ReachAgentClient } from './reach.agent';
import { GmailSenderService } from './gmail-sender.service';
import { ReachRepository, type LeadInsert } from './reach.repository';
import { NichesService } from '../niches/niches.service';
import type {
  BazookaRunSummary,
  DailySendPoint,
  EmailBlock,
  ReachAim,
  ReachNewsBrief,
  ReachRound,
  ReachTemplates,
  TrackKind,
} from './reach.model';

type SentLead = { company: string; email: string | null };

// The resolved Reach send policy for one delivery run. Today every field comes
// straight from env (the product default); the resolveSendConfig() seam below is
// where a PER-ORG override (org_config ?? env, the house multi-tenant rule) drops
// in once the org_config columns exist (see FLAG in the integration report).
type ReachSendConfig = {
  mode: 'test' | 'live';
  testRecipient: string;
  cap: number;
};

// ---- sanitizers: the agent output is untrusted (LLM/offline). Coerce it into
// the exact shapes we persist so a malformed agent response can never poison the
// DB or the UI. ----

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback;
}

function asBlock(v: unknown): EmailBlock {
  const o = (v ?? {}) as Record<string, unknown>;
  return { subject: asString(o.subject), body: asString(o.body) };
}

function sanitizeTemplates(output: Record<string, unknown>): ReachTemplates {
  const t = (output.templates ?? {}) as Record<string, unknown>;
  return {
    cold_outreach: asBlock(t.cold_outreach),
    follow_up: asBlock(t.follow_up),
    final_push: asBlock(t.final_push),
  };
}

function sanitizeNews(output: Record<string, unknown>): ReachNewsBrief {
  const n = (output.news_brief ?? {}) as Record<string, unknown>;
  return { title: asString(n.title), body: asString(n.body) };
}

function sanitizeLeads(output: Record<string, unknown>): LeadInsert[] {
  const raw = Array.isArray(output.leads) ? output.leads : [];
  const leads: LeadInsert[] = [];
  for (const item of raw.slice(0, 200)) {
    const o = (item ?? {}) as Record<string, unknown>;
    const company = asString(o.company);
    if (!company) continue; // company is required — skip junk rows
    const conf = typeof o.confidence === 'number' ? o.confidence : null;
    leads.push({
      company,
      website: asString(o.website) || null,
      contactName: asString(o.contact_name) || null,
      contactTitle: asString(o.contact_title) || null,
      email: asString(o.email) || null,
      phone: asString(o.phone) || null,
      location: asString(o.location) || null,
      source: asString(o.source) || null,
      qualificationReason: asString(o.qualification_reason) || null,
      confidence: conf === null ? null : Math.min(1, Math.max(0, conf)),
    });
  }
  return leads;
}

// Reach orchestration: persist the AIM config, generate templates + news via
// Ammo Forge, and scrape leads via Lead Satellite. The agents are brain-only;
// validation/sanitization and all DB writes happen here.
@Injectable()
export class ReachService {
  private readonly logger = new Logger(ReachService.name);

  constructor(
    private readonly repo: ReachRepository,
    private readonly agent: ReachAgentClient,
    private readonly gmail: GmailSenderService,
    private readonly config: AppConfigService,
    private readonly niches: NichesService,
  ) {}

  // Build the agent CampaignConfig from a reach aim: resolve the niche (find-or-
  // create by name) + its ENABLED Sector targets, so the satellite runs a real
  // targets×cities search (not a niche-name-only fallback). The reach adapters
  // inject this (no GET /campaigns/:id/config) and run return-only (no writes to
  // campaigns tables — results come back in the agent response).
  private async buildAgentConfig(
    orgId: string,
    aim: ReachAim,
  ): Promise<Record<string, unknown>> {
    const niche = await this.niches.findOrCreate(orgId, aim.niche);
    const targets = await this.niches.targets(niche.id, true);
    return {
      campaignId: aim.id,
      name: aim.name,
      project: aim.project ?? aim.name,
      // AIM zone (Anywhere|North|South|East|West|Border-DE) — the satellite resolves
      // it to real cities via its LLM country profiler.
      region: aim.region,
      country: aim.country ?? 'Germany',
      niche: {
        id: niche.id,
        name: niche.name,
        slug: niche.slug,
        industry: '',
        targets: targets.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          searchHint: t.searchHint ?? null,
        })),
      },
    };
  }

  // AIM: create the campaign row (config.json = the input fields), then run Ammo
  // Forge to generate the three templates + the news brief and store them. If the
  // agent is unreachable the aim is still created (DRAFT) so it can be regenerated.
  async createAim(orgId: string, dto: CreateAimDto): Promise<ReachAim> {
    const aim = await this.repo.createAim(orgId, dto);
    // reach_aims is the single source — no CRM campaigns row is created. The aim's
    // leads (reach_leads) ARE its Nurture pipeline once scraped.
    try {
      const config = await this.buildAgentConfig(orgId, aim);
      const result = await this.agent.run('reach.ammo_forge', {
        campaign_id: aim.id,
        returnOnly: true,
        config,
      });
      const updated = await this.repo.setGenerated(orgId, aim.id, {
        templates: sanitizeTemplates(result.output),
        newsBrief: sanitizeNews(result.output),
        generatedBy: asString(result.output.generated_by) || 'unknown',
        status: 'READY',
      });
      return updated ?? aim;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ammo_forge failed';
      this.logger.warn(`Ammo Forge failed for aim ${aim.id}: ${msg}`);
      return aim; // keep the DRAFT aim; templates can be regenerated later
    }
  }

  getAims(orgId: string): Promise<ReachAim[]> {
    return this.repo.findAims(orgId);
  }

  async getAim(orgId: string, aimId: string): Promise<ReachAim> {
    const aim = await this.repo.findAimById(orgId, aimId);
    if (!aim) throw new NotFoundException('Aim not found');
    return aim;
  }

  // ---- Nurture board (reach_leads ARE the pipeline) ----

  // The Nurture pipeline: every org lead (optionally one aim) grouped client-side by
  // pipeline stage, plus the full-set stage/status tallies.
  board(
    orgId: string,
    opts: { aimId?: string; q?: string; limit?: number; offset?: number },
  ) {
    return this.repo.boardLeads(orgId, opts);
  }

  async updateLeadStage(orgId: string, leadId: string, stage: PipelineStage) {
    const lead = await this.repo.updateLeadStage(orgId, leadId, stage);
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

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
  ) {
    if (patch.aimId && !(await this.repo.aimExists(orgId, patch.aimId))) {
      throw new NotFoundException('Campaign not found');
    }
    const lead = await this.repo.updateLeadDeal(orgId, leadId, patch);
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  // Add a Nurture card under an aim (the board's "+ Add deal").
  async createLead(
    orgId: string,
    input: {
      aimId?: string | null;
      company?: string;
      pipelineStage?: PipelineStage;
      dealValue?: number;
      contactName?: string | null;
      phone?: string | null;
    },
  ) {
    // A deal can be added unassigned and attached to a campaign later. Only validate
    // the campaign when one was actually given.
    if (input.aimId && !(await this.repo.aimExists(orgId, input.aimId))) {
      throw new NotFoundException('Campaign not found');
    }
    return this.repo.createLead(orgId, {
      aimId: input.aimId ?? null,
      company: (input.company ?? '').trim() || 'New deal',
      pipelineStage: input.pipelineStage ?? 'INTEREST',
      dealValue: input.dealValue ?? 0,
      contactName: input.contactName,
      phone: input.phone,
    });
  }

  async deleteLead(orgId: string, leadId: string) {
    const ok = await this.repo.deleteLead(orgId, leadId);
    if (!ok) throw new NotFoundException('Lead not found');
    return { deleted: true };
  }

  // Lead Satellite: activated with the aim's config; scrapes leads and stores them
  // tied to the aim. Returns the stored leads. Marks the aim RUNNING -> COMPLETED
  // (or FAILED if the agent is unavailable).
  async scrapeAim(orgId: string, aimId: string) {
    const aim = await this.getAim(orgId, aimId);
    await this.repo.setStatus(orgId, aimId, 'RUNNING');
    try {
      const config = await this.buildAgentConfig(orgId, aim);
      const result = await this.agent.run('reach.lead_satellite', {
        campaign_id: aim.id,
        returnOnly: true,
        config,
      });
      const leads = sanitizeLeads(result.output);
      return this.repo.replaceLeads(orgId, aimId, leads);
    } catch (err) {
      await this.repo.setStatus(orgId, aimId, 'FAILED');
      const msg = err instanceof Error ? err.message : 'lead_satellite failed';
      this.logger.warn(`Lead Satellite failed for aim ${aimId}: ${msg}`);
      throw err instanceof ServiceUnavailableException
        ? err
        : new ServiceUnavailableException(`Lead scrape failed: ${msg}`);
    }
  }

  async getAimLeads(orgId: string, aimId: string) {
    await this.getAim(orgId, aimId);
    return this.repo.findLeadsByAimId(orgId, aimId);
  }

  // Real daily email-send counts for the org's reach chart: the last 10 calendar
  // days ending today (inclusive), oldest first. Days with no sends are filled with
  // value 0. Today's point is labelled "Today" (type 'today'); earlier days use the
  // "D/M" label with no leading zeros (type 'past'). No future data is ever emitted.
  async dailySends(orgId: string): Promise<DailySendPoint[]> {
    const rows = await this.repo.dailySends(orgId);

    // Bucket counts by local "YYYY-M-D" key so DB ::date rows line up with our days.
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(dayKey(r.day), r.count);

    const today = new Date();
    const points: DailySendPoint[] = [];
    // 9 days ago -> today (10 days total), chronological (oldest first).
    for (let i = 9; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const isToday = i === 0;
      points.push({
        date: isToday ? 'Today' : `${d.getDate()}/${d.getMonth() + 1}`,
        value: counts.get(dayKey(d)) ?? 0,
        type: isToday ? 'today' : 'past',
      });
    }
    return points;
  }

  // Manual send for one round: records the send (advances `sent` + lead statuses)
  // so the Performance box reflects it. Actual Gmail delivery is deferred until the
  // OAuth key lands — this is a recorded send, not a delivery.
  async sendRound(
    orgId: string,
    aimId: string,
    round: ReachRound,
  ): Promise<ReachAim> {
    const aim = await this.getAim(orgId, aimId);
    if (!aim.templates) {
      throw new UnprocessableEntityException(
        'No templates generated yet — launch the Aim first.',
      );
    }
    if (aim.companies === 0) {
      throw new UnprocessableEntityException(
        'No leads to send to — scrape leads first.',
      );
    }
    // Enforce the sequence: cold -> follow-up -> final.
    if (round === 'followup' && aim.stats.cold.sent === 0) {
      throw new UnprocessableEntityException('Send the cold outreach first.');
    }
    if (round === 'final' && aim.stats.followup.sent === 0) {
      throw new UnprocessableEntityException('Send the follow-up first.');
    }
    // Mailbox must be connected before we record or deliver.
    if (!(await this.gmail.canSend(orgId, aim.sender))) {
      throw new ServiceUnavailableException(
        `The '${aim.sender}' mailbox isn't connected — sign in with Google as ${aim.sender}@evertrust-germany.de first.`,
      );
    }
    const { aim: updated, sentLeads } = await this.repo.recordSend(
      orgId,
      aimId,
      round,
    );
    if (!updated) throw new NotFoundException('Aim not found');
    await this.deliverRound(orgId, updated, round, sentLeads);
    return updated;
  }

  // Deliver a round's template to the just-recorded leads via Gmail. In 'test'
  // mode every send is redirected to REACH_TEST_RECIPIENT (capped) so synthetic
  // lead addresses are never emailed; 'live' sends to the real lead email.
  // Best-effort: per-send failures are logged, not fatal (the send is recorded).
  private async deliverRound(
    orgId: string,
    aim: ReachAim,
    round: ReachRound,
    leads: SentLead[],
  ): Promise<number> {
    const tmpl = this.templateFor(aim, round);
    if (!tmpl || leads.length === 0) return 0;

    const { mode, testRecipient, cap } = await this.resolveSendConfig(orgId);
    const targets = mode === 'live' ? leads : leads.slice(0, cap);

    let delivered = 0;
    for (const lead of targets) {
      const recipient = mode === 'live' ? lead.email : testRecipient;
      if (!recipient) continue;
      const subject = tmpl.subject.replace(/\{\{Company Name\}\}/g, lead.company);
      let body = tmpl.body.replace(/\{\{Company Name\}\}/g, lead.company);
      if (mode !== 'live') {
        body =
          `[TEST MODE — would be sent to ${lead.email ?? '(no email)'} for ${lead.company}]\n\n` +
          body;
      }
      try {
        await this.gmail.sendAs(orgId, aim.sender, {
          to: recipient,
          subject,
          body,
          fromName: 'EVERTRUST GmbH',
        });
        delivered++;
      } catch (err) {
        this.logger.warn(
          `Reach send failed (${aim.sender} -> ${recipient}): ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
    this.logger.log(
      `Reach ${round} delivery for "${aim.name}": ${delivered}/${targets.length} sent (mode=${mode})`,
    );
    return delivered;
  }

  private templateFor(aim: ReachAim, round: ReachRound): EmailBlock | null {
    const t = aim.templates;
    if (!t) return null;
    return round === 'cold'
      ? t.cold_outreach
      : round === 'followup'
        ? t.follow_up
        : t.final_push;
  }

  // The effective Reach send policy for an org. Currently env-only (the product
  // default); the `orgId` is taken so a PER-ORG override (org_config ?? env — the
  // house multi-tenant rule, exactly like EngageService.resolveAiModel/resolveTone)
  // can be layered in here without touching any caller, once the org_config columns
  // land (see FLAG in the integration report). Async to match that future DB read.
  private async resolveSendConfig(orgId: string): Promise<ReachSendConfig> {
    // Per-org override (org_config) ?? env default — the house multi-tenant rule.
    // Now editable at runtime from the Settings page (no redeploy).
    const ov = await this.repo.getReachSettings(orgId);
    const mode: 'test' | 'live' =
      ov.mode === 'test' || ov.mode === 'live'
        ? ov.mode
        : this.config.get('REACH_SEND_MODE');
    return {
      mode,
      testRecipient: ov.testRecipient ?? this.config.get('REACH_TEST_RECIPIENT'),
      cap: ov.cap ?? this.config.get('REACH_TEST_SEND_CAP'),
    };
  }

  // ---- Reach send-policy settings (Settings page) ----

  // The org's EFFECTIVE Reach send policy (override ?? env), alongside the env
  // defaults and the current sending-mailbox status, for the Settings form.
  async getReachSendSettings(orgId: string): Promise<{
    mode: 'test' | 'live';
    testRecipient: string;
    cap: number;
    envDefaults: { mode: 'test' | 'live'; testRecipient: string; cap: number };
    mailbox: { connected: boolean; email: string | null; reason: string | null };
  }> {
    const [effective, mailbox] = await Promise.all([
      this.resolveSendConfig(orgId),
      this.gmail.senderStatus(orgId),
    ]);
    return {
      ...effective,
      envDefaults: {
        mode: this.config.get('REACH_SEND_MODE'),
        testRecipient: this.config.get('REACH_TEST_RECIPIENT'),
        cap: this.config.get('REACH_TEST_SEND_CAP'),
      },
      mailbox,
    };
  }

  // Persist a partial Reach send-policy override, then return the refreshed effective
  // settings (so the UI reflects exactly what will be used).
  async updateReachSendSettings(
    orgId: string,
    patch: { mode?: 'test' | 'live'; testRecipient?: string | null; cap?: number | null },
  ): ReturnType<ReachService['getReachSendSettings']> {
    await this.repo.setReachSettings(orgId, patch);
    return this.getReachSendSettings(orgId);
  }

  // Send a one-off sample email to `to` via the org's connected mailbox — a manual
  // "does sending work?" probe for the Settings page. Sends DIRECTLY to the given
  // inbox (it does not apply test-mode redirection). Never throws: a send failure is
  // returned as { ok:false, reason } so the form can show why.
  async sendTestEmail(
    orgId: string,
    to: string,
  ): Promise<{ ok: boolean; to: string; from: string | null; messageId: string | null; reason: string | null }> {
    const status = await this.gmail.senderStatus(orgId);
    try {
      const messageId = await this.gmail.sendAs(orgId, 'info', {
        to,
        subject: 'EVERTRUST Reach — test email',
        body:
          'This is a test email sent from the EVERTRUST Growth Engine settings page ' +
          'to verify that outbound sending is working.\n\nIf you received this, the ' +
          'connected mailbox can send mail.\n\n— EVERTRUST GmbH',
        fromName: 'EVERTRUST GmbH',
      });
      return { ok: true, to, from: status.email, messageId, reason: null };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Send failed.';
      this.logger.warn(`Reach test-send to ${to} failed: ${reason}`);
      return { ok: false, to, from: status.email, messageId: null, reason };
    }
  }

  // ---- Reach Bazooka (auto-sender) ----

  // Flip the per-campaign auto-send toggle.
  async setAutoSend(
    orgId: string,
    aimId: string,
    enabled: boolean,
  ): Promise<ReachAim> {
    const updated = await this.repo.setAutoSend(orgId, aimId, enabled);
    if (!updated) throw new NotFoundException('Aim not found');
    return updated;
  }

  // Run Bazooka: advance every auto-send campaign by its next due round (one step
  // per run). Skips campaigns with no templates or no leads, or already complete.
  async runBazooka(orgId: string): Promise<BazookaRunSummary> {
    const aims = await this.repo.findAutoSendAims(orgId);
    const sends: BazookaRunSummary['sends'] = [];
    for (const aim of aims) {
      if (!aim.templates || aim.companies === 0) continue;
      // Skip campaigns whose sender mailbox isn't connected (don't fail the run).
      if (!(await this.gmail.canSend(orgId, aim.sender))) continue;
      const round = await this.repo.nextDueRound(orgId, aim.id);
      if (!round) continue;
      const before = aim.stats[round].sent;
      const { aim: updated, sentLeads } = await this.repo.recordSend(
        orgId,
        aim.id,
        round,
      );
      const after = updated?.stats[round].sent ?? before;
      await this.deliverRound(orgId, updated ?? aim, round, sentLeads);
      sends.push({
        aimId: aim.id,
        campaign: aim.name,
        round,
        count: Math.max(0, after - before),
      });
    }
    return { campaignsProcessed: sends.length, sends };
  }

  // ---- tracking (public; records open/click/reply on a sent round) ----
  track(
    aimId: string,
    round: ReachRound,
    leadId: string,
    kind: TrackKind,
  ): Promise<boolean> {
    return this.repo.trackEvent(aimId, round, leadId, kind);
  }
}
