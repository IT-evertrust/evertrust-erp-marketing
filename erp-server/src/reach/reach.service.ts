import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import type { CreateAimDto } from './dto/create-aim.dto';
import { normalizeTemplateInput, renderTemplate } from './reach-template';
import { ReachAgentClient } from './reach.agent';
import { GmailSenderService } from './gmail-sender.service';
import { ReachRepository, type LeadInsert } from './reach.repository';
import { NichesService } from '../niches/niches.service';
import { WorkflowConfigService } from '../arsenal/workflow-config.service';
import { REACH_BATCH_SIZE, REACH_TOTAL_BATCHES } from './reach.model';
import type {
  BazookaRunSummary,
  DailySendPoint,
  EmailBlock,
  ReachAim,
  ReachBatchState,
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

// Coerce a scraped revenue tier to one of AA/A/B/C (or null when absent/invalid).
function asTier(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return t === 'AA' || t === 'A' || t === 'B' || t === 'C' ? t : null;
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
      revenueTier: asTier(o.revenue_tier),
      // Provenance: the real page URL the model opened (source_url). Falls back to a
      // legacy `source` field. This is what the leads table's Source column shows.
      source: asString(o.source_url) || asString(o.source) || null,
      qualificationReason: asString(o.qualification_reason) || null,
      confidence: conf === null ? null : Math.min(1, Math.max(0, conf)),
    });
  }
  return leads;
}

// ---- 4-batch dedup sweep helpers ----

// The deterministic "Previously Collected Companies" exclusion block appended to the
// base prompt for batches 2-4. Names are wrapped in <...> (one per line) so the model
// can't confuse them with surrounding instructions.
function buildExclusionBlock(companies: string[]): string {
  const list = companies.map((c) => `<${c}>`).join('\n');
  return [
    'Previously Collected Companies',
    '',
    'The following companies have already been collected.',
    '',
    'Do NOT return these companies.',
    'Do NOT return subsidiaries.',
    'Do NOT return alternate legal names.',
    'Do NOT return rebrands.',
    '',
    list,
  ].join('\n');
}

// The current batch's full prompt: the base prompt, plus the exclusion block once any
// companies have been collected. Batch 1 (no companies yet) is just the base.
function buildBatchPrompt(basePrompt: string, companies: string[]): string {
  if (companies.length === 0) return basePrompt;
  return `${basePrompt}\n\n---\n\n${buildExclusionBlock(companies)}`;
}

// Best-effort JSON parse for pasted model output: strips ``` fences and any prose
// around the outermost {...} / [...]. Returns null when nothing parseable is found.
function parseLooseJson(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start > 0) t = t.slice(start);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (end >= 0) t = t.slice(0, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// Coerce whatever the operator pasted (a { raw: "<text>" } wrapper, a { leads: [...] }
// object, a bare array, or a JSON string) into the { leads: [...] } shape sanitizeLeads
// reads. Tolerant so a paste with code fences or stray prose still works.
function extractLeadsPayload(body: unknown): Record<string, unknown> {
  let val: unknown = body;
  if (
    val &&
    typeof val === 'object' &&
    !Array.isArray(val) &&
    typeof (val as { raw?: unknown }).raw === 'string'
  ) {
    val = (val as { raw: string }).raw;
  }
  if (typeof val === 'string') val = parseLooseJson(val);
  if (Array.isArray(val)) return { leads: val };
  if (val && typeof val === 'object' && Array.isArray((val as { leads?: unknown }).leads)) {
    return { leads: (val as { leads: unknown[] }).leads };
  }
  return { leads: [] };
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
      // AIM targeting fields — ignored by the satellite/ammo_forge injectors (they read
      // only known keys) but consumed by reach.prompt_forge to scope the scraping prompt.
      segment: aim.segment ?? null,
      source: aim.source ?? null,
      targetType: aim.targetType ?? null,
      industryFocus: aim.industryFocus ?? null,
      tenderFocus: aim.tenderFocus ?? null,
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

  // AIM: create the campaign row (config.json = the input fields) and return FAST.
  // We DON'T run Ammo Forge here anymore: the local model is serial, so generating the
  // three email templates + news brief up front (≈77s) would block the operator's real
  // goal — the scraping prompt. Ammo Forge is instead kicked off in the BACKGROUND after
  // the prompt is authored (see generateScrapePrompt → runAmmoForgeInBackground), so the
  // prompt shows immediately and templates fill in after via polling.
  async createAim(orgId: string, dto: CreateAimDto): Promise<ReachAim> {
    // Derive the outreach-template placeholders from the niche's Sector instead of raw
    // input: {{Type}} <- first enabled target, {{IndustryFocus}} <- parent industry,
    // {{TenderFocus}} <- niche name. findOrCreate resolves (or seeds) the niche row, which
    // also bridges to the campaign link below — so a single lookup serves both. Best-effort:
    // a free-text niche with no Sector (or a resolve failure) falls back to whatever the dto
    // carried (normally nothing), so creation never blocks.
    let nicheRow: { id: string } | null = null;
    const derived: Pick<CreateAimDto, 'targetType' | 'industryFocus' | 'tenderFocus'> = {
      targetType: dto.targetType,
      industryFocus: dto.industryFocus,
      tenderFocus: dto.tenderFocus,
    };
    try {
      nicheRow = await this.niches.findOrCreate(orgId, dto.niche);
      const ctx = await this.niches.resolveSectorContext(orgId, nicheRow.id);
      derived.targetType = ctx.targetName ?? undefined;
      derived.industryFocus = ctx.industryName ?? undefined;
      derived.tenderFocus = ctx.nicheName;
    } catch (err) {
      this.logger.warn(
        `Could not resolve Sector context for aim niche "${dto.niche}": ${err instanceof Error ? err.message : 'error'}`,
      );
    }

    const aim = await this.repo.createAim(orgId, { ...dto, ...derived });
    // Link a 1:1 ACTIVE campaign so the aim's scraped leads flow into the shared
    // prospects/Nurture pipeline. Bare insert — NO AIM webhook / n8n (Reach owns
    // processing). Best-effort: a link failure must not block aim creation.
    let linked = aim;
    if (nicheRow) {
      try {
        const campaignId = await this.repo.createLinkedCampaign(orgId, nicheRow.id, aim);
        await this.repo.setAimCampaign(orgId, aim.id, campaignId);
        linked = { ...aim, campaignId };
      } catch (err) {
        this.logger.warn(
          `Could not link aim ${aim.id} to a campaign: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
    // Return the DRAFT aim immediately — templates are generated in the background later
    // (after the prompt), so nothing here blocks on the local model.
    return linked;
  }

  // Ammo Forge, run OFF the request thread: generate the three email templates + news
  // brief for an aim and store them (status → READY). Fire-and-forget from
  // generateScrapePrompt so the prompt is never held up by template generation (the local
  // model is serial). Never throws — a failure just leaves the aim without templates,
  // which the org-default template covers for sending.
  private async runAmmoForgeInBackground(
    orgId: string,
    aim: ReachAim,
  ): Promise<void> {
    try {
      const config = await this.buildAgentConfig(orgId, aim);
      const result = await this.agent.run('reach.ammo_forge', {
        campaign_id: aim.id,
        returnOnly: true,
        config,
      });
      await this.repo.setGenerated(orgId, aim.id, {
        templates: sanitizeTemplates(result.output),
        newsBrief: sanitizeNews(result.output),
        generatedBy: asString(result.output.generated_by) || 'unknown',
        status: 'READY',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ammo_forge failed';
      this.logger.warn(`Ammo Forge (background) failed for aim ${aim.id}: ${msg}`);
    }
  }

  async getAims(orgId: string): Promise<ReachAim[]> {
    const aims = await this.repo.findAims(orgId);
    // Self-heal: a background scrape whose process died (e.g. a Render redeploy
    // mid-run) leaves the aim stuck at RUNNING. If it's older than the hard cap,
    // flip it to FAILED so the UI's countdown ends instead of hanging forever. The
    // cap uses the org's configured scrape timeout (resolved once, only when needed).
    let healed = aims;
    if (aims.some((a) => a.status === 'RUNNING')) {
      const timeoutMs = this.resolveScrapeTimeoutMs(
        await this.workflowConfig.getLeadScraper(orgId),
      );
      healed = await Promise.all(
        aims.map(async (a) =>
          a.status === 'RUNNING' && this.isScrapeStale(a, timeoutMs)
            ? (await this.repo.markScrapeFailed(
                orgId,
                a.id,
                'The scrape did not finish in time and was interrupted. Try again, or raise the scrape timeout in Configuration.',
              )) ?? { ...a, status: 'FAILED' as const, scrapeError: null }
            : a,
        ),
      );
    }
    // Org default is the single source: every campaign shows AND sends it (the
    // per-campaign AI-generated template is only a fallback when no org default is set).
    // `usingOrgDefault` lets the Email Generator render it read-only ("edit in Templates").
    const orgDefault = await this.repo.getDefaultTemplate(orgId);
    if (!orgDefault) return healed;
    return healed.map((aim) => ({
      ...aim,
      templates: orgDefault,
      usingOrgDefault: true,
    }));
  }

  async getAim(orgId: string, aimId: string): Promise<ReachAim> {
    const aim = await this.repo.findAimById(orgId, aimId);
    if (!aim) throw new NotFoundException('Aim not found');
    return aim;
  }

  // Generate Prompt (replaces the old scrape trigger): the local model (hermes/qwen via
  // reach.prompt_forge) takes this aim's config and AUTHORS an in-depth OpenAI lead-
  // scraping prompt, scoped to the AIM fields. The only output is the prompt string,
  // which we persist on the aim and return. No web search / scraping / lead writes happen
  // — the operator copies the prompt into OpenAI to run the scrape.
  async generateScrapePrompt(orgId: string, aimId: string): Promise<ReachAim> {
    const aim = await this.getAim(orgId, aimId);
    const config = await this.buildAgentConfig(orgId, aim);
    const result = await this.agent.run('reach.prompt_forge', {
      campaign_id: aim.id,
      config,
    });
    const prompt = asString(result.output.prompt);
    if (!prompt) {
      throw new UnprocessableEntityException(
        'The model did not return a prompt — check the local model gateway and try again.',
      );
    }
    const updated = await this.repo.setScrapePrompt(orgId, aim.id, prompt);
    const finalAim = updated ?? { ...aim, scrapePrompt: prompt };
    // Prompt is done and about to be returned — NOW kick off template generation in the
    // background (the local model is serial, so this runs after the prompt, not before).
    // Only on the first prompt (no templates yet) so re-generating a prompt won't redo it.
    if (!finalAim.templates && finalAim.status !== 'READY') {
      void this.runAmmoForgeInBackground(orgId, finalAim);
    }
    return finalAim;
  }

  // ---- 4-batch dedup sweep ----

  // The current batch state for a campaign: which batch (1..4), the prompt to run for it
  // (base + the accumulated "Previously Collected Companies" exclusion block), how many
  // companies have been collected, and whether the sweep is finished.
  async getBatchState(orgId: string, aimId: string): Promise<ReachBatchState> {
    const aim = await this.getAim(orgId, aimId);
    const companies = await this.repo.getCollectedCompanies(orgId, aimId);
    const done = aim.scrapeBatch > REACH_TOTAL_BATCHES;
    const base = aim.scrapePrompt;
    return {
      batch: aim.scrapeBatch,
      totalBatches: REACH_TOTAL_BATCHES,
      batchSize: REACH_BATCH_SIZE,
      prompt: done || !base ? null : buildBatchPrompt(base, companies),
      collectedCount: companies.length,
      done,
    };
  }

  // Ingest one batch's pasted JSON: sanitize → append (deduped) to reach_leads → mirror
  // the email-bearing leads into the campaign's prospects → advance the batch, and return
  // the NEXT batch's state (its prompt now carries the enlarged exclusion list). This is
  // the round-trip step that both saves the leads and drives dedup across the sweep.
  async ingestBatchResults(
    orgId: string,
    aimId: string,
    body: unknown,
  ): Promise<ReachBatchState> {
    const aim = await this.getAim(orgId, aimId);
    if (aim.scrapeBatch > REACH_TOTAL_BATCHES) {
      throw new UnprocessableEntityException(
        'All batches for this campaign are already complete.',
      );
    }
    const leads = sanitizeLeads(extractLeadsPayload(body));
    if (leads.length === 0) {
      throw new UnprocessableEntityException(
        'No leads found in the pasted output — expected JSON like {"leads": [ { "company": … } ]}.',
      );
    }
    const { saved } = await this.repo.appendLeads(orgId, aimId, leads);
    if (aim.campaignId) {
      await this.repo
        .mirrorLeadsToProspects(orgId, aim.campaignId, leads, aim.country ?? null)
        .catch((err) =>
          this.logger.warn(
            `Mirror batch leads→prospects failed for aim ${aimId}: ${err instanceof Error ? err.message : 'error'}`,
          ),
        );
    }
    const nextBatch = aim.scrapeBatch + 1;
    await this.repo.setScrapeBatch(orgId, aimId, nextBatch);
    // Ammo Forge runs ALONGSIDE the lead scraping: if the email templates aren't ready
    // yet, kick off generation in the background now (fire-and-forget) so it proceeds in
    // parallel with the operator's batch round-trip. Guarded so it never re-runs once the
    // templates exist (the aim flips to READY when Ammo Forge finishes).
    if (!aim.templates && aim.status !== 'READY') {
      void this.runAmmoForgeInBackground(orgId, aim);
    }
    this.logger.log(
      `Reach batch ${aim.scrapeBatch}/${REACH_TOTAL_BATCHES} ingested for aim ${aimId}: ${saved} new lead(s), advancing to batch ${nextBatch}`,
    );
    return this.getBatchState(orgId, aimId);
  }

  // Lead Satellite (ASYNC): a Reach scrape can take many minutes, so we DON'T hold
  // the HTTP request open for it (that's what caused the 5-min "Agent abort"). This
  // returns immediately with the aim marked RUNNING + a server-seeded ETA; the
  // actual run continues in the background (runScrapeInBackground) and flips the aim
  // to COMPLETED (leads saved) or FAILED. The FE polls getAims and renders the ETA
  // countdown from scrapeStartedAt + scrapeEtaSeconds (so it survives navigation).
  async scrapeAim(orgId: string, aimId: string): Promise<ReachAim> {
    const aim = await this.getAim(orgId, aimId);
    const scraper = await this.workflowConfig.getLeadScraper(orgId);
    const timeoutMs = this.resolveScrapeTimeoutMs(scraper);
    // Idempotent: a scrape already in flight (and not stale) — return it as-is so a
    // double-click / re-aim never launches a second concurrent run for the same aim.
    if (aim.status === 'RUNNING' && !this.isScrapeStale(aim, timeoutMs)) return aim;

    const etaSeconds = aim.scrapeLastSeconds ?? this.estimateScrapeSeconds(scraper);
    const running = (await this.repo.markScrapeStarted(orgId, aimId, etaSeconds)) ?? {
      ...aim,
      status: 'RUNNING' as const,
    };
    // Fire-and-forget: the request returns now; the scrape runs server-side. The
    // catch is inside runScrapeInBackground, so this never rejects unhandled.
    void this.runScrapeInBackground(orgId, aim, scraper, timeoutMs);
    return running;
  }

  // The actual scrape, run OFF the request thread. On success: save leads + record
  // the real duration (seeds the next ETA). On any error: mark FAILED. Never throws.
  private async runScrapeInBackground(
    orgId: string,
    aim: ReachAim,
    scraper: { leadTarget: number | null; maxQueries: number | null; minScore: number | null },
    timeoutMs: number,
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
        timeoutMs,
      );
      const leads = sanitizeLeads(result.output);
      const elapsed = Math.round((Date.now() - startedMs) / 1000);
      await this.repo.replaceLeads(orgId, aim.id, leads, elapsed);
      // Mirror the email-bearing leads into the linked campaign's prospects so they
      // show up in the shared Nurture / Engage pipeline. Best-effort (the scrape itself
      // already succeeded); a mirror failure is logged, not fatal.
      if (aim.campaignId) {
        await this.repo
          .mirrorLeadsToProspects(orgId, aim.campaignId, leads, aim.country ?? null)
          .catch((err) =>
            this.logger.warn(
              `Mirror leads→prospects failed for aim ${aim.id}: ${err instanceof Error ? err.message : 'error'}`,
            ),
          );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'lead_satellite failed';
      this.logger.warn(`Lead Satellite failed for aim ${aim.id}: ${msg}`);
      // Persist the reason so the UI can show WHY (not just "failed").
      await this.repo.markScrapeFailed(orgId, aim.id, msg).catch(() => undefined);
    }
  }

  // Estimate a scrape's duration (seconds) from the org's Lead Scraper config — a
  // rough seed for the FIRST run's countdown; later runs use the real last duration.
  private estimateScrapeSeconds(scraper: { leadTarget: number | null }): number {
    const target = scraper.leadTarget ?? 100; // matches the satellite's env default
    return Math.min(7200, Math.max(120, 60 + target * 4));
  }

  // The effective background-scrape timeout (ms): the org's configured value (in
  // minutes, from the Configuration page) ?? the REACH_SCRAPE_TIMEOUT_MS env default.
  private resolveScrapeTimeoutMs(scraper: {
    timeoutMinutes: number | null;
  }): number {
    return scraper.timeoutMinutes != null
      ? scraper.timeoutMinutes * 60_000
      : this.config.get('REACH_SCRAPE_TIMEOUT_MS');
  }

  // A RUNNING aim is "stale" once it has outlived the background agent's hard
  // timeout (+ buffer) — i.e. its process is gone and it will never complete.
  private isScrapeStale(aim: ReachAim, timeoutMs: number): boolean {
    if (!aim.scrapeStartedAt) return true;
    return Date.now() - new Date(aim.scrapeStartedAt).getTime() > timeoutMs + 120_000;
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
    // Org-wide default template wins when set, else the campaign's generated templates.
    const orgDefault = await this.repo.getDefaultTemplate(orgId);
    const tmpl = this.templateFor(aim, round, orgDefault);
    if (!tmpl || leads.length === 0) return 0;
    const signatureImageUrl = await this.repo.getSignatureImageUrl(orgId);

    const { mode, testRecipient, cap } = await this.resolveSendConfig(orgId);
    const targets = mode === 'live' ? leads : leads.slice(0, cap);

    let delivered = 0;
    for (const lead of targets) {
      const recipient = mode === 'live' ? lead.email : testRecipient;
      if (!recipient) continue;
      const vars = {
        company: lead.company,
        type: aim.targetType ?? '',
        industryFocus: aim.industryFocus ?? '',
        tenderFocus: aim.tenderFocus ?? aim.niche,
      };
      const subject = renderTemplate(tmpl.subject, vars);
      let body = renderTemplate(tmpl.body, vars);
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
          signatureImageUrl,
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

  private templateFor(
    aim: ReachAim,
    round: ReachRound,
    orgDefault?: ReachTemplates | null,
  ): EmailBlock | null {
    const t = orgDefault ?? aim.templates;
    if (!t) return null;
    return round === 'cold'
      ? t.cold_outreach
      : round === 'followup'
        ? t.follow_up
        : t.final_push;
  }

  // The org-wide default outreach template (or null when none is set).
  getDefaultTemplate(orgId: string): Promise<ReachTemplates | null> {
    return this.repo.getDefaultTemplate(orgId);
  }

  // Save the org-wide default template from a pasted/uploaded payload (any round
  // spelling). Normalizes + validates; a bad shape becomes a 400.
  async setDefaultTemplate(orgId: string, raw: unknown): Promise<void> {
    let normalized;
    try {
      normalized = normalizeTemplateInput(raw);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid template');
    }
    await this.repo.setDefaultTemplate(orgId, normalized);
  }

  // The org signature image URL embedded in every outgoing email (or null). The image
  // is uploaded/served by the arsenal SignatureAssetsService; this reads the same
  // canonical org_config.signature_image_url.
  getSignatureImageUrl(orgId: string): Promise<string | null> {
    return this.repo.getSignatureImageUrl(orgId);
  }

  // Set (or clear with null/empty) the org signature image URL.
  setSignatureImageUrl(orgId: string, url: string | null): Promise<void> {
    const trimmed = url?.trim();
    return this.repo.setSignatureImageUrl(orgId, trimmed ? trimmed : null);
  }

  // The effective Reach send policy for an org: PER-ORG override (org_config) ?? env
  // default — the house multi-tenant rule. Now editable at runtime from the Settings
  // page (no redeploy). Any unset column falls back to the product env default.
  private async resolveSendConfig(orgId: string): Promise<ReachSendConfig> {
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

  // The org's effective send policy + the env defaults (so the UI shows what a reset
  // falls back to) + the connected-mailbox status.
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
  // inbox (no test-mode redirection). Never throws: a send failure is returned as
  // { ok:false, reason } so the form can show why.
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

  // The org's Reach send timeline: real per-day counts over the past 7 days
  // (oldest first), zero-filled, with "Today" labelled — drives the Reach dashboard
  // chart.
  async dailySends(orgId: string): Promise<DailySendPoint[]> {
    const rows = await this.repo.dailySends(orgId);

    // Bucket counts by local "YYYY-M-D" key so DB ::date rows line up with our days.
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(dayKey(r.day), r.count);

    const today = new Date();
    const points: DailySendPoint[] = [];
    // 6 days ago -> today (7 days total), chronological (oldest first).
    for (let i = 6; i >= 0; i--) {
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
