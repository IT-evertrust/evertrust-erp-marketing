import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { OrgSettingsDto, UpdateOrgSettingsDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';

// The product defaults applied when an org has no org_config row yet (or a column is
// null). They mirror the schema's column defaults so a fresh org and a saved-then-reset
// org resolve to the same effective settings. senderName/senderEmail have NO default —
// they fall back to null (the account/product sender identity is used elsewhere).
const DEFAULTS = {
  dailySendCap: 120,
  sendingHoursStart: '08:00',
  sendingHoursEnd: '17:00',
  followupRound2Days: 4,
  followupRound3Days: 9,
  gmailEnabled: true,
  calendarEnabled: true,
  readAiEnabled: true,
  sheetsEnabled: true,
  approvalBeforeSending: true,
  autoSend: false,
  weeklyReportEnabled: true,
} as const;

// Per-org Growth Engine settings (the Settings page). Reads/writes the dedicated
// org_config columns; every read resolves (stored value ?? product default) so the UI
// always gets a complete, non-null payload. Tenant scope is enforced by the caller
// passing the @OrgId()-derived orgId; every query is confined to that org.
@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // The org's effective Growth Engine settings (stored override ?? product default).
  async getSettings(orgId: string): Promise<OrgSettingsDto> {
    const [row] = await this.db
      .select({
        senderName: schema.orgConfig.senderName,
        senderEmail: schema.orgConfig.senderEmail,
        signature: schema.orgConfig.signature,
        dailySendCap: schema.orgConfig.dailySendCap,
        sendingHoursStart: schema.orgConfig.sendingHoursStart,
        sendingHoursEnd: schema.orgConfig.sendingHoursEnd,
        followupRound2Days: schema.orgConfig.followupRound2Days,
        followupRound3Days: schema.orgConfig.followupRound3Days,
        gmailEnabled: schema.orgConfig.gmailEnabled,
        calendarEnabled: schema.orgConfig.calendarEnabled,
        readAiEnabled: schema.orgConfig.readAiEnabled,
        sheetsEnabled: schema.orgConfig.sheetsEnabled,
        approvalBeforeSending: schema.orgConfig.approvalBeforeSending,
        autoSend: schema.orgConfig.autoSend,
        weeklyReportEnabled: schema.orgConfig.weeklyReportEnabled,
      })
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);

    return {
      senderName: row?.senderName ?? null,
      senderEmail: row?.senderEmail ?? null,
      signature: row?.signature ?? null,
      dailySendCap: row?.dailySendCap ?? DEFAULTS.dailySendCap,
      sendingHoursStart: row?.sendingHoursStart ?? DEFAULTS.sendingHoursStart,
      sendingHoursEnd: row?.sendingHoursEnd ?? DEFAULTS.sendingHoursEnd,
      followupRound2Days: row?.followupRound2Days ?? DEFAULTS.followupRound2Days,
      followupRound3Days: row?.followupRound3Days ?? DEFAULTS.followupRound3Days,
      gmailEnabled: row?.gmailEnabled ?? DEFAULTS.gmailEnabled,
      calendarEnabled: row?.calendarEnabled ?? DEFAULTS.calendarEnabled,
      readAiEnabled: row?.readAiEnabled ?? DEFAULTS.readAiEnabled,
      sheetsEnabled: row?.sheetsEnabled ?? DEFAULTS.sheetsEnabled,
      approvalBeforeSending:
        row?.approvalBeforeSending ?? DEFAULTS.approvalBeforeSending,
      autoSend: row?.autoSend ?? DEFAULTS.autoSend,
      weeklyReportEnabled: row?.weeklyReportEnabled ?? DEFAULTS.weeklyReportEnabled,
    };
  }

  // Persist a PARTIAL update: only the provided keys are written (an omitted key leaves
  // its column unchanged). Find-or-creates the org's org_config row, then returns the
  // freshly resolved settings. Same find-or-create upsert pattern as the Reach send
  // settings. senderName/senderEmail accept an explicit null to clear them.
  async updateSettings(
    orgId: string,
    patch: UpdateOrgSettingsDto,
  ): Promise<OrgSettingsDto> {
    const set: Partial<typeof schema.orgConfig.$inferInsert> = {};
    if ('senderName' in patch) set.senderName = patch.senderName ?? null;
    if ('senderEmail' in patch) set.senderEmail = patch.senderEmail ?? null;
    if ('signature' in patch) set.signature = patch.signature ?? null;
    if (patch.dailySendCap !== undefined) set.dailySendCap = patch.dailySendCap;
    if (patch.sendingHoursStart !== undefined) {
      set.sendingHoursStart = patch.sendingHoursStart;
    }
    if (patch.sendingHoursEnd !== undefined) {
      set.sendingHoursEnd = patch.sendingHoursEnd;
    }
    if (patch.followupRound2Days !== undefined) {
      set.followupRound2Days = patch.followupRound2Days;
    }
    if (patch.followupRound3Days !== undefined) {
      set.followupRound3Days = patch.followupRound3Days;
    }
    if (patch.gmailEnabled !== undefined) set.gmailEnabled = patch.gmailEnabled;
    if (patch.calendarEnabled !== undefined) {
      set.calendarEnabled = patch.calendarEnabled;
    }
    if (patch.readAiEnabled !== undefined) set.readAiEnabled = patch.readAiEnabled;
    if (patch.sheetsEnabled !== undefined) set.sheetsEnabled = patch.sheetsEnabled;
    if (patch.approvalBeforeSending !== undefined) {
      set.approvalBeforeSending = patch.approvalBeforeSending;
    }
    if (patch.autoSend !== undefined) set.autoSend = patch.autoSend;
    if (patch.weeklyReportEnabled !== undefined) {
      set.weeklyReportEnabled = patch.weeklyReportEnabled;
    }

    if (Object.keys(set).length > 0) {
      await this.db
        .insert(schema.orgConfig)
        .values({ organizationId: orgId, ...set })
        .onConflictDoUpdate({
          target: schema.orgConfig.organizationId,
          set: { ...set, updatedAt: new Date() },
        });
    }

    return this.getSettings(orgId);
  }
}
