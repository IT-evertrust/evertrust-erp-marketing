import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { CreateNotificationDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { writeMachineAudit } from '../common/machine-audit';

type NotificationRow = typeof schema.notifications.$inferSelect;

// In-app notification feed. Read/marked by the bell UI (JWT, org-scoped) and written
// by n8n (machine, org from campaignId) + ERP services. The bell polls unread
// (readAt IS NULL).
@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // The tenant's notifications, newest-first. `unread` limits to the bell's unread
  // poll (readAt IS NULL). `limit` caps the page (default 50).
  async list(
    orgId: string,
    opts: { unread?: boolean; limit?: number } = {},
  ): Promise<NotificationRow[]> {
    const conds = [tenantScope(orgId, schema.notifications)];
    if (opts.unread) conds.push(isNull(schema.notifications.readAt));
    const rows = await this.db
      .select()
      .from(schema.notifications)
      .where(and(...conds))
      .orderBy(desc(schema.notifications.createdAt));
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
    return rows.slice(0, limit);
  }

  // Mark one notification read (idempotent). Tenant-scoped — 404 if it isn't this
  // org's. Returns the updated row.
  async markRead(orgId: string, id: string): Promise<NotificationRow> {
    const rows = await this.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          tenantScope(orgId, schema.notifications),
          eq(schema.notifications.id, id),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Notification not found');
    if (row.readAt) return row;
    const updated = await this.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(eq(schema.notifications.id, id))
      .returning();
    return updated[0] ?? row;
  }

  // Create a notification (machine route). The org is resolved from campaignId when
  // present (mirrors the arsenal callback). 400 if it can't be resolved — the
  // notifications table is org-scoped (organization_id NOT NULL). Audited (N8N).
  async create(input: CreateNotificationDto): Promise<NotificationRow> {
    const organizationId = await this.resolveOrg(input.campaignId);
    const inserted = await this.db
      .insert(schema.notifications)
      .values({
        organizationId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to create notification');

    await writeMachineAudit(this.db, {
      organizationId,
      entity: 'notifications',
      entityId: row.id,
      action: 'CREATE',
      after: { type: input.type, title: input.title },
    });
    return row;
  }

  private async resolveOrg(campaignId?: string): Promise<string> {
    if (!campaignId) {
      throw new BadRequestException(
        'campaignId is required to resolve the notification org.',
      );
    }
    const rows = await this.db
      .select({ organizationId: schema.campaigns.organizationId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!rows[0]) {
      throw new NotFoundException(`No campaign for campaignId ${campaignId}`);
    }
    return rows[0].organizationId;
  }
}
