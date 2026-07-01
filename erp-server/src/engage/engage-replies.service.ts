import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { CalendarFreeSlotsDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { GoogleAccountsService } from '../google/google-accounts.service';
import { GoogleCalendarReadService } from '../google/google-calendar-read.service';
import { ReachRepository } from '../reach/reach.repository';
import { tenantScope } from '../common/tenant';
import { EngageAgentClient } from './engage.agent';
import { KnowledgeService } from './knowledge.service';
import { buildRawReply, extractPlainBody, parseFromAddress } from './engage.service';
import {
  resolveScheduling,
  type MeetingResolution,
  type SchedulingVerdict,
  type Slot,
} from './meeting-loop';
import {
  renderAcceptConfirmation,
  renderSlotBullets,
  type MeetingKind,
} from './meeting-time-format';

// Invisible HTML-comment markers fence the system-owned meeting-time prose so re-stamping
// replaces (never duplicates) it. They are stripped wherever the body is rendered (the
// outgoing email's both MIME parts + the reply-detail editor), so the client and the
// operator only ever see the natural sentence — the markers are pure internal plumbing.
const MTG_OPEN = '<!--meeting-time-->';
const MTG_CLOSE = '<!--/meeting-time-->';
const MTG_BLOCK = new RegExp(`[ \\t]*\\n*${MTG_OPEN}[\\s\\S]*?${MTG_CLOSE}`, 'g');

// Scenario-2 proposing: how many concrete options to offer an interested lead, and the
// (generous) window to search for genuinely-free business-hours slots. The window is
// intentionally wide — it surfaces the EARLIEST real availability, never a fixed "next
// few days" — so it works on a live calendar however far out the next free slot is.
const PROPOSE_SLOT_COUNT = 2;
const PROPOSE_HORIZON_DAYS = 28;

// A closing salutation that begins the signature block (EN + DE). Matched per-line, so
// the meeting-time prose is inserted as the LAST body paragraph — just ABOVE the sign-off
// (`Best regards, / Hanna Nguyen / EVERTRUST GmbH`), never dangling beneath the signature.
const SIGNOFF_RE =
  /^[ \t>]*(best regards|kind(?:est)? regards|warm(?:est)? regards|best wishes|regards|sincerely(?: yours)?|yours (?:sincerely|truly|faithfully)|best|cheers|many thanks|thanks(?: again)?|thank you|talk soon|speak soon|looking forward\b[^\n]*|mit freundlichen gr[üu](?:ß|ss)en|freundliche gr[üu](?:ß|ss)e|viele gr[üu](?:ß|ss)e|beste gr[üu](?:ß|ss)e|liebe gr[üu](?:ß|ss)e|herzliche gr[üu](?:ß|ss)e)[ \t]*[,!.]?[ \t]*$/i;

// Place `block` as the final body paragraph, immediately before the closing salutation if
// one is found near the end (a signature is short — only the last few non-empty lines are
// considered, so an earlier "Looking forward…" sentence mid-body is never mistaken for it).
// No recognizable sign-off → append at the end (the old behaviour, the safe fallback).
function placeBeforeSignoff(body: string, block: string): string {
  const lines = body.split('\n');
  let examined = 0;
  let idx = -1;
  for (let i = lines.length - 1; i >= 0 && examined < 6; i--) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    examined++;
    if (SIGNOFF_RE.test(line)) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return `${body.trimEnd()}\n\n${block}`;
  const head = lines.slice(0, idx).join('\n').trimEnd();
  const tail = lines.slice(idx).join('\n').trimStart();
  return `${head}\n\n${block}\n\n${tail}`;
}

// The canonical closing EVERY drafted reply must end with, so all categories (interested /
// unsure / temp / not-interested) sign off identically and match the cold-outreach signature.
// The reply_glock LLM writes its own sign-off ("Best regards, … | Business Development Manager
// | …"), so we overwrite it deterministically rather than hoping the model complies.
// FLAG (multi-tenant): the name/company are the EverTrust defaults (mirroring the hardcoded
// campaign_context below + Reach's gmail-sender fromName); resolve these per-org once reply
// personas carry a signature block.
const SENDER_NAME = 'Hanna Nguyen';
const SENDER_COMPANY = 'EVERTRUST GmbH';
// The From display name on outgoing replies — matches Reach's outreach ("EVERTRUST GmbH")
// so the lead sees the same sender, not the bare mailbox name ("hanna").
const REPLY_FROM_NAME = SENDER_COMPANY;
const REPLY_SIGNATURE = [
  'Kind regards,',
  SENDER_NAME,
  SENDER_COMPANY,
  'We are at your disposal.',
].join('\n');

// Force a drafted reply body to end with REPLY_SIGNATURE: drop whatever closing the model
// wrote (from its bottom-most salutation line to the end) and append the canonical block.
// An empty draft is left untouched (no reply to sign); idempotent (re-detects "Kind regards,"
// and re-appends the same block). Meeting-time prose lives ABOVE the sign-off, so it survives.
// Exported for the pure-helper unit spec.
export function enforceSignature(body: string): string {
  if (!body.trim()) return body;
  const lines = body.replace(/\s+$/, '').split('\n');
  let cut = -1;
  let examined = 0;
  for (let i = lines.length - 1; i >= 0 && examined < 8; i--) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    examined++;
    if (SIGNOFF_RE.test(line)) {
      cut = i;
      break;
    }
  }
  const head = (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').replace(/\s+$/, '');
  return head ? `${head}\n\n${REPLY_SIGNATURE}` : REPLY_SIGNATURE;
}

// A concrete clock time the drafter should NEVER have written — the system owns the
// authoritative meeting time. Matches "9:30am", "2 pm", "09:00", "14:00 CET".
const CLOCK_TIME_RE = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b/i;

// The drafter LLM sometimes invents a meeting time in the body ("Let's connect Thursday
// at 9:30am"), which then contradicts the system-stamped authoritative block — two
// proposals. Strip any sentence stating a concrete clock time, per-sentence, preserving
// paragraph structure and dropping emptied paragraphs, so only the grounded block remains.
function stripProposedTimeSentences(body: string): string {
  const kept: string[] = [];
  for (const para of body.split(/\n{2,}/)) {
    const sentences = para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [para];
    const rebuilt = sentences.filter((s) => !CLOCK_TIME_RE.test(s)).join('').trim();
    if (rebuilt) kept.push(rebuilt);
  }
  return kept.join('\n\n');
}

// A line the drafter writes to introduce the time options, e.g. "Please find the proposed
// time slots below:" or "Here are some times that work:". The grounded bullets are injected
// right after it so they flow inside the LLM's own prose — not as a detached block. Requires
// a cue word AND a trailing colon, so ordinary sentences are never mistaken for it.
const SLOT_LEADIN_RE =
  /^(?=.*\b(?:time|times|slot|slots|below|follow(?:ing)?|availability|option|options|propos(?:e|ed|ing))\b).*:\s*$/i;

// Inject `block` immediately after the drafter's slot lead-in line, if present, so the times
// sit between the LLM's "…below:" and its follow-up ask. Returns null when there's no such
// lead-in (caller falls back to placing the block above the sign-off).
function insertAtSlotLeadIn(body: string, block: string): string | null {
  const lines = body.split('\n');
  const idx = lines.findIndex((l) => SLOT_LEADIN_RE.test(l.trim()));
  if (idx === -1) return null;
  const head = lines.slice(0, idx + 1).join('\n').trimEnd();
  const tail = lines.slice(idx + 1).join('\n').trim();
  return tail ? `${head}\n\n${block}\n\n${tail}` : `${head}\n\n${block}`;
}

// A sentence in which the drafter says the meeting is set — the grounded confirmation is
// appended right after it (same paragraph) so "I've added our call to my calendar." flows
// straight into "You're all set for <time> …", not a detached block at the bottom.
const BOOKING_SENTENCE_RE =
  /\b(?:calendar|booked|confirm(?:ed|ing)?|scheduled?|all set|locked?\s+in|added\s+(?:our|the|this)|reserved|pencill?ed|set\s+up|see\s+you)\b/i;

// Append `inline` immediately after the drafter's booking sentence, in the same paragraph.
// Returns null when no such sentence exists (caller falls back to above the sign-off).
function insertAfterBookingSentence(body: string, inline: string): string | null {
  const paras = body.split(/\n{2,}/);
  for (let i = 0; i < paras.length; i++) {
    const para = paras[i] ?? '';
    const sentences = para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
    if (!sentences) continue;
    const j = sentences.findIndex((s) => BOOKING_SENTENCE_RE.test(s));
    if (j === -1) continue;
    sentences[j] = `${(sentences[j] ?? '').trimEnd()} ${inline}`;
    paras[i] = sentences.join('').trimEnd();
    return paras.join('\n\n');
  }
  return null;
}

// A short, natural lead-in used ONLY when the drafter wrote none of its own — so the bullets
// are never contextless. The trailing ask is left to the LLM, never a fixed wrapper.
function fallbackLeadIn(kind: MeetingKind): string {
  return kind === 'counter'
    ? 'That time was just taken on our side — a couple of alternatives that work:'
    : 'Here are a couple of times that work on my end:';
}

// Stamp the authoritative dual-zone meeting time onto an email body. The system owns ONLY
// the TIMES (rendered from the SAME slot the calendar books, so the email can never disagree
// with the invite); the surrounding wording is the drafter's natural prose. For propose /
// counter the grounded bullets are injected at the drafter's "…below:" lead-in (or, lacking
// one, above the sign-off with a short lead-in) — NO robotic "would either of these times
// work for you? … let me know which suits you best" wrapper. `accept` keeps a one-line
// confirmation. Idempotent + scrubs any LLM-invented clock time first, so there is exactly
// one time statement.
export function withMeetingTime(
  body: string,
  slots: Slot[],
  primaryTz: string,
  secondaryTz: string | null,
  kind: MeetingKind = 'propose',
): string {
  const stripped = body.replace(MTG_BLOCK, '').trimEnd();
  if (slots.length === 0) return stripped;
  const scrubbed = stripProposedTimeSentences(stripped);

  // accept: a single confirmed time → append the grounded confirmation right after the
  // drafter's "I've added our call to my calendar." sentence (or, lacking one, above the
  // sign-off), so it reads in the drafter's flow — not a detached paragraph at the bottom.
  if (kind === 'accept') {
    const confirm = renderAcceptConfirmation(slots[0]!, primaryTz, secondaryTz);
    const inline = `${MTG_OPEN}${confirm}${MTG_CLOSE}`;
    return insertAfterBookingSentence(scrubbed, inline) ?? placeBeforeSignoff(scrubbed, inline);
  }

  // propose / counter: inject ONLY the grounded bullets, into the drafter's own flow.
  const bullets = renderSlotBullets(slots, primaryTz, secondaryTz);
  const atLeadIn = insertAtSlotLeadIn(scrubbed, `${MTG_OPEN}${bullets}${MTG_CLOSE}`);
  if (atLeadIn) return atLeadIn;
  // No lead-in from the drafter → a short natural lead-in + bullets, above the sign-off.
  return placeBeforeSignoff(
    scrubbed,
    `${MTG_OPEN}${fallbackLeadIn(kind)}\n${bullets}${MTG_CLOSE}`,
  );
}

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

// Fixed instruction used when re-drafting a campaign after the persona is switched.
// It tells reply_glock to keep the meaning + classification and only re-voice the
// draft, so the existing redraft path (which skips re-classification when an
// instruction + prior_status are present) applies the newly-set persona cleanly.
const PERSONA_REFRESH_INSTRUCTION =
  "Re-draft this reply in the campaign's currently selected persona voice. Keep the " +
  'same meaning, intent and classification — only adjust the wording, rhythm and ' +
  'phrasing so it reads in that persona’s style.';

// reply_glock status -> the UI's display category. TEMPORARY surfaces as its own
// "Temp" bucket; UNINTERESTED maps onto the UI's "NOT INTERESTED" chip.
const UI_CATEGORY: Record<string, string> = {
  INTERESTED: 'INTERESTED',
  UNSURE: 'UNSURE',
  TEMPORARY: 'TEMP',
  UNINTERESTED: 'NOT INTERESTED',
};

// reply_glock status -> the reach_leads.status (reach_lead_status enum) the Lead
// Scraper / Nurture board read. TEMPORARY folds into UNSURE; UNINTERESTED maps to
// NOT_INTERESTED. A status outside this map leaves the lead status untouched.
const REACH_LEAD_STATUS: Record<string, 'INTERESTED' | 'UNSURE' | 'NOT_INTERESTED'> = {
  INTERESTED: 'INTERESTED',
  UNSURE: 'UNSURE',
  TEMPORARY: 'UNSURE',
  UNINTERESTED: 'NOT_INTERESTED',
};

// reply_glock status -> the prospects.status (prospect_status enum) the NURTURE
// pipeline reads. A reply moves the prospect off cold NEW/EMAILED into the pipeline:
// INTERESTED → INTERESTED; any other genuine reply (UNSURE/TEMPORARY) → REPLIED ("in
// conversation"); UNINTERESTED → NOT_INTERESTED (a reply, but not a working deal — so it
// stays out of the engaged-only board). This is what surfaces a prospect in Nurture only
// AFTER the client replies.
const PROSPECT_STATUS_FROM_REPLY: Record<
  string,
  'INTERESTED' | 'REPLIED' | 'NOT_INTERESTED'
> = {
  INTERESTED: 'INTERESTED',
  UNSURE: 'REPLIED',
  TEMPORARY: 'REPLIED',
  UNINTERESTED: 'NOT_INTERESTED',
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

  // Campaigns with a scan currently running (key = `${orgId}:${aimId}`). A scan is
  // slow (one LLM classify+draft per lead), so a second click while one is in flight
  // must be a no-op — otherwise repeated clicks stack concurrent passes over the same
  // leads and all contend for the one local model, making everything slower.
  private readonly scansInFlight = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly googleAccounts: GoogleAccountsService,
    private readonly agent: EngageAgentClient,
    private readonly reach: ReachRepository,
    private readonly calendar: GoogleCalendarReadService,
    private readonly knowledge: KnowledgeService,
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

    // Single-flight: ignore a duplicate scan while one is already running for this
    // campaign, so repeated clicks can't pile up concurrent LLM passes.
    const key = `${orgId}:${aimId}`;
    if (this.scansInFlight.has(key)) {
      return { ...empty, configured: true, reason: 'A scan is already running for this campaign.' };
    }
    this.scansInFlight.add(key);
    try {
      return await this.runScan(orgId, aimId, empty);
    } finally {
      this.scansInFlight.delete(key);
    }
  }

  private async runScan(
    orgId: string,
    aimId: string,
    empty: CampaignScanResult,
  ): Promise<CampaignScanResult> {
    const resolved = await this.resolveCampaign(orgId, aimId);
    if (!resolved) throw new BadRequestException('Unknown campaign');
    const { aim, mailboxAccountId } = resolved;

    // Persona (F4) + learned "teach the AI" notes (F3) — loaded once per scan and
    // injected into every draft so the agent writes in the chosen voice and
    // remembers prior operator corrections.
    const drafting = await this.loadDrafting(orgId, aim);

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

    // Only leads this campaign has actually emailed get scanned. A lead with no send was
    // never contacted by THIS campaign, so any Gmail thread it has is pre-existing /
    // cross-campaign history we must not ingest (otherwise deleting + re-creating a
    // campaign re-classifies stale conversations).
    const contactedLeadIds = await this.reach.leadIdsWithSends(orgId, aimId);

    const byCategory: Record<string, number> = {};
    let scanned = 0;
    let classified = 0;
    let skipped = 0;

    for (const lead of leads) {
      const email = lead.email?.trim().toLowerCase();
      if (!email || !contactedLeadIds.has(lead.id)) {
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

        // Load this lead's existing reply row (if any) for the meeting loop: the slots
        // we previously offered + whether it is already BOOKED (idempotency guard).
        const existingRow = await this.loadExistingReply(orgId, aimId, lead.id);
        const offeredSlots = existingRow?.proposedSlots ?? [];

        const out = await this.classifyAndDraft(
          aim,
          lead,
          inbound,
          thread,
          drafting,
          offeredSlots,
        );
        if (!out) {
          skipped++;
          continue;
        }
        byCategory[out.status] = (byCategory[out.status] ?? 0) + 1;
        classified++;
        await this.upsertReply(orgId, aimId, lead.id, inbound, thread, lead.company, out);
        // Resolve the scheduling verdict (accept / counter) and persist meeting fields.
        // Skip when already BOOKED (don't touch a confirmed meeting). Best-effort: a
        // scheduling failure must NOT fail the scan (the classify already counted).
        if (existingRow?.meetingStatus !== 'BOOKED') {
          await this.applyScheduling(
            orgId,
            lead.id,
            aim,
            lead,
            out.scheduling,
            offeredSlots,
            inbound.id,
          );
          // Keep the meeting-time prose on the (re-drafted) reply for its current state,
          // and — for an INTERESTED lead with no time yet — make the first proposal.
          await this.ensureMeetingTimeOnDraft(
            orgId,
            aimId,
            lead.id,
            out.status === 'INTERESTED',
          );
        }
        // Propagate the classification into the Reach plane (stats cache + lead status)
        // so the Email Generator / Sequence Sender / Lead Scraper reflect the reply.
        // Best-effort: a failure here must not fail the scan (the classify still counts).
        await this.propagateClassification(orgId, aimId, lead.id, out.status);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Engage scanCampaign lead ${lead.id} failed: ${msg}`);
        skipped++;
      }
    }

    return { configured: true, scanned, classified, byCategory, skipped, reason: null };
  }

  // Propagate a successful classification into the Reach plane so the cached aim.stats
  // (Email Generator + Sequence Sender) and reach_leads.status (Lead Scraper) reflect
  // the reply. Two independent best-effort steps, each wrapped so a propagation failure
  // never fails the scan (the classify already counted):
  //   (a) markLeadReplied — stamp repliedAt on the lead's latest send + recompute stats
  //       (idempotent; only stamps when repliedAt is null, so a re-scan can't double count).
  //   (b) set reach_leads.status from the reply_glock category (org-scoped).
  private async propagateClassification(
    orgId: string,
    aimId: string,
    leadId: string,
    status: string,
  ): Promise<void> {
    try {
      await this.reach.markLeadReplied(orgId, aimId, leadId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Engage propagate stats lead ${leadId} failed: ${msg}`);
    }

    const leadStatus = REACH_LEAD_STATUS[status];
    if (leadStatus) {
      try {
        await this.db
          .update(schema.reachLeads)
          .set({ status: leadStatus, updatedAt: new Date() })
          .where(
            and(
              tenantScope(orgId, schema.reachLeads),
              eq(schema.reachLeads.id, leadId),
            ),
          );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Engage propagate status lead ${leadId} failed: ${msg}`);
      }
    }

    // (c) Promote the matching NURTURE prospect off cold NEW/EMAILED into the pipeline
    // on the FIRST reply (the campaign's mirrored prospect is keyed by campaignId+email).
    // Only NEW/EMAILED are touched, so we never downgrade a prospect the team has already
    // advanced (e.g. MEETING_SCHEDULED). Best-effort — a failure never fails the scan.
    const prospectStatus = PROSPECT_STATUS_FROM_REPLY[status];
    if (prospectStatus) {
      try {
        const [aimRow] = await this.db
          .select({ campaignId: schema.reachAims.campaignId })
          .from(schema.reachAims)
          .where(
            and(tenantScope(orgId, schema.reachAims), eq(schema.reachAims.id, aimId)),
          )
          .limit(1);
        const [leadRow] = await this.db
          .select({ email: schema.reachLeads.email })
          .from(schema.reachLeads)
          .where(
            and(
              tenantScope(orgId, schema.reachLeads),
              eq(schema.reachLeads.id, leadId),
            ),
          )
          .limit(1);
        if (aimRow?.campaignId && leadRow?.email) {
          await this.db
            .update(schema.prospects)
            .set({ status: prospectStatus, updatedAt: new Date() })
            .where(
              and(
                tenantScope(orgId, schema.prospects),
                eq(schema.prospects.campaignId, aimRow.campaignId),
                eq(schema.prospects.email, leadRow.email),
                inArray(schema.prospects.status, ['NEW', 'EMAILED']),
              ),
            );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Engage promote prospect (lead ${leadId}) failed: ${msg}`);
      }
    }
  }

  // Load this lead's existing reply row (org-scoped, by aim+lead) so the scan can read
  // the meeting-loop state it carries (the slots previously offered + meetingStatus).
  // Returns null when no row exists yet (first scan of the thread).
  private async loadExistingReply(
    orgId: string,
    aimId: string,
    leadId: string,
  ): Promise<typeof schema.reachLeadReplies.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(schema.reachLeadReplies)
      .where(
        and(
          tenantScope(orgId, schema.reachLeadReplies),
          eq(schema.reachLeadReplies.aimId, aimId),
          eq(schema.reachLeadReplies.leadId, leadId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // Resolve the org's zones and stamp the authoritative dual-zone time block onto a
  // meeting email body (rendered from the structured slots, never the LLM). No slots →
  // unchanged. Used at PROPOSED send, ACCEPTED confirmation, and COUNTER alternatives.
  private async stampMeetingTime(
    orgId: string,
    body: string,
    slots: Slot[],
    kind: MeetingKind = 'propose',
  ): Promise<string> {
    if (!slots.length) return body;
    const { primary, secondary } = await this.calendar.getOrgTimeZones(orgId);
    return withMeetingTime(body, slots, primary, secondary, kind);
  }

  // Resolve a reply_glock scheduling verdict against the org's calendar — pure-ish,
  // delegates to the free `resolveScheduling` (testable with a fake calendar). The
  // calendar is `this.calendar` (GoogleCalendarReadService), which already implements
  // isWindowFree / alternativesNear.
  async resolveScheduling(
    orgId: string,
    verdict: SchedulingVerdict,
    proposedSlots: Slot[],
  ): Promise<MeetingResolution> {
    return resolveScheduling(this.calendar, orgId, verdict, proposedSlots);
  }

  // Apply the scheduling resolution for one lead during a scan (org-scoped):
  //   ACCEPTED → meetingStatus='ACCEPTED' + acceptedSlot.
  //   COUNTER  → meetingStatus='COUNTER', overwrite proposedSlots with the alternatives,
  //              and regenerate the draft to propose those alternative times.
  //   NONE     → leave meeting fields untouched.
  // `inboundId` is the Gmail message id of the latest inbound (the lead's reply being
  // resolved). The COUNTER branch is idempotent per inbound: once it has resolved a
  // counter for this inbound (status already COUNTER, stamped with this id) it skips
  // re-fetching alternatives and re-drafting — that round is a no-op until the lead
  // sends a NEW reply — so a re-scan never wastes an LLM pass or clobbers manual draft
  // edits. (ACCEPTED re-sets the same slot and NONE returns early, so neither needs
  // gating; a COUNTER that flips to ACCEPTED when the calendar frees up still applies.)
  // Wrapped in try/catch: a scheduling failure must NOT fail the scan.
  private async applyScheduling(
    orgId: string,
    leadId: string,
    aim: typeof schema.reachAims.$inferSelect,
    lead: { company: string; email: string | null; contactName: string | null },
    verdict: SchedulingVerdict,
    proposedSlots: Slot[],
    inboundId: string,
  ): Promise<void> {
    try {
      const resolution = await this.resolveScheduling(orgId, verdict, proposedSlots);
      if (resolution.status === 'NONE') return;

      if (resolution.status === 'ACCEPTED') {
        // Normalize the stored draft so the confirmation email shows the REAL accepted
        // time (the LLM's classify-time draft may state an invented time / none at all).
        const existingAccepted = await this.loadExistingReply(orgId, aim.id, leadId);
        const acceptedDraft = existingAccepted
          ? await this.stampMeetingTime(
              orgId,
              existingAccepted.draftBody ?? '',
              [resolution.acceptedSlot],
              'accept',
            )
          : undefined;
        await this.db
          .update(schema.reachLeadReplies)
          .set({
            meetingStatus: 'ACCEPTED',
            acceptedSlot: resolution.acceptedSlot,
            ...(acceptedDraft !== undefined ? { draftBody: acceptedDraft } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              tenantScope(orgId, schema.reachLeadReplies),
              eq(schema.reachLeadReplies.aimId, aim.id),
              eq(schema.reachLeadReplies.leadId, leadId),
            ),
          );
        return;
      }

      // COUNTER: the lead's requested time is busy — offer the nearest alternatives.
      // Idempotency guard: if we already resolved THIS inbound's counter (status is still
      // COUNTER and stamped with this inbound id), the round is settled — don't overwrite
      // the offered slots or re-run redraftReply (an LLM pass that would clobber manual
      // edits). Only a fresh inbound (a new counter) re-resolves and re-drafts.
      const existing = await this.loadExistingReply(orgId, aim.id, leadId);
      if (
        existing?.meetingStatus === 'COUNTER' &&
        existing.counterResolvedInboundId === inboundId
      ) {
        return;
      }

      // Overwrite proposedSlots with the alternatives, stamp the inbound we resolved, and
      // regenerate the draft to propose them.
      await this.db
        .update(schema.reachLeadReplies)
        .set({
          meetingStatus: 'COUNTER',
          proposedSlots: resolution.alternatives,
          counterResolvedInboundId: inboundId,
          updatedAt: new Date(),
        })
        .where(
          and(
            tenantScope(orgId, schema.reachLeadReplies),
            eq(schema.reachLeadReplies.aimId, aim.id),
            eq(schema.reachLeadReplies.leadId, leadId),
          ),
        );

      if (resolution.alternatives.length > 0 && existing) {
        // Let the LLM write the prose but NOT the times — it must not invent a clock time
        // (that's what diverged from the calendar). The exact alternatives are stamped on
        // deterministically below, from the structured slots.
        const instruction =
          'Their requested time is unavailable. Apologise briefly and propose alternative ' +
          'times. Do NOT state any specific date or clock time — the exact alternative ' +
          'times are appended below your message.';
        const redrafted = await this.redraftReply(orgId, existing.id, instruction);
        const stamped = await this.stampMeetingTime(
          orgId,
          redrafted.draftBody ?? '',
          resolution.alternatives,
          'counter',
        );
        await this.db
          .update(schema.reachLeadReplies)
          .set({ draftBody: stamped, updatedAt: new Date() })
          .where(
            and(
              tenantScope(orgId, schema.reachLeadReplies),
              eq(schema.reachLeadReplies.id, existing.id),
            ),
          );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Engage applyScheduling lead ${leadId} failed: ${msg}`);
    }
  }

  // Keep the natural meeting-time sentence on the (just re-drafted) reply for its CURRENT
  // state. upsertReply overwrites draft_body on every scan, so without re-applying here a
  // re-scan would DROP the prose from an already-proposed/accepted reply. Also handles the
  // first proposal (Scenario 2): an INTERESTED lead that gave no usable time gets concrete
  // free slots offered, so the reply contains times to pick rather than a vague "let's
  // schedule soon". `allowPropose` gates that first proposal to INTERESTED replies.
  // Best-effort: never fails the scan.
  private async ensureMeetingTimeOnDraft(
    orgId: string,
    aimId: string,
    leadId: string,
    allowPropose: boolean,
  ): Promise<void> {
    try {
      const r = await this.loadExistingReply(orgId, aimId, leadId);
      if (!r || r.meetingStatus === 'BOOKED') return; // booked → confirmed, leave it

      let slots: Slot[] = [];
      let kind: MeetingKind = 'propose';
      let setProposed = false;

      if (r.meetingStatus === 'ACCEPTED' && r.acceptedSlot) {
        slots = [r.acceptedSlot];
        kind = 'accept';
      } else if (r.meetingStatus === 'COUNTER' && (r.proposedSlots?.length ?? 0) > 0) {
        slots = r.proposedSlots!;
        kind = 'counter';
      } else if (r.meetingStatus === 'PROPOSED' && (r.proposedSlots?.length ?? 0) > 0) {
        slots = r.proposedSlots!;
        kind = 'propose';
      } else if (
        allowPropose &&
        r.meetingStatus === 'NONE' &&
        (r.proposedSlots?.length ?? 0) === 0
      ) {
        // First proposal: pull genuinely-free business-hours slots over a generous window
        // and offer the earliest few — surfacing real availability, not a fixed cap.
        const now = new Date();
        const free = await this.calendar.freeSlots(orgId, {
          timeMin: now.toISOString(),
          timeMax: new Date(now.getTime() + PROPOSE_HORIZON_DAYS * 86_400_000).toISOString(),
        });
        if (!free.configured || free.slots.length === 0) return; // no availability
        slots = free.slots.slice(0, PROPOSE_SLOT_COUNT);
        kind = 'propose';
        setProposed = true;
      }
      if (slots.length === 0) return;

      const body = await this.stampMeetingTime(orgId, r.draftBody ?? '', slots, kind);
      if (body === r.draftBody && !setProposed) return; // already current → no write
      await this.db
        .update(schema.reachLeadReplies)
        .set({
          draftBody: body,
          ...(setProposed
            ? { proposedSlots: slots, meetingStatus: 'PROPOSED' as const }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            tenantScope(orgId, schema.reachLeadReplies),
            eq(schema.reachLeadReplies.id, r.id),
          ),
        );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Engage ensureMeetingTimeOnDraft lead ${leadId} failed: ${msg}`);
    }
  }

  // Resolve the campaign's drafting persona + active "teach the AI" notes. Notes
  // scoped to this campaign OR org-wide (aimId null). Loaded once per scan.
  private async loadDrafting(
    orgId: string,
    aim: typeof schema.reachAims.$inferSelect,
    // Per-reply persona override: pass the reply's persona_id. `undefined` = use the
    // campaign's persona; an id = that persona; explicit `null` = the default voice.
    replyPersonaId?: string | null,
  ): Promise<{ persona: string | null; guidance: string[] }> {
    let persona: string | null = null;
    const effectivePersonaId =
      replyPersonaId !== undefined ? replyPersonaId : aim.personaId;
    if (effectivePersonaId) {
      const rows = await this.db
        .select({ systemPrompt: schema.personas.systemPrompt })
        .from(schema.personas)
        .where(
          and(
            eq(schema.personas.id, effectivePersonaId),
            eq(schema.personas.organizationId, orgId),
          ),
        )
        .limit(1);
      persona = rows[0]?.systemPrompt ?? null;
    }
    // DEFAULT VOICE = Hanna. When no persona is set (campaign or per-reply), drafts
    // are still written in Hanna's voice/pattern (our standing response identity).
    if (!persona) {
      persona = (await this.hannaPersona(orgId))?.systemPrompt ?? null;
    }
    const notes = await this.db
      .select({ note: schema.engageTraining.note })
      .from(schema.engageTraining)
      .where(
        and(
          eq(schema.engageTraining.organizationId, orgId),
          eq(schema.engageTraining.active, true),
          or(
            isNull(schema.engageTraining.aimId),
            eq(schema.engageTraining.aimId, aim.id),
          ),
        ),
      )
      .orderBy(asc(schema.engageTraining.createdAt));
    return { persona, guidance: notes.map((n) => n.note) };
  }

  // Call reply_glock for one inbound reply; returns its parsed output (or null).
  // `proposedSlots` is the set of times already offered to this lead (from the reply
  // row): the agent reads them back to decide whether the lead ACCEPTED one or
  // COUNTER-proposed, and returns its verdict in `scheduling`.
  private async classifyAndDraft(
    aim: typeof schema.reachAims.$inferSelect,
    lead: { company: string; email: string | null; contactName: string | null },
    inbound: ThreadMsg,
    thread: ThreadMsg[],
    drafting: { persona: string | null; guidance: string[] } = {
      persona: null,
      guidance: [],
    },
    proposedSlots: Slot[] = [],
  ): Promise<{
    status: string;
    confidence: number;
    reasoning: string;
    recommendedAction: string;
    draftSubject: string;
    draftBody: string;
    followUpWindow: string | null;
    citations: string[];
    scheduling: SchedulingVerdict;
  } | null> {
    // Ground the agent's time parsing: the actual current instant + the org's timezone,
    // so "Friday this week at 10:00 CET" resolves correctly (and not to a quoted footer
    // timestamp). Resolved per-scan-lead — a single indexed org_config read, dwarfed by
    // the LLM call.
    const { primary: orgTimeZone } = await this.calendar.getOrgTimeZones(aim.organizationId);

    // RAG: pull the company-knowledge snippets most relevant to this inbound message so
    // the drafter can ground (and cite) an UNSURE reply. Best-effort — retrieval never
    // blocks drafting. The retrieved sources become the reply's citations.
    const knowledge = await this.knowledge.retrieve(
      aim.organizationId,
      `${inbound.subject ?? ''}\n${inbound.body}`,
      4,
    );
    const citations = [...new Set(knowledge.map((k) => k.source))];

    const input = {
      reply_id: `${aim.id}:${inbound.id}`,
      campaign_id: aim.id,
      sender_name: lead.contactName ?? lead.company,
      sender_email: lead.email ?? '',
      company: lead.company,
      subject: inbound.subject ?? '(no subject)',
      body: inbound.body.slice(0, THREAD_BODY_MAX),
      received_at: new Date(inbound.internalMs).toISOString(),
      now: new Date().toISOString(),
      timezone: orgTimeZone,
      proposed_slots: proposedSlots,
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
      persona: drafting.persona,
      guidance: drafting.guidance,
      knowledge: knowledge.map((k) => ({ source: k.source, text: k.text })),
    };

    const result = await this.agent.run('engage.reply_glock', input);
    const o = result.output as Record<string, unknown>;
    const draft = (o.draft ?? {}) as Record<string, unknown>;
    const status = String(o.status ?? 'UNSURE').toUpperCase();
    const sched = (o.scheduling ?? {}) as Record<string, unknown>;
    return {
      status: status in UI_CATEGORY ? status : 'UNSURE',
      confidence: typeof o.confidence === 'number' ? o.confidence : 0,
      reasoning: String(o.reasoning ?? ''),
      recommendedAction: String(o.recommended_action ?? 'MANUAL_REVIEW'),
      draftSubject: String(draft.subject ?? inbound.subject ?? ''),
      draftBody: enforceSignature(String(draft.body ?? '')),
      followUpWindow:
        typeof o.follow_up_date_or_window === 'string' ? o.follow_up_date_or_window : null,
      // The KB sources we grounded this draft on (only when the model actually drafted
      // from them — UNSURE replies). Surfaced in the UI as citations.
      citations: status === 'UNSURE' ? citations : [],
      scheduling: {
        accepted_index:
          typeof sched.accepted_index === 'number' ? sched.accepted_index : null,
        counter_time:
          typeof sched.counter_time === 'string' ? sched.counter_time : null,
      },
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
      citations?: string[];
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
      citations: (out.citations ?? []) as never,
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
          citations: values.citations,
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

    // The org's display zones (same the calendar/email use) so the UI renders meeting
    // times dual-zone with a timezone label instead of the viewer's browser-local time.
    const { primary: timeZone, secondary: secondaryTimeZone } =
      await this.calendar.getOrgTimeZones(orgId);

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
      // Per-email persona override (null = campaign/default voice).
      personaId: r.personaId ?? null,
      handled: r.handled,
      // --- meeting loop (propose → accept/counter → book) ---
      meetingStatus: r.meetingStatus,
      proposedSlots: r.proposedSlots ?? [],
      acceptedSlot: r.acceptedSlot ?? null,
      bookedMeetingId: r.bookedMeetingId ?? null,
      timeZone,
      secondaryTimeZone,
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

  // --- PERSONA (F4) ---------------------------------------------------------
  // The org's drafting personas (the same `personas` Activate uses for coaching).
  async listPersonas(orgId: string) {
    return this.db
      .select({ id: schema.personas.id, name: schema.personas.name })
      .from(schema.personas)
      .where(eq(schema.personas.organizationId, orgId))
      .orderBy(asc(schema.personas.name));
  }

  // The org's "Hanna Nguyen" persona (the default response voice), if it exists.
  private async hannaPersona(
    orgId: string,
  ): Promise<{ id: string; systemPrompt: string } | null> {
    const rows = await this.db
      .select({ id: schema.personas.id, systemPrompt: schema.personas.systemPrompt })
      .from(schema.personas)
      .where(
        and(
          eq(schema.personas.organizationId, orgId),
          eq(schema.personas.name, 'Hanna Nguyen'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // Create a new drafting persona (the "+" beside the Draft-persona toggle). `rules`
  // is the voice/style instruction the drafter writes in (stored as system_prompt).
  // Returns the picker shape so the UI can select it immediately. Rejects duplicate
  // names within the org so the picker stays unambiguous.
  async createPersona(orgId: string, name: string, rules: string) {
    const cleanName = name.trim();
    const cleanRules = rules.trim();
    if (!cleanName) throw new BadRequestException('Persona name is required.');
    if (!cleanRules) throw new BadRequestException('Persona rules are required.');
    const existing = await this.db
      .select({ id: schema.personas.id })
      .from(schema.personas)
      .where(
        and(
          eq(schema.personas.organizationId, orgId),
          eq(schema.personas.name, cleanName),
        ),
      )
      .limit(1);
    if (existing[0]) {
      throw new BadRequestException(`A persona named "${cleanName}" already exists.`);
    }
    const rows = await this.db
      .insert(schema.personas)
      .values({ organizationId: orgId, name: cleanName, systemPrompt: cleanRules })
      .returning({ id: schema.personas.id, name: schema.personas.name });
    return rows[0]!;
  }

  // One persona's full detail incl. its voice rules (system_prompt) — for the edit
  // dialog, which needs the current rules to extend them.
  async getPersona(orgId: string, id: string) {
    const rows = await this.db
      .select({
        id: schema.personas.id,
        name: schema.personas.name,
        rules: schema.personas.systemPrompt,
      })
      .from(schema.personas)
      .where(
        and(eq(schema.personas.id, id), eq(schema.personas.organizationId, orgId)),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Unknown persona');
    return rows[0];
  }

  // Edit an existing persona's name and/or voice rules. Org-scoped; rejects a name
  // collision with a DIFFERENT persona. Returns the picker shape.
  async updatePersona(
    orgId: string,
    id: string,
    updates: { name?: string; rules?: string },
  ) {
    const existing = await this.getPersona(orgId, id); // 404s if not in the org
    const set: { name?: string; systemPrompt?: string } = {};
    if (updates.name !== undefined) {
      const cleanName = updates.name.trim();
      if (!cleanName) throw new BadRequestException('Persona name is required.');
      if (cleanName.toLowerCase() !== existing.name.toLowerCase()) {
        const dup = await this.db
          .select({ id: schema.personas.id })
          .from(schema.personas)
          .where(
            and(
              eq(schema.personas.organizationId, orgId),
              eq(schema.personas.name, cleanName),
            ),
          )
          .limit(1);
        if (dup[0]) {
          throw new BadRequestException(`A persona named "${cleanName}" already exists.`);
        }
      }
      set.name = cleanName;
    }
    if (updates.rules !== undefined) {
      const cleanRules = updates.rules.trim();
      if (!cleanRules) throw new BadRequestException('Persona rules are required.');
      set.systemPrompt = cleanRules;
    }
    const rows = await this.db
      .update(schema.personas)
      .set(set)
      .where(
        and(eq(schema.personas.id, id), eq(schema.personas.organizationId, orgId)),
      )
      .returning({ id: schema.personas.id, name: schema.personas.name });
    return rows[0]!;
  }

  // Set (or clear) the drafting persona for a campaign. personaId null = default voice.
  async setCampaignPersona(orgId: string, aimId: string, personaId: string | null) {
    const resolved = await this.resolveCampaign(orgId, aimId);
    if (!resolved) throw new NotFoundException('Unknown campaign');
    if (personaId) {
      const owns = await this.db
        .select({ id: schema.personas.id })
        .from(schema.personas)
        .where(
          and(
            eq(schema.personas.id, personaId),
            eq(schema.personas.organizationId, orgId),
          ),
        )
        .limit(1);
      if (!owns[0]) throw new BadRequestException('Unknown persona');
    }
    await this.db
      .update(schema.reachAims)
      .set({ personaId, updatedAt: new Date() })
      .where(and(tenantScope(orgId, schema.reachAims), eq(schema.reachAims.id, aimId)));
    return { ok: true, personaId };
  }

  // --- TRAINING (F3) --------------------------------------------------------
  // "Teach the AI" notes for a campaign (active first, newest last).
  async listTraining(orgId: string, aimId: string) {
    return this.db
      .select({
        id: schema.engageTraining.id,
        note: schema.engageTraining.note,
        source: schema.engageTraining.source,
        active: schema.engageTraining.active,
        createdAt: schema.engageTraining.createdAt,
      })
      .from(schema.engageTraining)
      .where(
        and(
          eq(schema.engageTraining.organizationId, orgId),
          or(
            isNull(schema.engageTraining.aimId),
            eq(schema.engageTraining.aimId, aimId),
          ),
        ),
      )
      .orderBy(desc(schema.engageTraining.createdAt));
  }

  // Persist a piece of operator feedback the draft agent should always apply, AND fold
  // it into the SELECTED persona's rules so the persona itself evolves with the feedback
  // (the "make the LLM remember" → update the rule). The note is appended under a managed
  // "LEARNED PREFERENCES" block in the persona's system_prompt. `targetPersonaId` is the
  // persona chosen for the reply (per-email); when null it falls back to the campaign's
  // persona, and when that's unset, the default Hanna.
  async addTraining(
    orgId: string,
    aimId: string,
    note: string,
    targetPersonaId: string | null = null,
  ) {
    const resolved = await this.resolveCampaign(orgId, aimId);
    if (!resolved) throw new NotFoundException('Unknown campaign');
    const trimmed = note.trim();
    if (!trimmed) throw new BadRequestException('Note is empty');
    const rows = await this.db
      .insert(schema.engageTraining)
      .values({ organizationId: orgId, aimId, note: trimmed, source: 'feedback' })
      .returning({ id: schema.engageTraining.id });

    // The persona this feedback adjusts: the one selected for the reply, else the
    // campaign default (appendPersonaRule falls back to Hanna when both are unset).
    const personaId = targetPersonaId ?? resolved.aim.personaId;
    // Rephrase the raw note into a clean, declarative persona rule via the agent, then
    // append THAT to the persona's system prompt (so the learned preference reads well
    // as a standing instruction). The raw note stays in engage_training for audit.
    const rule = await this.refineTrainingNote(orgId, personaId, resolved.aim, trimmed);
    await this.appendPersonaRule(orgId, personaId, rule);

    return { ok: true, id: rows[0]?.id ?? null, rule };
  }

  // Turn the operator's raw "teach the AI" note into a single persona rule via the
  // engage.refine_training agent. Best-effort: if the agent isn't configured or errors,
  // fall back to the raw note so the preference is never dropped.
  private async refineTrainingNote(
    orgId: string,
    personaId: string | null,
    aim: typeof schema.reachAims.$inferSelect,
    note: string,
  ): Promise<string> {
    if (!this.agent.isConfigured()) return note;
    try {
      let personaName: string | null = null;
      if (personaId) {
        const prows = await this.db
          .select({ name: schema.personas.name })
          .from(schema.personas)
          .where(
            and(
              eq(schema.personas.id, personaId),
              eq(schema.personas.organizationId, orgId),
            ),
          )
          .limit(1);
        personaName = prows[0]?.name ?? null;
      }
      const result = await this.agent.run('engage.refine_training', {
        note,
        persona_name: personaName,
        campaign_context:
          [aim.name, aim.niche].filter(Boolean).join(' · ') || null,
      });
      const rule =
        typeof result.output?.rule === 'string' ? result.output.rule.trim() : '';
      return rule || note;
    } catch (err) {
      this.logger.warn(
        `refine_training failed, using raw note: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return note;
    }
  }

  // Append a learned preference to a persona's system_prompt under a managed block, so
  // operator feedback ("make the LLM remember …") becomes part of the persona's rules.
  // Targets the given persona, falling back to the default Hanna persona. No-op if
  // neither exists, or if the exact line is already present (idempotent).
  private async appendPersonaRule(
    orgId: string,
    personaId: string | null,
    note: string,
  ): Promise<void> {
    let target: { id: string; systemPrompt: string } | null = null;
    if (personaId) {
      const rows = await this.db
        .select({ id: schema.personas.id, systemPrompt: schema.personas.systemPrompt })
        .from(schema.personas)
        .where(
          and(
            eq(schema.personas.id, personaId),
            eq(schema.personas.organizationId, orgId),
          ),
        )
        .limit(1);
      target = rows[0] ?? null;
    }
    if (!target) target = await this.hannaPersona(orgId);
    if (!target) return;

    const marker = '\n\nLEARNED PREFERENCES (from operator feedback):';
    const line = `- ${note}`;
    if (target.systemPrompt.includes(line)) return; // already captured
    const next = target.systemPrompt.includes(marker)
      ? `${target.systemPrompt}\n${line}`
      : `${target.systemPrompt}${marker}\n${line}`;
    await this.db
      .update(schema.personas)
      .set({ systemPrompt: next })
      .where(eq(schema.personas.id, target.id));
  }

  // Deactivate a training note (kept for audit, no longer applied).
  async removeTraining(orgId: string, id: string) {
    await this.db
      .update(schema.engageTraining)
      .set({ active: false })
      .where(
        and(
          eq(schema.engageTraining.organizationId, orgId),
          eq(schema.engageTraining.id, id),
        ),
      );
    return { ok: true };
  }

  // --- RE-DRAFT (F3 "Write & Fix") ------------------------------------------
  // Interactive revision of a reply's current draft per an operator instruction.
  // Skips re-classification; re-runs reply_glock's drafter with the instruction +
  // current draft + the campaign's persona and learned notes, then persists.
  async redraftReply(orgId: string, replyId: string, instruction: string) {
    const trimmed = (instruction ?? '').trim();
    if (!trimmed) throw new BadRequestException('Instruction is empty');
    const row = await this.ownedReply(orgId, replyId);
    const resolved = await this.resolveCampaign(orgId, row.aimId);
    if (!resolved) throw new NotFoundException('Unknown campaign');
    const { aim } = resolved;
    // Honor a per-reply persona override (set in the reply detail) when revising.
    const drafting = await this.loadDrafting(orgId, aim, row.personaId);
    const lead = (
      await this.db
        .select({
          company: schema.reachLeads.company,
          email: schema.reachLeads.email,
          contactName: schema.reachLeads.contactName,
        })
        .from(schema.reachLeads)
        .where(eq(schema.reachLeads.id, row.leadId))
        .limit(1)
    )[0];
    const threadSnap =
      (row.thread as { direction: string; subject?: string; body?: string }[] | null) ?? [];

    const input = {
      reply_id: `${aim.id}:redraft:${row.id}`,
      campaign_id: aim.id,
      sender_name: lead?.contactName ?? lead?.company ?? null,
      sender_email: lead?.email ?? '',
      company: lead?.company ?? '',
      subject: row.inboundSubject ?? '(no subject)',
      body: (row.inboundBody ?? '').slice(0, THREAD_BODY_MAX),
      previous_thread: threadSnap.map((m) => ({
        direction: m.direction,
        subject: m.subject ?? '',
        body: (m.body ?? '').slice(0, THREAD_BODY_MAX),
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
      persona: drafting.persona,
      guidance: drafting.guidance,
      instruction: trimmed,
      current_draft: { subject: row.draftSubject ?? '', body: row.draftBody ?? '' },
      // Known bucket → reply_glock skips re-classification on a re-draft.
      prior_status: row.category,
    };

    const prevBody = (row.draftBody ?? '').trim();
    const runOnce = async (): Promise<{ subject: string; body: string }> => {
      const result = await this.agent.run('engage.reply_glock', input);
      const o = (result?.output ?? {}) as Record<string, unknown>;
      const draft = (o.draft ?? {}) as Record<string, unknown>;
      return {
        subject: String(draft.subject ?? ''),
        body: enforceSignature(String(draft.body ?? '')),
      };
    };

    // Hermes is nondeterministic — one retry if the first pass comes back empty or
    // unchanged. Then FAIL LOUDLY rather than silently returning the old draft (the
    // bug that read as "the model isn't applying changes").
    let out = await runOnce();
    if (!out.body.trim() || out.body.trim() === prevBody) {
      out = await runOnce();
    }
    if (!out.body.trim()) {
      throw new BadRequestException(
        'The model did not return a revised draft. Please try again.',
      );
    }

    const draftSubject = out.subject.trim() || row.draftSubject || '';
    const draftBody = out.body;
    await this.db
      .update(schema.reachLeadReplies)
      .set({ draftSubject, draftBody, draftSource: 'reply_glock:redraft', updatedAt: new Date() })
      .where(eq(schema.reachLeadReplies.id, row.id));
    return { ok: true, draftSubject, draftBody };
  }

  // --- PER-EMAIL PERSONA ----------------------------------------------------
  // Set (or clear, personaId=null) the drafting persona for ONE reply. Persisted —
  // no redraft (the operator hits Redraft when ready). Validates persona ownership.
  async setReplyPersona(orgId: string, replyId: string, personaId: string | null) {
    const row = await this.ownedReply(orgId, replyId);
    if (personaId) {
      const owns = await this.db
        .select({ id: schema.personas.id })
        .from(schema.personas)
        .where(
          and(
            eq(schema.personas.id, personaId),
            eq(schema.personas.organizationId, orgId),
          ),
        )
        .limit(1);
      if (!owns[0]) throw new BadRequestException('Unknown persona');
    }
    await this.db
      .update(schema.reachLeadReplies)
      .set({ personaId, updatedAt: new Date() })
      .where(eq(schema.reachLeadReplies.id, row.id));
    return { ok: true, personaId };
  }

  // Re-draft ONE reply FRESH in its current per-reply persona (the operator picked it
  // in the reply detail and hit Redraft). Unlike "Write & Fix" there's no instruction
  // and no current_draft — reply_glock drafts anew in that voice, keeping the prior
  // classification (no re-sort). Persists the new draft.
  async redraftReplyInPersona(orgId: string, replyId: string) {
    const row = await this.ownedReply(orgId, replyId);
    const resolved = await this.resolveCampaign(orgId, row.aimId);
    if (!resolved) throw new NotFoundException('Unknown campaign');
    const { aim } = resolved;
    const drafting = await this.loadDrafting(orgId, aim, row.personaId);
    const lead = (
      await this.db
        .select({
          company: schema.reachLeads.company,
          email: schema.reachLeads.email,
          contactName: schema.reachLeads.contactName,
        })
        .from(schema.reachLeads)
        .where(eq(schema.reachLeads.id, row.leadId))
        .limit(1)
    )[0];
    const threadSnap =
      (row.thread as { direction: string; subject?: string; body?: string }[] | null) ?? [];

    const input = {
      reply_id: `${aim.id}:persona:${row.id}`,
      campaign_id: aim.id,
      sender_name: lead?.contactName ?? lead?.company ?? null,
      sender_email: lead?.email ?? '',
      company: lead?.company ?? '',
      subject: row.inboundSubject ?? '(no subject)',
      body: (row.inboundBody ?? '').slice(0, THREAD_BODY_MAX),
      previous_thread: threadSnap.map((m) => ({
        direction: m.direction,
        subject: m.subject ?? '',
        body: (m.body ?? '').slice(0, THREAD_BODY_MAX),
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
      persona: drafting.persona,
      guidance: drafting.guidance,
      // Keep the prior bucket so reply_glock skips re-classification and only drafts.
      prior_status: row.category,
    };

    const prevBody = (row.draftBody ?? '').trim();
    const runOnce = async (): Promise<{ subject: string; body: string }> => {
      const result = await this.agent.run('engage.reply_glock', input);
      const o = (result?.output ?? {}) as Record<string, unknown>;
      const draft = (o.draft ?? {}) as Record<string, unknown>;
      return {
        subject: String(draft.subject ?? ''),
        body: enforceSignature(String(draft.body ?? '')),
      };
    };

    let out = await runOnce();
    if (!out.body.trim() || out.body.trim() === prevBody) out = await runOnce();
    if (!out.body.trim()) {
      throw new BadRequestException(
        'The model did not return a draft. Please try again.',
      );
    }

    const draftSubject = out.subject.trim() || row.draftSubject || '';
    const draftBody = out.body;
    await this.db
      .update(schema.reachLeadReplies)
      .set({ draftSubject, draftBody, draftSource: 'reply_glock:persona', updatedAt: new Date() })
      .where(eq(schema.reachLeadReplies.id, row.id));
    return { ok: true, draftSubject, draftBody };
  }

  // --- REDRAFT ALL (F4 persona switch) --------------------------------------
  // Re-draft every UNHANDLED reply in a campaign in the campaign's CURRENT persona
  // voice. Used when the operator switches the Draft persona — the drafts on screen
  // should immediately reflect the new voice. Reuses redraftReply with a fixed
  // "refresh" instruction so reply_glock keeps the prior classification (no re-sort)
  // and only re-words the draft. Already-sent replies (handled) are left untouched.
  // SLOW: one LLM pass per reply (~35s on local Hermes); the caller shows a spinner.
  async redraftCampaign(orgId: string, aimId: string) {
    const resolved = await this.resolveCampaign(orgId, aimId);
    if (!resolved) throw new BadRequestException('Unknown campaign');

    const rows = await this.db
      .select({ id: schema.reachLeadReplies.id })
      .from(schema.reachLeadReplies)
      .where(
        and(
          tenantScope(orgId, schema.reachLeadReplies),
          eq(schema.reachLeadReplies.aimId, aimId),
          eq(schema.reachLeadReplies.handled, false),
        ),
      );

    let redrafted = 0;
    let failed = 0;
    for (const { id } of rows) {
      try {
        await this.redraftReply(orgId, id, PERSONA_REFRESH_INSTRUCTION);
        redrafted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Engage redraftCampaign reply ${id} failed: ${msg}`);
        failed++;
      }
    }
    return { redrafted, failed, total: rows.length };
  }

  // --- SEND -----------------------------------------------------------------
  // Send the (edited) draft to the lead via the campaign mailbox, threaded onto the
  // existing Gmail thread (In-Reply-To the last inbound message). Marks handled.
  async sendReply(
    orgId: string,
    replyId: string,
    subject: string,
    body: string,
    proposedSlot?: { start: string; end: string },
    proposedSlots?: { start: string; end: string }[],
    userId?: string,
  ) {
    const row = await this.ownedReply(orgId, replyId);
    const lead = (
      await this.db
        .select({
          email: schema.reachLeads.email,
          company: schema.reachLeads.company,
          contactName: schema.reachLeads.contactName,
        })
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

    // Ground the meeting time: when this reply offers slot(s), the body that goes out (and
    // is persisted) carries the system-rendered dual-zone time block — matching the invite.
    const offeredSlots: Slot[] = proposedSlots ?? (proposedSlot ? [proposedSlot] : []);
    const finalBody = await this.stampMeetingTime(orgId, body, offeredSlots);

    // PER-USER sender identity: resolve the operator who sent this reply and use THEIR
    // sender name + signature image. No org fallback — the signature image is null when
    // the user has none, and the From name degrades to the user's own account name, then
    // the product default (REPLY_FROM_NAME). `userId` is the authenticated operator from
    // the controller (optional only for back-compat — null resolves to the default).
    const sender = userId
      ? (
          await this.db
            .select({
              name: schema.users.name,
              senderName: schema.users.senderName,
              signatureImageUrl: schema.users.signatureImageUrl,
            })
            .from(schema.users)
            .where(
              and(
                tenantScope(orgId, schema.users),
                eq(schema.users.id, userId),
              ),
            )
            .limit(1)
        )[0] ?? null
      : null;
    const signatureImageUrl = sender?.signatureImageUrl ?? null;
    const raw = buildRawReply({
      to: lead.email,
      from: access.account.email,
      fromName: sender?.senderName || sender?.name || REPLY_FROM_NAME,
      subject: subject || row.inboundSubject || '(no subject)',
      body: finalBody,
      inReplyTo,
      references: inReplyTo,
      signatureImageUrl,
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
      .set({ handled: true, sentAt: new Date(), draftBody: finalBody, draftSubject: subject, updatedAt: new Date() })
      .where(eq(schema.reachLeadReplies.id, row.id));

    // Record the slots offered to the lead in this round so a later scan can resolve
    // their accept/counter reply against them. PROPOSED drives the reply-card banner.
    // Org-scoped; the row is already asserted in-org by ownedReply above.
    if (proposedSlots?.length) {
      await this.db
        .update(schema.reachLeadReplies)
        .set({ proposedSlots, meetingStatus: 'PROPOSED', updatedAt: new Date() })
        .where(
          and(
            tenantScope(orgId, schema.reachLeadReplies),
            eq(schema.reachLeadReplies.id, row.id),
          ),
        );
    }

    // Optional: book a tentative intro call on the org's calendar for the proposed
    // slot, with the lead as attendee. BEST-EFFORT — a calendar failure must NOT fail
    // the send (the reply already went out). createEvent itself never throws (it
    // degrades to { ok:false }); the try/catch guards anything unexpected.
    let meeting: { ok: boolean; eventId: string | null; htmlLink: string | null } | null = null;
    if (proposedSlot) {
      try {
        const { primary } = await this.calendar.getOrgTimeZones(orgId);
        const res = await this.calendar.createEvent(orgId, {
          title: `EVERTRUST × ${lead.company} — intro call`,
          start: proposedSlot.start,
          end: proposedSlot.end,
          timeZone: primary,
          attendees: [{ email: lead.email }],
          addGoogleMeet: true,
        });
        if (!res.ok) {
          this.logger.warn(`Engage sendReply meeting-create degraded for reply ${row.id}: ${res.reason}`);
        }
        meeting = { ok: res.ok, eventId: res.eventId, htmlLink: res.htmlLink };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Engage sendReply meeting-create failed for reply ${row.id}: ${msg}`);
        meeting = { ok: false, eventId: null, htmlLink: null };
      }
    }

    // Option B — book on send of the ACCEPT confirmation: when this reply confirms an agreed
    // slot, create the real calendar event (client invited + Meet) and flip it to BOOKED now,
    // so "I've added our call to my calendar" is true exactly when that email goes out. Runs
    // only when the proposed-slot path above didn't (the two states are mutually exclusive).
    if (!meeting && row.meetingStatus === 'ACCEPTED' && row.acceptedSlot && !row.bookedMeetingId) {
      meeting = await this.bookOnAccept(orgId, row, lead, access.account.email);
    }

    return { ok: true, meeting };
  }

  // Book the agreed slot for real when the ACCEPT confirmation is sent: create the calendar
  // event (client invited + Google Meet), record a linked meetings row (idempotent on
  // org+eventId), and flip the reply to BOOKED. Best-effort — a calendar failure must NOT
  // fail the send (the confirmation already went out); it returns { ok:false } and leaves the
  // reply ACCEPTED so it can still be booked manually. Returns null if there's nothing to book.
  private async bookOnAccept(
    orgId: string,
    reply: { id: string; meetingStatus: string | null; acceptedSlot: Slot | null },
    lead: { company: string; email: string | null; contactName: string | null },
    ownerEmail: string,
  ): Promise<{ ok: boolean; eventId: string | null; htmlLink: string | null } | null> {
    const slot = reply.acceptedSlot;
    if (!slot) return null;
    try {
      const { primary } = await this.calendar.getOrgTimeZones(orgId);
      const title = `EVERTRUST × ${lead.company} — intro call`;
      const created = await this.calendar.createEvent(orgId, {
        title,
        start: slot.start,
        end: slot.end,
        timeZone: primary,
        attendees: lead.email ? [{ email: lead.email }] : [],
        addGoogleMeet: true,
      });
      if (!created.ok || !created.eventId) {
        this.logger.warn(
          `Engage bookOnAccept: calendar create degraded for reply ${reply.id}: ${created.reason}`,
        );
        return { ok: false, eventId: null, htmlLink: null };
      }
      const docUrl = created.meetingUrl ?? created.htmlLink ?? null;
      const inserted = await this.db
        .insert(schema.meetings)
        .values({
          organizationId: orgId,
          sessionId: created.eventId,
          title,
          clientCompany: lead.company,
          aeName: ownerEmail,
          clientContact: lead.contactName,
          clientEmail: lead.email,
          meetingDate: slot.start,
          transcript: null,
          docUrl,
          matchMethod: 'engage_booking',
        })
        .onConflictDoUpdate({
          target: [schema.meetings.organizationId, schema.meetings.sessionId],
          set: { title, meetingDate: slot.start, docUrl, updatedAt: new Date() },
        })
        .returning({ id: schema.meetings.id });
      const meetingId = inserted[0]?.id;
      if (meetingId) {
        await this.db
          .update(schema.reachLeadReplies)
          .set({ meetingStatus: 'BOOKED', bookedMeetingId: meetingId, updatedAt: new Date() })
          .where(
            and(
              tenantScope(orgId, schema.reachLeadReplies),
              eq(schema.reachLeadReplies.id, reply.id),
            ),
          );
      }
      return { ok: true, eventId: created.eventId, htmlLink: created.meetingUrl ?? created.htmlLink };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Engage bookOnAccept failed for reply ${reply.id}: ${msg}`);
      return { ok: false, eventId: null, htmlLink: null };
    }
  }

  // --- MARK BOOKED ----------------------------------------------------------
  // The operator confirmed the meeting in Activate and hands its id back. Mark the
  // reply BOOKED and link the meeting. Org-scoped; idempotent (a re-mark is a no-op).
  // When the reply's campaign (aim.campaignId) is set, also stamp the meeting's
  // campaign_id so the call threads into the CRM under that campaign. Leaves the
  // meeting unattributed when the campaign has no linked CRM campaign.
  async markBooked(orgId: string, replyId: string, meetingId: string) {
    const row = await this.ownedReply(orgId, replyId); // 404/400s if not in the org
    if (row.meetingStatus === 'BOOKED') {
      return { ok: true, meetingStatus: 'BOOKED', bookedMeetingId: row.bookedMeetingId };
    }

    // Never trust a client-supplied meeting id — verify it belongs to this org before
    // linking it (the FK only proves the meeting exists in SOME tenant). Multi-tenant
    // invariant: every write resolves organizationId.
    const meetingRows = await this.db
      .select({ id: schema.meetings.id })
      .from(schema.meetings)
      .where(
        and(tenantScope(orgId, schema.meetings), eq(schema.meetings.id, meetingId)),
      )
      .limit(1);
    if (!meetingRows[0]) throw new BadRequestException('Meeting not found');

    await this.db
      .update(schema.reachLeadReplies)
      .set({ meetingStatus: 'BOOKED', bookedMeetingId: meetingId, updatedAt: new Date() })
      .where(
        and(
          tenantScope(orgId, schema.reachLeadReplies),
          eq(schema.reachLeadReplies.id, row.id),
        ),
      );

    // Link the meeting to the reply's campaign so the call shows under the campaign in
    // the CRM. Resolve the aim (org-scoped) → its campaignId; skip when unattributed.
    const aimRows = await this.db
      .select({ campaignId: schema.reachAims.campaignId })
      .from(schema.reachAims)
      .where(
        and(tenantScope(orgId, schema.reachAims), eq(schema.reachAims.id, row.aimId)),
      )
      .limit(1);
    const campaignId = aimRows[0]?.campaignId ?? null;
    if (campaignId) {
      await this.db
        .update(schema.meetings)
        .set({ campaignId })
        .where(
          and(
            tenantScope(orgId, schema.meetings),
            eq(schema.meetings.id, meetingId),
          ),
        );
    }

    return { ok: true, meetingStatus: 'BOOKED', bookedMeetingId: meetingId };
  }

  // The org's proposed free meeting slots for a campaign — resolves the aim (org-scoped)
  // then returns GoogleCalendarReadService.freeSlots for the org's default calendar.
  // freeSlots reads the org DEFAULT calendar mailbox (no per-account targeting), which
  // is the desired behaviour here. Never throws — degrades to a configured:false shell.
  async campaignFreeSlots(orgId: string, aimId: string): Promise<CalendarFreeSlotsDto> {
    const resolved = await this.resolveCampaign(orgId, aimId);
    if (!resolved) throw new BadRequestException('Unknown campaign');
    return this.calendar.freeSlots(orgId);
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
      const errBody = await listRes.text().catch(() => '');
      throw new Error(`Gmail list HTTP ${listRes.status}: ${errBody.slice(0, 300)}`);
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
