import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  ProspectStatus,
  ReplyClassificationDtoRead,
  ReplyDraftDto,
  ReplyVerdict,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { writeMachineAudit } from '../common/machine-audit';

type ProspectRow = typeof schema.prospects.$inferSelect;

export interface ReplyClassificationInput {
  prospectId: string;
  messageId?: string;
  verdict: ReplyVerdict;
  snoozeUntil?: string;
  model?: string;
  raw?: unknown;
  suggestedReply?: string;
}

// Filters for the verdict-log read (RAG agent backlog + verdict pulls).
export interface ReplyClassificationListFilters {
  verdict?: ReplyVerdict;
  prospectId?: string;
  needsRag?: boolean;
  limit?: number;
}

// Filters for the JWT draft-review queue (the UI). prospectId narrows to one
// conversation; limit caps the page. Always org-scoped by the caller.
export interface ReplyDraftQueueFilters {
  prospectId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

// How a verdict projects onto prospects.status. UNSURE / AUTO_REPLY / BOUNCE leave
// the status untouched (null = no change) — they are evidence, not a state move.
// NOTE: graduation to a CRM lead on INTERESTED is intentionally NOT done here — a
// later step owns lead creation; this service only projects the funnel status.
const VERDICT_STATUS: Record<ReplyVerdict, ProspectStatus | null> = {
  INTERESTED: 'INTERESTED',
  NOT_INTERESTED: 'NOT_INTERESTED',
  SNOOZE: 'NOT_INTERESTED',
  MEETING_REQUEST: 'MEETING_SCHEDULED',
  UNSURE: null,
  AUTO_REPLY: null,
  BOUNCE: null,
};

// Append-only AI verdict log (Reply Glock + the RAG UNSURE pass). Each row is
// inserted as evidence AND projected onto the parent prospect's status. Machine
// route — org derived from the prospect; audited (actorType N8N).
@Injectable()
export class ReplyClassificationsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  async create(
    input: ReplyClassificationInput,
  ): Promise<{ id: string; prospectId: string; status: ProspectStatus }> {
    const prospect = await this.requireProspect(input.prospectId);

    const snoozeUntil = input.snoozeUntil ? new Date(input.snoozeUntil) : null;
    const inserted = await this.db
      .insert(schema.replyClassifications)
      .values({
        prospectId: input.prospectId,
        messageId: input.messageId ?? null,
        verdict: input.verdict,
        snoozeUntil,
        model: input.model ?? null,
        raw: (input.raw ?? null) as never,
        suggestedReply: input.suggestedReply ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to record reply classification');

    // Project the verdict onto the prospect's funnel status (+ snooze for SNOOZE).
    const nextStatus = VERDICT_STATUS[input.verdict];
    let status: ProspectStatus = prospect.status;
    if (nextStatus) {
      const patch: Partial<typeof schema.prospects.$inferInsert> = {
        status: nextStatus,
        updatedAt: new Date(),
      };
      // A SNOOZE re-engage time is copied onto the prospect so the snooze sweep
      // (GET /prospects?snoozeDue=true) can find it.
      if (input.verdict === 'SNOOZE' && snoozeUntil) {
        patch.snoozeUntil = snoozeUntil;
      }
      const updated = await this.db
        .update(schema.prospects)
        .set(patch)
        .where(eq(schema.prospects.id, input.prospectId))
        .returning();
      status = updated[0]?.status ?? nextStatus;
    }

    await writeMachineAudit(this.db, {
      organizationId: prospect.organizationId,
      entity: 'reply_classifications',
      entityId: row.id,
      action: 'CREATE',
      after: {
        prospectId: input.prospectId,
        verdict: input.verdict,
        status,
      },
    });
    return { id: row.id, prospectId: input.prospectId, status };
  }

  // The verdict log, joined with prospect context (email + campaignId), newest
  // first. `needsRag=true` is the RAG drafting backlog: UNSURE rows whose prospect
  // has NO sibling row (any verdict, same prospectId) carrying a non-null
  // suggestedReply yet — once the RAG agent POSTs a row WITH a suggestedReply, the
  // prospect drops out of the backlog. Defaults to 50 rows.
  async list(
    filters: ReplyClassificationListFilters,
  ): Promise<ReplyClassificationDtoRead[]> {
    // needsRag forces verdict=UNSURE (the only verdict the RAG agent drafts for).
    const verdict = filters.needsRag ? 'UNSURE' : filters.verdict;

    const conds = [];
    if (verdict) {
      conds.push(eq(schema.replyClassifications.verdict, verdict));
    }
    if (filters.prospectId) {
      conds.push(eq(schema.replyClassifications.prospectId, filters.prospectId));
    }
    const base = this.db.select().from(schema.replyClassifications);
    const scoped = conds.length ? base.where(and(...conds)) : base;
    let rows = await scoped.orderBy(desc(schema.replyClassifications.createdAt));

    if (filters.needsRag) {
      // Prospects that already have a drafted answer (a non-null suggestedReply on
      // ANY of their classification rows) are no longer in the backlog.
      const drafted = await this.db
        .select({
          prospectId: schema.replyClassifications.prospectId,
          suggestedReply: schema.replyClassifications.suggestedReply,
        })
        .from(schema.replyClassifications);
      const answered = new Set(
        drafted
          .filter((r) => r.suggestedReply != null)
          .map((r) => r.prospectId),
      );
      rows = rows.filter((r) => !answered.has(r.prospectId));
    }

    const limit =
      filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
    rows = rows.slice(0, limit);

    // Join the parent prospect (email + campaignId) — the log carries no
    // campaignId of its own; it is inherited via the prospect. Cache per prospect.
    const prospectCache = new Map<string, ProspectRow | null>();
    const out: ReplyClassificationDtoRead[] = [];
    for (const r of rows) {
      let prospect = prospectCache.get(r.prospectId);
      if (prospect === undefined) {
        const pr = await this.db
          .select()
          .from(schema.prospects)
          .where(eq(schema.prospects.id, r.prospectId))
          .limit(1);
        prospect = pr[0] ?? null;
        prospectCache.set(r.prospectId, prospect);
      }
      // A FK guarantees the prospect exists; skip defensively if it somehow does not.
      if (!prospect) continue;
      out.push({
        id: r.id,
        prospectId: r.prospectId,
        messageId: r.messageId,
        verdict: r.verdict,
        snoozeUntil: r.snoozeUntil ? r.snoozeUntil.toISOString() : null,
        model: r.model,
        suggestedReply: r.suggestedReply,
        createdAt: r.createdAt.toISOString(),
        prospectEmail: prospect.email,
        campaignId: prospect.campaignId,
      });
    }
    return out;
  }

  // The JWT DRAFT-REVIEW QUEUE (the UI): reply_classifications rows that HAVE a
  // non-null suggestedReply (the RAG agent drafted an answer a human now reviews),
  // ORG-SCOPED via the parent prospect. Each row carries prospect context (email +
  // companyName + campaignId) and the prospect's LATEST verdict. Newest-first;
  // optional prospectId narrows to one conversation. Defaults to 50 rows.
  async draftQueue(
    orgId: string,
    filters: ReplyDraftQueueFilters,
  ): Promise<ReplyDraftDto[]> {
    const conds = [];
    if (filters.prospectId) {
      conds.push(eq(schema.replyClassifications.prospectId, filters.prospectId));
    }
    const base = this.db.select().from(schema.replyClassifications);
    const scoped = conds.length ? base.where(and(...conds)) : base;
    const allRows = await scoped.orderBy(
      desc(schema.replyClassifications.createdAt),
    );

    // Only DRAFTED rows (a non-null suggestedReply) are in the review queue.
    const drafted = allRows.filter((r) => r.suggestedReply != null);

    // Resolve the parent prospect per row (cache) — needed for the org filter AND
    // the joined context. A prospect NOT in `orgId` drops the row (org isolation).
    const prospectCache = new Map<string, ProspectRow | null>();
    const getProspect = async (id: string): Promise<ProspectRow | null> => {
      let p = prospectCache.get(id);
      if (p === undefined) {
        const pr = await this.db
          .select()
          .from(schema.prospects)
          .where(eq(schema.prospects.id, id))
          .limit(1);
        p = pr[0] ?? null;
        prospectCache.set(id, p);
      }
      return p;
    };

    // The prospect's LATEST verdict (the newest classification row, any verdict).
    // allRows is already newest-first; the first row per prospect is the latest.
    const latestVerdict = new Map<string, ReplyVerdict>();
    for (const r of allRows) {
      if (!latestVerdict.has(r.prospectId)) {
        latestVerdict.set(r.prospectId, r.verdict);
      }
    }

    const limit = filters.limit && filters.limit > 0 ? filters.limit : 50;
    const out: ReplyDraftDto[] = [];
    for (const r of drafted) {
      if (out.length >= limit) break;
      const prospect = await getProspect(r.prospectId);
      if (!prospect || prospect.organizationId !== orgId) continue; // org isolation
      out.push({
        id: r.id,
        prospectId: r.prospectId,
        campaignId: prospect.campaignId,
        prospectEmail: prospect.email,
        prospectCompanyName: prospect.companyName,
        verdict: r.verdict,
        // suggestedReply is non-null here (drafted filter) — assert for the DTO.
        suggestedReply: r.suggestedReply as string,
        model: r.model,
        createdAt: r.createdAt.toISOString(),
        latestVerdict: latestVerdict.get(r.prospectId) ?? r.verdict,
      });
    }
    return out;
  }

  private async requireProspect(id: string): Promise<ProspectRow> {
    const rows = await this.db
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`No prospect for id ${id}`);
    return row;
  }
}
