import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { CAMPAIGN_SENDER_LABELS, type ReplyVerdict } from '@evertrust/shared';

import { DB, type DbClient } from '../../../db/db.tokens';
import { tenantScope } from '../../../common/tenant';
import type { InboundMessage } from '../shared/gmail-reader.service';
import type {
  EngageCampaign,
  EngageCampaignStatus,
  EngageReply,
  EngageReplyCategory,
  EngageThreadMessage,
} from './engage.model';

type ProspectRow = typeof schema.prospects.$inferSelect;
type MessageRow = typeof schema.outreachMessages.$inferSelect;
type ClassificationRow = typeof schema.replyClassifications.$inferSelect;
type CampaignRow = typeof schema.campaigns.$inferSelect;

// verdict -> the 3-way Engage bucket (null = not a human-actionable reply, hidden).
const VERDICT_CATEGORY: Record<ReplyVerdict, EngageReplyCategory | null> = {
  INTERESTED: 'INTERESTED',
  MEETING_REQUEST: 'INTERESTED',
  UNSURE: 'UNSURE',
  NOT_INTERESTED: 'NOT_INTERESTED',
  SNOOZE: 'NOT_INTERESTED',
  AUTO_REPLY: null,
  BOUNCE: null,
};

function lifecycleStatus(lifecycle: CampaignRow['lifecycle']): EngageCampaignStatus {
  if (lifecycle === 'DRAFT') return 'NEW';
  if (lifecycle === 'ARCHIVED') return 'OVER';
  return 'IN_CAMPAIGN'; // ACTIVE | PAUSED
}

// Resolve the campaigns.sender handle ('info'|'hanna') to its full mailbox address.
// Prefer the org's DB-driven org_senders rows; fall back to the shared label map, then
// to the org domain so the inbox filter still groups unknown/legacy handles sensibly.
function resolveSenderEmail(sender: string, orgMap: Map<string, string>): string {
  return (
    orgMap.get(sender) ??
    CAMPAIGN_SENDER_LABELS[sender as keyof typeof CAMPAIGN_SENDER_LABELS] ??
    `${sender}@evertrust-germany.de`
  );
}

// Read model + writes for the Engage queue. Assembles replies from prospects +
// outreach_messages + reply_classifications; all reads are org-scoped via the prospect
// (the message/classification tables inherit tenancy from their parent prospect).
@Injectable()
export class EngageRepository {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // ---- campaign list (with reply counts) ----
  async listCampaigns(orgId: string): Promise<EngageCampaign[]> {
    const campaigns = await this.db
      .select()
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns))
      .orderBy(desc(schema.campaigns.createdAt));
    const active = campaigns.filter((c) => c.lifecycle !== 'ARCHIVED');
    if (active.length === 0) return [];

    const campaignIds = active.map((c) => c.id);
    const prospects = await this.db
      .select({ id: schema.prospects.id, campaignId: schema.prospects.campaignId })
      .from(schema.prospects)
      .where(inArray(schema.prospects.campaignId, campaignIds));
    const campaignByProspect = new Map(prospects.map((p) => [p.id, p.campaignId]));

    // A "reply" = a prospect with at least one classification row.
    const replyCounts = new Map<string, Set<string>>();
    if (prospects.length > 0) {
      const classified = await this.db
        .select({ prospectId: schema.replyClassifications.prospectId })
        .from(schema.replyClassifications)
        .where(
          inArray(
            schema.replyClassifications.prospectId,
            prospects.map((p) => p.id),
          ),
        );
      for (const row of classified) {
        const campaignId = campaignByProspect.get(row.prospectId);
        if (!campaignId) continue;
        if (!replyCounts.has(campaignId)) replyCounts.set(campaignId, new Set());
        replyCounts.get(campaignId)!.add(row.prospectId);
      }
    }

    const niches = await this.db
      .select({ id: schema.niches.id, name: schema.niches.name })
      .from(schema.niches)
      .where(inArray(schema.niches.id, [...new Set(active.map((c) => c.nicheId))]));
    const nicheName = new Map(niches.map((n) => [n.id, n.name]));
    const senderMap = await this.loadSenderEmailMap(orgId);

    return active.map((c) => ({
      id: c.id,
      name: c.name ?? c.project,
      niche: nicheName.get(c.nicheId) ?? '',
      region: c.region,
      replies: replyCounts.get(c.id)?.size ?? 0,
      status: lifecycleStatus(c.lifecycle),
      sender: c.sender,
      senderEmail: resolveSenderEmail(c.sender, senderMap),
    }));
  }

  // ---- replies for one campaign ----
  async findRepliesByCampaign(
    orgId: string,
    campaignId: string,
  ): Promise<EngageReply[]> {
    const campaign = await this.requireCampaign(orgId, campaignId);
    const prospects = await this.db
      .select()
      .from(schema.prospects)
      .where(
        and(
          tenantScope(orgId, schema.prospects),
          eq(schema.prospects.campaignId, campaignId),
        ),
      );
    if (prospects.length === 0) return [];
    const prospectIds = prospects.map((p) => p.id);

    const [messages, classifications] = await Promise.all([
      this.db
        .select()
        .from(schema.outreachMessages)
        .where(inArray(schema.outreachMessages.prospectId, prospectIds))
        .orderBy(schema.outreachMessages.createdAt),
      this.db
        .select()
        .from(schema.replyClassifications)
        .where(inArray(schema.replyClassifications.prospectId, prospectIds))
        .orderBy(desc(schema.replyClassifications.createdAt)),
    ]);

    const messagesByProspect = groupBy(messages, (m) => m.prospectId);
    const latestClassification = firstByKey(classifications, (c) => c.prospectId);
    const senderMap = await this.loadSenderEmailMap(orgId);
    const senderEmail = resolveSenderEmail(campaign.sender, senderMap);

    const out: EngageReply[] = [];
    for (const prospect of prospects) {
      const classification = latestClassification.get(prospect.id);
      if (!classification) continue; // not yet replied/classified
      const reply = this.assembleReply(
        prospect,
        classification,
        messagesByProspect.get(prospect.id) ?? [],
        campaign.sender,
        senderEmail,
      );
      if (reply) out.push(reply);
    }
    // Newest reply first (by receivedAt, falling back to classification time).
    return out.sort((a, b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? ''));
  }

  // ---- one reply (by prospectId) ----
  async findReplyByProspect(
    orgId: string,
    prospectId: string,
  ): Promise<EngageReply> {
    const prospect = await this.requireProspect(orgId, prospectId);
    const [messages, classifications, campaign] = await Promise.all([
      this.getMessages(prospectId),
      this.db
        .select()
        .from(schema.replyClassifications)
        .where(eq(schema.replyClassifications.prospectId, prospectId))
        .orderBy(desc(schema.replyClassifications.createdAt)),
      this.requireCampaign(orgId, prospect.campaignId),
    ]);
    const classification = classifications[0];
    if (!classification) {
      throw new NotFoundException('Reply not classified yet');
    }
    const senderMap = await this.loadSenderEmailMap(orgId);
    const reply = this.assembleReply(
      prospect,
      classification,
      messages,
      campaign.sender,
      resolveSenderEmail(campaign.sender, senderMap),
    );
    if (!reply) throw new NotFoundException('Reply not available');
    return reply;
  }

  async getThread(
    orgId: string,
    prospectId: string,
  ): Promise<EngageThreadMessage[]> {
    await this.requireProspect(orgId, prospectId);
    const messages = await this.getMessages(prospectId);
    return messages.map(toThreadMessage);
  }

  // ---- draft edit (update the latest classification's suggestedReply in place) ----
  async updateDraft(
    orgId: string,
    prospectId: string,
    subject: string,
    body: string,
  ): Promise<void> {
    await this.requireProspect(orgId, prospectId);
    const rows = await this.db
      .select()
      .from(schema.replyClassifications)
      .where(eq(schema.replyClassifications.prospectId, prospectId))
      .orderBy(desc(schema.replyClassifications.createdAt))
      .limit(1);
    const latest = rows[0];
    if (!latest) throw new NotFoundException('Reply not classified yet');
    const raw = (latest.raw ?? {}) as Record<string, unknown>;
    await this.db
      .update(schema.replyClassifications)
      .set({
        suggestedReply: body,
        raw: { ...raw, draft: { subject, body } } as never,
      })
      .where(eq(schema.replyClassifications.id, latest.id));
  }

  // Append the just-sent reply to the thread as an OUTBOUND SENT message, reusing the
  // conversation's existing Gmail thread id so it groups with the prior messages. Stamps
  // the real Gmail message id when one came back (test mode included). Also advances the
  // prospect's status to REPLIED so the queue reflects that we acted on it.
  async recordOutboundReply(
    orgId: string,
    prospectId: string,
    msg: { subject: string; body: string; gmailMessageId: string | null },
  ): Promise<void> {
    await this.requireProspect(orgId, prospectId);
    const existing = await this.getMessages(prospectId);
    const threadId =
      existing.find((m) => m.gmailThreadId)?.gmailThreadId ?? null;
    await this.db.insert(schema.outreachMessages).values({
      prospectId,
      direction: 'OUTBOUND',
      status: 'SENT',
      gmailMessageId: msg.gmailMessageId,
      gmailThreadId: threadId,
      subject: msg.subject,
      bodySnippet: msg.body,
      sentAt: new Date(),
    });
    await this.db
      .update(schema.prospects)
      .set({ status: 'REPLIED', updatedAt: new Date() })
      .where(
        and(
          tenantScope(orgId, schema.prospects),
          eq(schema.prospects.id, prospectId),
        ),
      );
  }

  // Ingest real inbound Gmail into the Engage queue, MATCH-KNOWN-PROSPECTS-ONLY: a message
  // is ingested only when its sender matches an existing prospect in the org (by email,
  // case-insensitive). Deduped by gmailMessageId (the unique index), so re-running is safe.
  // Matched inbound advances the prospect NEW/EMAILED -> REPLIED. Unknown senders are
  // ignored (no rogue prospect rows). Returns counts for the sync summary.
  async ingestInbound(
    orgId: string,
    messages: InboundMessage[],
  ): Promise<{ scanned: number; matched: number; ingested: number }> {
    if (messages.length === 0) return { scanned: 0, matched: 0, ingested: 0 };

    // Build a lowercased email -> prospect map from the org's prospects.
    const prospects = await this.db
      .select({ id: schema.prospects.id, email: schema.prospects.email, status: schema.prospects.status })
      .from(schema.prospects)
      .where(tenantScope(orgId, schema.prospects));
    const byEmail = new Map(
      prospects.map((p) => [p.email.toLowerCase(), p]),
    );

    const matched = messages.filter((m) => byEmail.has(m.fromEmail));
    if (matched.length === 0) {
      return { scanned: messages.length, matched: 0, ingested: 0 };
    }

    // Dedupe against already-stored Gmail message ids.
    const ids = matched.map((m) => m.gmailMessageId);
    const existing = await this.db
      .select({ gid: schema.outreachMessages.gmailMessageId })
      .from(schema.outreachMessages)
      .where(inArray(schema.outreachMessages.gmailMessageId, ids));
    const seen = new Set(existing.map((e) => e.gid));
    const fresh = matched.filter((m) => !seen.has(m.gmailMessageId));
    if (fresh.length === 0) {
      return { scanned: messages.length, matched: matched.length, ingested: 0 };
    }

    await this.db
      .insert(schema.outreachMessages)
      .values(
        fresh.map((m) => {
          const prospect = byEmail.get(m.fromEmail)!;
          return {
            prospectId: prospect.id,
            direction: 'INBOUND' as const,
            status: 'RECEIVED' as const,
            gmailMessageId: m.gmailMessageId,
            gmailThreadId: m.gmailThreadId,
            subject: m.subject,
            bodySnippet: m.snippet,
            sentAt: m.receivedAt,
          };
        }),
      )
      .onConflictDoNothing({ target: schema.outreachMessages.gmailMessageId });

    // Advance freshly-replied prospects (NEW/EMAILED -> REPLIED) so the queue reflects it.
    const toAdvance = [
      ...new Set(
        fresh
          .map((m) => byEmail.get(m.fromEmail)!)
          .filter((p) => p.status === 'NEW' || p.status === 'EMAILED')
          .map((p) => p.id),
      ),
    ];
    if (toAdvance.length > 0) {
      await this.db
        .update(schema.prospects)
        .set({ status: 'REPLIED', updatedAt: new Date() })
        .where(
          and(
            tenantScope(orgId, schema.prospects),
            inArray(schema.prospects.id, toAdvance),
          ),
        );
    }

    return {
      scanned: messages.length,
      matched: matched.length,
      ingested: fresh.length,
    };
  }

  // ---- accessors used by the service to build agent input ----
  async requireProspect(orgId: string, prospectId: string): Promise<ProspectRow> {
    const rows = await this.db
      .select()
      .from(schema.prospects)
      .where(
        and(
          tenantScope(orgId, schema.prospects),
          eq(schema.prospects.id, prospectId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Prospect not found');
    return row;
  }

  async getCampaign(orgId: string, campaignId: string): Promise<CampaignRow> {
    return this.requireCampaign(orgId, campaignId);
  }

  async nicheName(nicheId: string): Promise<string | null> {
    const rows = await this.db
      .select({ name: schema.niches.name })
      .from(schema.niches)
      .where(eq(schema.niches.id, nicheId))
      .limit(1);
    return rows[0]?.name ?? null;
  }

  async getMessages(prospectId: string): Promise<MessageRow[]> {
    return this.db
      .select()
      .from(schema.outreachMessages)
      .where(eq(schema.outreachMessages.prospectId, prospectId))
      .orderBy(schema.outreachMessages.createdAt);
  }

  async latestInbound(prospectId: string): Promise<MessageRow | null> {
    const rows = await this.getMessages(prospectId);
    const inbound = rows.filter((m) => m.direction === 'INBOUND');
    return inbound.at(-1) ?? null;
  }

  // Prospects in a campaign that have an INBOUND reply but NO classification yet
  // (the batch-classify backlog).
  async prospectsNeedingClassification(
    orgId: string,
    campaignId: string,
  ): Promise<ProspectRow[]> {
    await this.requireCampaign(orgId, campaignId);
    const prospects = await this.db
      .select()
      .from(schema.prospects)
      .where(
        and(
          tenantScope(orgId, schema.prospects),
          eq(schema.prospects.campaignId, campaignId),
        ),
      );
    if (prospects.length === 0) return [];
    const prospectIds = prospects.map((p) => p.id);
    const [messages, classifications] = await Promise.all([
      this.db
        .select({
          prospectId: schema.outreachMessages.prospectId,
          direction: schema.outreachMessages.direction,
        })
        .from(schema.outreachMessages)
        .where(inArray(schema.outreachMessages.prospectId, prospectIds)),
      this.db
        .select({ prospectId: schema.replyClassifications.prospectId })
        .from(schema.replyClassifications)
        .where(inArray(schema.replyClassifications.prospectId, prospectIds)),
    ]);
    const hasInbound = new Set(
      messages.filter((m) => m.direction === 'INBOUND').map((m) => m.prospectId),
    );
    const classified = new Set(classifications.map((c) => c.prospectId));
    return prospects.filter(
      (p) => hasInbound.has(p.id) && !classified.has(p.id),
    );
  }

  // ---- demo seed (3 classified replies into an existing campaign) ----
  async seedDemo(
    orgId: string,
    campaignId?: string,
  ): Promise<{ campaignId: string; created: number; skipped: number }> {
    const campaign = campaignId
      ? await this.requireCampaign(orgId, campaignId)
      : await this.firstCampaign(orgId);

    const now = Date.now();
    const demos = DEMO_REPLIES;
    let created = 0;
    let skipped = 0;

    for (const [i, demo] of demos.entries()) {
      // Upsert the prospect on (campaignId, email).
      await this.db
        .insert(schema.prospects)
        .values({
          organizationId: orgId,
          campaignId: campaign.id,
          email: demo.email,
          companyName: demo.company,
          city: demo.city,
          country: demo.country,
          emailVerified: true,
          status: demo.prospectStatus,
        })
        .onConflictDoNothing({
          target: [schema.prospects.campaignId, schema.prospects.email],
        });
      const prospectRows = await this.db
        .select()
        .from(schema.prospects)
        .where(
          and(
            eq(schema.prospects.campaignId, campaign.id),
            eq(schema.prospects.email, demo.email),
          ),
        )
        .limit(1);
      const prospect = prospectRows[0];
      if (!prospect) continue;

      // Idempotent: skip if this prospect already has a classification.
      const existing = await this.db
        .select({ id: schema.replyClassifications.id })
        .from(schema.replyClassifications)
        .where(eq(schema.replyClassifications.prospectId, prospect.id))
        .limit(1);
      if (existing[0]) {
        skipped++;
        continue;
      }

      const threadId = `demo-thread-${prospect.id}`;
      const sentOut = new Date(now - (demos.length - i) * 3_600_000 - 86_400_000);
      const sentIn = new Date(now - (demos.length - i) * 3_600_000);
      await this.db.insert(schema.outreachMessages).values([
        {
          prospectId: prospect.id,
          direction: 'OUTBOUND',
          status: 'SENT',
          gmailThreadId: threadId,
          subject: demo.outboundSubject,
          bodySnippet: demo.outboundBody,
          sentAt: sentOut,
        },
        {
          prospectId: prospect.id,
          direction: 'INBOUND',
          status: 'RECEIVED',
          gmailThreadId: threadId,
          subject: demo.inboundSubject,
          bodySnippet: demo.inboundBody,
          sentAt: sentIn,
        },
      ]);
      await this.db.insert(schema.replyClassifications).values({
        prospectId: prospect.id,
        verdict: demo.verdict,
        model: 'demo-seed',
        suggestedReply: demo.draftBody,
        raw: {
          source: 'demo-seed',
          status: demo.agentStatus,
          confidence: demo.confidence,
          reasoning: demo.reasoning,
          draft: { subject: demo.draftSubject, body: demo.draftBody },
        } as never,
      });
      created++;
    }
    return { campaignId: campaign.id, created, skipped };
  }

  // ---- helpers ----
  // org_senders (sender_key -> email) for an org, the DB-driven inbox list.
  private async loadSenderEmailMap(orgId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({
        key: schema.orgSenders.senderKey,
        email: schema.orgSenders.email,
      })
      .from(schema.orgSenders)
      .where(tenantScope(orgId, schema.orgSenders));
    return new Map(rows.map((r) => [r.key, r.email]));
  }

  private assembleReply(
    prospect: ProspectRow,
    classification: ClassificationRow,
    messages: MessageRow[],
    sender: string,
    senderEmail: string,
  ): EngageReply | null {
    const category = VERDICT_CATEGORY[classification.verdict];
    if (!category) return null; // AUTO_REPLY / BOUNCE — not in the queue

    const inbound = [...messages]
      .filter((m) => m.direction === 'INBOUND')
      .pop();
    const raw = (classification.raw ?? {}) as Record<string, unknown>;
    const rawDraft = (raw.draft ?? {}) as Record<string, unknown>;
    const inboundBody = inbound?.bodySnippet ?? '';
    const inboundSubject = inbound?.subject ?? '';
    const inboundTs = inbound?.sentAt ?? inbound?.createdAt ?? null;
    const receivedAt = inboundTs ? inboundTs.toISOString() : null;

    return {
      id: prospect.id,
      campaignId: prospect.campaignId,
      company: prospect.companyName ?? prospect.email,
      contact: prospect.email,
      recipientEmail: prospect.email,
      category,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : null,
      inboundSubject,
      inboundPreview: inboundBody.slice(0, 140),
      inboundBody,
      draftSubject:
        typeof rawDraft.subject === 'string' && rawDraft.subject
          ? rawDraft.subject
          : inboundSubject
            ? `Re: ${inboundSubject}`
            : '',
      draftBody: classification.suggestedReply ?? '',
      receivedAt,
      thread: messages.map(toThreadMessage),
      sender,
      senderEmail,
    };
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

  private async firstCampaign(orgId: string): Promise<CampaignRow> {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(tenantScope(orgId, schema.campaigns))
      .orderBy(desc(schema.campaigns.createdAt))
      .limit(1);
    const row = rows.find((c) => c.lifecycle !== 'ARCHIVED') ?? rows[0];
    if (!row) {
      throw new UnprocessableEntityException(
        'No campaign to seed into — create a campaign first, then seed demo replies.',
      );
    }
    return row;
  }
}

function toThreadMessage(m: MessageRow): EngageThreadMessage {
  return {
    id: m.id,
    direction: m.direction === 'INBOUND' ? 'inbound' : 'outbound',
    subject: m.subject ?? '',
    body: m.bodySnippet ?? '',
    sentAt: (m.sentAt ?? m.createdAt)?.toISOString() ?? null,
  };
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(item);
  }
  return out;
}

// First occurrence per key (the input is pre-sorted newest-first, so this is "latest").
function firstByKey<T, K>(items: T[], key: (item: T) => K): Map<K, T> {
  const out = new Map<K, T>();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, item);
  }
  return out;
}

// Demo replies seeded by POST /growth/engage/demo-seed — one per UI bucket.
const DEMO_REPLIES: Array<{
  email: string;
  company: string;
  city: string;
  country: string;
  prospectStatus: ProspectRow['status'];
  verdict: ReplyVerdict;
  agentStatus: string;
  confidence: number;
  reasoning: string;
  outboundSubject: string;
  outboundBody: string;
  inboundSubject: string;
  inboundBody: string;
  draftSubject: string;
  draftBody: string;
}> = [
  {
    email: 'demo.schmitz@hv-rheinland.example',
    company: 'HV Rheinland GmbH',
    city: 'Köln',
    country: 'Germany',
    prospectStatus: 'INTERESTED',
    verdict: 'INTERESTED',
    agentStatus: 'INTERESTED',
    confidence: 0.92,
    reasoning: 'Asks for a quote for 120 units — clear buying intent.',
    outboundSubject: '600W balcony solar kits',
    outboundBody:
      'Hello, we supply 600W balcony solar kits with tiered pricing for property portfolios from 100 units.',
    inboundSubject: 'Re: 600W balcony solar kits',
    inboundBody:
      'Interesting — could you send a quote for 120 units? Storage optional, please include delivery times.',
    draftSubject: 'Re: 600W balcony solar kits — next steps',
    draftBody:
      'Dear Mr. Schmitz,\n\nThank you for your interest. For 120 units we will prepare a tiered quote including delivery times. Would a short call on Thursday at 14:00 suit you?\n\nKind regards,\nEVERTRUST GmbH',
  },
  {
    email: 'demo.vogel@example-immo.example',
    company: 'Vogel Immobilien',
    city: 'Düsseldorf',
    country: 'Germany',
    prospectStatus: 'REPLIED',
    verdict: 'UNSURE',
    agentStatus: 'UNSURE',
    confidence: 0.55,
    reasoning: 'Asks a clarifying question with no clear buying intent yet.',
    outboundSubject: '600W balcony solar kits',
    outboundBody:
      'Hello, we supply 600W balcony solar kits with tiered pricing for property portfolios from 100 units.',
    inboundSubject: 'Re: 600W balcony solar kits',
    inboundBody:
      'What certifications do these kits carry, and are they compatible with existing balcony railings?',
    draftSubject: 'Re: 600W balcony solar kits — your questions',
    draftBody:
      'Dear Vogel Immobilien,\n\nGood questions. Our kits ship with the standard German certifications and mount on common balcony railings. Shall I send the spec sheet and arrange a short call?\n\nKind regards,\nEVERTRUST GmbH',
  },
  {
    email: 'demo.becker@example-hv.example',
    company: 'Becker Hausverwaltung',
    city: 'Essen',
    country: 'Germany',
    prospectStatus: 'NOT_INTERESTED',
    verdict: 'NOT_INTERESTED',
    agentStatus: 'UNINTERESTED',
    confidence: 0.88,
    reasoning: 'Asks to be removed — a hard opt-out.',
    outboundSubject: '600W balcony solar kits',
    outboundBody:
      'Hello, we supply 600W balcony solar kits with tiered pricing for property portfolios from 100 units.',
    inboundSubject: 'Re: 600W balcony solar kits',
    inboundBody:
      'No thank you, this is not relevant for us. Please remove us from your list.',
    draftSubject: 'Re: 600W balcony solar kits',
    draftBody:
      'Dear Becker Hausverwaltung,\n\nUnderstood — we have removed you from our list and will not contact you again. Thank you for letting us know.\n\nKind regards,\nEVERTRUST GmbH',
  },
];
