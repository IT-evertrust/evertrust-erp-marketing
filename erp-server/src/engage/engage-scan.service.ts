import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { schema } from '@evertrust/db';

import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { EngageRepliesService } from './engage-replies.service';

// ===========================================================================
// Engage · scan orchestrator. The single place that decides WHICH campaigns to
// (re)classify, used by every trigger: the hourly auto-scan, the gmail.watch push
// handler, the historyId poll fallback, and the manual "scan all" button. Wraps the
// per-campaign EngageRepliesService.scanCampaign so callers don't repeat the
// iterate-aims-and-swallow-errors boilerplate. Classification is slow on the local
// model, so scans run SEQUENTIALLY (one aim at a time) to avoid hammering it.
// ===========================================================================

export type ScanAllResult = {
  aims: number;
  scanned: number;
  classified: number;
};

@Injectable()
export class EngageScanService {
  private readonly logger = new Logger(EngageScanService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly replies: EngageRepliesService,
  ) {}

  // Every org that owns at least one Reach AIM — the unit the schedulers iterate.
  async orgsWithAims(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ orgId: schema.reachAims.organizationId })
      .from(schema.reachAims);
    return rows.map((r) => r.orgId);
  }

  // Scan every AIM in the org (sequential). Per-aim failures are logged and skipped
  // so one bad campaign never aborts the run.
  async scanAllForOrg(orgId: string): Promise<ScanAllResult> {
    const aims = await this.db
      .select({ id: schema.reachAims.id, name: schema.reachAims.name })
      .from(schema.reachAims)
      .where(tenantScope(orgId, schema.reachAims));

    const total: ScanAllResult = { aims: 0, scanned: 0, classified: 0 };
    for (const aim of aims) {
      try {
        const r = await this.replies.scanCampaign(orgId, aim.id);
        total.aims += 1;
        total.scanned += r.scanned;
        total.classified += r.classified;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scanAllForOrg: aim ${aim.id} (${aim.name}) failed: ${msg}`);
      }
    }
    return total;
  }

  // Scan only the AIMs that send from a given mailbox (sender local-part ==
  // mailbox email local-part) — the targeted scan after a new inbound mail is
  // detected for that mailbox. Falls back to nothing when no AIM matches.
  async scanForMailbox(orgId: string, mailboxEmail: string): Promise<ScanAllResult> {
    const localPart = (mailboxEmail.split('@')[0] ?? '').toLowerCase();
    if (!localPart) return { aims: 0, scanned: 0, classified: 0 };

    const aims = await this.db
      .select({ id: schema.reachAims.id, name: schema.reachAims.name })
      .from(schema.reachAims)
      .where(
        and(
          tenantScope(orgId, schema.reachAims),
          dsql`lower(${schema.reachAims.sender}) = ${localPart}`,
        ),
      );

    const total: ScanAllResult = { aims: 0, scanned: 0, classified: 0 };
    for (const aim of aims) {
      try {
        const r = await this.replies.scanCampaign(orgId, aim.id);
        total.aims += 1;
        total.scanned += r.scanned;
        total.classified += r.classified;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scanForMailbox: aim ${aim.id} (${aim.name}) failed: ${msg}`);
      }
    }
    this.logger.log(
      `scanForMailbox(${mailboxEmail}): scanned ${total.scanned} lead(s) across ${total.aims} aim(s), ${total.classified} classified.`,
    );
    return total;
  }
}
