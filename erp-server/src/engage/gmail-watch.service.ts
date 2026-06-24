import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { schema } from '@evertrust/db';

import { DB, type DbClient } from '../db/db.tokens';
import { GoogleAccountsService } from '../google/google-accounts.service';
import { EngageScanService } from './engage-scan.service';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// The Pub/Sub topic Gmail publishes change notifications to. Set this once the GCP
// topic exists + grants publish to gmail-api-push@system.gserviceaccount.com.
// Empty = gmail.watch is not configured (register() is a no-op; the poll fallback
// keeps Engage near-real-time without it).
function pubsubTopic(): string {
  return process.env.GMAIL_PUBSUB_TOPIC?.trim() ?? '';
}

export type WatchRegisterResult = {
  configured: boolean;
  registered: number;
  accounts: { email: string; expiration: string | null; error?: string }[];
  reason?: string;
};

// ===========================================================================
// Engage · gmail.watch real-time bridge.
//   register/renew  → users.watch per mailbox, publishing INBOX changes to Pub/Sub.
//   handlePush      → a Pub/Sub push lands → diff history → targeted Engage scan.
//   pollOnce        → no-Pub/Sub fallback: compare each mailbox historyId, scan on
//                     change. Keeps it near-real-time on localhost without GCP.
// All three converge on EngageScanService.scanForMailbox.
// ===========================================================================
@Injectable()
export class GmailWatchService {
  private readonly logger = new Logger(GmailWatchService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly googleAccounts: GoogleAccountsService,
    private readonly scan: EngageScanService,
  ) {}

  isConfigured(): boolean {
    return pubsubTopic().length > 0;
  }

  // Register a watch on every connected mailbox in the org. Requires GMAIL_PUBSUB_TOPIC.
  async registerAllForOrg(orgId: string): Promise<WatchRegisterResult> {
    const topic = pubsubTopic();
    if (!topic) {
      return {
        configured: false,
        registered: 0,
        accounts: [],
        reason:
          'GMAIL_PUBSUB_TOPIC is not set. Create a Cloud Pub/Sub topic, grant publish to gmail-api-push@system.gserviceaccount.com, then set GMAIL_PUBSUB_TOPIC.',
      };
    }

    const accounts = await this.db
      .select({ id: schema.googleAccounts.id, email: schema.googleAccounts.email })
      .from(schema.googleAccounts)
      .where(
        and(
          eq(schema.googleAccounts.organizationId, orgId),
          eq(schema.googleAccounts.status, 'CONNECTED'),
        ),
      );

    const out: WatchRegisterResult = {
      configured: true,
      registered: 0,
      accounts: [],
    };
    for (const a of accounts) {
      try {
        const exp = await this.registerOne(orgId, a.id, topic);
        out.registered += 1;
        out.accounts.push({ email: a.email, expiration: exp });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.accounts.push({ email: a.email, expiration: null, error: msg });
        this.logger.warn(`watch register failed for ${a.email}: ${msg}`);
      }
    }
    return out;
  }

  // Register/refresh one mailbox's watch; persists the baseline historyId + expiry.
  private async registerOne(
    orgId: string,
    accountId: string,
    topic: string,
  ): Promise<string | null> {
    const token = await this.googleAccounts.getAccessTokenForAccount(orgId, accountId);
    if (!token) throw new Error('no access token');

    const res = await fetch(`${GMAIL_API}/watch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicName: topic,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'INCLUDE',
      }),
    });
    if (!res.ok) {
      throw new Error(`watch HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { historyId?: string; expiration?: string };
    const expiration = data.expiration ? new Date(Number(data.expiration)) : null;

    await this.db
      .update(schema.googleAccounts)
      .set({
        gmailHistoryId: data.historyId ?? null,
        gmailWatchExpiration: expiration,
        updatedAt: new Date(),
      })
      .where(eq(schema.googleAccounts.id, accountId));

    return expiration ? expiration.toISOString() : null;
  }

  // Stop every watch in the org (e.g. before disconnecting). Best-effort.
  async stopAllForOrg(orgId: string): Promise<{ stopped: number }> {
    const accounts = await this.db
      .select({ id: schema.googleAccounts.id })
      .from(schema.googleAccounts)
      .where(eq(schema.googleAccounts.organizationId, orgId));

    let stopped = 0;
    for (const a of accounts) {
      const token = await this.googleAccounts.getAccessTokenForAccount(orgId, a.id);
      if (!token) continue;
      try {
        await fetch(`${GMAIL_API}/stop`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        await this.db
          .update(schema.googleAccounts)
          .set({ gmailWatchExpiration: null, updatedAt: new Date() })
          .where(eq(schema.googleAccounts.id, a.id));
        stopped += 1;
      } catch {
        // best-effort
      }
    }
    return { stopped };
  }

  // Re-register watches expiring within 24h (Gmail caps watches at ~7 days). Called
  // daily by the scheduler so the push subscription never silently lapses.
  async renewExpiring(): Promise<void> {
    const topic = pubsubTopic();
    if (!topic) return;
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        id: schema.googleAccounts.id,
        orgId: schema.googleAccounts.organizationId,
        email: schema.googleAccounts.email,
      })
      .from(schema.googleAccounts)
      .where(
        and(
          isNotNull(schema.googleAccounts.gmailWatchExpiration),
          lt(schema.googleAccounts.gmailWatchExpiration, soon),
        ),
      );
    for (const r of rows) {
      try {
        await this.registerOne(r.orgId, r.id, topic);
        this.logger.log(`Renewed gmail.watch for ${r.email}.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`watch renew failed for ${r.email}: ${msg}`);
      }
    }
  }

  // A Pub/Sub push notification arrived: { emailAddress, historyId }. Find the mailbox,
  // confirm new INBOX messages since our last seen historyId, scan that mailbox, and
  // advance the stored historyId. Slow scan runs to completion here — the controller
  // calls this WITHOUT awaiting so Pub/Sub gets a fast ack.
  async handlePush(payload: { emailAddress?: string; historyId?: string }): Promise<void> {
    const email = payload.emailAddress?.toLowerCase();
    if (!email) return;

    const [acct] = await this.db
      .select({
        id: schema.googleAccounts.id,
        orgId: schema.googleAccounts.organizationId,
        email: schema.googleAccounts.email,
        lastHistoryId: schema.googleAccounts.gmailHistoryId,
      })
      .from(schema.googleAccounts)
      .where(eq(schema.googleAccounts.email, email))
      .limit(1);
    if (!acct) {
      this.logger.warn(`gmail push for unknown mailbox ${email} — ignored.`);
      return;
    }

    const token = await this.googleAccounts.getAccessTokenForAccount(acct.orgId, acct.id);
    if (!token) return;

    const changed = await this.hasNewInbox(token, acct.lastHistoryId);
    // Advance the cursor to the pushed historyId regardless (so we don't reprocess).
    if (payload.historyId) {
      await this.db
        .update(schema.googleAccounts)
        .set({ gmailHistoryId: payload.historyId, updatedAt: new Date() })
        .where(eq(schema.googleAccounts.id, acct.id));
    }
    if (changed) {
      await this.scan.scanForMailbox(acct.orgId, acct.email);
    }
  }

  // Poll fallback: for every connected mailbox, compare the live historyId to the
  // stored one; scan when it advanced. Baselines (stores, no scan) on first sight.
  async pollOnce(): Promise<void> {
    const accounts = await this.db
      .select({
        id: schema.googleAccounts.id,
        orgId: schema.googleAccounts.organizationId,
        email: schema.googleAccounts.email,
        lastHistoryId: schema.googleAccounts.gmailHistoryId,
      })
      .from(schema.googleAccounts)
      .where(eq(schema.googleAccounts.status, 'CONNECTED'));

    for (const a of accounts) {
      try {
        const token = await this.googleAccounts.getAccessTokenForAccount(a.orgId, a.id);
        if (!token) continue;
        const liveHistoryId = await this.profileHistoryId(token);
        if (!liveHistoryId) continue;

        if (!a.lastHistoryId) {
          // First sight — baseline only, don't scan the whole backlog.
          await this.setHistoryId(a.id, liveHistoryId);
          continue;
        }
        if (liveHistoryId !== a.lastHistoryId) {
          const changed = await this.hasNewInbox(token, a.lastHistoryId);
          await this.setHistoryId(a.id, liveHistoryId);
          if (changed) await this.scan.scanForMailbox(a.orgId, a.email);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`poll failed for ${a.email}: ${msg}`);
      }
    }
  }

  // ---- Gmail REST helpers ----

  private async profileHistoryId(token: string): Promise<string | null> {
    const res = await fetch(`${GMAIL_API}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { historyId?: string };
    return data.historyId ?? null;
  }

  // True if Gmail history since `startHistoryId` includes a message added to INBOX.
  // On a 404 (historyId too old/expired) we assume change=true so a scan still runs.
  private async hasNewInbox(token: string, startHistoryId: string | null): Promise<boolean> {
    if (!startHistoryId) return true;
    const url = `${GMAIL_API}/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded&labelId=INBOX`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return true;
    if (!res.ok) return false;
    const data = (await res.json()) as { history?: { messagesAdded?: unknown[] }[] };
    return (data.history ?? []).some((h) => (h.messagesAdded ?? []).length > 0);
  }

  private async setHistoryId(accountId: string, historyId: string): Promise<void> {
    await this.db
      .update(schema.googleAccounts)
      .set({ gmailHistoryId: historyId, updatedAt: new Date() })
      .where(eq(schema.googleAccounts.id, accountId));
  }
}
