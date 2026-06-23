import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import type { CreateAimDto } from './dto/create-aim.dto';
import { ReachAgentClient } from './reach.agent';
import { GmailSenderService } from './gmail-sender.service';
import { ReachRepository, type LeadInsert } from './reach.repository';
import { NichesService } from '../niches/niches.service';
import { WorkflowConfigService } from '../arsenal/workflow-config.service';
import type {
  BazookaRunSummary,
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
  // Runaway guard only — the real count is governed by the org's Lead Scraper config
  // (leadTarget). Kept generous so configured tender targets (hundreds) aren't clipped.
  for (const item of raw.slice(0, 1000)) {
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
    private readonly workflowConfig: WorkflowConfigService,
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

  async getAims(orgId: string): Promise<ReachAim[]> {
    const aims = await this.repo.findAims(orgId);
    // Self-heal: a background scrape whose process died (e.g. a Render redeploy
    // mid-run) leaves the aim stuck at RUNNING. If it's older than the hard cap,
    // flip it to FAILED so the UI's countdown ends instead of hanging forever.
    return Promise.all(
      aims.map(async (a) =>
        a.status === 'RUNNING' && this.isScrapeStale(a)
          ? (await this.repo.markScrapeFailed(orgId, a.id)) ?? {
              ...a,
              status: 'FAILED' as const,
            }
          : a,
      ),
    );
  }

  async getAim(orgId: string, aimId: string): Promise<ReachAim> {
    const aim = await this.repo.findAimById(orgId, aimId);
    if (!aim) throw new NotFoundException('Aim not found');
    return aim;
  }

  // Lead Satellite (ASYNC): a Reach scrape can take many minutes, so we DON'T hold
  // the HTTP request open for it (that's what caused the 5-min "Agent abort"). This
  // returns immediately with the aim marked RUNNING + a server-seeded ETA; the
  // actual run continues in the background (runScrapeInBackground) and flips the aim
  // to COMPLETED (leads saved) or FAILED. The FE polls getAims and renders the ETA
  // countdown from scrapeStartedAt + scrapeEtaSeconds (so it survives navigation).
  async scrapeAim(orgId: string, aimId: string): Promise<ReachAim> {
    const aim = await this.getAim(orgId, aimId);
    // Idempotent: a scrape already in flight (and not stale) — return it as-is so a
    // double-click / re-aim never launches a second concurrent run for the same aim.
    if (aim.status === 'RUNNING' && !this.isScrapeStale(aim)) return aim;

    const scraper = await this.workflowConfig.getLeadScraper(orgId);
    const etaSeconds = aim.scrapeLastSeconds ?? this.estimateScrapeSeconds(scraper);
    const running = (await this.repo.markScrapeStarted(orgId, aimId, etaSeconds)) ?? {
      ...aim,
      status: 'RUNNING' as const,
    };
    // Fire-and-forget: the request returns now; the scrape runs server-side. The
    // catch is inside runScrapeInBackground, so this never rejects unhandled.
    void this.runScrapeInBackground(orgId, aim, scraper);
    return running;
  }

  // The actual scrape, run OFF the request thread. On success: save leads + record
  // the real duration (seeds the next ETA). On any error: mark FAILED. Never throws.
  private async runScrapeInBackground(
    orgId: string,
    aim: ReachAim,
    scraper: { leadTarget: number | null; maxQueries: number | null; minScore: number | null },
  ): Promise<void> {
    const startedMs = Date.now();
    try {
      const config = await this.buildAgentConfig(orgId, aim);
      // Per-org Lead Scraper tuning from the Configuration page (org_config.scrape_*).
      // Null fields fall back to the satellite's env defaults — the agent only applies
      // explicit overrides. This is what makes "Leads per run / Search budget / Min
      // score" on the config page actually control how many companies a scrape returns.
      const result = await this.agent.run(
        'reach.lead_satellite',
        {
          campaign_id: aim.id,
          returnOnly: true,
          config,
          scraper: {
            leadTarget: scraper.leadTarget,
            maxQueries: scraper.maxQueries,
            minScore: scraper.minScore,
          },
        },
        'live',
        this.config.get('REACH_SCRAPE_TIMEOUT_MS'),
      );
      const leads = sanitizeLeads(result.output);
      const elapsed = Math.round((Date.now() - startedMs) / 1000);
      await this.repo.replaceLeads(orgId, aim.id, leads, elapsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'lead_satellite failed';
      this.logger.warn(`Lead Satellite failed for aim ${aim.id}: ${msg}`);
      await this.repo.markScrapeFailed(orgId, aim.id).catch(() => undefined);
    }
  }

  // Estimate a scrape's duration (seconds) from the org's Lead Scraper config — a
  // rough seed for the FIRST run's countdown; later runs use the real last duration.
  private estimateScrapeSeconds(scraper: { leadTarget: number | null }): number {
    const target = scraper.leadTarget ?? 100; // matches the satellite's env default
    return Math.min(7200, Math.max(120, 60 + target * 4));
  }

  // A RUNNING aim is "stale" once it has outlived the background agent's hard
  // timeout (+ buffer) — i.e. its process is gone and it will never complete.
  private isScrapeStale(aim: ReachAim): boolean {
    if (!aim.scrapeStartedAt) return true;
    const capMs = this.config.get('REACH_SCRAPE_TIMEOUT_MS') + 120_000;
    return Date.now() - new Date(aim.scrapeStartedAt).getTime() > capMs;
  }

  async getAimLeads(orgId: string, aimId: string) {
    await this.getAim(orgId, aimId);
    return this.repo.findLeadsByAimId(orgId, aimId);
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
  private async resolveSendConfig(_orgId: string): Promise<ReachSendConfig> {
    return Promise.resolve({
      mode: this.config.get('REACH_SEND_MODE'),
      testRecipient: this.config.get('REACH_TEST_RECIPIENT'),
      cap: this.config.get('REACH_TEST_SEND_CAP'),
    });
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
