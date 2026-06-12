import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { CreateOutreachMessageDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { writeMachineAudit } from '../common/machine-audit';

type OutreachMessageRow = typeof schema.outreachMessages.$inferSelect;

// Filters for the conversation-ledger read (RAG Agent + Reply Glock thread pull).
export interface OutreachMessageListFilters {
  prospectId?: string;
  gmailThreadId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

// The conversation ledger, both directions (outreach_messages): Bazooka sends
// (OUTBOUND) and the Gmail poller's replies (INBOUND). Idempotent on
// gmailMessageId so re-polled threads upsert instead of double-inserting. Machine
// route — org inherited via the parent prospect; writes audited (actorType N8N).
@Injectable()
export class OutreachMessagesService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // Record a send/reply. With a gmailMessageId the row UPSERTS on it (on conflict
  // status/subject/bodySnippet/sentAt update — a re-poll must not double-insert);
  // without one it is a plain insert. 404 if the prospect is unknown. Audited.
  async create(input: CreateOutreachMessageDto): Promise<OutreachMessageRow> {
    const prospect = await this.requireProspect(input.prospectId);
    const sentAt = input.sentAt ? new Date(input.sentAt) : null;

    // Upsert path: re-polled Gmail threads carry the same gmailMessageId.
    if (input.gmailMessageId) {
      const existing = await this.db
        .select()
        .from(schema.outreachMessages)
        .where(eq(schema.outreachMessages.gmailMessageId, input.gmailMessageId))
        .limit(1);
      if (existing[0]) {
        const updated = await this.db
          .update(schema.outreachMessages)
          .set({
            status: input.status,
            subject: input.subject ?? existing[0].subject,
            bodySnippet: input.bodySnippet ?? existing[0].bodySnippet,
            sentAt: sentAt ?? existing[0].sentAt,
          })
          .where(eq(schema.outreachMessages.id, existing[0].id))
          .returning();
        const row = updated[0] ?? existing[0];
        await writeMachineAudit(this.db, {
          organizationId: prospect.organizationId,
          entity: 'outreach_messages',
          entityId: row.id,
          action: 'UPSERT',
          before: existing[0],
          after: row,
        });
        return row;
      }
    }

    const inserted = await this.db
      .insert(schema.outreachMessages)
      .values({
        prospectId: input.prospectId,
        direction: input.direction,
        status: input.status,
        gmailMessageId: input.gmailMessageId ?? null,
        gmailThreadId: input.gmailThreadId ?? null,
        subject: input.subject ?? null,
        bodySnippet: input.bodySnippet ?? null,
        templateAssetId: input.templateAssetId ?? null,
        sentAt,
        error: input.error ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to record outreach message');

    await writeMachineAudit(this.db, {
      organizationId: prospect.organizationId,
      entity: 'outreach_messages',
      entityId: row.id,
      action: 'CREATE',
      after: row,
    });
    return row;
  }

  // The JWT conversation timeline for the UI — ORG-SCOPED. The prospect must be in
  // `orgId` (404 otherwise), then its messages are returned newest-first. Defaults
  // to 50 rows. (The ledger has no own organizationId; tenancy is via the prospect.)
  async listForOrg(
    orgId: string,
    prospectId: string,
    limit?: number,
  ): Promise<OutreachMessageRow[]> {
    // Confine to the tenant: the prospect must belong to the caller's org.
    const pr = await this.db
      .select({ organizationId: schema.prospects.organizationId })
      .from(schema.prospects)
      .where(eq(schema.prospects.id, prospectId))
      .limit(1);
    if (!pr[0] || pr[0].organizationId !== orgId) {
      throw new NotFoundException(`No prospect for id ${prospectId}`);
    }
    return this.list({ prospectId, limit });
  }

  // The conversation ledger for a prospect/thread, newest-first. Used by the RAG
  // Agent + Reply Glock to assemble thread context. Defaults to 50 rows.
  async list(
    filters: OutreachMessageListFilters,
  ): Promise<OutreachMessageRow[]> {
    const conds = [];
    if (filters.prospectId) {
      conds.push(eq(schema.outreachMessages.prospectId, filters.prospectId));
    }
    if (filters.gmailThreadId) {
      conds.push(
        eq(schema.outreachMessages.gmailThreadId, filters.gmailThreadId),
      );
    }
    // Build the base query, applying the SQL filters only when present (a bare
    // .where(undefined) is a no-op in Drizzle but the test fake can't parse it).
    const base = this.db.select().from(schema.outreachMessages);
    const scoped = conds.length ? base.where(and(...conds)) : base;
    const rows = await scoped.orderBy(desc(schema.outreachMessages.createdAt));

    const limit =
      filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
    return rows.slice(0, limit);
  }

  private async requireProspect(
    id: string,
  ): Promise<typeof schema.prospects.$inferSelect> {
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
