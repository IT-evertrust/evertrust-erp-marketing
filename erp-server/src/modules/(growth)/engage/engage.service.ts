import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ReplyVerdict } from '@evertrust/shared';

import { ReplyClassificationsService } from '../../../outreach/reply-classifications.service';
import { GmailSenderService } from '../shared/gmail-sender.service';
import { GmailReaderService } from '../shared/gmail-reader.service';
import { GoogleAuthService } from '../../../auth/google/google-auth.service';
import type { SaveReplyDraftDto } from './dto/save-reply-draft.dto';
import type { SendReplyDto } from './dto/send-reply.dto';
import { EngageAgentClient } from './engage.agent';
import { EngageRepository } from './engage.repository';
import type {
  EngageActionSummary,
  EngageCampaign,
  EngageReply,
  EngageThreadMessage,
} from './engage.model';

type Mode = 'dry_run' | 'live';

// Reply Glock's 4-status output mapped onto the DB reply verdict. TEMPORARY becomes a
// SNOOZE (soft no + a re-engage date); UNINTERESTED a hard NOT_INTERESTED.
function statusToVerdict(status: string): ReplyVerdict {
  switch (status) {
    case 'INTERESTED':
      return 'INTERESTED';
    case 'UNSURE':
      return 'UNSURE';
    case 'TEMPORARY':
      return 'SNOOZE';
    case 'UNINTERESTED':
      return 'NOT_INTERESTED';
    default:
      return 'UNSURE';
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asIsoOrUndefined(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// Engage orchestration: validate/sanitize, read the DB, feed the agent a clean input,
// extract its structured output, persist the verdict + draft, and return UI-ready shapes.
// The agent is brain-only; sending/booking stay here (deferred to the OAuth phase).
@Injectable()
export class EngageService {
  private readonly logger = new Logger(EngageService.name);

  constructor(
    private readonly repo: EngageRepository,
    private readonly agent: EngageAgentClient,
    private readonly classifications: ReplyClassificationsService,
    private readonly gmail: GmailSenderService,
    private readonly gmailReader: GmailReaderService,
    private readonly google: GoogleAuthService,
  ) {}

  // Sync real inbound Gmail into the Engage queue across every connected mailbox.
  // Match-known-prospects-only: a message is ingested only if its sender matches an
  // existing prospect (by email); unknown senders are ignored so the queue stays clean.
  // Idempotent (deduped by Gmail message id) — safe to call on every page load.
  async syncInbox(
    orgId: string,
  ): Promise<{ accounts: number; scanned: number; matched: number; ingested: number }> {
    const accounts = await this.google.listConnectedAccounts(orgId);
    let scanned = 0;
    let matched = 0;
    let ingested = 0;
    for (const account of accounts) {
      const messages = await this.gmailReader.listInbound(orgId, account.id);
      if (messages.length === 0) continue;
      const res = await this.repo.ingestInbound(orgId, messages);
      scanned += res.scanned;
      matched += res.matched;
      ingested += res.ingested;
    }
    if (ingested > 0) {
      this.logger.log(
        `Engage inbox sync: ${ingested} new inbound across ${accounts.length} mailbox(es) (${matched} matched / ${scanned} scanned)`,
      );
    }
    return { accounts: accounts.length, scanned, matched, ingested };
  }

  getCampaigns(orgId: string): Promise<EngageCampaign[]> {
    return this.repo.listCampaigns(orgId);
  }

  getReplies(orgId: string, campaignId: string): Promise<EngageReply[]> {
    return this.repo.findRepliesByCampaign(orgId, campaignId);
  }

  getThread(orgId: string, prospectId: string): Promise<EngageThreadMessage[]> {
    return this.repo.getThread(orgId, prospectId);
  }

  // Classify (+ draft) one reply: build the agent input from the DB, call Reply Glock,
  // and persist the verdict + draft. Returns the refreshed reply.
  async runReplyGlock(
    orgId: string,
    prospectId: string,
    mode: Mode = 'live',
  ): Promise<EngageReply> {
    const prospect = await this.repo.requireProspect(orgId, prospectId);
    const campaign = await this.repo.getCampaign(orgId, prospect.campaignId);
    const messages = await this.repo.getMessages(prospectId);
    const inbound = messages.filter((m) => m.direction === 'INBOUND');
    const latest = inbound[inbound.length - 1];
    if (!latest) {
      throw new UnprocessableEntityException(
        'No inbound reply to classify for this prospect.',
      );
    }

    const input = {
      reply_id: prospect.id,
      campaign_id: prospect.campaignId,
      lead_id: prospect.leadId ?? null,
      sender_name: null,
      sender_email: prospect.email,
      company: prospect.companyName ?? null,
      subject: latest.subject ?? '',
      body: latest.bodySnippet ?? '',
      received_at: (latest.sentAt ?? latest.createdAt)?.toISOString() ?? null,
      previous_thread: messages
        .filter((m) => m.id !== latest.id)
        .map((m) => ({
          direction: m.direction === 'INBOUND' ? 'inbound' : 'outbound',
          subject: m.subject ?? '',
          body: m.bodySnippet ?? '',
          timestamp: (m.sentAt ?? m.createdAt)?.toISOString() ?? null,
        })),
      campaign_context: {
        campaign_id: campaign.id,
        campaign_name: campaign.name ?? campaign.project,
        product_or_service: campaign.project,
        offer: campaign.project,
        sender_name: campaign.sender,
        sender_company: 'EVERTRUST GmbH',
        sender_signature: null,
      },
    };

    const result = await this.agent.run('engage.reply_glock', input, mode);
    const output = result.output;
    const draft = (output.draft ?? {}) as Record<string, unknown>;
    const status = asString(output.status);
    const verdict = statusToVerdict(status);
    const snoozeUntil =
      verdict === 'SNOOZE'
        ? asIsoOrUndefined(output.follow_up_date_or_window)
        : undefined;

    await this.classifications.create({
      prospectId: prospect.id,
      messageId: latest.id,
      verdict,
      snoozeUntil,
      model: asString(result.metrics.model) || 'hermes',
      raw: output,
      suggestedReply: asString(draft.body) || undefined,
    });

    // An UNSURE reply auto-escalates to the RAG agent, which drafts a grounded answer
    // from the knowledge bank and supersedes Reply Glock's draft. Best-effort: if RAG
    // is unavailable (e.g. the LLM gateway is down) the Reply Glock result still stands.
    if (verdict === 'UNSURE' && mode === 'live') {
      try {
        return await this.runRag(orgId, prospectId, mode);
      } catch {
        // RAG unavailable — keep the Reply Glock classification + draft.
      }
    }

    return this.repo.findReplyByProspect(orgId, prospectId);
  }

  // Draft a grounded answer for an UNSURE reply via the RAG agent, then persist it.
  async runRag(orgId: string, prospectId: string, mode: Mode = 'live'): Promise<EngageReply> {
    const prospect = await this.repo.requireProspect(orgId, prospectId);
    const messages = await this.repo.getMessages(prospectId);

    const input = {
      prospect_id: prospect.id,
      campaign_id: prospect.campaignId,
      company: prospect.companyName ?? null,
      country: prospect.country ?? null,
      lead_email: prospect.email,
      thread: messages.map((m) => ({
        direction: m.direction,
        from_address:
          m.direction === 'INBOUND' ? prospect.email : 'evertrust',
        body: m.bodySnippet ?? '',
        sent_at: (m.sentAt ?? m.createdAt)?.toISOString() ?? null,
      })),
    };

    const result = await this.agent.run('engage.rag_agent', input, mode);
    const output = result.output;
    const draftBody = asString(output.draftReply);
    const draftSubject = asString(output.subject);

    await this.classifications.create({
      prospectId: prospect.id,
      verdict: 'UNSURE',
      model: asString(result.metrics.model) || 'hermes',
      raw: { ...output, draft: { subject: draftSubject, body: draftBody } },
      suggestedReply: draftBody || undefined,
    });

    return this.repo.findReplyByProspect(orgId, prospectId);
  }

  // Batch: classify every inbound reply in the campaign that has no verdict yet.
  async classifyCampaign(
    orgId: string,
    campaignId: string,
    mode: Mode = 'live',
  ): Promise<EngageActionSummary> {
    const prospects = await this.repo.prospectsNeedingClassification(
      orgId,
      campaignId,
    );
    let classified = 0;
    const errors: string[] = [];
    for (const prospect of prospects) {
      try {
        await this.runReplyGlock(orgId, prospect.id, mode);
        classified++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'classify failed';
        errors.push(`${prospect.email}: ${msg}`);
      }
    }
    return {
      campaignId,
      processed: prospects.length,
      classified,
      skipped: prospects.length - classified - errors.length,
      errors,
    };
  }

  async saveDraft(
    orgId: string,
    prospectId: string,
    dto: SaveReplyDraftDto,
  ): Promise<EngageReply> {
    await this.repo.updateDraft(orgId, prospectId, dto.subject, dto.body);
    return this.repo.findReplyByProspect(orgId, prospectId);
  }

  // Send the (edited) draft reply to the prospect via the campaign's sender mailbox.
  // Safe-by-default: REACH_SEND_MODE='test' redirects every send to REACH_TEST_RECIPIENT
  // so real/synthetic prospect inboxes are never hit; flip to 'live' to email prospects.
  // Records the sent reply as an OUTBOUND thread message and advances the prospect to
  // REPLIED. Throws 503 if the sender mailbox isn't connected.
  async sendReply(
    orgId: string,
    prospectId: string,
    dto: SendReplyDto,
  ): Promise<EngageReply> {
    const prospect = await this.repo.requireProspect(orgId, prospectId);
    const campaign = await this.repo.getCampaign(orgId, prospect.campaignId);
    const senderKey = campaign.sender;

    if (!(await this.gmail.canSend(orgId, senderKey))) {
      throw new ServiceUnavailableException(
        `The '${senderKey}' mailbox isn't connected — sign in with Google as ${senderKey}@evertrust-germany.de first.`,
      );
    }

    const { recipient, messageId, mode } = await this.gmail.deliver(
      orgId,
      senderKey,
      {
        to: prospect.email,
        subject: dto.subject,
        body: dto.body,
        fromName: 'EVERTRUST GmbH',
      },
    );

    await this.repo.recordOutboundReply(orgId, prospectId, {
      subject: dto.subject,
      body: dto.body,
      gmailMessageId: messageId,
    });
    this.logger.log(
      `Engage reply sent (${senderKey} -> ${recipient}, mode=${mode}) for prospect ${prospectId}`,
    );

    return this.repo.findReplyByProspect(orgId, prospectId);
  }

  // Deferred: Reply Glock feedback/rewrite mode (v2). Stub endpoint until built.
  async aiFeedback(_orgId: string, _prospectId: string): Promise<never> {
    throw new ServiceUnavailableException(
      'AI feedback / rewrite is not enabled yet.',
    );
  }

  seedDemo(
    orgId: string,
    campaignId?: string,
  ): Promise<{ campaignId: string; created: number; skipped: number }> {
    return this.repo.seedDemo(orgId, campaignId);
  }
}
