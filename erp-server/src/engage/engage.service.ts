import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { z } from 'zod';
import type {
  ConnectedGoogleAccountDto,
  EngageReplyDto,
  EngageReplyListDto,
  EngageScanResultDto,
  ReplyVerdict,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { GoogleAccountsService } from '../google/google-accounts.service';
import { GoogleGmailService } from '../google/google-gmail.service';
import { ClaudeService } from '../ai/claude.service';
import { tenantScope } from '../common/tenant';
import { writeMachineAudit } from '../common/machine-audit';

// ===========================================================================
// Engage · ERP-DIRECT Gmail reply pipeline (NO n8n, NO external Python agent).
// ---------------------------------------------------------------------------
// scan(orgId)  : read the org's connected default Gmail, find recent replies,
//                match each to an org prospect by sender email, upsert the
//                inbound into outreach_messages (idempotent on Gmail message id),
//                classify it with the ERP's own Claude into a ReplyVerdict, and
//                draft a suggested reply (INTERESTED/UNSURE) — all persisted on
//                the EXISTING reply_classifications + outreach_messages tables.
// list(orgId)  : the Engage review queue — classified replies that carry a
//                drafted suggestion OR are UNSURE, joined with prospect context.
// send(orgId,…): send an approved reply via the SAME connected Gmail account
//                (gmail.send, RFC822 + In-Reply-To/References threading), record
//                the OUTBOUND outreach_message, mark the classification handled.
//
// AUTH MODEL (per-org only): every Gmail call resolves the CALLING org's default
// mailbox via GoogleAccountsService.getAccessTokenForOrg(orgId,'gmail') and uses
// that account's live access token — a tenant only ever touches its OWN mailbox.
//
// NEVER-THROW CONTRACT (scan/list): no default mailbox, no AI key, a non-2xx
// Gmail/Anthropic response, a network error or a bad body all degrade to a
// `configured: false` / empty shell, logged at warn. The pages never 500.
// send() is the one mutating path that DOES surface errors (400 when the
// classification is not in the org; a clean error string on a Gmail send fail).
// ===========================================================================

// gmail.metadata is a SENSITIVE (not restricted) scope: it returns headers + the
// Gmail snippet but NO body, and it FORBIDS the `q` search param on messages.list.
// So we list by the INBOX label, fetch format=metadata, and filter to recent replies
// client-side. Engage triages on subject + snippet only (weaker, but zero CASA audit).
const INBOX_LABEL = 'INBOX';
const LIST_MAX = 60; // INBOX list cap (filtered down client-side)
const LOOKBACK_DAYS = 14; // only consider replies this recent
const MAX_MESSAGES = 25; // process cap after filtering
const SNIPPET_MAX = 280;
const BODY_MAX = 8000;

const GMAIL_LIST_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const GMAIL_GET_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const GMAIL_SEND_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// The only verdicts Engage classification produces (a subset of ReplyVerdict).
// UNSURE is the human-review fallback; INTERESTED/UNSURE get a drafted reply.
const ENGAGE_VERDICTS = ['INTERESTED', 'UNSURE', 'NOT_INTERESTED'] as const;
type EngageVerdict = (typeof ENGAGE_VERDICTS)[number];

// Minimal shapes of the Gmail REST responses we depend on.
interface GmailListResponse {
  messages?: { id?: string; threadId?: string }[];
}
interface GmailHeader {
  name?: string;
  value?: string;
}
interface GmailPart {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

// A reply parsed down to the fields Engage needs — the unit-test surface.
export interface ParsedReply {
  gmailMessageId: string;
  gmailThreadId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  body: string;
  rfc822MessageId: string | null;
  references: string | null;
  receivedAt: Date;
}

// ---------------------------------------------------------------------------
// PURE helpers (no Nest, no network) — exported for unit tests.
// ---------------------------------------------------------------------------

// Decode Gmail's base64url (URL-safe alphabet, no padding) body data to UTF-8.
export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

// A header value lookup (case-insensitive) over a Gmail part's headers.
function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const lower = name.toLowerCase();
  for (const h of headers ?? []) {
    if ((h.name ?? '').toLowerCase() === lower) return h.value ?? null;
  }
  return null;
}

// Walk the MIME tree and return the first text/plain body (decoded). Falls back
// to stripping tags from the first text/html part when there is no plain text.
export function extractPlainBody(payload: GmailPart | undefined): string {
  if (!payload) return '';

  const plain = findPart(payload, 'text/plain');
  if (plain?.body?.data) return decodeBase64Url(plain.body.data).trim();

  const html = findPart(payload, 'text/html');
  if (html?.body?.data) {
    return decodeBase64Url(html.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  // No multipart: a single-part body carried directly on the payload.
  if (payload.body?.data) return decodeBase64Url(payload.body.data).trim();
  return '';
}

// Depth-first search for the first part matching a mime type.
function findPart(part: GmailPart, mimeType: string): GmailPart | null {
  if ((part.mimeType ?? '').toLowerCase() === mimeType) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

// Pull the bare lowercased email address out of a "Name <addr@x>" header value.
export function parseFromAddress(from: string | null): {
  email: string | null;
  name: string | null;
} {
  if (!from) return { email: null, name: null };
  const angled = from.match(/<([^>]+)>/);
  const email = (angled?.[1] ?? from).trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  let name: string | null = null;
  if (angled) {
    name = from.slice(0, from.indexOf('<')).trim().replace(/^"|"$/g, '') || null;
  }
  return { email: valid ? email : null, name };
}

// Turn a full Gmail message (format=full) into the fields Engage needs. PURE —
// the unit test feeds a fixture payload and asserts {from,subject,body}.
export function parseGmailMessage(msg: GmailMessage): ParsedReply | null {
  if (!msg.id) return null;
  const headers = msg.payload?.headers;
  const { email, name } = parseFromAddress(headerValue(headers, 'From'));
  const internalMs = msg.internalDate ? Number(msg.internalDate) : NaN;
  return {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId ?? null,
    fromEmail: email,
    fromName: name,
    subject: headerValue(headers, 'Subject'),
    // metadata format carries no body payload — fall back to the Gmail snippet, which
    // is the Engage triage surface (subject + snippet).
    body: extractPlainBody(msg.payload) || (msg.snippet ?? '').trim(),
    rfc822MessageId: headerValue(headers, 'Message-ID'),
    references: headerValue(headers, 'References'),
    receivedAt: Number.isFinite(internalMs) ? new Date(internalMs) : new Date(),
  };
}

// Build a base64url-encoded RFC822 message for users.messages.send, threading the
// reply via In-Reply-To/References. PURE — exported for unit tests.
export function buildRawReply(args: {
  to: string;
  from: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string | null;
}): string {
  const subject = /^(re:|aw:)/i.test(args.subject.trim())
    ? args.subject
    : `Re: ${args.subject}`;
  // RFC2047-encode the Subject so non-ASCII (em dashes, umlauts) survive the header
  // (a raw UTF-8 subject is mangled into mojibake by mail transport).
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const lines = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${encodedSubject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (args.inReplyTo) lines.push(`In-Reply-To: ${args.inReplyTo}`);
  // References = prior chain + the message we're replying to (RFC 5322 §3.6.4).
  const refs = [args.references, args.inReplyTo].filter(Boolean).join(' ').trim();
  if (refs) lines.push(`References: ${refs}`);
  const raw = `${lines.join('\r\n')}\r\n\r\n${args.body}`;
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Coerce any string into one of the three Engage verdicts (defensive — Claude is
// schema-forced to these, but a stray value degrades to UNSURE for human review).
export function normalizeVerdict(value: string): EngageVerdict {
  const upper = value.toUpperCase();
  return (ENGAGE_VERDICTS as readonly string[]).includes(upper)
    ? (upper as EngageVerdict)
    : 'UNSURE';
}

// Reply-subject test (Re:/AW: prefix, case-insensitive). Replaces the server-side `q`
// filter, which the gmail.metadata scope does not permit. Exported for unit tests.
export function isReplySubject(subject: string | null): boolean {
  return !!subject && /^\s*(re|aw)\s*:/i.test(subject);
}

@Injectable()
export class EngageService {
  private readonly logger = new Logger(EngageService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly googleAccounts: GoogleAccountsService,
    private readonly gmail: GoogleGmailService,
    private readonly claude: ClaudeService,
  ) {}

  // --- CAMPAIGN → LEAD FOLDER → THREADS (the campaign-scoped inbox model) -----
  // Engage is organised by CAMPAIGN (a Reach AIM), each of which owns a lead folder
  // (reach_leads). Each lead carries a client email; we search the campaign's mailbox
  // for the threads with that email. These three methods back that flow.

  // The org's campaigns (Reach AIMs) with their lead count and the connected mailbox
  // they send from (sender 'info'|'hanna' -> the google_accounts row whose email
  // local-part matches), so the client can scope the inbox search to the campaign.
  async listCampaigns(orgId: string) {
    const aims = await this.db
      .select({
        aimId: schema.reachAims.id,
        name: schema.reachAims.name,
        niche: schema.reachAims.niche,
        region: schema.reachAims.region,
        sender: schema.reachAims.sender,
        status: schema.reachAims.status,
      })
      .from(schema.reachAims)
      .where(tenantScope(orgId, schema.reachAims))
      .orderBy(desc(schema.reachAims.createdAt));

    const counts = await this.db
      .select({ aimId: schema.reachLeads.aimId, n: count() })
      .from(schema.reachLeads)
      .where(tenantScope(orgId, schema.reachLeads))
      .groupBy(schema.reachLeads.aimId);
    const countByAim = new Map(counts.map((c) => [c.aimId, Number(c.n)]));

    const accounts = await this.db
      .select({ id: schema.googleAccounts.id, email: schema.googleAccounts.email })
      .from(schema.googleAccounts)
      .where(eq(schema.googleAccounts.organizationId, orgId));
    const accByLocalPart = new Map(
      accounts.map((a) => [a.email.split('@')[0]?.toLowerCase() ?? '', a]),
    );

    return aims.map((a) => {
      const mailbox = accByLocalPart.get(a.sender.toLowerCase());
      return {
        aimId: a.aimId,
        name: a.name,
        niche: a.niche,
        region: a.region,
        sender: a.sender,
        status: a.status,
        leadCount: countByAim.get(a.aimId) ?? 0,
        mailboxAccountId: mailbox?.id ?? null,
        mailboxEmail: mailbox?.email ?? null,
      };
    });
  }

  // The lead folder for a campaign: each lead's company + client email (+ context).
  // Org-scoped AND aim-scoped; alphabetical by company.
  async listCampaignLeads(orgId: string, aimId: string) {
    return this.db
      .select({
        id: schema.reachLeads.id,
        company: schema.reachLeads.company,
        email: schema.reachLeads.email,
        contactName: schema.reachLeads.contactName,
        contactTitle: schema.reachLeads.contactTitle,
        website: schema.reachLeads.website,
        location: schema.reachLeads.location,
        status: schema.reachLeads.status,
      })
      .from(schema.reachLeads)
      .where(
        and(
          tenantScope(orgId, schema.reachLeads),
          eq(schema.reachLeads.aimId, aimId),
        ),
      )
      .orderBy(asc(schema.reachLeads.company));
  }

  // The Gmail threads (messages) to/from a lead's client email, searched in the
  // campaign's mailbox (accountId) or the org default. Delegates to the Gmail
  // service's gmail.readonly `q` search; never throws.
  searchLeadThreads(orgId: string, email: string, accountId?: string) {
    return this.gmail.searchByEmail(orgId, email, accountId ?? null);
  }

  // --- ACCOUNTS -------------------------------------------------------------
  // The org's connected Google mailboxes — the data source for the inbox account
  // switcher. A central operator picks one of these as the `accountId` passed to
  // scan/list/send to view/act on that colleague's inbox (subject to the account
  // having signed in and granted Gmail access).
  listAccounts(orgId: string): Promise<ConnectedGoogleAccountDto[]> {
    return this.googleAccounts.listForOrg(orgId);
  }

  // --- SCAN -----------------------------------------------------------------
  // Read recent Gmail replies, match to org prospects, persist + classify +
  // draft. Never throws — degrades to `configured: false` with zero counters.
  async scan(orgId: string, accountId?: string): Promise<EngageScanResultDto> {
    const empty: EngageScanResultDto = {
      configured: false,
      scanned: 0,
      interested: 0,
      unsure: 0,
      notInterested: 0,
      drafted: 0,
      reason: null,
    };

    const access = await this.googleAccounts.resolveMailboxForAccount(orgId, accountId, 'gmail');
    if (!access.ok) return { ...empty, reason: access.reason };
    const perOrg = access;
    const token = perOrg.accessToken;

    try {
      // 1) List recent INBOX messages (metadata scope forbids the `q` param); reply +
      //    recency filtering happens client-side below.
      const listParams = new URLSearchParams({
        labelIds: INBOX_LABEL,
        maxResults: String(LIST_MAX),
      });
      const listRes = await fetch(`${GMAIL_LIST_URL}?${listParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!listRes.ok) {
        this.logger.warn(
          `Engage Gmail list HTTP ${listRes.status} for org ${orgId} — scan skipped`,
        );
        return {
          ...empty,
          reason: `Gmail API error (HTTP ${listRes.status}). Reconnect the account and allow Gmail access.`,
        };
      }
      const list = (await listRes.json()) as GmailListResponse;
      const ids = (list.messages ?? [])
        .map((m) => m.id)
        .filter((id): id is string => !!id)
        .slice(0, LIST_MAX);

      // Per-org config: AI model preference (null → env ANTHROPIC_MODEL).
      const model = await this.resolveAiModel(orgId);
      const selfEmail = perOrg.account.email.toLowerCase();

      const counters = { scanned: 0, interested: 0, unsure: 0, notInterested: 0, drafted: 0 };
      const cutoffMs = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60_000;

      for (const id of ids) {
        if (counters.scanned >= MAX_MESSAGES) break; // process cap (after filtering)
        const parsed = await this.fetchMessage(token, id);
        if (!parsed || !parsed.fromEmail) continue;
        if (parsed.fromEmail === selfEmail) continue; // never classify our own mail
        if (!isReplySubject(parsed.subject)) continue; // replies only (no server q under metadata)
        if (parsed.receivedAt.getTime() < cutoffMs) continue; // within the lookback window

        // Match a prospect by sender email, ORG-SCOPED. No match → skip (the
        // ledger + verdict log require a non-null prospectId; we never fabricate).
        const prospect = await this.matchProspect(orgId, parsed.fromEmail);
        if (!prospect) continue;
        counters.scanned++;

        // 2) Upsert the inbound message (idempotent on Gmail message id).
        const message = await this.upsertInbound(orgId, prospect.id, parsed);

        // 3) Classify via the ERP's own Claude.
        const verdict = await this.classify(parsed, model);
        if (verdict.classification === 'INTERESTED') counters.interested++;
        else if (verdict.classification === 'NOT_INTERESTED') counters.notInterested++;
        else counters.unsure++;

        // 4) Draft a suggested reply for INTERESTED/UNSURE.
        let suggestedReply: string | null = null;
        if (
          verdict.classification === 'INTERESTED' ||
          verdict.classification === 'UNSURE'
        ) {
          suggestedReply = await this.draft(orgId, parsed, model);
          if (suggestedReply) counters.drafted++;
        }

        // 5) Write/refresh the verdict row (idempotent on this inbound message).
        await this.upsertClassification(orgId, prospect.id, message.id, {
          verdict: verdict.classification,
          reason: verdict.reason,
          model,
          suggestedReply,
        });
      }

      return { configured: true, ...counters, reason: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Engage scan failed for org ${orgId}: ${msg}`);
      return {
        ...empty,
        reason: 'Could not reach Gmail. Try again, or reconnect the account.',
      };
    }
  }

  // --- LIST -----------------------------------------------------------------
  // The Engage review queue: classification rows that carry a drafted reply OR
  // are UNSURE, ORG-SCOPED via the parent prospect, newest-first. Never throws.
  async list(orgId: string, accountId?: string): Promise<EngageReplyListDto> {
    let account: { email: string } | null = null;
    let reason: string | null = null;
    try {
      const access = await this.googleAccounts.resolveMailboxForAccount(orgId, accountId, 'gmail');
      if (access.ok) account = { email: access.account.email };
      else reason = access.reason;

      // Org-scoped: only this org's prospects, then their classification rows.
      const prospects = await this.db
        .select({
          id: schema.prospects.id,
          email: schema.prospects.email,
          companyName: schema.prospects.companyName,
        })
        .from(schema.prospects)
        .where(eq(schema.prospects.organizationId, orgId));
      if (prospects.length === 0) {
        return { configured: account !== null, account, replies: [], reason };
      }
      const byId = new Map(prospects.map((p) => [p.id, p]));
      const prospectIds = prospects.map((p) => p.id);

      const rows = await this.db
        .select()
        .from(schema.replyClassifications)
        .where(inArray(schema.replyClassifications.prospectId, prospectIds))
        .orderBy(desc(schema.replyClassifications.createdAt));

      // The queue surface: a drafted suggestion to approve, or an UNSURE row a
      // human must triage. (NOT_INTERESTED with no draft is evidence, not queue.)
      const queue = rows.filter(
        (r) => r.suggestedReply != null || r.verdict === 'UNSURE',
      );

      // Resolve the inbound message context (subject/snippet/from) per row.
      const messageIds = queue
        .map((r) => r.messageId)
        .filter((m): m is string => !!m);
      const messages = messageIds.length
        ? await this.db
            .select()
            .from(schema.outreachMessages)
            .where(inArray(schema.outreachMessages.id, messageIds))
        : [];
      const msgById = new Map(messages.map((m) => [m.id, m]));

      const replies: EngageReplyDto[] = queue.map((r) => {
        const prospect = byId.get(r.prospectId);
        const message = r.messageId ? msgById.get(r.messageId) : undefined;
        const reason = parseReason(r.raw);
        return {
          id: r.id,
          prospectId: r.prospectId,
          fromEmail: prospect?.email ?? '',
          company: prospect?.companyName ?? null,
          subject: message?.subject ?? null,
          snippet: message?.bodySnippet ?? null,
          classification: r.verdict,
          reason,
          suggestedReply: r.suggestedReply,
          receivedAt: (message?.sentAt ?? r.createdAt).toISOString(),
        };
      });

      return { configured: account !== null, account, replies, reason };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Engage list failed for org ${orgId}: ${msg}`);
      return { configured: account !== null, account, replies: [], reason };
    }
  }

  // --- SEND -----------------------------------------------------------------
  // Send an approved reply via the org's connected Gmail account, record the
  // OUTBOUND ledger row, and mark the classification handled. 400 when the
  // classification is not in the calling org. Returns the queue (without it).
  async send(
    orgId: string,
    classificationId: string,
    text: string,
    accountId?: string,
  ): Promise<EngageReplyListDto> {
    // Resolve the classification + its prospect, asserting org ownership.
    const found = await this.db
      .select({
        classification: schema.replyClassifications,
        prospect: schema.prospects,
      })
      .from(schema.replyClassifications)
      .innerJoin(
        schema.prospects,
        eq(schema.replyClassifications.prospectId, schema.prospects.id),
      )
      .where(eq(schema.replyClassifications.id, classificationId))
      .limit(1);
    const row = found[0];
    if (!row || row.prospect.organizationId !== orgId) {
      // Org isolation: a classification outside this tenant is invisible → 400.
      throw new BadRequestException('Unknown reply classification');
    }

    const access = await this.googleAccounts.resolveMailboxForAccount(orgId, accountId, 'gmail');
    if (!access.ok) {
      throw new BadRequestException(access.reason);
    }
    const perOrg = access;

    // The inbound message we're replying to (for threading headers + subject).
    const inbound = row.classification.messageId
      ? (
          await this.db
            .select()
            .from(schema.outreachMessages)
            .where(eq(schema.outreachMessages.id, row.classification.messageId))
            .limit(1)
        )[0]
      : undefined;

    const raw = buildRawReply({
      to: row.prospect.email,
      from: perOrg.account.email,
      subject: inbound?.subject ?? '(no subject)',
      body: text,
      inReplyTo: extractInReplyTo(row.classification.raw),
      references: extractReferences(row.classification.raw),
    });

    let sendError: string | null = null;
    let gmailMessageId: string | null = null;
    let gmailThreadId: string | null = inbound?.gmailThreadId ?? null;
    try {
      const res = await fetch(GMAIL_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${perOrg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw,
          ...(gmailThreadId ? { threadId: gmailThreadId } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        sendError = `Gmail send HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`;
      } else {
        const sent = (await res.json()) as { id?: string; threadId?: string };
        gmailMessageId = sent.id ?? null;
        gmailThreadId = sent.threadId ?? gmailThreadId;
      }
    } catch (err) {
      sendError = err instanceof Error ? err.message : 'unknown send error';
    }

    // Record the OUTBOUND ledger row (status reflects success/failure).
    await this.db.insert(schema.outreachMessages).values({
      prospectId: row.prospect.id,
      direction: 'OUTBOUND',
      status: sendError ? 'FAILED' : 'SENT',
      gmailMessageId,
      gmailThreadId,
      subject: inbound?.subject ?? null,
      bodySnippet: text.slice(0, BODY_MAX),
      sentAt: sendError ? null : new Date(),
      error: sendError,
    });

    await writeMachineAudit(this.db, {
      organizationId: orgId,
      entity: 'outreach_messages',
      entityId: classificationId,
      action: sendError ? 'ENGAGE_SEND_FAILED' : 'ENGAGE_SEND',
      after: { prospectId: row.prospect.id, gmailMessageId, error: sendError },
    });

    if (sendError) {
      this.logger.warn(`Engage send failed for org ${orgId}: ${sendError}`);
      throw new BadRequestException(sendError);
    }

    // Mark handled: clearing the suggestedReply drops the row from the queue.
    await this.db
      .update(schema.replyClassifications)
      .set({ suggestedReply: null })
      .where(eq(schema.replyClassifications.id, classificationId));

    return this.list(orgId, accountId);
  }

  // --- REDRAFT --------------------------------------------------------------
  // Regenerate the suggested reply for one queued classification (org-scoped).
  async redraft(
    orgId: string,
    classificationId: string,
    accountId?: string,
  ): Promise<EngageReplyListDto> {
    const found = await this.db
      .select({
        classification: schema.replyClassifications,
        prospect: schema.prospects,
      })
      .from(schema.replyClassifications)
      .innerJoin(
        schema.prospects,
        eq(schema.replyClassifications.prospectId, schema.prospects.id),
      )
      .where(eq(schema.replyClassifications.id, classificationId))
      .limit(1);
    const row = found[0];
    if (!row || row.prospect.organizationId !== orgId) {
      throw new BadRequestException('Unknown reply classification');
    }

    const inbound = row.classification.messageId
      ? (
          await this.db
            .select()
            .from(schema.outreachMessages)
            .where(eq(schema.outreachMessages.id, row.classification.messageId))
            .limit(1)
        )[0]
      : undefined;

    const model = await this.resolveAiModel(orgId);
    const draft = await this.draft(
      orgId,
      {
        fromEmail: row.prospect.email,
        fromName: null,
        subject: inbound?.subject ?? null,
        body: inbound?.bodySnippet ?? '',
      },
      model,
    );
    if (draft) {
      await this.db
        .update(schema.replyClassifications)
        .set({ suggestedReply: draft, model })
        .where(eq(schema.replyClassifications.id, classificationId));
    }
    return this.list(orgId, accountId);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  // Fetch one full message and parse it. Returns null on non-2xx/parse failure.
  private async fetchMessage(
    token: string,
    id: string,
  ): Promise<ParsedReply | null> {
    // metadata format = headers + snippet, NO body — all the gmail.metadata scope allows.
    const params = new URLSearchParams({ format: 'metadata' });
    const res = await fetch(`${GMAIL_GET_URL}/${id}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      this.logger.warn(`Engage Gmail get HTTP ${res.status} for message ${id}`);
      return null;
    }
    return parseGmailMessage((await res.json()) as GmailMessage);
  }

  // Match a prospect by sender email within the org (the unique key is
  // (campaignId,email); we take the most recent prospect for this address).
  private async matchProspect(
    orgId: string,
    email: string,
  ): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: schema.prospects.id })
      .from(schema.prospects)
      .where(
        and(
          eq(schema.prospects.organizationId, orgId),
          eq(schema.prospects.email, email),
        ),
      )
      .orderBy(desc(schema.prospects.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  // Upsert the inbound on outreach_messages (idempotent on Gmail message id).
  private async upsertInbound(
    orgId: string,
    prospectId: string,
    parsed: ParsedReply,
  ): Promise<{ id: string }> {
    const snippet = parsed.body.slice(0, SNIPPET_MAX) || null;
    const existing = await this.db
      .select({ id: schema.outreachMessages.id })
      .from(schema.outreachMessages)
      .where(eq(schema.outreachMessages.gmailMessageId, parsed.gmailMessageId))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(schema.outreachMessages)
        .set({
          subject: parsed.subject,
          bodySnippet: snippet,
          sentAt: parsed.receivedAt,
        })
        .where(eq(schema.outreachMessages.id, existing[0].id));
      return existing[0];
    }
    const inserted = await this.db
      .insert(schema.outreachMessages)
      .values({
        prospectId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        gmailMessageId: parsed.gmailMessageId,
        gmailThreadId: parsed.gmailThreadId,
        subject: parsed.subject,
        bodySnippet: snippet,
        sentAt: parsed.receivedAt,
      })
      .returning({ id: schema.outreachMessages.id });
    const row = inserted[0];
    if (!row) throw new Error('Failed to record inbound message');
    await writeMachineAudit(this.db, {
      organizationId: orgId,
      entity: 'outreach_messages',
      entityId: row.id,
      action: 'ENGAGE_INBOUND',
      after: { prospectId, gmailMessageId: parsed.gmailMessageId },
    });
    return row;
  }

  // Upsert the verdict row for this inbound (idempotent on messageId, so re-scans
  // refresh instead of duplicating). Stores reason + threading headers in `raw`.
  private async upsertClassification(
    orgId: string,
    prospectId: string,
    messageId: string,
    v: {
      verdict: ReplyVerdict;
      reason: string | null;
      model: string | null;
      suggestedReply: string | null;
    },
  ): Promise<void> {
    // Carry the Gmail threading headers + reason in `raw` (the meetings.analysis
    // pattern) so send() can thread the reply without re-fetching from Gmail.
    const inbound = await this.db
      .select({
        gmailMessageId: schema.outreachMessages.gmailMessageId,
        gmailThreadId: schema.outreachMessages.gmailThreadId,
      })
      .from(schema.outreachMessages)
      .where(eq(schema.outreachMessages.id, messageId))
      .limit(1);
    const raw = {
      engine: 'erp-direct',
      reason: v.reason,
      // RFC822 Message-ID is the inbound Gmail message id surrogate for threading.
      inReplyTo: inbound[0]?.gmailMessageId ?? null,
      references: inbound[0]?.gmailThreadId ?? null,
    };

    const existing = await this.db
      .select({ id: schema.replyClassifications.id })
      .from(schema.replyClassifications)
      .where(eq(schema.replyClassifications.messageId, messageId))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(schema.replyClassifications)
        .set({
          verdict: v.verdict,
          model: v.model,
          raw: raw as never,
          suggestedReply: v.suggestedReply,
        })
        .where(eq(schema.replyClassifications.id, existing[0].id));
      return;
    }
    const inserted = await this.db
      .insert(schema.replyClassifications)
      .values({
        prospectId,
        messageId,
        verdict: v.verdict,
        model: v.model,
        raw: raw as never,
        suggestedReply: v.suggestedReply,
      })
      .returning({ id: schema.replyClassifications.id });
    const cl = inserted[0];
    if (cl) {
      await writeMachineAudit(this.db, {
        organizationId: orgId,
        entity: 'reply_classifications',
        entityId: cl.id,
        action: 'ENGAGE_CLASSIFY',
        after: { prospectId, verdict: v.verdict },
      });
    }
  }

  // Classify a reply via the ERP's own Claude (forced tool call). Degrades to
  // UNSURE / null reason when AI is unconfigured or errors — never throws.
  private async classify(
    parsed: Pick<ParsedReply, 'subject' | 'body' | 'fromEmail'>,
    model: string | null,
  ): Promise<{ classification: ReplyVerdict; reason: string | null }> {
    if (!this.claude.isConfigured()) return { classification: 'UNSURE', reason: null };
    try {
      const result = await this.claude.structured({
        system:
          'You triage cold-outreach email replies for a B2B sales team. Classify the prospect intent and give a short reason. Only use INTERESTED for a genuine positive signal (wants info, a call, or a meeting); NOT_INTERESTED for clear declines, unsubscribes, or auto-replies; UNSURE for anything ambiguous.',
        prompt: `From: ${parsed.fromEmail ?? 'unknown'}\nSubject: ${parsed.subject ?? '(none)'}\n\n${parsed.body.slice(0, BODY_MAX)}`,
        toolName: 'classify_reply',
        toolDescription: 'Record the intent classification of a sales reply.',
        schema: z.object({
          classification: z.enum(ENGAGE_VERDICTS),
          reason: z.string().max(280),
        }),
        jsonSchema: {
          type: 'object',
          properties: {
            classification: { type: 'string', enum: [...ENGAGE_VERDICTS] },
            reason: { type: 'string', description: 'One short sentence.' },
          },
          required: ['classification', 'reason'],
        },
        maxTokens: 300,
        model: model ?? undefined,
      });
      return {
        classification: normalizeVerdict(result.data.classification),
        reason: result.data.reason,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Engage classify failed: ${msg}`);
      return { classification: 'UNSURE', reason: null };
    }
  }

  // Draft a suggested reply in the org's voice via Claude. Returns null when AI
  // is unconfigured or errors — the row is still queued for manual reply.
  private async draft(
    orgId: string,
    parsed: Pick<ParsedReply, 'subject' | 'body' | 'fromEmail' | 'fromName'>,
    model: string | null,
  ): Promise<string | null> {
    if (!this.claude.isConfigured()) return null;
    try {
      const tone = await this.resolveTone(orgId);
      const result = await this.claude.structured({
        system: `You draft concise, ${tone} B2B sales reply emails on behalf of the sales rep. Write only the email body (no subject, no signature). Address the prospect's message directly and propose a concrete next step.`,
        prompt: `Prospect ${parsed.fromName ?? parsed.fromEmail ?? ''} wrote:\nSubject: ${parsed.subject ?? '(none)'}\n\n${parsed.body.slice(0, BODY_MAX)}\n\nDraft a reply.`,
        toolName: 'draft_reply',
        toolDescription: 'Provide the drafted reply email body.',
        schema: z.object({ reply: z.string().max(BODY_MAX) }),
        jsonSchema: {
          type: 'object',
          properties: {
            reply: { type: 'string', description: 'The reply email body only.' },
          },
          required: ['reply'],
        },
        maxTokens: 800,
        model: model ?? undefined,
      });
      return result.data.reply.trim() || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Engage draft failed for org ${orgId}: ${msg}`);
      return null;
    }
  }

  // Per-org AI model preference (org_config.aiModel). Null → env ANTHROPIC_MODEL
  // (resolved inside ClaudeService when `model` is undefined).
  private async resolveAiModel(orgId: string): Promise<string | null> {
    const rows = await this.db
      .select({ aiModel: schema.orgConfig.aiModel })
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    const m = rows[0]?.aiModel?.trim();
    return m && m.length > 0 ? m : null;
  }

  // Per-org outreach tone (org_config.tone). Defaults to 'professional'.
  private async resolveTone(orgId: string): Promise<string> {
    const rows = await this.db
      .select({ tone: schema.orgConfig.tone })
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    const t = rows[0]?.tone?.trim();
    return t && t.length > 0 ? t : 'professional';
  }
}

// --- raw-column helpers (PURE) ----------------------------------------------

// The reason we stored in reply_classifications.raw (null when absent/legacy).
export function parseReason(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'reason' in raw) {
    const r = (raw as { reason?: unknown }).reason;
    return typeof r === 'string' ? r : null;
  }
  return null;
}

// In-Reply-To header value persisted on the classification row's `raw`.
export function extractInReplyTo(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'inReplyTo' in raw) {
    const v = (raw as { inReplyTo?: unknown }).inReplyTo;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

// References header value persisted on the classification row's `raw`.
export function extractReferences(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'references' in raw) {
    const v = (raw as { references?: unknown }).references;
    return typeof v === 'string' ? v : null;
  }
  return null;
}
