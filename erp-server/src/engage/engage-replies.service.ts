import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { DB, type DbClient } from '../db/db.tokens';
import { GoogleAccountsService } from '../google/google-accounts.service';
import { tenantScope } from '../common/tenant';
import { EngageAgentClient } from './engage.agent';
import { buildRawReply, extractPlainBody, parseFromAddress } from './engage.service';

// ===========================================================================
// Engage · CAMPAIGN-CENTRIC reply pipeline (reach_aims / reach_leads model).
// ---------------------------------------------------------------------------
// The reply-sorter UI is organised by CAMPAIGN. For each lead in a campaign we
// search the campaign's mailbox for the Gmail thread, run the reply_glock agent
// to CLASSIFY (INTERESTED | UNSURE | TEMPORARY | UNINTERESTED) and DRAFT a reply,
// and persist the result on `reach_lead_replies` (one row per aim+lead). The UI
// reads those rows instantly; classification is slow (~35s/lead on local Hermes),
// so it runs in the scan, not on page-load.
//
// scanCampaign : search each lead's thread, classify + draft via reply_glock, upsert.
// listReplies  : the persisted, classified replies for a campaign (fast read).
// saveDraft    : persist an edited draft.
// sendReply    : send the (edited) draft via the campaign mailbox, threaded.
// ===========================================================================

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GMAIL_SEND_URL = `${GMAIL_API}/messages/send`;
const THREAD_BODY_MAX = 4000;

// reply_glock status -> the UI's display category. TEMPORARY surfaces as its own
// "Temp" bucket; UNINTERESTED maps onto the UI's "NOT INTERESTED" chip.
const UI_CATEGORY: Record<string, string> = {
  INTERESTED: 'INTERESTED',
  UNSURE: 'UNSURE',
  TEMPORARY: 'TEMP',
  UNINTERESTED: 'NOT INTERESTED',
};

interface ThreadMsg {
  id: string;
  threadId: string | null;
  direction: 'inbound' | 'outbound';
  fromName: string | null;
  fromEmail: string | null;
  toEmail: string | null;
  subject: string | null;
  body: string;
  rfc822MessageId: string | null;
  internalMs: number;
}

export interface CampaignScanResult {
  configured: boolean;
  scanned: number;
  classified: number;
  byCategory: Record<string, number>;
  skipped: number;
  reason: string | null;
}

@Injectable()
export class EngageRepliesService {
  private readonly logger = new Logger(EngageRepliesService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly googleAccounts: GoogleAccountsService,
    private readonly agent: EngageAgentClient,
  ) {}

  // Resolve the campaign + the mailbox account it sends from (sender local-part ==
  // google_accounts email local-part). Returns null when the aim is not in the org.
  private async resolveCampaign(orgId: string, aimId: string) {
    const rows = await this.db
      .select()
      .from(schema.reachAims)
      .where(and(tenantScope(orgId, schema.reachAims), eq(schema.reachAims.id, aimId)))
      .limit(1);
    const aim = rows[0];
    if (!aim) return null;

    const accounts = await this.db
      .select({ id: schema.googleAccounts.id, email: schema.googleAccounts.email })
      .from(schema.googleAccounts)
      .where(eq(schema.googleAccounts.organizationId, orgId));
    const mailbox = accounts.find(
      (a) => (a.email.split('@')[0] ?? '').toLowerCase() === aim.sender.toLowerCase(),
    );
    return { aim, mailboxAccountId: mailbox?.id ?? null };
  }

  // --- SCAN -----------------------------------------------------------------
  // For each lead with a Gmail thread: classify + draft via reply_glock, persist.
  async scanCampaign(orgId: string, aimId: string): Promise<CampaignScanResult> {
    const empty: CampaignScanResult = {
      configured: false,
      scanned: 0,
      classified: 0,
      byCategory: {},
      skipped: 0,
      reason: null,
    };

    const resolved = await this.resolveCampaign(orgId, aimId);
    if (!resolved) throw new BadRequestException('Unknown campaign');
    const { aim, mailboxAccountId } = resolved;

    const access = await this.googleAccounts.resolveMailboxForAccount(
      orgId,
      mailboxAccountId,
      'gmail-read',
    );
    if (!access.ok) return { ...empty, reason: access.reason };
    const token = access.accessToken;
    const selfEmail = access.account.email.toLowerCase();

    const leads = await this.db
      .select({
        id: schema.reachLeads.id,
        company: schema.reachLeads.company,
        email: schema.reachLeads.email,
        contactName: schema.reachLeads.contactName,
      })
      .from(schema.reachLeads)
      .where(and(tenantScope(orgId, schema.reachLeads), eq(schema.reachLeads.aimId, aimId)));

    const byCategory: Record<string, number> = {};
    let scanned = 0;
    let classified = 0;
    let skipped = 0;

    for (const lead of leads) {
      const email = lead.email?.trim().toLowerCase();
      if (!email) {
        skipped++;
        continue;
      }
      scanned++;
      try {
        const thread = await this.fetchThread(token, selfEmail, email);
        const inbound = [...thread].reverse().find((m) => m.direction === 'inbound');
        if (!inbound) {
          skipped++;
          continue; // no reply from this lead yet
        }

        const out = await this.classifyAndDraft(aim, lead, inbound, thread);
        if (!out) {
          skipped++;
          continue;
        }
        byCategory[out.status] = (byCategory[out.status] ?? 0) + 1;
        classified++;
        await this.upsertReply(orgId, aimId, lead.id, inbound, thread, lead.company, out);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Engage scanCampaign lead ${lead.id} failed: ${msg}`);
        skipped++;
      }
    }

    return { configured: true, scanned, classified, byCategory, skipped, reason: null };
  }

  // Call reply_glock for one inbound reply; returns its parsed output (or null).
  private async classifyAndDraft(
    aim: typeof schema.reachAims.$inferSelect,
    lead: { company: string; email: string | null; contactName: string | null },
    inbound: ThreadMsg,
    thread: ThreadMsg[],
  ): Promise<{
    status: string;
    confidence: number;
    reasoning: string;
    recommendedAction: string;
    draftSubject: string;
    draftBody: string;
    followUpWindow: string | null;
  } | null> {
    const input = {
      reply_id: `${aim.id}:${inbound.id}`,
      campaign_id: aim.id,
      sender_name: lead.contactName ?? lead.company,
      sender_email: lead.email ?? '',
      company: lead.company,
      subject: inbound.subject ?? '(no subject)',
      body: inbound.body.slice(0, THREAD_BODY_MAX),
      received_at: new Date(inbound.internalMs).toISOString(),
      previous_thread: thread
        .filter((m) => m.id !== inbound.id)
        .map((m) => ({
          direction: m.direction,
          from_name: m.fromName,
          from_email: m.fromEmail,
          to_email: m.toEmail,
          subject: m.subject ?? '',
          body: m.body.slice(0, THREAD_BODY_MAX),
          timestamp: new Date(m.internalMs).toISOString(),
        })),
      campaign_context: {
        campaign_id: aim.id,
        campaign_name: aim.name,
        product_or_service: `EVERTRUST partnership for ${aim.niche} providers — scale capacity and cut overhead`,
        offer: 'A short 15-minute intro call',
        sender_name: 'Hanna Nguyen',
        sender_company: 'EVERTRUST GmbH',
        sender_signature: 'Hanna Nguyen\nEVERTRUST GmbH',
      },
    };

    const result = await this.agent.run('engage.reply_glock', input);
    const o = result.output as Record<string, unknown>;
    const draft = (o.draft ?? {}) as Record<string, unknown>;
    const status = String(o.status ?? 'UNSURE').toUpperCase();
    return {
      status: status in UI_CATEGORY ? status : 'UNSURE',
      confidence: typeof o.confidence === 'number' ? o.confidence : 0,
      reasoning: String(o.reasoning ?? ''),
      recommendedAction: String(o.recommended_action ?? 'MANUAL_REVIEW'),
      draftSubject: String(draft.subject ?? inbound.subject ?? ''),
      draftBody: String(draft.body ?? ''),
      followUpWindow:
        typeof o.follow_up_date_or_window === 'string' ? o.follow_up_date_or_window : null,
    };
  }

  // Upsert one classified reply (idempotent on aim+lead).
  private async upsertReply(
    orgId: string,
    aimId: string,
    leadId: string,
    inbound: ThreadMsg,
    thread: ThreadMsg[],
    company: string,
    out: {
      status: string;
      confidence: number;
      reasoning: string;
      recommendedAction: string;
      draftSubject: string;
      draftBody: string;
      followUpWindow: string | null;
    },
  ): Promise<void> {
    const uiThread = thread.map((m) => ({
      id: m.id,
      direction: m.direction,
      header:
        m.direction === 'inbound'
          ? `${company.toUpperCase()} → EVERTRUST`
          : `EVERTRUST → ${company.toUpperCase()}`,
      subject: m.subject ?? '(no subject)',
      body: m.body,
      rfc822MessageId: m.rfc822MessageId,
    }));

    const values = {
      organizationId: orgId,
      aimId,
      leadId,
      gmailThreadId: inbound.threadId,
      category: out.status,
      confidence: out.confidence,
      reasoning: out.reasoning,
      recommendedAction: out.recommendedAction,
      inboundSubject: inbound.subject ?? null,
      inboundBody: inbound.body.slice(0, THREAD_BODY_MAX),
      draftSubject: out.draftSubject,
      draftBody: out.draftBody,
      draftSource: 'reply_glock',
      thread: uiThread as never,
      followUpWindow: out.followUpWindow,
      classifiedAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db
      .insert(schema.reachLeadReplies)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.reachLeadReplies.aimId, schema.reachLeadReplies.leadId],
        set: {
          gmailThreadId: values.gmailThreadId,
          category: values.category,
          confidence: values.confidence,
          reasoning: values.reasoning,
          recommendedAction: values.recommendedAction,
          inboundSubject: values.inboundSubject,
          inboundBody: values.inboundBody,
          draftSubject: values.draftSubject,
          draftBody: values.draftBody,
          draftSource: values.draftSource,
          thread: values.thread,
          followUpWindow: values.followUpWindow,
          classifiedAt: values.classifiedAt,
          updatedAt: values.updatedAt,
        },
      });
  }

  // --- LIST -----------------------------------------------------------------
  // The persisted, classified replies for a campaign, mapped to the reply-sorter
  // shape (category, draft, thread). Fast read — no Gmail / no LLM.
  async listReplies(orgId: string, aimId: string) {
    const rows = await this.db
      .select({
        r: schema.reachLeadReplies,
        company: schema.reachLeads.company,
        email: schema.reachLeads.email,
      })
      .from(schema.reachLeadReplies)
      .innerJoin(schema.reachLeads, eq(schema.reachLeadReplies.leadId, schema.reachLeads.id))
      .where(and(tenantScope(orgId, schema.reachLeadReplies), eq(schema.reachLeadReplies.aimId, aimId)))
      .orderBy(asc(schema.reachLeads.company));

    return rows.map(({ r, company, email }) => ({
      id: r.id,
      campaignId: aimId,
      company,
      contact: email ?? '',
      category: UI_CATEGORY[r.category] ?? 'UNSURE',
      rawCategory: r.category,
      confidence: r.confidence ?? 0,
      reasoning: r.reasoning ?? '',
      recommendedAction: r.recommendedAction ?? null,
      inboundPreview: (r.inboundBody ?? '').slice(0, 160),
      inboundBody: r.inboundBody ?? '',
      draftSubject: r.draftSubject ?? '',
      draftBody: r.draftBody ?? '',
      draftSource: r.draftSource ?? null,
      citations: (r.citations as string[] | null) ?? [],
      followUpWindow: r.followUpWindow ?? null,
      handled: r.handled,
      thread: r.thread ?? [],
      time: r.classifiedAt.toISOString(),
    }));
  }

  // --- SAVE DRAFT -----------------------------------------------------------
  async saveDraft(orgId: string, replyId: string, subject: string, body: string) {
    const row = await this.ownedReply(orgId, replyId);
    await this.db
      .update(schema.reachLeadReplies)
      .set({ draftSubject: subject, draftBody: body, updatedAt: new Date() })
      .where(eq(schema.reachLeadReplies.id, row.id));
    return { ok: true };
  }

  // --- SEND -----------------------------------------------------------------
  // Send the (edited) draft to the lead via the campaign mailbox, threaded onto the
  // existing Gmail thread (In-Reply-To the last inbound message). Marks handled.
  async sendReply(orgId: string, replyId: string, subject: string, body: string) {
    const row = await this.ownedReply(orgId, replyId);
    const lead = (
      await this.db
        .select({ email: schema.reachLeads.email })
        .from(schema.reachLeads)
        .where(eq(schema.reachLeads.id, row.leadId))
        .limit(1)
    )[0];
    if (!lead?.email) throw new BadRequestException('Lead has no email to reply to.');

    const resolved = await this.resolveCampaign(orgId, row.aimId);
    const access = await this.googleAccounts.resolveMailboxForAccount(
      orgId,
      resolved?.mailboxAccountId ?? null,
      'gmail',
    );
    if (!access.ok) throw new BadRequestException(access.reason);

    // Thread onto the lead's last inbound message (In-Reply-To / References).
    const thread = (row.thread as { direction: string; rfc822MessageId: string | null }[] | null) ?? [];
    const lastInbound = [...thread].reverse().find((m) => m.direction === 'inbound');
    const inReplyTo = lastInbound?.rfc822MessageId ?? null;

    const raw = buildRawReply({
      to: lead.email,
      from: access.account.email,
      subject: subject || row.inboundSubject || '(no subject)',
      body,
      inReplyTo,
      references: inReplyTo,
    });

    const res = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw, ...(row.gmailThreadId ? { threadId: row.gmailThreadId } : {}) }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new BadRequestException(`Gmail send HTTP ${res.status}: ${t.slice(0, 200)}`);
    }

    await this.db
      .update(schema.reachLeadReplies)
      .set({ handled: true, sentAt: new Date(), draftBody: body, draftSubject: subject, updatedAt: new Date() })
      .where(eq(schema.reachLeadReplies.id, row.id));

    return { ok: true };
  }

  // Load a reply row, asserting it belongs to the calling org.
  private async ownedReply(orgId: string, replyId: string) {
    const rows = await this.db
      .select()
      .from(schema.reachLeadReplies)
      .where(and(tenantScope(orgId, schema.reachLeadReplies), eq(schema.reachLeadReplies.id, replyId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new BadRequestException('Unknown reply');
    return row;
  }

  // Fetch the full Gmail conversation with a lead (sent + received), parsed to the
  // fields reply_glock and the UI need. Uses gmail.readonly `q` (admin has it).
  private async fetchThread(
    token: string,
    selfEmail: string,
    leadEmail: string,
  ): Promise<ThreadMsg[]> {
    const q = encodeURIComponent(`from:${leadEmail} OR to:${leadEmail}`);
    const listRes = await fetch(`${GMAIL_API}/messages?maxResults=25&q=${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) {
      throw new Error(`Gmail list HTTP ${listRes.status}`);
    }
    const list = (await listRes.json()) as { messages?: { id?: string }[] };
    const ids = (list.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);

    const msgs: ThreadMsg[] = [];
    for (const id of ids) {
      const r = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) continue;
      const m = (await r.json()) as {
        id?: string;
        threadId?: string;
        internalDate?: string;
        snippet?: string;
        payload?: { headers?: { name?: string; value?: string }[] };
      };
      const headers = m.payload?.headers ?? [];
      const hv = (n: string) =>
        headers.find((h) => (h.name ?? '').toLowerCase() === n.toLowerCase())?.value ?? null;
      const from = parseFromAddress(hv('From'));
      const fromEmail = from.email ?? '';
      const direction: 'inbound' | 'outbound' =
        fromEmail && fromEmail === leadEmail ? 'inbound' : 'outbound';
      msgs.push({
        id: m.id ?? id,
        threadId: m.threadId ?? null,
        direction,
        fromName: from.name,
        fromEmail: from.email,
        toEmail: parseFromAddress(hv('To')).email,
        subject: hv('Subject'),
        body: extractPlainBody(m.payload as never) || (m.snippet ?? ''),
        rfc822MessageId: hv('Message-ID'),
        internalMs: m.internalDate ? Number(m.internalDate) : 0,
      });
    }
    msgs.sort((a, b) => a.internalMs - b.internalMs);
    return msgs;
  }
}
